-- Promemoria di pagamento amministratrice -> famiglia.
-- I genitori possono soltanto leggerli: non viene riaperto alcun canale
-- di notifica famiglia -> amministratrice.

begin;

-- Ribadisce il blocco introdotto dalla 011 anche se questa migrazione viene
-- applicata manualmente da SQL Editor.
drop policy if exists family_notifications_family_insert
  on public.family_notifications;
drop policy if exists bank_notices_family_insert
  on public.bank_transfer_notices;
revoke insert on public.family_notifications from authenticated;
revoke insert on public.bank_transfer_notices from authenticated;

create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null
    references public.invoices(id) on delete restrict,
  family_id uuid not null
    references public.families(id) on delete restrict,
  sent_by uuid not null
    references public.profiles(id) on delete restrict,
  invoice_number text not null,
  due_date date not null,
  outstanding_cents_at_send integer not null
    check (outstanding_cents_at_send > 0),
  currency text not null
    check (currency ~ '^[A-Z]{3}$'),
  message text not null,
  sent_at timestamptz not null default now(),
  constraint payment_reminders_one_per_invoice unique (invoice_id),
  constraint payment_reminders_message_valid check (
    char_length(btrim(message)) between 1 and 2000
  )
);

create index if not exists payment_reminders_sent_at_idx
  on public.payment_reminders (sent_at desc);

drop trigger if exists payment_reminders_audit
  on public.payment_reminders;
create trigger payment_reminders_audit
after insert or update or delete on public.payment_reminders
for each row execute function private.audit_row_change();

alter table public.payment_reminders enable row level security;

drop policy if exists payment_reminders_select
  on public.payment_reminders;
create policy payment_reminders_select
on public.payment_reminders
for select
to authenticated
using (
  (select private.is_admin())
  or (
    (select private.can_access_family(family_id))
    and exists (
      select 1
      from public.invoices i
      where i.id = payment_reminders.invoice_id
        and i.family_id = payment_reminders.family_id
        and i.status <> 'void'
    )
  )
);

-- Nessuna scrittura diretta da browser: l'unico inserimento ammesso passa
-- dalla RPC amministrativa sottostante.
revoke all on public.payment_reminders from anon, authenticated;
grant select on public.payment_reminders to authenticated;
grant all on public.payment_reminders to service_role;

create or replace function public.admin_send_payment_reminder(
  p_invoice_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_reminder public.payment_reminders;
  v_paid_cents bigint;
  v_outstanding_cents integer;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_invoice_number text;
  v_amount_text text;
  v_message text;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratrice'
      using errcode = '42501';
  end if;

  if p_invoice_id is null then
    raise exception 'Indicare la fattura'
      using errcode = '22023';
  end if;

  -- Il lock serializza due eventuali clic contemporanei sulla stessa fattura.
  select *
  into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Fattura non trovata'
      using errcode = 'P0002';
  end if;

  -- Un retry è idempotente e restituisce il promemoria già presente.
  select *
  into v_reminder
  from public.payment_reminders
  where invoice_id = p_invoice_id;

  if found then
    return jsonb_build_object(
      'created', false,
      'reason', 'already_sent',
      'reminder', to_jsonb(v_reminder)
    );
  end if;

  if v_invoice.status in ('draft', 'paid', 'void', 'refunded') then
    raise exception 'La fattura non è sollecitabile nello stato corrente'
      using errcode = '23514';
  end if;

  if v_today < v_invoice.due_date + 5 then
    raise exception
      'Il promemoria sarà disponibile dal %',
      to_char(v_invoice.due_date + 5, 'DD/MM/YYYY')
      using errcode = '23514';
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
    v_invoice.total_cents::bigint - v_paid_cents,
    0
  )::integer;

  if v_outstanding_cents = 0 then
    raise exception 'La fattura non ha più un saldo insoluto'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.bank_transfer_notices n
    where n.invoice_id = p_invoice_id
      and n.status = 'submitted'
  ) then
    raise exception
      'È presente un bonifico ancora da riconciliare: promemoria non inviato'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.payments p
    where p.invoice_id = p_invoice_id
      and p.provider = 'paypal'
      and p.status in ('pending', 'capturing')
  ) then
    raise exception
      'È presente un pagamento PayPal in corso: promemoria non inviato'
      using errcode = '55000';
  end if;

  if v_invoice.status not in ('pending', 'overdue', 'partially_paid') then
    raise exception 'Lo stato della fattura richiede una verifica'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.families f
    where f.id = v_invoice.family_id
      and f.is_active
  ) then
    raise exception 'La famiglia collegata non è attiva'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.family_users fu
    join public.profiles p on p.id = fu.user_id
    where fu.family_id = v_invoice.family_id
      and p.role = 'family'
      and p.is_active
  ) then
    raise exception 'Nessun account genitore attivo per questa famiglia'
      using errcode = '23514';
  end if;

  v_invoice_number := left(
    coalesce(
      nullif(
        regexp_replace(
          btrim(v_invoice.number),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        ''
      ),
      'senza numero'
    ),
    120
  );

  v_amount_text :=
    (v_outstanding_cents / 100)::text
    || ','
    || lpad((v_outstanding_cents % 100)::text, 2, '0');

  v_message := format(
    'Gentile famiglia, la fattura n. %s, scaduta il %s, risulta ancora insoluta. Saldo residuo: %s %s. Puoi consultare la sezione Pagamenti per pagare con PayPal o bonifico. Per qualsiasi dubbio usa “Parlane con Valeria”.',
    v_invoice_number,
    to_char(v_invoice.due_date, 'DD/MM/YYYY'),
    v_amount_text,
    v_invoice.currency
  );

  insert into public.payment_reminders (
    invoice_id,
    family_id,
    sent_by,
    invoice_number,
    due_date,
    outstanding_cents_at_send,
    currency,
    message
  )
  values (
    v_invoice.id,
    v_invoice.family_id,
    auth.uid(),
    v_invoice_number,
    v_invoice.due_date,
    v_outstanding_cents,
    v_invoice.currency,
    v_message
  )
  on conflict (invoice_id) do nothing
  returning * into v_reminder;

  if not found then
    select *
    into v_reminder
    from public.payment_reminders
    where invoice_id = p_invoice_id;

    if not found then
      raise exception 'Impossibile registrare il promemoria';
    end if;

    return jsonb_build_object(
      'created', false,
      'reason', 'already_sent',
      'reminder', to_jsonb(v_reminder)
    );
  end if;

  return jsonb_build_object(
    'created', true,
    'reason', 'sent',
    'reminder', to_jsonb(v_reminder)
  );
end;
$$;

revoke all on function public.admin_send_payment_reminder(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_send_payment_reminder(uuid)
  to authenticated;

alter table public.payment_reminders replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payment_reminders'
  ) then
    execute
      'alter publication supabase_realtime add table public.payment_reminders';
  end if;
end;
$$;

commit;
