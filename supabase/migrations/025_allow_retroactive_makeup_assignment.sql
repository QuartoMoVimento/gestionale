-- Permette di assegnare un recupero anche a sessioni già svolte o passate,
-- così che i crediti possano essere aggiornati retroattivamente dopo un recupero effettivo.

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

  if not found or v_credit.status not in ('available', 'expired') then
    raise exception 'Credito non disponibile' using errcode = '23514';
  end if;

  select l.course_id into v_source_course
  from public.lessons l
  where l.id = v_credit.source_lesson_id;

  select * into v_target
  from public.lessons
  where id = p_lesson_id
  for update;

  if not found
     or v_target.status not in ('scheduled', 'completed')
     or v_target.lesson_type not in ('makeup', 'recovery')
     or v_target.course_id <> v_source_course
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

create or replace function public.admin_schedule_manual_makeup(
  p_student_id uuid,
  p_credit_id uuid,
  p_mode text,
  p_target_lesson_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_enrollment public.enrollments;
  v_course public.courses;
  v_credit public.makeup_credits;
  v_target public.lessons;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  if p_mode not in ('group', 'individual') then
    raise exception 'Modalita di recupero non valida'
      using errcode = '22023';
  end if;

  select student.* into v_student
  from public.students student
  where student.id = p_student_id
    and student.is_active
  for update;
  if not found then
    raise exception 'Allievo attivo non trovato' using errcode = 'P0002';
  end if;

  select enrollment.* into v_enrollment
  from public.enrollments enrollment
  where enrollment.student_id = p_student_id
    and enrollment.is_active
  order by enrollment.starts_on desc, enrollment.created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'L''allievo non ha un''iscrizione attiva'
      using errcode = '23514';
  end if;

  select course.* into v_course
  from public.courses course
  where course.id = v_enrollment.course_id;
  if not found then
    raise exception 'Corso dell''allievo non trovato' using errcode = 'P0002';
  end if;

  if p_credit_id is not null then
    select credit.* into v_credit
    from public.makeup_credits credit
    where credit.id = p_credit_id
      and credit.student_id = p_student_id
    for update;
    if not found or v_credit.status not in (
      'available',
      'proposed',
      'not_eligible',
      'expired'
    ) then
      raise exception 'Il recupero selezionato non e piu programmabile'
        using errcode = '23514';
    end if;
  end if;

  if p_mode = 'group' then
    if p_target_lesson_id is null then
      raise exception 'Scegli una lezione di gruppo' using errcode = '22023';
    end if;
    select lesson.* into v_target
    from public.lessons lesson
    where lesson.id = p_target_lesson_id
    for update;
    if not found
       or v_target.status not in ('scheduled', 'completed')
       or v_target.lesson_type <> 'regular'
       or v_target.student_id is not null then
      raise exception 'La lezione di gruppo non e disponibile'
        using errcode = '23514';
    end if;
  else
    if p_starts_at is null then
      raise exception 'Scegli una data valida' using errcode = '22023';
    end if;
    if p_duration_minutes is null or p_duration_minutes not between 15 and 240 then
      raise exception 'La durata deve essere compresa tra 15 e 240 minuti'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from public.school_closures closure
      where closure.closure_date =
        (p_starts_at at time zone 'Europe/Rome')::date
    ) then
      raise exception 'La data scelta e una giornata di chiusura'
        using errcode = '23514';
    end if;

    insert into public.lessons (
      course_id,
      starts_at,
      ends_at,
      lesson_type,
      status,
      title,
      location,
      notes,
      origin,
      occurrence_on,
      student_id,
      enrollment_id
    ) values (
      v_course.id,
      p_starts_at,
      p_starts_at + make_interval(mins => p_duration_minutes),
      'makeup',
      'scheduled',
      'Recupero individuale - ' || v_student.first_name || ' ' || v_student.last_name,
      v_course.location,
      'Recupero programmato manualmente',
      'manual',
      null,
      null,
      null
    )
    returning * into v_target;
  end if;

  if exists (
    select 1
    from public.school_closures closure
    where closure.closure_date = coalesce(
      v_target.occurrence_on,
      (v_target.starts_at at time zone 'Europe/Rome')::date
    )
  ) then
    raise exception 'La lezione scelta cade in una giornata di chiusura'
      using errcode = '23514';
  end if;

  if v_credit.id is not null
     and v_credit.expires_on is not null
     and (v_target.starts_at at time zone 'Europe/Rome')::date >
       v_credit.expires_on then
    raise exception 'La data scelta supera la scadenza del recupero'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.makeup_credits credit
    where credit.student_id = p_student_id
      and credit.used_lesson_id = v_target.id
      and (p_credit_id is null or credit.id <> p_credit_id)
  ) then
    raise exception 'L''allievo e gia inserito in questa lezione'
      using errcode = '23514';
  end if;

  if p_credit_id is null then
    insert into public.makeup_credits (
      student_id,
      enrollment_id,
      source_lesson_id,
      status,
      reason,
      expires_on
    ) values (
      p_student_id,
      v_enrollment.id,
      null,
      'available',
      'Recupero aggiunto manualmente da Valeria',
      null
    )
    returning * into v_credit;
  end if;

  update public.makeup_credits
  set enrollment_id = v_enrollment.id,
      used_lesson_id = v_target.id,
      status = 'scheduled',
      reason = 'Recupero programmato manualmente da Valeria',
      used_at = null
  where id = v_credit.id
  returning * into v_credit;

  return jsonb_build_object(
    'credit', to_jsonb(v_credit),
    'lesson', to_jsonb(v_target)
  );
end;
$$;
