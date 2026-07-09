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
  B3 planimetria SVG + CRUD tavoli + assegnazione         FATTO   layout no-overlap
  B4 drag-drop assegnazione posti (touch+mouse)           FATTO   verificato Playwright
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

## Giro 7 (Claude Code) — robustezza salvataggio + touch drag-drop

Due interventi richiesti.

1. Flush del salvataggio (chiude la fragilità del debounce 250ms):
   Store.flush() scrive subito una save in sospeso; registrato su 'pagehide' e su
   'visibilitychange' (hidden). Su iOS sono gli eventi affidabili ('unload' no).
   Con localStorage la set è sincrona, quindi persiste anche durante l'unload.
   Verifica Playwright: modifica + pagehide immediato (entro il debounce) →
   localStorage già aggiornato.

2. Touch drag-drop irrobustito e verificato con eventi touch REALI (CDP
   Input.dispatchTouchEvent, non più solo mouse). Tre bug di touch trovati e
   risolti in sequenza (diagnosi via strumentazione pointer):
   a. setPointerCapture interferiva con la consegna del pointerup su touch →
      RIMOSSA (i listener su document in cattura ricevono già tutti gli eventi).
   b. cattura implicita del pointer sull'elemento SVG sorgente → rilasciata in
      pointerdown (releasePointerCapture) così gli eventi fluiscono a document.
   c. causa principale: touch-action:none sul <g> SVG non è onorato → il browser
      reclamava il gesto per lo scroll e annullava il drag (pointercancel).
      Messo touch-action:none sull'<svg> radice; il resto della pagina resta
      scrollabile.
   Aggiunti anche: tracciamento del solo pointerId che ha iniziato (niente
   confusione multi-dito) e gestione pointercancel (cleanup).
   Verifica Playwright touch: riserva→posto assegna, posto→riserva libera,
   posto→posto sposta. Click-su-posto (tap) ancora apre la modale.

Limite non colmabile qui: la conferma finale del touch su iPhone/Safari reale
non è automatizzabile in questo ambiente (Playwright usa Chromium). Checklist per
il dispositivo consegnata all'utente (deploy via Safari + Aggiungi a Home; drag
con un dito; verifica che la pagina non scrolli durante il trascinamento).

## Giro 8 (Claude Code) — P0: astrazione Store + error tracking + hardening

Primo passo del piano prodotto (P0). Tutto additivo/refactor, comportamento
invariato per il percorso felice.

- StorageAdapter astratto: il MEZZO di persistenza (window.storage | localStorage
  | memory) dietro interfaccia async get/set/remove. Store.useAdapter() è il seam
  per agganciare in P1 un adapter remoto/sync senza toccare render/commit/INIT.
- Diag: error tracking senza backend. Cattura window 'error' e
  'unhandledrejection', buffer limitato (25) persistente su chiave separata,
  ispezionabile dalla voce "Diagnostica" nel menù (con export testo + svuota).
- Hardening load: stato illeggibile (JSON rotto o forma non valida) NON viene
  sovrascritto in silenzio ma copiato in hub_state_v1_bak e loggato; l'app
  riparte dal seed. Zero perdita dati.
- Resilienza UI: gestore click globale in try/catch → Diag.log + toast, così
  un'azione difettosa non causa white-screen.
- Bug preesistente corretto: i pulsanti del menù ingranaggio che aprono un
  sotto-modale (Guida, Diagnostica, Nuovo evento vuoto, Reset al seed) non avevano
  close:false, quindi il modale esterno chiudendosi cancellava subito quello
  interno. Ora aperti correttamente.

Verifica: node --check OK; suite 111/111 (nuova storage_test 10); Playwright:
app avviata dopo refactor, Diagnostica apre, errore non gestito catturato, stato
corrotto → backup + boot dal seed + log (contesto pulito).

## Giro 9 (Claude Code) — fix segnalati: overlap tavoli + categorizzazione optimizer

Due difetti segnalati dall'utente, corretti prima di proseguire.

1. Tavoli sovrapposti: l'auto-layout usava una griglia fissa 7×6 che ignorava
   l'ingombro reale, quindi tavoli grandi (imperiale/serpentina/molti posti) si
   accavallavano. Fix: seatLayout() dispone i tavoli su una griglia con celle
   dimensionate sull'ingombro MASSIMO (maxW+1.8 × maxH+2.2) e colonne ≈√n;
   renderPlanimetria usa queste posizioni. Sovrapposizione impossibile per
   costruzione. Verifica Playwright: 4 tavoli di forme diverse, 0 coppie sovrapposte.

2. Categorizzazione per l'ottimizzatore assente: seating.rules (vincoli
   insieme/lontano che la funzione di costo dell'optimizer usa) non aveva NESSUNA
   UI, quindi l'ottimizzatore girava senza vincoli. Fix: sezione "Vicinanze" nella
   scheda Tavoli — aggiungi/elenca/rimuovi regole together/separate tra due ospiti
   (una per coppia), che alimentano seatRulesIdx→seatOptimize. Aggiunto
   "Ottimizza tutti" (ottimizza ogni tavolo con ≥2 seduti). Chiarito che anche
   nucleo familiare e bambini creano affinità automatica (già nell'editor ospite).
   Verifica: regola aggiunta→UI+seating.rules persistiti; Ottimizza tutti senza
   errori; rimozione ok.

Limite dichiarato: l'ottimizzatore riordina i posti DENTRO un tavolo (le vicinanze
contano quando i due ospiti sono già allo stesso tavolo); non assegna gli ospiti
ai tavoli in automatico. Assegnazione globale ottimizzata = possibile stadio futuro.

Suite 111/111; node --check OK; zero errori JS.

## Giro 10 (Claude Code) — assegnazione globale ospiti→tavoli (feature b nel piano)

Inserita nel piano prodotto (5.1) e implementata. Colma il passo mancante: prima
l'optimizer riordinava solo DENTRO un tavolo; ora l'app assegna anche gli ospiti
ai tavoli.

- seatPlanAssignment(tables, guests, together, separate) — PURA, testabile:
  union-find per raggruppare chi sta "insieme" + stesso nucleo; bin-packing dei
  gruppi nei tavoli rispettando capienza e vincoli "lontano"; ritorna
  {assign, unseated, warnings}. Euristica greedy, non solutore esatto (dichiarato).
- seatAutoAssign(): applica il piano ai seatIds, poi seatOptimizeTable per tavolo;
  autoAssignConfirm() con modale (azione distruttiva: sostituisce la disposizione).
- UI: "Assegna automaticamente" nella scheda Tavoli (accanto a Ottimizza tutti).

Verifica: b2_test +5 (22/22, totale 116). Playwright: 9/9 ospiti assegnati,
coppia "insieme" stesso tavolo, coppia "lontano" tavoli diversi, zero errori JS.

Limite: gruppo più grande della capienza del tavolo viene diviso (warning);
capienza totale insufficiente → alcuni restano senza posto (riportato nel toast).
Margini futuri: solutore migliore, blocco posti, spiegazione "perché qui".

## Giro 11 (Claude Code) — P1 groundwork: scaffolding sync + contratto backend

"Procedi" = P1 (account + sync cloud). Limite dichiarato: un backend live non è
provisionabile da questo ambiente (serve infra + credenziali + decisioni prodotto
dell'utente). Consegnati gli artefatti che rendono P1 agganciabile.

- Client (index.html): modulo Sync DORMIENTE (enable/disable/pull/notify/flush) +
  interfaccia RemoteAdapter (pull/push con versione e conflict) + makeMemoryRemote
  (mock, referenza del contratto). Store.save chiama Sync.notify (no-op finché non
  abilitato) e i listener pagehide/visibilitychange fanno Sync.flush. Comportamento
  dell'app INVARIATO (sync spento di default).
- Contratto backend: BACKEND_P1.md — schema Postgres (users/events/memberships/
  event_state/audit_log), RLS per isolamento per-evento, protocollo sync
  (pull/push ottimistico con guardia di versione), aggancio client, auth, ordine
  di lavoro. Modello v1 = whole-document versionato + last-writer-wins; path a
  per-entità/CRDT (P2).
- Aggiornato PIANO_PRODOTTO.md 5.1 con la feature di assegnazione (Giro 10).

Verifica: node --check OK; suite 124/124 (nuova sync_test 8: mock pull/push,
versioni, conflitto, resolver, LWW). Playwright: app invariata (boot + persistenza
ok, zero errori JS) col sync dormiente.

Cosa resta all'utente per andare live: provisionare Supabase (UE) + schema/RLS,
dare le chiavi; poi makeSupabaseRemote (piccolo) e Sync.enable dopo il login.

## Giro 12 (Claude Code) — P1 "a secco": adapter Supabase + auth + login (pronti da collegare)

Scelta utente (b): scrivere e testare makeSupabaseRemote + flusso di login contro
mock/fake, pronti da collegare, senza backend live.

- makeSupabaseRemote(supabase, eventId): implementa il contratto RemoteAdapter
  (pull/push) contro le API di supabase-js — update ottimistico con guardia di
  versione, insert al primo salvataggio, conflict con rilettura. Testato contro un
  fake client (query builder simulato): pull vuoto, insert v1, update, conflict,
  isolamento fra eventi.
- Auth: makeMockAuth (dry-run) + makeSupabaseAuth (signInWithOtp/signOut/getUser).
- Cloud controller: configure/login/logout; login abilita Sync, fa pull, ritorna
  {user, cloudState}. Dormiente finché non configurato.
- UI: voce "Account e sync" nel menù. Se cloud non configurato mostra lo stato e
  rimanda a BACKEND_P1.md; altrimenti login via email e sync. openAccount applica
  cloudState a STATE (o pubblica lo stato locale al primo accesso).
- Bootstrap in INIT: se window.HUB_CLOUD + supabase-js presenti, costruisce il
  client e Cloud.configure(makeSupabaseAuth, makeSupabaseRemote). Assenti ora ->
  Cloud dormiente, app puramente locale.

Verifica: node --check OK; suite 133/133 (nuova cloud_test 9). Playwright: app
invariata; "Account e sync" mostra "non configurato"; zero errori JS.

Per andare live manca solo (lato utente): progetto Supabase (UE) + schema/RLS di
BACKEND_P1.md + chiavi in window.HUB_CLOUD e inclusione di supabase-js. Allora il
flusso già scritto si attiva senza altre modifiche.

## Giro 13 (Claude Code) — P1 robustezza sync + indicatore di stato

Continuazione P1 lato client (nessun backend richiesto).

- Sync: macchina di stato (local|syncing|synced|offline|conflict) con callback
  onStatus; retry() dei push rimasti in sospeso; listener window 'online' che
  ripubblica automaticamente al ritorno della rete; su conflitto notifica
  (onConflict) e applica last-writer-wins (locale vince).
- UI: indicatore #syncChip nell'header, visibile SOLO se il cloud è configurato
  (dormiente ora); mostra "Accedi per sincronizzare" / "☁ Sincronizzato" /
  "Sincronizzo…" / "Offline" / "Conflitto risolto". Aggiornato via onStatus e in
  coda a render(); toast sul conflitto; stato mostrato anche nel modale Account.
- Bootstrap: updateSyncChip() dopo la configurazione (che gira dopo render()).

Verifica: node --check OK; suite 137/137 (sync_test 12: stato, onStatus, conflitto
notificato + risolto, offline+retry). Playwright: (a) regressione senza cloud →
chip nascosto, app invariata; (b) dry-run con supabase FINTO iniettato →
pre-login "Accedi per sincronizzare", post-login "☁ Sincronizzato"; zero errori JS.
Verificato così l'intero stack bootstrap→Cloud→login→Sync→pull→indicatore.

Nota P1 (per lo spike): l'auth Supabase via OTP non autentica al signInWithOtp
(l'utente clicca il link via email); servirà un listener onAuthStateChange per
completare il login. makeMockAuth invece autentica subito (per il dry-run).

## Giro 14 (Claude Code) — P2 (a secco): ruoli e permessi

Avvio P2 (collaborazione) lato client. Ruoli owner/editor/viewer con gating.

- Session: ruolo dell'utente (default 'owner' = uso locale/pieno accesso);
  setRole/canEdit. In P2 il ruolo arriva dalla membership; Cloud.login lo imposta
  (da user.role o auth.getRole), logout torna a owner.
- Gating centrale: nel dispatcher click, permBlocks(act) blocca le azioni mutanti
  se !canEdit e mostra "Sola lettura"; le azioni safe (navigazione, guida,
  account, diagnostica, hideTip) restano permesse. Guard anche sul drag-drop
  (i viewer non trascinano).
- UI: il chip sync aggiunge "· sola lettura" per i viewer; stato/ruolo visibili.

Verifica: node --check OK; suite 145/145 (nuova perm_test 8: Session, actIsMutating,
permBlocks). Playwright: (A) owner senza cloud apre l'editor tavolo (nessuna
regressione); (B) viewer via fake cloud → chip "☁ Sincronizzato · sola lettura",
"+ Tavolo" bloccato (editor non si apre); zero errori JS.

Limite v1: il viewer è bloccato anche dall'aprire gli editor in sola visione
(no "view details"); refinement futuro. Ruolo reale = query memberships lato
backend (spike). Prossimi P2: inviti/token collaboratori + pagina RSVP pubblica.

## Giro 15 (Claude Code) — P3 CI+PWA, P2 inviti + RSVP pubblico

Proseguo il piano in autonomia.

- CI: .github/workflows/ci.yml esegue le suite su push/PR.
- PWA installabile: manifest.json (icone 192/512 + maskable, theme), apple-touch-icon
  + meta iOS, service worker (app shell cache-first + fallback offline),
  registrazione guardata. Verificato: manifest linkato/fetchabile, SW registrato.
- P2 inviti collaboratori: makeInviteToken/inviteURL, UI "Invita collaboratore"
  (ruolo editor/viewer, lista, revoca) nell'Account; l'hint di ruolo dal link
  ?invite&role alimenta Session al login. Dormiente finché cloud non configurato.
- P2 RSVP pubblico: apertura con ?rsvp=<token> mostra una pagina ospite dedicata
  (niente app né onboarding); form -> buildRsvpPayload; invio conferma (in
  produzione POST al backend). "Link RSVP ospiti" nell'Account.

Verifica: node --check OK; suite 152/152 (nuova share_test 7: token/URL/payload).
Playwright: RSVP page (form, tabs nascoste, conferma "Grazie …"); PWA e app
normale invariate; zero errori JS.

Nota: redenzione invito e submit RSVP verso il backend restano da collegare
(spike Supabase); qui payload e flusso client sono pronti e testati.

## Giro 16 (Claude Code) — P2/P3: legale (GDPR) + hook osservabilità

- Documenti legali (bozze/template da validare con legale): legal/PRIVACY.md,
  TERMS.md, COOKIE.md — tarati su SaaS nozze UE (dati ospiti/particolari,
  sub-responsabili, diritti, dati in UE).
- UI "Privacy e dati" nel menù: sintesi trattamento + export dati (JSON) +
  rimando ai documenti. Cancellazione evento già disponibile (Reset).
- Osservabilità: Diag.setReporter(fn) — seam per invio errori a un servizio
  remoto (Sentry) in P3; dormiente finché non impostato.

Verifica: node --check OK; suite 153/153 (storage_test +1: setReporter).

## Giro 17 (Claude Code) — i18n (fondamenta) + Billing (scaffold) + stato piano

- i18n: I18N(it/en) + t() + appLang() + toggleLang(); etichette schede tradotte
  come slice dimostrativo, toggle "Lingua (IT/EN)" nel menù. Estrazione completa
  delle stringhe = passata dedicata (documentata).
- Billing: modulo dormiente (free/premium) + voce "Abbonamento" (anteprima;
  Stripe da collegare).
- PIANO_PRODOTTO.md sez.11-12: stato di avanzamento (FATTO/SCAFFOLD/UTENTE) e
  cosa serve dall'utente per andare live.

Verifica: node --check OK; suite 158/158 (nuova i18n_test 5). Playwright: toggle
lingua schede IT<->EN, nessuna regressione, zero errori JS.

STATO PIANO: completato per quanto fattibile in questo ambiente. Resta ciò che
richiede provisioning/decisioni esterne (Supabase, Stripe, Sentry, store, legale,
conferma device) + le passate dedicate i18n completa e WCAG.

## Giro 18 (Claude Code) — passata di accessibilità (WCAG)

Misurata con axe-core 4.12.1 (Playwright).

- Baseline: violazioni landmark-one-main + region (moderate).
- Fix: rimosso role="region" (e aria-live) dal <main> → landmark main ripristinato
  (landmark-one-main risolto) e niente più ri-annuncio dell'intera vista a ogni
  render. Resta 1 sola "region" (best-practice) sul tablist #tabs: accettata come
  tradeoff (semantica tab completa role=tablist/tab/aria-selected vs wrapping
  landmark; fixarla rischiava il layout schede).
- Modale accessibile (grande guadagno tastiera/screen reader): focus spostato nel
  dialog all'apertura (primo campo o bottone), trap del Tab, Escape per chiudere,
  ripristino del focus all'elemento precedente alla chiusura; pulizia del listener
  su modali annidati.
- document.documentElement.lang aggiornato al cambio lingua.
- ariaEnhance(): etichette accessibili automatiche sui pulsanti-icona ("×"→Rimuovi)
  in vista e modali.
- Confermato già presente: focus-visible, toast role=status + live region #aria.

Verifica: node --check OK; suite 158/158. axe: da 2 a 1 violazione (best-practice).
Playwright: focus entra nel modale + Escape chiude; guida e flussi modali invariati.

Passata i18n completa (estrazione di tutte le stringhe) resta l'unica voce di
qualità non ancora fatta e fattibile qui (grande, dedicata). Tutto il resto del
piano è FATTO/SCAFFOLD/UTENTE (vedi PIANO_PRODOTTO sez.11).

## Giro 19 (Claude Code) — caccia sistematica ai bug

Su richiesta: sweep E2E su tutti gli editor + audit integrità + review flussi.

Risultati:
- BUG TROVATO E CORRETTO (integrità, severità media): delGuest cancellava
  l'ospite ma NON lo rimuoveva dai posti (seatIds) né dalle vicinanze
  (seating.rules) -> posto "fantasma" occupato da un id morto, non rimovibile
  dall'utente, conteggi errati, regole orfane. Riprodotto in Playwright (dopo
  delete: 1/6 fantasma, 1 regola orfana). Fix: helper puro seatPurgeGuest(tables,
  rules, gid) usato da delGuest; +2 test in b1_test. Riverifica E2E: 0/6, 0
  regole orfane.
- Sweep E2E su ~15 editor/flussi (budget/guests/vendors/timeline/lists/aperitivo
  + sotto-modali ingranaggio): ZERO errori JS non gestiti, nessun crash.
- Flussi "diretti" verificati funzionanti: wizard import (E2, +2 ospiti),
  genChecklist (+13 task), simAdd stazione (+1), addItem (input inline).
- Altri scenari di integrità controllati e OK: delTable (posti spariscono col
  tavolo, nessun orfano), delVendor (nessun riferimento inverso), editTable con
  riduzione posti (ospiti in eccesso tornano in riserva), ospite reso 'no' mentre
  seduto (resta liberabile).

Suite 160/160. Stima aggiornata: lo strato UI raggiungibile è ora in gran parte
verificato; gli ignoti residui sono soprattutto iPhone reale e backend reale.

## Giro 20 (Claude Code) — pacchetto lanciabile (desktop + iPhone)

- dist/Hub_Nozze.html: UN file autosufficiente (240 KB, apple-touch-icon inline,
  nessun riferimento esterno). Verificato da file:// : boot, 8 schede, crea tavolo,
  persiste dopo reload, zero errori. Doppio clic su desktop = funziona.
- tools/build_singlefile.js: rigenera il file singolo da index.html.
- LEGGIMI.md: istruzioni desktop (doppio clic / "Installa app") e iPhone (limite
  iOS: serve URL -> GitHub Pages o server locale -> Safari -> Aggiungi a Home) +
  nota persistenza/backup.
- .github/workflows/pages.yml: deploy della cartella hub-nozze su GitHub Pages
  (l'utente attiva Settings->Pages->GitHub Actions) -> URL per iPhone.

## Giro 21 (Claude Code) — categorizzazione ospiti a tendina + variabile Gruppo

Segnalazione utente: poche variabili per l'ottimizzatore; "Nucleo" a testo libero
è un errore (rompe l'affinità che confronta la stringa esatta).

- FIX bug: "Nucleo" da input libero a SELECT gestita (valori esistenti + "+ Nuovo…"
  che mostra un campo). Valori coerenti = raggruppamenti corretti. Helper
  managedSelect/managedValue + delega change su select[data-managed].
- Nuova variabile "Gruppo" (a tendina, estensibile, default: Famiglia sposo/sposa,
  Parenti, Amici, Colleghi, ...): per-ospite g.group. L'ottimizzatore
  (seatAffinityFn) ora tiene vicini chi è dello stesso gruppo (oltre a nucleo e
  bambini). Affinità = soft (adiacenza nel tavolo), non forza mega-gruppi.
- Onestà: App_tavoli_ (la "prima versione") non è mai stato trasferito nel
  workspace, quindi non riproduco il set esatto di variabili di allora. Il pattern
  managedSelect è pronto per aggiungerne altre in fretta; se l'utente carica
  App_tavoli_ allineo al set originale.

Variabili ottimizzatore ora: lato, nucleo, gruppo, bambini (affinità) + vicinanze
insieme/lontano (regole esplicite). Verifica: node --check; suite 162/162
(b2 +2 su affinità gruppo). Playwright: nucleo/gruppo = SELECT, "+ Nuovo" funziona,
salvataggio corretto. dist/Hub_Nozze.html rigenerato.

## Giro 22 (Claude Code) — clic minimi/guidati + gap analysis app tavoli

Richieste utente: (1) modifica liste a doppio clic senza tasto Modifica; (2) in
generale clic minimi e guidati, verifica su tutta l'app; (3) gap analysis vs
l'app tavoli originale (Tableau_Matrimonio.html, caricata).

- Liste: doppio clic su voce o titolo -> editing in-linea (contenteditable),
  Invio salva, Esc annulla, blur salva; svuotare una voce la rimuove. Invio nel
  campo "aggiungi voce" aggiunge senza cliccare "+". Permessi rispettati
  (sola lettura -> toast). Niente più tasto "Modifica" nelle liste.
- Ospiti: pill RSVP cliccabile che cicla conf -> attesa -> no in un clic (prima
  4 clic via modale). Passaggio a "no" libera il posto (seatPurgeGuest).
- Modali: Invio da un INPUT conferma l'azione primaria; bottone di conferma
  (convenzione cls:"") ora ha classe/stile "primary" oro, distinto dai secondari.
  Corretto un difetto latente: cls:"" era falsy e rendeva il primario come ghost.
- Doc: GAP_ANALYSIS.md — l'algoritmo nativo eguaglia l'originale; il gap vero è
  il sistema di variabili configurabili (pesi, modo unisci/separa, tendine,
  variabili custom, attributi per ospite) + wizard, filtri RSVP, gruppi colorati,
  temi nomi tavoli, planimetria drag/zoom, export CSV. Priorità P1 = variabili
  (richiede conferma di scopo: è un sotto-progetto, non un ritocco).

Verifica: node --check ok; suite 162/162 verde; Playwright (430x932): doppio clic
voce+titolo con save/persistenza dopo reload, RSVP 1-clic, Invio-conferma modale,
smoke su tutte le 8 schede senza errori JS. dist/Hub_Nozze.html rigenerato.

## Giro 23 (Claude Code) — chiusura gap analysis app tavoli (G1–G9)

Richiesta utente: "esegui tutti i punti della todo e chiudi la gap analysis".
Implementati e verificati tutti i gap funzionali del documento GAP_ANALYSIS.md.

- G1 variabili configurabili: SEAT_VARS_DEF (8 variabili, 4 attive) con peso
  0–20, modo unisci/separa, tendine di valori, variabili custom. Editor nel
  wizard (passo 1).
- G2 attributi per ospite: g.attr{var:val}; seatSimilarity(a,b) pesata con segno;
  compilazione bulk (tutti/per gruppo/singolo) con % nel wizard (passo 2);
  tendine anche in "Modifica ospite"; "Precompila dai dati" (nucleo/lato/età).
  Integrata in seatPlanAssignment (nuovo param opzionale simFn, retrocompatibile)
  e in seatAffinityFn.
- G3 wizard 4 passi (Variabili→Compila→Regole→Genera), pulsante "Genera (guidato)".
- G4 gruppi con colore (GUEST_GROUP_COLORS): pallino nella lista ospiti e wizard.
- G5 temi nomi tavoli (7 temi); "Nomi tema" rinomina tutti; nuovi tavoli
  auto-nominati dal tema.
- G6 planimetria: drag del tavolo (coordinate SVG via getScreenCTM) + zoom
  50–300%. seatLayout ora rispetta x,y manuali. Rotazione/resize/sfondo non
  portati (rifiniture a rischio/beneficio marginale).
- G7 filtri (chip RSVP) + ricerca ospiti lato client (niente perdita focus).
- G8 export CSV ospiti (con colonne variabili) + tableau stampabile (window.print).
- G9 undo generazione: snapshot pre-generazione + "Annulla" nel wizard.
- G10 dati seed finti: SALTATO per scelta (l'utente importa i suoi dati).

Nuova suite tests/vars_test.js (11 casi) su seatSimilarity + assegnazione con
simFn. Verifica: node --check ok; suite 173/173 verde (162 + 11); Playwright
(430x932): dot gruppo, filtro/ricerca, attr in editGuest, export CSV, creazione
tavoli, tema (Rosa/Tulipano), zoom 100→125%, drag tavolo, wizard 8 variabili,
precompila 75%, genera 9/9, undo — zero errori JS. dist/Hub_Nozze.html rigenerato.

## Giro 24 (Claude Code) — deploy GitHub Pages automatico

Deploy su GitHub Pages reso automatico: pages.yml con trigger on:push del branch
(paths hub-nozze/**). Il workflow usa il proprio GITHUB_TOKEN (pages:write,
id-token:write). Rimosso "with: enablement" perché la creazione del sito Pages
via API è vietata al token ("Resource not accessible by integration").
PREREQUISITO una tantum: Settings -> Pages -> Source "GitHub Actions" (azione
admin, non automatizzabile dal token). Dopo l'abilitazione, ogni push pubblica
da solo su https://lucarighinet.github.io/Default/.

## Giro 25 (Claude Code) — audit finale pre-rilascio + fix listener modale

Audit completo richiesto dall'utente prima dell'uso reale (grafica, bug,
armonia, funzioni, testi, guida).

- BUG trovato e corretto: il keydown del modale (capture su document) restava
  attivo se il modale veniva rimosso dal DOM senza close(); con l'Invio-conferma
  (Giro 22) un Invio in un campo pagina poteva "cliccare" un bottone primario
  staccato, cambiare scheda e svuotare l'input prima di addItem. Fix: handler
  auto-sanante (dialog non più nel DOM -> si de-registra e lascia passare).
- Testi allineati alle funzioni nuove: guida onboarding (Ospiti: RSVP 1-clic,
  filtri/ricerca, CSV; Tavoli: Genera guidato, drag/zoom, temi, stampa; Liste:
  Invio e doppio clic), card "come funziona" Tavoli, hint bar Tavoli.

Verifica finale: node --check ok; suite 173/173; E2E Playwright tutti verdi
(persistenza liste, dblclick, RSVP 1-clic, Invio-conferma, gap G1-G9, guida
10/10 passi con onboarded persistente e Invio funzionante subito dopo);
audit visivo 390x844: zero overflow su 8 schede e nei modali, zero errori JS.
dist/Hub_Nozze.html rigenerato. Deploy Pages automatico attivo (repo pubblico).

## Giro 26 (Claude Code) — lista invitati reale caricata + fix separatore import

L'utente ha dettato la lista reale (113 nomi, testo sporco da dettatura).
Caricata simulando il flusso utente (Ospiti -> Importa -> incolla -> Analizza
-> Aggiungi): 3 azioni, 113 ospiti importati.

- BUG scovato dal collaudo: impDelim eleggeva la virgola a separatore anche se
  presente in 6 righe su 113 ("Alessandro E, Zani" troncato ad "Alessandro E").
  Fix: un separatore vale solo se compare nella maggioranza delle righe;
  altrimenti 1 colonna (sentinella U+0000). import_test 28->30.
- Lista pulita e cotta nel seed (123 ospiti totali): nomi normalizzati
  (maiuscole, refusi da dettatura), annotazioni scherzose RIMOSSE dai nomi
  (finirebbero sul tableau stampato), disambiguazioni funzionali tenute tra
  parentesi. Nuclei dedotti dal testo (Telloli, Bartolomei, Para, Ferrara,
  Di Ianni, Rossi (Fede), Zani (Marco)/(Alessandro), ecc.): 31 nuclei.
  Bambini SOLO dove il testo dice figlio/figlia (10). Ostetriche = gruppo.
  Persone annunciate senza nome = "(nome da definire)". Lato: default A,
  DA RIVEDERE dall'utente. RSVP: tutti in attesa.
- Seed helper g() esteso con group.

Verifica: suite verde (import 30/30); Playwright: 123 ospiti, 31 nuclei,
ricerca ok, re-import della lista grezza ora resta a 1 colonna, zero errori JS,
render <1.5s. dist rigenerato. NOTA deploy: il sito pubblicato ha ancora il
seed precedente; serve un nuovo merge per portare la lista online.

## Giro 27 (Claude Code) — bonifica dati test + pubblicazione lista online

Richiesta utente: niente più file/link, tutto sul sito online; bonificare i
dati di test e inserire la lista invitati reale.

- Rimossi i 10 ospiti demo del seed (Marco/Anna/Davide Righi, Giulia Conti,
  Paolo/Elena/Sofia Biondi, Martina Ferri, Luca Bianchi, Chiara Neri).
  Restano i 113 invitati reali. AVVISO: i genitori non sono nella lista
  dettata; se invitati, vanno aggiunti dall'utente.
- Conservati (non sono test): budget 50 voci, pagamenti Fenice, fornitori
  (Fenice, Castello Benelli), task, run-of-show, liste note, sim aperitivo.
- sw.js: CACHE v1 -> v2 (cache-first: senza bump i dispositivi già visitati
  non vedrebbero mai l'aggiornamento).
- Pubblicazione: PR verso il default branch + merge -> deploy Pages automatico.

Verifica: suite verde; Playwright: 113 ospiti, zero residui demo, smoke su
tutte le schede senza errori. NOTA dispositivi: chi ha già aperto il sito con
i dati vecchi in localStorage deve fare ingranaggio -> Reset (il seed nuovo
non sovrascrive uno stato salvato).

## Giro 28 (Claude Code) — sync multi-dispositivo via Supabase (opzione B)

Attivato il modulo sync dormiente contro il progetto Supabase dell'utente.

- Auth convertita da magic-link OTP a email+password (signInWithPassword):
  risolve subito a una sessione, niente redirect da rifinire. makeSupabaseAuth
  ora ha signIn(email,password) e sessionUser() per il resume.
- Cloud.resume(): al riavvio, se supabase-js ha una sessione persistita,
  riabilita Sync e tira giu lo stato dal cloud senza richiedere le credenziali.
- Bootstrap: dopo Cloud.configure chiama Cloud.resume.
- Schermata "Accedi" con campo password; copy aggiornata.
- Config window.HUB_CLOUD (url progetto + anon key pubblica) + tag CDN
  supabase-js@2 prima dello <script> principale. Nessun CSP nel file.
- run_all.js: estrazione dello <script> principale ora usa lastIndexOf
  (prima c'e la config e il tag esterno). tests/cloud_test +2 (resume): 9->11.

Sicurezza: la anon key e pubblica per progetto; la protezione e data dal login
+ RLS lato Supabase (tabella event_state, policy solo per ruolo authenticated,
signup pubblici disattivati). L'utente esegue SQL + crea l'account + disattiva
i signup (istruzioni fornite in chat).

Rischio dichiarato: da questo ambiente Supabase non e raggiungibile (proxy),
quindi il flusso live non e collaudabile da me; verificato pero che senza
supabase-js l'app degrada senza crash (Playwright: 113 ospiti, zero errori JS)
e il contratto remote/sync/resume e coperto da unit test (mock). suite 177 verde.

## Giro 29 (Claude Code) — intestazione evento modificabile + data 17/07/2027

Richiesta utente: il titolo mostrava "Castello Benelli" (location non definitiva)
e la data e cambiata al 17/07/2027.

- editEventHeader(): modale per nomi (= lati A/B), location, indirizzo, data
  (input date). Salva su meta() + commit (header si ri-disegna).
- Header cliccabile (data-act=editHeader su .brand) + voce "Intestazione e data"
  nel menu ingranaggio.
- Header gestisce location vuota: mostra solo la data (niente "· " orfano).
- Seed: data 2027-07-03 -> 2027-07-17.

Verifica: suite 177 verde; Playwright: header seed "17 lug 2027", modifica nomi
+ location vuota + data, persistenza dopo reload. (In sandbox compare un errore
console dovuto al CDN supabase-js bloccato dal proxy: artefatto d'ambiente, non
presente nel browser reale; l'app funziona comunque.) dist rigenerato.

## Giro 30 (Claude Code) — condivisione: collaboratori + link RSVP (UX + funzionanti)

Richiesta utente: spiegare/migliorare invito collaboratori e link ospiti
(UX, grafica, guida, usufruibilita).

Prima erano semi-rotti: l'invito con ruolo generava un link che non dava
accesso (con Supabase a un solo account, iscrizioni chiuse, l'invitato non puo
loggarsi); la pagina RSVP ospite era una demo (la risposta non tornava a
nessuno). Resi onesti e realmente utili:

- Invito collaboratori (openInvite): ora spiega il modello che funziona davvero
  = stesso login (email+password) su un altro dispositivo. Istruzioni pronte
  ("Condividi/Copia istruzioni") + nota di sicurezza (password su canale a parte).
- Link RSVP: pulsante "Link RSVP" nella scheda Ospiti (prima solo dentro
  Account). showShareLink rifatto con "Condividi…" (foglio nativo iPhone:
  WhatsApp/Messaggi) + "Copia link". Helper copyText/shareOrCopy.
- Pagina pubblica RSVP (renderPublicRSVP): grafica curata, nasconde gear/tabs/
  countdown, e all'invio la risposta TORNA agli sposi via condivisione nativa
  (o copia) con un tocco + schermata di ringraziamento con ri-invio.
- Guida: nuovo passo "Condividere" (collaboratori vs invitati).
- sw.js CACHE v4->v5.

Verifica: suite 177 verde; Playwright: link RSVP con ?rsvp=token, pagina ospite
"Ci sarai?" con form, invio -> "Grazie" + "Invia agli sposi", validazione nome,
zero errori JS. dist rigenerato.

Nota: il ritorno automatico degli RSVP nel database (inbox lato sposi via anon
insert Supabase) resta un possibile passo successivo; per ora la risposta torna
via messaggio, senza backend e senza rischio.

## Giro 31 (Claude Code) — login all'avvio (bypass locale) + fix filtro illeggibile

Richieste utente: (1) all'avvio, se non loggato, chiedere l'accesso, con
possibilita di lavorare in locale; (2) bug: cliccando i filtri ospiti il testo
diventa illeggibile.

- Login all'avvio: promptLoginStart() nel bootstrap, dopo Cloud.resume, solo se
  cloud configurato e nessuna sessione. Modale con email+password e tasto
  "Lavora in locale" (bypass). Estratto cloudDoLogin() condiviso con openAccount.
  Se il cloud non c'e (supabase-js non caricato) nessun prompt, resta locale.
- BUG filtro: il chip attivo usava classe "primary" -> con .btn.ghost:hover
  (background var(--card2), su touch resta appiccicato dopo il tap) lo sfondo
  si schiariva mentre il testo restava chiaro = illeggibile (avorio su card2).
  Fix: classe dedicata .btn.ghost.fon + variante :hover (0,4,0) che vince anche
  sull'hover, sfondo teal pieno con testo avorio. Verificato contrasto 522.

Verifica: suite 177 verde; Playwright: filtro attivo leggibile anche con hover
(avorio su teal), filtro funzionante; app carica senza errori. sw.js v7->v8;
dist rigenerato.

## Giro 32 (Claude Code) — pagamenti gestiti, timeline guidata, login all'avvio

Richieste utente in blocco.

- Login all'avvio come PRIMA cosa: bootstrap mostra promptLoginStart prima della
  guida quando cloud configurato e non loggato; cloudDoLogin ritorna promise e
  la guida parte dopo login/bypass (onDone). Tasto "Lavora in locale".
- Timeline: editRs con input type=time (selettore nativo) e menu gestiti per
  momento (RUNSHOW_SUGGEST) e responsabile; nuovo "Scaletta standard" (genRunShow)
  che aggiunge i momenti tipici mancanti con orario suggerito (dedup per titolo).
- Pagamenti (prima grezzi/fissi/scollegati): CRUD rate (editPayment/delPayment,
  + Rata), collegamento fornitore (vendorId) mostrato in riga, stato pagata/da
  pagare/scaduta (scaduta = non pagata e scadenza passata), riepilogo (Pagato,
  Da pagare con scaduto, barra avanzamento %, prossima scadenza) e connessione
  al budget (rate pianificate vs preventivi impegnati d.committed).

Verifica: suite 177 verde; Playwright: rata add/paid/del, barra+prossima+riga
fornitore, scaletta standard (6 momenti, dedup), editRs type=time + select,
zero overflow, zero errori JS. sw.js v8->v9; dist rigenerato.

## Giro 33 (Claude Code) — report catering completo, variabile Stato, fix dato stantio

- Report catering (Ospiti): card riepilogo con Coperti totali, Bambini/menù
  bambino, Posti navetta, Con intolleranze; nota "+1 = menù adulto"; sezione
  Accessibilità. Etichetta "solo confermati" (era gia la semantica, ora e detta).
- BUG di coerenza trovato: la dashboard calcolava "Assegnati a tavolo" da
  x.table e la capienza da t.capacity, campi del vecchio modello iframe: sempre
  0 dal passaggio alla planimetria nativa. Ora conta i posti occupati in
  tables[].seatIds (con guardia sugli id orfani) e capienza da t.seats.
- Nuova variabile ottimizzatore "Stato (single/coppia)" (Single/In coppia/
  Famiglia), on di default, peso 5: entra automaticamente in attributi ospite,
  wizard Compila, similarita -> assegnazione tavoli e vicinati. Migrazione a
  versioni (SEAT_VARS_VER=2): la nuova default si aggiunge alle liste salvate
  UNA volta sola, senza resuscitare variabili eliminate dall'utente.
  Precompila: Stato dedotto da nucleo (bambini o 3+ = Famiglia, 2 = In coppia)
  e, senza nucleo, da +1 (In coppia) o da solo (Single). Correggibile a mano.
- vars_test 11->13 (migrazione v2, no-resurrezione).

Verifica: suite verde; Playwright: report con i 4 numeri, dashboard con
assegnati reali, Stato nel wizard e in editGuest, precompila 113/113, zero
errori JS. sw.js v10->v11; dist rigenerato.

## Giro 34 (Claude Code) — centro avvisi, navetta separata, label dashboard

Feedback utente: navetta e intolleranze insieme non hanno senso; dashboard con
valori poco chiari; procedere col piano avvisi; verificare sempre il deploy.

- Report ospiti: Navetta ora e una sezione propria con l'ELENCO di chi la usa
  (+1 inclusi nei posti) — serve per organizzare il trasporto; il report
  catering resta cucina-only (coperti, bambini, intolleranze, accessibilita).
- Dashboard: "Tetto" -> "Budget massimo (stima + X% imprevisti)"; "Impegnato"
  -> "(spese o preventivi accettati)"; card Navetta rimossa dalla sezione RSVP
  (vive nel report); "Assegnati a tavolo X/coperti" -> "Posti assegnati /
  capienza tavoli" (denominatori omogenei).
- CENTRO AVVISI (Fase 1 piano): motore centrale alertsCompute() -> avvisi
  tipizzati {id, sev alta/media/info, area, testo, tab} ordinati per gravita.
  13 regole: budget oltre massimo, scostamento effettivo>preventivo per voce,
  tariffe a persona mancanti, rate scadute/imminenti (soglia configurabile),
  task scadute/imminenti/stagnanti 30gg, coperti sotto minimo, attese a <=60gg
  dalle nozze, coperti oltre capienza, confermati senza posto, categorie chiave
  senza confermato a <=180gg, opzioni fornitore in scadenza/scadute.
  UI: campanella in header con badge (rosso se critici), pannello con salto
  alla scheda (goAlert), Ignora per avviso + Riattiva tutti (persistiti in
  alertsCfg.muted), soglie giorni configurabili. La card Avvisi in Dashboard
  riusa lo stesso motore.
- Fase 2 dati: fornitori con "Opzione valida fino al" (optionUntil) che alimenta
  gli avvisi opzione; task nuove con createdAt per la regola "stagnanti".
- BUG trovato dal collaudo: il bottone degli avvisi usava data-tab, intercettato
  dalla delega delle schede prima del handler (navigava senza chiudere il
  modale). Rinominato data-target.
- Nuova suite tests/alerts_test.js (13 casi, motore isolato con DERIVED stub).

Verifica: suite verde (190 casi); Playwright: badge campanella, centro avvisi
con critico, goAlert naviga e chiude, Ignora/Riattiva, soglie salvate e
persistenti dopo reload, dashboard e report coerenti, zero overflow, zero
errori JS. sw.js v11->v12; dist rigenerato. Deploy verificato verde (run).

Decisione utente (2026-07-04): Fase 3 avvisi (digest email via Supabase) NON si
fa. Il sistema avvisi resta solo in-app (campanella + centro avvisi). Non
riproporre senza richiesta esplicita.

## Giro 35 (Claude Code) — budget: via la colonna Stima, tabella che entra nello schermo

Richiesta utente: per arrivare a Modifica bisognava scorrere a destra/sinistra;
togliere Stima e tenere Preventivo+Effettivo, migrando i valori di Stima nel
Preventivo per non perdere nulla.

- migrateBudgetV2() nel bootstrap: per ogni evento senza flag budgetV2, dove il
  preventivo e' vuoto ci entra la stima (per le voci a persona: tariffa x ospiti
  previsti). Una tantum + idempotente (condizione quote==0). Vale per stati
  salvati e cloud, non solo seed.
- Tabella voci: colonne Voce | Preventivo | Effettivo | matita (via Stima e
  Stato; "pagata" come pill accanto al nome). Bottone Modifica -> icona matita:
  la tabella ENTRA INTERA anche a 375px (iPhone mini), zero scroll orizzontale
  (misurato: tableW==clientW a 375 e 390).
- Editor voce semplificato: Voce, Preventivo, Effettivo, Stato pagata (via tipo
  costo/stima/tariffa). Nuova voce: Voce, Tier, Preventivo.
- Calcoli coerenti col nuovo modello: contingenza e Budget massimo ora si
  basano sui PREVENTIVI (prima sulla stima, che non esiste piu' in UI); card
  budget: Preventivi totali, Effettivo, Scostamento (eff-prev), Budget massimo.
  Etichetta dashboard aggiornata. Pianificazione: "ospiti previsti" resta (serve
  a catering/aperitivo), tolto il riferimento al ricalcolo voci a persona.
- Avvisi: rimossa la regola "voci a persona senza tariffa" (concetto uscito
  dalla UI).

Verifica: suite verde; Playwright: migrazione visibile (location 7000 nel
preventivo, totali corretti), editor 4 campi, salvataggio, tabella dentro lo
schermo a 375/390px, zero overflow, zero errori JS, screenshot controllato.
sw.js v12->v13; dist rigenerato. Deploy verificato verde.

## Giro 36 (Claude Code) — FIX: migrazione budget scartata dal pull del cloud

Segnalazione utente: i valori della vecchia colonna Stima non comparivano nel
Preventivo (sembravano persi). I dati NON erano persi: restano nel campo
estimated dello stato. Il difetto era di sequenza: migrateBudgetV2 girava al
boot sullo stato LOCALE, poi Cloud.resume() scaricava lo stato dal cloud e
sostituiva STATE, buttando via la migrazione. Con login attivo la migrazione
veniva sempre scartata (e il flag budgetV2 finiva solo sullo stato locale
abbandonato).

Fix: migrateBudgetV2() viene richiamata anche DOPO ogni sostituzione di STATE
col cloud (Cloud.resume nel bootstrap e cloudDoLogin): lo stato che vince viene
migrato, e Store.save dentro la migrazione rispinge nel cloud il risultato
(vale quindi per tutti i dispositivi). La condizione quote==0 preserva i
preventivi inseriti a mano dall'utente.

Verifica E2E (scenario riprodotto con addInitScript che ricrea lo stato non
migrato dopo il flush): stima 1234 -> preventivo, preventivo utente 999
intatto, voce a persona 10x180=1800, flag impostato. Suite verde.
sw.js v13->v14; dist rigenerato. Deploy verificato verde.

Lezione: ogni migrazione di stato deve girare sul "vincitore" del merge
locale/cloud, non solo al boot locale.

## Giro 37 (Claude Code) — Evidenzia riga da avviso + swipe-elimina voci di spesa

Due richieste utente:
1. Cliccando un avviso, con molte righe non si capiva quale fosse quella
   interessata. Ora ogni avviso porta con sé gli id delle righe coinvolte
   (campo ref in alertsCompute: rate scadute/imminenti, attività, scostamenti
   per voce, opzioni fornitore, inviti in attesa, ospiti senza posto) e goAlert,
   dopo il cambio scheda, evidenzia le righe con una sfumatura oro (classe
   .rowflash, ~2,4s, si rimuove da sola) e porta in vista la prima
   (scrollIntoView). Vale per righe di tabella, card fornitore e tag ospite.
   Se l'avviso punta a Ospiti, il filtro attivo viene azzerato (una riga
   filtrata non si potrebbe evidenziare). Avvisi senza riga specifica (es.
   budget oltre il massimo) navigano e basta.
2. Slider per cancellare le voci di spesa: scorri a sinistra su una riga e la
   matita lascia il posto a una X rossa (riga tinta di rosa); scorri a destra o
   apri un'altra riga per richiudere. La X apre la conferma "Eliminare la
   voce?" (coerente con rate/fornitori); l'eliminazione sgancia anche il
   collegamento budgetLineId dei fornitori. Per chi usa il mouse, "Elimina" è
   anche nella modale di modifica (via setTimeout per non farsi svuotare
   #modalRoot dal close della prima modale).

Dettagli tecnici: listener touch sulla tabella (ricreata a ogni render, niente
accumulo su #view); pulsante X invece di "Elimina" testuale perché a 375px il
testo faceva sbordare la tabella di 6px (e attenzione alla specificità: .btn.sm
batteva .swdel, servito .btn.sm.swdel).

Verifica: suite verde (alerts 16 casi, +3 sui ref); Playwright a 390 e 375px:
flash su pagamenti/attività/ospiti/fornitori-card, da campanella e da
dashboard, ref vuoto innocuo, classe rimossa a fine animazione, filtro ospiti
azzerato; swipe apre/chiude, una riga sola aperta, tabella sempre dentro lo
schermo, eliminazione persistita dopo reload, zero errori JS, screenshot
controllati. sw.js v14->v15; APP_BUILD 2026-07-04.2; dist rigenerato.

## Giro 38 (Claude Code) — Audit di coerenza grafica: fix e armonizzazioni

Su richiesta utente, audit completo delle 8 schede (screenshot, misure DOM,
ricognizione etichette). Interventi, difetti prima:

1. BUG Ospiti: la griglia "Report catering" a 3 colonne sbordava a 390px
   (contenuto 406px su 362): tutta la pagina scorreva in orizzontale. Portata
   al layout KPI standard a 2 colonne (come il resto dell'app) e accorciata
   l'etichetta "Coperti totali (confermati + accompagnatori)" -> "Coperti
   totali" (la spiegazione resta nel KPI in alto e nella nota sotto Pasti).
   Primo tentativo con repeat(3,minmax(0,1fr)): niente overflow di pagina ma
   "CON INTOLLERANZE" restava troncato dentro la card (scrollWidth>client);
   scartato in favore delle 2 colonne.
2. Conferme di eliminazione uniformate: delTask ("Eliminare l'attivita'?") e
   delRs ("Eliminare il momento?") ora chiedono conferma come rate, fornitori,
   liste, ospiti e voci budget. Prima la X cancellava all'istante.
3. Etichette italiane e coerenti in Timeline: "Run-of-show" -> "Scaletta",
   "+ Task" -> "+ Attivita'", modale "Nuovo task" -> "Nuova attivita'",
   hint "i task da fornitore" -> "le attivita' da fornitore",
   toast "Task rimosso" -> "Attivita' rimossa".
4. Fornitori: la card "WEB" che citava il file autonomo e Claude.ai e' ora una
   nota discreta e onesta ("su questo sito mostra un avviso e non modifica
   nulla"); "Aggiorna dal web" degradato a ghost, "Modifica" promosso a primo
   bottone pieno della card; aggiornati anche la modale di caricamento e il
   testo S4 della guida.
5. Aperitivo: "ingresso unico del Castello" -> "ingresso della location"
   (la sede non e' definitiva e il nome e' modificabile dall'utente).

Rimandati (cosmetici, decisione utente): matita di modifica estesa a
Ospiti/Timeline; campanella emoji vs ingranaggio glifo; titoli liste seed in
inglese (dati modificabili).

Verifica: suite verde; Playwright 390/375px: Ospiti senza overflow ne'
troncature, conferme Annulla/Elimina su attivita' e momenti, etichette nuove,
bottoni fornitori in ordine, testo aperitivo; regressioni: avvisi con flash
(tutte le aree, da campanella e dashboard), swipe voci budget, tabella budget.
Zero errori JS. sw.js v15->v16; APP_BUILD 2026-07-04.3; dist rigenerato.

## Giro 39 (Claude Code) — Cosmetici dell'audit: matita ovunque, header, liste seed

I tre punti rimandati dal Giro 38, autorizzati dall'utente:

1. Matita di modifica estesa: Ospiti (editGuest), Checklist (editTask) e
   Scaletta (editRs) usano il glifo &#9998; con aria-label/title, come il
   budget. In Ospiti le due celle azione (matita, X) sono state unite in una
   sola; in Checklist il testo "Confermato: <fornitore>" ora va a capo
   (white-space:normal, max-width:120px) invece di allargare la cella .num.
   Risultato misurato: le tabelle Ospiti e Timeline entrano nello schermo
   SENZA scroll orizzontale a 390 e 375px (prima 352/345 e 474/360).
2. Header uniforme: l'ingranaccio ha ora presentazione emoji (&#9881;&#xFE0F;)
   come la campanella; niente piu' mix glifo monocromo / emoji colorata.
3. Liste seed in italiano: "Musica — must play/do not play" -> "da suonare /
   da evitare" nel seed, piu' migrateSeedLabels() per i dati gia' salvati:
   rinomina SOLO i titoli esattamente uguali al seed (se l'utente li ha
   modificati non tocca nulla), idempotente, richiamata al boot E dopo ogni
   pull dal cloud (stessa regola imparata col budget al Giro 36).

Verifica: suite verde; Playwright 390/375px: migrazione titoli (esatti
rinominati, personalizzato intatto), matite aprono gli editor giusti, fit
tabelle senza scroll, header con VS16, zero overflow su tutte le schede;
regressioni giro38 + avvisi/flash + swipe budget + tabella budget tutte OK.
Zero errori JS. sw.js v16->v17; APP_BUILD 2026-07-04.4; dist rigenerato.

## Giro 40 (Claude Code) — Privacy: cifre economiche sfocate in Dashboard

Richiesta utente: all'apertura le macro cifre di budget/spesa in Dashboard
devono essere appannate; solo toccandole diventano visibili.

Implementazione: helper blurMoney(key,html) avvolge la cifra in uno <span
class="blurval"> con data-act="togglePrivacy". CSS filter:blur(8px) di default,
.revealed toglie il blur (transizione .25s). Applicato a: Budget massimo,
Impegnato, Da pagare e agli importi dei "Prossimi pagamenti". Lo stato dei
valori rivelati vive in un Set runtime (PRIVACY_REVEALED), NON persistito: a
ogni riavvio dell'app si riparte tutti sfocati. Il toggle agisce solo sulla
classe dell'elemento (classList.toggle) senza rifare il render -> non perde lo
scroll. togglePrivacy aggiunto a READONLY_ACTS (anche in sola lettura si puo'
sbirciare). I conteggi non economici (RSVP, fornitori, attivita') restano in
chiaro.

Verifica: suite verde; Playwright 390px: tutte sfocate all'avvio, il tocco
rivela SOLO la cifra toccata, secondo tocco ri-sfoca, lo stato regge il cambio
scheda ma si azzera al reload, KPI non sensibili in chiaro, goAlert da
dashboard ancora funzionante (delega click intatta), zero overflow, zero
errori JS, screenshot controllato. sw.js v17->v18; APP_BUILD 2026-07-04.5.

## Giro 41 (Claude Code) — Task 1+2: sincronizzazione bidirezionale affidabile

Segnalazione utente: usando l'app da due dispositivi, le modifiche si allineano
"sempre su una versione" e le modifiche del secondo dispositivo non si
propagano, anche ad app chiusa. Chiesto anche: strategia conflitti chiara e
niente banner permanente "Conflitto risolto".

DIAGNOSI (due difetti):
1. La app faceva pull SOLO al boot (Cloud.resume al caricamento). Su iPhone
   "chiudere" la PWA spesso la mette in background: alla riapertura NON c'e'
   reload, quindi il dispositivo non riscaricava le modifiche dell'altro e
   continuava a ripubblicare la propria versione.
2. In conflitto vinceva SEMPRE il locale ("l'ultimo che pusha"), non la
   modifica piu' recente: perdita silenziosa dei dati dell'altro dispositivo.

FIX:
- Conflitti: Last-Write-Wins DETERMINISTICO sul timestamp _savedAt (Store.save
  timbra lo stato a ogni modifica; il timbro viaggia nel blob). In conflitto si
  confrontano i timestamp: se il remoto e' piu' recente lo si ADOTTA
  (onRemoteWin: STATE=remoto + migrazioni + recompute + render), senza
  sovrascriverlo; se il locale e' piu' recente si ripubblica. Regola prevedibile
  e consistente, documentata nel codice.
- Multi-dispositivo: Sync.syncNow() al ritorno in primo piano
  (visibilitychange->visible e focus): se ci sono modifiche locali in coda le
  pubblica (LWW decide), altrimenti scarica e, se il remoto e' piu' avanti, lo
  adotta. Cosi' la riapertura dell'app riallinea da sola, senza reload.
- UI: rimosso lo stato/banner persistente "Conflitto risolto" dalla chip e dal
  pannello Account; la risoluzione mostra solo un toast temporaneo
  ("allineo con l'altra modifica" / "aggiornato dalle modifiche sull'altro
  dispositivo").

Contratto invariato tra mock in memoria e adapter Supabase (guardia di versione
ottimistica + updated_at). Retry offline e flush su pagehide invariati.

Verifica: suite verde, sync_test 12->16 (LWW remoto-vince, locale-vince,
syncNow adotta/ignora). Smoke test browser: boot pulito, zero errori JS, la
chip non mostra piu' "Conflitto risolto"; privacy Dashboard non regredita.
NB: la verifica end-to-end sui due dispositivi reali richiede Supabase, che nel
sandbox e' bloccato dalla rete: la logica e' coperta dai test unit contro il
mock che rispecchia esattamente il contratto Supabase. sw.js v18->v19;
APP_BUILD 2026-07-04.6.

## Giro 42 (Claude Code) — Task 4: export lista invitati completo

Segnalazione utente: esportando i nomi, non tutti i dati finiscono nel file.

Causa: exportGuestsCsv includeva anagrafica, RSVP/menu, logistica e le variabili
personalizzate, ma OMETTEVA tre campi presenti nel modello ospite e/o visibili
in app: il Tavolo assegnato (derivato dai Tavoli, mostrato come tag nella riga
ospite), Regalo (gift) e Ringraziato (thanked).

Fix: aggiunte le colonne "Tavolo", "Regalo", "Ringraziato" (dopo Accompagnatori,
prima delle variabili). Tavolo = seatTableOf(g.id).name; Ringraziato = Sì/No.
Quoting CSV e BOM UTF-8 invariati; le variabili personalizzate restano in coda.

Verifica: suite verde; E2E Playwright con download reale del CSV: header con
tutti e 13 i campi base + variabili, ospite seduto -> "Tavolo Rosa" nella
colonna Tavolo, Regalo e Ringraziato valorizzati, intolleranze/accessibilita'
corrette, numero colonne header == riga, zero errori JS. sw.js v19->v20;
APP_BUILD 2026-07-04.7.

## Giro 43 (Claude Code) — Task 5: playlist per momento della scaletta

Richiesta utente: nella sezione musica poter inserire un link (Spotify, Apple
Music, YouTube Music, Amazon, Deezer o qualsiasi URL) e associarlo ai vari
momenti dell'evento (ingresso sposi, aperitivo, cena, taglio torta, primo
ballo, party, dopocena, ecc.), con playlist diversa per ogni momento.

Implementazione: i momenti della scaletta (run-of-show) sono gia' esattamente
quei momenti. Aggiunto un campo opzionale playlist (URL) su ogni momento:
- editRs: nuovo campo "Link playlist"; salva su r.playlist.
- musicUrl(raw): validazione/normalizzazione — accetta SOLO http/https (blocca
  javascript:, data:, ecc.), aggiunge https:// a "dominio.com/..." senza schema,
  vuoto se non e' un URL. Un link non valido viene ignorato (il momento si salva
  lo stesso, con un toast di avviso): niente perdita dati, niente link pericoloso.
- musicLabel(url): etichetta breve dal dominio (Spotify/Apple Music/YouTube
  Music/Amazon Music/Deezer/Playlist).
- viewTimeline: se il momento ha un link, mostra un chip "▶ <servizio>"
  (anchor target=_blank rel=noopener) sotto il titolo.
Ampliati anche i suggerimenti momenti con "Dopocena / party" e "Saluti finali".
Il link e' nello stato -> si sincronizza tra dispositivi come il resto.

Verifica: suite verde + nuovo playlist_test (8 casi: parsing, schema
pericoloso, etichette). E2E: link senza schema -> https:// aggiunto, apertura
in nuova scheda sicura, etichetta Spotify, persistenza dopo reload, salvato nel
momento, link javascript: scartato (nessun anchor pericoloso, non salvato),
zero overflow, zero errori JS, screenshot controllato. sw.js v20->v21;
APP_BUILD 2026-07-04.8.

## Giro 44 (Claude Code) — Task 3: "widget" iPhone per la Dashboard (deep-link)

Richiesta utente: widget nella Home iPhone che apra l'app sulla Dashboard.

Onesta' tecnica: una PWA ("Aggiungi a Home") NON puo' esporre un widget nativo
iOS (WidgetKit richiede un'app Swift nell'App Store). La via realistica e
verificabile per "un'icona/widget che apre l'app su una scheda":
- Deep-link scheda: startTab() legge ?tab=dash (o #dash) e apre l'app su quella
  scheda; validato contro le schede esistenti, fallback a dash.
- Se si arriva da ?tab=, l'auto-apertura della guida viene saltata (altrimenti
  la guida navigherebbe alla sua scheda annullando il deep-link).
- manifest.json: aggiunte "shortcuts" (Dashboard/Budget/Ospiti) -> long-press
  dell'icona installata e scelta nell'app Shortcuts di iOS.
Ricetta per l'utente (Home widget reale, senza App Store): app Scorciatoie iOS
-> nuova scorciatoia "Apri URL" con .../index.html?tab=dash -> aggiungi il
widget Scorciatoie alla Home. Tocco = apre HubNozze sulla Dashboard.

Verifica: suite verde; manifest.json valido; E2E deep-link: default->dash,
?tab=budget->budget, ?tab=guests->guests, ?tab=dash->dash, ?tab=pippo->dash
(fallback), #vendors->vendors, zero errori JS. Regressioni (privacy, giro38,
playlist, export) verdi. sw.js v21->v22; APP_BUILD 2026-07-04.9.

## Giro 45 (Claude Code) — Bug: checklist Timeline <-> fornitori non collegata

Segnalazione utente: in Timeline la checklist ha voci che "prendono dal tab
Fornitori"; verificare se funziona e se i collegamenti sono coerenti.

DIAGNOSI: il collegamento (taskDone/taskVendor: un'attivita' con vendorCat si
auto-spunta e mostra il fornitore quando esiste un fornitore confermato di quella
categoria) funzionava SOLO per 2 voci seed (Confermare location/catering).
Incongruenze:
- genChecklist ("Genera standard") non impostava MAI vendorCat: tutte le voci
  generate restavano scollegate (nessuna auto-spunta, nessun fornitore mostrato).
- il seed k4 "Scegliere foto e video" era una voce "prenota fornitore" ma senza
  vendorCat (avrebbe dovuto puntare a Foto/Video).

FIX: mappa condivisa TASK_VENDORCAT (titolo -> categoria fornitore, con nomi
VCATS esatti) per le sole attivita' "prenota/assicura fornitore" (foto/video,
musica/DJ, fiori, torta, navetta/trasporti). NON collega le attivita'-evento
(degustazioni, prove, "confermare numeri") che non devono spuntarsi solo perche'
il fornitore e' confermato. La mappa e' usata da genChecklist, dal seed (k4) e da
migrateTaskVendorCat() che collega le attivita' seed gia' salvate senza vendorCat
(idempotente; boot + dopo ogni pull dal cloud, come le altre migrazioni).

Verifica: suite verde + timeline_test (7 casi: mappa in VCATS, auto-spunta solo
su confermato, categoria giusta, done manuale). E2E: seed k4 migrato a
Foto/Video, genChecklist collega le book-vendor e lascia manuali le
attivita'-evento, display "da fornitore (cat)" prima della conferma, dopo aver
confermato un fornitore Foto/Video la voce si auto-spunta (✓ + tag auto) e mostra
"Confermato: <nome>". Zero errori JS. sw.js v22->v23; APP_BUILD 2026-07-04.10.

## Giro 46 (Claude Code) — Bonifica forzata lista invitati (file Excel utente)

Ordine utente: cancellare la lista invitati presente e sovrascriverla con
quella nel file 07190774-tabella_invitati_matrimonio.xlsx.

Analisi file: foglio "Invitati", 131 invitati validi (0 duplicati, 0 nomi
vuoti). Colonne = formato export dell'app + 5 variabili tavoli. Distribuzioni:
Righi 68 / Biondi 63; RSVP tutti "In attesa"; menu 95 adulto, 28 bambino,
4 vegetariani, 2 vegani, 2 celiaci; navetta 0; +1 su 3 invitati; 36 nuclei;
63 invitati con variabili tavoli valorizzate (tutte nel dominio ammesso).

Implementazione:
- guestsRoster2(): factory con i 131 invitati (id stabili g2607_N), generata
  dall'Excel via parser zip/xml (mapping Righi->A, Biondi->B, RSVP->attesa,
  colonne K-O -> attr {nucleo,lato,eta,ambiente,stato}). Usata dal seed (il
  vecchio blocco di 113 nomi dettati e' stato rimosso insieme all'helper g()).
- migrateGuestsRoster2(): bonifica FORZATA per gli stati gia' salvati (cloud e
  dispositivi): sovrascrive e.guests, svuota i seatIds dei tavoli e azzera le
  regole di vicinanza (gli id vecchi non esistono piu'; i tavoli restano con
  nome/forma/posti). Flag guestsRosterV2: una sola volta per evento, le
  modifiche successive dell'utente non vengono mai risovrascritte. Agganciata
  a boot + Cloud.resume + cloudDoLogin + onRemoteWin (regola del Giro 36:
  le migrazioni girano sul vincitore del merge).
- I 113 vecchi restano recuperabili dalla history git.

Verifica: suite verde (17 suite). E2E: boot fresco -> 131 con distribuzioni
identiche all'Excel (68/63, 28 bambini, 3 +1, 63 attr, Greta Berardi prima);
stato esistente con vecchi ospiti + tavolo assegnato + regola -> lista
sostituita, posti svuotati, regole azzerate, tavolo intatto; idempotenza (un
RSVP modificato sopravvive al reload, nessuna ri-bonifica). Regressioni
giro38/39/40 + export CSV + collegamento fornitori: verdi. Zero errori JS,
zero overflow, screenshot controllato. sw.js v23->v24; APP_BUILD 2026-07-09.1.

## Giro 47 (Claude Code) — Attivita' "da fornitore" sempre modificabili ed eliminabili

Segnalazione utente (frustrazione legittima): in Timeline le voci collegate a
un fornitore non erano cancellabili ne' modificabili — la cella azioni mostrava
la nota "da fornitore (...)" AL POSTO dei tasti. E nella scheda Fornitori non
c'e' nulla che spieghi o governi quel vincolo. Il fix del Giro 45, collegando
piu' voci ai fornitori, aveva amplificato il problema.

FIX:
- viewTimeline: matita e X ora SEMPRE presenti su ogni attivita'; la nota
  fornitore ("Confermato: <nome>" / "da fornitore (cat)") e' scesa sotto i
  tasti, piccola, con tooltip che spiega: "Si spunta da sola quando confermi
  un fornitore <cat>. Puoi comunque modificarla o eliminarla."
- editTask: nuovo campo "Si spunta da sola con fornitore confermato" (select
  con le categorie fornitore + "nessun collegamento"): il vincolo ora si vede,
  si cambia e si toglie dall'editor. delTask (con conferma) funziona su tutte.
- toast editor allineati ("Attivita' aggiunta/aggiornata").

Verifica: suite verde; E2E a 390 e 375px: tutte le righe con matita+X,
eliminazione di una voce da-fornitore con conferma, scollegamento dal editor
(vendorCat rimosso), ricollegamento (13 opzioni), tabella dentro lo schermo,
zero errori JS, screenshot controllato. Regressioni timeline_link (auto-spunta
intatta), giro38, roster: verdi. sw.js v24->v25; APP_BUILD 2026-07-09.2.

## Giro 48 (Claude Code) — Dashboard navigabile + "Gia' pagato"

Due richieste utente:
1. Cliccando le voci della Dashboard si va nell'area dell'app collegata.
   Tutte le card KPI sono ora cliccabili (data-act="goTab" data-target):
   Budget massimo/Impegnato/Da pagare -> Budget & Finanze; RSVP confermati e
   le 3 card RSVP -> Ospiti; Fornitori confermati -> Fornitori; Attivita'
   completate -> Timeline; Posti assegnati -> Tavoli; anche le righe di
   "Prossimi pagamenti" -> Budget. Affordance: cursor pointer, hover con
   ombra, role="link" + title. La delega click risolve il piu' interno:
   il tocco sulla CIFRA sfocata continua a fare solo mostra/nascondi
   (togglePrivacy), il resto della card naviga. goTab in READONLY_ACTS.
2. Oltre al "Da pagare", la card pagamenti mostra "Gia' pagato: <importo>
   (<n> rate)" — caparre e acconti versati (d.paidSum) — anch'esso sfocato
   (blurMoney k_paid).

Fix di passaggio: refuso <tbody> vuoto introdotto e corretto in giornata.

Verifica: suite verde; E2E 390/375px: riga "Gia' pagato" presente e sfocata,
click su tutte le 8 card -> scheda giusta, riga prossimi pagamenti -> budget,
tocco sulla cifra rivela senza navigare, zero overflow, zero errori JS,
screenshot controllato. Regressioni privacy (giro40) e avvisi (forms): verdi.
sw.js v25->v26; APP_BUILD 2026-07-09.3.
