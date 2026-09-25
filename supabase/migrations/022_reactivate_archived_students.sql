-- Consente all'amministratore di ripristinare un'anagrafica archiviata.
-- Le vecchie iscrizioni restano chiuse: il nuovo percorso viene scelto
-- esplicitamente dall'interfaccia dopo la riattivazione.

begin;

create or replace function public.admin_reactivate_student(
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
begin
  if not (select private.is_admin()) then
    raise exception 'Operazione riservata all''amministratore'
      using errcode = '42501';
  end if;

  update public.students
  set is_active = true
  where id = p_student_id
  returning * into v_student;

  if not found then
    raise exception 'Allievo non trovato' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'student', to_jsonb(v_student)
  );
end;
$$;

revoke all on function public.admin_reactivate_student(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_reactivate_student(uuid)
  to authenticated;

commit;
