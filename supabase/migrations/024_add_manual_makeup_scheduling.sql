-- Recuperi programmati manualmente dall'amministratrice.
-- Un recupero puo essere collegato a un'assenza esistente oppure creato
-- direttamente, senza dipendere dalle regole automatiche del piano.

alter table public.makeup_credits
  alter column source_lesson_id drop not null;

comment on column public.makeup_credits.source_lesson_id is
  'Lezione di origine, nulla per i recuperi creati manualmente senza un''assenza collegata';

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
    if not found or v_credit.status not in ('available', 'proposed', 'not_eligible') then
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
       or v_target.status <> 'scheduled'
       or v_target.lesson_type <> 'regular'
       or v_target.student_id is not null
       or v_target.starts_at <= now() then
      raise exception 'La lezione di gruppo non e disponibile'
        using errcode = '23514';
    end if;
  else
    if position('individual' in lower(v_course.name)) = 0 then
      raise exception 'La data individuale e disponibile solo per Lezioni individuali'
        using errcode = '23514';
    end if;
    if p_starts_at is null or p_starts_at <= now() then
      raise exception 'Scegli una data futura valida' using errcode = '22023';
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

revoke all on function public.admin_schedule_manual_makeup(
  uuid, uuid, text, uuid, timestamptz, integer
) from public;
grant execute on function public.admin_schedule_manual_makeup(
  uuid, uuid, text, uuid, timestamptz, integer
) to authenticated;

-- Un allievo inserito come recupero in un gruppo puo avere una presenza anche
-- se non e iscritto al corso che ospita quella singola lezione.
create or replace function private.validate_attendance_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_target_student_id uuid;
  v_lesson_date date;
  v_lesson_type text;
begin
  select
    lesson.course_id,
    lesson.student_id,
    (lesson.starts_at at time zone 'Europe/Rome')::date,
    lesson.lesson_type
  into
    v_course_id,
    v_target_student_id,
    v_lesson_date,
    v_lesson_type
  from public.lessons lesson
  where lesson.id = new.lesson_id;

  if v_target_student_id is not null
     and v_target_student_id <> new.student_id then
    raise exception 'La lezione individuale appartiene a un altro allievo'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.makeup_credits credit
    where credit.student_id = new.student_id
      and credit.used_lesson_id = new.lesson_id
      and credit.status in ('scheduled', 'used')
  ) then
    return new;
  end if;

  if v_lesson_type in ('makeup', 'recovery') then
    raise exception 'Il recupero non risulta assegnato all''allievo'
      using errcode = '23514';
  elsif not exists (
    select 1
    from public.enrollments enrollment
    where enrollment.student_id = new.student_id
      and enrollment.course_id = v_course_id
      and (
        v_target_student_id is not null
        or enrollment.lesson_schedule_mode = 'course'
      )
      and (enrollment.is_active or enrollment.ends_on is not null)
      and enrollment.starts_on <= v_lesson_date
      and (
        enrollment.ends_on is null
        or enrollment.ends_on >= v_lesson_date
      )
  ) then
    raise exception 'L''allievo non risulta iscritto a questa lezione'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Qualunque presenza registrata sulla lezione scelta consuma il recupero.
-- Un'assenza al recupero non genera a catena un nuovo credito.
create or replace function private.account_linked_makeup_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' and exists (
    select 1
    from public.makeup_credits credit
    where credit.student_id = new.student_id
      and credit.used_lesson_id = new.lesson_id
      and credit.status = 'used'
  ) then
    raise exception 'Un recupero gia contabilizzato non puo tornare in attesa'
      using errcode = '23514';
  end if;

  if new.status <> 'pending' then
    update public.makeup_credits
    set status = 'used',
        used_at = coalesce(used_at, now()),
        reason = case
          when status = 'scheduled'
            and new.status in ('absent_excused', 'absent_unexcused')
            then concat_ws(
              ' | ',
              nullif(reason, ''),
              'Credito consumato per assenza al recupero'
            )
          else reason
        end
    where student_id = new.student_id
      and used_lesson_id = new.lesson_id
      and status in ('scheduled', 'used');
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_account_linked_makeup
  on public.attendance;
create trigger attendance_account_linked_makeup
before insert or update of lesson_id, student_id, status
on public.attendance
for each row execute function private.account_linked_makeup_attendance();

create or replace function private.prevent_chained_makeup_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_lesson_id is not null and exists (
    select 1
    from public.makeup_credits assigned
    where assigned.student_id = new.student_id
      and assigned.used_lesson_id = new.source_lesson_id
      and assigned.status in ('scheduled', 'used')
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists makeup_credits_prevent_chain
  on public.makeup_credits;
create trigger makeup_credits_prevent_chain
before insert on public.makeup_credits
for each row execute function private.prevent_chained_makeup_credit();

-- La famiglia vede la lezione ospitante, il relativo corso e l'eventuale
-- presenza soltanto quando il proprio allievo vi e collegato come recupero.
drop policy courses_select on public.courses;
create policy courses_select
on public.courses for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.enrollments enrollment
    join public.students student on student.id = enrollment.student_id
    where enrollment.course_id = courses.id
      and (select private.can_access_family(student.family_id))
  )
  or exists (
    select 1
    from public.lessons lesson
    join public.makeup_credits credit on credit.used_lesson_id = lesson.id
    where lesson.course_id = courses.id
      and credit.status in ('scheduled', 'used')
      and (select private.can_access_student(credit.student_id))
  )
);

drop policy lessons_select on public.lessons;
create policy lessons_select
on public.lessons for select to authenticated
using (
  (select private.is_admin())
  or (
    lessons.lesson_type not in ('makeup', 'recovery')
    and (
      (
        lessons.student_id is not null
        and (select private.can_access_student(lessons.student_id))
      )
      or (
        lessons.student_id is null
        and exists (
          select 1
          from public.enrollments enrollment
          join public.students student on student.id = enrollment.student_id
          where enrollment.course_id = lessons.course_id
            and enrollment.lesson_schedule_mode = 'course'
            and (enrollment.is_active or enrollment.ends_on is not null)
            and enrollment.starts_on <=
              (lessons.starts_at at time zone 'Europe/Rome')::date
            and (
              enrollment.ends_on is null
              or enrollment.ends_on >=
                (lessons.starts_at at time zone 'Europe/Rome')::date
            )
            and (select private.can_access_family(student.family_id))
        )
      )
    )
  )
  or exists (
    select 1
    from public.makeup_credits credit
    where credit.used_lesson_id = lessons.id
      and credit.status in ('scheduled', 'used')
      and (select private.can_access_student(credit.student_id))
  )
);

drop policy attendance_select on public.attendance;
create policy attendance_select
on public.attendance for select to authenticated
using (
  (select private.can_access_student(attendance.student_id))
  and exists (
    select 1
    from public.lessons lesson
    where lesson.id = attendance.lesson_id
      and (
        exists (
          select 1
          from public.makeup_credits credit
          where credit.student_id = attendance.student_id
            and credit.used_lesson_id = lesson.id
            and credit.status in ('scheduled', 'used')
        )
        or (
          lesson.lesson_type not in ('makeup', 'recovery')
          and exists (
            select 1
            from public.enrollments enrollment
            where enrollment.student_id = attendance.student_id
              and enrollment.course_id = lesson.course_id
              and (enrollment.is_active or enrollment.ends_on is not null)
              and enrollment.starts_on <=
                (lesson.starts_at at time zone 'Europe/Rome')::date
              and (
                enrollment.ends_on is null
                or enrollment.ends_on >=
                  (lesson.starts_at at time zone 'Europe/Rome')::date
              )
          )
        )
      )
  )
);

revoke all on function private.account_linked_makeup_attendance() from public;
revoke all on function private.prevent_chained_makeup_credit() from public;
