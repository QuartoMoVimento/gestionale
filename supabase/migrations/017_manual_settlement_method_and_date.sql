-- Conferma incasso manuale dall'area amministratrice:
--   * i metodi selezionabili diventano bonifico, PayPal e contanti;
--   * la data in cui il pagamento è avvenuto è obbligatoria e viene salvata
--     su payments.paid_at (da cui invoices.paid_at viene ricalcolato).

begin;

-- La vecchia firma a due argomenti va rimossa: mantenerla renderebbe ambigua
-- la chiamata con argomenti nominati verso la nuova versione con default.
drop function if exists public.admin_mark_invoice_paid(uuid, text);

create or replace function public.admin_mark_invoice_paid(
  p_invoice_id uuid,
  p_method text default 'bank_transfer',
  p_paid_at timestamptz default now()
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_payment public.payments;
  v_paid_cents bigint;
  v_outstanding_cents integer;
  v_paid_at timestamptz;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if p_method not in ('bank_transfer', 'paypal', 'cash', 'other') then
    raise exception 'Metodo manuale non valido' using errcode = '22023';
  end if;

  v_paid_at := coalesce(p_paid_at, now());
  if v_paid_at > now() + interval '1 day' then
    raise exception 'La data del pagamento non può essere futura'
      using errcode = '22023';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Scadenza non trovata' using errcode = 'P0002';
  end if;
  if v_invoice.status in ('draft', 'void') then
    raise exception 'Scadenza non pagabile nello stato corrente'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.payments p
    where p.invoice_id = p_invoice_id
      and p.provider = 'paypal'
      and p.status in ('pending', 'capturing')
  ) then
    raise exception
      'È in corso un checkout PayPal: non registrare un saldo manuale'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.bank_transfer_notices n
    where n.invoice_id = p_invoice_id
      and n.status = 'submitted'
  ) then
    raise exception
      'Esiste un bonifico da verificare o rifiutare prima del saldo manuale'
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

  v_outstanding_cents := greatest(
    v_invoice.total_cents - v_paid_cents,
    0
  )::integer;

  if v_outstanding_cents = 0 then
    select * into v_payment
    from public.payments p
    where p.invoice_id = p_invoice_id
      and p.status in ('completed', 'partially_refunded')
    order by p.paid_at desc nulls last
    limit 1;
    return v_payment;
  end if;

  insert into public.payments (
    invoice_id,
    family_id,
    amount_cents,
    currency,
    method,
    status,
    provider,
    reference,
    paid_at,
    created_by
  )
  values (
    v_invoice.id,
    v_invoice.family_id,
    v_outstanding_cents,
    v_invoice.currency,
    p_method,
    'completed',
    'manual',
    'Registrato manualmente dall''amministratore',
    v_paid_at,
    auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.admin_mark_invoice_paid(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_mark_invoice_paid(uuid, text, timestamptz)
  to authenticated;

commit;
