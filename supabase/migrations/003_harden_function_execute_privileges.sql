-- Corregge i grant EXECUTE espliciti creati dai default privilege di Supabase.
-- Il solo REVOKE da PUBLIC non basta quando anon/authenticated hanno un grant
-- diretto. La strategia è deny-by-default, seguita da allowlist esplicite.

begin;

-- Nessuna funzione futura creata dallo stesso ruolo della migrazione deve
-- diventare automaticamente una RPC. Ogni nuova funzione pubblica richiederà
-- un GRANT esplicito nella propria migrazione.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

-- Reset completo dei privilegi API attuali. I trigger continuano a funzionare:
-- PostgreSQL verifica EXECUTE quando il trigger viene creato, non a ogni DML.
revoke execute on all functions in schema public
  from public, anon, authenticated, service_role;
revoke execute on all functions in schema private
  from public, anon, authenticated, service_role;

-- Helper SECURITY DEFINER indispensabili alle policy RLS.
grant execute on function private.is_admin()
  to authenticated;
grant execute on function private.can_access_family(uuid)
  to authenticated;
grant execute on function private.can_access_student(uuid)
  to authenticated;
grant execute on function private.can_access_invoice(uuid)
  to authenticated;

-- RPC amministrative: PostgREST può invocarle solo con una sessione
-- authenticated; ciascuna conserva anche il proprio controllo is_admin().
grant execute on function public.admin_upsert_student_family(jsonb)
  to authenticated;
grant execute on function public.reschedule_lesson(
  uuid, timestamptz, timestamptz, text, text, text
) to authenticated;
grant execute on function public.mark_attendance_batch(uuid, jsonb)
  to authenticated;
grant execute on function public.assign_makeup_credit(uuid, uuid)
  to authenticated;
grant execute on function public.update_lesson_status(uuid, text, text)
  to authenticated;
grant execute on function public.confirm_bank_transfer(uuid, text)
  to authenticated;
grant execute on function public.admin_mark_invoice_paid(uuid, text)
  to authenticated;
grant execute on function public.reject_bank_transfer(uuid, text)
  to authenticated;
grant execute on function public.refresh_overdue_invoices()
  to authenticated;

-- RPC PayPal riservate alle Edge Functions con service role.
grant execute on function public.begin_paypal_capture(text, integer)
  to service_role;
grant execute on function public.release_paypal_capture(text, text)
  to service_role;
grant execute on function public.record_paypal_capture(
  text, text, text, integer, text, jsonb
) to service_role;
grant execute on function public.process_paypal_webhook(
  text, text, jsonb, jsonb
) to service_role;

-- Il reset non revoca postgres/supabase_admin, ma questi GRANT documentano e
-- rendono verificabile l'unico accesso previsto al bootstrap di produzione.
grant execute on function private.bootstrap_first_admin()
  to postgres, supabase_admin;

commit;
