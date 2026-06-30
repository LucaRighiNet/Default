# Registro di build — Hub Nozze Righi × Biondi

Documento di build riconciliato. Aggiornare e ripresentare a ogni giro.
Integra: registro originale (corpo congelato a fine B1), sessione 2026-06-27
(chiusura B2 + indagine 3 punti), porting su Claude Code (Giro 0-1).

File di lavoro: `hub-nozze/index.html` (artifact unico autosufficiente).

AVVERTENZA workspace: l'handoff su Claude Code conteneva solo `index.html`.
Le 7 suite di test (sim_engine, a2, a4, import, b1, b2, bisync) e i sorgenti
`ref/` (App_tavoli_, Simulatore_aperitivo_) NON sono stati trasferiti. Finché
non vengono ricaricati, la disciplina di regressione "rieseguire tutte le
suite, bisync 12/12" non è verificabile: le modifiche su Claude Code sono
coperte solo da `node --check` + Playwright + ragionamento.

---

## 1. Stato per stadi (riconciliato)

Riconciliazione: la sezione 1 del registro originale dava B2 come DA FARE
(corpo congelato a fine B1), in contraddizione con la sessione 2026-06-27 che
lo chiudeva. Stato corretto: B2 FATTO. Verificato sul codice (Giro 0): presenti
seatRng, seatShuffle, seatCost, seatOptimize, seatRulesIdx, seatAffinityFn,
seatOptimizeTable, seatPairs; seed con seating:{rules:[]}. [Certain]

```
SIMULATORE APERITIVO (nativo)
  A1 motore (arrivi, code Monte Carlo, Erlang-C, p95)   FATTO  19 test
  A2 UI (controlli, stazioni, risultati, esito, consigli) FATTO 18 test
  A3 grafici canvas (arrivi, code, crosshair, legenda)   FATTO  (solo browser)
  A4 scenari salva/confronta/carica/esporta + no iframe   FATTO  7 test
  -> simulatore 100% nativo, iframe e blob rimossi

TABLEAU TAVOLI (nativo)
  B1 modello dati posti + serpentina + vicinati          FATTO  27 test
  B2 optimizer 2-opt + vincoli + affinità + undo          FATTO  25 test
  B3 planimetria SVG                                      DA FARE (solo browser)
  B4 drag-drop assegnazione posti (rischio alto)          DA FARE (solo browser)
  B5 rimozione iframe Tableau + blob TOOL_TABLEAU         FATTO   file 728→187 KB

IMPORT GUIDATO OSPITI
  E1 motore parser CSV/TSV + mappatura + dedup            FATTO  43 test
  E2 wizard guidato (incolla/file -> anteprima -> unisci) FATTO  (solo browser)
  E3 .xlsx binario via SheetJS (opzionale)                DA FARE

ALTRO
  bisync (regressione sync iframe Tableau)               12 test (NON verificabile: suite mancante)
  D guida/onboarding + suggerimenti contestuali           FATTO
  C pulizia finale: blob+bridge del Tableau, dopo B5      DA FARE
  Design Adriatico (pietra calcarea, mare petrolio, ottone) DA VALIDARE in browser
```

---

## 2. Decisioni vincolanti (non rimettere in discussione)

- Hub unico, generico, queste nozze come SEED (entità Evento, niente stringhe hard-coded).
- Niente doppioni: i tool sono i motori, l'hub li ingloba (nativi) o ne mostra riepiloghi.
- Port NATIVO preferito agli iframe (elimina rischio runtime e bridge).
- Sorgente unica ospiti = modulo Ospiti dell'hub; il numero invitati per il simulatore viene da `meta().plannedGuests` (NON duplicato nello stato sim).
- Bersaglio: iPhone ultima gen, Safari + Chrome; tabelle copiabili.
- Design: palette Adriatico (pietra calcarea + mare petrolio + ottone), centralizzata in variabili CSS.

RETTIFICA persistenza (Giro 1, autorizzata dall'handoff sez.5):
La vecchia regola "persistenza SOLO window.storage, MAI localStorage" era una
regola della sandbox Claude.ai, non di portabilità. Fuori da Claude.ai
(browser desktop, Safari iPhone, Playwright) window.storage non esiste e
localStorage è proprio ciò che serve. Decisione corrente: Store con backend
rilevato per feature detection (window.storage | localStorage | RAM).

---

## 3. Rischi aperti

- Suite di test e sorgenti ref/ non trasferiti su Claude Code: rete di regressione assente finché non vengono ricaricati. Rischio numero uno del workspace attuale.
- Drag-drop touch (B4), parte più fragile: gestire touch + mouse, evitare scroll durante il trascinamento, hit-testing sui posti SVG. Su Claude Code testabile con Playwright (pointer events); conferma finale sul dispositivo reale.
- Resa grafica del redesign Adriatico, SVG (B3), canvas (A3), wizard import (E2): giudizio estetico umano, da validare in browser.
- Iframe Tableau + blob base64 restano finché B5 non è completo. Se una CSP locale blocca l'iframe, la scheda Tavoli resta "apri strumento". Mitigato: B porta tutto nativo.
- Dimensione hub ≈187 KB dopo B5 (era ≈713 KB col blob Tableau); cresce con SheetJS (E3) e dati utente.

---

## 4. Insight e pattern (per non reintrodurre bug)

- Render dell'hub: `render()` ricostruisce `#view.innerHTML`. La delega click globale gestisce `data-act`; gli input dinamici (slider, ecc.) NON sono delegati, vanno ri-agganciati dopo ogni render. Pattern aperitivo: hook `if(active==="aperitivo") wireAperitivo()` in coda a `render()`. Stesso schema per Tableau B3/B4.
- Modale (`#modalRoot`) separato da `#view`: sopravvive a `render()`. Per UI interattiva mono-schermo (wizard import) listener diretti dentro il modale.
- Persistenza senza re-render: `Store.save(STATE)` (debounce 250ms). `commit(msg)` = recompute + Store.save + render.
- Stato sim in `ev().sim` = {stations, G, seq, scenarios, seqS}. Stato tavoli in `ev().tables` + `ev().seating`.
- ID: seed contigui `g+indice`; runtime `g+Date.now()+_i`. Nuove entità: seq nello stato.
- Modello posti serpentina/imperiale (2 file): indice pari = fila sopra, dispari = sotto, colonna = floor(idx/2). Dirimpettaio (`face`) = stessa colonna altra fila (peso 0.85); di fianco (`side`) = stessa fila indici +/-2 (peso 1.0). Pesi in SEAT_CFG. `seatPairs(n)` = coppie adiacenti uniche con peso; base del costo optimizer.
- Tavolo nativo = {id,name,shape('round'|'rect'|'square'|'imperial'|'serpentine'),seats,seatIds:[gid|null],x,y}. seatIds indicizzato per posto, buchi = null. Forme in SEAT_SHAPES.
- Lezione test (B2): verificare che l'ASSERZIONE sia giusta, non solo che il test passi. In `['A',undefined,'C','D']` le posizioni 0 e 2 sono adiacenti side, quindi together{A|C} dà costo −10, non 0. La vecchia "cost con vuoto = 0" era sbagliata.
- Rimozione iframe sim (A4): tolti UI, blob base64 e rami del listener `message`; openTool semplificato. Stessa procedura per il Tableau (B5/C).

---

## 5. Mappa file e test

- Lavoro: `hub-nozze/index.html`
- `hub-nozze/tests/app_check.js` = `<script>` estratto per `node --check`
- Suite Node attese (DA RICARICARE, non presenti nel workspace):
  - `sim_engine_test.js` (19), `a2_test.js` (18), `a4_test.js` (7),
    `import_test.js` (43), `b1_test.js` (27), `b2_test.js` (25),
    `bisync_test.js` (12, regressione, deve restare 12/12)
- Sorgenti read-only DA RICARICARE in `hub-nozze/ref/`:
  - `App_tavoli_.txt` (Tableau, ~1694 righe), `Simulatore_aperitivo_.txt`

---

## 6. Prossimi passi

1. Ricaricare le 7 suite + i sorgenti ref/ per ristabilire il verde di regressione (priorità).
2. B3: planimetria SVG (anteprima). Portare `seatPositions` da App_tavoli_ + footprint; wiring con hook in coda a render.
3. B4: drag-drop touch/mouse (anteprima, rischio alto).
4. B5: export/import nativo + rimozione iframe Tableau (risolve anche 8.2).
5. C: pulizia finale blob/bridge. D: guida/suggerimenti. E3: xlsx opzionale (SheetJS vendorizzato, valutare impatto dimensione).

---

## Sessione 2026-06-27 — B2 chiuso + indagine 3 punti

B2 (optimizer 2-opt nativo): COMPLETATO. Seed esteso con seating:{rules:[]}.
Funzioni: seatRng, seatShuffle, seatCost, seatOptimize, seatRulesIdx,
seatAffinityFn, seatOptimizeTable. Test 25/25. Regressione sync iframe 12/12.

Indagine 3 punti (verificata sul codice nativo):
1. "nuovo vuoto": newEvent → "Crea vuoto" azzerava solo budget/guests/payments/meta; restavano tavoli, vendors, tasks, liste, sim, seating.rules. Difetto di naming + svuotamento parziale.
2. Workspace tavoli "schiacciato": iframe height 82vh sotto header+tab+card → canvas Tableau compresso. Fix definitivo = port nativo B5. Verifica con Playwright 430x932.
3. Sync Fornitori→Timeline: FUNZIONA. taskDone: task con vendorCat è done se un vendor di quella categoria è "confermato". Fragilità: match per stringa categoria, no UI per vendorCat su task nuovi, timeline non mostra quale fornitore.

---

## Giro 0 (Claude Code) — setup baseline

- Importato `index.html` dall'handoff (713199 byte, coerente con ~713 KB atteso).
- Estratto lo `<script>` in `tests/app_check.js`; `node --check` = OK.
- Verificata presenza funzioni B2 → riconciliato stato B2 a FATTO.
- Suite di test e ref/ assenti: baseline verde NON stabilibile per regressione.

## Giro 1 (Claude Code) — persistenza (opzione B) + fix 8.1 e 8.3

Difetto/rischio per primo: senza le 7 suite non c'è rete di regressione; queste
modifiche sono verificate solo da `node --check` + Playwright + ragionamento.

- Persistenza opzione B [Certain sull'API, Likely sul backend]:
  Store rileva il backend per feature detection (non user-agent):
  window.storage → localStorage → RAM. Scelto localStorage e non IndexedDB:
  i dati di un singolo evento restano nell'ordine di decine/centinaia di KB,
  sotto il limite ~5 MB; IndexedDB aggiungerebbe codice senza beneficio a
  questa scala. Upgrade indicato solo se i dati si avvicinano al limite.
- 8.1 svuotamento completo + rinomina: "Crea vuoto" ora azzera vendors, tasks,
  lists, tables, runshow, sim.scenarios, seating.rules e riduce le stazioni
  sim a una generica. `runshow` non era nella lista dell'indagine ma conteneva
  voci specifiche ("La Fenice"): aggiunto, coerente con l'intento. Bottone menù
  "Nuovo vuoto" → "Nuovo evento vuoto".
- 8.3 trasparenza: helper `taskVendor(t)`; in timeline i task derivati mostrano
  "Confermato: <nome fornitore>" invece del generico "da fornitore". Logica di
  auto-spunta invariata.

Verifica Playwright (Chromium headless, 430x932, is_mobile):
- App carica fuori da Claude.ai (no window.storage) con backend localStorage.
- 8 schede renderizzano senza errori JS (timeline inclusa, ramo 8.3).
- `hub_state_v1` scritto al boot e persistente dopo reload.
- Unico errore console: 404 /favicon.ico (richiesta automatica del browser). Innocuo.

Non fatto (in questo giro): B3, B4, B5, E3, fix 8.2 (dentro B5).

## Giro 2 (Claude Code) — B3 planimetria SVG nativa + rete di regressione

Difetto/rischio per primo: i sorgenti ref/ (App_tavoli_) non sono nel workspace,
quindi la geometria seatPositions è scritta ex novo, NON portata dal Tableau: il
layout nativo non coincide pixel-per-pixel con l'iframe. Accettabile, è un render
nativo nuovo. L'iframe Tableau resta (rimozione = B5): coesistenza transitoria
dichiarata, sezioni separate ed etichettate, store non sincronizzati (è B5).

Stage 0 — rete di regressione parziale (solo test, rischio nullo):
- `tests/seat_native_test.js`: estrae le funzioni posti native da index.html
  (new Function + stub ev) e asserisce comportamenti noti. 9/9 verde, incluso il
  caso B2 documentato (['A',,'C','D'] together{A|C} = −10) e seatPairs(4).
- NON sostituisce le 7 suite originali (ancora da fornire).

Stage 1 — B3 (tutto additivo in index.html, B1/B2 non toccati):
- `seatPositions(t)`: geometria posti per forma. round su cerchio; square sul
  perimetro; rect/imperial/serpentine sul modello 2-file di seatColRow (così il
  disegno rispecchia le adiacenze face/side dell'optimizer).
- CRUD nativo: addTable/editTable/delTable su ev().tables; id via seq in
  ev().seating.seq; editor riusa modal(). editTable adatta seatIds alla nuova
  capienza preservando le assegnazioni.
- assignSeat(table,idx): click su un posto SVG → modale con ospiti non ancora
  seduti (seatableGuests) → seatIds[idx]=gid; dedup (libera l'ospite da altri
  posti). optimizeTable(id) riusa seatOptimizeTable.
- viewSeating riscritta: KPI + planimetria SVG nativa + tabella tavoli sopra,
  editor Tableau legacy sotto (etichettato). Posti pieni con iniziali, lato A/B
  a colore diverso; vuoti tratteggiati.
- Dispatch data-act: aggiunti addTable/editTable/delTable/optimizeTable/
  assignSeat. I click SVG passano per la delega globale (closest("[data-act]")
  funziona sugli elementi SVG): nessun hook wireSeating necessario.

Verifica:
- node --check OK; seat_native_test 9/9.
- Playwright 430x932: creato tavolo round/8 → 8 posti SVG; dropdown 9 ospiti +
  vuoto; assegnazione → 1/8 e iniziale disegnata; dopo reload tavolo e
  assegnazione persistono (localStorage). Smoke 8 schede: tutte renderizzano,
  zero errori JS (solo 404 /favicon.ico).
- Nota: la persistenza ha il debounce di 250ms preesistente in Store.save; una
  chiusura entro 250ms da una modifica perde l'ultima azione. Non introdotto da
  me; valutare un flush sincrono su visibilitychange/pagehide in un giro futuro.

Non fatto (in questo giro): B4 drag-drop, B5 export/import nativo + rimozione
iframe (chiude 8.2), C/D/E3. Geometria seatPositions da riallineare ad
App_tavoli_ se/quando i ref/ vengono caricati.

## Giro 3 (Claude Code) — B4 drag-drop posti (touch + mouse)

Difetto/rischio per primo: la conferma finale del touch resta sul dispositivo
reale. Verificato in Playwright con eventi pointer (mouse), NON ancora su iPhone
Safari. Il drag usa Pointer Events unificati + touch-action:none sui trascinabili
per non far partire lo scroll, ma il comportamento touch reale va provato.

Scelta d'ordine: B4 prima di B5. Si porta la planimetria nativa alla parità col
Tableau iframe (drag-drop incluso) PRIMA di rimuovere l'iframe in B5, così non
c'è una finestra in cui si perde il trascinamento. Non si smonta il vecchio
finché il nuovo non lo sostituisce.

Implementazione (additiva in index.html):
- Refactor: estratto seatAssignCore(table,idx,gid) (dedup + commit), riusato da
  modale (click) e drag. Nuovo seatUnseat(gid).
- "Riserva ospiti": tray di chip trascinabili (ospiti sedibili non assegnati)
  sotto la planimetria, dentro #planiHost.
- wireSeating(): un solo pointerdown su #planiHost (delega), ghost flottante,
  soglia di 6px per distinguere drag da click, hit-test su pointerup con
  document.elementFromPoint + closest('[data-seat-target]'/'#seatTray').
  Drop su posto = assegna/sposta (seatAssignCore, con auto-dedup); drop su
  riserva = libera (seatUnseat). Soppressione del click post-drag per non aprire
  la modale. Ri-agganciato dopo ogni render() via hook accanto a wireAperitivo.
- I posti SVG occupati portano data-drag-guest (sorgente) e tutti data-seat-target
  (bersaglio), con touch-action:none.

Verifica:
- node --check OK; seat_native_test 9/9.
- Playwright 430x932: drag posto→posto sposta l'ospite (1/8 invariato);
  drag riserva→posto assegna (1/8→2/8, riserva 8→7); drag posto→riserva libera
  (2/8→1/8). Click-su-posto (modale) ancora funzionante. Zero errori JS.
- DA FARE: conferma touch su iPhone reale (Safari).

Non fatto (in questo giro): B5 export/import nativo + rimozione iframe/blob
TOOL_TABLEAU (chiude 8.2 e riduce drasticamente la dimensione del file). Poi C/D/E3.

## Giro 4 (Claude Code) — ricostruzione delle suite di test

Difetto/rischio per primo: le 7 suite originali non sono recuperabili, quindi NON
sono riproducibili verbatim (i conteggi storici 19/18/7/43/27/25/12 erano delle
suite originali). Ho ricostruito la copertura funzionale per area, con asserzioni
verificate sul codice (lezione del registro: l'asserzione dev'essere giusta, non
solo verde — un mio errore tipico già corretto: simulateAperitivo ritorna un
oggetto {nNav,GRID,arr,...,stations:[]}, non l'array; asserzione riallineata).

Architettura test: harness condiviso `tests/_harness.js` estrae blocchi di
funzioni pure da index.html tra ancore testuali e li esegue con new Function +
stub (ev/meta/Store/$/...). Runner unico `tests/run_all.js`: node --check sullo
<script> estratto + tutte le suite, con totale.

Suite ricostruite e conteggi attuali (verdi):
  b1_test.js          17   modello posti: forme, vicinati, footprint, validazione
  b2_test.js          17   optimizer: costo (caso B2 -10), vincoli, affinità
  import_test.js      28   parser CSV/TSV, delimitatori, mappatura, dedup, buildImportPlan
  sim_engine_test.js  16   Erlang-C, p95 analitico, carico, server, primitive, Monte Carlo
  a2_test.js          14   simStatusOf, simMakeStation, simSnapshot
  a4_test.js           9   scenari: id, salva/carica/elimina, round-trip config
  TOTALE             101   + node --check OK

bisync (12, storica): NON ricostruita di proposito. Testava il sync hub↔iframe
Tableau via postMessage; lo stadio B5 (prossimo) rimuove quell'iframe e il bridge,
quindi una regressione su di esso testerebbe codice in via di eliminazione. Da
ridefinire (se serve) come test del round-trip export/import nativo dopo B5.

Lacuna nota: a2/a4 coprono la logica pura; le parti DOM (canvas A3, wiring,
rendering) restano verificabili solo in browser/Playwright, non in Node.

## Giro 5 (Claude Code) — B5: rimozione iframe Tableau + blob (chiude anche 8.2 e C)

Difetto/rischio per primo: la rimozione è irreversibile a livello di codice. Il
vecchio Tableau aveva un proprio store (tableau_v3) MAI sincronizzato in modo
compatibile col modello nativo: syncFromTableau mappava i tavoli come
{id,name,capacity}, incompatibile col nativo {id,name,shape,seats,seatIds,x,y}.
Quindi l'iframe non era una sorgente valida e la sua rimozione elimina un
conflitto latente, non una funzione viva. Eventuali dati seduti SOLO nel vecchio
Tableau (mai rientrati nell'hub) non sono recuperabili: accettato, perché non
erano comunque nella sorgente unica.

Rimosso (con verifica di zero riferimenti residui):
- blob base64 TOOL_TABLEAU (~536 KB, la riga enorme).
- openTool, hubGuestsForTool, syncFromTableau, renderToolSummary, var toolSummary.
- listener window "message" (bridge postMessage hub↔iframe).
- sezione "Editor tavoli (Tableau legacy)" in viewSeating + ramo data-act openTool.
Collegato il tag tavolo della vista Ospiti al modello nativo: da g.table (settato
solo dal sync rimosso) a seatTableOf(g.id). Sorgente unica preservata.

Effetto: file da 727.923 a 186.881 byte (−74%). La scheda Tavoli è ora 100%
nativa; niente più dipendenza da iframe/CSP/blob. Risolve alla radice 8.2
(workspace schiacciato) e la pulizia C.

Verifica:
- Nessun riferimento residuo ai simboli rimossi (grep). node --check OK.
- Suite: 101/101 verdi.
- Playwright 430x932: 8 schede renderizzano; drag-drop posti ancora funzionante
  (posto→posto, riserva→posto, posto→riserva); persistenza dopo reload; zero
  errori JS.

Stato Tableau: B1-B5 completi, port nativo concluso. Restano: D (guida/
onboarding), E3 (.xlsx via SheetJS, opzionale), e l'eventuale ridefinizione di
bisync come round-trip export/import nativo. Geometria seatPositions ancora da
riallineare ad App_tavoli_ solo se i ref/ verranno forniti (non bloccante).

## Giro 6 (Claude Code) — D: guida / onboarding + suggerimenti contestuali

Difetto/rischio per primo: l'onboarding "concluso" si salva via Store.save
(debounce 250ms); chi finisce la guida e chiude la scheda entro 250ms la
rivedrà al riavvio. Basso impatto (onboarding, non dati). Resta candidato il
flush su pagehide/visibilitychange già annotato.

Scelta: tour guidato via MODALE (non overlay con highlight posizionali, fragile
su mobile). Il modale vive in #modalRoot e sopravvive a render(), quindi ad ogni
passo commuto la scheda reale sotto e la mostro dietro la guida.

Implementazione (additiva):
- GUIDE[10]: intro + una tappa per ognuna delle 8 schede + chiusura. openGuide(i)
  imposta active=step.tab, render(), e (ri)apre il modale con Indietro/Avanti/
  Fine + Chiudi. finishGuide() segna STATE.onboarded e salva.
- Auto-apertura al primo avvio: in INIT, if(!STATE.onboarded) openGuide(0).
- Riapribile sempre: voce "Guida" nel menù ingranaggio + bottone nel banner.
- Suggerimento contestuale: TAB_TIP per scheda, hintBanner() anteposto a #view in
  render(); bottoni "Guida" e "Nascondi" (data-act openGuide/hideTip;
  tipHidden per sessione). Delegato via data-act, nessun nuovo wiring.

Verifica:
- node --check OK; suite 101/101.
- Playwright 430x932: guida si auto-apre al primo avvio; Avanti commuta scheda
  (es. al passo 3 scheda budget); raggiunge 10/10; Fine chiude e persiste
  onboarded; dopo reload NON si riapre; suggerimento presente e "Nascondi" lo
  toglie; riapertura dal banner/ingranaggio ok. Zero errori JS.

Restano: E3 (.xlsx via SheetJS, opzionale e sconsigliato per la dimensione) e
l'eventuale test round-trip export/import nativo (ex-bisync).
