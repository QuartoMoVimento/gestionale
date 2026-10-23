-- Estende i promemoria amministrativi di rinnovo ai piani annuali.
-- Il frontend continua a calcolare il periodo dalla data di inizio
-- dell'iscrizione e dalla durata del piano salvata nella scheda dell'allievo.

begin;

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
     or v_enrollment.plan_type not in ('monthly', 'quarterly', 'annual') then
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

  if not found
     or v_enrollment.plan_type not in ('monthly', 'quarterly', 'annual') then
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
