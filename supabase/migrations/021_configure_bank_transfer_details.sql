-- Coordinate bancarie mostrate soltanto agli utenti autenticati e causale
-- precompilata per la singola scadenza insoluta.

begin;

insert into public.app_settings (key, value, description, visibility)
values
  (
    'bank_account_holder',
    to_jsonb('VALERIA D''ARGENIO'::text),
    'Intestataria del conto per i bonifici delle famiglie',
    'authenticated'
  ),
  (
    'bank_iban',
    to_jsonb('IT97S0347501605CC0013274072'::text),
    'IBAN per i bonifici delle famiglie',
    'authenticated'
  ),
  (
    'bank_reference_template',
    to_jsonb('{nome} {cognome} saldo fattura {numero}'::text),
    'Causale con allievo, saldo fattura e numero fattura',
    'authenticated'
  )
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    visibility = 'authenticated',
    updated_at = now();

commit;
