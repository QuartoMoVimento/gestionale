-- Il corso diventa la fonte unica delle lezioni ordinarie ricorrenti.
-- Le date manuali, le prove, gli eventi e i recuperi restano indipendenti.

alter table public.courses
  add column starts_on date,
  add column ends_on date,
  add column weekday smallint,
  add column start_time time without time zone;

alter table public.courses
  add constraint courses_schedule_complete check (
    num_nonnulls(starts_on, ends_on, weekday, start_time) in (0, 4)
  ),
  add constraint courses_schedule_dates_valid check (
    starts_on is null
    or (
      ends_on >= starts_on
      and ends_on <= starts_on + 731
    )
  ),
  add constraint courses_schedule_weekday_valid check (
    weekday is null or weekday between 1 and 7
  );

comment on column public.courses.starts_on is
  'Prima data del periodo in cui generare le lezioni ordinarie';
comment on column public.courses.ends_on is
  'Ultima data inclusa del periodo in cui generare le lezioni ordinarie';
comment on column public.courses.weekday is
  'Giorno ISO della lezione settimanale: lunedi=1, domenica=7';
comment on column public.courses.start_time is
  'Ora locale Europe/Rome della lezione settimanale';

alter table public.lessons
  add column origin text not null default 'manual',
  add column occurrence_on date;

alter table public.lessons
  add constraint lessons_origin_valid check (
    origin in ('manual', 'course_schedule')
  ),
  add constraint lessons_course_schedule_shape_valid check (
    (
      origin = 'manual'
      and occurrence_on is null
    )
    or
    (
      origin = 'course_schedule'
      and occurrence_on is not null
      and lesson_type = 'regular'
    )
  );

create unique index lessons_course_schedule_occurrence_uidx
  on public.lessons (course_id, occurrence_on)
  where origin = 'course_schedule';

create index lessons_origin_occurrence_idx
  on public.lessons (origin, occurrence_on, course_id);

comment on column public.lessons.origin is
  'manual per date indipendenti, course_schedule per lezioni generate dal corso';
comment on column public.lessons.occurrence_on is
  'Data locale stabile dell''occorrenza generata dal corso';

create or replace function private.sync_course_calendar(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course public.courses;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_had_managed boolean := false;
  v_prune_from date;
  v_generate_from date;
  v_first_occurrence date;
  v_removed integer := 0;
  v_created integer := 0;
  v_preserved integer := 0;
begin
  select *
  into v_course
  from public.courses c
  where c.id = p_course_id
  for update;

  if not found then
    raise exception 'Corso non trovato' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.lessons l
    where l.course_id = p_course_id
      and l.origin = 'course_schedule'
  )
  into v_had_managed;

  -- Al primo collegamento genera l'intero periodo richiesto. Dai salvataggi
  -- successivi riconcilia soltanto oggi e il futuro, preservando lo storico.
  v_prune_from := case
    when v_had_managed then v_today
    else coalesce(v_course.starts_on, v_today)
  end;

  select count(*)
  into v_preserved
  from public.lessons l
  where l.course_id = p_course_id
    and l.origin = 'course_schedule'
    and l.occurrence_on >= v_prune_from
    and (
      l.starts_at < now()
      or l.status <> 'scheduled'
      or exists (
        select 1 from public.attendance a where a.lesson_id = l.id
      )
      or exists (
        select 1
        from public.makeup_credits mc
        where mc.source_lesson_id = l.id
           or mc.used_lesson_id = l.id
      )
    );

  delete from public.lessons l
  where l.course_id = p_course_id
    and l.origin = 'course_schedule'
    and l.occurrence_on >= v_prune_from
    and l.starts_at >= now()
    and l.status = 'scheduled'
    and not exists (
      select 1 from public.attendance a where a.lesson_id = l.id
    )
    and not exists (
      select 1
      from public.makeup_credits mc
      where mc.source_lesson_id = l.id
         or mc.used_lesson_id = l.id
    );
  get diagnostics v_removed = row_count;

  if not v_course.is_active
     or num_nonnulls(
       v_course.starts_on,
       v_course.ends_on,
       v_course.weekday,
       v_course.start_time
     ) <> 4 then
    return jsonb_build_object(
      'created', v_created,
      'removed', v_removed,
      'preserved', v_preserved
    );
  end if;

  v_generate_from := case
    when v_had_managed then greatest(v_course.starts_on, v_today)
    else v_course.starts_on
  end;

  if v_generate_from > v_course.ends_on then
    return jsonb_build_object(
      'created', v_created,
      'removed', v_removed,
      'preserved', v_preserved
    );
  end if;

  v_first_occurrence := v_generate_from + (
    (v_course.weekday - extract(isodow from v_generate_from)::integer + 7) % 7
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
    v_course.id,
    occurrence.starts_at,
    occurrence.starts_at
      + make_interval(mins => v_course.duration_minutes),
    'regular',
    'scheduled',
    null,
    null,
    '',
    'course_schedule',
    occurrence.occurrence_on
  from (
    select
      generated.day_value::date as occurrence_on,
      timezone(
        'Europe/Rome',
        generated.day_value::date + v_course.start_time
      ) as starts_at
    from generate_series(
      v_first_occurrence::timestamp,
      v_course.ends_on::timestamp,
      interval '7 days'
    ) generated(day_value)
  ) occurrence
  where
    -- Durante una riconciliazione non ricreare una lezione gia iniziata oggi.
    (not v_had_managed or occurrence.starts_at >= now())
    and not exists (
      select 1
      from public.lessons manual_lesson
      where manual_lesson.course_id = v_course.id
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
  get diagnostics v_created = row_count;

  return jsonb_build_object(
    'created', v_created,
    'removed', v_removed,
    'preserved', v_preserved
  );
end;
$$;

create or replace function private.sync_course_calendar_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_course_calendar(new.id);
  return new;
end;
$$;

create trigger courses_sync_calendar_after_insert
after insert
on public.courses
for each row execute function private.sync_course_calendar_after_write();

create trigger courses_sync_calendar_after_update
after update of
  starts_on,
  ends_on,
  weekday,
  start_time,
  duration_minutes,
  is_active
on public.courses
for each row
when (
  old.starts_on is distinct from new.starts_on
  or old.ends_on is distinct from new.ends_on
  or old.weekday is distinct from new.weekday
  or old.start_time is distinct from new.start_time
  or old.duration_minutes is distinct from new.duration_minutes
  or old.is_active is distinct from new.is_active
)
execute function private.sync_course_calendar_after_write();

-- Le date generate si modificano dal corso; l'annullamento di una singola
-- lezione resta consentito tramite update_lesson_status().
create or replace function private.guard_course_schedule_lesson_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.origin = 'course_schedule' then
    raise exception
      'Questa lezione e collegata al corso: modifica la programmazione del corso'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger lessons_guard_course_schedule_update
before update of
  course_id,
  starts_at,
  ends_at,
  lesson_type,
  title,
  location,
  origin,
  occurrence_on
on public.lessons
for each row execute function private.guard_course_schedule_lesson_update();

create or replace function public.admin_upsert_course(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid := nullif(btrim(coalesce(p_payload ->> 'id', '')), '')::uuid;
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_color text := coalesce(nullif(btrim(p_payload ->> 'color'), ''), '#0f8f9f');
  v_location text := coalesce(btrim(p_payload ->> 'location'), '');
  v_duration integer := coalesce((p_payload ->> 'duration_minutes')::integer, 50);
  v_starts_on date := nullif(p_payload ->> 'starts_on', '')::date;
  v_ends_on date := nullif(p_payload ->> 'ends_on', '')::date;
  v_weekday smallint := nullif(p_payload ->> 'weekday', '')::smallint;
  v_start_time time := nullif(p_payload ->> 'start_time', '')::time;
  v_course public.courses;
  v_calendar_lessons integer := 0;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'Indica il nome del corso' using errcode = '22023';
  end if;
  if v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Colore del corso non valido' using errcode = '22023';
  end if;
  if v_duration not between 15 and 480 then
    raise exception 'Durata del corso non valida' using errcode = '22023';
  end if;
  if num_nonnulls(v_starts_on, v_ends_on, v_weekday, v_start_time) not in (0, 4) then
    raise exception
      'Compila insieme inizio, fine, giorno e ora del corso'
      using errcode = '22023';
  end if;
  if v_starts_on is not null
     and (
       v_ends_on < v_starts_on
       or v_ends_on > v_starts_on + 731
     ) then
    raise exception
      'Il periodo del corso deve essere valido e non superare due anni'
      using errcode = '22023';
  end if;
  if v_weekday is not null and v_weekday not between 1 and 7 then
    raise exception 'Giorno settimanale non valido' using errcode = '22023';
  end if;

  if v_course_id is null then
    insert into public.courses (
      name,
      color,
      location,
      duration_minutes,
      starts_on,
      ends_on,
      weekday,
      start_time
    )
    values (
      v_name,
      v_color,
      v_location,
      v_duration,
      v_starts_on,
      v_ends_on,
      v_weekday,
      v_start_time
    )
    returning * into v_course;
  else
    update public.courses c
    set name = v_name,
        color = v_color,
        location = v_location,
        duration_minutes = v_duration,
        starts_on = v_starts_on,
        ends_on = v_ends_on,
        weekday = v_weekday,
        start_time = v_start_time,
        is_active = true
    where c.id = v_course_id
    returning * into v_course;

    if not found then
      raise exception 'Corso non trovato' using errcode = 'P0002';
    end if;
  end if;

  select count(*)
  into v_calendar_lessons
  from public.lessons l
  where l.course_id = v_course.id
    and l.origin = 'course_schedule'
    and l.status = 'scheduled';

  return jsonb_build_object(
    'course', to_jsonb(v_course),
    'calendar_lessons', v_calendar_lessons
  );
end;
$$;

revoke all on function private.sync_course_calendar(uuid) from public;
revoke all on function private.sync_course_calendar_after_write() from public;
revoke all on function private.guard_course_schedule_lesson_update() from public;
revoke all on function public.admin_upsert_course(jsonb) from public;
grant execute on function public.admin_upsert_course(jsonb) to authenticated;

-- Da questo momento le scritture dei corsi passano dall'RPC atomica.
revoke insert, update on public.courses from authenticated;

-- Importazione iniziale: gli otto corsi ricorrenti gia presenti contengono
-- giorno e fascia oraria nel nome. Il periodo usa l'anno didattico configurato;
-- ogni corso potra poi essere personalizzato dall'interfaccia.
with academic_period as (
  select
    (max(value #>> '{}') filter (where key = 'academic_year_start'))::date
      as starts_on,
    (max(value #>> '{}') filter (where key = 'academic_year_end'))::date
      as ends_on
  from public.app_settings
), normalized_courses as (
  select
    c.id,
    translate(lower(c.name), U&'\00EC', 'i') as normalized_name,
    substring(c.name from '([0-2][0-9]:[0-5][0-9])')::time as start_time
  from public.courses c
  where c.is_active
), parsed_courses as (
  select
    normalized.id,
    case
      when position('lunedi' in normalized.normalized_name) > 0 then 1
      when position('martedi' in normalized.normalized_name) > 0 then 2
      when position('mercoledi' in normalized.normalized_name) > 0 then 3
      when position('giovedi' in normalized.normalized_name) > 0 then 4
      when position('venerdi' in normalized.normalized_name) > 0 then 5
      when position('sabato' in normalized.normalized_name) > 0 then 6
      when position('domenica' in normalized.normalized_name) > 0 then 7
      else null
    end::smallint as weekday,
    normalized.start_time
  from normalized_courses normalized
)
update public.courses c
set starts_on = period.starts_on,
    ends_on = period.ends_on,
    weekday = parsed.weekday,
    start_time = parsed.start_time
from parsed_courses parsed
cross join academic_period period
where c.id = parsed.id
  and parsed.weekday is not null
  and parsed.start_time is not null
  and period.starts_on is not null
  and period.ends_on is not null;
