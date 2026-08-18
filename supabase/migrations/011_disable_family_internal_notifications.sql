-- Disattiva le comunicazioni interne famiglia -> amministratrice.
-- Restano disponibili soltanto i contatti esterni WhatsApp e TidyCal.

begin;

-- Le righe storiche restano consultabili nel database, ma nessun account
-- famiglia può più creare notifiche o segnalazioni di bonifico.
drop policy if exists family_notifications_family_insert
  on public.family_notifications;

drop policy if exists bank_notices_family_insert
  on public.bank_transfer_notices;

-- Il REVOKE rende il blocco indipendente dalle sole policy RLS e impedisce
-- anche inserimenti diretti da sessioni authenticated. Il service_role resta
-- disponibile esclusivamente per eventuale manutenzione amministrativa.
revoke insert on public.family_notifications from authenticated;
revoke insert on public.bank_transfer_notices from authenticated;

-- Non modificare automaticamente le segnalazioni storiche ancora submitted:
-- potrebbero riferirsi a bonifici realmente eseguiti. Rimangono nello stato
-- corrente e continuano a impedire un secondo pagamento finché non vengono
-- riconciliate in modo esplicito.

commit;
