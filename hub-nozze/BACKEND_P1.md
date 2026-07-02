# Contratto backend — P1 (account + sync cloud)

Artefatto tecnico per il provisioning del backend. Lo scaffolding client è già in
`index.html` (modulo `Sync` + interfaccia `RemoteAdapter`, dormiente finché non
si chiama `Sync.enable(remote)`). Qui c'è cosa deve esistere lato server perché
diventi live, e cosa devi provisionare tu (non automatizzabile da questo ambiente).

## 0. Cosa serve da te (non posso farlo io da qui)

- Un progetto Postgres gestito con regione UE (raccomandato Supabase: include
  Auth + Row Level Security + Realtime + storage). In alternativa Neon/RDS + auth
  dedicata.
- Le chiavi del progetto (URL + anon key) da mettere in configurazione client.
- Decisioni di prodotto: provider di login (email OTP/passkey + Apple/Google),
  regione dati, nome dominio.

Con questi, agganciare il client è un passo piccolo (sez. 4).

## 1. Modello dati (Postgres)

```
users(id uuid pk, email text unique, created_at timestamptz)      -- gestito da Auth
events(id uuid pk, owner uuid fk users, name text, created_at, updated_at)
memberships(event_id uuid fk events, user_id uuid fk users,
            role text check in ('owner','editor','viewer'), primary key(event_id,user_id))
event_state(event_id uuid pk fk events, version bigint not null default 0,
            data jsonb not null, updated_at timestamptz, updated_by uuid)
audit_log(id bigserial pk, event_id uuid, user_id uuid, at timestamptz, action text, note text)
```

Nota: `event_state.data` è l'intero documento evento (l'attuale `STATE.events[id]`),
versionato. È il modello sync v1 "whole-document" — semplice e adatto a un
matrimonio (dati piccoli). L'evoluzione a per-entità/CRDT (P2) sostituisce
`event_state` con tabelle per guests/tables/... senza cambiare il client se il
`RemoteAdapter` mantiene lo stesso contratto.

## 2. Isolamento multi-tenant (RLS) — il rischio n.1

Attivare Row Level Security su tutte le tabelle. Un utente vede/modifica solo gli
eventi di cui è membro. Esempio di policy (Supabase/Postgres):

```
alter table event_state enable row level security;

create policy event_state_read on event_state for select
  using (exists (select 1 from memberships m
                 where m.event_id = event_state.event_id and m.user_id = auth.uid()));

create policy event_state_write on event_state for update
  using (exists (select 1 from memberships m
                 where m.event_id = event_state.event_id and m.user_id = auth.uid()
                       and m.role in ('owner','editor')));
```

Analoghe per events/memberships/audit_log. Test di isolamento dedicato: un utente
NON membro non deve leggere né scrivere l'evento di un altro.

## 3. Protocollo di sync (contratto del RemoteAdapter)

Il client parla con due sole operazioni (già implementate lato client come mock):

```
pull()  -> { version: bigint, data: string(json) } | null
push(baseVersion, data) -> { ok:true, version }                    (se baseVersion == versione remota)
                         | { conflict:true, version, data }          (se il remoto è avanti)
```

Realizzazione con Supabase:
- pull: `select version, data from event_state where event_id = :id`.
- push: update ottimistico con guardia di versione:
  `update event_state set data=:data, version=version+1, updated_at=now(), updated_by=auth.uid()
   where event_id=:id and version=:baseVersion returning version;`
  Se 0 righe aggiornate -> è un conflitto: rileggere e restituire {conflict, version, data}.
- Realtime (opzionale P1, utile per collaborazione): sottoscrizione alle modifiche
  di `event_state` per fare pull automatico quando un altro membro salva.

Policy conflitti v1: last-writer-wins (il client ri-pusha sopra la versione
remota). Adeguata per un editor primario; per co-editing simultaneo fitto passare
a per-entità/CRDT (P2). Il client espone `Sync.enable(remote,{onConflict})` per
sostituire la policy senza toccare il resto.

## 4. Aggancio lato client (quando il backend esiste)

Il seam è già pronto. Servirà solo un adapter che implementi pull/push contro
Supabase e chiamarlo dopo il login:

```
// pseudo
const remote = makeSupabaseRemote(client, eventId);   // implementa pull()/push()
const remoteState = await Sync.pull();                 // stato dal cloud
if (remoteState) { STATE = remoteState; recompute(); render(); }
Sync.enable(remote, { onConflict: handleConflict });
// Store.save già chiama Sync.notify() -> push con debounce
```

`makeMemoryRemote()` in `index.html` è la referenza del contratto (usata dai test
`tests/sync_test.js`): il `makeSupabaseRemote` deve comportarsi allo stesso modo.

## 5. Auth (sintesi)

- Email OTP o passkey come base; Apple/Google social (Apple obbligatorio se c'è
  login social nell'app iOS in store).
- Alla creazione utente: creare `events` + `memberships(owner)` al primo evento.
- Inviti collaboratori: token che crea una `membership(editor|viewer)`.

## 6. Ordine di lavoro consigliato (spike prima di industrializzare)

1. Provisiona Supabase (UE) + schema + RLS (sopra). 
2. Spike (mezza giornata): `makeSupabaseRemote` + login minimale; verifica
   pull/push/conflict con due browser sullo stesso evento.
3. Test di isolamento RLS (utente estraneo bloccato).
4. Solo dopo: inviti/ruoli (P2), realtime, billing.

## 7. Cosa NON è ancora deciso (da spike)

- Whole-document (v1, semplice) vs adozione di un motore local-first
  (PowerSync/ElectricSQL) per sync per-entità e offline robusto. Il client con
  RemoteAdapter regge entrambe; la scelta dipende da quanto pesa la
  collaborazione simultanea. Raccomando partire whole-document e misurare.
