# Portale Fornitori Righi — Piano di prodotto

> Prototipo per mettere in comunicazione **Righi** (committente) e i suoi
> **fornitori** su lavori di manodopera a progetto: cablaggio e
> costruzione di quadri elettrici (automazione, distribuzione, potenza).

## 1. Posizionamento — perché è diverso dai portali fornitori "classici"

I portali fornitori tradizionali sono costruiti attorno a due mondi:

- **Qualifica fornitori** (albo, documenti, audit, scoring): onboarding lento e
  burocratico.
- **Approvvigionamento materiali** (cataloghi, ordini, DDT, fatture): flusso
  ripetitivo su articoli standard.

Questo portale nasce per un terzo scenario, poco coperto dai prodotti sul
mercato: **la delega di lavori di manodopera a progetto**. Ogni lavoro è una
piccola commessa a sé (gara privata, spesso di piccola entità) che si esaurisce
in **3–5 settimane**. Non c'è un catalogo: c'è un **layout da quotare**, una
**data di consegna** e un **caposquadra** che segue il lavoro. Le leve non sono
prezzo di listino e lead time di magazzino, ma **velocità di assegnazione** e
**chiarezza della comunicazione tecnica** tra chi commissiona e chi esegue.

Di conseguenza il prodotto è progettato attorno a due driver:

1. **Minimizzare il testo scritto** — input guidati (chip, menu, template) al
   posto dei campi liberi, sia lato Righi (pubblicazione lavoro) sia lato
   fornitore (accettazione, domande, richieste).
2. **Massimizzare velocità e comunicazione** — un lavoro passa da bozza ad
   assegnato in pochi tocchi; il contatto col caposquadra segue una **prassi
   predefinita** con notifica immediata.

## 2. Attori

| Attore | Cosa fa nel portale |
|---|---|
| **Righi — Ufficio Subappalti** | Pubblica i lavori, sceglie la visibilità, notifica i fornitori, valuta le accettazioni, assegna la commessa, monitora ritardi e richieste. |
| **Caposquadra Righi** | Figura di riferimento che segue la commessa; riceve le richieste guidate dei fornitori (dubbi tecnici, mancanza materiale, ritardi…). |
| **Fornitore** | Vede i lavori proposti, fa domande o accetta la proposta, gestisce le commesse acquisite e contatta il caposquadra con richieste guidate. |

## 3. Modello dominio (MVP)

**Lavoro (commessa)** — le caratteristiche richieste:

- **Tipologia di lavorazione**: quadro di *automazione* · *distribuzione* · *potenza*
- **Settore**: packaging, legno, vetro, food & beverage, ceramica, logistica, automotive…
- **Lavorazioni industrializzate** (multi-selezione, visibili al fornitore):
  carpenteria esterna · foratura piastre · impostazione piastra con barre e canale
  · sbroglio fili · impostazione piastra con componenti
- **Budget** indicativo e **ore stimate** (le ore sono riservate a Righi)
- **Tre date**: **inizio lavori stimato** e **rientro in Righi** (visibili al
  fornitore) · **consegna al cliente** (riservata a Righi, mai esposta)
- **Caposquadra** di riferimento
- **Allegati**, con il **layout per la quotazione** in evidenza
- **Visibilità**: *tutti* i fornitori accreditati · *solo selezionati*
- **Stato**: bozza → da approvare → da assegnare (pubblicato) → assegnato →
  in corso → consegnato → chiuso

Ogni passaggio di stato ha **chi lo compie**, così non restano stati
irraggiungibili: il caposquadra *invia per approvazione*; il responsabile
*approva e pubblica* (o rimanda); il responsabile *assegna*; il **primo
avanzamento del fornitore** porta la commessa *in corso*; il fornitore *consegna*
(solo dopo l'approvazione del caposquadra); Righi *chiude la pratica*.

**Interazioni**

- Fornitore → lavoro: **domanda** oppure **accettazione** (con importo proposto).
- Righi → lavoro: **pubblica**, **notifica** (a tutti o a selezionati), **assegna**.
- Fornitore → caposquadra: **richiesta guidata** (dubbio tecnico, mancanza
  materiale, segnalazione ritardo, chiarimento layout/sopralluogo, pronto per
  collaudo/ritiro, altro).
- **Notifiche** verso i fornitori (nuovi lavori, assegnazioni) e verso Righi
  (accettazioni, domande, richieste).

## 4. Cosa fa il prototipo (implementato)

- **Accessi predisposti** con selezione utente e ruolo (Righi / Fornitore),
  sessione persistente e cambio-utente rapido per la demo.
- **Lato Righi**: dashboard (KPI cliccabili, ritardi, accettazioni da valutare,
  richieste), **vista massiva** dei lavori a **tabella filtrabile/ordinabile con
  ricerca e paginazione** (dimensionata per ~150 commesse assegnate + ~40 da
  assegnare in contemporanea) più **bacheca Kanban** d'insieme, form **Nuovo
  lavoro** a input guidati, gestione **richieste**, anagrafica **fornitori**.
- **Lato Fornitore**: **bacheca** dei lavori disponibili (con ricerca), **I miei
  lavori** con consegne e filtri, **richieste guidate** al caposquadra,
  **profilo** di accreditamento.
- **Ruoli lato Righi**: *responsabile di produzione* (vede tutto, pubblica,
  assegna, approva) e *caposquadra* (vede solo le commesse che segue). Il
  caposquadra può **proporre un nuovo lavoro** che il responsabile **approva e
  pubblica** o **rimanda** con nota (stato *Da approvare*, mai visibile ai
  fornitori); vede inoltre il **carico di tutti i fornitori**.
- **Ore stimate di produzione**: campo riservato a Righi su ogni commessa, usato
  per il **carico fornitori** — **istogramma** delle ore attive vs capacità per
  fornitore (mese selezionabile, semaforo sotto/quasi/oltre capacità, linea di
  capacità) con toggle **Tabella** multi-mese.
- **Import massivo** delle commesse da Excel/CSV (template incluso) ed **export
  CSV degli ordini accettati** per l'emissione ordine nell'ERP.
- **Auto-matching in pubblicazione**: scegliendo *solo selezionati*, il portale
  suggerisce i fornitori più adatti (specializzazione, capacità libera,
  puntualità) da invitare con un tocco. Ogni commessa è **duplicabile**.
- **Guida in app** contestuale ed **esaustiva** per responsabile, caposquadra e
  fornitore (con domande frequenti lato fornitore).
- **File unico portatile** (`Portale_Fornitori_Righi.html`): singolo file
  autosufficiente, doppio clic per provarlo offline su qualsiasi PC.
- **Pubblicazione, notifica mirata, accettazione, assegnazione** end-to-end.
- **Firma leggera dell'accettazione**: il fornitore conferma con una spunta di
  firma a proprio nome; l'accettazione registra nominativo, data e ora e Righi
  vede il timbro *firmato* nella conversazione e nella scelta dell'assegnatario.
  L'irrobustimento server-side (user/ip/hash, PDF ordine) è in `BACKEND.md`.
- **Notifiche in app + email**: ogni evento genera una notifica; l'email si
  compone in una finestra dedicata (apri nel client / copia testo), senza
  interrompere l'app. Il **backend multicanale** (email transazionale
  automatica, Web Push, WhatsApp con opt-in) è dettagliato in `BACKEND.md` (Fase 1).
- **Dall'email al portale in un clic (magic link)**: ogni email contiene un
  **link personale** che apre il portale **già identificati e direttamente sulla
  pagina finale** — la commessa da accettare, la richiesta a cui rispondere —
  senza passare dal login. Serve a portare dentro anche chi lavora solo via
  posta. Anche l'invio a **più fornitori** è personalizzato: un messaggio a testa
  col **proprio** link e il solo proprio indirizzo (più riservato del Ccn, che
  sostituisce). Il link **identifica ma non autorizza**: prima di aprire, il
  portale verifica sempre il diritto di vedere quel contenuto, così un codice
  commessa non diventa una scorciatoia ai permessi.
- **Avviso automatico sulle risposte**: quando Righi manda una **risposta
  rapida**, o decide su uno **slittamento** o sull'**approvazione a consegnare**,
  al fornitore parte **da sola** l'email con il testo e il link diretto, oltre
  alla notifica in app. Disattivabile sulla singola richiesta; l'esito è sempre
  dichiarato (inviata / disattivata / nessuna email in anagrafica), mai silenzioso.
- **Consegna delle notifiche garantita**: la notifica viene indirizzata anche a
  un fornitore che non è mai entrato nel portale, **senza creargli un accesso in
  anticipo**: l'accesso nasce al primo magic link e le notifiche sono già lì.
- **Anagrafica fornitori modificabile** dal **responsabile di produzione**
  (creazione e modifica scheda); il caposquadra consulta ma non modifica.
- **Richieste guidate più utili**: con il tipo *Altro* la nota di testo diventa
  **obbligatoria**, così una richiesta generica arriva sempre con una descrizione.
- **Guida che spiega gli stati**: in ogni guida di ruolo una sezione dedicata
  associa a ciascuno stato lo stesso badge colorato dell'app e il suo significato
  (il fornitore la vede dalla sua prospettiva).
- **Ritardi** evidenziati automaticamente (consegna superata su commessa attiva).
- **Metriche fornitore** (visibili a Righi e al fornitore): puntualità, lavori/mese,
  carico ore, richieste sollevate, tasso di accettazione, tempo di risposta,
  ritardo medio, con mini-trend mensile.
- **Tre date per commessa**: **inizio lavori stimato** e **rientro in Righi**
  (riconsegna del quadro finito) — entrambe **visibili al fornitore** — più la
  **consegna al cliente**, dato **riservato a Righi** e mai esposto al fornitore.
  Gli **alert di ritardo** si basano sulle date operative (*inizio in ritardo*,
  *rientro in ritardo*), **mai** sulla consegna al cliente; carico, puntualità e
  ordinamento seguono il **rientro**. In creazione la coerenza è validata
  (inizio ≤ rientro ≤ consegna).
- **Ciclo di vita rientro**: richiesta di **slittamento** dal fornitore (nuova
  data di **rientro**) con approvazione del caposquadra (sovrascrive + storico +
  notifica) e **modifica diretta** delle date da Righi; storico completo dei cambi.
- **Extra (lavorazioni in più)**: richiesta guidata del fornitore con importo,
  tipo e descrizione obbligatoria; Righi approva, rifiuta o **riconosce un
  importo diverso**. **Soglia al 10%** dell'importo concordato: sotto decide il
  caposquadra, sopra il responsabile. Le **ore aggiuntive** (dato interno)
  entrano in carico e capacità; gli extra aperti **bloccano l'approvazione a
  consegnare**; l'importo finale e l'export ERP distinguono base ed extra.
- **Consegna con approvazione (gate)**: il fornitore non chiude da solo — quando
  è pronto invia **Richiedi approvazione consegna** (richiesta al caposquadra);
  solo dopo l'ok compare **Segna consegnato**. Senza approvazione la consegna è
  bloccata, così Righi controlla sempre l'ultimo passo.
- **Gestione accessi**: creazione di un **nuovo utente** dal menu di accesso
  (ruolo **responsabile**, **OTL/caposquadra** o **fornitore** collegato a un
  fornitore dell'anagrafica); i capisquadra creati entrano subito come referenti.
- **Dati reali (Mappatura fornitori 2026)**: 54 fornitori (28 attivi, flag
  `attivo`) con capacità ore/mese, cablatori, risorse dedicate, costo orario,
  contatti, note e **% di utilizzo preferenziale per OTL/caposquadra**.
- **Assegnazione intelligente**: anagrafica categorizzata (specializzazioni,
  settori, **zona/coordinate**, **capacità mensile**, **certificazioni**,
  **limite di spazio**, **attrezzature**, **costo**, **stato attivo**) e la
  **preferenza dell'OTL** (% dal file) alimentano il **suggerimento fornitori**
  (solo attivi) in pubblicazione/assegnazione, l'**avviso di sovraccarico**, la
  segnalazione **"spazio insufficiente"** e il **semaforo salute commessa**.
- **Avanzamento a un tocco** lato fornitore (materiale → cablaggio → collaudo →
  pronto), notificato a Righi.
- **Mappa fornitori** (SVG offline) su **Nord-Centro Italia** (fornitori
  accreditabili in oltre 35 città, dal Piemonte alle Marche): pin colorati per
  carico, click per scheda e capacità libera; per il caposquadra evidenzia le
  zone già presidiate (ottimizzazione trasporti).
- **Analisi (cruscotto)**: scheda dedicata, scopata per ruolo, con grafici su
  **consegne per mese** (con quota da assegnare), **pipeline per stato**,
  **salute commesse** (semaforo aggregato), **andamento puntualità**, **mix per
  tipologia** e **carico per caposquadra**; i grafici categoriali sono cliccabili
  e aprono l'elenco filtrato. Palette validata (dataviz) con codifica secondaria
  (etichette, trama, gap) per daltonismo/stampa.
- **Interfaccia professionale senza emoji**, icone SVG, identità Righi Solutions.
- **Offline-first** (PWA + service worker); dati nello storage del dispositivo.
- **Grafo esplicito (perf)**: lo `STATE` è indicizzato come liste di adiacenza
  (fornitore-commesse, commessa-risposte/richieste, inviti) ricostruite una volta
  per versione dello stato, con memoizzazione delle metriche fornitore. Il render,
  prima **O(n²)** (ogni riga ricalcolava le metriche riscandendo tutte le commesse),
  è ora **lineare**: a 1000 commesse ~**10× più veloce** (73 ms → 7 ms), a parità di
  risultati (invarianti a test). È la Fase 1 del piano "teoria dei grafi".
- **Assegnazione ottima (grafo, Fase 2)**: pulsante **Assegna in modo ottimo** che
  risolve un **matching di peso massimo** sul grafo bipartito commesse–fornitori
  (solo chi ha accettato), rispettando le **ore libere per fornitore e mese**;
  propone l'allocazione (idoneità totale + commesse non collocabili) da confermare.
  Invarianti verificate a test (nessun fornitore oltre capacità, nessun doppio).
- **Collo di bottiglia della capacità (grafo, max-flow/min-cut)**: in *Analisi*,
  per mese di rientro, un **flusso di capacità** (sorgente → commesse → fornitori
  → pozzo) e il suo **taglio minimo** individuano **quante ore non sono collocabili**
  e **quali fornitori sono il vincolo**, distinguendo il caso capacità dal caso
  spazio/accettazioni. Algoritmo verificato a test (esempi noti + invarianti).
- **Seam di backend** già pronto (`Sync` + `RemoteAdapter`) — vedi `BACKEND.md`.

## 5. Sintesi della ricerca (portali simili) → scelte di design

Dall'analisi di piattaforme di subappalto/RFI in edilizia e servizi tecnici
(Procore, PlanHub, Simpro, Knowify, BuildOps, Bluebeam) emergono pattern
ricorrenti che abbiamo tradotto in scelte concrete:

| Pattern osservato sul mercato | Scelta nel portale Righi |
|---|---|
| **ITB / inviti a offrire** rapidi verso sottoinsiemi di fornitori | Visibilità *tutti / selezionati* + notifica mirata |
| **RFI con template** e instradamento automatico (−20% tempi di risposta) | **Richieste guidate** a tipo predefinito, instradate al caposquadra |
| **Moduli mobile** con foto/markup dal campo | Allegati e (roadmap) foto nelle richieste |
| **Assegnazione per skill/disponibilità** con drop-down filtrati | Anagrafica fornitori con specializzazioni e settori; (roadmap) auto-matching |
| **Quote-to-job** senza reinserire dati | Dalla accettazione all'assegnazione senza reimmissione |
| **Dashboard con stato in tempo reale** e badge/pill di stato | Dashboard KPI + pill di stato + evidenza ritardi |
| **"I fallimenti dei portali B2B sono fallimenti del modello dati travestiti da UX"** | Modello dominio esplicito e testato prima della UI |

Fonti: Procore (RFI), PlanHub (subcontractor management), Simpro (electrical
bid → job), Knowify (RFI/submittal), BuildOps, Bluebeam, Smart Interface Design
Patterns (badge/chip/pill), Elogic (B2B portal guide).

## 6. Roadmap — evoluzioni avanzate (driver di facilità d'uso)

Prioritizzate per impatto sui due driver (meno testo, più velocità).

### Fase 1 — Comunicazione a bassissimo attrito

*Già realizzato nel prototipo*: **richieste con foto** dal cantiere, **risposte
rapide** a template del caposquadra, **email di avviso automatica** su risposte
ed esiti, con **link diretto** che riporta nel portale sul punto giusto.

Resta da fare (richiede il server, vedi `BACKEND.md`):
- **Invio realmente automatico** delle email lato server, con token personale
  firmato e a scadenza al posto del link del prototipo.
- **Notifiche push reali** (Web Push) e canale **WhatsApp** con opt-in: l'avviso
  arriva dove il fornitore già lavora, non solo in posta.
- **Risposta dall'email** (reply-to con parsing in ingresso): anche chi risponde
  alla mail invece di cliccare il link rientra nel thread del portale.

### Fase 2 — Velocità di assegnazione

*Già realizzato nel prototipo*: **auto-matching** dei fornitori in pubblicazione,
**duplicazione** della commessa come template, **accettazione con firma leggera**,
**assegnazione ottima** sul grafo bipartito e lettura del **collo di bottiglia**.

Resta da fare:
- **Countdown assegnazione**: SLA visivo su quanto un lavoro resta senza risposta.
- **Riassegnazione assistita** quando un fornitore rinuncia o va oltre capacità.

### Fase 3 — Governo della commessa
- **Milestone di consegna** (materiale pronto, cablaggio, collaudo, ritiro) con
  avanzamento e **alert ritardo predittivo** prima della scadenza.
- **Reputazione fornitore** costruita sui lavori chiusi (puntualità, qualità,
  comunicazione) → alimenta l'auto-matching.
- **Chat di commessa** unica per lavoro, con caposquadra e fornitore.

### Fase 4 — Integrazione e scala
- **Integrazione layout/progettazione** (aggancio ai file di layout usati in
  produzione, es. foratura automatica): il fornitore quota sul dato reale.
- **Aggancio ERP/commesse Righi** per codici, budget e consuntivi.
- **Analytics**: tempo medio di assegnazione, tasso di accettazione per
  fornitore/settore, ritardi ricorrenti.
- **Multi-tenant reale** con backend cloud (vedi `BACKEND.md`) e ruoli.

## 7. Principi UX (guardrail)

1. **Un tocco batte un campo di testo**: chip, segmenti e menu prima delle textarea.
2. **Ogni schermata ha un'azione primaria evidente** (accento ambra).
3. **Lo stato è sempre leggibile a colpo d'occhio** (pill, colonne, colori).
4. **La comunicazione è incanalata**, non libera: template → instradamento → notifica.
5. **Mobile-first**: il fornitore vive in cantiere, non alla scrivania.
