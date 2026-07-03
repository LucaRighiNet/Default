# Piano prodotto — da prototipo ad app vendibile

Documento di strategia tecnica e di prodotto. Stile advisor: prima i difetti e i
rischi, tag di confidenza sulle affermazioni chiave. Non sostituisce il REGISTRO
(build log); qui c'è la rotta per portare l'hub da prototipo a prodotto di mercato.

## 0. Premessa onesta (leggere prima di tutto)

- Oggi un backend NON esiste. L'app è client-only: un file HTML con stato in
  localStorage. "Irrobustire il backend" significa in larga parte costruirlo. [Certain]
- "Numero 1 delle app" non è un obiettivo pianificabile: dipende da mercato,
  marketing, timing e concorrenza, non solo dal codice. Quello che un piano può
  garantire è superare la BARRA tecnica e di prodotto di un'app di fascia alta,
  che è condizione necessaria (non sufficiente) per competere in cima. Riformulo
  l'obiettivo così e lo misuro con metriche (sez. 9). [Certain]
- Vincolo che cambia tutto: su iOS lo storage scrivibile da script viene evictato
  dopo 7 giorni di inattività; anche una PWA installata in home può perdere i dati
  dopo settimane di non uso. Per un matrimonio pianificato su 12-18 mesi la
  persistenza SOLO locale non è affidabile: da sola impone un backend di sync.
  [Certain — fonte WebKit/Search Engine Land]
- Dato sensibile: la app tratta dati personali di terzi (ospiti), incluse
  informazioni para-sanitarie (intolleranze, celiachia, vegano) e accessibilità.
  In UE questo è ambito GDPR serio, con obblighi di consenso, minimizzazione e
  possibili categorie particolari. Non è opzionale per vendere in Italia/UE. [Certain]

## 1. Stato attuale e gap

Cosa c'è (solido):
- Motore di dominio nativo completo: budget, ospiti, fornitori, tavoli (planimetria
  + optimizer + drag-drop), simulatore aperitivo, timeline, liste, import CSV/TSV.
- 101 test Node verdi, verifica Playwright, persistenza con fallback e flush.
- Offline-first, un solo file, ~187 KB.

Cosa manca per essere prodotto (gap principali):
- Nessun account, nessun multi-utente, nessun multi-evento reale (un solo evento seed).
- Nessuna sincronizzazione tra dispositivi; nessun backup lato server.
- Nessuna collaborazione (i due sposi + wedding planner sullo stesso evento).
- Nessuna condivisione verso gli ospiti (RSVP pubblico).
- Nessuna sicurezza server, nessuna conformità GDPR formalizzata.
- Nessuna distribuzione (store/PWA), monetizzazione, supporto, legale.
- Nessuna osservabilità (errori in produzione oggi sono invisibili).

## 2. Decisione architetturale (la scelta di fondo)

Tre strade:

```
Opzione                         Pro                              Contro
A) Local-first + backend sync   Mantiene offline/iPhone come     Sync e conflitti da
   (RACCOMANDATA)               forza; multi-device; backup;     progettare bene
                                collaborazione; migrazione
                                incrementale dal codice attuale
B) SaaS cloud puro (rewrite)    Modello classico, semplice da    Perde l'offline (killer
                                ragionare                        feature per il giorno
                                                                 dell'evento, spesso senza
                                                                 rete); rewrite costoso
C) Solo local + export manuale  Zero backend                     Non vendibile: niente
                                                                 multi-device, dati a
                                                                 rischio eviction iOS
```

Raccomandazione: A, local-first con backend di sync. [Likely] L'offline è un
vantaggio competitivo reale in questo dominio (sale, cantine, zone senza campo il
giorno delle nozze) e il codice attuale è già local-first: si aggiunge il livello
di sync sopra `Store`, senza buttare il lavoro fatto.

## 3. Backend da costruire

### 3.1 Modello dati (multi-tenant)
- users (auth, profilo, lingua)
- events (l'entità Evento già prevista come SEED; ora una riga per matrimonio)
- memberships (user × event × ruolo: owner, editor, viewer) — abilita collaborazione
- guests, tables, seating_rules, vendors, budget_lines, payments, tasks,
  runshow, lists, sim_scenarios — figli di event
- audit_log (chi ha cambiato cosa, per fiducia e debug)
- invites (token per invitare collaboratori e per RSVP pubblico ospiti)

### 3.2 Sincronizzazione (il cuore tecnico)
- Modello: sync a delta con versioni per record. Ogni entità porta updated_at +
  un contatore di versione; il client invia le modifiche locali, il server
  applica e restituisce le altrui.
- Conflitti: partire con last-write-wins per campo + audit log (semplice,
  sufficiente per 2-3 collaboratori). Valutare CRDT (es. Yjs) solo se la
  collaborazione simultanea fitta lo richiede. [Likely] Non serve CRDT al giorno 1.
- Offline: coda di mutazioni locale (IndexedDB) che si drena quando torna la rete;
  idempotenza lato server via id-mutazione.
- Opzioni realizzative: (a) costruire il sync su misura sopra un'API REST;
  (b) adottare un motore local-first (ElectricSQL, Replicache, PowerSync). La
  scelta (b) riduce il rischio ma aggiunge dipendenza. Raccomando valutare
  PowerSync/ElectricSQL con Postgres prima di scrivere sync a mano. [Guessing sul
  vincitore, da spike tecnico]

### 3.3 Stack consigliato (concreto, con alternative)
- Database: Postgres gestito (Neon/Supabase/RDS). Riga UE per residenza dati.
- Backend: due vie —
  1. Accelerata: Supabase (Postgres + Auth + Row Level Security + Realtime +
     storage). Ottimo time-to-market; la RLS mappa bene i ruoli per-evento.
  2. Controllo pieno: Node/TypeScript (Fastify) + Prisma + Postgres + Auth
     dedicata. Più lavoro, meno lock-in.
  Raccomando partire da Supabase per il P1 e riservarsi il porting se la scala lo
  giustifica. [Likely]
- Auth: email OTP + passkey; social login Apple e Google (Apple obbligatorio se
  c'è login social su app iOS in store). RBAC via ruoli membership / RLS.
- Realtime: canale WebSocket per co-editing e presenza.
- Client: mantenere l'HTML attuale come base PWA; astrarre `Store` dietro
  un'interfaccia (locale ⇄ remoto) così il resto del codice non cambia.

### 3.4 Sicurezza backend
- TLS ovunque; cifratura at-rest del DB; secret manager (niente chiavi nel client).
- Autorizzazione per-evento su OGNI query (RLS o middleware): il rischio numero
  uno multi-tenant è leggere i dati di un altro matrimonio.
- Validazione input server-side (mai fidarsi del client), rate limiting, audit.
- OWASP Top 10 come checklist; pen test prima del lancio a pagamento.
- Backup automatici con point-in-time recovery; test di restore periodico.

## 4. Canoni non-funzionali di un'app di vertice (la barra)

```
Area              Barra minima per "fascia alta"
Affidabilità      99.9% uptime obiettivo; error budget; nessuna perdita dati (il
                  peccato mortale in questo dominio)
Performance       avvio < 2s su mobile medio; interazioni fluide; Core Web Vitals
                  in verde; funziona a rete assente
Sicurezza         cifratura in transito/at-rest; isolamento per-tenant provato;
                  gestione segreti; dipendenze scansionate; pen test
Privacy/GDPR      base giuridica e consenso per i dati ospiti; minimizzazione;
                  export e cancellazione self-service; DPA coi sub-processor;
                  dati particolari (intolleranze/accessibilità) trattati con cura;
                  residenza dati UE; registro dei trattamenti
Accessibilità     WCAG 2.2 AA (contrasto, focus, screen reader, target touch 44px)
Internazionaliz.  i18n dal giorno 1 (l'app è in italiano; per scalare servirà EN+)
Osservabilità     error tracking (Sentry), log strutturati, metriche, analytics
                  privacy-friendly; oggi gli errori in produzione sono invisibili
Qualità/CI        unit+integrazione+e2e in CI; deploy automatici; feature flag;
                  code review; ambienti staging/prod separati
Backup/DR         RPO <= 24h (obiettivo minuti), RTO definito, restore testato
Supporto          canale di supporto, changelog, stato del servizio
```

## 5. Canoni di prodotto e mercato

### 5.1 Prodotto
- Onboarding che porta al primo valore in pochi minuti (crea evento → importa
  ospiti → prima cosa utile). L'onboarding attuale (guida) è un buon inizio.
- Multi-evento e collaborazione (sposi + wedding planner + famiglia) con ruoli.
- Condivisione verso ospiti: pagina RSVP pubblica con link/QR, che rientra nella
  sorgente unica. È spesso IL motivo per cui si sceglie un'app nozze.
- Notifiche (email/push) per scadenze, RSVP ricevuti, saldi fornitori.
- Template e duplicazione evento; import/export completo; storia/undo.
- Aiuto contestuale, changelog, richiesta recensione al momento giusto.
- Assegnazione automatica ospiti→tavoli (differenziatore di dominio): a partire
  da vicinanze (insieme/lontano), nucleo familiare e capienza, l'app propone una
  disposizione completa e poi ottimizza i posti dentro ogni tavolo. Oggi
  l'ottimizzatore riordina solo DENTRO un tavolo; questa feature aggiunge il
  passo mancante — l'assegnazione globale ai tavoli. Implementata come euristica
  (raggruppamento + bin-packing con vincoli), non solutore esatto. [primo taglio
  in questa sessione; margini di miglioramento: solutore migliore, blocco posti,
  suggerimenti "perché qui"]

### 5.2 Monetizzazione
- Modello consigliato: freemium + abbonamento (o acquisto una-tantum per singolo
  evento, che psicologicamente si sposa col matrimonio "una volta sola"). Testare
  entrambi. [Guessing sul migliore, da validare]
- Billing: Stripe (abbonamenti, IVA UE via Stripe Tax/OSS, fatturazione).
- Distribuzione e commissioni (fatti verificati):
  - PWA installabile: nessuna commissione store, pagamenti web con Stripe; ma
    minore discovery e frizione "Aggiungi a Home" su iOS.
  - App native negli store (via wrapper Capacitor): visibilità e fiducia, ma
    Apple applica commissioni; in UE dal 2026 vige un modello a più componenti
    (fee di acquisizione, store services, Core Technology Commission) e si può
    linkare a pagamenti esterni, ma non si possono offrire insieme IAP Apple e
    pagamenti alternativi nello stesso app storefront UE. [Certain — fonte Apple/RevenueCat]
  - Raccomandazione: PWA + wrapper Capacitor per presenza negli store, con
    pagamento web dove permesso per ridurre le commissioni; rivalutare secondo
    dove arrivano gli utenti. [Likely]

### 5.3 Legale e conformità
- Termini di servizio, Privacy Policy, cookie/consent, DPA coi fornitori
  (Supabase/Stripe/Sentry come sub-processor).
- Ruolo GDPR: probabile titolare del trattamento per i dati degli sposi e
  responsabile/contitolare per i dati ospiti — da definire con un legale.
- Valutare un DPO frazionale e un'assicurazione RC professionale.

### 5.4 Go-to-market minimo
- Landing con proposta di valore e prova; ASO/SEO; primi utenti reali (anche il
  matrimonio seed come caso pilota); ciclo di feedback; recensioni.

## 6. Roadmap a fasi

```
Fase  Obiettivo                         Deliverable chiave                 Uscita quando
P0    Stabilizzare il prototipo         Astrazione di Store; error         Zero perdita dati
      (2-4 sett.)                       tracking; hardening client;        locale; errori
                                        conferma touch su device           visibili
P1    Account + sync cloud              Auth; Postgres multi-tenant con    Un utente usa
      (6-10 sett.)                      isolamento per-evento; sync        l'app su 2
                                        offline↔online; backup/restore     dispositivi senza
                                                                           perdere dati
P2    Collaborazione + condivisione     Ruoli/inviti; RSVP pubblico;       Due persone editano
      + billing (6-10 sett.)            notifiche; Stripe; ToS/Privacy;    lo stesso evento; si
                                        conformità GDPR base               può pagare
P3    Distribuzione + qualità           PWA + wrapper store; WCAG AA;      Pubblicata; pen test
      (6-8 sett.)                       i18n EN; osservabilità piena;      passato; store live
                                        pen test; CI/CD completa
P4    Crescita                          Analytics prodotto; ASO/SEO;       Retention e
      (continuo)                        onboarding ottimizzato; supporto   conversione misurate
```

Nota tempi: indicativi per un team piccolo competente. [Guessing] Da soli e a
tempo parziale, moltiplicare. Le fasi si possono parzialmente parallelizzare.

## 7. Team e costi (onesto)

- Non è realistico portare questo a prodotto di mercato da soli in tempi brevi.
  Ruoli minimi: 1 backend/full-stack, 1 front/PWA-mobile, design/UX (frazionale),
  QA (frazionale o automazione), legale/DPO (consulenza). [Likely]
- Costi ricorrenti anche a basso volume: hosting DB, auth, email/push, error
  tracking, dominio, account sviluppatore Apple/Google, eventuale consulenza
  legale. Ordine di grandezza: gestibile all'inizio, cresce con gli utenti. [Guessing]

## 8. Rischi principali e mitigazioni

```
Rischio                                   Mitigazione
Perdita dati utente (fatale in questo     Sync + backup PITR + test di restore;
dominio)                                  flush già fatto lato client
Fuga dati tra tenant                      Autorizzazione per-evento su ogni query
                                          (RLS), test di isolamento dedicati
Sanzioni GDPR                             Conformità dal P2, legale coinvolto,
                                          minimizzazione dati ospiti
Complessità del sync offline              Valutare motore pronto (PowerSync/
                                          ElectricSQL) invece di scriverlo a mano
Commissioni/regole store                  PWA + pagamento web dove permesso;
                                          strategia di distribuzione flessibile
Scope infinito ("app numero 1")           Fasi con criteri di uscita; misurare
                                          metriche (sez. 9), non aspirazioni
```

## 9. Metriche di successo (la vera definizione operativa di "puntare al vertice")

- Nord-stella: eventi che arrivano al giorno delle nozze usando attivamente l'app.
- Attivazione: percentuale di nuovi utenti che completano evento + primo import
  ospiti entro la prima sessione.
- Retention: uso ricorrente nei mesi che precedono l'evento.
- Affidabilità: zero incidenti di perdita dati; uptime.
- Soddisfazione: NPS, recensioni store, churn.
- Economia: conversione free→pagante, LTV/CAC.

Un'app diventa "da vertice" quando questi numeri sono buoni e stabili, non per
una singola feature.

## 10. Primo passo immediato consigliato

P0, punto 1: astrarre `Store` dietro un'interfaccia (backend locale oggi, remoto
domani) senza cambiare il resto del codice, e aggiungere error tracking. È il
gesto che sblocca tutto il resto a rischio minimo e non spreca il lavoro fatto.
Prima di P1, uno spike tecnico di 1 settimana sul motore di sync (Supabase +
PowerSync/ElectricSQL vs sync su misura) per sciogliere l'incognita architetturale
più grossa.

## Fonti (per i fatti sensibili al tempo)

- Storage policy iOS/WebKit (eviction 7 giorni): https://webkit.org/blog/14403/updates-to-storage-policy/ ; https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519
- Regole/fee App Store UE 2025-2026 (DMA, pagamenti esterni): https://developer.apple.com/support/dma-and-apps-in-the-eu/ ; https://www.revenuecat.com/blog/growth/apple-eu-dma-update-june-2025/

---

## 11. Stato di avanzamento (aggiornato in questa sessione)

Legenda: FATTO = implementato e testato qui; SCAFFOLD = interfaccia/seam pronta,
dormiente, da collegare; UTENTE = richiede provisioning/decisioni esterne che non
posso fare da questo ambiente.

```
P0 stabilizzazione
  Astrazione Store (adapter) ................ FATTO
  Error tracking (Diag) + Diagnostica UI .... FATTO
  Hardening load (backup anti-perdita) ...... FATTO
  Flush su pagehide/visibilitychange ........ FATTO
  Conferma touch su dispositivo reale ....... UTENTE (checklist consegnata)

P1 account + sync cloud
  StorageAdapter + Sync (stato/retry/conflitti) FATTO (client)
  makeSupabaseRemote + auth + Cloud + login ... SCAFFOLD (testato su fake)
  Indicatore sync in UI ....................... FATTO
  Contratto backend (schema/RLS/protocollo) ... FATTO (BACKEND_P1.md)
  Progetto Supabase (UE) + chiavi + onAuthStateChange  UTENTE

P2 collaborazione + condivisione + billing
  Ruoli e permessi (owner/editor/viewer) ...... FATTO
  Inviti collaboratori (token/link/revoca) ..... SCAFFOLD (redenzione = UTENTE)
  Pagina RSVP pubblica (?rsvp=) ................ FATTO (submit al backend = UTENTE)
  Abbonamento (Billing) ........................ SCAFFOLD (Stripe = UTENTE)
  Legale ToS/Privacy/Cookie + UI privacy/export  FATTO (bozze da validare = UTENTE)

P3 distribuzione + qualità
  CI (GitHub Actions) .......................... FATTO
  PWA (manifest + icone + service worker) ...... FATTO
  Osservabilità (Diag.setReporter) ............. SCAFFOLD (Sentry = UTENTE)
  i18n (fondamenta + IT/EN su schede + toggle) . FATTO (estrazione completa = passata dedicata)
  Accessibilità WCAG 2.2 AA .................... PARZIALE (passata dedicata da fare)
  Wrapper store (Capacitor) + pen test ......... UTENTE

P4 crescita
  Onboarding guidato ........................... FATTO (Giro 6)
  Analytics / ASO / SEO / supporto ............. UTENTE
```

Test totali: 158 (11 suite) + node --check, verifiche Playwright per ogni feature.

## 12. Cosa serve da te per andare in produzione (riassunto)

1. Provisiona Supabase (regione UE) con schema + RLS di BACKEND_P1.md; imposta
   window.HUB_CLOUD={url,anonKey} e includi supabase-js; aggiungi onAuthStateChange
   per completare il login OTP. -> attiva P1/P2 (sync, ruoli, inviti, RSVP submit).
2. Account Stripe -> attiva Billing/abbonamenti.
3. Account error-tracking (es. Sentry) -> Diag.setReporter.
4. Valida i documenti legali con un legale; nomina eventuale DPO.
5. Conferma touch/drag-drop su iPhone reale (checklist già fornita).
6. Passate dedicate: estrazione i18n completa; audit accessibilità WCAG.
Il resto del codice client è pronto e testato per accogliere questi collegamenti.
