-- Collega i recuperi manuali gia svolti al credito dell'assenza effettiva.
-- Serve per gli appuntamenti retroattivi creati senza scegliere esplicitamente
-- l'assenza da recuperare.

do $$
declare
  v_manual record;
  v_source public.makeup_credits;
begin
  for v_manual in
    select
      manual_credit.id as manual_credit_id,
      manual_credit.student_id,
      manual_credit.enrollment_id,
      manual_credit.used_lesson_id,
      manual_credit.reason as manual_reason,
      target_lesson.starts_at,
      attendance_record.recorded_at
    from public.makeup_credits manual_credit
    join public.lessons target_lesson
      on target_lesson.id = manual_credit.used_lesson_id
    join public.attendance attendance_record
      on attendance_record.lesson_id = target_lesson.id
     and attendance_record.student_id = manual_credit.student_id
     and attendance_record.status <> 'pending'
    where manual_credit.source_lesson_id is null
      and manual_credit.status = 'used'
      and target_lesson.lesson_type in ('makeup', 'recovery')
    order by target_lesson.starts_at
  loop
    select source_credit.* into v_source
    from public.makeup_credits source_credit
    join public.lessons source_lesson
      on source_lesson.id = source_credit.source_lesson_id
    where source_credit.student_id = v_manual.student_id
      and source_credit.source_lesson_id is not null
      and source_credit.status in (
        'available',
        'proposed',
        'not_eligible',
        'expired'
      )
      and source_lesson.starts_at <= v_manual.starts_at
      and (
        source_credit.expires_on is null
        or (v_manual.starts_at at time zone 'Europe/Rome')::date <=
          source_credit.expires_on
      )
    order by source_lesson.starts_at desc
    limit 1
    for update of source_credit;

    if not found then
      continue;
    end if;

    update public.makeup_credits
    set status = 'cancelled',
        used_lesson_id = null,
        used_at = null,
        reason = concat_ws(
          ' | ',
          nullif(v_manual.manual_reason, ''),
          'Sostituito dal credito dell''assenza collegata'
        )
    where id = v_manual.manual_credit_id
      and status = 'used';

    update public.makeup_credits
    set enrollment_id = coalesce(enrollment_id, v_manual.enrollment_id),
        used_lesson_id = v_manual.used_lesson_id,
        status = 'used',
        used_at = coalesce(v_manual.recorded_at, now()),
        reason = format(
          'Recupero completato il %s',
          (v_manual.starts_at at time zone 'Europe/Rome')::date
        )
    where id = v_source.id;

    update public.lessons
    set status = 'completed'
    where id = v_manual.used_lesson_id
      and status = 'scheduled';
  end loop;
end;
$$;
