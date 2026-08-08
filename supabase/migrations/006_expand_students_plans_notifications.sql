-- Estende anagrafica, piani, archiviazione e comunicazioni famiglia/admin.
-- Gli "elimina" applicativi sono archiviazioni: lo storico didattico e
-- contabile resta integro e continua a rispettare i vincoli referenziali.

begin;

-- ---------------------------------------------------------------------------
-- Anagrafica allievi e tipi di piano
-- ---------------------------------------------------------------------------

alter table public.students
  add column fiscal_code text not null default '',
  add column residence_address text not null default '';

alter table public.students
  add constraint students_fiscal_code_format check (
    fiscal_code = '' or fiscal_code ~ '^[A-Z0-9]{16}$'
  ),
  add constraint students_residence_address_not_blank check (
    residence_address = '' or btrim(residence_address) <> ''
  );

create unique index students_fiscal_code_uidx
  on public.students (fiscal_code)
  where fiscal_code <> '';

alter table public.enrollments
  drop constraint if exists enrollments_plan_type_check;

alter table public.enrollments
  add constraint enrollments_plan_type_check check (
    plan_type in (
      'trial',
      'trial_package_2',
      'monthly',
      'quarterly',
      'annual',
      'workshop',
      -- Valori mantenuti per lo storico e non proposti nei nuovi moduli.
      'semester',
      'custom'
    )
  );

-- Salvataggio atomico di famiglia, allievo e iscrizione. Oltre ai nuovi dati
-- anagrafici accetta `enrollment_notes` nel payload piatto del frontend,
-- continuando a supportare la forma annidata `enrollment.notes`.
create or replace function public.admin_upsert_student_family(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_data jsonb;
  v_student_data jsonb;
  v_enrollment_data jsonb;
  v_family public.families;
  v_student public.students;
  v_current_enrollment public.enrollments;
  v_enrollment public.enrollments;
  v_family_id uuid;
  v_student_id uuid;
  v_course_id uuid;
  v_starts_on date;
  v_plan_type text;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload deve essere un oggetto JSON'
      using errcode = '22023';
  end if;

  v_family_data := coalesce(p_payload -> 'family', '{}'::jsonb);
  v_student_data := coalesce(p_payload -> 'student', '{}'::jsonb);
  v_enrollment_data := coalesce(p_payload -> 'enrollment', '{}'::jsonb);

  begin
    v_family_id := nullif(
      coalesce(p_payload ->> 'family_id', v_family_data ->> 'id'),
      ''
    )::uuid;
    v_student_id := nullif(
      coalesce(
        p_payload ->> 'student_id',
        p_payload ->> 'id',
        v_student_data ->> 'id'
      ),
      ''
    )::uuid;
    v_course_id := nullif(
      coalesce(
        v_enrollment_data ->> 'course_id',
        p_payload ->> 'course_id'
      ),
      ''
    )::uuid;
  exception when invalid_text_representation then
    raise exception 'Identificativo UUID non valido' using errcode = '22023';
  end;

  if v_student_id is not null then
    select * into v_student
    from public.students
    where id = v_student_id
    for update;
    if not found then
      raise exception 'Allievo non trovato' using errcode = 'P0002';
    end if;
    if v_family_id is null then
      v_family_id := v_student.family_id;
    elsif v_family_id <> v_student.family_id then
      raise exception
        'Lo spostamento di un allievo tra famiglie richiede una procedura dedicata'
        using errcode = '23514';
    end if;
  end if;

  if v_family_id is null then
    insert into public.families (
      display_name,
      guardian_name,
      email,
      phone,
      notes
    )
    values (
      coalesce(
        nullif(btrim(v_family_data ->> 'display_name'), ''),
        nullif(btrim(p_payload ->> 'family_display_name'), ''),
        nullif(btrim(p_payload ->> 'display_name'), ''),
        'Famiglia ' || coalesce(
          nullif(btrim(v_student_data ->> 'last_name'), ''),
          nullif(btrim(p_payload ->> 'last_name'), ''),
          nullif(btrim(v_family_data ->> 'guardian_name'), ''),
          nullif(btrim(p_payload ->> 'guardian_name'), ''),
          'da completare'
        )
      ),
      coalesce(
        nullif(btrim(v_family_data ->> 'guardian_name'), ''),
        nullif(btrim(p_payload ->> 'guardian_name'), ''),
        'Da completare'
      ),
      coalesce(
        nullif(lower(btrim(v_family_data ->> 'email')), ''),
        nullif(lower(btrim(p_payload ->> 'email')), ''),
        'da-completare-' || gen_random_uuid()::text || '@invalid.local'
      ),
      coalesce(
        nullif(btrim(v_family_data ->> 'phone'), ''),
        nullif(btrim(p_payload ->> 'phone'), '')
      ),
      coalesce(v_family_data ->> 'notes', '')
    )
    returning * into v_family;
    v_family_id := v_family.id;
  else
    select * into v_family
    from public.families
    where id = v_family_id
    for update;
    if not found then
      raise exception 'Famiglia non trovata' using errcode = 'P0002';
    end if;

    update public.families
    set display_name = coalesce(
          nullif(btrim(v_family_data ->> 'display_name'), ''),
          nullif(btrim(p_payload ->> 'family_display_name'), ''),
          nullif(btrim(p_payload ->> 'display_name'), ''),
          display_name
        ),
        guardian_name = coalesce(
          nullif(btrim(v_family_data ->> 'guardian_name'), ''),
          nullif(btrim(p_payload ->> 'guardian_name'), ''),
          guardian_name
        ),
        email = coalesce(
          nullif(lower(btrim(v_family_data ->> 'email')), ''),
          nullif(lower(btrim(p_payload ->> 'email')), ''),
          email
        ),
        phone = coalesce(
          nullif(btrim(v_family_data ->> 'phone'), ''),
          nullif(btrim(p_payload ->> 'phone'), ''),
          phone
        ),
        notes = coalesce(v_family_data ->> 'notes', notes)
    where id = v_family_id
    returning * into v_family;
  end if;

  if v_student_id is null then
    insert into public.students (
      family_id,
      first_name,
      last_name,
      birth_date,
      fiscal_code,
      residence_address,
      notes,
      is_active
    )
    values (
      v_family_id,
      coalesce(
        nullif(v_student_data ->> 'first_name', ''),
        nullif(p_payload ->> 'first_name', '')
      ),
      coalesce(
        nullif(v_student_data ->> 'last_name', ''),
        nullif(p_payload ->> 'last_name', '')
      ),
      nullif(
        coalesce(v_student_data ->> 'birth_date', p_payload ->> 'birth_date'),
        ''
      )::date,
      upper(regexp_replace(
        coalesce(
          v_student_data ->> 'fiscal_code',
          p_payload ->> 'fiscal_code',
          ''
        ),
        '[[:space:]]',
        '',
        'g'
      )),
      btrim(coalesce(
        v_student_data ->> 'residence_address',
        p_payload ->> 'residence_address',
        ''
      )),
      coalesce(
        v_student_data ->> 'notes',
        p_payload ->> 'notes',
        ''
      ),
      coalesce(
        nullif(v_student_data ->> 'is_active', '')::boolean,
        nullif(p_payload ->> 'is_active', '')::boolean,
        true
      )
    )
    returning * into v_student;
    v_student_id := v_student.id;
  else
    update public.students
    set first_name = coalesce(
          nullif(v_student_data ->> 'first_name', ''),
          nullif(p_payload ->> 'first_name', ''),
          first_name
        ),
        last_name = coalesce(
          nullif(v_student_data ->> 'last_name', ''),
          nullif(p_payload ->> 'last_name', ''),
          last_name
        ),
        birth_date = coalesce(
          nullif(v_student_data ->> 'birth_date', '')::date,
          nullif(p_payload ->> 'birth_date', '')::date,
          birth_date
        ),
        fiscal_code = case
          when v_student_data ? 'fiscal_code' then upper(regexp_replace(
            coalesce(v_student_data ->> 'fiscal_code', ''),
            '[[:space:]]',
            '',
            'g'
          ))
          when p_payload ? 'fiscal_code' then upper(regexp_replace(
            coalesce(p_payload ->> 'fiscal_code', ''),
            '[[:space:]]',
            '',
            'g'
          ))
          else fiscal_code
        end,
        residence_address = case
          when v_student_data ? 'residence_address'
            then btrim(coalesce(v_student_data ->> 'residence_address', ''))
          when p_payload ? 'residence_address'
            then btrim(coalesce(p_payload ->> 'residence_address', ''))
          else residence_address
        end,
        notes = coalesce(
          v_student_data ->> 'notes',
          p_payload ->> 'notes',
          notes
        ),
        is_active = coalesce(
          nullif(v_student_data ->> 'is_active', '')::boolean,
          nullif(p_payload ->> 'is_active', '')::boolean,
          is_active
        )
    where id = v_student_id
    returning * into v_student;
  end if;

  select * into v_current_enrollment
  from public.enrollments e
  where e.student_id = v_student_id
    and e.is_active
  order by e.starts_on desc, e.created_at desc
  limit 1
  for update;

  if v_course_id is not null then
    if not exists (
      select 1
      from public.courses c
      where c.id = v_course_id
        and c.is_active
    ) then
      raise exception 'Corso non trovato o inattivo' using errcode = '23514';
    end if;

    v_starts_on := coalesce(
      nullif(v_enrollment_data ->> 'starts_on', '')::date,
      nullif(p_payload ->> 'starts_on', '')::date,
      case
        when v_current_enrollment.course_id = v_course_id
          then v_current_enrollment.starts_on
        else null
      end,
      current_date
    );
    v_plan_type := coalesce(
      nullif(v_enrollment_data ->> 'plan_type', ''),
      nullif(p_payload ->> 'plan_type', ''),
      'monthly'
    );

    if v_current_enrollment.id is null
       or v_current_enrollment.course_id <> v_course_id then
      update public.enrollments e
      set is_active = false,
          ends_on = case
            when e.starts_on < v_starts_on
              then least(coalesce(e.ends_on, v_starts_on - 1), v_starts_on - 1)
            else e.starts_on
          end
      where e.student_id = v_student_id
        and e.is_active;

      insert into public.enrollments (
        student_id,
        course_id,
        plan_type,
        starts_on,
        ends_on,
        recovery_allowed,
        recovery_notice_hours,
        is_active,
        notes
      )
      values (
        v_student_id,
        v_course_id,
        v_plan_type,
        v_starts_on,
        nullif(
          coalesce(
            v_enrollment_data ->> 'ends_on',
            p_payload ->> 'ends_on'
          ),
          ''
        )::date,
        nullif(
          coalesce(
            v_enrollment_data ->> 'recovery_allowed',
            p_payload ->> 'recovery_allowed'
          ),
          ''
        )::boolean,
        nullif(
          coalesce(
            v_enrollment_data ->> 'recovery_notice_hours',
            p_payload ->> 'recovery_notice_hours'
          ),
          ''
        )::integer,
        true,
        coalesce(
          v_enrollment_data ->> 'notes',
          p_payload ->> 'enrollment_notes',
          ''
        )
      )
      returning * into v_enrollment;
    else
      update public.enrollments
      set plan_type = v_plan_type,
          starts_on = v_starts_on,
          ends_on = coalesce(
            nullif(v_enrollment_data ->> 'ends_on', '')::date,
            nullif(p_payload ->> 'ends_on', '')::date,
            ends_on
          ),
          recovery_allowed = coalesce(
            nullif(v_enrollment_data ->> 'recovery_allowed', '')::boolean,
            nullif(p_payload ->> 'recovery_allowed', '')::boolean,
            recovery_allowed
          ),
          recovery_notice_hours = coalesce(
            nullif(
              v_enrollment_data ->> 'recovery_notice_hours',
              ''
            )::integer,
            nullif(p_payload ->> 'recovery_notice_hours', '')::integer,
            recovery_notice_hours
          ),
          notes = case
            when v_enrollment_data ? 'notes'
              then coalesce(v_enrollment_data ->> 'notes', '')
            when p_payload ? 'enrollment_notes'
              then coalesce(p_payload ->> 'enrollment_notes', '')
            else notes
          end,
          is_active = true
      where id = v_current_enrollment.id
      returning * into v_enrollment;
    end if;
  else
    v_enrollment := v_current_enrollment;
  end if;

  return jsonb_build_object(
    'family', to_jsonb(v_family),
    'student', to_jsonb(v_student),
    'enrollment', case
      when v_enrollment.id is null then null
      else to_jsonb(v_enrollment)
    end
  );
exception
  when not_null_violation or check_violation or invalid_datetime_format then
    raise exception 'Dati famiglia, allievo o iscrizione non validi: %', sqlerrm
      using errcode = '22023';
end;
$$;

-- Il piano trimestrale eredita lo stesso diritto predefinito ai recuperi dei
-- piani annuali e dei vecchi piani semestrali. `recovery_allowed`, quando
-- valorizzato sull'iscrizione, continua ad avere precedenza sul predefinito.
create or replace function public.mark_attendance_batch(
  p_lesson_id uuid,
  p_entries jsonb
)
returns setof public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_student_id uuid;
  v_status text;
  v_notified_at timestamptz;
  v_lesson public.lessons;
  v_enrollment public.enrollments;
  v_notice_hours integer;
  v_recovery_allowed boolean;
  v_reason text;
  v_makeup_deadline date;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries deve essere un array JSON'
      using errcode = '22023';
  end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id
  for update;
  if not found then
    raise exception 'Lezione non trovata' using errcode = 'P0002';
  end if;

  select nullif(s.value #>> '{}', '')::date
  into v_makeup_deadline
  from public.app_settings s
  where s.key = 'makeup_deadline';

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    begin
      v_student_id := (v_entry ->> 'student_id')::uuid;
    exception when others then
      raise exception 'student_id non valido' using errcode = '22023';
    end;

    v_status := coalesce(v_entry ->> 'status', 'pending');
    if v_status not in (
      'pending',
      'present',
      'absent_excused',
      'absent_unexcused'
    ) then
      raise exception 'Stato presenza non valido: %', v_status
        using errcode = '22023';
    end if;

    v_notified_at := nullif(v_entry ->> 'absence_notified_at', '')::timestamptz;

    insert into public.attendance (
      lesson_id,
      student_id,
      status,
      recorded_at,
      recorded_by,
      absence_notified_at,
      notes
    )
    values (
      p_lesson_id,
      v_student_id,
      v_status,
      case when v_status = 'pending' then null else now() end,
      auth.uid(),
      v_notified_at,
      coalesce(v_entry ->> 'notes', '')
    )
    on conflict (lesson_id, student_id) do update
      set status = excluded.status,
          recorded_at = excluded.recorded_at,
          recorded_by = excluded.recorded_by,
          absence_notified_at = excluded.absence_notified_at,
          notes = excluded.notes;

    select e.* into v_enrollment
    from public.enrollments e
    where e.student_id = v_student_id
      and e.course_id = v_lesson.course_id
      and e.is_active
      and e.starts_on <= (v_lesson.starts_at at time zone 'Europe/Rome')::date
      and (
        e.ends_on is null
        or e.ends_on >= (v_lesson.starts_at at time zone 'Europe/Rome')::date
      )
    order by e.starts_on desc
    limit 1;

    if v_lesson.lesson_type in ('makeup', 'recovery') then
      if v_status = 'pending' and exists (
        select 1
        from public.makeup_credits mc
        where mc.student_id = v_student_id
          and mc.used_lesson_id = p_lesson_id
          and mc.status = 'used'
      ) then
        raise exception
          'Un recupero già contabilizzato non può tornare in attesa'
          using errcode = '23514';
      elsif v_status <> 'pending' then
        update public.makeup_credits
        set status = 'used',
            used_at = coalesce(used_at, now()),
            reason = case
              when status = 'scheduled'
                and v_status in ('absent_excused', 'absent_unexcused')
                then concat_ws(
                  ' | ',
                  nullif(reason, ''),
                  'Credito consumato per assenza al recupero'
                )
              else reason
            end
        where student_id = v_student_id
          and used_lesson_id = p_lesson_id
          and status in ('scheduled', 'used');
      end if;

      continue;
    end if;

    if v_status in ('present', 'pending') then
      if exists (
        select 1
        from public.makeup_credits mc
        where mc.student_id = v_student_id
          and mc.source_lesson_id = p_lesson_id
          and mc.status in ('scheduled', 'used')
      ) then
        raise exception
          'Impossibile annullare l''assenza: il recupero è già assegnato o usato'
          using errcode = '23514';
      end if;

      update public.makeup_credits
      set status = 'cancelled',
          reason = 'Presenza aggiornata dall''amministratore'
      where student_id = v_student_id
        and source_lesson_id = p_lesson_id
        and status in ('available', 'not_eligible');

      if v_status = 'present' then
        update public.makeup_credits
        set status = 'used',
            used_at = coalesce(used_at, now())
        where student_id = v_student_id
          and used_lesson_id = p_lesson_id
          and status = 'scheduled';
      end if;

    elsif v_status in ('absent_excused', 'absent_unexcused') then
      v_notice_hours := coalesce(
        v_enrollment.recovery_notice_hours,
        (
          select (s.value #>> '{}')::integer
          from public.app_settings s
          where s.key = 'absence_notice_hours'
        ),
        24
      );
      v_recovery_allowed := coalesce(
        v_enrollment.recovery_allowed,
        v_enrollment.plan_type in ('quarterly', 'semester', 'annual')
      );

      if v_status = 'absent_unexcused' then
        v_recovery_allowed := false;
        v_reason := 'Assenza non giustificata';
      elsif not coalesce(v_recovery_allowed, false) then
        v_reason := 'Il piano non prevede recuperi';
      elsif v_notified_at is null then
        v_recovery_allowed := false;
        v_reason := 'Preavviso di assenza non registrato';
      elsif v_notified_at > v_lesson.starts_at - make_interval(hours => v_notice_hours) then
        v_recovery_allowed := false;
        v_reason := format('Preavviso inferiore a %s ore', v_notice_hours);
      else
        v_reason := 'Assenza comunicata nei termini';
      end if;

      insert into public.makeup_credits as existing_credit (
        student_id,
        enrollment_id,
        source_lesson_id,
        status,
        reason,
        expires_on
      )
      values (
        v_student_id,
        v_enrollment.id,
        p_lesson_id,
        case when coalesce(v_recovery_allowed, false)
          then 'available'
          else 'not_eligible'
        end,
        v_reason,
        case when coalesce(v_recovery_allowed, false)
          then least(
            v_enrollment.ends_on,
            v_makeup_deadline,
            current_date + 180
          )
          else null
        end
      )
      on conflict (student_id, source_lesson_id) do update
        set enrollment_id = excluded.enrollment_id,
            status = case
              when existing_credit.status in ('scheduled', 'used')
                then existing_credit.status
              else excluded.status
            end,
            reason = case
              when existing_credit.status in ('scheduled', 'used')
                then existing_credit.reason
              else excluded.reason
            end,
            expires_on = case
              when existing_credit.status in ('scheduled', 'used')
                then existing_credit.expires_on
              else excluded.expires_on
            end;
    end if;
  end loop;

  return query
  select a.*
  from public.attendance a
  where a.lesson_id = p_lesson_id
  order by a.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Archiviazione sicura di allievi e corsi
-- ---------------------------------------------------------------------------

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

  update public.students
  set is_active = false
  where id = p_student_id
  returning * into v_student;

  return jsonb_build_object(
    'student', to_jsonb(v_student),
    'closed_enrollments', v_closed_enrollments,
    'cancelled_makeups', v_cancelled_makeups
  );
end;
$$;

create or replace function public.admin_archive_course(
  p_course_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course public.courses;
  v_lesson record;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_closed_enrollments integer := 0;
  v_cancelled_lessons integer := 0;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  select * into v_course
  from public.courses
  where id = p_course_id
  for update;

  if not found then
    raise exception 'Corso non trovato' using errcode = 'P0002';
  end if;

  -- Usa l'RPC esistente affinché i crediti collegati a lezioni e recuperi
  -- annullati vengano riconciliati con le stesse regole del calendario.
  for v_lesson in
    select l.id
    from public.lessons l
    where l.course_id = p_course_id
      and l.status = 'scheduled'
      and l.starts_at >= now()
    order by l.starts_at
  loop
    perform public.update_lesson_status(
      v_lesson.id,
      'cancelled_other',
      'Corso archiviato'
    );
    v_cancelled_lessons := v_cancelled_lessons + 1;
  end loop;

  update public.enrollments e
  set is_active = false,
      ends_on = case
        when e.starts_on > v_today then e.starts_on
        else least(coalesce(e.ends_on, v_today), v_today)
      end
  where e.course_id = p_course_id
    and e.is_active;
  get diagnostics v_closed_enrollments = row_count;

  update public.courses
  set is_active = false
  where id = p_course_id
  returning * into v_course;

  return jsonb_build_object(
    'course', to_jsonb(v_course),
    'closed_enrollments', v_closed_enrollments,
    'cancelled_lessons', v_cancelled_lessons
  );
end;
$$;

-- Il frontend autenticato non può cancellare fisicamente lo storico. Le RPC
-- sopra sono l'unico percorso esposto per l'azione "Elimina".
revoke delete on public.students, public.courses from authenticated;

-- ---------------------------------------------------------------------------
-- Notifiche inviate dalle famiglie e ricevute nella dashboard admin
-- ---------------------------------------------------------------------------

create table public.family_notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null
    references public.families(id) on delete restrict,
  student_id uuid
    references public.students(id) on delete restrict,
  sender_user_id uuid not null
    references public.profiles(id) on delete restrict,
  kind text not null default 'general'
    check (kind in ('general', 'absence', 'schedule', 'makeup', 'payment')),
  message text not null,
  status text not null default 'unread'
    check (status in ('unread', 'read', 'resolved')),
  read_at timestamptz,
  read_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_notifications_message_valid check (
    char_length(btrim(message)) between 1 and 2000
  ),
  constraint family_notifications_read_state_valid check (
    (status = 'unread' and read_at is null and read_by is null)
    or
    (status in ('read', 'resolved') and read_at is not null and read_by is not null)
  )
);

create index family_notifications_status_created_idx
  on public.family_notifications (status, created_at desc);
create index family_notifications_family_created_idx
  on public.family_notifications (family_id, created_at desc);
create index family_notifications_student_created_idx
  on public.family_notifications (student_id, created_at desc)
  where student_id is not null;

create or replace function private.prepare_family_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_trusted boolean;
begin
  v_is_trusted :=
    (select private.is_admin())
    or session_user in ('postgres', 'supabase_admin')
    or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';

  if tg_op = 'INSERT' then
    if not v_is_trusted then
      -- Attribuzione e stato iniziale sono sempre determinati dal server.
      new.sender_user_id := auth.uid();
      new.status := 'unread';
      new.read_at := null;
      new.read_by := null;
      new.created_at := now();
      new.updated_at := now();
    elsif new.sender_user_id is null then
      new.sender_user_id := auth.uid();
    end if;
  else
    if old.family_id is distinct from new.family_id
       or old.student_id is distinct from new.student_id
       or old.sender_user_id is distinct from new.sender_user_id
       or old.kind is distinct from new.kind
       or old.message is distinct from new.message
       or old.created_at is distinct from new.created_at then
      raise exception 'Solo lo stato della notifica può essere modificato'
        using errcode = '42501';
    end if;

    if new.status = 'unread' then
      new.read_at := null;
      new.read_by := null;
    elsif new.status in ('read', 'resolved') then
      new.read_at := coalesce(old.read_at, new.read_at, now());
      new.read_by := coalesce(old.read_by, auth.uid(), new.read_by);
    end if;
  end if;

  if new.student_id is not null and not exists (
    select 1
    from public.students s
    where s.id = new.student_id
      and s.family_id = new.family_id
  ) then
    raise exception 'L''allievo non appartiene alla famiglia indicata'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger family_notifications_00_prepare
before insert or update on public.family_notifications
for each row execute function private.prepare_family_notification();

create trigger family_notifications_set_updated_at
before update on public.family_notifications
for each row execute function private.set_updated_at();

create trigger family_notifications_audit
after insert or update or delete on public.family_notifications
for each row execute function private.audit_row_change();

alter table public.family_notifications enable row level security;

create policy family_notifications_select
on public.family_notifications for select to authenticated
using ((select private.can_access_family(family_id)));

create policy family_notifications_family_insert
on public.family_notifications for insert to authenticated
with check (
  not (select private.is_admin())
  and (select private.can_access_family(family_id))
  and sender_user_id = (select auth.uid())
  and status = 'unread'
  and read_at is null
  and read_by is null
  and (
    student_id is null
    or exists (
      select 1
      from public.students s
      where s.id = family_notifications.student_id
        and s.family_id = family_notifications.family_id
        and (select private.can_access_student(s.id))
    )
  )
);

create policy family_notifications_admin_update
on public.family_notifications for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create or replace function public.admin_update_family_notification_status(
  p_notification_id uuid,
  p_status text
)
returns public.family_notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.family_notifications;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  if p_status not in ('unread', 'read', 'resolved') then
    raise exception 'Stato notifica non valido: %', coalesce(p_status, '(null)')
      using errcode = '22023';
  end if;

  update public.family_notifications
  set status = p_status
  where id = p_notification_id
  returning * into v_notification;

  if not found then
    raise exception 'Notifica non trovata' using errcode = 'P0002';
  end if;

  return v_notification;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegi e Realtime
-- ---------------------------------------------------------------------------

revoke all on public.family_notifications from anon, authenticated;
grant select, insert, update on public.family_notifications to authenticated;
grant all on public.family_notifications to service_role;

revoke all on function private.prepare_family_notification()
  from public, anon, authenticated, service_role;

revoke all on function public.admin_archive_student(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_archive_course(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_family_notification_status(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_archive_student(uuid)
  to authenticated;
grant execute on function public.admin_archive_course(uuid)
  to authenticated;
grant execute on function public.admin_update_family_notification_status(uuid, text)
  to authenticated;

-- CREATE OR REPLACE conserva normalmente gli ACL delle RPC preesistenti; le
-- allowlist sono ripetute per rendere la migrazione verificabile da sola.
revoke all on function public.admin_upsert_student_family(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_attendance_batch(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_student_family(jsonb)
  to authenticated;
grant execute on function public.mark_attendance_batch(uuid, jsonb)
  to authenticated;

alter table public.family_notifications replica identity full;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'family_notifications'
  ) then
    execute
      'alter publication supabase_realtime add table public.family_notifications';
  end if;
end;
$$;

commit;
