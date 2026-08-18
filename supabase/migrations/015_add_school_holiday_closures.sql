-- Le chiusure dello studio sono eventi di calendario autonomi: non sono
-- lezioni annullate, non concorrono alla frequenza e non generano recuperi.

create table public.school_closures (
  id uuid primary key default gen_random_uuid(),
  closure_date date not null unique,
  description text not null default '',
  created_by uuid references public.profiles(id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_closures_description_length check (
    char_length(btrim(description)) <= 120
  )
);

comment on table public.school_closures is
  'Date di chiusura dello studio, mostrate nel calendario senza creare lezioni';
comment on column public.school_closures.description is
  'Nome facoltativo della festivita o della chiusura';

create trigger school_closures_set_updated_at
before update on public.school_closures
for each row execute function private.set_updated_at();

create trigger school_closures_audit
after insert or update or delete on public.school_closures
for each row execute function private.audit_row_change();

alter table public.school_closures enable row level security;

create policy school_closures_authenticated_read
on public.school_closures for select to authenticated
using (true);

create policy school_closures_admin_all
on public.school_closures for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

revoke all on public.school_closures from anon, authenticated;
grant select on public.school_closures to authenticated;
grant all on public.school_closures to service_role;

-- Qualunque futura rigenerazione del corso continua a rispettare le chiusure.
-- Il trigger e una difesa persistente: una modifica successiva al corso non
-- puo ricreare l'occorrenza che cade in una data chiusa.
create or replace function private.skip_course_lesson_on_school_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson_date date := coalesce(
    new.occurrence_on,
    (new.starts_at at time zone 'Europe/Rome')::date
  );
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('school-closure:' || v_lesson_date::text, 0)
  );
  if exists (
    select 1
    from public.school_closures closure
    where closure.closure_date = v_lesson_date
  ) then
    if new.origin = 'course_schedule' then
      return null;
    end if;
    if new.status not in (
      'cancelled_teacher',
      'cancelled_holiday',
      'cancelled_other'
    ) then
      raise exception
        'Non si possono aggiungere appuntamenti in una giornata di chiusura'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger lessons_skip_school_closure
before insert on public.lessons
for each row execute function private.skip_course_lesson_on_school_closure();

create or replace function private.guard_lesson_update_on_school_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson_date date := coalesce(
    new.occurrence_on,
    (new.starts_at at time zone 'Europe/Rome')::date
  );
begin
  if new.status not in (
       'cancelled_teacher',
       'cancelled_holiday',
       'cancelled_other'
     )
     and exists (
       select 1
       from public.school_closures closure
       where closure.closure_date = v_lesson_date
     ) then
    raise exception
      'Non si possono programmare appuntamenti in una giornata di chiusura'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger lessons_guard_school_closure_update
before update of starts_at, status, origin
on public.lessons
for each row execute function private.guard_lesson_update_on_school_closure();

-- Difesa aggiuntiva contro dati incoerenti: una chiusura non puo avere
-- presenze, neppure su un appuntamento manuale rimasto da verificare.
create or replace function private.guard_school_closure_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.lessons lesson
    join public.school_closures closure
      on closure.closure_date = coalesce(
        lesson.occurrence_on,
        (lesson.starts_at at time zone 'Europe/Rome')::date
      )
    where lesson.id = new.lesson_id
  ) then
    raise exception
      'Non si possono registrare presenze in una giornata di chiusura'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attendance_guard_school_closure
before insert or update of lesson_id, student_id, status
on public.attendance
for each row execute function private.guard_school_closure_attendance();

-- La chiusura non puo diventare origine o destinazione di un recupero.
create or replace function private.guard_school_closure_makeup_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.lessons lesson
    join public.school_closures closure
      on closure.closure_date = coalesce(
        lesson.occurrence_on,
        (lesson.starts_at at time zone 'Europe/Rome')::date
      )
    where lesson.id = new.source_lesson_id
       or lesson.id = new.used_lesson_id
  ) then
    raise exception
      'Una giornata di chiusura non puo generare o ospitare recuperi'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger makeup_credits_guard_school_closure
before insert or update of source_lesson_id, used_lesson_id, status
on public.makeup_credits
for each row execute function private.guard_school_closure_makeup_credit();

-- Blocca i corsi e le lezioni interessate nello stesso ordine usato dalla
-- sincronizzazione dei corsi. In questo modo una presenza o una modifica al
-- corso non puo inserirsi tra il controllo e la rimozione della lezione.
create or replace function private.apply_school_closure_date(
  p_closure_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_removed integer := 0;
begin
  if p_closure_date is null then
    raise exception 'Indica la data di chiusura' using errcode = '22023';
  end if;
  if p_closure_date < v_today then
    raise exception
      'Una chiusura puo essere inserita soltanto da oggi in avanti'
      using errcode = '22023';
  end if;

  perform 1
  from public.courses course
  where (
      course.is_active
      and num_nonnulls(
        course.starts_on,
        course.ends_on,
        course.weekday,
        course.start_time
      ) = 4
      and p_closure_date between course.starts_on and course.ends_on
      and extract(isodow from p_closure_date)::smallint = course.weekday
    )
    or exists (
      select 1
      from public.lessons lesson
      where lesson.course_id = course.id
        and lesson.origin = 'course_schedule'
        and lesson.occurrence_on = p_closure_date
    )
  order by course.id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'school-closure:' || p_closure_date::text,
      0
    )
  );

  perform 1
  from public.lessons lesson
  where coalesce(
    lesson.occurrence_on,
    (lesson.starts_at at time zone 'Europe/Rome')::date
  ) = p_closure_date
  order by lesson.id
  for update;

  if exists (
    select 1
    from public.lessons lesson
    where lesson.origin = 'manual'
      and (lesson.starts_at at time zone 'Europe/Rome')::date = p_closure_date
      and lesson.status in ('scheduled', 'completed')
  ) then
    raise exception
      'La data contiene appuntamenti manuali programmati o gia svolti e non puo essere segnata come chiusura'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.lessons lesson
    where lesson.origin = 'course_schedule'
      and lesson.occurrence_on = p_closure_date
      and lesson.status <> 'scheduled'
  ) then
    raise exception
      'La data contiene una lezione gia completata o annullata e non puo diventare una chiusura'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.attendance attendance
    join public.lessons lesson on lesson.id = attendance.lesson_id
    where coalesce(
      lesson.occurrence_on,
      (lesson.starts_at at time zone 'Europe/Rome')::date
    ) = p_closure_date
  ) then
    raise exception
      'La data ha gia presenze registrate e non puo diventare una chiusura'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.makeup_credits credit
    join public.lessons lesson
      on lesson.id = credit.source_lesson_id
      or lesson.id = credit.used_lesson_id
    where coalesce(
      lesson.occurrence_on,
      (lesson.starts_at at time zone 'Europe/Rome')::date
    ) = p_closure_date
  ) then
    raise exception
      'La data ha gia recuperi collegati e non puo diventare una chiusura'
      using errcode = '23514';
  end if;

  delete from public.lessons lesson
  where lesson.origin = 'course_schedule'
    and lesson.occurrence_on = p_closure_date
    and lesson.status = 'scheduled';
  get diagnostics v_removed = row_count;

  return v_removed;
end;
$$;

-- La rimozione di una chiusura ricrea soltanto l'occorrenza di quella data.
-- Le altre lezioni conservano il proprio UUID (e quindi anche l'UID ICS).
create or replace function private.restore_school_closure_date(
  p_closure_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restored integer := 0;
begin
  if p_closure_date is null then
    return 0;
  end if;

  perform 1
  from public.courses course
  where course.is_active
    and num_nonnulls(
      course.starts_on,
      course.ends_on,
      course.weekday,
      course.start_time
    ) = 4
    and p_closure_date between course.starts_on and course.ends_on
    and extract(isodow from p_closure_date)::smallint = course.weekday
  order by course.id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'school-closure:' || p_closure_date::text,
      0
    )
  );

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
    occurrence_on
  )
  select
    course.id,
    occurrence.starts_at,
    occurrence.starts_at
      + make_interval(mins => course.duration_minutes),
    'regular',
    'scheduled',
    null,
    null,
    '',
    'course_schedule',
    p_closure_date
  from public.courses course
  cross join lateral (
    select timezone(
      'Europe/Rome',
      p_closure_date + course.start_time
    ) as starts_at
  ) occurrence
  where course.is_active
    and num_nonnulls(
      course.starts_on,
      course.ends_on,
      course.weekday,
      course.start_time
    ) = 4
    and p_closure_date between course.starts_on and course.ends_on
    and extract(isodow from p_closure_date)::smallint = course.weekday
    and occurrence.starts_at >= now()
    and not exists (
      select 1
      from public.school_closures closure
      where closure.closure_date = p_closure_date
    )
    and not exists (
      select 1
      from public.lessons manual_lesson
      where manual_lesson.course_id = course.id
        and manual_lesson.origin = 'manual'
        and manual_lesson.starts_at = occurrence.starts_at
        and manual_lesson.status not in (
          'cancelled_teacher',
          'cancelled_holiday',
          'cancelled_other'
        )
    )
  on conflict (course_id, occurrence_on)
    where origin = 'course_schedule'
    do nothing;
  get diagnostics v_restored = row_count;

  return v_restored;
end;
$$;

create or replace function private.apply_school_closure_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_school_closure_date(new.closure_date);
  return new;
end;
$$;

create trigger school_closures_apply_before_insert
before insert on public.school_closures
for each row execute function private.apply_school_closure_before_insert();

-- Cambiare la data equivale a due operazioni diverse; obbligare il passaggio
-- elimina + nuova chiusura mantiene entrambe atomiche e prevedibili.
create or replace function private.guard_school_closure_date_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.closure_date is distinct from new.closure_date then
    raise exception
      'Per cambiare data elimina la chiusura e creane una nuova'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger school_closures_guard_date_update
before update of closure_date on public.school_closures
for each row execute function private.guard_school_closure_date_update();

create or replace function private.restore_school_closure_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.restore_school_closure_date(old.closure_date);
  return old;
end;
$$;

create trigger school_closures_restore_after_delete
after delete on public.school_closures
for each row execute function private.restore_school_closure_after_delete();

create or replace function public.admin_upsert_school_closure(
  p_closure_date date,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.school_closures;
  v_description text := btrim(coalesce(p_description, ''));
  v_affected_courses integer := 0;
  v_manual_lessons integer := 0;
  v_removed_lessons integer := 0;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  if p_closure_date is null then
    raise exception 'Indica la data di chiusura' using errcode = '22023';
  end if;
  if p_closure_date < (now() at time zone 'Europe/Rome')::date then
    raise exception
      'Una chiusura puo essere inserita soltanto da oggi in avanti'
      using errcode = '22023';
  end if;
  if char_length(v_description) > 120 then
    raise exception 'La descrizione non puo superare 120 caratteri'
      using errcode = '22023';
  end if;

  select count(*)
  into v_affected_courses
  from public.courses course
  where course.is_active
    and num_nonnulls(
      course.starts_on,
      course.ends_on,
      course.weekday,
      course.start_time
    ) = 4
    and p_closure_date between course.starts_on and course.ends_on
    and extract(isodow from p_closure_date)::smallint = course.weekday;

  select count(*)
  into v_manual_lessons
  from public.lessons lesson
  where lesson.origin = 'manual'
    and (lesson.starts_at at time zone 'Europe/Rome')::date = p_closure_date
    and lesson.status = 'scheduled';

  select count(*)
  into v_removed_lessons
  from public.lessons lesson
  where lesson.origin = 'course_schedule'
    and lesson.occurrence_on = p_closure_date
    and lesson.status = 'scheduled';

  -- Il BEFORE INSERT esegue controllo, lock e rimozione nella stessa
  -- transazione. Anche un upsert ripetuto riconcilia nuovamente la data.
  insert into public.school_closures (
    closure_date,
    description,
    created_by
  )
  values (
    p_closure_date,
    v_description,
    auth.uid()
  )
  on conflict (closure_date) do update
    set description = excluded.description
  returning * into v_closure;

  return jsonb_build_object(
    'closure', to_jsonb(v_closure),
    'affected_courses', v_affected_courses,
    'manual_lessons', v_manual_lessons,
    'removed_lessons', v_removed_lessons,
    'protected_lessons', 0
  );
end;
$$;

create or replace function public.admin_delete_school_closure(
  p_closure_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.school_closures;
  v_restored_lessons integer := 0;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  delete from public.school_closures closure
  where closure.id = p_closure_id
  returning * into v_closure;

  if not found then
    raise exception 'Chiusura non trovata' using errcode = 'P0002';
  end if;

  -- L'AFTER DELETE ha gia ripristinato, se ancora futura, esclusivamente
  -- l'occorrenza compatibile con la programmazione attuale dei corsi.
  select count(*)
  into v_restored_lessons
  from public.lessons lesson
  where lesson.origin = 'course_schedule'
    and lesson.occurrence_on = v_closure.closure_date
    and lesson.status = 'scheduled';

  return jsonb_build_object(
    'closure', to_jsonb(v_closure),
    'restored_lessons', v_restored_lessons
  );
end;
$$;

revoke all on function private.skip_course_lesson_on_school_closure()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_lesson_update_on_school_closure()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_school_closure_attendance()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_school_closure_makeup_credit()
  from public, anon, authenticated, service_role;
revoke all on function private.apply_school_closure_date(date)
  from public, anon, authenticated, service_role;
revoke all on function private.restore_school_closure_date(date)
  from public, anon, authenticated, service_role;
revoke all on function private.apply_school_closure_before_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_school_closure_date_update()
  from public, anon, authenticated, service_role;
revoke all on function private.restore_school_closure_after_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_upsert_school_closure(date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_school_closure(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_upsert_school_closure(date, text)
  to authenticated;
grant execute on function public.admin_delete_school_closure(uuid)
  to authenticated;
