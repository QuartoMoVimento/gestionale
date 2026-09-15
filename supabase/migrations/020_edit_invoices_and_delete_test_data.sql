-- Correzione delle scadenze e cancellazione definitiva, tracciata nell'audit,
-- dei dati di prova. Le transazioni provenienti da provider esterni non
-- possono essere eliminate dal gestionale.

begin;

create or replace function public.admin_update_invoice(
  p_invoice_id uuid,
  p_number text,
  p_title text,
  p_description text,
  p_total_cents integer,
  p_due_date date
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_updated public.invoices;
  v_number text;
  v_title text;
  v_description text;
  v_paid_cents bigint;
  v_status text;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  v_number := nullif(btrim(coalesce(p_number, '')), '');
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  v_description := btrim(coalesce(p_description, ''));
  if v_number is null or char_length(v_number) > 100 then
    raise exception 'Il numero fattura è obbligatorio e non può superare 100 caratteri'
      using errcode = '22023';
  end if;
  if v_title is null or char_length(v_title) > 200 then
    raise exception 'La voce è obbligatoria e non può superare 200 caratteri'
      using errcode = '22023';
  end if;
  if char_length(v_description) > 1000 then
    raise exception 'La descrizione non può superare 1000 caratteri'
      using errcode = '22023';
  end if;
  if p_total_cents is null or p_total_cents <= 0 then
    raise exception 'L''importo deve essere maggiore di zero'
      using errcode = '22023';
  end if;
  if p_due_date is null then
    raise exception 'Indicare la data di scadenza' using errcode = '22023';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Scadenza non trovata' using errcode = 'P0002';
  end if;
  if v_invoice.status in ('draft', 'void') then
    raise exception 'Questa scadenza non può essere modificata'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.payments p
    where p.invoice_id = p_invoice_id
      and p.provider = 'paypal'
      and p.status in ('pending', 'capturing')
  ) then
    raise exception 'Attendi la conclusione del pagamento PayPal prima di modificare la scadenza'
      using errcode = '55000';
  end if;

  select coalesce(sum(
    case
      when p.status in ('completed', 'partially_refunded', 'refunded')
        then p.amount_cents - p.refunded_cents
      else 0
    end
  ), 0)
  into v_paid_cents
  from public.payments p
  where p.invoice_id = p_invoice_id;

  if p_total_cents < v_paid_cents then
    raise exception 'L''importo totale non può essere inferiore a quanto già incassato'
      using errcode = '23514';
  end if;

  v_status := case
    when v_paid_cents >= p_total_cents and v_paid_cents > 0 then 'paid'
    when v_paid_cents > 0 then 'partially_paid'
    when exists (
      select 1 from public.bank_transfer_notices n
      where n.invoice_id = p_invoice_id and n.status = 'submitted'
    ) then 'processing'
    when p_due_date < current_date then 'overdue'
    else 'pending'
  end;

  update public.invoices i
  set number = v_number,
      title = v_title,
      description = v_description,
      total_cents = p_total_cents,
      due_date = p_due_date,
      status = v_status,
      payment_method = case
        when v_status = 'paid' then (
          select p.method from public.payments p
          where p.invoice_id = i.id
            and p.status in ('completed', 'partially_refunded')
          order by p.paid_at desc nulls last
          limit 1
        )
        else null
      end,
      paid_at = case
        when v_status = 'paid' then (
          select max(p.paid_at) from public.payments p
          where p.invoice_id = i.id
            and p.status in ('completed', 'partially_refunded')
        )
        else null
      end
  where i.id = p_invoice_id
  returning * into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.admin_update_invoice(
  uuid, text, text, text, integer, date
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_invoice(
  uuid, text, text, text, integer, date
) to authenticated;

create or replace function private.prevent_payment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.allow_payment_delete', true) = 'on'
     and (select private.is_admin()) then
    return old;
  end if;
  raise exception
    'I movimenti economici non possono essere eliminati: annullarli o rimborsarli'
    using errcode = '23514';
end;
$$;

create or replace function public.admin_delete_test_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_reason text;
  v_payment_count integer;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Indicare un motivo valido entro 500 caratteri'
      using errcode = '22023';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then
    raise exception 'Scadenza non trovata' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.payments p
    where p.invoice_id = p_invoice_id
      and (
        p.provider <> 'manual'
        or p.provider_order_id is not null
        or p.provider_capture_id is not null
      )
  ) then
    raise exception 'Le transazioni PayPal reali non possono essere eliminate dal gestionale'
      using errcode = '23514';
  end if;

  select count(*) into v_payment_count
  from public.payments p
  where p.invoice_id = p_invoice_id;

  update public.invoices
  set status = 'void',
      payment_method = null,
      paid_at = null,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = 'Eliminazione definitiva dati di prova: ' || v_reason
  where id = p_invoice_id;

  perform set_config('app.allow_payment_delete', 'on', true);
  delete from public.payment_reminders where invoice_id = p_invoice_id;
  delete from public.bank_transfer_notices where invoice_id = p_invoice_id;
  delete from public.payments where invoice_id = p_invoice_id;
  delete from public.invoices where id = p_invoice_id;

  return jsonb_build_object(
    'deleted', true,
    'invoice_id', p_invoice_id,
    'payments_deleted', v_payment_count
  );
end;
$$;

revoke all on function public.admin_delete_test_invoice(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_test_invoice(uuid, text)
  to authenticated;

commit;
