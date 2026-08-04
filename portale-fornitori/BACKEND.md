# Contratto backend — Portale Fornitori Righi

Artefatto tecnico per rendere il portale **multi-utente reale**. Lo scaffolding
client è già in `index.html`: modulo `Sync` + `RemoteAdapter` (dormiente finché
non si chiama `Sync.enable(remote)`) e un modello dati esplicito. Qui c'è cosa
deve esistere lato server e cosa va provisionato (non automatizzabile da questo
ambiente).

Oggi il prototipo gira **offline-first**: lo stato vive nello storage del
dispositivo (`window.storage` → `localStorage` → RAM) e i due lati (Righi /
fornitore) condividono lo stesso documento locale. Il passaggio al cloud non
cambia la UI: cambia solo l'adapter.

## 0. Cosa serve da te (provisioning)

- Un progetto **Postgres gestito, regione UE** (raccomandato **Supabase**:
  Auth + Row Level Security + Realtime + Storage per gli allegati). In
  alternativa Neon/RDS + auth dedicata.
- Chiavi progetto (URL + anon key) nella configurazione client.
- Decisioni: provider di login, dominio, policy di retention degli allegati.

## 1. Accessi (auth) — il portale ha due mondi

Due tipi di account, un solo meccanismo di login:

- **Righi interno** (`role = 'righi'`): ufficio subappalti e caposquadra.
- **Fornitore** (`role = 'fornitore'`, legato a un `supplier_id`): il referente
  del fornitore accreditato.

Login consigliato: **e-mail OTP / magic link** (attrito minimo, niente password
da gestire per i fornitori) + eventuale SSO per gli interni Righi.
Accreditamento fornitore = creazione di `supplier` + invito che genera un
`user(role='fornitore')` collegato. Un caposquadra è un `user(role='righi')` con
flag `caposquadra`.

```
users(id uuid pk, email text unique, role text check in ('righi','fornitore'),
      name text, supplier_id uuid null fk suppliers, caposquadra bool default false,
      created_at timestamptz)                                   -- id = auth.uid()
suppliers(id uuid pk, name text, citta text, accredited bool, specialties text[],
          settori text[], referente text, created_at,   -- niente 'rating' soggettivo: la valutazione è calcolata dai lavori (vedi metriche)
          lat numeric, lng numeric, zona text,          -- mappa + ottimizzazione trasporti
          capacita_mese int, certificazioni text[],      -- capacita_mese: carico/saturazione via ORE — SOLO Righi (al fornitore si mostra l'importo)
          dimensione_max text check in ('s','m','l'),    -- limite di spazio: ingombro max del quadro lavorabile
          attrezzature text[],                           -- dotazioni officina: piega_barre|carroponte|siglatrice|muletto|banco_prova|foratura_cn
          attivo bool default true,                      -- fornitore attualmente attivo (dal file Mappatura)
          costo_orario numeric, cablatori numeric, risorse_dedicate text,  -- €/h, cablatori totali, risorse dedicate a Righi
          note text)
-- Preferenza di utilizzo per OTL (caposquadra): % con cui ciascun OTL usa il fornitore.
supplier_pref(supplier_id uuid fk suppliers, capo_id uuid fk users, perc int, primary key(supplier_id,capo_id))
```

## 1-bis. Deep link nelle email (magic link) — dall'email al portale in un clic

Obiettivo: il fornitore abituato all'e-mail riceve un messaggio e, cliccando **un
solo link**, entra nel portale **già identificato** e **sulla commessa/richiesta
giusta**, dove risponde. Zero password, zero ricerca manuale: l'e-mail diventa il
"gancio" che porta al portale.

**Nel prototipo (client)** il link è un hash non firmato costruito dallo stesso
device: `…/index.html#f=<supplier_id>&c=<codice_commessa>` (oppure `&q=<richiesta>`).
Al boot `resolveMagicLink()` legge l'hash, crea/riusa l'utente fornitore, apre la
sessione locale, ripulisce subito l'hash dall'URL e apre la commessa. È una **demo
dell'esperienza**, non un meccanismo di sicurezza: l'hash non è segreto e vale solo
su quel dispositivo.

**In produzione** il link è un **token firmato e a scadenza**, verificato lato
server. Il link non contiene mai l'`id` in chiaro: contiene solo il token.

```
magic_links(
  id uuid pk,
  token_hash text unique,          -- si salva l'HASH del token (sha256), mai il token in chiaro
  user_id uuid fk users,           -- a chi concede l'accesso (fornitore)
  target_type text,                -- 'job' | 'request' | 'home'
  target_id uuid null,             -- commessa/richiesta da aprire
  expires_at timestamptz,          -- TTL: 7-14 gg per "vai al portale"; 15 min se apre sessione senza altra verifica
  single_use bool default false,   -- true per azioni sensibili (approvazioni)
  used_at timestamptz null,
  created_by uuid, created_at timestamptz
)
```

Flusso: e-mail contiene `https://portale.righinet.com/r/<token>` -> il server cerca
`sha256(token)` in `magic_links`, verifica **non scaduto** e (se `single_use`) **non
usato**, imposta il cookie di sessione per `user_id`, marca `used_at`, poi **302**
verso la pagina profonda (`/commesse/<code>` o `/richieste/<id>`) con il box risposta
già pronto.

**Il token identifica, non autorizza.** Dopo aver riconosciuto l'utente dal token,
il server deve comunque verificare che *quell'utente* possa vedere *quella*
risorsa (le stesse regole RLS della sezione 3): un codice commessa non è un
segreto, quindi non deve mai bastare a mostrare il contenuto. Il client applica
già questo controllo prima di aprire il bersaglio del link.

Regole di sicurezza (il link **è** una credenziale al portatore):

- **Solo HTTPS**; non loggare mai l'URL completo; `Referrer-Policy: no-referrer` così
  il token non esce verso terze parti.
- **TTL corto** se il click apre direttamente la sessione; per link a lunga vita,
  al click chiedere una conferma leggera (OTP via e-mail) prima di dare la sessione.
- **Single-use + rotazione** per link che autorizzano azioni (es. approvazioni).
- **Rate-limit** e log di IP/device sul redeem; **revoca** possibile (cancella la riga).
- Token legato al destinatario: un link rubato vale solo per quel `user_id`, e il
  primo redeem può fissare il device.

**Invio a più fornitori.** Nessun destinatario deve atterrare sul login, quindi il
link è **sempre personale**: già nel client l'invio massivo prepara **un messaggio
per fornitore**, ciascuno col **proprio** link diretto (`#f=<supplier>&c=<commessa>`)
e col solo indirizzo del destinatario — così ognuno arriva sulla commessa già
riconosciuto e non vede gli altri. In produzione questo diventa l'invio
**server-side automatico**, un messaggio per fornitore con il **proprio token
firmato**. (Un eventuale link *senza* identità — condiviso a mano — è solo un
ripiego: porta alla schermata di accesso, poi apre comunque la commessa.)

### 1-ter. Avviso automatico sulle risposte (il fornitore non deve "andare a vedere")

Un fornitore poco avvezzo al portale non scopre da solo che è arrivata una
risposta: va **spinto** (push), non lasciato a controllare. Ogni evento che lo
riguarda genera quindi **due** consegne:

1. **notifica in app** (campanella) — sempre;
2. **email di avviso** con il testo della risposta e il **magic link** alla
   richiesta: un clic e risponde nel portale.

Eventi che devono far scattare l'avviso: risposta rapida del caposquadra, esito
di uno **slittamento**, esito dell'**approvazione a consegnare**, assegnazione
commessa, cambio della data di rientro.

Nel client l'email si apre già compilata nel programma di posta (il browser non
può spedire da solo). In produzione l'invio è **server-side e realmente
automatico**: un worker sulla tabella eventi manda e-mail (e, volendo,
WhatsApp/push) con il token personale del destinatario.

```
notifications(id uuid pk, user_id uuid fk users, kind text, txt text, sub text,
              job_id uuid null, request_id uuid null, read bool default false,
              created_at timestamptz)
-- coda di consegna multicanale: una riga per canale, con retry
notification_delivery(id uuid pk, notification_id uuid fk notifications,
              channel text check in ('email','push','whatsapp'),
              status text check in ('pending','sent','failed'), attempts int default 0,
              magic_link_id uuid null fk magic_links,   -- token personale incluso nel messaggio
              sent_at timestamptz null, error text null)
```

Regole: **un solo destinatario per messaggio** (mai indirizzi in chiaro di
altri); *rate-limit*/raggruppamento per non inondare chi riceve molti eventi in
sequenza; **preferenze per fornitore** (email sì/no, orari); e la notifica in app
resta comunque la fonte di verità, anche se il canale esterno fallisce.

### 1-quater. Extra: soglia di approvazione lato server

L'extra e' una richiesta (`requests.tipo='extra'`) con `importo` e `extra_tipo`.
La regola di chi puo' approvarlo **non puo' vivere solo nel client**: va imposta
dal server, perche' decide di denaro.

- soglia = **10%** dell'importo concordato della commessa (`EXTRA_SOGLIA_PERC`);
- entro soglia puo' approvare il **caposquadra** della commessa; oltre, solo un
  utente con ruolo **responsabile**;
- l'approvazione puo' fissare un `importo_approvato` diverso da quello richiesto,
  registra le `ore` (interne) e puo' spostare `data_rientro` con storico;
- una commessa con extra `stato <> 'chiusa'` **non puo' ricevere l'approvazione a
  consegnare**: il vincolo va replicato server-side, non solo nell'interfaccia.

```
requests( ... , importo numeric null,          -- extra richiesto dal fornitore
              importo_approvato numeric null,  -- extra riconosciuto da Righi
              extra_tipo text null check in ('materiale','lavorazione','layout','rilavorazione') )
```

### 1-quinquies. Qualifica del fornitore: documenti che abilitano il lavoro

Il portale non replica un sistema completo di gestione della conformita': ne
prende **la parte che decide se un fornitore e' assegnabile**. Se in azienda
esiste gia' una piattaforma di compliance (documenti, scadenzari, verifiche), la
fonte di verita' resta quella e il portale ne **consuma l'esito**.

```
supplier_docs(
  id uuid pk,
  supplier_id uuid fk suppliers,
  tipo text check in ('durc','rct','idoneita','visura','iso9001','iso45001'),
  scadenza date not null,
  stato text check in ('valido','in_verifica','respinto'),
  file_url text null,            -- nel prototipo si dichiara solo la scadenza
  caricato_il date, nota text,
  esito_da uuid null fk users, esito_at timestamptz null,
  unique(supplier_id, tipo)
)
```

**Stato calcolato, non memorizzato.** `valido | in_scadenza | in_verifica |
respinto | scaduto | mancante` si derivano da `scadenza` + `stato` + la data di
oggi. Non va salvato: si sfaserebbe da solo al passare del tempo.

**Regola da imporre lato server** (il client la applica per l'esperienza, il
server per la sostanza):

- un documento **obbligatorio** mancante, scaduto o respinto rende il fornitore
  **non assegnabile**;
- l'endpoint di **assegnazione deve rifiutare** un fornitore non assegnabile,
  esattamente come rifiuta un extra oltre soglia deciso dal caposquadra;
- solo un utente **responsabile** puo' verificare o respingere; il **fornitore**
  puo' solo comunicare un rinnovo sul **proprio** `supplier_id` (RLS).

**Automazioni naturali una volta sul server**: promemoria automatico al fornitore
a 30/15/7 giorni dalla scadenza (riusando la coda di notifica gia' descritta) e
disattivazione automatica alla scadenza, con avviso a Righi se il fornitore ha
commesse in corso.

**Integrazione con un sistema di compliance esterno.** Se i documenti sono gia'
gestiti altrove, non vanno reinseriti: basta che il sistema esterno alimenti
`supplier_docs` (o direttamente `suppliers.accredited` / `suppliers.attivo`).
La direzione e' una sola: **la conformita' decide chi e' idoneo, il portale
decide a chi affidare**.

## 2. Modello dati (Postgres)

Il portale è **per-entità** (non whole-document): i lavori sono oggetti condivisi
letti da più fornitori, quindi conviene tabellare da subito.

```
jobs(id uuid pk, code text unique, title text, tipologia text, settore text,
     lavorazioni text[],                                  -- lavorazioni industrializzate (multi): carp_esterna|foratura|piastra_barre|sbroglio|piastra_comp
     ingombro text null check in ('s','m','l'),           -- ingombro previsto del quadro → confronto con dimensione_max del fornitore in assegnazione
     budget numeric, ore_stimate int,                     -- ore_stimate: SOLO Righi (mai esposto ai fornitori)
     data_inizio_stimata date,                            -- inizio produzione stimato — VISIBILE al fornitore; guida l'alert "inizio in ritardo"
     data_rientro date,                                   -- rientro del quadro finito in Righi — VISIBILE al fornitore; scadenza operativa, guida l'alert "rientro in ritardo"
     data_rientro_base date,                              -- rientro originale (per contare gli slittamenti)
     data_rientro_effettiva date,                         -- rientro reale → puntualità (vs data_rientro)
     data_consegna date,                                  -- consegna al cliente: SOLO Righi (mai esposto ai fornitori). NON usato per gli alert
     assegnato_at date,                                   -- per metriche (lavori/mese, tempo risposta)
     avanzamento text,                                    -- materiale|cablaggio|collaudo|pronto|null (aggiornato dal fornitore)
     consegna_approvata jsonb null,                       -- {da, at} — se null il fornitore NON può consegnare (gate: serve ok del caposquadra)
     chiusa_at date, chiusa_da uuid null fk users,        -- chiusura della pratica (stato finale 'chiuso'): solo lato Righi
     -- extra approvati (lavorazioni in piu'): importo del fornitore + ore interne Righi
     -- l'importo finale della commessa e' importo_accettato + somma degli extra approvati
     extra jsonb default '[]',                            -- [{id,reqId,tipo,importo,ore,motivo,at,da}] - 'ore' MAI esposto al fornitore
     storico_date jsonb,                                  -- storico dei cambi di data_rientro (slittamenti/modifiche): [{from,to,by,byRole,at,motivo,tipo}]
     capo_id uuid fk users, descrizione text, visibility text check in ('tutti','selezionati'),
     stato text check in ('bozza','da_approvare','pubblicato','assegnato','in_corso','consegnato','chiuso'),
     assegnato_a uuid null fk suppliers,
     richiedente uuid null fk users,                      -- caposquadra che ha proposto la commessa (workflow di approvazione)
     approvazione jsonb null,                             -- {esito:'approvata'|'rifiutata', da, at, motivo}
     created_by uuid fk users,
     published_at timestamptz,                            -- "data pubblicazione": impostata all'atto della pubblicazione ai fornitori; mostrata SOLO a Righi (sostituisce la vecchia data_richiesta)
     created_at timestamptz)

job_inviti(job_id uuid fk jobs, supplier_id uuid fk suppliers, primary key(job_id,supplier_id))

allegati(id uuid pk, job_id uuid fk jobs, name text, storage_path text,
         is_layout bool, size text, created_at)                 -- file in Storage bucket

risposte(id uuid pk, job_id uuid fk jobs, supplier_id uuid fk suppliers,
         tipo text check in ('domanda','accettazione'), testo text, importo numeric null,
         firma jsonb null,          -- accettazione: {nome, ts, user_id, ip, user_agent} — firma leggera (sez. 4-ter)
         from_side text, read bool default false, at timestamptz)

richieste(id uuid pk, job_id uuid fk jobs, supplier_id uuid fk suppliers,
          tipo text check in ('dubbio','materiale','slittamento','ritardo','sopralluogo','collaudo','altro'),
          -- tipo='collaudo' = richiesta di approvazione consegna: approvandola il caposquadra scrive jobs.consegna_approvata (sblocca "Segna consegnato")
          testo text, stato text check in ('aperta','presa','chiusa'),
          data_proposta date, esito text check in ('approvato','rifiutato'),  -- solo per 'slittamento': nuova data_rientro proposta dal fornitore
          capo_id uuid fk users, read bool default false, at timestamptz)

notifiche(id uuid pk, to_user uuid fk users, icon text, txt text, sub text,
          job_id uuid null, read bool default false, at timestamptz)
```

## 3. Isolamento (RLS) — il rischio n.1

Attivare **Row Level Security** su tutte le tabelle. Regole chiave:

- **`jobs` in lettura per un fornitore**: `stato <> 'bozza'` **e** —
  se il lavoro è **assegnato** (`assegnato_a` valorizzato) lo vede **solo
  l'assegnatario**; se **non è ancora assegnato** lo vedono i fornitori secondo
  visibilità (`'tutti'` oppure invitati in `job_inviti`). Così un fornitore
  **non vede i lavori assegnati ad altri**, mentre Righi vede tutto. È
  esattamente la funzione `jobsForSupplier()` del client: va replicata come
  policy così il filtro è **sul server**, non solo in UI. Nota: `stato` in
  (`'bozza'`,`'da_approvare'`) **non è mai** leggibile da un fornitore (come
  `jobsForSupplier`, che scarta entrambi).
- **`jobs` in scrittura**: solo `role='righi'`. Il **caposquadra** può creare una
  commessa in `stato='da_approvare'` (con `richiedente=auth.uid()`) ma **non** può
  portarla a `'pubblicato'`; la transizione `da_approvare → pubblicato` (e
  `approvazione`) è consentita **solo al responsabile**. È il workflow di
  approvazione: il caposquadra propone, il responsabile pubblica o rimanda.
- **`risposte`**: un fornitore vede/scrive solo le proprie; Righi le vede tutte.
- **`richieste`**: un fornitore vede/scrive le proprie; il caposquadra della
  commessa e l'ufficio subappalti le vedono.
- **`notifiche`**: ognuno legge solo `to_user = auth.uid()`.
- **Ruoli Righi**: il *responsabile* (`role='righi'`, non caposquadra) vede tutte
  le `jobs`; il *caposquadra* (`caposquadra=true`) vede solo `capo_id = auth.uid()`
  (dashboard/elenco/richieste filtrati). Il caposquadra può **proporre** commesse
  (in `da_approvare`) e vede il **carico di tutti i fornitori** (dato aggregato,
  non commessa-scoped); **assegnazione, pubblicazione, approvazione, import/export**
  restano al responsabile.
- **Campi riservati Righi**: `ore_stimate` non va mai esposto ai fornitori — usare
  una **view** dedicata (o column-level privileges) per il lato fornitore che non
  includa la colonna. Le ore alimentano il carico fornitori (somma per fornitore ×
  mese di consegna), calcolabile lato server con una view aggregata.

## 4-bis. Import massivo ed export ERP

- **Import**: il client accetta un file **CSV** (Excel → "Salva come CSV") e crea
  le commesse in bozza; la versione server può accettare direttamente `.xlsx`
  (parsing lato Edge Function) e validare le intestazioni del template.
- **Export ordini accettati**: il client genera un **CSV** delle commesse
  assegnate/accettate (commessa, fornitore, importo accettato, ore, consegna,
  caposquadra) per l'emissione ordine nell'**ERP**. In produzione: endpoint di
  export firmato o integrazione diretta con il gestionale.
- **Email**: il client **compone** l'email (finestra dedicata: apri nel client /
  copia). Con **più destinatari** (invio a più fornitori) gli indirizzi vanno in
  **Ccn/BCC**, mai in "A": i fornitori non si vedono tra loro. L'invio automatico
  (pubblicazione, assegnazione, richieste) è una Edge Function transazionale
  (Fase 1, stessa regola BCC per gli invii massivi) — vedi sez. 4.

Esempio (visibilità lavoro lato fornitore):

```sql
create policy job_read_fornitore on jobs for select using (
  stato <> 'bozza' and exists (
    select 1 from users u where u.id = auth.uid() and u.role = 'fornitore' and (
      jobs.assegnato_a = u.supplier_id                       -- assegnato: solo l'assegnatario
      or (jobs.assegnato_a is null and (                     -- non assegnato: per visibilità
            jobs.visibility = 'tutti'
            or exists (select 1 from job_inviti i where i.job_id = jobs.id and i.supplier_id = u.supplier_id)
      ))
    )
  )
);
```

Test di isolamento dedicato: un fornitore **non** invitato non deve leggere né
un lavoro `selezionati` né una bozza altrui.

## 4. Realtime + notifiche multicanale (Fase 1)

Il client crea già un record `notifiche` per ogni evento (nuovo lavoro,
assegnazione, richiesta, slittamento, avanzamento, cambio data). Il backend lo
**propaga sui canali** con una pipeline unica e idempotente, così l'avviso
arriva dove il fornitore già lavora e senza doppioni.

- **Realtime** su `jobs`, `risposte`, `richieste`, `notifiche`: bacheca fornitore
  e dashboard Righi si aggiornano da sole (nessun refresh manuale).
- **Outbox + dispatcher**: ogni `notifiche` inserito genera una riga in
  `notification_outbox` (una per canale attivo). Un dispatcher (Edge Function su
  trigger DB o cron ~30s) prende le righe `pending`, invia, e segna
  `sent/failed` con `attempts++`. Retry con backoff esponenziale, `dedup_key`
  per evitare invii doppi (idempotenza).

```
notification_channels(user_id uuid fk users, canale text check in ('push','email','whatsapp'),
                      indirizzo text,            -- endpoint push / email / numero E.164
                      enabled bool, verified_at timestamptz, primary key(user_id,canale))
notification_outbox(id uuid pk, notifica_id uuid fk notifiche, user_id uuid, canale text,
                    dedup_key text unique,       -- es. notifica_id||canale
                    stato text check in ('pending','sent','failed'), attempts int default 0,
                    last_error text, created_at, sent_at)
```

**Canali**

- **Web Push** (browser/PWA): chiavi **VAPID**, `PushSubscription` salvata in
  `notification_channels`. Payload compatto → deep-link alla commessa. È il canale
  a costo zero e già coerente col service worker del prototipo.
- **WhatsApp** (dove il fornitore vive): **WhatsApp Business Cloud API** (Meta) o
  Twilio. Servono **template approvati** per i messaggi *business-initiated*
  (es. "Nuovo lavoro {codice} — {tipologia} — consegna {data}. Apri: {link}").
  Numeri in formato **E.164**, opt-in registrato (`verified_at`). Le risposte del
  fornitore possono rientrare come webhook → `richieste`.
- **Email automatica**: invio **transazionale** server-side (Postmark/SES/Resend)
  su evento, con template + link firmato. Sostituisce (non elimina) la finestra
  "componi email" del client, che resta come fallback manuale. `from` di dominio
  Righi, SPF/DKIM/DMARC configurati per la deliverability.

**Preferenze**: ogni utente sceglie i canali attivi (default: push + email; il
fornitore può aggiungere WhatsApp). Il dispatcher legge `notification_channels`
e crea una riga outbox per canale abilitato. *Quiet hours* opzionali e digest
giornaliero per non-urgenti.

## 4-ter. Firma leggera dell'accettazione

L'accettazione è un impegno: il client raccoglie una **firma leggera**
(spunta esplicita "Accetto e firmo a nome di …") e registra
`risposte.firma = {nome, ts}`. Lato server va irrobustita come **evidenza**:

- **Cattura**: alla POST dell'accettazione il server aggiunge `user_id`
  (`auth.uid()`), `ip`, `user_agent` e un `ts` **server-side** (non fidarsi del
  client) → `firma jsonb`.
- **Integrità**: opzionale ma consigliato, calcolare un **hash** del contenuto
  firmato (job_id + code + importo + nome + ts) e conservarlo; così l'accettazione
  non è modificabile senza invalidare la firma. Storicizzare in append-only.
- **Evidenza/PDF**: generare (on-demand) un **PDF di riepilogo ordine** con estremi
  commessa, importo accettato, nominativo, data/ora e hash — allegabile all'ordine
  ERP. Questa è una firma elettronica *semplice* (SES eIDAS): sufficiente per la
  conferma d'ordine tra parti che si conoscono; per valore probatorio maggiore si
  può passare a OTP via email/SMS al momento della firma (firma "avanzata leggera").
- **RLS**: `firma` è scrivibile **solo** dal fornitore proprietario in fase di
  accettazione e **immutabile** dopo; Righi la legge come parte della `risposta`.

## 5. Seam di sync già presente nel client

Il contratto è lo stesso del prodotto hub-nozze, verificato da `tests/sync_test.js`:

```
remote.pull()                 -> { version, data } | null
remote.push(baseVersion,data) -> { ok:true, version }               (base == versione remota)
                              |  { conflict:true, version, data }    (remoto più avanti)
```

`makeMemoryRemote()` in `index.html` è l'implementazione di riferimento.
`Sync.enable(remote)` azzera il cursore di versione; un `Sync.pull()` iniziale
adotta lo stato remoto. Per il modello **per-entità** (sez. 2) l'adapter reale
non spingerà l'intero documento ma le singole mutazioni (insert/update sulle
tabelle) — mantenendo la stessa forma `pull/push` per lo stato derivato o
passando a sottoscrizioni Realtime per-tabella. Partire whole-document per lo
spike, misurare, poi granularizzare.

## 6. Ordine di lavoro consigliato

1. Provisiona Supabase (UE) + schema + RLS (incluso il test di isolamento fornitore).
2. Auth e-mail OTP + creazione `users`/`suppliers`; invito fornitore.
3. Adapter `makeSupabaseRemote` che rispetta il contratto; aggancio dopo login.
4. Realtime su `jobs`/`richieste`/`notifiche`.
5. Storage per gli allegati (bucket privato, URL firmati per il layout).
6. **Notifiche multicanale (sez. 4)**: outbox + dispatcher; email transazionale
   automatica, poi Web Push, poi WhatsApp (template approvati + opt-in).
7. **Firma leggera dell'accettazione (sez. 4-ter)**: `firma` server-side
   (user_id/ip/ts + hash), immutabilità via RLS, PDF di riepilogo ordine.
8. Solo dopo: auto-matching, analytics avanzate (roadmap).
