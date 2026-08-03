-- Bootstrap esplicito e idempotente della prima amministratrice di produzione.
-- L'utente deve essere creato prima tramite Supabase Authentication; questa
-- migrazione non crea credenziali e non contiene password o API key.

begin;

create or replace function private.bootstrap_first_admin()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_email constant text := 'quartomov@gmail.com';
  v_expected_display_name constant text := 'Valeria d''Argenio';
  v_auth_user_id uuid;
  v_match_count integer;
  v_profile public.profiles;
begin
  -- Non affidarsi al current_user: nelle funzioni SECURITY DEFINER coincide
  -- con il proprietario. session_user identifica invece la connessione reale.
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Bootstrap eseguibile soltanto dal SQL Editor amministrativo'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into v_match_count
  from auth.users u
  where lower(btrim(u.email)) = lower(v_expected_email);

  if v_match_count = 0 then
    raise exception
      'Creare prima l''utente Auth %, poi ripetere il bootstrap',
      v_expected_email
      using errcode = 'P0002';
  elsif v_match_count <> 1 then
    raise exception 'Trovati % utenti Auth con email %',
      v_match_count,
      v_expected_email
      using errcode = '23514';
  end if;

  select u.id
  into v_auth_user_id
  from auth.users u
  where lower(btrim(u.email)) = lower(v_expected_email)
  for key share;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = v_auth_user_id
  for update;

  if not found then
    raise exception
      'Profilo applicativo non trovato per %. Verificare le migrazioni e riprovare',
      v_expected_email
      using errcode = 'P0002';
  end if;

  if lower(btrim(coalesce(v_profile.email, ''))) <>
     lower(v_expected_email) then
    raise exception 'Email Auth e profilo applicativo non coerenti'
      using errcode = '23514';
  end if;

  if not v_profile.is_active then
    raise exception
      'Il profilo di % è disattivato: riattivarlo richiede una decisione esplicita',
      v_expected_email
      using errcode = '23514';
  end if;

  -- Se il ruolo era già corretto, normalizza il nome soltanto quando serve.
  -- Le esecuzioni successive diventano quindi un no-op verificabile.
  if v_profile.role = 'admin' then
    if v_profile.display_name is distinct from v_expected_display_name then
      update public.profiles p
      set display_name = v_expected_display_name
      where p.id = v_profile.id
      returning p.* into v_profile;
    end if;
    return v_profile;
  end if;

  if exists (
    select 1
    from public.profiles existing_admin
    where existing_admin.role = 'admin'
      and existing_admin.is_active
      and existing_admin.id <> v_profile.id
  ) then
    raise exception
      'Esiste già un''altra amministratrice attiva: bootstrap annullato'
      using errcode = '23514';
  end if;

  update public.profiles p
  set role = 'admin',
      display_name = v_expected_display_name
  where p.id = v_profile.id
  returning p.* into v_profile;

  return v_profile;
end;
$$;

comment on function private.bootstrap_first_admin() is
  'Promuove idempotentemente quartomov@gmail.com come primo admin; solo SQL Editor.';

revoke all on function private.bootstrap_first_admin()
  from public, anon, authenticated, service_role;
grant execute on function private.bootstrap_first_admin()
  to postgres, supabase_admin;

commit;
