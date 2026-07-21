# Portale Fornitori Righi — Piano di prodotto

> Prototipo per mettere in comunicazione **Righi** (committente) e i suoi
> **fornitori terzisti** su lavori di manodopera a progetto: cablaggio e
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
| **Fornitore terzista** | Vede i lavori proposti, fa domande o accetta la proposta, gestisce le commesse acquisite e contatta il caposquadra con richieste guidate. |

## 3. Modello dominio (MVP)

**Lavoro (commessa)** — le caratteristiche richieste:

- **Tipologia di lavorazione**: quadro di *automazione* · *distribuzione* · *potenza*
- **Settore**: packaging, legno, vetro, food & beverage, ceramica, logistica, automotive…
- **Carpenteria**: inclusa nel lavoro · eseguita da Righi · non prevista
- **Budget** indicativo, **data di richiesta**, **consegna desiderata**
- **Caposquadra** di riferimento
- **Allegati**, con il **layout per la quotazione** in evidenza
- **Visibilità**: *tutti* i fornitori accreditati · *solo selezionati*
- **Stato**: bozza → pubblicato → assegnato → in corso → consegnato → chiuso

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
- **Ruoli lato Righi**: *responsabile di produzione* (vede tutto) e *caposquadra*
  (vede solo le commesse che segue). Dashboard, elenco e richieste sono filtrati
  di conseguenza; il caposquadra non ha le funzioni di gestione (nuovo lavoro,
  fornitori, export).
- **Ore stimate di produzione**: campo riservato a Righi su ogni commessa, usato
  per il **carico terzisti** (somma ore attive per fornitore × mese di consegna).
- **Import massivo** delle commesse da Excel/CSV (template incluso) ed **export
  CSV degli ordini accettati** per l'emissione ordine nell'ERP.
- **Guida in app** contestuale per responsabile, caposquadra e fornitore.
- **Pubblicazione, notifica mirata, accettazione, assegnazione** end-to-end.
- **Notifiche in app + email**: ogni evento genera una notifica; l'email si
  compone in una finestra dedicata (apri nel client / copia testo), senza
  interrompere l'app. L'invio server-side è la Fase 1 (`BACKEND.md`).
- **Ritardi** evidenziati automaticamente (consegna superata su commessa attiva).
- **Interfaccia professionale senza emoji**, icone SVG, identità Righi Solutions.
- **Offline-first** (PWA + service worker); dati nello storage del dispositivo.
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
- **Notifiche push reali** (Web Push) + canale **WhatsApp/e-mail** verso fornitori
  e caposquadra: la richiesta guidata arriva dove il terzista già lavora.
- **Richieste con foto**: allega uno scatto dal cantiere invece di descrivere a
  parole (mancanza materiale, dubbio su morsettiera…).
- **Risposte rapide del caposquadra** a template ("Procedi", "Ti richiamo",
  "Uso alternativo OK") — thread senza tastiera.

### Fase 2 — Velocità di assegnazione
- **Auto-matching fornitori** per tipologia + settore + disponibilità: alla
  creazione del lavoro il portale propone già i terzisti giusti da invitare.
- **Lavori da template**: duplica una commessa tipo e cambia solo layout/date.
- **Accettazione con un tocco** e **firma leggera** della proposta (e-sign).
- **Countdown assegnazione**: SLA visivo su quanto un lavoro resta senza risposta.

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
