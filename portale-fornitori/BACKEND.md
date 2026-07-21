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
  del terzista accreditato.

Login consigliato: **e-mail OTP / magic link** (attrito minimo, niente password
da gestire per i terzisti) + eventuale SSO per gli interni Righi.
Accreditamento fornitore = creazione di `supplier` + invito che genera un
`user(role='fornitore')` collegato. Un caposquadra è un `user(role='righi')` con
flag `caposquadra`.

```
users(id uuid pk, email text unique, role text check in ('righi','fornitore'),
      name text, supplier_id uuid null fk suppliers, caposquadra bool default false,
      created_at timestamptz)                                   -- id = auth.uid()
suppliers(id uuid pk, name text, citta text, accredited bool, specialties text[],
          settori text[], rating numeric, referente text, created_at,
          lat numeric, lng numeric, zona text,          -- mappa + ottimizzazione trasporti
          capacita_mese int, certificazioni text[])     -- carico libero + match requisiti
```

## 2. Modello dati (Postgres)

Il portale è **per-entità** (non whole-document): i lavori sono oggetti condivisi
letti da più fornitori, quindi conviene tabellare da subito.

```
jobs(id uuid pk, code text unique, title text, tipologia text, settore text,
     carpenteria text, budget numeric, ore_stimate int,   -- ore_stimate: SOLO Righi (mai esposto ai fornitori)
     data_richiesta date, data_consegna date,
     data_consegna_base date,                             -- data originale (per contare gli slittamenti)
     data_consegna_effettiva date,                        -- consegna reale → puntualità
     assegnato_at date,                                   -- per metriche (lavori/mese, tempo risposta)
     avanzamento text,                                    -- materiale|cablaggio|collaudo|pronto|null (aggiornato dal fornitore)
     storico_date jsonb,                                  -- [{from,to,by,byRole,at,motivo,tipo}]
     capo_id uuid fk users, descrizione text, visibility text check in ('tutti','selezionati'),
     stato text, assegnato_a uuid null fk suppliers,
     created_by uuid fk users, published_at timestamptz, created_at timestamptz)

job_inviti(job_id uuid fk jobs, supplier_id uuid fk suppliers, primary key(job_id,supplier_id))

allegati(id uuid pk, job_id uuid fk jobs, name text, storage_path text,
         is_layout bool, size text, created_at)                 -- file in Storage bucket

risposte(id uuid pk, job_id uuid fk jobs, supplier_id uuid fk suppliers,
         tipo text check in ('domanda','accettazione'), testo text, importo numeric null,
         from_side text, read bool default false, at timestamptz)

richieste(id uuid pk, job_id uuid fk jobs, supplier_id uuid fk suppliers,
          tipo text check in ('dubbio','materiale','slittamento','ritardo','sopralluogo','collaudo','altro'),
          testo text, stato text check in ('aperta','presa','chiusa'),
          data_proposta date, esito text check in ('approvato','rifiutato'),  -- solo per 'slittamento'
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
  policy così il filtro è **sul server**, non solo in UI.
- **`jobs` in scrittura**: solo `role='righi'`.
- **`risposte`**: un fornitore vede/scrive solo le proprie; Righi le vede tutte.
- **`richieste`**: un fornitore vede/scrive le proprie; il caposquadra della
  commessa e l'ufficio subappalti le vedono.
- **`notifiche`**: ognuno legge solo `to_user = auth.uid()`.
- **Ruoli Righi**: il *responsabile* (`role='righi'`, non caposquadra) vede tutte
  le `jobs`; il *caposquadra* (`caposquadra=true`) vede solo `capo_id = auth.uid()`
  (dashboard/elenco/richieste filtrati). Le funzioni di gestione (creazione,
  assegnazione, import/export) restano al responsabile.
- **Campi riservati Righi**: `ore_stimate` non va mai esposto ai fornitori — usare
  una **view** dedicata (o column-level privileges) per il lato fornitore che non
  includa la colonna. Le ore alimentano il carico terzisti (somma per fornitore ×
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
  copia). L'invio automatico (pubblicazione, assegnazione, richieste) è una
  Edge Function transazionale (Fase 1) — vedi sez. 4.

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

## 4. Realtime + notifiche

- **Realtime** su `jobs`, `risposte`, `richieste`, `notifiche`: la bacheca del
  fornitore e la dashboard Righi si aggiornano da sole.
- **Push**: alla pubblicazione/assegnazione e alle richieste guidate, una Edge
  Function invia Web Push / e-mail / WhatsApp (vedi roadmap Fase 1). Il client
  già crea i record `notifiche`: il trigger server li propaga sui canali.

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
6. Solo dopo: push multicanale, auto-matching, analytics (roadmap).
