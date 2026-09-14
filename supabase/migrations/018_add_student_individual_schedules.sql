-- Le lezioni individuali possono avere una programmazione diversa per ogni
-- allievo: fissa (una ricorrenza settimanale) oppure variabile (appuntamenti
-- inseriti uno alla volta). Le lezioni mirate non sono visibili alle altre
-- famiglie iscritte allo stesso corso.

alter table public.enrollments
  add column lesson_schedule_mode text not null default 'course',
  add column lesson_weekday smallint,
  add column lesson_start_time time without time zone,
  add column lesson_duration_minutes integer;

alter table public.enrollments
  add constraint enrollments_lesson_schedule_mode_valid check (
    lesson_schedule_mode in ('course', 'fixed', 'variable')
  ),
  add constraint enrollments_lesson_schedule_complete check (
    (
      lesson_schedule_mode = 'fixed'
      and lesson_weekday is not null
      and lesson_start_time is not null
    )
    or
    (
      lesson_schedule_mode <> 'fixed'
      and lesson_weekday is null
      and lesson_start_time is null
    )
  ),
  add constraint enrollments_lesson_weekday_valid check (
    lesson_weekday is null or lesson_weekday between 1 and 7
  ),
  add constraint enrollments_lesson_duration_valid check (
    lesson_duration_minutes is null
    or lesson_duration_minutes between 15 and 480
  );

comment on column public.enrollments.lesson_schedule_mode is
  'course usa il calendario del corso, fixed genera appuntamenti settimanali per il singolo allievo, variable usa appuntamenti manuali';

alter table public.lessons
  add column student_id uuid references public.students(id) on delete restrict,
  add column enrollment_id uuid references public.enrollments(id) on delete restrict;

create index lessons_student_starts_idx
  on public.lessons (student_id, starts_at)
  where student_id is not null;

create unique index lessons_enrollment_schedule_occurrence_uidx
  on public.lessons (enrollment_id, occurrence_on)
  where origin = 'enrollment_schedule';

alter table public.lessons
  drop constraint lessons_origin_valid,
  drop constraint lessons_course_schedule_shape_valid;

alter table public.lessons
  add constraint lessons_origin_valid check (
    origin in ('manual', 'course_schedule', 'enrollment_schedule')
  ),
  add constraint lessons_generated_schedule_shape_valid check (
    (
      origin = 'manual'
      and occurrence_on is null
    )
    or
    (
      origin = 'course_schedule'
      and occurrence_on is not null
      and lesson_type = 'regular'
      and student_id is null
      and enrollment_id is null
    )
    or
    (
      origin = 'enrollment_schedule'
      and occurrence_on is not null
      and lesson_type = 'regular'
      and student_id is not null
      and enrollment_id is not null
    )
  ),
  add constraint lessons_target_shape_valid check (
    student_id is null
    or (
      origin <> 'course_schedule'
      and lesson_type not in ('makeup', 'recovery')
    )
  );

comment on column public.lessons.student_id is
  'Allievo destinatario quando la lezione e individuale';
comment on column public.lessons.enrollment_id is
  'Iscrizione che origina o autorizza una lezione individuale';

create or replace function private.sync_enrollment_calendar(
  p_enrollment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments;
  v_course public.courses;
  v_student public.students;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_had_managed boolean := false;
  v_generate_from date;
  v_generate_until date;
  v_first_occurrence date;
  v_removed integer := 0;
  v_created integer := 0;
  v_preserved integer := 0;
begin
  select * into v_enrollment
  from public.enrollments
  where id = p_enrollment_id
  for update;

  if not found then
    raise exception 'Iscrizione non trovata' using errcode = 'P0002';
  end if;

  select * into v_course
  from public.courses
  where id = v_enrollment.course_id;

  select * into v_student
  from public.students
  where id = v_enrollment.student_id;

  select exists (
    select 1 from public.lessons lesson
    where lesson.enrollment_id = p_enrollment_id
      and lesson.origin = 'enrollment_schedule'
  ) into v_had_managed;

  select count(*) into v_preserved
  from public.lessons lesson
  where lesson.enrollment_id = p_enrollment_id
    and lesson.origin = 'enrollment_schedule'
    and (
      lesson.starts_at < now()
      or lesson.status <> 'scheduled'
      or exists (
        select 1 from public.attendance attendance
        where attendance.lesson_id = lesson.id
      )
      or exists (
        select 1 from public.makeup_credits credit
        where credit.source_lesson_id = lesson.id
           or credit.used_lesson_id = lesson.id
      )
    );

  delete from public.lessons lesson
  where lesson.enrollment_id = p_enrollment_id
    and lesson.origin = 'enrollment_schedule'
    and lesson.starts_at >= now()
    and lesson.status = 'scheduled'
    and not exists (
      select 1 from public.attendance attendance
      where attendance.lesson_id = lesson.id
    )
    and not exists (
      select 1 from public.makeup_credits credit
      where credit.source_lesson_id = lesson.id
         or credit.used_lesson_id = lesson.id
    );
  get diagnostics v_removed = row_count;

  if v_enrollment.lesson_schedule_mode <> 'fixed'
     or not v_enrollment.is_active
     or not coalesce(v_course.is_active, false)
     or not coalesce(v_student.is_active, false) then
    return jsonb_build_object(
      'created', v_created,
      'removed', v_removed,
      'preserved', v_preserved
    );
  end if;

  v_generate_from := greatest(v_enrollment.starts_on, v_today);
  v_generate_until := coalesce(v_enrollment.ends_on, v_course.ends_on);

  if v_generate_until is null then
    raise exception
      'Indica una data di fine iscrizione per usare l''orario fisso'
      using errcode = '22023';
  end if;

  if v_generate_from > v_generate_until then
    return jsonb_build_object(
      'created', v_created,
      'removed', v_removed,
      'preserved', v_preserved
    );
  end if;

  v_first_occurrence := v_generate_from + (
    (v_enrollment.lesson_weekday
      - extract(isodow from v_generate_from)::integer + 7) % 7
  );

  insert into public.lessons (
    course_id,
    student_id,
    enrollment_id,
    starts_at,
    ends_at,
    lesson_type,
    status,
    title,
    location,
    notes,
    origin,
    occurrence_on
  )
  select
    v_course.id,
    v_student.id,
    v_enrollment.id,
    occurrence.starts_at,
    occurrence.starts_at + make_interval(
      mins => coalesce(
        v_enrollment.lesson_duration_minutes,
        v_course.duration_minutes
      )
    ),
    'regular',
    'scheduled',
    null,
    null,
    '',
    'enrollment_schedule',
    occurrence.occurrence_on
  from (
    select
      generated.day_value::date as occurrence_on,
      timezone(
        'Europe/Rome',
        generated.day_value::date + v_enrollment.lesson_start_time
      ) as starts_at
    from generate_series(
      v_first_occurrence::timestamp,
      v_generate_until::timestamp,
      interval '7 days'
    ) generated(day_value)
  ) occurrence
  where occurrence.starts_at >= now()
    and not exists (
      select 1 from public.school_closures closure
      where closure.closure_date = occurrence.occurrence_on
    )
    and not exists (
      select 1 from public.lessons manual_lesson
      where manual_lesson.student_id = v_student.id
        and manual_lesson.origin = 'manual'
        and manual_lesson.starts_at = occurrence.starts_at
        and manual_lesson.status not in (
          'cancelled_teacher',
          'cancelled_holiday',
          'cancelled_other'
        )
    )
  on conflict (enrollment_id, occurrence_on)
    where origin = 'enrollment_schedule'
    do nothing;
  get diagnostics v_created = row_count;

  return jsonb_build_object(
    'created', v_created,
    'removed', v_removed,
    'preserved', v_preserved
  );
end;
$$;

create or replace function private.sync_enrollment_calendar_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_enrollment_calendar(new.id);
  return new;
end;
$$;

create trigger enrollments_sync_individual_calendar_after_update
after update of
  course_id,
  starts_on,
  ends_on,
  is_active,
  lesson_schedule_mode,
  lesson_weekday,
  lesson_start_time,
  lesson_duration_minutes
on public.enrollments
for each row
when (
  old.course_id is distinct from new.course_id
  or old.starts_on is distinct from new.starts_on
  or old.ends_on is distinct from new.ends_on
  or old.is_active is distinct from new.is_active
  or old.lesson_schedule_mode is distinct from new.lesson_schedule_mode
  or old.lesson_weekday is distinct from new.lesson_weekday
  or old.lesson_start_time is distinct from new.lesson_start_time
  or old.lesson_duration_minutes is distinct from new.lesson_duration_minutes
)
execute function private.sync_enrollment_calendar_after_write();

create or replace function private.sync_course_individual_calendars_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment_id uuid;
begin
  for v_enrollment_id in
    select enrollment.id
    from public.enrollments enrollment
    where enrollment.course_id = new.id
      and enrollment.lesson_schedule_mode = 'fixed'
  loop
    perform private.sync_enrollment_calendar(v_enrollment_id);
  end loop;
  return new;
end;
$$;

create trigger courses_sync_individual_calendars_after_update
after update of ends_on, duration_minutes, is_active
on public.courses
for each row
when (
  old.ends_on is distinct from new.ends_on
  or old.duration_minutes is distinct from new.duration_minutes
  or old.is_active is distinct from new.is_active
)
execute function private.sync_course_individual_calendars_after_write();

create or replace function private.guard_enrollment_schedule_lesson_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.origin = 'enrollment_schedule' then
    raise exception
      'Questa lezione e collegata all''orario fisso dell''allievo: modifica la programmazione dalla sua scheda'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger lessons_guard_enrollment_schedule_update
before update of
  course_id,
  student_id,
  enrollment_id,
  starts_at,
  ends_at,
  lesson_type,
  title,
  location,
  origin,
  occurrence_on
on public.lessons
for each row execute function private.guard_enrollment_schedule_lesson_update();

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

  if v_lesson_type in ('makeup', 'recovery') and not exists (
      select 1
      from public.makeup_credits credit
      where credit.student_id = new.student_id
        and credit.used_lesson_id = new.lesson_id
        and credit.status in ('scheduled', 'used')
    ) then
    raise exception 'Il recupero non risulta assegnato all''allievo'
      using errcode = '23514';
  elsif v_lesson_type not in ('makeup', 'recovery') and not exists (
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
      or
      (
        lessons.student_id is null
        and exists (
          select 1
          from public.enrollments enrollment
          join public.students student
            on student.id = enrollment.student_id
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
  or (
    lessons.lesson_type in ('makeup', 'recovery')
    and exists (
      select 1
      from public.makeup_credits credit
      where credit.used_lesson_id = lessons.id
        and credit.status in ('scheduled', 'used')
        and (select private.can_access_student(credit.student_id))
    )
  )
);

create or replace function private.apply_individual_schedule_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.lessons lesson
    where lesson.origin = 'enrollment_schedule'
      and lesson.occurrence_on = new.closure_date
      and lesson.status <> 'scheduled'
  ) then
    raise exception
      'La data contiene una lezione individuale gia gestita e non puo diventare una chiusura'
      using errcode = '23514';
  end if;

  delete from public.lessons lesson
  where lesson.origin = 'enrollment_schedule'
    and lesson.occurrence_on = new.closure_date
    and lesson.status = 'scheduled';

  return new;
end;
$$;

create trigger school_closures_apply_individual_schedule_before_insert
before insert on public.school_closures
for each row execute function private.apply_individual_schedule_closure();

create or replace function private.restore_individual_schedules_after_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment_id uuid;
begin
  for v_enrollment_id in
    select enrollment.id
    from public.enrollments enrollment
    where enrollment.lesson_schedule_mode = 'fixed'
      and enrollment.is_active
      and old.closure_date between enrollment.starts_on
        and coalesce(
          enrollment.ends_on,
          (select course.ends_on from public.courses course
           where course.id = enrollment.course_id)
        )
      and extract(isodow from old.closure_date)::smallint =
        enrollment.lesson_weekday
  loop
    perform private.sync_enrollment_calendar(v_enrollment_id);
  end loop;
  return old;
end;
$$;

create trigger school_closures_restore_individual_schedules_after_delete
after delete on public.school_closures
for each row execute function private.restore_individual_schedules_after_closure();

revoke all on function private.sync_enrollment_calendar(uuid) from public;
revoke all on function private.sync_enrollment_calendar_after_write() from public;
revoke all on function private.sync_course_individual_calendars_after_write() from public;
revoke all on function private.guard_enrollment_schedule_lesson_update() from public;
revoke all on function private.apply_individual_schedule_closure() from public;
revoke all on function private.restore_individual_schedules_after_closure() from public;
