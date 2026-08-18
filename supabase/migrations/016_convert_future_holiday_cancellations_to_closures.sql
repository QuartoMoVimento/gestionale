-- Converte le festivita future gia indicate con il vecchio annullamento della
-- singola lezione in chiusure globali della data. Le verifiche della 015
-- proteggono presenze, recuperi, appuntamenti manuali e storico.

do $$
declare
  v_closure_date date;
begin
  for v_closure_date in
    select distinct lesson.occurrence_on
    from public.lessons lesson
    where lesson.origin = 'course_schedule'
      and lesson.status = 'cancelled_holiday'
      and lesson.occurrence_on >=
        (now() at time zone 'Europe/Rome')::date
    order by lesson.occurrence_on
  loop
    if exists (
      select 1
      from public.school_closures closure
      where closure.closure_date = v_closure_date
    ) then
      if exists (
        select 1
        from public.attendance attendance
        join public.lessons lesson on lesson.id = attendance.lesson_id
        where lesson.origin = 'course_schedule'
          and lesson.occurrence_on = v_closure_date
          and lesson.status = 'cancelled_holiday'
      ) or exists (
        select 1
        from public.makeup_credits credit
        join public.lessons lesson
          on lesson.id = credit.source_lesson_id
          or lesson.id = credit.used_lesson_id
        where lesson.origin = 'course_schedule'
          and lesson.occurrence_on = v_closure_date
          and lesson.status = 'cancelled_holiday'
      ) then
        raise exception
          'La festivita del % ha dati collegati e non puo essere convertita',
          v_closure_date
          using errcode = '23514';
      end if;

      delete from public.lessons lesson
      where lesson.origin = 'course_schedule'
        and lesson.occurrence_on = v_closure_date
        and lesson.status = 'cancelled_holiday';
      continue;
    end if;

    update public.lessons lesson
    set status = 'scheduled',
        cancellation_reason = null
    where lesson.origin = 'course_schedule'
      and lesson.occurrence_on = v_closure_date
      and lesson.status = 'cancelled_holiday';

    insert into public.school_closures (
      closure_date,
      description,
      created_by
    )
    values (
      v_closure_date,
      '',
      null
    );
  end loop;
end;
$$;
