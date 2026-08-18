# Gestionale famiglie · Quarto MoVimento

Applicazione web per la gestione dei corsi di musica di
[quartomovimento.it](https://www.quartomovimento.it/). Comprende un'area
amministrativa per allievi, lezioni, presenze, recuperi e pagamenti e un'area
riservata alle famiglie.

URL di produzione: <https://gestionale.quartomovimento.it/>.

Il progetto usa:

- un frontend statico pubblicabile su GitHub Pages;
- Supabase per autenticazione, database PostgreSQL, Row Level Security ed Edge
  Functions;
- collegamento PayPal.Me e, se configurato, PayPal Checkout con creazione e
  cattura dell'ordine eseguite lato server;
- conferma manuale dell'amministratrice per i bonifici.

> **Stato del progetto:** la modalità demo contiene esclusivamente dati fittizi.
> Non usarla per dati reali. Prima di aprire il servizio alle famiglie completare
> tutta la [checklist di produzione](#checklist-di-produzione).

## Funzioni principali

Area amministrativa:

- anagrafica di famiglie e allievi, inclusi codice fiscale, residenza e più
  accessi e-mail per lo stesso nucleo;
- calendario delle lezioni ordinarie e dei recuperi;
- registrazione giornaliera di presenze e assenze;
- gestione dei crediti di recupero;
- scadenze, pagamenti, annullamenti tracciati e stato dei saldi;
- promemoria interni alle famiglie per gli insoluti da almeno cinque giorni;
- invito sicuro dei familiari, senza registrazione pubblica.

Area famiglia:

- calendario delle lezioni;
- riepilogo di presenze, assenze e recuperi;
- scadenze e pagamenti della propria famiglia;
- promemoria di pagamento inviati dall'amministratrice, in sola lettura;
- pagamento PayPal e coordinate per il bonifico;
- contatto con Valeria esclusivamente via WhatsApp o prenotazione TidyCal.

## Architettura e responsabilità di sicurezza

GitHub Pages serve soltanto HTML, CSS e JavaScript. Tutto ciò che viene
pubblicato nel frontend è leggibile da chiunque, comprese la configurazione
Supabase e la chiave `anon`/publishable. Questa chiave è progettata per il
browser: la protezione dei dati dipende dalle policy RLS di Supabase.

Non devono mai essere inseriti nel repository o in `assets/js/config.js`:

- `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY` o una Supabase secret key;
- `PAYPAL_CLIENT_SECRET`;
- password, token di accesso, credenziali sandbox;
- dati reali di allievi o famiglie;
- IBAN o altri dati personali che non si desidera rendere pubblici.

I campi `notes` di famiglie, allievi, iscrizioni, lezioni e presenze non sono
un archivio di annotazioni riservate dell'insegnante: le righe pertinenti sono
accessibili alla famiglia tramite RLS. Inserire quindi soltanto informazioni
condivisibili con quel nucleo. Per future note strettamente interne va creata
una tabella separata con policy esclusivamente amministrative.

I secret PayPal e la chiave Supabase privilegiata vengono usati solo dalle Edge
Functions. La documentazione ufficiale conferma che le operazioni Auth Admin
devono essere eseguite in un ambiente server attendibile e che la secret key
non va mai esposta nel browser:
[Supabase Auth Admin](https://supabase.com/docs/guides/auth/users#inviting-users).

## Avvio locale in modalità demo

Non è presente un build step. È sufficiente un server HTTP statico; aprire
direttamente `index.html` con `file://` non è consigliato.

Con Python:

```bash
python -m http.server 5173
```

Aprire quindi <http://localhost:5173/>. La configurazione versionata contiene
soltanto il Project URL e la publishable key del progetto di produzione, entrambi
valori pubblici destinati al browser: anche in locale, per impostazione
predefinita, l'app si collega quindi a Supabase. Per usare i dati fittizi aprire
`?demo=admin#/admin/overview` oppure `?demo=family#/famiglia/home`. Il parametro
`demo` forza un archivio locale isolato e non crea connessioni o scritture verso
Supabase. Le modifiche demo restano soltanto in memoria e si azzerano
ricaricando la pagina.

## Creazione del progetto Supabase

1. Creare un nuovo progetto dal
   [Dashboard Supabase](https://supabase.com/dashboard). Per dati di utenti
   italiani scegliere, se disponibile, una regione UE adatta e annotare il
   `project ref`.
2. In **Project Settings → API Keys** copiare il Project URL e, preferibilmente,
   la publishable key `sb_publishable_…`. La legacy `anon` continua a funzionare
   come fallback durante la migrazione, ma Supabase ne prevede la dismissione.
3. Installare la
   [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
   Con l'installazione npm è richiesto Node.js 20 o successivo e i comandi si
   eseguono tramite `npx supabase`.
4. Autenticare la CLI e collegare questa repo al progetto:

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
```

Il project ref è un identificatore pubblico già contenuto nel Project URL; nei
comandi di esempio resta un segnaposto per rendere la documentazione
riutilizzabile. Non salvare invece nel README la password del database, token
personali o chiavi privilegiate. Lo stato locale del collegamento CLI è escluso
da Git.

### Sviluppo Supabase locale facoltativo

Per eseguire l'intero stack in locale occorrono Docker (o un runtime compatibile)
e la CLI:

```bash
npx supabase start
npx supabase db reset
npx supabase status
```

`db reset` cancella e ricrea **solo il database locale** applicando migrazioni e
seed. Non esporre lo stack locale su Internet: non è predisposto per la
produzione. La procedura ufficiale è descritta in
[Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows).

## Migrazioni database

Lo schema è versionato nelle migrazioni SQL: `001_initial_schema.sql` crea il
modello applicativo, `002_first_admin_bootstrap.sql` aggiunge il bootstrap
vincolato della prima amministratrice, `003`–`005` consolidano privilegi e
attribuzione delle operazioni, `006` aggiunge anagrafica estesa, nuovi piani,
archiviazione sicura e notifiche famiglia–admin, `007`–`009` contengono le
riconciliazioni intermedie per recuperi e bonifici, `010` introduce
annullamenti contabili tracciati e restringe la visibilità delle associazioni
tra familiari e `011` disattiva le notifiche interne e le segnalazioni di
bonifico inviate dalle famiglie, preservando senza modificarle le righe
storiche. `012` aggiunge i promemoria di pagamento a senso unico
amministratrice→famiglia.
Non creare manualmente in produzione tabelle o procedure che divergano dalle
migrazioni.

Dopo aver collegato il progetto, controllare prima cosa verrebbe applicato:

```bash
npx supabase migration list
npx supabase db push --dry-run
```

Se l'anteprima è corretta:

```bash
npx supabase db push
```

Non usare `db reset --linked` su produzione: è distruttivo. Non usare
`--include-seed` sul progetto di produzione, perché i seed servono soltanto per
sviluppo e test.

## Configurazione Auth

Nel Dashboard Supabase:

1. in **Authentication → Providers → Email**, lasciare attivo l'accesso email
   ma disabilitare la registrazione pubblica;
2. in **Authentication → URL Configuration**, impostare:
   - Site URL: `https://gestionale.quartomovimento.it/`;
   - Redirect URL di produzione esatta:
     `https://gestionale.quartomovimento.it/`;
   - redirect locali aggiuntivi: `http://localhost:5173/**` e
     `http://127.0.0.1:5173/**`;
3. configurare un server SMTP personalizzato in **Authentication → SMTP
   Settings**, con mittente verificato, quindi personalizzare i template email
   di invito e recupero password. Senza SMTP l'app genera per l'amministratrice
   un link di attivazione manuale da condividere in modo riservato;
4. creare o invitare dal Dashboard l'account Auth della prima amministratrice
   con indirizzo `quartomov@gmail.com`, senza salvare password nel repository,
   quindi assegnargli ruolo e nome visualizzato come indicato nella sezione
   seguente;
5. usare successivamente la funzione `invite-family`: l'invito di utenti è
   un'operazione privilegiata e non deve essere implementato dal browser con una
   service key.

Il template di invito personalizzato è versionato in
`supabase/templates/invite.html` e collegato da `supabase/config.toml`. Nei
progetti Free creati dal 3 giugno 2026 Supabase non consente però di
personalizzare i template mentre si usa il servizio SMTP predefinito: questo
progetto richiede quindi un SMTP personalizzato (oppure un piano a pagamento)
prima di poter attivare il messaggio con logo e testi Quarto MoVimento. Vedere
[Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) e
[la modifica per il piano Free](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

Gli URL di redirect devono essere autorizzati esattamente; in produzione è
preferibile evitare wildcard. Vedere
[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

### Prima amministratrice

Dopo aver applicato anche `002_first_admin_bootstrap.sql`, creare o invitare
l'utente in **Authentication → Users** con email `quartomov@gmail.com`. La
migrazione crea automaticamente il relativo profilo con ruolo iniziale
`family`. Nel SQL Editor eseguire quindi la funzione di bootstrap dedicata:

```sql
select * from private.bootstrap_first_admin();
```

Controllare che la funzione restituisca una sola riga con email, nome
`Valeria d'Argenio`, ruolo `admin` e stato attivo. La funzione è idempotente,
accetta esclusivamente quell'indirizzo e può essere eseguita soltanto dal
contesto amministrativo del SQL Editor; si interrompe se esiste già un'altra
amministratrice attiva. Se segnala che l'utente o il profilo non esistono,
verificare prima Auth e migrazioni, senza inserire UUID inventati o ripristinare
un `UPDATE role` generico. Non utilizzare `user_metadata` per autorizzare il
ruolo. La password va scelta o reimpostata attraverso Supabase Auth, mai scritta
in SQL, file o variabili pubbliche. Dopo l'accesso verificare che Valeria possa
leggere e modificare i dati, mentre un account famiglia non possa accedere a
famiglie diverse dalla propria.

## Edge Functions

Le funzioni previste sono:

| Funzione | Scopo | Autorizzazione applicativa |
| --- | --- | --- |
| `invite-family` | crea/invita un accesso famiglia | sessione verificata e ruolo admin |
| `paypal-create-order` | crea un ordine dall'importo della scadenza nel DB | sessione e proprietà della scadenza verificate |
| `paypal-capture-order` | cattura e registra il pagamento | sessione e proprietà della scadenza verificate |
| `paypal-webhook` | riceve e riconcilia gli eventi PayPal | firma PayPal obbligatoria |

Nel progetto ospitato, dopo aver creato le nuove API key, Supabase rende
disponibili alle funzioni `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` e
`SUPABASE_SECRET_KEYS`. I due valori `*_KEYS` sono oggetti JSON: il codice usa
la chiave chiamata `default`. Per lo stack locale mantiene il fallback legacy
`SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. Non copiare mai le chiavi
privilegiate nel file del frontend e non provare a ridefinire questi nomi
riservati con `supabase secrets set`.

Impostare soltanto i secret personalizzati server-side con un file locale, per
esempio `supabase/.env.local`, già escluso da `.gitignore`:

```dotenv
PAYPAL_CLIENT_ID=INSERIRE_IL_CLIENT_ID_SANDBOX
PAYPAL_CLIENT_SECRET=INSERIRE_IL_CLIENT_SECRET_SANDBOX
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_WEBHOOK_ID=INSERIRE_IL_WEBHOOK_ID_SANDBOX
PAYPAL_ORDER_MAX_AGE_MINUTES=165
SITE_URL=https://gestionale.quartomovimento.it
ALLOWED_ORIGINS=https://gestionale.quartomovimento.it,http://localhost:5173,http://127.0.0.1:5173
```

I valori qui sopra sono segnaposto, non credenziali utilizzabili. Caricare il
file nel vault delle Edge Functions remote:

```bash
npx supabase secrets set --env-file supabase/.env.local
npx supabase secrets list
```

`secrets set` non configura il runtime locale. Per provare localmente le
funzioni con gli stessi valori personalizzati usare:

```bash
npx supabase functions serve --env-file supabase/.env.local
```

Poi pubblicare le funzioni:

```bash
npx supabase functions deploy invite-family
npx supabase functions deploy paypal-create-order
npx supabase functions deploy paypal-capture-order
npx supabase functions deploy paypal-webhook
```

`supabase/config.toml` imposta `verify_jwt = false` per le quattro funzioni,
perché il controllo JWT incorporato non supporta le nuove API key Supabase.
`invite-family`, `paypal-create-order` e `paypal-capture-order` verificano
comunque esplicitamente la sessione con Supabase Auth e poi il ruolo o la
proprietà della scadenza. `paypal-webhook`, che deve essere raggiungibile dai
server PayPal, verifica invece firma PayPal e idempotenza dell'evento. Non
rimuovere questi controlli applicativi.

`PAYPAL_ORDER_MAX_AGE_MINUTES` limita per quanto tempo la funzione può
riutilizzare un ordine PayPal ancora aperto: il default è 165 minuti. Un valore
personalizzato viene comunque limitato all'intervallo 15–180 minuti.

`SITE_URL` determina il fallback sicuro dei link di invito. `ALLOWED_ORIGINS`
contiene origini, quindi il dominio va indicato senza slash finale o percorsi.
Se il secret remoto contiene ancora il vecchio valore GitHub Pages, aggiornarlo
con `supabase secrets set` e ripubblicare le Edge Functions: un valore esplicito
ha precedenza sulla allowlist predefinita nel codice.

## PayPal Sandbox

1. Accedere al
   [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. In **Apps & Credentials**, ambiente **Sandbox**, creare o selezionare una REST
   app collegata al conto Business sandbox.
3. Copiare il client ID:
   - nella variabile GitHub `PAYPAL_CLIENT_ID`, perché è pubblico e serve al
     pulsante nel browser;
   - nel secret Supabase `PAYPAL_CLIENT_ID`.
4. Copiare il client secret esclusivamente nel secret Supabase
   `PAYPAL_CLIENT_SECRET`.
5. Creare un webhook sandbox con endpoint:
   `https://<PROJECT_REF>.supabase.co/functions/v1/paypal-webhook`.
6. Salvare l'ID del webhook in `PAYPAL_WEBHOOK_ID` e selezionare questi eventi:

   - `PAYMENT.CAPTURE.COMPLETED`;
   - `PAYMENT.CAPTURE.PENDING`;
   - `PAYMENT.CAPTURE.DECLINED`;
   - `PAYMENT.CAPTURE.DENIED`;
   - `PAYMENT.CAPTURE.REFUNDED`;
   - `PAYMENT.CAPTURE.REVERSED`.

7. Usare un account **Personal sandbox** come acquirente e il conto **Business
   sandbox** come esercente. Non usare denaro o credenziali reali.

PayPal fornisce di norma account sandbox personali e business separati. I
dettagli sono in
[Get started with PayPal REST APIs](https://developer.paypal.com/api/rest/) e
[Sandbox testing guide](https://developer.paypal.com/tools/sandbox/).

L'importo non deve essere accettato dal browser: alla creazione il frontend
invia l'identificativo della scadenza e alla cattura anche l'order ID restituito
da PayPal, ma mai importo o valuta. Le Edge Functions leggono importo, valuta e
proprietario dal database; creazione e cattura dell'ordine rimangono lato
server.

Testare almeno:

- pagamento approvato;
- pagamento annullato dall'utente;
- doppio click/doppia richiesta;
- ordine con importo o valuta non coerenti;
- evento webhook duplicato o fuori ordine;
- rimborso/storno;
- utente di una famiglia che prova a pagare una scadenza altrui.

## Pubblicazione su GitHub Pages

Il workflow `.github/workflows/pages.yml` viene eseguito a ogni push su `main` e
può essere avviato manualmente. Crea una directory temporanea `_site`, vi copia
solo il sito statico, genera `_site/assets/js/config.js` e pubblica
l'artefatto. Migrazioni, funzioni, documentazione e file locali non vengono
inclusi nel sito.

Nel repository GitHub:

1. aprire **Settings → Pages** e scegliere **GitHub Actions** come sorgente;
2. aprire **Settings → Secrets and variables → Actions → Variables**;
3. aggiungere le variabili pubbliche:

| Variabile GitHub | Obbligatoria | Contenuto |
| --- | --- | --- |
| `SUPABASE_URL` | no | override del Project URL già versionato |
| `SUPABASE_ANON_KEY` | no | override della publishable key già versionata |
| `PAYPAL_CLIENT_ID` | sì per PayPal | client ID sandbox o live coerente con l'ambiente |
| `PAYPAL_ENVIRONMENT` | no | `sandbox` (default) oppure `live` |

Il nome della variabile GitHub `SUPABASE_ANON_KEY` è mantenuto per compatibilità.
Gli override sono facoltativi e, se usati, devono contenere insieme URL e nuova
publishable key. Questi valori sono inevitabilmente pubblici nel browser e vanno
configurati come **Variables**, non come Secrets GitHub. Il workflow non usa e
non deve conoscere
`PAYPAL_CLIENT_SECRET`, `SUPABASE_SECRET_KEYS` o
`SUPABASE_SERVICE_ROLE_KEY`.

Il workflow legge il fallback direttamente da `assets/js/config.js` quando gli
override non sono definiti, evitando una seconda copia di URL e chiave nel file
YAML.
Se viene impostato soltanto uno dei due valori, fallisce per evitare un deploy
parzialmente configurato. Come ulteriore protezione, rifiuta le chiavi con
prefisso `sb_secret_` e le legacy JWT il cui ruolo non è `anon`, così una chiave
privilegiata incollata per errore non viene pubblicata nell'artefatto.

L'indirizzo pubblico primario è:

```text
https://gestionale.quartomovimento.it/
```

Il file `CNAME` nella radice documenta lo stesso hostname. Con una pubblicazione
tramite GitHub Actions è la configurazione **Settings → Pages → Custom domain**
a essere autorevole: il solo file non attiva il dominio.

Configurare il dominio in questo ordine:

1. verificare, se non è già stato fatto, `quartomovimento.it` nelle impostazioni
   dell'organizzazione GitHub tramite il record TXT proposto da GitHub;
2. in **Settings → Pages**, lasciare **GitHub Actions** come sorgente, inserire
   `gestionale.quartomovimento.it` in **Custom domain** e salvare;
3. nel DNS di `quartomovimento.it` creare questo record, senza protocollo né
   percorso e senza record wildcard:

   | Tipo | Nome/host | Destinazione |
   | --- | --- | --- |
   | `CNAME` | `gestionale` | `quartomovimento.github.io` |

4. attendere la propagazione e verificare da PowerShell:

   ```powershell
   Resolve-DnsName -Type CNAME gestionale.quartomovimento.it
   ```

   Il risultato deve puntare a `quartomovimento.github.io`. Il target DNS non
   deve includere `/gestionale`;
5. quando GitHub ha emesso il certificato, abilitare **Enforce HTTPS** e provare
   <https://gestionale.quartomovimento.it/> in una finestra privata;
6. nel Dashboard Supabase aggiornare Site URL e Redirect URLs come indicato
   sopra, impostare i secret `SITE_URL` e `ALLOWED_ORIGINS`, ripubblicare le
   Edge Functions e provare invito, magic link e recupero password.

La URL tecnica `https://quartomovimento.github.io/gestionale/` non va usata in
nuovi link o configurazioni Auth; dopo l'attivazione GitHub la reindirizza al
dominio personalizzato. Aggiornare inoltre:

- informativa privacy e collegamenti pubblici.

## CSP e dipendenze del browser

`index.html` applica una Content Security Policy anche su GitHub Pages e limita
script, connessioni, font, immagini e frame alle origini effettivamente usate.
Blocca inoltre plugin con `object-src 'none'`, cambi di base URL e invii di form
verso destinazioni non previste. Le connessioni Supabase HTTPS e Realtime WSS
sono consentite soltanto su `*.supabase.co`; se si configura un dominio
Supabase personalizzato bisogna aggiungerlo esplicitamente alla direttiva
`connect-src`.

La libreria Supabase caricata dal browser è bloccata alla versione esatta
`2.49.8` e al file reale del pacchetto jsDelivr. L'attributo SRI SHA-384 in
`index.html`, insieme a `crossorigin="anonymous"`, impedisce l'esecuzione se il
contenuto restituito dal CDN non corrisponde ai byte verificati. Non sostituire
il percorso con l'alias dinamico `.min.js` senza ricalcolare e collaudare
l'integrità.

Lora e Nunito sono inclusi localmente in `assets/fonts`, insieme ai logo
ufficiali in `assets/img`: il browser non contatta Google Fonts o il sito
pubblico per caricarli. Il PayPal JavaScript SDK non usa SRI perché è una
risposta dinamica legata ai parametri del merchant; la CSP ne limita comunque
le origini. PayPal raccomanda `'unsafe-inline'` per la modalità senza nonce; anche
l'interfaccia attuale contiene stili inline. Questo rende la CSP meno forte
contro alcune forme di XSS, pur mantenendo attivi gli altri limiti sulle
origini. Un nonce statico non risolverebbe il problema: per essere efficace
deve essere casuale e diverso a ogni risposta.

Una CSP dichiarata con `<meta>` non può applicare `frame-ancestors`, né GitHub
Pages permette a questa repo di aggiungere header di risposta come HSTS o
`Cross-Origin-Opener-Policy`. Se sono richieste queste protezioni, servire il
sito tramite un hosting o proxy che imposti header HTTP, spostare lì la CSP,
aggiungere `frame-ancestors 'none'` e usare il valore COOP
`same-origin-allow-popups` raccomandato da PayPal. Dopo qualsiasi modifica a
CSP, CDN, font, dominio Supabase o PayPal, provare login e pagamento in un
browser reale controllando che la console non mostri risorse bloccate.

## Bonifico

La famiglia vede importo, coordinate bancarie e una causale già compilata nel
formato `nome, cognome, numero fattura`. Non invia una segnalazione separata dal
gestionale: solo l'amministratrice, dopo il riscontro bancario, marca la fattura
come pagata.

Dopo la migrazione, compilare dall'area **Impostazioni** dell'app i valori
`bank_account_holder`, `bank_iban`, l'eventuale `bank_bic` e
`bank_reference_template`. Le coordinate bancarie iniziali sono vuote; il
modello causale viene impostato su `{nome}, {cognome}, {numero}`. Questi valori
hanno visibilità `authenticated`: possono essere letti da utenti che hanno
effettuato l'accesso, ma non da visitatori anonimi. Non cambiare la visibilità
in `public` e non inserire coordinate reali in JavaScript, README o dati demo.

## Promemoria di pagamento

Dalla sezione **Pagamenti** l'amministratrice può inviare manualmente un
promemoria dal quinto giorno di calendario successivo alla scadenza. Il comando
è disponibile soltanto se esiste ancora un saldo, la famiglia ha almeno un
account attivo e non risultano un bonifico da riconciliare o un pagamento
PayPal in corso.

Il database ricalcola questi requisiti al momento dell'invio e consente un solo
promemoria per fattura. La famiglia lo vede in sola lettura nella Home e nella
sezione Pagamenti finché la quota rimane aperta; può pagare oppure usare
**Parlane con Valeria**, ma non può rispondere tramite notifiche interne. Il
gestionale aggiorna l'avviso in tempo reale se l'area famiglia è già aperta. Il
promemoria resta interno: non invia e-mail, notifiche push, WhatsApp o SMS.

## Privacy e dati di minori

Questa sezione è una checklist tecnica, non una consulenza legale. Prima della
produzione far verificare il trattamento a un professionista competente.

- Raccogliere solo i dati necessari; evitare note sanitarie o particolari se
  non indispensabili e formalmente gestite.
- Predisporre informativa privacy, basi giuridiche, tempi di conservazione,
  procedura per accesso/rettifica/cancellazione/esportazione e gestione delle
  violazioni.
- Elencare correttamente i fornitori e i ruoli privacy: Supabase, GitHub,
  PayPal e il CDN jsDelivr; valutare DPA, sub-responsabili e localizzazione dei
  dati. Logo e font sono già ospitati localmente dal gestionale.
- Proteggere l'account admin con password unica e MFA; non condividere un solo
  account tra più persone.
- Verificare RLS con almeno due famiglie test: ciascuna deve vedere
  esclusivamente i propri figli, presenze, recuperi e pagamenti.
- Evitare log con nomi, email, token, corpi webhook o dati di pagamento.
- Definire backup, restore verificato, audit delle modifiche e cancellazione
  sicura a fine conservazione.
- Aggiornare l'informativa per il caricamento di componenti PayPal e per
  eventuali cookie/tecnologie di terze parti.

## Checklist di produzione

- [ ] Dati demo e account di test non sono presenti nel progetto Supabase live.
- [ ] Migrazioni applicate con `db push --dry-run` e poi `db push`.
- [ ] API key Supabase publishable/secret `default` create e publishable key
      usata nel frontend; chiavi legacy limitate al fallback locale.
- [ ] Registrazione pubblica disabilitata; Site URL e redirect Auth puntano a
      `https://gestionale.quartomovimento.it/`.
- [ ] Valeria d'Argenio (`quartomov@gmail.com`) è l'unica prima admin, con MFA
      attiva e accesso recuperabile in sicurezza.
- [ ] RLS testata con admin, famiglia A, famiglia B e utente non autenticato.
- [ ] Corsi, orari, sedi, prezzi, scadenze e regole recuperi confermati.
- [ ] Edge Functions pubblicate; CORS limitato alle origini effettive.
- [ ] Nessun secret presente in repo, cronologia Git, workflow o frontend.
- [ ] PayPal sandbox testato, inclusi duplicati, errori, rimborsi e webhook.
- [ ] Passaggio a PayPal live eseguito sostituendo insieme client ID, client
      secret, webhook ID e `PAYPAL_ENVIRONMENT=live`.
- [ ] Webhook live registrato e firma verificata; eventi idempotenti.
- [ ] Intestatario, IBAN, BIC e modello causale configurati con visibilità
      `authenticated`.
- [ ] Bonifici marcati pagati solo dopo verifica manuale.
- [ ] CNAME DNS, Custom domain Pages, HTTPS, variabili GitHub, `SITE_URL` e
      origini Supabase sono coerenti con `gestionale.quartomovimento.it`.
- [ ] Email di invito/reset provate; dominio mittente e recapito verificati.
- [ ] Informativa privacy, retention, DPA e procedura diritti approvate.
- [ ] Backup e ripristino provati; monitoraggio e contatti di assistenza attivi.
- [ ] Test mobile, accessibilità di base e flussi completi admin/famiglia
      superati.

## Documentazione ufficiale

- [GitHub Pages con workflow personalizzati](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Dominio personalizzato e DNS per GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Supabase CLI e migrazioni](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Migrazione alle nuove API key Supabase](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Secret delle Edge Functions](https://supabase.com/docs/guides/functions/secrets)
- [PayPal REST APIs](https://developer.paypal.com/api/rest/)
- [CSP raccomandata per il PayPal JavaScript SDK](https://developer.paypal.com/sdk/js/csp/)
