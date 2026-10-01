-- Promemoria amministrativi per i rinnovi mensili e trimestrali.
-- I promemoria sono calcolati nell'interfaccia dai periodi di iscrizione;
-- questa tabella conserva soltanto la loro risoluzione per evitare duplicati.

begin;

-- Riallinea eventuali dati precedenti: un allievo non attivo non può avere
-- un'iscrizione ancora conteggiata come attiva.
update public.enrollments e
set is_active = false,
    ends_on = case
      when e.starts_on > current_date then e.starts_on
      else least(coalesce(e.ends_on, current_date), current_date)
    end
from public.students s
where s.id = e.student_id
  and not s.is_active
  and e.is_active;

create table public.billing_renewal_resolutions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null
    references public.enrollments(id) on delete cascade,
  period_ends_on date not null,
  resolution text not null
    check (resolution in ('invoice_created', 'already_handled')),
  invoice_id uuid references public.invoices(id) on delete cascade,
  resolved_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (enrollment_id, period_ends_on),
  constraint billing_renewal_resolution_invoice_valid check (
    (resolution = 'invoice_created' and invoice_id is not null)
    or (resolution = 'already_handled' and invoice_id is null)
  )
);

create index billing_renewal_resolutions_period_idx
  on public.billing_renewal_resolutions (period_ends_on desc);

create trigger billing_renewal_resolutions_audit
after insert or update or delete on public.billing_renewal_resolutions
for each row execute function private.audit_row_change();

alter table public.billing_renewal_resolutions enable row level security;

create policy billing_renewal_resolutions_admin_select
on public.billing_renewal_resolutions
for select to authenticated
using ((select private.is_admin()));

revoke all on public.billing_renewal_resolutions from anon, authenticated;
grant select on public.billing_renewal_resolutions to authenticated;
grant all on public.billing_renewal_resolutions to service_role;

create or replace function public.admin_create_billing_renewal_invoice(
  p_enrollment_id uuid,
  p_period_ends_on date,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments;
  v_student public.students;
  v_invoice public.invoices;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = p_enrollment_id
  for update;

  if not found or not v_enrollment.is_active
     or v_enrollment.plan_type not in ('monthly', 'quarterly') then
    raise exception 'Iscrizione non valida per il promemoria di rinnovo'
      using errcode = '23514';
  end if;

  select * into v_student
  from public.students
  where id = v_enrollment.student_id
    and is_active;

  if not found then
    raise exception 'Allievo non attivo o non trovato' using errcode = 'P0002';
  end if;

  if p_period_ends_on is null or p_period_ends_on < v_enrollment.starts_on then
    raise exception 'Periodo di rinnovo non valido' using errcode = '22023';
  end if;

  insert into public.invoices (
    family_id,
    student_id,
    number,
    title,
    description,
    total_cents,
    currency,
    due_date,
    status
  ) values (
    v_student.family_id,
    v_student.id,
    nullif(btrim(p_payload ->> 'number'), ''),
    nullif(btrim(p_payload ->> 'title'), ''),
    coalesce(btrim(p_payload ->> 'description'), ''),
    (p_payload ->> 'total_cents')::integer,
    'EUR',
    (p_payload ->> 'due_date')::date,
    'pending'
  )
  returning * into v_invoice;

  insert into public.billing_renewal_resolutions (
    enrollment_id,
    period_ends_on,
    resolution,
    invoice_id,
    resolved_by,
    resolved_at
  ) values (
    v_enrollment.id,
    p_period_ends_on,
    'invoice_created',
    v_invoice.id,
    auth.uid(),
    now()
  )
  on conflict (enrollment_id, period_ends_on) do update
  set resolution = 'invoice_created',
      invoice_id = excluded.invoice_id,
      resolved_by = auth.uid(),
      resolved_at = now();

  return jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'period_ends_on', p_period_ends_on
  );
exception
  when not_null_violation or check_violation or invalid_text_representation
    or invalid_datetime_format then
    raise exception 'Dati della nuova scadenza non validi: %', sqlerrm
      using errcode = '22023';
end;
$$;

create or replace function public.admin_mark_billing_renewal_handled(
  p_enrollment_id uuid,
  p_period_ends_on date
)
returns public.billing_renewal_resolutions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments;
  v_resolution public.billing_renewal_resolutions;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = p_enrollment_id;

  if not found or v_enrollment.plan_type not in ('monthly', 'quarterly') then
    raise exception 'Iscrizione non valida per il promemoria di rinnovo'
      using errcode = '23514';
  end if;

  insert into public.billing_renewal_resolutions (
    enrollment_id,
    period_ends_on,
    resolution,
    invoice_id,
    resolved_by,
    resolved_at
  ) values (
    p_enrollment_id,
    p_period_ends_on,
    'already_handled',
    null,
    auth.uid(),
    now()
  )
  on conflict (enrollment_id, period_ends_on) do update
  set resolution = 'already_handled',
      invoice_id = null,
      resolved_by = auth.uid(),
      resolved_at = now()
  returning * into v_resolution;

  return v_resolution;
end;
$$;

revoke all on function public.admin_create_billing_renewal_invoice(uuid, date, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_mark_billing_renewal_handled(uuid, date)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_billing_renewal_invoice(uuid, date, jsonb)
  to authenticated;
grant execute on function public.admin_mark_billing_renewal_handled(uuid, date)
  to authenticated;

commit;
