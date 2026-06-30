# REGISTRO — Hub Nozze Righi × Biondi

Registro di build. Aggiornare e ripresentare a ogni giro.

## Stato workspace (porting su Claude Code)

Baseline importata dall'handoff. ATTENZIONE: l'handoff conteneva solo
`index.html` (~713 KB). Le 7 suite di test elencate alla sezione 4
(sim_engine_test.js, a2_test.js, a4_test.js, import_test.js, b1_test.js,
b2_test.js, bisync_test.js) e i sorgenti `ref/` (App_tavoli_.txt,
Simulatore_aperitivo_.txt) NON sono stati trasferiti. La disciplina di
regressione "rieseguire tutte le suite, bisync 12/12" non è quindi
verificabile finché quei file non vengono caricati.

## Stadi (da handoff, sezione 7)

- A1 motore aperitivo            FATTO
- A2 UI aperitivo                FATTO
- A3 grafici canvas              FATTO (solo browser)
- A4 scenari + rimozione iframe  FATTO
- B1 modello posti/serpentina    FATTO
- B2 optimizer 2-opt + vincoli   FATTO
- B3 planimetria SVG             DA FARE
- B4 drag-drop posti             DA FARE
- B5 export/import + rim. iframe DA FARE
- E1 parser CSV/TSV              FATTO
- E2 wizard import               FATTO (solo browser)
- E3 .xlsx via SheetJS           DA FARE (opzionale)
- bisync (regressione)           NON VERIFICABILE (suite mancante)

## Giri

### Giro 0 — setup baseline
- Importato `index.html` dall'handoff (713199 byte, coerente con ~713 KB atteso).
- Estratto lo `<script>` in `tests/app_check.js`; `node --check` = OK (sintassi valida).
- Suite di test assenti: baseline verde NON stabilibile per regressione.

### Giro 1 — persistenza (sez.5 opzione B) + fix 8.1 e 8.3
Difetto/rischio per primo: senza le 7 suite non c'è rete di regressione; queste
modifiche sono verificate solo da `node --check` + ragionamento + Playwright,
NON dalle suite. Ricaricare le suite resta la priorità.

- Persistenza opzione B [Certain sull'API, Likely sul backend scelto]:
  Store ora rileva il backend (feature detection, non user-agent):
  `window.storage` se presente (Claude.ai), altrimenti `localStorage`,
  altrimenti RAM. Scelto localStorage e non IndexedDB: i dati di un singolo
  evento (≈180 ospiti, budget, tavoli, scenari) restano nell'ordine delle
  decine/centinaia di KB, ben sotto il limite ~5 MB di localStorage; IndexedDB
  aggiungerebbe codice (open/transaction/versioning) senza beneficio a questa
  scala. Upgrade a IndexedDB indicato solo se i dati si avvicinano al limite.
- 8.1 svuotamento completo + rinomina:
  `newEvent`→"Crea vuoto" ora azzera vendors, tasks, lists, tables, runshow,
  sim.scenarios, seating.rules e riduce le stazioni sim a una generica.
  `runshow` non era nella lista dell'handoff ma conteneva voci specifiche
  ("La Fenice"): aggiunto allo svuotamento, coerente con l'intento.
  Bottone menu rinominato "Nuovo vuoto"→"Nuovo evento vuoto" (allineato al titolo del modale).
- 8.3 trasparenza legame fornitore→task:
  nuovo helper `taskVendor(t)`; in timeline i task derivati mostrano
  "Confermato: <nome fornitore>" invece del generico "da fornitore",
  con tooltip sulla categoria. Comportamento (auto-spunta) invariato.

Verifica Playwright (Chromium headless, 430x932, is_mobile):
- App carica FUORI da Claude.ai (niente window.storage) usando localStorage.
- 8 schede renderizzano senza errori JS (timeline inclusa, ramo 8.3).
- `hub_state_v1` scritto al boot e persistente dopo reload.
- Unico errore console: 404 /favicon.ico (richiesta automatica del browser, nessun asset referenziato dall'HTML). Innocuo.

Non fatto (fuori portata di questo giro): B3/B4/B5, E3, fix 8.2 (dentro B5).
