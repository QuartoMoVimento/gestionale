-- La causale del bonifico mostra nome, cognome e numero fattura nell'ordine
-- richiesto, sia per le configurazioni esistenti sia per le nuove installazioni.

begin;

insert into public.app_settings (
  key,
  value,
  description,
  visibility
) values (
  'bank_reference_template',
  '"{nome}, {cognome}, {numero}"'::jsonb,
  'Causale: nome, cognome e numero fattura',
  'authenticated'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    visibility = 'authenticated',
    updated_at = now();

commit;
