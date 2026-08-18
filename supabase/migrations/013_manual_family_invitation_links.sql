-- Persiste gli indirizzi autorizzati per una famiglia senza creare utenti Auth
-- e senza inviare e-mail. La creazione del link resta responsabilita esclusiva
-- della Edge Function, su richiesta esplicita dell'amministratrice.

begin;

create table public.family_access_emails (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null
    references public.families(id) on delete cascade,
  email text not null,
  is_primary boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_access_emails_email_normalized check (
    email = lower(btrim(email))
  ),
  constraint family_access_emails_email_length check (
    char_length(email) between 3 and 254
  ),
  constraint family_access_emails_email_format check (
    email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint family_access_emails_email_not_placeholder check (
    email not like '%@invalid.local'
  ),
  constraint family_access_emails_family_email_key unique (family_id, email)
);

create index family_access_emails_family_idx
  on public.family_access_emails (family_id, is_primary desc, email);

create index family_access_emails_email_idx
  on public.family_access_emails (email, family_id);

create unique index family_access_emails_one_primary_uidx
  on public.family_access_emails (family_id)
  where is_primary;

create trigger family_access_emails_set_updated_at
before update on public.family_access_emails
for each row execute function private.set_updated_at();

create trigger family_access_emails_audit
after insert or update or delete on public.family_access_emails
for each row execute function private.audit_row_change();

-- Importa gli indirizzi gia presenti. Le righe collegate a un profilo non
-- confermano che l'account Auth sia stato attivato: quello stato continua a
-- essere verificato esclusivamente lato server tramite la Admin API.
insert into public.family_access_emails (
  family_id,
  email,
  is_primary
)
select
  f.id,
  lower(btrim(f.email)),
  true
from public.families f
where char_length(lower(btrim(f.email))) between 3 and 254
  and lower(btrim(f.email))
    ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  and lower(btrim(f.email)) not like '%@invalid.local'
on conflict (family_id, email) do update
set is_primary = true;

insert into public.family_access_emails (
  family_id,
  email,
  is_primary
)
select distinct
  fu.family_id,
  lower(btrim(p.email)),
  false
from public.family_users fu
join public.profiles p on p.id = fu.user_id
where p.email is not null
  and char_length(lower(btrim(p.email))) between 3 and 254
  and lower(btrim(p.email))
    ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  and lower(btrim(p.email)) not like '%@invalid.local'
on conflict (family_id, email) do nothing;

alter table public.family_access_emails enable row level security;

create policy family_access_emails_admin_select
on public.family_access_emails for select to authenticated
using ((select private.is_admin()));

revoke all on public.family_access_emails from public, anon, authenticated;
grant select on public.family_access_emails to authenticated;
grant all on public.family_access_emails to service_role;

-- Wrapper della RPC esistente. Risolve la famiglia per e-mail prima del
-- salvataggio e registra gli indirizzi senza creare utenti Auth o link.
create or replace function public.admin_upsert_student_family_with_access(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_family_data jsonb;
  v_student_data jsonb;
  v_access_source jsonb;
  v_access_element jsonb;
  v_access_emails text[] := array[]::text[];
  v_candidate_family_ids uuid[] := array[]::uuid[];
  v_primary_email text;
  v_email text;
  v_family_id_text text;
  v_student_id_text text;
  v_result jsonb;
  v_result_family_id uuid;
  v_result_family_email text;
  v_access_rows jsonb;
  v_total_access_emails integer;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload deve essere un oggetto JSON'
      using errcode = '22023';
  end if;

  v_payload := p_payload;
  v_family_data := coalesce(p_payload -> 'family', '{}'::jsonb);
  v_student_data := coalesce(p_payload -> 'student', '{}'::jsonb);
  v_family_id_text := nullif(
    btrim(coalesce(p_payload ->> 'family_id', v_family_data ->> 'id', '')),
    ''
  );
  v_student_id_text := nullif(
    btrim(coalesce(
      p_payload ->> 'student_id',
      p_payload ->> 'id',
      v_student_data ->> 'id',
      ''
    )),
    ''
  );

  v_primary_email := lower(btrim(coalesce(
    nullif(v_family_data ->> 'email', ''),
    nullif(p_payload ->> 'email', ''),
    ''
  )));

  if v_primary_email = '' then
    raise exception 'La famiglia non ha un indirizzo e-mail principale'
      using errcode = '22023';
  end if;
  if char_length(v_primary_email) > 254
     or v_primary_email
       !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or v_primary_email like '%@invalid.local' then
    raise exception 'Indirizzo e-mail principale non valido'
      using errcode = '22023';
  end if;

  v_access_source := case
    when p_payload ? 'access_emails' then p_payload -> 'access_emails'
    when v_family_data ? 'access_emails'
      then v_family_data -> 'access_emails'
    -- Compatibilita con il nome usato dal frontend precedente: il wrapper
    -- persiste gli indirizzi ma non esegue alcun invito automatico.
    when p_payload ? 'invite_emails' then p_payload -> 'invite_emails'
    else '[]'::jsonb
  end;

  if v_access_source is null or jsonb_typeof(v_access_source) = 'null' then
    v_access_source := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_access_source) <> 'array' then
    raise exception 'access_emails deve essere un array JSON'
      using errcode = '22023';
  end if;

  for v_access_element in
    select value from jsonb_array_elements(v_access_source)
  loop
    if jsonb_typeof(v_access_element) <> 'string' then
      raise exception 'Ogni elemento di access_emails deve essere un indirizzo e-mail'
        using errcode = '22023';
    end if;

    v_email := lower(btrim(v_access_element #>> '{}'));
    if v_email = ''
       or char_length(v_email) > 254
       or v_email
         !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       or v_email like '%@invalid.local' then
      raise exception 'Indirizzo e-mail non valido in access_emails: %',
        coalesce(nullif(v_email, ''), '(vuoto)')
        using errcode = '22023';
    end if;

    if array_position(v_access_emails, v_email) is null then
      v_access_emails := array_append(v_access_emails, v_email);
    end if;
  end loop;

  if array_position(v_access_emails, v_primary_email) is null then
    v_access_emails := array_append(v_access_emails, v_primary_email);
  end if;

  select coalesce(array_agg(item order by item), array[]::text[])
  into v_access_emails
  from (
    select distinct unnest(v_access_emails) as item
  ) normalized_emails;

  if cardinality(v_access_emails) > 11 then
    raise exception 'Puoi indicare al massimo 11 indirizzi e-mail per famiglia'
      using errcode = '22023';
  end if;

  -- Tutti i lock sono acquisiti nello stesso ordine: richieste concorrenti con
  -- la stessa e-mail non possono creare due famiglie e liste sovrapposte non
  -- introducono deadlock con un ordine dipendente dal payload.
  foreach v_email in array v_access_emails
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('family-access-email:' || v_email, 0)
    );
  end loop;

  -- La risoluzione automatica si applica soltanto alla creazione di un nuovo
  -- allievo senza un nucleo esplicitamente selezionato. Un allievo esistente
  -- resta protetto dalle verifiche della RPC originale.
  if v_family_id_text is null and v_student_id_text is null then
    select coalesce(array_agg(candidate.family_id order by candidate.family_id),
                    array[]::uuid[])
    into v_candidate_family_ids
    from (
      select f.id as family_id
      from public.families f
      where f.is_active
        and lower(btrim(f.email)) = v_primary_email

      union

      select f.id as family_id
      from public.family_access_emails access_email
      join public.families f on f.id = access_email.family_id
      where f.is_active
        and access_email.email = v_primary_email

      union

      select f.id as family_id
      from public.profiles p
      join public.family_users fu on fu.user_id = p.id
      join public.families f on f.id = fu.family_id
      where f.is_active
        and p.email is not null
        and lower(btrim(p.email)) = v_primary_email
    ) candidate;

    if cardinality(v_candidate_family_ids) > 1 then
      raise exception
        'L''indirizzo % risulta associato a piu famiglie. Seleziona esplicitamente il nucleo esistente.',
        v_primary_email
        using errcode = '23514';
    elsif cardinality(v_candidate_family_ids) = 1 then
      v_payload := jsonb_set(
        v_payload,
        '{family_id}',
        to_jsonb(v_candidate_family_ids[1]::text),
        true
      );
    end if;
  end if;

  select public.admin_upsert_student_family(v_payload)
  into v_result;

  begin
    v_result_family_id := nullif(v_result #>> '{family,id}', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'La RPC di salvataggio ha restituito una famiglia non valida'
      using errcode = '22023';
  end;
  if v_result_family_id is null then
    raise exception 'La RPC di salvataggio non ha restituito la famiglia'
      using errcode = 'P0002';
  end if;

  v_result_family_email := lower(btrim(coalesce(
    v_result #>> '{family,email}',
    v_primary_email
  )));
  if v_result_family_email = ''
     or char_length(v_result_family_email) > 254
     or v_result_family_email
       !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or v_result_family_email like '%@invalid.local' then
    raise exception 'La famiglia salvata non ha un indirizzo e-mail valido'
      using errcode = '22023';
  end if;

  if array_position(v_access_emails, v_result_family_email) is null then
    v_access_emails := array_append(v_access_emails, v_result_family_email);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'family-access-email:' || v_result_family_email,
        0
      )
    );
  end if;
  v_primary_email := v_result_family_email;

  select coalesce(array_agg(item order by item), array[]::text[])
  into v_access_emails
  from (
    select distinct unnest(v_access_emails) as item
  ) normalized_result_emails;

  -- Un indirizzo gia attribuito a un altro nucleo attivo non viene mai
  -- spostato implicitamente. Questo protegge sia i contatti in attesa sia gli
  -- account Auth gia collegati.
  foreach v_email in array v_access_emails
  loop
    if exists (
      select 1
      from public.families f
      where f.is_active
        and f.id <> v_result_family_id
        and lower(btrim(f.email)) = v_email
    ) or exists (
      select 1
      from public.family_access_emails access_email
      join public.families f on f.id = access_email.family_id
      where f.is_active
        and f.id <> v_result_family_id
        and access_email.email = v_email
    ) or exists (
      select 1
      from public.profiles p
      join public.family_users fu on fu.user_id = p.id
      join public.families f on f.id = fu.family_id
      where f.is_active
        and f.id <> v_result_family_id
        and p.email is not null
        and lower(btrim(p.email)) = v_email
    ) then
      raise exception
        'L''indirizzo % e gia associato a un''altra famiglia attiva',
        v_email
        using errcode = '23514';
    end if;
  end loop;

  select count(distinct combined.email)::integer
  into v_total_access_emails
  from (
    select access_email.email
    from public.family_access_emails access_email
    where access_email.family_id = v_result_family_id

    union all

    select unnest(v_access_emails) as email
  ) combined;

  if v_total_access_emails > 11 then
    raise exception 'La famiglia ha gia raggiunto il limite di 11 indirizzi e-mail'
      using errcode = '22023';
  end if;

  -- Prima si rimuove l'indicazione primaria precedente, poi si eseguono gli
  -- upsert: l'indice parziale garantisce comunque un solo indirizzo principale.
  update public.family_access_emails
  set is_primary = false
  where family_id = v_result_family_id
    and is_primary;

  foreach v_email in array v_access_emails
  loop
    insert into public.family_access_emails (
      family_id,
      email,
      is_primary,
      created_by
    )
    values (
      v_result_family_id,
      v_email,
      v_email = v_primary_email,
      auth.uid()
    )
    on conflict (family_id, email) do update
    set is_primary = excluded.is_primary;
  end loop;

  select coalesce(
    jsonb_agg(to_jsonb(access_email) order by access_email.is_primary desc,
              access_email.email),
    '[]'::jsonb
  )
  into v_access_rows
  from public.family_access_emails access_email
  where access_email.family_id = v_result_family_id;

  return v_result || jsonb_build_object('access_emails', v_access_rows);
end;
$$;

revoke all on function public.admin_upsert_student_family_with_access(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_student_family_with_access(jsonb)
  to authenticated;

commit;
