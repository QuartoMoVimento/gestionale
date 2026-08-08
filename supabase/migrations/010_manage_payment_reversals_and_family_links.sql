-- Annullamenti contabili tracciabili e privacy delle associazioni famiglia.

begin;

alter table public.invoices
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

update public.invoices
set voided_at = coalesce(voided_at, updated_at, now()),
    void_reason = coalesce(
      nullif(btrim(void_reason), ''),
      'Annullata prima dell’introduzione dello storico di annullamento'
    )
where status = 'void';

alter table public.invoices
  drop constraint if exists invoices_void_metadata_valid;

alter table public.invoices
  add constraint invoices_void_metadata_valid check (
    status <> 'void'
    or (
      voided_at is not null
      and nullif(btrim(void_reason), '') is not null
    )
  );

-- Le colonne aggiunte vengono accodate alla vista per non cambiare l'ordine
-- delle colonne già esposte a PostgREST.
create or replace view public.invoice_summaries
with (security_invoker = true)
as
select
  i.id,
  i.family_id,
  i.student_id,
  i.number,
  i.title,
  i.description,
  i.total_cents,
  i.currency,
  i.due_date,
  i.status,
  i.payment_method,
  i.paid_at,
  i.issued_at,
  i.created_at,
  i.updated_at,
  coalesce(p.paid_cents, 0)::integer as paid_cents,
  greatest(i.total_cents - coalesce(p.paid_cents, 0), 0)::integer
    as outstanding_cents,
  case
    when i.status in ('draft', 'void') then i.status
    when coalesce(p.paid_cents, 0) >= i.total_cents then 'paid'
    when coalesce(p.paid_cents, 0) = 0 and coalesce(p.has_refund, false)
      then 'refunded'
    when coalesce(p.paid_cents, 0) > 0 then 'partially_paid'
    when exists (
      select 1
      from public.bank_transfer_notices btn
      where btn.invoice_id = i.id
        and btn.status = 'submitted'
    ) then 'processing'
    when i.due_date < current_date then 'overdue'
    else 'pending'
  end as effective_status,
  i.voided_at,
  i.voided_by,
  i.void_reason
from public.invoices i
left join lateral (
  select
    sum(
      case
        when pay.status in ('completed', 'partially_refunded', 'refunded')
          then pay.amount_cents - pay.refunded_cents
        else 0
      end
    ) as paid_cents,
    bool_or(pay.refunded_cents > 0) as has_refund
  from public.payments pay
  where pay.invoice_id = i.id
) p on true;

create or replace function public.admin_void_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_reason text;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception 'Indicare il motivo dell''annullamento'
      using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Il motivo non può superare 500 caratteri'
      using errcode = '22023';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Scadenza non trovata' using errcode = 'P0002';
  end if;
  if v_invoice.status = 'void' then
    return v_invoice;
  end if;

  if exists (
    select 1
    from public.payments p
    where p.invoice_id = p_invoice_id
      and p.status not in ('failed', 'cancelled')
  ) then
    raise exception
      'Prima di eliminare la scadenza annulla gli incassi manuali collegati. I pagamenti PayPal richiedono la gestione dal provider.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.bank_transfer_notices n
    where n.invoice_id = p_invoice_id
      and n.status in ('submitted', 'verified')
  ) then
    raise exception
      'Prima di eliminare la scadenza completa o annulla la segnalazione di bonifico collegata.'
      using errcode = '23514';
  end if;

  update public.invoices
  set status = 'void',
      paid_at = null,
      payment_method = null,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = v_reason
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

create or replace function public.admin_cancel_manual_payment(
  p_payment_id uuid,
  p_reason text
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_reason text;
  v_cancelled_at timestamptz := now();
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception 'Indicare il motivo dell''annullamento'
      using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Il motivo non può superare 500 caratteri'
      using errcode = '22023';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Incasso non trovato' using errcode = 'P0002';
  end if;
  if v_payment.provider <> 'manual' then
    raise exception
      'I pagamenti del provider non possono essere annullati manualmente dal gestionale'
      using errcode = '23514';
  end if;
  if v_payment.status = 'cancelled' then
    return v_payment;
  end if;
  if v_payment.status <> 'completed' then
    raise exception 'L''incasso non è annullabile nello stato corrente'
      using errcode = '23514';
  end if;

  update public.payments
  set status = 'cancelled',
      provider_status = 'CANCELLED_BY_ADMIN',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cancelled_by_admin',
        jsonb_build_object(
          'at', v_cancelled_at,
          'by', auth.uid(),
          'reason', v_reason
        )
      )
  where id = p_payment_id
  returning * into v_payment;

  update public.bank_transfer_notices n
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = v_cancelled_at,
      review_note = concat(
        'Incasso annullato dall’amministratrice: ',
        v_reason
      )
  where v_payment.idempotency_key = 'bank_notice:' || n.id::text
    and n.status = 'verified';

  perform private.refresh_invoice_status(v_payment.invoice_id);
  return v_payment;
end;
$$;

drop policy if exists family_users_select on public.family_users;
create policy family_users_select
on public.family_users for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_admin())
);

drop policy if exists invoices_select on public.invoices;
create policy invoices_select
on public.invoices for select to authenticated
using (
  status <> 'void'
  and (select private.can_access_family(family_id))
);

drop policy if exists payments_select on public.payments;
create policy payments_select
on public.payments for select to authenticated
using (
  status <> 'cancelled'
  and (select private.can_access_family(family_id))
  and exists (
    select 1
    from public.invoices i
    where i.id = payments.invoice_id
      and i.status <> 'void'
  )
);

drop policy if exists bank_notices_select on public.bank_transfer_notices;
create policy bank_notices_select
on public.bank_transfer_notices for select to authenticated
using (
  (select private.can_access_family(family_id))
  and exists (
    select 1
    from public.invoices i
    where i.id = bank_transfer_notices.invoice_id
      and i.status <> 'void'
  )
);

revoke all on function public.admin_void_invoice(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_cancel_manual_payment(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_void_invoice(uuid, text)
  to authenticated;
grant execute on function public.admin_cancel_manual_payment(uuid, text)
  to authenticated;

commit;
