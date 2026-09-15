-- Correzione tracciata degli incassi inseriti manualmente.
-- Le transazioni provenienti da PayPal o da una segnalazione di bonifico
-- restano immutabili e vanno gestite nel rispettivo flusso.

begin;

create or replace function public.admin_update_manual_payment(
  p_payment_id uuid,
  p_amount_cents integer,
  p_method text,
  p_paid_at timestamptz,
  p_reference text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_updated public.payments;
  v_reference text;
  v_history jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'L''importo deve essere maggiore di zero'
      using errcode = '22023';
  end if;
  if p_method not in ('bank_transfer', 'paypal', 'cash', 'other') then
    raise exception 'Metodo manuale non valido' using errcode = '22023';
  end if;
  if p_paid_at is null then
    raise exception 'Indicare la data del pagamento' using errcode = '22023';
  end if;
  if p_paid_at > now() + interval '1 day' then
    raise exception 'La data del pagamento non può essere futura'
      using errcode = '22023';
  end if;

  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if char_length(coalesce(v_reference, '')) > 250 then
    raise exception 'Il riferimento non può superare 250 caratteri'
      using errcode = '22023';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Incasso non trovato' using errcode = 'P0002';
  end if;
  if v_payment.provider <> 'manual'
     or v_payment.status <> 'completed'
     or v_payment.idempotency_key is not null then
    raise exception
      'Questo incasso non può essere modificato manualmente dal gestionale'
      using errcode = '23514';
  end if;

  v_history := coalesce(
    v_payment.metadata -> 'manual_edit_history',
    '[]'::jsonb
  ) || jsonb_build_array(
    jsonb_build_object(
      'edited_at', now(),
      'edited_by', auth.uid(),
      'previous', jsonb_build_object(
        'amount_cents', v_payment.amount_cents,
        'method', v_payment.method,
        'paid_at', v_payment.paid_at,
        'reference', v_payment.reference
      )
    )
  );

  update public.payments
  set amount_cents = p_amount_cents,
      method = p_method,
      paid_at = p_paid_at,
      reference = v_reference,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'manual_edit_history', v_history,
        'last_manual_edit_at', now(),
        'last_manual_edit_by', auth.uid()
      )
  where id = p_payment_id
  returning * into v_updated;

  -- Il trigger ricalcola stato e metodo. La data va riallineata esplicitamente
  -- perché la funzione storica preserva il primo paid_at già valorizzato.
  update public.invoices i
  set paid_at = case
    when i.status = 'paid' then (
      select max(p.paid_at)
      from public.payments p
      where p.invoice_id = i.id
        and p.status in ('completed', 'partially_refunded')
    )
    else null
  end
  where i.id = v_updated.invoice_id;

  return v_updated;
end;
$$;

revoke all on function public.admin_update_manual_payment(
  uuid, integer, text, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_manual_payment(
  uuid, integer, text, timestamptz, text
) to authenticated;

commit;
