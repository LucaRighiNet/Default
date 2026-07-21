# Portale Fornitori Righi

Portale per mettere in comunicazione **Righi** e i suoi **fornitori terzisti**
sui lavori di subappalto di manodopera: **cablaggio e costruzione di quadri
elettrici** (automazione, distribuzione, potenza).

Non è un portale di qualifica fornitori né di approvvigionamento materiali: è un
portale di **delega di lavori a progetto**, pensato per gare piccole e brevi
(3–5 settimane), con due obiettivi di design — **ridurre il testo scritto** e
**accelerare l'assegnazione**. Vedi [`PIANO_PRODOTTO.md`](PIANO_PRODOTTO.md).

## Avvio

È una web-app statica offline-first (PWA), senza dipendenze da installare.

- **Subito**: apri `index.html` in un browser. Al primo accesso scegli un utente
  (lato Righi o lato Fornitore) — gli accessi sono già predisposti per la demo.
- **Come sito** (consigliato per la PWA / installazione su telefono): servi la
  cartella con un web server statico, es.:

  ```bash
  cd portale-fornitori && python3 -m http.server 8080
  # poi apri http://localhost:8080
  ```

Con il bottone **"cambia utente"** in alto a destra passi al volo tra il lato
Righi e il lato fornitore per vedere entrambe le prospettive.

## Cosa puoi provare

**Lato Righi**
- **Dashboard** (per ruolo, vedi sotto): commesse pubblicate/assegnate,
  **ritardi**, accettazioni da valutare, richieste dei fornitori (KPI cliccabili
  che portano al filtro).
- **Commesse — vista massiva**: pensata per **centinaia di commesse in parallelo**
  (~150 assegnate + ~40 da assegnare nel seed dimostrativo). **Elenco** a tabella
  densa con **ricerca**, **filtri** (stato, tipologia, settore, caposquadra,
  fornitore, solo ritardi), **ordinamento** e paginazione; in alternativa la
  **bacheca Kanban**. Apri una scheda per pubblicare, **notificare**, **assegnare**.
- **Ore stimate di produzione**: campo **riservato a Righi** (mai visibile al
  fornitore) su ogni commessa; alimenta il **carico terzisti** — nella scheda
  **Fornitori** vedi la somma delle ore attive per fornitore e **mese di consegna**.
- **Nuovo lavoro**: form a input guidati (tipologia, settore, carpenteria, budget,
  **ore**, date, caposquadra, layout; visibilità *tutti / selezionati*; notifica
  anche via **email**). In alternativa **import massivo da Excel/CSV** (con
  template scaricabile): le commesse entrano come bozze.
- **Esporta ordini (ERP)**: da Commesse esporti in **CSV** gli ordini accettati
  (fornitore, importo, ore, consegna…) per l'emissione ordine in amministrazione.
- **Richieste** e anagrafica **Fornitori** accreditati (con contatto **email**).

**Ruoli e accessi (lato Righi)**
- **Responsabile di produzione**: vede **tutte** le commesse, pubblica, assegna,
  importa/esporta, governa il carico dei terzisti.
- **Caposquadra**: vede in Dashboard e Commesse **solo i progetti che segue**
  (di cui è riferimento) e le relative richieste dei fornitori.

**Guida in app**: il pulsante **?** in alto apre una guida passo-passo diversa
per Responsabile, Caposquadra e Fornitore.

**Notifiche ed email**: ogni evento (pubblicazione, notifica mirata, richiesta
guidata, risposta) genera una **notifica in app**; dove serve comunicare fuori
dal portale è disponibile l'**email precompilata** (destinatario, oggetto e
corpo pronti) verso fornitori e caposquadra. L'invio automatico lato server è
la naturale evoluzione (vedi `BACKEND.md`).

**Visibilità dei lavori**: un fornitore vede i lavori proposti secondo la
visibilità (*tutti* o *selezionati*), ma **appena un lavoro viene assegnato
resta visibile solo all'assegnatario** — gli altri fornitori non vedono le
commesse affidate a terzi. **Righi vede sempre tutto.**

**Mobile**: interfaccia mobile-first. Su smartphone la vista massiva dei lavori
diventa una **lista di schede compatte tap-friendly** (niente tabelle da
scorrere in orizzontale), le finestre si aprono come *bottom sheet* e i comandi
rispettano le aree di sicurezza del dispositivo.

**Lato Fornitore**
- **Bacheca**: i lavori proposti da Righi; **Accetta** o **fai una domanda** con
  un tocco; il **layout** per la quotazione è in evidenza.
- **I miei lavori**: commesse acquisite e consegne.
- **Richieste guidate**: contatta il **caposquadra** seguendo la prassi Righi
  (dubbio tecnico, mancanza materiale, ritardo, chiarimento layout, pronto per
  collaudo…) — la notifica arriva subito al referente della commessa.

## Struttura

| Percorso | Contenuto |
|---|---|
| `index.html` | L'app (PWA) — CSS e JS inline, nessun asset esterno |
| `manifest.json`, `sw.js`, `logo.svg` | PWA: installazione, offline, icona |
| `PIANO_PRODOTTO.md` | Piano di prodotto, sintesi ricerca, roadmap avanzata |
| `BACKEND.md` | Contratto backend: accessi (auth) + sync multi-utente |
| `tests/` | Suite native Node (CI: `node tests/run_all.js`) |

## Test

```bash
cd portale-fornitori && node tests/run_all.js
```

Verifica la sintassi dell'app (`node --check`) e la logica pura di dominio
(regole di **visibilità** dei lavori, **ritardi**, integrità del seed, helper) e
il contratto di **sync**. Nessuna dipendenza esterna.

## Dati e privacy

Prototipo dimostrativo: i dati (utenti demo, lavori, richieste) restano **sul
dispositivo** nello storage del browser. Nessun invio a server. Il passaggio a
un backend cloud multi-utente è descritto in [`BACKEND.md`](BACKEND.md); il
client ha già il *seam* di sync pronto e testato.
