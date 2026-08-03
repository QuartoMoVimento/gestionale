-- Impedisce a un account famiglia di attribuire a un altro utente una
-- segnalazione di bonifico o di retrodatare il momento di invio tramite API.

begin;

create or replace function private.stamp_bank_notice_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Admin, service role e connessioni amministrative possono importare dati
  -- storici mantenendo attribuzione e timestamp espliciti.
  if (select private.is_admin())
     or session_user in ('postgres', 'supabase_admin')
     or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    return new;
  end if;

  -- Per le famiglie questi campi sono sempre determinati dal server: i valori
  -- eventualmente inviati dal client non sono considerati attendibili.
  new.submitted_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger bank_notices_00_stamp_submission
before insert on public.bank_transfer_notices
for each row execute function private.stamp_bank_notice_submission();

revoke all on function private.stamp_bank_notice_submission()
  from public, anon, authenticated, service_role;

-- La policy rende esplicito lo stesso vincolo al confine RLS. Il trigger viene
-- eseguito prima del WITH CHECK, quindi il normale inserimento del frontend
-- (che omette questi campi) continua a funzionare.
alter policy bank_notices_family_insert
on public.bank_transfer_notices
with check (
  not (select private.is_admin())
  and (select private.can_access_family(family_id))
  and (select private.can_access_invoice(invoice_id))
  and status = 'submitted'
  and reviewed_by is null
  and reviewed_at is null
  and submitted_by = (select auth.uid())
  and created_at = (select now())
  and updated_at = (select now())
);

commit;
