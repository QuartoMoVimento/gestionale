-- Quando viene archiviato un allievo, annulla anche una sua eventuale sessione
-- futura di recupero rimasta senza altri partecipanti. Le sessioni condivise
-- restano invece attive per gli altri allievi assegnati.

begin;

create or replace function public.admin_archive_student(
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_closed_enrollments integer := 0;
  v_cancelled_makeups integer := 0;
  v_cancelled_makeup_lessons integer := 0;
  v_makeup_lesson_ids uuid[] := '{}'::uuid[];
  v_makeup_lesson_id uuid;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found then
    raise exception 'Allievo non trovato' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct mc.used_lesson_id), '{}'::uuid[])
  into v_makeup_lesson_ids
  from public.makeup_credits mc
  join public.lessons l on l.id = mc.used_lesson_id
  where mc.student_id = p_student_id
    and mc.status = 'scheduled'
    and l.lesson_type in ('makeup', 'recovery')
    and l.status = 'scheduled'
    and l.starts_at >= now();

  update public.enrollments e
  set is_active = false,
      ends_on = case
        when e.starts_on > v_today then e.starts_on
        else least(coalesce(e.ends_on, v_today), v_today)
      end
  where e.student_id = p_student_id
    and e.is_active;
  get diagnostics v_closed_enrollments = row_count;

  update public.makeup_credits mc
  set status = 'cancelled',
      used_lesson_id = null,
      used_at = null,
      reason = concat_ws(
        ' · ',
        nullif(mc.reason, ''),
        'Allievo archiviato'
      )
  where mc.student_id = p_student_id
    and mc.status in ('available', 'proposed', 'scheduled');
  get diagnostics v_cancelled_makeups = row_count;

  foreach v_makeup_lesson_id in array v_makeup_lesson_ids
  loop
    perform 1
    from public.lessons
    where id = v_makeup_lesson_id
    for update;

    if not exists (
      select 1
      from public.makeup_credits mc
      where mc.used_lesson_id = v_makeup_lesson_id
        and mc.status in ('scheduled', 'used')
    ) then
      perform public.update_lesson_status(
        v_makeup_lesson_id,
        'cancelled_other',
        'Sessione di recupero non più necessaria dopo l''archiviazione dell''allievo'
      );
      v_cancelled_makeup_lessons := v_cancelled_makeup_lessons + 1;
    end if;
  end loop;

  update public.students
  set is_active = false
  where id = p_student_id
  returning * into v_student;

  return jsonb_build_object(
    'student', to_jsonb(v_student),
    'closed_enrollments', v_closed_enrollments,
    'cancelled_makeups', v_cancelled_makeups,
    'cancelled_makeup_lessons', v_cancelled_makeup_lessons
  );
end;
$$;

revoke all on function public.admin_archive_student(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_archive_student(uuid)
  to authenticated;

commit;
