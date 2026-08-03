-- Quarto MoVimento - schema iniziale
-- Tutti gli importi sono espressi in centesimi; tutti gli orari sono timestamptz.

begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  phone text,
  role text not null default 'family'
    check (role in ('admin', 'family')),
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_uidx
  on public.profiles (lower(email))
  where email is not null;
create index profiles_role_active_idx on public.profiles (role, is_active);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  guardian_name text not null,
  email text not null,
  phone text,
  notes text not null default '',
  billing_name text,
  billing_address text,
  fiscal_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint families_email_not_blank check (btrim(email) <> '')
);

create index families_email_lower_idx on public.families (lower(email));
create index families_active_idx on public.families (is_active);

create table public.family_users (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  relationship text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create index family_users_user_id_idx on public.family_users (user_id, family_id);
create unique index family_users_one_primary_uidx
  on public.family_users (family_id)
  where is_primary;

create table public.students (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  birth_date date,
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_name_not_blank
    check (btrim(first_name) <> '' and btrim(last_name) <> '')
);

create index students_family_id_idx on public.students (family_id, is_active);
create index students_name_idx on public.students (last_name, first_name);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#060097',
  location text not null default '',
  duration_minutes integer not null default 60
    check (duration_minutes between 15 and 480),
  capacity integer check (capacity is null or capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_name_not_blank check (btrim(name) <> ''),
  constraint courses_color_format
    check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create index courses_active_idx on public.courses (is_active, name);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  course_id uuid not null references public.courses(id) on delete restrict,
  plan_type text not null
    check (
      plan_type in (
        'trial',
        'monthly',
        'semester',
        'annual',
        'workshop',
        'custom'
      )
    ),
  starts_on date not null,
  ends_on date,
  recovery_allowed boolean,
  recovery_notice_hours integer
    check (recovery_notice_hours is null or recovery_notice_hours >= 0),
  is_active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enrollments_dates_valid
    check (ends_on is null or ends_on >= starts_on)
);

create index enrollments_student_id_idx
  on public.enrollments (student_id, starts_on, ends_on);
create index enrollments_course_id_idx
  on public.enrollments (course_id, starts_on, ends_on);
create unique index enrollments_no_exact_duplicate_uidx
  on public.enrollments (student_id, course_id, starts_on);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lesson_type text not null default 'regular'
    check (
      lesson_type in (
        'regular',
        'makeup',
        'recovery',
        'trial',
        'event',
        'extra'
      )
    ),
  status text not null default 'scheduled'
    check (
      status in (
        'scheduled',
        'completed',
        'cancelled_teacher',
        'cancelled_holiday',
        'cancelled_other'
      )
    ),
  title text,
  location text,
  notes text not null default '',
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lessons_times_valid check (ends_at > starts_at)
);

create index lessons_course_starts_idx on public.lessons (course_id, starts_at);
create index lessons_starts_status_idx on public.lessons (starts_at, status);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'present',
        'absent_excused',
        'absent_unexcused'
      )
    ),
  recorded_at timestamptz,
  recorded_by uuid references public.profiles(id) on delete set null,
  absence_notified_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, student_id)
);

create index attendance_student_id_idx on public.attendance (student_id, lesson_id);
create index attendance_lesson_status_idx on public.attendance (lesson_id, status);

create table public.makeup_credits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  enrollment_id uuid references public.enrollments(id) on delete restrict,
  source_lesson_id uuid not null references public.lessons(id) on delete restrict,
  used_lesson_id uuid references public.lessons(id) on delete restrict,
  status text not null default 'available'
    check (
      status in (
        'available',
        'proposed',
        'scheduled',
        'used',
        'expired',
        'not_eligible',
        'cancelled'
      )
    ),
  reason text not null default '',
  expires_on date,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, source_lesson_id),
  constraint makeup_credit_usage_valid check (
    (status in ('scheduled', 'used') and used_lesson_id is not null)
    or (status not in ('scheduled', 'used'))
  )
);

create index makeup_credits_student_status_idx
  on public.makeup_credits (student_id, status, expires_on);
create index makeup_credits_used_lesson_idx
  on public.makeup_credits (used_lesson_id)
  where used_lesson_id is not null;
create unique index makeup_credits_one_student_per_makeup_uidx
  on public.makeup_credits (student_id, used_lesson_id)
  where used_lesson_id is not null;

create sequence public.invoice_number_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  student_id uuid references public.students(id) on delete restrict,
  number text not null,
  title text not null,
  description text not null default '',
  total_cents integer not null check (total_cents > 0),
  currency text not null default 'EUR'
    check (currency ~ '^[A-Z]{3}$'),
  due_date date not null,
  status text not null default 'pending'
    check (
      status in (
        'draft',
        'pending',
        'processing',
        'partially_paid',
        'overdue',
        'paid',
        'void',
        'refunded'
      )
    ),
  payment_method text
    check (
      payment_method is null
      or payment_method in ('paypal', 'bank_transfer', 'cash', 'other')
    ),
  paid_at timestamptz,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (number)
);

create index invoices_family_status_idx
  on public.invoices (family_id, status, due_date);
create index invoices_student_id_idx on public.invoices (student_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  refunded_cents integer not null default 0
    check (refunded_cents >= 0 and refunded_cents <= amount_cents),
  currency text not null default 'EUR'
    check (currency ~ '^[A-Z]{3}$'),
  method text not null
    check (method in ('paypal', 'bank_transfer', 'cash', 'other')),
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'capturing',
        'completed',
        'failed',
        'cancelled',
        'partially_refunded',
        'refunded'
      )
    ),
  provider text not null default 'manual',
  provider_order_id text,
  provider_capture_id text,
  provider_status text,
  idempotency_key text,
  reference text,
  paid_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_completed_has_paid_at
    check (status <> 'completed' or paid_at is not null),
  unique (provider, idempotency_key)
);

create unique index payments_provider_order_uidx
  on public.payments (provider, provider_order_id)
  where provider_order_id is not null;
create unique index payments_provider_capture_uidx
  on public.payments (provider, provider_capture_id)
  where provider_capture_id is not null;
create unique index payments_one_pending_paypal_invoice_uidx
  on public.payments (invoice_id)
  where provider = 'paypal' and status in ('pending', 'capturing');
create index payments_invoice_status_idx
  on public.payments (invoice_id, status);
create index payments_family_created_idx
  on public.payments (family_id, created_at desc);

create table public.bank_transfer_notices (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  transfer_date date not null,
  reference text,
  proof_path text,
  note text not null default '',
  status text not null default 'submitted'
    check (status in ('submitted', 'verified', 'rejected')),
  submitted_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_notice_review_valid check (
    (status = 'submitted' and reviewed_at is null and reviewed_by is null)
    or (status in ('verified', 'rejected') and reviewed_at is not null)
  )
);

create index bank_transfer_notices_family_idx
  on public.bank_transfer_notices (family_id, status, created_at desc);
create index bank_transfer_notices_invoice_idx
  on public.bank_transfer_notices (invoice_id, status);
create unique index bank_transfer_notices_one_submitted_uidx
  on public.bank_transfer_notices (invoice_id)
  where status = 'submitted';

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  visibility text not null default 'admin'
    check (visibility in ('public', 'authenticated', 'admin')),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_settings_key_format check (key ~ '^[a-z][a-z0-9_]{1,63}$')
);

create or replace function private.classify_app_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.visibility := case
    when new.key in (
      'school_name',
      'school_address',
      'support_email',
      'support_phone',
      'timezone'
    ) then 'public'
    when new.key in (
      'absence_notice_hours',
      'academic_year_start',
      'academic_year_end',
      'academic_year_label',
      'makeup_deadline',
      'monthly_validity_months',
      'paypal_currency',
      'bank_account_holder',
      'bank_iban',
      'bank_bic',
      'bank_reference_template'
    ) then 'authenticated'
    else new.visibility
  end;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create trigger app_settings_classify
before insert or update on public.app_settings
for each row execute function private.classify_app_setting();

create table public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payment_id uuid references public.payments(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index payment_provider_events_payment_idx
  on public.payment_provider_events (payment_id, created_at desc);
create index payment_provider_events_unprocessed_idx
  on public.payment_provider_events (provider, created_at)
  where processed_at is null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  row_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_table_row_idx
  on public.audit_log (table_name, row_id, created_at desc);
create index audit_log_actor_idx
  on public.audit_log (actor_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Funzioni interne e trigger
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.is_active
  );
$$;

create or replace function private.can_access_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_admin())
    or exists (
      select 1
      from public.family_users fu
      join public.profiles p on p.id = fu.user_id
      join public.families f on f.id = fu.family_id
      where fu.family_id = p_family_id
        and fu.user_id = (select auth.uid())
        and p.is_active
        and f.is_active
    );
$$;

create or replace function private.can_access_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_admin())
    or exists (
      select 1
      from public.students s
      join public.family_users fu on fu.family_id = s.family_id
      join public.profiles p on p.id = fu.user_id
      join public.families f on f.id = s.family_id
      where s.id = p_student_id
        and fu.user_id = (select auth.uid())
        and p.is_active
        and f.is_active
    );
$$;

create or replace function private.can_access_invoice(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoices i
    where i.id = p_invoice_id
      and (select private.can_access_family(i.family_id))
  );
$$;

create or replace function private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.syncing_auth_user', 'true', true);
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Utente'
    ),
    'family'
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  perform set_config('app.syncing_auth_user', 'false', true);
  return new;
end;
$$;

drop trigger if exists on_auth_user_changed on auth.users;
create trigger on_auth_user_changed
after insert or update of email on auth.users
for each row execute function private.handle_auth_user();

-- Include anche eventuali utenti Auth creati prima di questa migrazione.
insert into public.profiles (id, email, display_name, role)
select
  u.id,
  u.email,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Utente'
  ),
  'family'
from auth.users u
on conflict (id) do update set email = excluded.email;

create or replace function private.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(
    current_setting('app.syncing_auth_user', true),
    'false'
  ) = 'true' then
    return new;
  end if;

  if (select private.is_admin())
     or session_user in ('postgres', 'supabase_admin')
     or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    return new;
  end if;

  if old.id <> new.id
     or old.role <> new.role
     or old.is_active <> new.is_active
     or old.email is distinct from new.email then
    raise exception 'Non puoi modificare ruolo, stato, email o identificativo'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_sensitive_fields
before update on public.profiles
for each row execute function private.guard_profile_update();

create or replace function private.validate_invoice_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.student_id is not null
     and not exists (
       select 1
       from public.students s
       where s.id = new.student_id
         and s.family_id = new.family_id
     ) then
    raise exception 'L''allievo non appartiene alla famiglia della scadenza'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invoices_validate_student
before insert or update of family_id, student_id on public.invoices
for each row execute function private.validate_invoice_student();

create or replace function private.validate_invoice_ledger_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid_cents bigint;
begin
  if new.status = 'paid' then
    select coalesce(sum(
      case
        when p.status in ('completed', 'partially_refunded', 'refunded')
          then p.amount_cents - p.refunded_cents
        else 0
      end
    ), 0)
    into v_paid_cents
    from public.payments p
    where p.invoice_id = new.id;

    if v_paid_cents < new.total_cents then
      raise exception
        'Una scadenza può risultare pagata solo tramite movimenti contabilizzati'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_validate_ledger_status
before insert or update of status, total_cents on public.invoices
for each row execute function private.validate_invoice_ledger_status();

create or replace function private.validate_payment_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_currency text;
begin
  select i.family_id, i.currency
    into v_family_id, v_currency
  from public.invoices i
  where i.id = new.invoice_id;

  if not found or new.family_id <> v_family_id then
    raise exception 'Pagamento e scadenza appartengono a famiglie diverse'
      using errcode = '23514';
  end if;
  if new.currency <> v_currency then
    raise exception 'La valuta del pagamento non coincide con la scadenza'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payments_validate_family
before insert or update of invoice_id, family_id, currency on public.payments
for each row execute function private.validate_payment_family();

create or replace function private.guard_parallel_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'paypal'
     and new.status in ('pending', 'capturing')
     and exists (
       select 1
       from public.bank_transfer_notices notice
       where notice.invoice_id = new.invoice_id
         and notice.status = 'submitted'
     ) then
    raise exception
      'Esiste già un bonifico da verificare per questa scadenza'
      using errcode = '55000';
  end if;

  if new.status = 'completed'
     and new.method <> 'paypal'
     and exists (
       select 1
       from public.payments active_payment
       where active_payment.invoice_id = new.invoice_id
         and active_payment.provider = 'paypal'
         and active_payment.status in ('pending', 'capturing')
         and active_payment.id <> new.id
     ) then
    raise exception
      'Esiste un checkout PayPal attivo per questa scadenza'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger payments_guard_parallel_settlement
before insert or update of status, method, invoice_id on public.payments
for each row execute function private.guard_parallel_settlement();

create or replace function private.guard_payment_over_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_cents integer;
  v_other_paid_cents bigint;
  v_new_paid_cents bigint;
begin
  select i.total_cents
  into v_total_cents
  from public.invoices i
  where i.id = new.invoice_id
  for update;

  if not found then
    raise exception 'Scadenza del pagamento non trovata'
      using errcode = '23503';
  end if;

  select coalesce(sum(
    case
      when p.status in ('completed', 'partially_refunded', 'refunded')
        then p.amount_cents - p.refunded_cents
      else 0
    end
  ), 0)
  into v_other_paid_cents
  from public.payments p
  where p.invoice_id = new.invoice_id
    and p.id <> new.id;

  v_new_paid_cents := case
    when new.status in ('completed', 'partially_refunded', 'refunded')
      then new.amount_cents - new.refunded_cents
    else 0
  end;

  if v_other_paid_cents + v_new_paid_cents > v_total_cents then
    raise exception
      'Il pagamento supererebbe il saldo residuo della scadenza'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger payments_guard_over_settlement
before insert or update of invoice_id, amount_cents, status, refunded_cents
on public.payments
for each row execute function private.guard_payment_over_settlement();

create or replace function private.prevent_payment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'I movimenti economici non possono essere eliminati: annullarli o rimborsarli'
    using errcode = '23514';
end;
$$;

create trigger payments_prevent_delete
before delete on public.payments
for each row execute function private.prevent_payment_delete();

create or replace function private.validate_bank_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_total_cents integer;
  v_paid_cents bigint;
begin
  select i.family_id, i.total_cents
    into v_family_id, v_total_cents
  from public.invoices i
  where i.id = new.invoice_id
    and i.status not in ('draft', 'void')
  for update;

  if tg_op = 'INSERT' and exists (
    select 1
    from public.payments p
    where p.invoice_id = new.invoice_id
      and p.provider = 'paypal'
      and p.status = 'capturing'
  ) then
    raise exception
      'Attendere la conclusione dell''acquisizione PayPal'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    update public.payments p
    set status = 'cancelled',
        provider_status = 'CANCELLED_FOR_BANK_TRANSFER'
    where p.invoice_id = new.invoice_id
      and p.provider = 'paypal'
      and p.status = 'pending';
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
  where p.invoice_id = new.invoice_id;

  if v_family_id is null
     or new.family_id <> v_family_id
     or new.amount_cents > greatest(v_total_cents - v_paid_cents, 0) then
    raise exception 'Avviso di bonifico non coerente con la scadenza'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.submitted_by is null then
    new.submitted_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger bank_notices_validate
before insert or update of invoice_id, family_id, amount_cents
on public.bank_transfer_notices
for each row execute function private.validate_bank_notice();

create or replace function private.guard_bank_notice_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'verified'
     and old.status is distinct from 'verified'
     and not exists (
       select 1
       from public.payments p
       where p.provider = 'manual'
         and p.idempotency_key = 'bank_notice:' || new.id::text
         and p.status = 'completed'
     ) then
    raise exception 'Verificare il bonifico tramite confirm_bank_transfer'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bank_notices_guard_verification
before update of status on public.bank_transfer_notices
for each row execute function private.guard_bank_notice_verification();

create or replace function private.guard_lesson_reschedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.starts_at is not distinct from new.starts_at
     and old.ends_at is not distinct from new.ends_at
     and old.title is not distinct from new.title
     and old.location is not distinct from new.location
     and old.notes is not distinct from new.notes then
    return new;
  end if;

  if old.status <> 'scheduled' or new.status <> 'scheduled' then
    raise exception 'Solo una lezione programmata può essere ripianificata'
      using errcode = '23514';
  end if;

  if old.lesson_type in ('makeup', 'recovery')
     or new.lesson_type in ('makeup', 'recovery') then
    raise exception 'Le sessioni di recupero non possono essere ripianificate'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.attendance a
    where a.lesson_id = old.id
      and a.status <> 'pending'
  ) then
    raise exception
      'La lezione ha già presenze o assenze registrate'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.makeup_credits mc
    where mc.source_lesson_id = old.id
       or mc.used_lesson_id = old.id
  ) then
    raise exception
      'La lezione è collegata a crediti di recupero'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger lessons_guard_reschedule
before update of starts_at, ends_at, title, location, notes
on public.lessons
for each row execute function private.guard_lesson_reschedule();

create or replace function private.validate_attendance_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_lesson_date date;
  v_lesson_type text;
begin
  select
    l.course_id,
    (l.starts_at at time zone 'Europe/Rome')::date,
    l.lesson_type
  into v_course_id, v_lesson_date, v_lesson_type
  from public.lessons l
  where l.id = new.lesson_id;

  if v_lesson_type in ('makeup', 'recovery') and not exists (
      select 1
      from public.makeup_credits mc
      where mc.student_id = new.student_id
        and mc.used_lesson_id = new.lesson_id
        and mc.status in ('scheduled', 'used')
    ) then
    raise exception 'Il recupero non risulta assegnato all''allievo'
      using errcode = '23514';
  elsif v_lesson_type not in ('makeup', 'recovery') and not exists (
      select 1
      from public.enrollments e
    where e.student_id = new.student_id
      and e.course_id = v_course_id
      and (e.is_active or e.ends_on is not null)
      and e.starts_on <= v_lesson_date
        and (e.ends_on is null or e.ends_on >= v_lesson_date)
    ) then
    raise exception 'L''allievo non risulta iscritto a questa lezione'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attendance_validate_membership
before insert or update of lesson_id, student_id on public.attendance
for each row execute function private.validate_attendance_membership();

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row_id uuid;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row_id := nullif(v_new ->> 'id', '')::uuid;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row_id := nullif(v_new ->> 'id', '')::uuid;
  else
    v_old := to_jsonb(old);
    v_row_id := nullif(v_old ->> 'id', '')::uuid;
  end if;

  insert into public.audit_log (
    actor_user_id,
    action,
    table_name,
    row_id,
    old_data,
    new_data
  )
  values (
    auth.uid(),
    tg_op,
    tg_table_schema || '.' || tg_table_name,
    v_row_id,
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles',
    'families',
    'family_users',
    'students',
    'courses',
    'enrollments',
    'lessons',
    'attendance',
    'makeup_credits',
    'invoices',
    'payments',
    'bank_transfer_notices',
    'app_settings'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function private.set_updated_at()',
      v_table || '_set_updated_at',
      v_table
    );
    execute format(
      'create trigger %I after insert or update or delete on public.%I
       for each row execute function private.audit_row_change()',
      v_table || '_audit',
      v_table
    );
  end loop;
end;
$$;

-- Ricalcola lo stato persistito dopo un movimento. La vista più sotto calcola
-- comunque lo stato "scaduto" in tempo reale.
create or replace function private.refresh_invoice_status(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_paid_cents bigint;
  v_has_refund boolean;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Scadenza non trovata' using errcode = 'P0002';
  end if;

  if v_invoice.status in ('draft', 'void') then
    return v_invoice;
  end if;

  select
    coalesce(sum(
      case
        when p.status in ('completed', 'partially_refunded', 'refunded')
          then p.amount_cents - p.refunded_cents
        else 0
      end
    ), 0),
    coalesce(bool_or(p.refunded_cents > 0), false)
  into v_paid_cents, v_has_refund
  from public.payments p
  where p.invoice_id = p_invoice_id;

  update public.invoices i
  set
    status = case
      when v_paid_cents >= i.total_cents then 'paid'
      when v_paid_cents = 0 and v_has_refund then 'refunded'
      when v_paid_cents > 0 then 'partially_paid'
      when exists (
        select 1
        from public.bank_transfer_notices btn
        where btn.invoice_id = i.id
          and btn.status = 'submitted'
      ) then 'processing'
      when i.due_date < current_date then 'overdue'
      else 'pending'
    end,
    payment_method = case
      when v_paid_cents >= i.total_cents then (
        select p.method
        from public.payments p
        where p.invoice_id = i.id
          and p.status in ('completed', 'partially_refunded')
        order by p.paid_at desc nulls last
        limit 1
      )
      else null
    end,
    paid_at = case
      when v_paid_cents >= i.total_cents then coalesce(
        i.paid_at,
        (
          select max(p.paid_at)
          from public.payments p
          where p.invoice_id = i.id
            and p.status in ('completed', 'partially_refunded')
        )
      )
      else null
    end
  where i.id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

create or replace function private.refresh_invoice_after_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.invoice_id <> new.invoice_id then
    perform private.refresh_invoice_status(old.invoice_id);
  end if;
  perform private.refresh_invoice_status(
    case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end
  );
  return coalesce(new, old);
end;
$$;

create trigger payments_refresh_invoice
after insert or update or delete on public.payments
for each row execute function private.refresh_invoice_after_payment();

create or replace function private.refresh_invoice_after_bank_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.invoice_id <> new.invoice_id then
    perform private.refresh_invoice_status(old.invoice_id);
  end if;
  perform private.refresh_invoice_status(
    case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end
  );
  return coalesce(new, old);
end;
$$;

create trigger bank_notices_refresh_invoice
after insert or update or delete on public.bank_transfer_notices
for each row execute function private.refresh_invoice_after_bank_notice();

-- ---------------------------------------------------------------------------
-- RPC transazionali
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_student_family(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_data jsonb;
  v_student_data jsonb;
  v_enrollment_data jsonb;
  v_family public.families;
  v_student public.students;
  v_current_enrollment public.enrollments;
  v_enrollment public.enrollments;
  v_family_id uuid;
  v_student_id uuid;
  v_course_id uuid;
  v_starts_on date;
  v_plan_type text;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload deve essere un oggetto JSON'
      using errcode = '22023';
  end if;

  v_family_data := coalesce(p_payload -> 'family', '{}'::jsonb);
  v_student_data := coalesce(p_payload -> 'student', '{}'::jsonb);
  v_enrollment_data := coalesce(p_payload -> 'enrollment', '{}'::jsonb);

  begin
    v_family_id := nullif(
      coalesce(p_payload ->> 'family_id', v_family_data ->> 'id'),
      ''
    )::uuid;
    v_student_id := nullif(
      coalesce(
        p_payload ->> 'student_id',
        p_payload ->> 'id',
        v_student_data ->> 'id'
      ),
      ''
    )::uuid;
    v_course_id := nullif(
      coalesce(
        v_enrollment_data ->> 'course_id',
        p_payload ->> 'course_id'
      ),
      ''
    )::uuid;
  exception when invalid_text_representation then
    raise exception 'Identificativo UUID non valido' using errcode = '22023';
  end;

  if v_student_id is not null then
    select * into v_student
    from public.students
    where id = v_student_id
    for update;
    if not found then
      raise exception 'Allievo non trovato' using errcode = 'P0002';
    end if;
    if v_family_id is null then
      v_family_id := v_student.family_id;
    elsif v_family_id <> v_student.family_id then
      raise exception
        'Lo spostamento di un allievo tra famiglie richiede una procedura dedicata'
        using errcode = '23514';
    end if;
  end if;

  if v_family_id is null then
    insert into public.families (
      display_name,
      guardian_name,
      email,
      phone,
      notes
    )
    values (
      coalesce(
        nullif(btrim(v_family_data ->> 'display_name'), ''),
        nullif(btrim(p_payload ->> 'family_display_name'), ''),
        nullif(btrim(p_payload ->> 'display_name'), ''),
        'Famiglia ' || coalesce(
          nullif(btrim(v_student_data ->> 'last_name'), ''),
          nullif(btrim(p_payload ->> 'last_name'), ''),
          nullif(btrim(v_family_data ->> 'guardian_name'), ''),
          nullif(btrim(p_payload ->> 'guardian_name'), ''),
          'da completare'
        )
      ),
      coalesce(
        nullif(btrim(v_family_data ->> 'guardian_name'), ''),
        nullif(btrim(p_payload ->> 'guardian_name'), ''),
        'Da completare'
      ),
      coalesce(
        nullif(lower(btrim(v_family_data ->> 'email')), ''),
        nullif(lower(btrim(p_payload ->> 'email')), ''),
        'da-completare-' || gen_random_uuid()::text || '@invalid.local'
      ),
      coalesce(
        nullif(btrim(v_family_data ->> 'phone'), ''),
        nullif(btrim(p_payload ->> 'phone'), '')
      ),
      coalesce(v_family_data ->> 'notes', '')
    )
    returning * into v_family;
    v_family_id := v_family.id;
  else
    select * into v_family
    from public.families
    where id = v_family_id
    for update;
    if not found then
      raise exception 'Famiglia non trovata' using errcode = 'P0002';
    end if;

    update public.families
    set display_name = coalesce(
          nullif(btrim(v_family_data ->> 'display_name'), ''),
          nullif(btrim(p_payload ->> 'family_display_name'), ''),
          nullif(btrim(p_payload ->> 'display_name'), ''),
          display_name
        ),
        guardian_name = coalesce(
          nullif(btrim(v_family_data ->> 'guardian_name'), ''),
          nullif(btrim(p_payload ->> 'guardian_name'), ''),
          guardian_name
        ),
        email = coalesce(
          nullif(lower(btrim(v_family_data ->> 'email')), ''),
          nullif(lower(btrim(p_payload ->> 'email')), ''),
          email
        ),
        phone = coalesce(
          nullif(btrim(v_family_data ->> 'phone'), ''),
          nullif(btrim(p_payload ->> 'phone'), ''),
          phone
        ),
        notes = coalesce(v_family_data ->> 'notes', notes)
    where id = v_family_id
    returning * into v_family;
  end if;

  if v_student_id is null then
    insert into public.students (
      family_id,
      first_name,
      last_name,
      birth_date,
      notes,
      is_active
    )
    values (
      v_family_id,
      coalesce(
        nullif(v_student_data ->> 'first_name', ''),
        nullif(p_payload ->> 'first_name', '')
      ),
      coalesce(
        nullif(v_student_data ->> 'last_name', ''),
        nullif(p_payload ->> 'last_name', '')
      ),
      nullif(
        coalesce(v_student_data ->> 'birth_date', p_payload ->> 'birth_date'),
        ''
      )::date,
      coalesce(
        v_student_data ->> 'notes',
        p_payload ->> 'notes',
        ''
      ),
      coalesce(
        nullif(v_student_data ->> 'is_active', '')::boolean,
        nullif(p_payload ->> 'is_active', '')::boolean,
        true
      )
    )
    returning * into v_student;
    v_student_id := v_student.id;
  else
    update public.students
    set first_name = coalesce(
          nullif(v_student_data ->> 'first_name', ''),
          nullif(p_payload ->> 'first_name', ''),
          first_name
        ),
        last_name = coalesce(
          nullif(v_student_data ->> 'last_name', ''),
          nullif(p_payload ->> 'last_name', ''),
          last_name
        ),
        birth_date = coalesce(
          nullif(v_student_data ->> 'birth_date', '')::date,
          nullif(p_payload ->> 'birth_date', '')::date,
          birth_date
        ),
        notes = coalesce(
          v_student_data ->> 'notes',
          p_payload ->> 'notes',
          notes
        ),
        is_active = coalesce(
          nullif(v_student_data ->> 'is_active', '')::boolean,
          nullif(p_payload ->> 'is_active', '')::boolean,
          is_active
        )
    where id = v_student_id
    returning * into v_student;
  end if;

  select * into v_current_enrollment
  from public.enrollments e
  where e.student_id = v_student_id
    and e.is_active
  order by e.starts_on desc, e.created_at desc
  limit 1
  for update;

  if v_course_id is not null then
    if not exists (
      select 1
      from public.courses c
      where c.id = v_course_id
        and c.is_active
    ) then
      raise exception 'Corso non trovato o inattivo' using errcode = '23514';
    end if;

    v_starts_on := coalesce(
      nullif(v_enrollment_data ->> 'starts_on', '')::date,
      nullif(p_payload ->> 'starts_on', '')::date,
      case
        when v_current_enrollment.course_id = v_course_id
          then v_current_enrollment.starts_on
        else null
      end,
      current_date
    );
    v_plan_type := coalesce(
      nullif(v_enrollment_data ->> 'plan_type', ''),
      nullif(p_payload ->> 'plan_type', ''),
      'monthly'
    );

    if v_current_enrollment.id is null
       or v_current_enrollment.course_id <> v_course_id then
      update public.enrollments e
      set is_active = false,
          ends_on = case
            when e.starts_on < v_starts_on
              then least(coalesce(e.ends_on, v_starts_on - 1), v_starts_on - 1)
            else e.starts_on
          end
      where e.student_id = v_student_id
        and e.is_active;

      insert into public.enrollments (
        student_id,
        course_id,
        plan_type,
        starts_on,
        ends_on,
        recovery_allowed,
        recovery_notice_hours,
        is_active,
        notes
      )
      values (
        v_student_id,
        v_course_id,
        v_plan_type,
        v_starts_on,
        nullif(
          coalesce(
            v_enrollment_data ->> 'ends_on',
            p_payload ->> 'ends_on'
          ),
          ''
        )::date,
        nullif(
          coalesce(
            v_enrollment_data ->> 'recovery_allowed',
            p_payload ->> 'recovery_allowed'
          ),
          ''
        )::boolean,
        nullif(
          coalesce(
            v_enrollment_data ->> 'recovery_notice_hours',
            p_payload ->> 'recovery_notice_hours'
          ),
          ''
        )::integer,
        true,
        coalesce(v_enrollment_data ->> 'notes', '')
      )
      returning * into v_enrollment;
    else
      update public.enrollments
      set plan_type = v_plan_type,
          starts_on = v_starts_on,
          ends_on = coalesce(
            nullif(v_enrollment_data ->> 'ends_on', '')::date,
            nullif(p_payload ->> 'ends_on', '')::date,
            ends_on
          ),
          recovery_allowed = coalesce(
            nullif(v_enrollment_data ->> 'recovery_allowed', '')::boolean,
            nullif(p_payload ->> 'recovery_allowed', '')::boolean,
            recovery_allowed
          ),
          recovery_notice_hours = coalesce(
            nullif(
              v_enrollment_data ->> 'recovery_notice_hours',
              ''
            )::integer,
            nullif(p_payload ->> 'recovery_notice_hours', '')::integer,
            recovery_notice_hours
          ),
          notes = coalesce(v_enrollment_data ->> 'notes', notes),
          is_active = true
      where id = v_current_enrollment.id
      returning * into v_enrollment;
    end if;
  else
    v_enrollment := v_current_enrollment;
  end if;

  return jsonb_build_object(
    'family', to_jsonb(v_family),
    'student', to_jsonb(v_student),
    'enrollment', case
      when v_enrollment.id is null then null
      else to_jsonb(v_enrollment)
    end
  );
exception
  when not_null_violation or check_violation or invalid_datetime_format then
    raise exception 'Dati famiglia, allievo o iscrizione non validi: %', sqlerrm
      using errcode = '22023';
end;
$$;

create or replace function public.reschedule_lesson(
  p_lesson_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text,
  p_location text,
  p_notes text
)
returns public.lessons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  if p_starts_at is null
     or p_ends_at is null
     or p_ends_at <= p_starts_at then
    raise exception 'Intervallo della lezione non valido'
      using errcode = '22023';
  end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id
  for update;

  if not found then
    raise exception 'Lezione non trovata' using errcode = 'P0002';
  end if;

  if v_lesson.status <> 'scheduled' then
    raise exception 'Solo una lezione programmata può essere ripianificata'
      using errcode = '23514';
  end if;

  if v_lesson.lesson_type in ('makeup', 'recovery') then
    raise exception 'Le sessioni di recupero non possono essere ripianificate'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.attendance a
    where a.lesson_id = p_lesson_id
      and a.status <> 'pending'
  ) then
    raise exception
      'La lezione ha già presenze o assenze registrate'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.makeup_credits mc
    where mc.source_lesson_id = p_lesson_id
       or mc.used_lesson_id = p_lesson_id
  ) then
    raise exception
      'La lezione è collegata a crediti di recupero'
      using errcode = '23514';
  end if;

  update public.lessons
  set starts_at = p_starts_at,
      ends_at = p_ends_at,
      title = p_title,
      location = coalesce(p_location, ''),
      notes = coalesce(p_notes, '')
  where id = p_lesson_id
  returning * into v_lesson;

  return v_lesson;
end;
$$;

create or replace function public.mark_attendance_batch(
  p_lesson_id uuid,
  p_entries jsonb
)
returns setof public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_student_id uuid;
  v_status text;
  v_notified_at timestamptz;
  v_lesson public.lessons;
  v_enrollment public.enrollments;
  v_notice_hours integer;
  v_recovery_allowed boolean;
  v_reason text;
  v_makeup_deadline date;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries deve essere un array JSON'
      using errcode = '22023';
  end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id
  for update;
  if not found then
    raise exception 'Lezione non trovata' using errcode = 'P0002';
  end if;

  select nullif(s.value #>> '{}', '')::date
  into v_makeup_deadline
  from public.app_settings s
  where s.key = 'makeup_deadline';

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    begin
      v_student_id := (v_entry ->> 'student_id')::uuid;
    exception when others then
      raise exception 'student_id non valido' using errcode = '22023';
    end;

    v_status := coalesce(v_entry ->> 'status', 'pending');
    if v_status not in (
      'pending',
      'present',
      'absent_excused',
      'absent_unexcused'
    ) then
      raise exception 'Stato presenza non valido: %', v_status
        using errcode = '22023';
    end if;

    v_notified_at := nullif(v_entry ->> 'absence_notified_at', '')::timestamptz;

    insert into public.attendance (
      lesson_id,
      student_id,
      status,
      recorded_at,
      recorded_by,
      absence_notified_at,
      notes
    )
    values (
      p_lesson_id,
      v_student_id,
      v_status,
      case when v_status = 'pending' then null else now() end,
      auth.uid(),
      v_notified_at,
      coalesce(v_entry ->> 'notes', '')
    )
    on conflict (lesson_id, student_id) do update
      set status = excluded.status,
          recorded_at = excluded.recorded_at,
          recorded_by = excluded.recorded_by,
          absence_notified_at = excluded.absence_notified_at,
          notes = excluded.notes;

    select e.* into v_enrollment
    from public.enrollments e
    where e.student_id = v_student_id
      and e.course_id = v_lesson.course_id
      and e.is_active
      and e.starts_on <= (v_lesson.starts_at at time zone 'Europe/Rome')::date
      and (
        e.ends_on is null
        or e.ends_on >= (v_lesson.starts_at at time zone 'Europe/Rome')::date
      )
    order by e.starts_on desc
    limit 1;

    if v_lesson.lesson_type in ('makeup', 'recovery') then
      if v_status = 'pending' and exists (
        select 1
        from public.makeup_credits mc
        where mc.student_id = v_student_id
          and mc.used_lesson_id = p_lesson_id
          and mc.status = 'used'
      ) then
        raise exception
          'Un recupero già contabilizzato non può tornare in attesa'
          using errcode = '23514';
      elsif v_status <> 'pending' then
        update public.makeup_credits
        set status = 'used',
            used_at = coalesce(used_at, now()),
            reason = case
              when status = 'scheduled'
                and v_status in ('absent_excused', 'absent_unexcused')
                then concat_ws(
                  ' | ',
                  nullif(reason, ''),
                  'Credito consumato per assenza al recupero'
                )
              else reason
            end
        where student_id = v_student_id
          and used_lesson_id = p_lesson_id
          and status in ('scheduled', 'used');
      end if;

      continue;
    end if;

    if v_status in ('present', 'pending') then
      if exists (
        select 1
        from public.makeup_credits mc
        where mc.student_id = v_student_id
          and mc.source_lesson_id = p_lesson_id
          and mc.status in ('scheduled', 'used')
      ) then
        raise exception
          'Impossibile annullare l''assenza: il recupero è già assegnato o usato'
          using errcode = '23514';
      end if;

      update public.makeup_credits
      set status = 'cancelled',
          reason = 'Presenza aggiornata dall''amministratore'
      where student_id = v_student_id
        and source_lesson_id = p_lesson_id
        and status in ('available', 'not_eligible');

      if v_status = 'present' then
        update public.makeup_credits
        set status = 'used',
            used_at = coalesce(used_at, now())
        where student_id = v_student_id
          and used_lesson_id = p_lesson_id
          and status = 'scheduled';
      end if;

    elsif v_status in ('absent_excused', 'absent_unexcused') then
      v_notice_hours := coalesce(
        v_enrollment.recovery_notice_hours,
        (
          select (s.value #>> '{}')::integer
          from public.app_settings s
          where s.key = 'absence_notice_hours'
        ),
        24
      );
      v_recovery_allowed := coalesce(
        v_enrollment.recovery_allowed,
        v_enrollment.plan_type in ('semester', 'annual')
      );

      if v_status = 'absent_unexcused' then
        v_recovery_allowed := false;
        v_reason := 'Assenza non giustificata';
      elsif not coalesce(v_recovery_allowed, false) then
        v_reason := 'Il piano non prevede recuperi';
      elsif v_notified_at is null then
        v_recovery_allowed := false;
        v_reason := 'Preavviso di assenza non registrato';
      elsif v_notified_at > v_lesson.starts_at - make_interval(hours => v_notice_hours) then
        v_recovery_allowed := false;
        v_reason := format('Preavviso inferiore a %s ore', v_notice_hours);
      else
        v_reason := 'Assenza comunicata nei termini';
      end if;

      insert into public.makeup_credits as existing_credit (
        student_id,
        enrollment_id,
        source_lesson_id,
        status,
        reason,
        expires_on
      )
      values (
        v_student_id,
        v_enrollment.id,
        p_lesson_id,
        case when coalesce(v_recovery_allowed, false)
          then 'available'
          else 'not_eligible'
        end,
        v_reason,
        case when coalesce(v_recovery_allowed, false)
          then least(
            v_enrollment.ends_on,
            v_makeup_deadline,
            current_date + 180
          )
          else null
        end
      )
      on conflict (student_id, source_lesson_id) do update
        set enrollment_id = excluded.enrollment_id,
            status = case
              when existing_credit.status in ('scheduled', 'used')
                then existing_credit.status
              else excluded.status
            end,
            reason = case
              when existing_credit.status in ('scheduled', 'used')
                then existing_credit.reason
              else excluded.reason
            end,
            expires_on = case
              when existing_credit.status in ('scheduled', 'used')
                then existing_credit.expires_on
              else excluded.expires_on
            end;
    end if;
  end loop;

  return query
  select a.*
  from public.attendance a
  where a.lesson_id = p_lesson_id
  order by a.created_at;
end;
$$;

create or replace function public.assign_makeup_credit(
  p_credit_id uuid,
  p_lesson_id uuid
)
returns public.makeup_credits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credit public.makeup_credits;
  v_source_course uuid;
  v_target public.lessons;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  select * into v_credit
  from public.makeup_credits
  where id = p_credit_id
  for update;

  if not found or v_credit.status <> 'available' then
    raise exception 'Credito non disponibile' using errcode = '23514';
  end if;
  if v_credit.expires_on is not null and v_credit.expires_on < current_date then
    update public.makeup_credits
      set status = 'expired'
      where id = p_credit_id
      returning * into v_credit;
    return v_credit;
  end if;

  select l.course_id into v_source_course
  from public.lessons l
  where l.id = v_credit.source_lesson_id;

  select * into v_target
  from public.lessons
  where id = p_lesson_id
  for update;

  if not found
     or v_target.status <> 'scheduled'
     or v_target.lesson_type not in ('makeup', 'recovery')
     or v_target.course_id <> v_source_course
     or v_target.starts_at <= now()
     or (
       v_credit.expires_on is not null
       and (v_target.starts_at at time zone 'Europe/Rome')::date >
         v_credit.expires_on
     )
     or p_lesson_id = v_credit.source_lesson_id then
    raise exception 'Lezione di recupero non compatibile'
      using errcode = '23514';
  end if;

  update public.makeup_credits
  set used_lesson_id = p_lesson_id,
      status = 'scheduled'
  where id = p_credit_id
  returning * into v_credit;

  return v_credit;
end;
$$;

create or replace function public.update_lesson_status(
  p_lesson_id uuid,
  p_status text,
  p_cancellation_reason text default null
)
returns public.lessons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson public.lessons;
  v_reason text;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  if p_status not in (
    'scheduled',
    'completed',
    'cancelled_teacher',
    'cancelled_holiday',
    'cancelled_other'
  ) then
    raise exception 'Stato lezione non valido: %', coalesce(p_status, '(null)')
      using errcode = '22023';
  end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id
  for update;

  if not found then
    raise exception 'Lezione non trovata' using errcode = 'P0002';
  end if;

  if p_status = 'completed'
     and v_lesson.lesson_type in ('makeup', 'recovery') then
    if not exists (
      select 1
      from public.makeup_credits mc
      where mc.used_lesson_id = p_lesson_id
        and mc.status in ('scheduled', 'used')
    ) then
      raise exception
        'Un recupero senza allievi assegnati non può essere completato'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.makeup_credits mc
      where mc.used_lesson_id = p_lesson_id
        and mc.status in ('scheduled', 'used')
        and not exists (
          select 1
          from public.attendance a
          where a.lesson_id = p_lesson_id
            and a.student_id = mc.student_id
            and a.status in (
              'present',
              'absent_excused',
              'absent_unexcused'
            )
        )
    ) then
      raise exception
        'Registrare presenza o assenza per tutti gli allievi assegnati'
        using errcode = '23514';
    end if;
  end if;

  if p_status like 'cancelled_%' then
    v_reason := coalesce(
      nullif(btrim(p_cancellation_reason), ''),
      case p_status
        when 'cancelled_teacher' then 'Lezione annullata dall''insegnante'
        when 'cancelled_holiday' then 'Lezione annullata per festività'
        else 'Lezione annullata'
      end
    );

    if v_lesson.lesson_type in ('makeup', 'recovery') then
      update public.makeup_credits
      set status = case
            when expires_on is not null and expires_on < current_date
              then 'expired'
            else 'available'
          end,
          used_lesson_id = null,
          used_at = null,
          reason = concat_ws(
            ' · ',
            nullif(reason, ''),
            'Recupero assegnato annullato: ' || v_reason
          )
      where used_lesson_id = p_lesson_id
        and status = 'scheduled';
    end if;

    if v_lesson.lesson_type = 'regular' then
      update public.makeup_credits
      set status = 'cancelled',
          used_lesson_id = null,
          used_at = null,
          reason = concat_ws(
            ' · ',
            nullif(reason, ''),
            'Lezione di origine annullata: ' || v_reason
          )
      where source_lesson_id = p_lesson_id
        and status not in ('used', 'cancelled');
    end if;
  else
    v_reason := null;
  end if;

  update public.lessons
  set status = p_status,
      cancellation_reason = v_reason
  where id = p_lesson_id
  returning * into v_lesson;

  return v_lesson;
end;
$$;

create or replace function public.confirm_bank_transfer(
  p_notice_id uuid,
  p_review_note text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice public.bank_transfer_notices;
  v_invoice public.invoices;
  v_payment public.payments;
  v_paid_cents bigint;
  v_outstanding_cents integer;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  select * into v_notice
  from public.bank_transfer_notices
  where id = p_notice_id
  for update;

  if not found then
    raise exception 'Avviso di bonifico non trovato' using errcode = 'P0002';
  end if;

  if v_notice.status = 'verified' then
    select * into v_payment
    from public.payments
    where provider = 'manual'
      and idempotency_key = 'bank_notice:' || p_notice_id::text;
    return v_payment;
  end if;
  if v_notice.status <> 'submitted' then
    raise exception 'Avviso non verificabile nello stato corrente'
      using errcode = '23514';
  end if;

  select * into v_invoice
  from public.invoices
  where id = v_notice.invoice_id
  for update;

  if not found or v_invoice.status in ('draft', 'void') then
    raise exception 'Scadenza non pagabile nello stato corrente'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.payments p
    where p.invoice_id = v_invoice.id
      and p.provider = 'paypal'
      and p.status in ('pending', 'capturing')
  ) then
    raise exception
      'È in corso un checkout PayPal: annullarlo o completarlo prima'
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
  where p.invoice_id = v_invoice.id;

  v_outstanding_cents := greatest(
    v_invoice.total_cents - v_paid_cents,
    0
  )::integer;

  if v_notice.amount_cents > v_outstanding_cents then
    raise exception
      'Il bonifico segnalato supera il saldo residuo (% centesimi)',
      v_outstanding_cents
      using errcode = '23514';
  end if;

  insert into public.payments (
    invoice_id,
    family_id,
    amount_cents,
    currency,
    method,
    status,
    provider,
    idempotency_key,
    reference,
    paid_at,
    created_by
  )
  values (
    v_notice.invoice_id,
    v_notice.family_id,
    v_notice.amount_cents,
    v_invoice.currency,
    'bank_transfer',
    'completed',
    'manual',
    'bank_notice:' || p_notice_id::text,
    v_notice.reference,
    coalesce(v_notice.transfer_date::timestamptz, now()),
    auth.uid()
  )
  on conflict (provider, idempotency_key) do update
    set updated_at = now()
  returning * into v_payment;

  update public.bank_transfer_notices
  set status = 'verified',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = p_review_note
  where id = p_notice_id;

  perform private.refresh_invoice_status(v_notice.invoice_id);
  return v_payment;
end;
$$;

create or replace function public.admin_mark_invoice_paid(
  p_invoice_id uuid,
  p_method text default 'bank_transfer'
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
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if p_method not in ('bank_transfer', 'cash', 'other') then
    raise exception 'Metodo manuale non valido' using errcode = '22023';
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
    now(),
    auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

create or replace function public.reject_bank_transfer(
  p_notice_id uuid,
  p_review_note text
)
returns public.bank_transfer_notices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice public.bank_transfer_notices;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_review_note), '') is null then
    raise exception 'Indicare il motivo del rifiuto' using errcode = '22023';
  end if;

  update public.bank_transfer_notices
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = p_review_note
  where id = p_notice_id
    and status = 'submitted'
  returning * into v_notice;

  if not found then
    raise exception 'Avviso non trovato o già esaminato' using errcode = 'P0002';
  end if;
  return v_notice;
end;
$$;

create or replace function public.refresh_overdue_invoices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  update public.invoices i
  set status = 'overdue'
  where i.status = 'pending'
    and i.due_date < current_date
    and not exists (
      select 1
      from public.payments p
      where p.invoice_id = i.id
        and p.status in ('completed', 'partially_refunded')
      group by p.invoice_id
      having sum(p.amount_cents - p.refunded_cents) >= i.total_cents
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Usata solo dalle Edge Functions con service_role.
create or replace function public.begin_paypal_capture(
  p_order_id text,
  p_stale_after_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_invoice public.invoices;
  v_invoice_id uuid;
  v_paid_cents bigint;
  v_outstanding_cents integer;
begin
  if p_stale_after_seconds not between 30 and 900 then
    raise exception 'Intervallo stale non valido' using errcode = '22023';
  end if;

  select p.invoice_id into v_invoice_id
  from public.payments p
  where p.provider = 'paypal'
    and p.provider_order_id = p_order_id;
  if not found then
    raise exception 'Ordine PayPal non registrato' using errcode = 'P0002';
  end if;

  select * into v_invoice
  from public.invoices
  where id = v_invoice_id
  for update;

  select * into v_payment
  from public.payments
  where provider = 'paypal'
    and provider_order_id = p_order_id
  for update;

  if v_payment.status = 'completed' then
    return jsonb_build_object(
      'acquired', false,
      'reason', 'already_completed',
      'payment', to_jsonb(v_payment)
    );
  end if;

  if v_payment.status = 'capturing'
     and v_payment.updated_at >
       now() - make_interval(secs => p_stale_after_seconds) then
    return jsonb_build_object(
      'acquired', false,
      'reason', 'capture_in_progress',
      'payment', to_jsonb(v_payment)
    );
  end if;

  if v_payment.status not in ('pending', 'capturing') then
    return jsonb_build_object(
      'acquired', false,
      'reason', 'invalid_state',
      'payment', to_jsonb(v_payment)
    );
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
  where p.invoice_id = v_invoice.id
    and p.id <> v_payment.id;

  v_outstanding_cents := greatest(
    v_invoice.total_cents - v_paid_cents,
    0
  )::integer;

  if v_outstanding_cents <> v_payment.amount_cents then
    update public.payments
    set status = 'cancelled',
        provider_status = 'AMOUNT_CHANGED'
    where id = v_payment.id
    returning * into v_payment;

    return jsonb_build_object(
      'acquired', false,
      'reason', 'amount_changed',
      'payment', to_jsonb(v_payment)
    );
  end if;

  update public.payments
  set status = 'capturing',
      provider_status = 'CAPTURING'
  where id = v_payment.id
  returning * into v_payment;

  return jsonb_build_object(
    'acquired', true,
    'reason', 'acquired',
    'payment', to_jsonb(v_payment)
  );
end;
$$;

create or replace function public.release_paypal_capture(
  p_order_id text,
  p_provider_status text default 'RETRYABLE_ERROR'
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  update public.payments
  set status = 'pending',
      provider_status = left(coalesce(p_provider_status, 'RETRYABLE_ERROR'), 100)
  where provider = 'paypal'
    and provider_order_id = p_order_id
    and status = 'capturing'
  returning * into v_payment;

  if not found then
    select * into v_payment
    from public.payments
    where provider = 'paypal'
      and provider_order_id = p_order_id;
  end if;
  return v_payment;
end;
$$;

create or replace function public.record_paypal_capture(
  p_order_id text,
  p_capture_id text,
  p_capture_status text,
  p_amount_cents integer,
  p_currency text,
  p_payload jsonb
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_invoice public.invoices;
  v_invoice_id uuid;
  v_paid_cents bigint;
  v_status text;
begin
  select p.invoice_id into v_invoice_id
  from public.payments p
  where p.provider = 'paypal'
    and p.provider_order_id = p_order_id;
  if not found then
    raise exception 'Ordine PayPal non registrato' using errcode = 'P0002';
  end if;

  select * into v_invoice
  from public.invoices
  where id = v_invoice_id
  for update;

  select * into v_payment
  from public.payments
  where provider = 'paypal'
    and provider_order_id = p_order_id
  for update;

  if v_payment.amount_cents <> p_amount_cents
     or v_payment.currency <> upper(p_currency) then
    raise exception 'Importo o valuta PayPal non coerenti'
      using errcode = '23514';
  end if;
  if v_payment.provider_capture_id is not null
     and v_payment.provider_capture_id <> p_capture_id then
    raise exception 'Ordine associato a una cattura differente'
      using errcode = '23505';
  end if;

  v_status := case upper(p_capture_status)
    when 'COMPLETED' then 'completed'
    when 'PENDING' then 'pending'
    when 'DECLINED' then 'failed'
    when 'DENIED' then 'failed'
    else 'pending'
  end;

  if v_status = 'completed' then
    if v_payment.status not in ('pending', 'capturing', 'completed') then
      raise exception 'Checkout PayPal non più acquisibile'
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
    where p.invoice_id = v_invoice.id
      and p.id <> v_payment.id;

    if v_paid_cents + v_payment.amount_cents > v_invoice.total_cents then
      raise exception 'La cattura PayPal supererebbe il saldo della scadenza'
        using errcode = '23514';
    end if;
  end if;

  update public.payments
  set provider_capture_id = p_capture_id,
      provider_status = upper(p_capture_status),
      status = v_status,
      paid_at = case
        when v_status = 'completed' then coalesce(paid_at, now())
        else paid_at
      end
  where id = v_payment.id
  returning * into v_payment;

  insert into public.payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    payment_id,
    payload,
    processed_at
  )
  values (
    'paypal',
    'capture-api:' || p_capture_id,
    'PAYMENT.CAPTURE.' || upper(p_capture_status),
    v_payment.id,
    coalesce(p_payload, '{}'::jsonb),
    now()
  )
  on conflict (provider, provider_event_id) do nothing;

  perform private.refresh_invoice_status(v_payment.invoice_id);
  return v_payment;
end;
$$;

-- Usata solo dal webhook verificato, con service_role. L'inserimento dell'evento
-- e l'aggiornamento economico avvengono nella stessa transazione.
create or replace function public.process_paypal_webhook(
  p_event_id text,
  p_event_type text,
  p_resource jsonb,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_invoice public.invoices;
  v_event_row_id uuid;
  v_order_id text;
  v_capture_id text;
  v_capture_cents integer;
  v_refund_cents integer;
  v_paid_cents bigint;
  v_currency text;
  v_payment_found boolean;
begin
  insert into public.payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    payload
  )
  values (
    'paypal',
    p_event_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_row_id;

  if v_event_row_id is null then
    return false;
  end if;

  v_order_id := coalesce(
    p_resource #>> '{supplementary_data,related_ids,order_id}',
    p_resource #>> '{supplementary_data,related_ids,authorization_id}'
  );
  v_capture_id := coalesce(
    p_resource #>> '{supplementary_data,related_ids,capture_id}',
    case
      when p_event_type like 'PAYMENT.CAPTURE.%' then p_resource ->> 'id'
      else null
    end
  );

  select * into v_payment
  from public.payments p
  where p.provider = 'paypal'
    and (
      (v_order_id is not null and p.provider_order_id = v_order_id)
      or (v_capture_id is not null and p.provider_capture_id = v_capture_id)
    )
  order by
    case when p.provider_capture_id = v_capture_id then 0 else 1 end
  limit 1
  ;
  v_payment_found := found;

  if p_event_type in (
    'PAYMENT.CAPTURE.COMPLETED',
    'PAYMENT.CAPTURE.PENDING',
    'PAYMENT.CAPTURE.DECLINED',
    'PAYMENT.CAPTURE.DENIED',
    'PAYMENT.CAPTURE.REFUNDED',
    'PAYMENT.CAPTURE.REVERSED'
  ) and not v_payment_found then
    -- Il rollback conserva la possibilità che PayPal ritenti l'evento.
    raise exception 'Pagamento PayPal collegato all''evento non trovato'
      using errcode = 'P0002';
  end if;

  if v_payment_found then
    select * into v_invoice
    from public.invoices
    where id = v_payment.invoice_id
    for update;

    select * into v_payment
    from public.payments
    where id = v_payment.id
    for update;

    if p_event_type = 'PAYMENT.CAPTURE.COMPLETED' then
      if v_payment.status not in ('pending', 'capturing', 'completed') then
        raise exception 'Checkout PayPal non più acquisibile'
          using errcode = '55000';
      end if;

      v_currency := upper(p_resource #>> '{amount,currency_code}');
      v_capture_cents := round(
        ((p_resource #>> '{amount,value}')::numeric) * 100
      )::integer;
      if v_currency is distinct from v_payment.currency
         or v_capture_cents <> v_payment.amount_cents then
        raise exception 'Importo o valuta della cattura non coerenti'
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
      where p.invoice_id = v_invoice.id
        and p.id <> v_payment.id;

      if v_paid_cents + v_payment.amount_cents > v_invoice.total_cents then
        raise exception 'La cattura PayPal supererebbe il saldo della scadenza'
          using errcode = '23514';
      end if;

      update public.payments
      set provider_capture_id = coalesce(provider_capture_id, p_resource ->> 'id'),
          provider_status = 'COMPLETED',
          status = 'completed',
          paid_at = coalesce(
            paid_at,
            nullif(p_resource ->> 'create_time', '')::timestamptz,
            now()
          )
      where id = v_payment.id
      returning * into v_payment;

    elsif p_event_type = 'PAYMENT.CAPTURE.PENDING' then
      update public.payments
      set provider_capture_id = coalesce(provider_capture_id, p_resource ->> 'id'),
          provider_status = 'PENDING',
          status = 'pending'
      where id = v_payment.id
      returning * into v_payment;

    elsif p_event_type in (
      'PAYMENT.CAPTURE.DECLINED',
      'PAYMENT.CAPTURE.DENIED'
    ) then
      update public.payments
      set provider_capture_id = coalesce(provider_capture_id, p_resource ->> 'id'),
          provider_status = split_part(p_event_type, '.', 3),
          status = 'failed'
      where id = v_payment.id
      returning * into v_payment;

    elsif p_event_type = 'PAYMENT.CAPTURE.REFUNDED' then
      v_currency := upper(p_resource #>> '{amount,currency_code}');
      if v_currency is distinct from v_payment.currency then
        raise exception 'Valuta del rimborso non coerente'
          using errcode = '23514';
      end if;
      v_refund_cents := round(
        ((p_resource #>> '{amount,value}')::numeric) * 100
      )::integer;

      update public.payments
      set refunded_cents = least(amount_cents, refunded_cents + v_refund_cents),
          provider_status = 'REFUNDED',
          status = case
            when refunded_cents + v_refund_cents >= amount_cents then 'refunded'
            else 'partially_refunded'
          end
      where id = v_payment.id
      returning * into v_payment;

    elsif p_event_type = 'PAYMENT.CAPTURE.REVERSED' then
      update public.payments
      set refunded_cents = amount_cents,
          provider_status = 'REVERSED',
          status = 'refunded'
      where id = v_payment.id
      returning * into v_payment;
    end if;

    update public.payment_provider_events
    set payment_id = v_payment.id,
        processed_at = now()
    where id = v_event_row_id;

    perform private.refresh_invoice_status(v_payment.invoice_id);
  else
    update public.payment_provider_events
    set processed_at = now()
    where id = v_event_row_id;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Viste con i permessi dell'utente chiamante (non aggirano RLS)
-- ---------------------------------------------------------------------------

create view public.invoice_summaries
with (security_invoker = true)
as
select
  i.*,
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
  end as effective_status
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

create view public.student_attendance_summary
with (security_invoker = true)
as
select
  s.id as student_id,
  s.family_id,
  count(a.id) filter (where a.status = 'present')::integer as presences,
  count(a.id) filter (where a.status = 'absent_excused')::integer
    as excused_absences,
  count(a.id) filter (where a.status = 'absent_unexcused')::integer
    as unexcused_absences,
  count(a.id) filter (
    where a.status in ('absent_excused', 'absent_unexcused')
  )::integer as absences
from public.students s
left join public.attendance a on a.student_id = s.id
group by s.id, s.family_id;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_users enable row level security;
alter table public.students enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.lessons enable row level security;
alter table public.attendance enable row level security;
alter table public.makeup_credits enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.bank_transfer_notices enable row level security;
alter table public.app_settings enable row level security;
alter table public.payment_provider_events enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

create policy profiles_insert_admin
on public.profiles for insert to authenticated
with check ((select private.is_admin()));

create policy profiles_update
on public.profiles for update to authenticated
using (id = (select auth.uid()) or (select private.is_admin()))
with check (id = (select auth.uid()) or (select private.is_admin()));

create policy profiles_delete_admin
on public.profiles for delete to authenticated
using ((select private.is_admin()));

create policy families_select
on public.families for select to authenticated
using ((select private.can_access_family(id)));

create policy families_admin_all
on public.families for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy family_users_select
on public.family_users for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.can_access_family(family_id))
);

create policy family_users_admin_all
on public.family_users for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy students_select
on public.students for select to authenticated
using ((select private.can_access_family(family_id)));

create policy students_admin_all
on public.students for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy courses_select
on public.courses for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.enrollments e
    join public.students s on s.id = e.student_id
    where e.course_id = courses.id
      and (select private.can_access_family(s.family_id))
  )
);

create policy courses_admin_all
on public.courses for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy enrollments_select
on public.enrollments for select to authenticated
using ((select private.can_access_student(student_id)));

create policy enrollments_admin_all
on public.enrollments for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy lessons_select
on public.lessons for select to authenticated
using (
  (select private.is_admin())
  or (
    lessons.lesson_type not in ('makeup', 'recovery')
    and exists (
      select 1
      from public.enrollments e
      join public.students s on s.id = e.student_id
      where e.course_id = lessons.course_id
        and (e.is_active or e.ends_on is not null)
        and e.starts_on <=
          (lessons.starts_at at time zone 'Europe/Rome')::date
        and (
          e.ends_on is null
          or e.ends_on >=
            (lessons.starts_at at time zone 'Europe/Rome')::date
        )
        and (select private.can_access_family(s.family_id))
    )
  )
  or (
    lessons.lesson_type in ('makeup', 'recovery')
    and exists (
      select 1
      from public.makeup_credits mc
      where mc.used_lesson_id = lessons.id
        and mc.status in ('scheduled', 'used')
        and (select private.can_access_student(mc.student_id))
    )
  )
);

create policy lessons_admin_all
on public.lessons for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy attendance_select
on public.attendance for select to authenticated
using (
  (select private.can_access_student(student_id))
  and exists (
    select 1
    from public.lessons l
    where l.id = attendance.lesson_id
      and (
        (
          l.lesson_type not in ('makeup', 'recovery')
          and exists (
            select 1
            from public.enrollments e
            where e.student_id = attendance.student_id
              and e.course_id = l.course_id
              and (e.is_active or e.ends_on is not null)
              and e.starts_on <=
                (l.starts_at at time zone 'Europe/Rome')::date
              and (
                e.ends_on is null
                or e.ends_on >=
                  (l.starts_at at time zone 'Europe/Rome')::date
              )
          )
        )
        or (
          l.lesson_type in ('makeup', 'recovery')
          and exists (
            select 1
            from public.makeup_credits mc
            where mc.student_id = attendance.student_id
              and mc.used_lesson_id = l.id
              and mc.status in ('scheduled', 'used')
          )
        )
      )
  )
);

create policy attendance_admin_all
on public.attendance for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy makeup_credits_select
on public.makeup_credits for select to authenticated
using ((select private.can_access_student(student_id)));

create policy makeup_credits_admin_all
on public.makeup_credits for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy invoices_select
on public.invoices for select to authenticated
using ((select private.can_access_family(family_id)));

create policy invoices_admin_all
on public.invoices for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy payments_select
on public.payments for select to authenticated
using ((select private.can_access_family(family_id)));

create policy payments_admin_all
on public.payments for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy bank_notices_select
on public.bank_transfer_notices for select to authenticated
using ((select private.can_access_family(family_id)));

create policy bank_notices_family_insert
on public.bank_transfer_notices for insert to authenticated
with check (
  not (select private.is_admin())
  and (select private.can_access_family(family_id))
  and (select private.can_access_invoice(invoice_id))
  and status = 'submitted'
  and reviewed_by is null
  and reviewed_at is null
);

create policy bank_notices_admin_all
on public.bank_transfer_notices for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy app_settings_public_read
on public.app_settings for select to anon, authenticated
using (visibility = 'public');

create policy app_settings_authenticated_read
on public.app_settings for select to authenticated
using (
  visibility = 'authenticated'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
  )
  and exists (
    select 1
    from public.family_users fu
    join public.families f on f.id = fu.family_id
    where fu.user_id = (select auth.uid())
      and f.is_active
  )
);

create policy app_settings_admin_all
on public.app_settings for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy provider_events_admin_read
on public.payment_provider_events for select to authenticated
using ((select private.is_admin()));

create policy audit_admin_read
on public.audit_log for select to authenticated
using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Privilegi API
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.app_settings to anon;

grant select, insert, update, delete on
  public.profiles,
  public.families,
  public.family_users,
  public.students,
  public.courses,
  public.enrollments,
  public.lessons,
  public.attendance,
  public.makeup_credits,
  public.invoices,
  public.payments,
  public.bank_transfer_notices,
  public.app_settings
to authenticated;

grant select on
  public.payment_provider_events,
  public.audit_log,
  public.invoice_summaries,
  public.student_attendance_summary
to authenticated;

grant usage, select on sequence public.invoice_number_seq to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function private.set_updated_at() from public;
revoke all on function private.classify_app_setting() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.can_access_family(uuid) from public;
revoke all on function private.can_access_student(uuid) from public;
revoke all on function private.can_access_invoice(uuid) from public;
revoke all on function private.handle_auth_user() from public;
revoke all on function private.guard_profile_update() from public;
revoke all on function private.validate_invoice_student() from public;
revoke all on function private.validate_invoice_ledger_status() from public;
revoke all on function private.validate_payment_family() from public;
revoke all on function private.guard_parallel_settlement() from public;
revoke all on function private.guard_payment_over_settlement() from public;
revoke all on function private.prevent_payment_delete() from public;
revoke all on function private.validate_bank_notice() from public;
revoke all on function private.guard_bank_notice_verification() from public;
revoke all on function private.guard_lesson_reschedule() from public;
revoke all on function private.validate_attendance_membership() from public;
revoke all on function private.audit_row_change() from public;
revoke all on function private.refresh_invoice_status(uuid) from public;
revoke all on function private.refresh_invoice_after_payment() from public;
revoke all on function private.refresh_invoice_after_bank_notice() from public;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_access_family(uuid) to authenticated;
grant execute on function private.can_access_student(uuid) to authenticated;
grant execute on function private.can_access_invoice(uuid) to authenticated;

revoke all on function public.mark_attendance_batch(uuid, jsonb) from public;
revoke all on function public.admin_upsert_student_family(jsonb) from public;
revoke all on function public.reschedule_lesson(
  uuid, timestamptz, timestamptz, text, text, text
) from public;
revoke all on function public.assign_makeup_credit(uuid, uuid) from public;
revoke all on function public.update_lesson_status(uuid, text, text)
  from public;
revoke all on function public.confirm_bank_transfer(uuid, text) from public;
revoke all on function public.admin_mark_invoice_paid(uuid, text) from public;
revoke all on function public.reject_bank_transfer(uuid, text) from public;
revoke all on function public.refresh_overdue_invoices() from public;
grant execute on function public.mark_attendance_batch(uuid, jsonb)
  to authenticated;
grant execute on function public.admin_upsert_student_family(jsonb)
  to authenticated;
grant execute on function public.reschedule_lesson(
  uuid, timestamptz, timestamptz, text, text, text
) to authenticated;
grant execute on function public.assign_makeup_credit(uuid, uuid)
  to authenticated;
grant execute on function public.update_lesson_status(uuid, text, text)
  to authenticated;
grant execute on function public.confirm_bank_transfer(uuid, text)
  to authenticated;
grant execute on function public.admin_mark_invoice_paid(uuid, text)
  to authenticated;
grant execute on function public.reject_bank_transfer(uuid, text)
  to authenticated;
grant execute on function public.refresh_overdue_invoices()
  to authenticated;

revoke all on function public.record_paypal_capture(
  text, text, text, integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.begin_paypal_capture(text, integer)
  from public, anon, authenticated;
revoke all on function public.release_paypal_capture(text, text)
  from public, anon, authenticated;
revoke all on function public.process_paypal_webhook(
  text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.record_paypal_capture(
  text, text, text, integer, text, jsonb
) to service_role;
grant execute on function public.begin_paypal_capture(text, integer)
  to service_role;
grant execute on function public.release_paypal_capture(text, text)
  to service_role;
grant execute on function public.process_paypal_webhook(
  text, text, jsonb, jsonb
) to service_role;

-- Impostazioni iniziali non segrete. Non salvare mai credenziali in questa tabella.
insert into public.app_settings (key, value, description, visibility)
values
  (
    'school_name',
    '"Studio Quarto MoVimento"'::jsonb,
    'Nome visualizzato',
    'public'
  ),
  (
    'school_address',
    '""'::jsonb,
    'Indirizzo della scuola',
    'public'
  ),
  (
    'support_email',
    '"valeria@quartomovimento.it"'::jsonb,
    'Email di contatto',
    'public'
  ),
  (
    'support_phone',
    '""'::jsonb,
    'Telefono di contatto',
    'public'
  ),
  ('timezone', '"Europe/Rome"'::jsonb, 'Fuso orario didattico', 'public'),
  (
    'absence_notice_hours',
    '24'::jsonb,
    'Preavviso minimo per recuperi',
    'authenticated'
  ),
  (
    'academic_year_start',
    'null'::jsonb,
    'Inizio anno didattico da configurare',
    'authenticated'
  ),
  (
    'academic_year_end',
    'null'::jsonb,
    'Fine anno didattico da configurare',
    'authenticated'
  ),
  (
    'academic_year_label',
    '"Anno didattico in corso"'::jsonb,
    'Etichetta dell''anno didattico',
    'authenticated'
  ),
  (
    'makeup_deadline',
    'null'::jsonb,
    'Termine generale per i recuperi',
    'authenticated'
  ),
  (
    'monthly_validity_months',
    '2'::jsonb,
    'Validità configurabile del pacchetto mensile',
    'authenticated'
  ),
  (
    'paypal_currency',
    '"EUR"'::jsonb,
    'Valuta accettata da PayPal',
    'authenticated'
  ),
  (
    'bank_account_holder',
    '""'::jsonb,
    'Intestatario da configurare prima della produzione',
    'authenticated'
  ),
  (
    'bank_iban',
    '""'::jsonb,
    'IBAN da configurare prima della produzione',
    'authenticated'
  ),
  (
    'bank_bic',
    '""'::jsonb,
    'BIC facoltativo',
    'authenticated'
  ),
  (
    'bank_reference_template',
    '"Quota corso · {allievo} · {numero}"'::jsonb,
    'Causale suggerita per il bonifico',
    'authenticated'
  )
on conflict (key) do nothing;

commit;
