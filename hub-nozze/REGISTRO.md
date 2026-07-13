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

## Giro 49 (Claude Code) — Allineamento campi affiancati (Ospiti previsti / Contingenza)

Segnalazione utente: in Budget > Pianificazione i riquadri "Ospiti previsti"
e "Contingenza %" non erano allineati — l'etichetta lunga del primo va su due
righe e spingeva l'input piu' in basso rispetto all'altro.

Fix generale (non puntuale): nei blocchi a due colonne (.two) i campi sono
ancorati in basso (justify-content:flex-end sul .field, gia' flex column):
l'etichetta puo' salire su piu' righe ma i riquadri di input restano sempre
sulla stessa linea. Vale per tutte le coppie di campi dell'app (editor rate,
attivita', momenti, soglie avvisi, ecc.).

Verifica: suite verde; E2E 390/375px: input di Pianificazione con top e bottom
identici (616/663 e 635/682), scansione di tutti i .two della scheda budget
senza disallineamenti, screenshot controllato, zero errori JS.
sw.js v26->v27; APP_BUILD 2026-07-09.4.

## Giro 50 (Claude Code) — Tasto rapido per svuotare la ricerca ospiti

Segnalazione utente: cercando nella lista ospiti non c'e' un tasto veloce che
svuota la barra di ricerca.

Fix: X circolare dentro il campo (destra), visibile SOLO quando c'e' testo.
Il tocco svuota la query, ripristina l'intera lista, rimette il focus nel
campo e nasconde la X. Gestita in wireGuests (nessun listener accumulato:
oninput/onclick per assegnazione); coerente al rientro nella scheda quando la
query e' persistente (GUESTVIEW.q).

Verifica: suite verde; E2E 390/375px: X nascosta a campo vuoto, ricerca
"greta" filtra 131->1 e mostra la X, tocco -> lista completa + focus + X
nascosta, query persistente al cambio scheda con X coerente e funzionante,
zero overflow, zero errori JS, screenshot controllato.
sw.js v27->v28; APP_BUILD 2026-07-09.5.

## Giro 51 (Claude Code) — P2: merge per singola entita' nei conflitti di sync

Richiesta utente: procedere col merge per entita' (annunciato come P2), per
coprire l'editing simultaneo da due dispositivi.

Implementazione:
- merge3(base, locale, remoto, tsA, tsB): merge a 3 vie generico e ricorsivo.
  Regole: cambiato da un solo lato -> vince quel lato; oggetti -> campo per
  campo; array di entita' con id (budget, payments, guests, vendors, tasks,
  runshow, lists, tables...) -> merge per id: aggiunte da entrambe le parti
  convivono, la MODIFICA vince sulla cancellazione, stessa entita' -> ricorsione
  sui campi; scalari/array semplici in conflitto -> LWW su _savedAt (come prima).
- Sync: snapshot dell'ANTENATO comune (BASE={v,data}, persistito in
  localStorage hub_state_base_v1, aggiornato a ogni push ok / pull / syncNow /
  merge). In conflitto, se BASE.v == versione da cui partiva la modifica ->
  merge3 e push del risultato; il locale ADOTTA il merge (onRemoteWin), che ora
  viene anche persistito subito (Store.save). Se il push del merge fallisce, il
  retry ripubblica il MERGE (pendingStr aggiornato). Senza antenato valido ->
  fallback al LWW deterministico del Giro 41 (nessuna regressione).
- Risultato pratico: tu tocchi i fornitori sul telefono e Silvia i pagamenti
  sul tablet nello stesso momento -> sopravvivono entrambe.

Verifica: 18 suite verdi; nuova merge_test 11 casi (entita' diverse, aggiunte
incrociate, cancellazione rispettata, modifica-vince-su-cancellazione, merge
campo-per-campo sulla stessa entita', stesso campo -> LWW, meta fusa, flusso
Sync completo conflitto->merge v3 con adozione locale, push successivo liscio,
fallback LWW senza antenato). Nota onesta: lo smoke con page.evaluate non e'
possibile (app IIFE, nessun global); la copertura e' data dagli unit test che
girano sul codice REALE estratto dal file + regressioni E2E senza errori JS
(dashnav, searchclear, roster, privacy). sw.js v28->v29; APP_BUILD 2026-07-09.6.

## Giro 52 (Claude Code) — Merge P2 irrobustito + fuzzing strutturato

Richiesta utente: affinare il merge per entita', renderlo piu' robusto e
affidabile, e testarlo "in maniera pesante e strutturata".

Irrobustimenti al codice:
- merge3: stringify calcolati una volta per chiamata (meno lavoro ripetuto);
  paracadute di profondita' (_depth>64 -> LWW) contro strutture anomale.
- Sync: guardia di validita' sul RISULTATO del merge prima di pubblicarlo
  (isValidState; se il merge producesse uno stato malformato -> eccezione ->
  fallback LWW, mai un documento rotto nel cloud).

Fuzzing strutturato (nuova suite merge_fuzz_test, PRNG con seed riproducibile):
1. FUZZ DELLE PROPRIETA': per ogni caso genera uno stato realistico (fornitori,
   pagamenti, ospiti, attivita') + script di modifiche concorrenti casuali per
   due dispositivi (modifica campo / aggiunta / cancellazione), poi verifica
   8 proprieta': P1 nessuna perdita, P2 cancellazione rispettata, P3 la
   modifica vince sulla cancellazione, P4 determinismo, P5 simmetria
   (scambiando i lati), P6 identita', P7 round-trip JSON, P8 struttura valida.
   ORACOLO ESATTO sul diff effettivo base->documento (la prima versione a log
   di operazioni dava 32 falsi allarmi su 400: rumore del test, non del motore).
2. FUZZ DEL FLUSSO: 120 sequenze multi-round di conflitti reali attraverso il
   motore Sync (A col motore+antenato, B che pusha direttamente): a ogni round
   entrambe le modifiche presenti nel cloud, stato synced, antenato che
   avanza correttamente.

Esiti: corsa pesante una tantum 15.000/15.000 casi (3 basi di seed diverse:
20260709, 777001, 31337) + 120/120 flussi. In suite permanente restano 400
casi proprieta' + 120 flussi (~7s), con FUZZ_N/FUZZ_SEED per ripetere la corsa
pesante. Tutte le 19 suite verdi. Nessun difetto del motore trovato dal fuzz:
i fallimenti iniziali erano dell'oracolo di test, corretto.
sw.js v29->v30; APP_BUILD 2026-07-09.7.

## Giro 53 (Claude Code) — Sync veloce: diagnosi e cura della lentezza

Segnalazione utente: "la sincronizzazione e' molto, molto lenta".

DIAGNOSI (misurata): il documento pesa ~45KB (131 ospiti + 50 voci budget).
Tre sprechi reali nel motore:
1. A OGNI ritorno in primo piano syncNow scaricava il documento INTERO anche
   quando il cloud non aveva novita' (il caso di gran lunga piu' comune).
2. focus e visibilitychange scattano spesso INSIEME -> doppio download
   simultaneo dello stesso documento.
3. Dopo ogni adozione/merge, Store.save rimetteva in coda un push del medesimo
   contenuto (cambiava solo il timbro _savedAt) -> upload fotocopia da 45KB.

CURA:
- head() sul RemoteAdapter (memory + Supabase): chiede SOLO la versione
  (select "version", risposta di pochi byte). syncNow ora controlla head e
  scarica il documento solo se il cloud e' davvero avanti: il rientro in app
  senza novita' passa da ~45KB a ~0.3KB (~150x in meno).
- Guardia anti-doppione su syncNow: in-flight flag + finestra di 3s ->
  focus+visibility ravvicinati producono UN solo controllo.
- notify/flush saltano il push quando il contenuto e' identico all'ultimo
  stato sincronizzato (confronto che ignora il timbro _savedAt): eliminati
  gli upload fotocopia post-adozione e i commit senza modifiche reali.
Contratto invariato per i remote senza head (fallback al pull classico).

Verifica: 19 suite verdi; sync_test 16->20 (head senza novita' NON scarica,
head avanzato scarica e adotta, anti-doppione su 3 chiamate parallele -> 1
controllo, contenuto identico -> nessun upload ma il push reale passa);
merge/flow fuzz invariati (520 scenari). sw.js v30->v31; APP_BUILD 2026-07-09.8.

## Giro 54 (Claude Code) — "Sincronizzo..." infinito dopo una modifica: bug e cura

Segnalazione utente: dopo una modifica il chip resta "in sincronizzazione"
continuamente o molto a lungo.

DIAGNOSI — un BUG vero, non solo inefficienza: _push non aveva guardia "in
volo". Con upload lenti (45KB su mobile), una seconda modifica durante il volo
faceva partire un secondo push con versione ormai vecchia -> il server
rispondeva CONFLITTO (con se stessi) -> merge -> nuovo upload -> se intanto
arrivava un'altra modifica, di nuovo... raffica di upload e chip perennemente
su "Sincronizzo...".

CURA (tre pezzi):
1. Guardia in volo + COALESCING: mai due push sovrapposti; il contenuto nuovo
   si accoda e a fine volo parte UN solo upload con l'ULTIMA versione (e se nel
   frattempo il contenuto e' tornato uguale all'ultimo sincronizzato, niente).
   Eliminati i conflitti-con-se-stessi.
2. Debounce 400ms -> 1200ms (configurabile via opts.debounceMs): dieci spunte
   rapide = un solo upload. L'uscita dall'app resta protetta dal flush su
   pagehide/visibilitychange (immediato, come prima).
3. Chip calmo: Sync.displayStatus() mostra "Sincronizzo..." SOLO se lo stato
   dura oltre 800ms (opts.graceMs); updateSyncChip usa displayStatus con
   auto-refresh a soglia scaduta. I push lampo non sfarfallano piu'.

Verifica: 19 suite verdi; sync_test 20->22: (a) push in volo + raffica di
notify -> esattamente 2 upload totali, l'ultimo col contenuto finale, zero
conflitti, stato synced, niente pending; (b) displayStatus: push lampo
invisibile, push lungo mostrato, rientro su synced. Regressioni E2E dashboard
e privacy verdi. sw.js v31->v32; APP_BUILD 2026-07-09.9.

## Giro 55 (Claude Code) — Audit della stessa famiglia: altri 3 difetti trovati e corretti

Domanda utente: "ci sono altri bug con queste caratteristiche e tipologia?"
(cioe' della famiglia del Giro 54: asincronia senza guardie, timer, closure
su stato vecchio, doppi eventi). Audit sistematico del file. Esito:

TROVATI E CORRETTI (3):
1. STALE CLOSURES negli editor (il piu' serio, perdita dati silenziosa):
   editBudget/editPayment/editGuest/editVendor/editTask/editRs catturavano il
   riferimento all'entita' all'APERTURA della modale. Se durante la modifica
   arrivava uno stato dal cloud (syncNow al focus, adozione, merge), STATE
   veniva sostituito e il salvataggio mutava un oggetto ORFANO: modifica persa
   in silenzio. Ora le fn di salvataggio ri-risolvono l'entita' per id da ev()
   AL MOMENTO del salvataggio; se non esiste piu' (cancellata altrove), toast
   chiaro invece di perdita muta. Corretti anche delBudget e delPayment che
   usavano l'evento catturato.
2. SOPPRESSORE POST-DRAG APPESO: dopo un trascinamento in planimetria, il
   click-suppressor si toglieva solo se il click arrivava; su touch spesso non
   arriva -> restava armato e MANGIAVA il primo tocco successivo ovunque
   ("ogni tanto un tocco non risponde"). Ora si auto-disinnesca dopo 350ms.
3. TOAST ACCORCIATI: toast ravvicinati condividevano il timer di chiusura del
   precedente (il secondo spariva subito). Timer ora azzerato a ogni toast.

VERIFICATI SANI (stessa famiglia, nessun intervento):
- syncNow (guardia in-flight+throttle, Giro 53), _push (guardia+coalescing,
  Giro 54), retry su 'online' (passa dalla guardia push);
- drag planimetria: pointermove/up/cancel rimossi in cleanup() su up e cancel;
- timer: saveTimer/pushTimer/updateSyncChip._t con clearTimeout; rowflash con
  {once:true}; wire* su elementi ricreati a ogni render (nessun accumulo);
- doppio flush su pagehide+visibilitychange: coalescato e deduplicato dal
  Giro 54; delegati data-act: leggono ev() al click (mai stato catturato);
- delTask/delRs/delVendor/delList/delGuest: gia' live (ev() dentro la fn).

Verifica: 19 suite verdi; regressioni E2E su TUTTI gli editor toccati (budget
save, task/momenti edit+delete+conferme, playlist, dashboard, swipe): verdi.
Nota onesta: lo scenario stale-closure (stato sostituito con modale aperta)
non e' riproducibile in E2E senza accesso all'IIFE; la correttezza e' per
costruzione (ri-risoluzione per id al salvataggio) + regressioni sul percorso
normale. sw.js v32->v33; APP_BUILD 2026-07-09.10.

## Giro 56 (Claude Code) — Report catering filtrabile dal pill

Richiesta utente: nel Report catering il campo "solo confermati" deve essere
modificabile al clic, per vedere i totali dei confermati, dei non ancora
confermati o di tutta la lista.

Implementazione: il pill e' ora un bottone ciclico (data-act
cycleCateringScope): solo confermati (verde) -> solo in attesa (ambra) ->
tutti in lista (blu) -> da capo, con icona di rotazione e aria-label. Tutto il
report si ricalcola sul gruppo scelto: Coperti totali (ospiti+accompagnatori),
Bambini/menu' bambino, Con intolleranze, tabella Pasti, elenco Intolleranze e
Accessibilita'. Stato runtime (CATERING_SCOPE, non persistito: si riapre sui
confermati). In sola lettura il filtro resta usabile (READONLY_ACTS). La
sezione Navetta resta sui confermati (dato operativo).

Verifica: suite verde; E2E 390/375px con mix noto (2 confermati di cui 1
bambino e 1 con accompagnatore, 1 non viene, resto in attesa): default
confermati 3 coperti/1 bambino/1 intolleranza; in attesa e tutti confrontati
con l'oracolo calcolato dallo stato reale (131+plusOne ecc.); il ciclo torna a
confermati; zero overflow, zero errori JS, screenshot controllato.
sw.js v33->v34; APP_BUILD 2026-07-09.11.

## Giro 57 (Claude Code) — Coperti totali: scomposizione autoesplicativa

Domanda utente: "come fanno a esserci 131 persone in lista e 134 coperti?"
Risposta: coperti = invitati + accompagnatori (+1). Nel file Excel 3 invitati
hanno Accompagnatori=1 (Jessika Berardi, Federico Giannini, Roberta Marconi):
131 nomi + 3 accompagnatori = 134 posti a tavola per il catering.

La domanda pero' rivela un'etichetta poco chiara: la card "Coperti totali" del
Report catering ora mostra la scomposizione quando ci sono accompagnatori:
"N invitati + M accompagnatori (+1)". Vale per tutte e tre le viste del filtro
(confermati / in attesa / tutti); senza accompagnatori la riga extra non appare.

Verifica: suite verde; E2E catering invariato (4 scenari verdi); card
verificata su "tutti": "134 / Coperti totali / 131 invitati + 3 accompagnatori
(+1)"; screenshot controllato, zero overflow. sw.js v34->v35;
APP_BUILD 2026-07-09.12.

## Giro 58 (Claude Code) — Tipologia persona separata dalla tipologia menu

Proposta utente (condivisa): il vecchio campo Menu mischiava eta'
(adulto/bambino) e regime alimentare (vegetariano, celiaco...): impossibile
rappresentare un bambino celiaco o un adulto vegetariano. Nel roster c'era
proprio il caso: Irene Petruzzino, celiaca E bambina.

Nuovo modello: g.ptype ("adulto"/"bambino") + g.meal
("normale"/"vegetariano"/"celiaco"/"vegano").
- migrateMealSplit (flag mealSplitV1, boot + tutti i pull dal cloud):
  meal bambino/adulto -> menu "normale"; ptype dedotto dal vecchio valore O
  dalla variabile tavoli "Fascia d'eta'" (Irene -> bambina celiaca).
  migrateGuestsRoster2 azzera il flag quando risostituisce la lista (ordine
  difensivo: il roster porta il campo misto).
- Editor ospite: due select separate (Tipo persona / Menu').
- Righe ospiti: colonna Menu' mostra il menu + tag "bambino".
- Report catering: card "Bambini" (per tipologia) + tabella "Pasti (menu' x
  tipologia)" a matrice: righe menu, colonne Adulti/Bambini/Totale; gli
  accompagnatori (+1) contano come adulti menu normale. Funziona con le 3
  viste del filtro (confermati/attesa/tutti).
- Import: impMeal ora ritorna il menu (bambino/adulto -> normale) e il nuovo
  impPtype la tipologia: la stessa colonna mista di Excel viene separata.
- Export CSV: nuova colonna "Tipo" tra RSVP e Menu.
- recompute: kidsN per ptype; pasti per menu (+1 -> normale).
- Prefill variabili tavoli (eta', stato famiglia): da ptype.

Verifica: 19 suite verdi (import_test aggiornato: impMeal/impPtype separati,
default menu "normale"); E2E: migrazione seed (131, 29 bambini incl. Irene,
menu solo nei 4 valori nuovi), matrice = oracolo dallo stato (celiaco 1+1!),
editor con 2 select e salvataggio bambina celiaca, riga con tag, export con
Tipo; regressioni roster/catering/ricerca/privacy verdi. Zero errori JS,
screenshot controllato. sw.js v35->v36; APP_BUILD 2026-07-09.13.

## Giro 59 (Claude Code) — Import: colonna "Tipo" dedicata (round-trip completo)

Domanda utente: "quindi devi aggiornare anche import ed export?" — Erano gia'
aggiornati nel Giro 58 (export con colonna Tipo; import che scompone la
colonna mista). MA la verifica del ROUND-TRIP completo (esporta -> reimporta)
ha trovato un buco: il CSV esportato ha "Tipo" separato e l'import non sapeva
mappare quella colonna -> reimportando, i bambini tornavano adulti.

Fix: campo 'ptype' nell'import — sinonimi per l'auto-mappatura ('tipo',
'tipologia', 'tipo persona', "fascia d'eta'", ...; messo DOPO 'meal' cosi'
"tipo menu/pasto" resta al menu), voce "Tipo persona" nella UI di mappatura,
e builder che usa la colonna dedicata se mappata, altrimenti deduce dal menu
misto (compatibilita' con i file vecchi).

Verifica: import_test 30->32 — round-trip con l'header REALE dell'export
(Tipo mappata a col.5, Menu a col.6; "Irene bambino/celiaco" ricostruita
identica) + legacy (colonna mista 'bambino' -> tipo bambino menu normale,
'vegetariano' -> adulto vegetariano). E2E export invariato. Tutte le 19 suite
verdi. sw.js v36->v37; APP_BUILD 2026-07-09.14.

## Giro 60 (Claude Code) — Campi obbligatori (* rosso) + fix modale

Domanda utente: quali campi rendere obbligatori per una base dati consistente?

CRITERIO: obbligatorio solo cio' che, se manca, rompe conteggi o collegamenti;
il resto ha default sensati (niente attrito inutile su mobile). Scelte:
- Ospite: Nome. Voce di spesa: Voce. Rata: Descrizione + Importo>0 (una rata
  senza importo falsa cash-flow e "da pagare"; via il fallback "Rata").
- Fornitore: Nome (la Categoria e' una select con default, sempre valorizzata).
- Attivita': Titolo. Momento scaletta: Momento. Lista: Titolo.

UX: label con * rosso (label.req::after); al salvataggio con campi mancanti ->
bordo rosso sul campo (.inp.invalid), toast "Compila i campi obbligatori (*)"
e focus sul primo mancante (helper reqOk).

BUG VERO trovato dal test: il motore delle modali chiamava close() ANCHE
quando la fn di salvataggio usciva per validazione fallita -> "Salva" a vuoto
chiudeva la finestra buttando l'input parziale (comportamento storico,
silenzioso). Fix: la fn puo' annullare la chiusura ritornando false; tutte le
validazioni ora lo fanno. I guard "entita' non piu' presente" continuano a
chiudere (corretto: non c'e' piu' nulla da salvare).

Verifica: 19 suite verdi; E2E dedicato sui 6 editor (asterisco presente,
salvataggio a vuoto bloccato con modale APERTA + bordo rosso + focus + toast,
rata bloccata anche con importo 0, poi salvataggio corretto a campo compilato);
regressioni su tutti gli editor (budget/conferme/playlist/ospiti/attivita'/
catering) verdi. sw.js v37->v38; APP_BUILD 2026-07-09.15.

## Giro 61 (Claude Code) — Barra dei tab: orientamento per chi arriva nuovo

Segnalazione utente: Silvia (nuova utente) disorientata nel passare da una
scheda all'altra, titubante sulla barra dei tab. Diagnosi UX: barra di solo
testo che scorre senza NESSUN segnale che oltre il bordo ci sia altro; scheda
attiva poco contrastata; dopo una navigazione da Dashboard/avvisi la barra
poteva mostrare tutt'altre schede.

Quattro interventi:
1. ICONE su ogni scheda (casa, banconote, persone, rubrica, sedia, brindisi,
   checklist, appunti): riconoscibilita' immediata, prima del testo.
2. FRECCE DI SCORRIMENTO ai bordi con sfumatura (tabswrap can-left/can-right,
   aggiornate su scroll/resize): dicono "qui si scorre" e al tocco fanno
   scorrere di mezzo schermo. Spariscono a fine corsa e su desktop (sidebar).
3. AUTO-CENTRAGGIO: a ogni cambio scheda (tab, card Dashboard, avvisi, deep
   link) la scheda attiva si porta al centro della barra: vedi sempre dove sei
   e cosa c'e' accanto (tabsEnsureVisible in renderTabs).
4. Scheda attiva a SFONDO PIENO (sea su avorio): contrasto netto.
Scrollbar nativa nascosta (la sostituiscono frecce+sfumature); listener
registrati una volta (#tabs e' un nodo fisso); desktop invariato.

Verifica: suite verde; E2E 390/375px: 8 icone, freccia destra visibile
all'avvio e sinistra no, click freccia -> scorre e compare l'altra,
navigazione da card Dashboard -> Timeline centrata (scarto <1px), stile
attiva pieno, click sull'icona = cambio scheda (delega intatta), zero
overflow, zero errori JS, screenshot controllati. Regressioni dashnav/avvisi/
privacy verdi. sw.js v38->v39; APP_BUILD 2026-07-09.16.

## Giro 62 (Claude Code) — Eliminare un fornitore dalla tabella di confronto

Domanda utente: "come faccio a cancellare un fornitore?" — La domanda rivelava
un buco: il tasto Elimina esisteva SOLO sulla card del fornitore (categoria
con un fornitore singolo). Nelle categorie con piu' fornitori a confronto
(es. la Location con Castello Benelli e Borgo Fregnano) la tabella mostra solo
"Apri", e la modale di modifica aveva solo Annulla/Salva: nessun percorso di
eliminazione.

Fix: bottone "Elimina" (danger) nella modale di modifica del fornitore, solo
per fornitori esistenti (non su "Nuovo fornitore"); apre la solita conferma
"Eliminare il fornitore?" via setTimeout (pattern editBudget: la conferma va
aperta dopo che close() ha svuotato #modalRoot).

Verifica: suite verde; E2E: due fornitori stessa categoria -> tabella di
confronto -> Apri su uno -> Elimina presente -> conferma -> rimosso da stato e
vista; "Nuovo fornitore" senza Elimina. Zero errori JS.
sw.js v39->v40; APP_BUILD 2026-07-09.17.

## Giro 63 (Claude Code) — Nuova icona app (home screen)

Richiesta utente: il logo dell'icona in home screen era "un disegno troppo
semplificato"; voluta una forma elegante, minimalista, moderna, che richiami
il numero 7 (17/07/2027).

Design: "7" calligrafico avorio (barra + diagonale curva, tratto tondo) con
una fede nuziale d'oro infilata sulla diagonale — intreccio reale: il 7 passa
sopra l'anello nell'incrocio alto, l'anello ripassa sopra il 7 in quello
basso. Fondo teal con gradiente radiale sottile, full-bleed (iOS arrotonda da
solo, Android maschera il maskable; contenuto dentro la safe zone ~80%).
Sorgente vettoriale salvato in icon-source.svg; PNG rasterizzati via Chromium
headless a 512/192/180 (stessi nomi file: manifest.json e index.html invariati).

Verifica: leggibilita' controllata a 120/60px (mock home iOS) e con maschera
circolare Android; suite test verde; app boot ok. Icone in ASSETS cache-first
-> bump obbligatorio della cache SW per propagarle.
Nota onesta: su iPhone l'icona gia' aggiunta NON si aggiorna da sola — va
rimossa e rifatta "Aggiungi a Home".
sw.js v40->v41; APP_BUILD 2026-07-09.18.

## Giro 64 (Claude Code) — Tavoli v2: caratteristiche ospiti e ottimizzatore

Richiesta utente: analisi dello stato (campi, voci, pesi, algoritmo) e piano
per migliorare chiarezza e, dove serve, l'algoritmo. Eseguito il piano intero
(Fasi A+B+C).

Fase A — motore:
- A1 (bug): l'affinità "bambini vicini" era codice morto (controllava
  meal==='bambino', valore sparito col meal-split). Ora l'età deriva da ptype.
- A2 (bug): per tavoli TONDI e QUADRATI l'ottimizzatore usava il modello a
  2 file: il posto n-1 non era considerato vicino del posto 0, mentre 0-2 sì.
  Ora seatPairsFor(t) calcola le adiacenze geometriche REALI dal disegno
  (i 2 posti più vicini): l'algoritmo ottimizza ciò che si vede. Le forme a
  2 file (rett/imperiale/serpentina) restano sul modello corretto esistente.
  Bonus perf: pairs precomputati una volta per ottimizzazione (prima ricalcolati
  a ogni valutazione di costo, ~2000 volte).
- A3: a livello di posto l'affinità era binaria (3 punti fissi): i pesi delle
  variabili non contavano su chi siede accanto. Ora il costo usa la similarità
  pesata reale; wNear/wFar portati a 40/50 così le regole esplicite dominano
  sempre (similarità max ~30).

Fase B — dati:
- B1: nucleo/lato/età/gruppo non si compilano più due volte: le variabili
  sono DERIVATE live dai campi nativi (household/side/ptype/group), con
  override facoltativo solo per l'età (Giovane/Anziano). Migrazione varsVer 3:
  marca le derivate e purga gli attr doppione (conserva i raffinamenti età).
  Da ~655 celle da mantenere a ~130 facoltative; niente più dati divergenti,
  niente doppio conteggio del nucleo.
- B3: pesi come Poco/Normale/Molto (3/6/10) invece del numero 0-20 nudo.
- Export CSV: solo variabili compilabili (le derivate duplicavano le colonne
  base); età col valore effettivo.

Fase C — UX:
- C1: wizard passo 1 in due sezioni: "Dai dati ospiti — automatiche" (con
  copertura es. Lato 131/131) e "Extra — si compilano al passo 2". Passo 2
  mostra solo le compilabili. "Precompila" ridotto a "Deduci lo Stato".
- C2: report del Genera con composizione di ogni tavolo (gruppi/nuclei) e
  regole violate COI NOMI, non solo il conteggio.
- C3: scheda ospite: badge "N da compilare" sulle caratteristiche mancanti.
- C4: segnaposto per gli accompagnatori (+1) in planimetria e riserva, con
  vincolo implicito accanto al titolare (posto ADIACENTE, verificato);
  toggle "+1: Sì/No" nella barra; sweep automatico degli id orfani
  (ospite eliminato, +1 ridotti). Ora i coperti tornano: 131 in lista,
  134 da sedere.

Nota di progetto: regole contraddittorie (A insieme B, ma i loro nuclei si
fondono via altre regole/famiglie) si risolvono a favore di insieme+famiglia:
la "lontani" impossibile resta segnalata nel report.

Verifica: b1 19/19, b2 riscritta 38/38 (adiacenze per forma, similarità,
segnaposto), vars_test 16/16 (derivazione+migrazione v3), suite completa
19 suite verdi; E2E nuovo e2e_tavoli2 (8 scenari: KPI, wizard, migrazione
persistita, genera 134/134 con regole 2/2, +1 adiacente su anello, toggle,
scheda ospite, deduci stato) + regressioni roster/export/catering/mealsplit/
required. Zero errori JS, zero overflow.
sw.js v41->v42; APP_BUILD 2026-07-10.1.

## Giro 65 (Claude Code) — Import allineato alla scheda ospite (Tavoli v2)

Richiamo utente: "se modifichi la scheda ospiti, attento ad aggiornare anche
import ed export". Export già allineato al Giro 64; l'audit dell'import ha
trovato tre buchi (i primi due storici, il terzo introdotto dal Giro 64):
1. Il GRUPPO non veniva importato affatto ("gruppo" era un sinonimo di
   nucleo!) — e ora pesa nell'ottimizzatore. Nuovo campo import 'group'.
2. Lo STATO (single/coppia) veniva ignorato: perso a ogni round-trip
   export->import. Nuovo campo 'stato' -> attr.stato (impStato normalizza).
   "Stato" nudo resta RSVP (storico): vince l'ordine dei campi.
3. La colonna "Fascia d'età" dell'export non era più mappabile insieme a
   "Tipo": nuovo campo 'eta' -> Giovane/Anziano diventano override attr.eta,
   Bambino/Adulto restano al tipo persona. Con una sola colonna età, va al
   tipo persona come prima (fallback conservato, anche dal menù legacy).
impNewGuests passa group/attr senza modifiche (verificato). UI mappatura
colonne estesa (Gruppo, Stato, Fascia d'età).

Verifica: import_test 32->39 casi (mappature, precedenze rsvp/stato e
ptype/eta, round-trip v2 con l'header reale dell'export, impStato); suite
completa verde; E2E export e roster rieseguiti. Zero errori JS.
sw.js v42->v43; APP_BUILD 2026-07-10.2.

## Giro 66 (Claude Code) — Documento catering: stampa/PDF della disposizione

Richiesta utente: una volta confermata la disposizione, serve un output
elegante e chiaro da stampare in PDF o su carta e inviare al catering.

Prima il tasto Stampa produceva solo un elenco nomi per tavolo. Ora genera
un documento completo (buildCateringDoc, puro e testabile):
1. Intestazione: sposi, data, location con indirizzo, data di generazione.
2. Riepilogo operativo: KPI (tavoli, coperti, adulti/bambini, menù speciali,
   intolleranze) + MATRICE menù per tavolo (Normale/Vegetariano/Celiaco/
   Vegano, bambini, intolleranze) con riga dei totali — il foglio di lavoro
   del catering. Convenzione dichiarata nel documento: i +1 contano come
   menù normale. Blocco "senza posto" evidenziato se esiste.
3. Planimetria in bianco e nero (cateringPlanSvg): geometria fedele a
   quella a schermo, posti occupati pieni/vuoti tratteggiati, occupazione.
4. Schede tavolo: persone in ORDINE DI POSTO (numerate), badge bambino/+1/
   menù speciale, note con intolleranze e accessibilità per persona.
Impaginazione A4 (@page, salti pagina tra sezioni, schede indivisibili),
bottone "Stampa / Salva PDF" (nascosto in stampa). Dati da seatPrintStats
(nel motore, unit-testato): conteggi per tavolo e totali, id morti ignorati,
senza-posto inclusi i +1.

Verifica: b2 41/41 (+3 casi seatPrintStats); suite completa verde; E2E
e2e_print con popup reale: totali del documento == oracolo calcolato dallo
stato (134 coperti, 29 bambini, matrice menù), 15 schede, planimetria,
convenzioni, intolleranze e accessibilità presenti; render desktop A4 senza
overflow (docW 794); PDF reale generato via Chromium (204KB). Il taglio
visto nello screenshot mobile era un artefatto Playwright (DOM misurato ok).
sw.js v43->v44; APP_BUILD 2026-07-10.3.

## Giro 67 (Claude Code) — Intelligenze operative I1-I4 (livelli gratuiti)

Richiesta utente: implementare le intelligenze che non costano nulla e non
richiedono decisioni, con studio di implicazioni e rischi.

I1 — Controllo qualità dati (dentro alertsCompute, stessa UX degli avvisi:
campanella, Dashboard, goAlert con evidenzia riga, silenziabili):
possibili doppioni (nome normalizzato), nuclei con lati misti (info),
bambino seduto senza nessuno del suo nucleo al tavolo, fornitore confermato
senza telefono né email, rate collegate oltre il preventivo del fornitore.
Sul roster reale: 4 info sui nuclei misti + 1 rilievo vero (Castello
Benelli senza contatti) — rumore accettabile e silenziabile.

I2 — Advisor budget (card in Budget): classifica le voci per macro-voce
(fornitore collegato prima, parole chiave poi), confronta le quote % con
benchmark indicativi Italia (BUDGET_BENCH), verdetto in linea/sopra/sotto,
voci non classificate dichiarate, proiezione di spesa finale plausibile.
Solo informativo: non tocca alcun dato.

I3 — Scadenzario decisioni fornitori (card in Fornitori + avvisi):
lead time per categoria (VENDOR_LEAD: Location 12 mesi, Catering 9,
Foto/Video 8, Musica 6, ...), data-limite concreta, stato confermato/in
corsa/scoperto. Gli avvisi v_key_* ora hanno la data ("decidere entro il
...") e severità alta oltre la scadenza; id invariati (mute conservati).
BREAKING semantico voluto: prima avvisava solo a 180 giorni; ora Location
non confermata a 300 giorni avvisa (lead 12 mesi) — test aggiornati.

I4 — Meteo (Open-Meteo, gratis, senza chiave, card in Dashboard + avviso):
geocoding della location (una volta, salvato), clima storico ultimi 10 anni
su finestra ±5 giorni attorno alla data (massime/minime medie, frequenza
pioggia, giorni >32°C); entro 16 giorni dalle nozze previsione reale del
giorno con probabilità pioggia; avviso "piano B" (alta ≥50%, media 30-49%).
Guardie anti-loop: refresh max ogni 12h a successo, retry non prima di 15
minuti, mai due in volo, dati in e.meteo (sincronizzati tra dispositivi).
Card degrada con gentilezza se offline.

BUG DI PRODUZIONE trovato dai test: il service worker applicava cache-first
anche ai GET cross-origin — la prima risposta meteo sarebbe rimasta
congelata in cache fino al bump successivo. Fix in sw.js: le richieste
fuori origine passano al browser senza cache. (Scoperto perché i mock
Playwright non intercettavano: le fetch passavano dal SW.)

Verifica: alerts_test 16->29 casi (qualità, scadenzario, meteo, advisor,
funzioni pure meteoHistStats/meteoPickDay con wrap d'anno); suite completa
verde; E2E e2e_intel (2 contesti, Open-Meteo mockato via route): storico in
Dashboard con geocoding, advisor budget, scadenzario con stati reali,
scenario nozze a 10 giorni con previsione 70% -> card previsione + avviso
alta + doppione + bimbo solo + fornitore senza contatti. Zero errori JS,
zero overflow.
sw.js v44->v45; APP_BUILD 2026-07-10.4.

## Giro 68 (Claude Code) — Meteo guidato dalla location CONFERMATA

Richiesta utente: il meteo deve basarsi sull'indirizzo della location
confermata, non sull'intestazione evento.

- Campo nuovo "Indirizzo" nella scheda fornitore (v.address), utile a tutto
  il CRM; l'indirizzo del Benelli esce dalle note ed entra nel campo giusto.
- meteoLocationQuery(): catena esplicita — fornitore LOCATION CONFERMATO con
  indirizzo > intestazione evento (venueAddr/venue); estrae la città
  (ultima parte, senza provincia tra parentesi).
- meteoRefresh: la query entra nella cache (e.meteo.q). Se la location
  confermata cambia (o cambia indirizzo), la cache è invalida: nuovo
  geocoding e nuovi dati anche dentro la finestra delle 12h.
- Migrazione migrateVendorAddr (idempotente, nei 4 punti della catena):
  address="" dove mancante; se il fornitore è la location dell'intestazione
  (stesso nome) eredita venueAddr — il meteo parte subito giusto.
- Seed aggiornato (benelli con address, note ripulite).

Verifica: alerts_test 29->31 (catena di scelta della località); suite
completa verde; E2E: scenario E — col Benelli confermato il meteo geocodifica
"Bellaria-Igea Marina"; scartato Benelli e confermato Fregnano con indirizzo
a Verucchio, al reload la cache si invalida e card+dati passano a Verucchio.
Zero errori JS.
sw.js v45->v46; APP_BUILD 2026-07-10.5.

## Giro 69 (Claude Code) — Avviso "nuclei con lati misti" riscritto

L'utente non capiva l'avviso info "ha ospiti su entrambi i lati". Testo
riscritto in linguaggio naturale coi nomi degli sposi: «Nella famiglia "X"
alcune persone risultano invitate da Righi e altre da Biondi (campo Lato).
Di solito è un refuso: tocca per controllare, o silenzia se è voluto.»
Fallback "lato A/B" se i nomi mancano. Suite verde.
sw.js v46->v47; APP_BUILD 2026-07-10.6.

## Giro 70 (Claude Code) — Riposizionamento sezioni (richiesta utente)

"Analisi intelligente" del budget spostata SOTTO i Pagamenti (era sopra le
Voci di spesa); "Scadenzario decisioni" spostato in FONDO alla lista
fornitori (era in testa). Nessuna logica toccata. E2E sull'ordine delle
sezioni in entrambe le viste; suite verde.
sw.js v47->v48; APP_BUILD 2026-07-10.7.

## Giro 71 (Claude Code) — Allineamento grafico intestazione Ospiti

Segnalazione utente (screenshot): i bottoni di "Ospiti per nucleo" andavano
a capo in modo disordinato ("+ Ospite" orfano e disallineato) e i filtri
spezzavano con "Non viene" da solo.

- CSS globale: le azioni dentro .sec-title>span ora sono flex con
  flex-wrap, gap 6px e justify-content:flex-end — quando vanno a capo
  restano righe ordinate allineate a destra, in ogni sezione dell'app.
- Filtri ospiti: ricerca a tutta larghezza sulla prima riga; sotto, i 4
  filtri come segmenti a larghezza uguale su UNA riga (misurato: stessa
  riga a 390px, zero overflow).

Verifica: misure E2E (filtri su una riga, bottoni del titolo allineati al
bordo destro del contenitore), smoke su tutti gli 8 tab senza overflow,
suite completa verde.
sw.js v48->v49; APP_BUILD 2026-07-10.8.

## Giro 72 (Claude Code) — Accompagnatori visibili nei totali ospiti

Domanda utente: "perché nel totale degli ospiti non vedo gli
accompagnatori?" — Erano solo il numero +N sull'invitato: contavano nei
coperti confermati (d.head) ma non nei totali di lista.

- DERIVED.plusAll: somma dei plusOne di tutta la lista.
- Scheda Ospiti, card sorgente unica: "131 ospiti in lista + 3
  accompagnatori (+1) = 134 persone".
- Dashboard, KPI RSVP: "conf / 131+3" con etichetta "in lista 131 ospiti
  e 3 accompagnatori · N a tavola".

Verifica: E2E sui testi reali (134 persone; 131+3 in Dashboard); suite
completa verde.
sw.js v49->v50; APP_BUILD 2026-07-10.9.

## Giro 73 (Claude Code) — Lato corretto nelle intestazioni dei nuclei

Bug segnalato dall'utente: ospiti "Senza nucleo" di lato Righi comparivano
sotto un'intestazione "lato Biondi". Causa: l'etichetta prendeva il lato
del PRIMO ospite del gruppo — e "Senza nucleo" contiene persone di
entrambi i lati.

Fix in viewGuests: "Senza nucleo" viene spezzato in due blocchi per lato
(· lato Righi / · lato Biondi); i nuclei veri mostrano il lato solo se è
uniforme, altrimenti "lati misti" (coerente con l'avviso qualità q_hhside).
Il filtro nasconde/mostra le intestazioni come prima (data-hh invariato).

Verifica: E2E che confronta OGNI intestazione con i lati reali delle righe
sottostanti (37 gruppi, 0 incoerenze, Senza nucleo 2 blocchi coerenti,
4 "lati misti" = i 4 nuclei dell'avviso qualità); suite completa verde.
sw.js v50->v51; APP_BUILD 2026-07-10.10.

## Giro 74 (Claude Code) — Guardia sul nucleo nuovo vuoto (caso Paolo Piraccini)

Segnalazione: un ospite messo nel nucleo "Amici famiglia Righi" appariva
"Senza nucleo". Il nome non è nel roster in codice: è un ospite aggiunto a
mano, quindi il dato vive solo nello stato sincronizzato. Trappola trovata
nel flusso: scegliendo "+ Nuovo…" per Nucleo (o Gruppo) e salvando con la
casella vuota, il salvataggio ricadeva IN SILENZIO sul default ("Senza
nucleo" / nessun gruppo) — nessun errore, dato perso.

Fix: managedOk() — con "+ Nuovo…" selezionato e casella vuota il Salva è
bloccato, toast esplicito, focus e bordo rosso sulla casella. Applicato a
Nucleo e Gruppo nella scheda ospite (la Timeline era già protetta dal
titolo obbligatorio).

Verifica: E2E — Salva bloccato con nucleo nuovo vuoto (modale resta aperta,
niente ospite salvato); scritto "Amici famiglia Righi" l'ospite finisce
sotto l'intestazione giusta col lato giusto. Suite completa verde.
Il dato di Paolo va corretto una volta a mano: matita -> Nucleo.
sw.js v51->v52; APP_BUILD 2026-07-10.11.

## Giro 75 (Claude Code) — Gruppo visibile in lista (chiarimento caso Piraccini)

Screenshot dell'utente: Paolo Piraccini ha Nucleo="Senza nucleo" e
Gruppo="Amici famiglia Righi" — NON è il bug del giro 74: i dati sono
salvati così, e la lista raggruppa per Nucleo (correttamente). La
confusione nasceva dal fatto che il Gruppo in lista era solo un puntino
colorato, invisibile su mobile.

Fix UX: il nome del gruppo appare come etichetta accanto al nome
dell'ospite (tag standard leggibile; il colore resta sul puntino).
Distinzione ribadita all'utente: Nucleo = famiglia, vincolo forte ai
tavoli (blocco); Gruppo = cerchia, affinità morbida — per gli amici è il
campo giusto.

Verifica: E2E con l'ospite ricreato come negli screenshot (tag "Amici
famiglia Righi" visibile nella riga sotto "Senza nucleo · lato Righi");
suite completa verde.
sw.js v52->v53; APP_BUILD 2026-07-10.12.

## Giro 76 (Claude Code) — Vista ospiti: per nucleo O per gruppo

Richiesta utente: poter scegliere la vista (una sola alla volta, per
leggibilità su telefono).

- Selettore "Per nucleo / Per gruppo" sopra la lista; titolo dinamico.
- Vista per gruppo: intestazioni = gruppi ("Amici famiglia Righi", Pisti,
  Testimoni...), residuo "Senza gruppo" spezzato per lato come il residuo
  della vista per nucleo; stessa logica lato uniforme/misti.
- L'etichetta accanto al nome mostra SEMPRE l'informazione nascosta dalla
  vista corrente (per nucleo -> tag gruppo; per gruppo -> tag nucleo).
- Preferenza per-dispositivo (localStorage hub_guestby), non sincronizzata.
- Ricerca e filtri RSVP invariati (le intestazioni vuote si nascondono).

Verifica: E2E — default per nucleo; switch a gruppo con Paolo Piraccini
sotto "Amici famiglia Righi · lato Righi"; persistenza al reload; filtro
con 1 riga e 1 intestazione visibili; zero overflow. Suite completa verde.
sw.js v53->v54; APP_BUILD 2026-07-10.13.

## Giro 77 (Claude Code) — Vista ospiti: default per gruppo

Richiesta utente. Il default della vista ospiti passa a "Per gruppo";
chi ha scelto esplicitamente "Per nucleo" mantiene la preferenza
(localStorage hub_guestby). E2E: default gruppo su dispositivo nuovo,
scelta nucleo persistente al reload. Suite verde.
sw.js v54->v55; APP_BUILD 2026-07-10.14.

## Giro 78 (Claude Code) — Vista per gruppo: ordine per lato e lato visibile

Richiesta utente. Nella vista "Per gruppo" le sezioni sono ordinate per
LATO (prima Righi, poi Biondi, in coda i gruppi con lati misti), a parità
di lato in ordine alfabetico; la vista "Per nucleo" resta alfabetica.
Nei gruppi a lati misti ogni riga mostra il tag del lato della persona
(nei gruppi uniformi basta l'intestazione, niente rumore).

Verifica: E2E con gruppo misto costruito ad hoc — sequenza dei ranghi di
lato non decrescente (0000111222), tag presenti su tutte le righe del
gruppo misto. Suite completa verde.
sw.js v55->v56; APP_BUILD 2026-07-10.15.

## Giro 79 (Claude Code) — Accompagnatori anche nel conteggio "In attesa"

Richiamo utente: gli accompagnatori erano stati resi visibili nei totali
di lista (giro 72) ma il KPI "In attesa" contava solo gli invitati.

- DERIVED.plusAttesa: somma dei +1 degli ospiti in attesa.
- KPI scheda Ospiti: "131 +3 · In attesa · 134 persone con gli
  accompagnatori"; card RSVP in Dashboard: "131 +3 · In attesa (134 con
  +1)". Il conteggio appare solo se ci sono +1 (niente rumore a zero).

Verifica: E2E sui testi renderizzati in entrambe le viste; suite verde.
sw.js v56->v57; APP_BUILD 2026-07-10.16.

## Giro 80 (Claude Code) — Documento catering: versione certa e più dettagli

Richiesta utente: data di estrazione ben visibile e altri dettagli utili
al catering.

- Intestazione: "generato il gg/mm/aaaa alle HH:MM · revisione disposizione
  XXXX" in grassetto. La sigla di revisione (hash djb2 su tavoli+posti)
  cambia se cambia QUALSIASI posto: due stampe con sigle diverse non sono
  la stessa disposizione. Nota esplicita su quale versione fa fede.
- Riepilogo: riga "Minimo garantito contrattuale: N coperti", in rosso il
  confronto se la disposizione attuale è sotto.
- Nuova sezione "Orari della giornata": la scaletta della Timeline
  (run-of-show) ordinata per ora — il catering sa quando servire.

Verifica: E2E print completo rieseguito (totali=oracolo, A4 senza overflow,
PDF reale rigenerato) + assert su data/ora, sigla, minimo garantito e
scaletta nel documento generato. Suite completa verde.
sw.js v57->v58; APP_BUILD 2026-07-10.17.

## Giro 81 (Claude Code) — Residuo senza nucleo/gruppo sempre in fondo

Richiesta utente: nell'ordinamento della lista ospiti, ciò che è senza
categoria/lato in relazione alla vista attiva va in fondo, fuori
dall'ordine alfabetico.

Fix in viewGuests: fbRank() porta le sezioni del contenitore residuo
("Senza gruppo" in vista per gruppo, "Senza nucleo" in vista per nucleo)
in coda, dopo tutte le sezioni con categoria; l'ordine interno delle
altre resta invariato (per gruppo: lato poi nome; per nucleo: alfabetico).
I due blocchi per lato del residuo restano in coda (prima Righi, poi
Biondi).

Verifica: E2E su entrambe le viste — le sezioni "Senza…" occupano le
ultime posizioni; suite completa verde.
sw.js v58->v59; APP_BUILD 2026-07-10.18.

## Giro 82 (Claude Code) — Limite posti per forma (serpentina/imperiale fino a 100)

Domanda utente: perché la serpentina è limitata a 40 posti. Il 40 era un
guardrail generico su TUTTE le forme, arbitrario. Per i tavoli lunghi da
banchetto (rettangolare, imperiale, serpentina) è troppo basso: arrivano
a 60-100 coperti.

seatMaxFor(shape): tondo/quadrato max 24 (limite fisico), tavoli lunghi
max 100. Il modale usa il cap per forma, con toast se si eccede; il
campo posti passa a max=100 con nota. Nessun rischio prestazioni: i
tavoli lunghi usano il modello 2-file O(n) dell'ottimizzatore.

Verifica: b2 43/43 (seatMaxFor + serpentina 60 posti che non peggiora e
resta valida); E2E: creata serpentina 60 (60 posti disegnati, ottimizza
senza errori), tondo con 60 richiesti clampato a 24. Suite verde, zero
overflow.
sw.js v59->v60; APP_BUILD 2026-07-10.19.

## Giro 83 (Claude Code) — Tavoli lunghi: serpentina avvolta, ottimizzatore, catering

Richiesta utente: supporto solido a uno-due tavoli a serpentina realistici
(20-60 posti). Studio preliminare + implementazione del piano approvato.

Ottimizzatore (studiato a fondo: su n=8 raggiungeva GIÀ l'ottimo vero
100%; il limite era solo il budget). Due migliorie:
- (a) budget scambi PER restart scalato su n² (prima condiviso 2000: a
  n>=64 i restart casuali non partivano mai) — riporta i riavvii casuali
  in gioco.
- (b) costo INCREMENTALE: uno scambio (i,j) tocca solo le coppie incidenti
  a i o j, quindi ricalcolo solo quelle (O(grado)) invece dell'intero
  costo (O(n)). seatPairCost è la fonte unica; indice posizione->coppie +
  dedup con generazione. Test di equivalenza (after == seatCost(order),
  errore < 1e-9 su 120 casi random di ogni forma) + ottimo vero su n=7 +
  ottimo-locale verificato a n=40. Tempi: n=40 15ms, n=60 32ms, n=134 123ms.

Serpentina avvolta (P1+P3): seatPositions per serpentine ora dispone i
posti a BANDE boustrophedon (righe alternate) che stanno nella larghezza
del telefono. Aspetto: da 5:1 (40 posti) a 0.7:1; da 8:1 (60) a 0.9:1;
zero sovrapposizioni. Piccole serpentine (<=16) restano una banda sola.
seatBandRectsSvg disegna uno sfondo per banda in entrambi i render.
CRITICO: l'adiacenza NON cambia (resta seatPairs 2-file) — ottimizzatore
e disposizioni esistenti intatti, nessuna migrazione. Imperiale resta
dritto (tavolo lungo classico); serpentina = compatto avvolto.

Catering (P4-A): nelle schede dei tavoli lunghi nuova colonna "Fila"
(alta/bassa = i due lati del tavolo, dal modello 2-file), con nota
"sequenza posti dall'inizio". Larghezze colonne .pt.long corrette (niente
sovrapposizione Fila/Ospite).

Verifica: b2 48/48 (equivalenza, ottimo, ottimo-locale, fila); suite
completa verde; E2E serpentina 40 avvolta (4 bande, screenshot) + 40/60
auto-assegnati 100/100 + doc catering con colonna Fila senza overflow;
regressioni print (tondi) e wizard tutte verdi.
sw.js v60->v61; APP_BUILD 2026-07-10.20.

## Giro 84 (Claude Code) — Composizione ospiti (business intelligence)

Richiesta utente: sotto "Report catering" (scheda Ospiti) un capitolo non
logistico ma STATISTICO — capire la composizione del parco invitati per
decidere su intrattenimento/servizi, con filtri/raggruppamenti.

guestStats(scope) puro (conf/attesa/tutti): coperti con +1 come adulti/
menù normale/stesso lato/stessa navetta; ripartizioni per lato, fasce
d'età (da attr.eta o ptype), gruppi ordinati per numerosità, nuclei
(quanti, max, con bambini), menù, intolleranze, navetta, stato
single/coppia/famiglia. Genera INSIGHT decisionali: bambini→animazione,
anziani→volume/accessibilità, giovani→open bar/DJ, navetta→n. bus,
menù speciali+intolleranze→conferma catering, single→socializzazione,
gruppo dominante→area dedicata.

Sezione "Composizione ospiti" in Ospiti (sotto Report catering e Navetta)
con pill scope conf/attesa/tutti e barre proporzionali colorate. Snapshot
statico "Composizione ospiti (confermati)" aggiunto anche al documento
catering (per servizi/intrattenimento).

Verifica: nuova suite stats_test 12/12 (scope, +1 nei coperti, età/menù,
gruppi, nuclei, servizi, insight, casi vuoti); suite completa verde; E2E:
sezione interattiva sul roster reale (barre lato/età/gruppi/stato/servizi/
spunti, screenshot), scope conf->attesa, zero overflow; snapshot presente
nel documento catering. Zero errori JS.
sw.js v61->v62; APP_BUILD 2026-07-10.21.

## Giro 85 (Claude Code) — Collapse lista ospiti + rifiniture BI

Richieste utente:
- Lista ospiti lunga -> tap involontari scorrendo ai riepiloghi. Aggiunto
  toggle "▲ Comprimi / ▼ Espandi" nel titolo (preferenza per-dispositivo
  hub_guestlist): da compressa mostra una card "N ospiti · lista compressa,
  tocca per espandere" — zero superficie di click accidentale.
- BI Gruppi: bottone "Vedi tutti i N gruppi / Comprimi" (STATS_GROUPS_ALL);
  prima mostrava solo i primi 8.
- Etichetta nuclei chiarita: "Nuclei familiari · il più grande: M persone"
  (il "max" era ambiguo — è la dimensione del nucleo più numeroso, non il
  numero di nuclei).
- Composizione ospiti su "tutti in lista": nuova card "Stato RSVP"
  (Confermati / In attesa / Non vengono, +1 inclusi). guestStats.rsvp.

Verifica: stats_test 13/13 (+rsvp); suite completa verde; E2E: collapse
comprime (131->0 righe) e persiste al reload; gruppi 8->12 all'espansione;
card RSVP presente su scope=all e assente su scope=confermati; zero
overflow. Zero errori JS.
sw.js v62->v63; APP_BUILD 2026-07-10.22.

## Giro 86 (Claude Code) — Scaletta condivisibile in sola lettura

Richiesta utente: rendere la scaletta condivisibile in visualizzazione ad
altri organizzatori. Studiate 3 soluzioni; scelte e implementate A+B.

A — Link read-only AUTOCONTENUTO: il cloud è dormiente, quindi niente link
"vivo" lato server. La scaletta viaggia CODIFICATA nell'URL (base64url
UTF-8 safe, ?scaletta=...): chi apre vede una pagina pulita di sola
lettura (sposi/data/location + tabella ora/momento/chi + link playlist),
su qualunque dispositivo senza login. È uno snapshot (per aggiornare si
rigenera il link). ~560 char per una scaletta tipica.
B — Stampa/PDF: "Stampa" apre un documento A4 della scaletta (come il
catering) da salvare in PDF o carta.

Pulsanti "Condividi" e "Stampa" nel titolo Scaletta. Boot: se rileva
?scaletta= mostra renderPublicScaletta (chrome dell'app nascosta, nessuna
azione di modifica). encodeScaletta/decodeScaletta puri e testati.

BUG pre-esistente corretto (emerso nell'anteprima): le ore dopo mezzanotte
ordinavano male (01:00 in cima). Nuovo comparatore rsTimeKey "giorno delle
nozze" (ore < 06:00 = notte successiva, in fondo), applicato a vista
Timeline, link condiviso e sezione orari del documento catering.

Verifica: nuova suite scaletta_test 8/8 (encode/decode round-trip con
accenti/emoji, base64url pulito, input invalido -> null, payload
ordinato/filtrato, sort giorno-nozze); suite completa verde (21 suite);
E2E: Condividi genera URL con ?scaletta=, la pagina pubblica rende
read-only (tab nascosti, nessun editRs, zero overflow), Stampa apre il
doc; ordinamento 01:00-in-fondo verificato in app. Zero errori JS.
sw.js v63->v64; APP_BUILD 2026-07-10.23.

## Giro 87 (Claude Code) — Dashboard BI: clic su un valore -> popup coi nomi

Richiesta utente: cliccando un qualsiasi valore della dashboard di business
intelligence (Composizione ospiti) aprire un popup con la lista dei nomi
corrispondenti; si chiude con la X o cliccando fuori.

Ogni barra della dashboard (Per lato, Fasce d'età, Gruppi, Stato, Servizi,
Stato RSVP) e la KPI "Persone totali" ora sono cliccabili
(data-act="statDrill" con dim/key/label). Nuova funzione pura
statMembers(scope, dim, key): ritorna i nomi dietro al valore, rispettando
il filtro attivo (confermati/in attesa/tutti). Dove il valore conta gli
accompagnatori (+N) — lato, età "Adulto", gruppi, RSVP, navetta — questi
sono annotati sul nome dell'invitato ("Anna (+2)"), così la somma delle
persone elencate coincide col numero della barra. Menù speciali/intolleranze
/accessibilità mostrano anche il dettaglio ("Mario · celiaco").

openStatDrill riusa il motore modal(): chiusura con "✕ Chiudi", con Esc e
cliccando fuori (backdrop) — già supportati da modal(). statDrill è azione
in sola lettura (READONLY_ACTS): funziona anche per gli ospiti condivisi.

Verifica: stats_test 13->20 (7 nuovi casi su statMembers: lato con +N,
età Adulto con soli accompagnatori, rsvp per scope, gruppo/senza gruppo,
servizi con dettaglio, all, nome mancante); suite completa verde (21 suite).
E2E 390px: 22 valori cliccabili, popup con 131 nomi, chiusura con X e con
clic fuori, KPI Persone totali apre l'elenco completo; zero errori JS.
sw.js v64->v65; APP_BUILD 2026-07-10.24.

## Giro 88 (Claude Code) — Budget predittivo (proiezione RSVP + minimo garantito)

Idea scelta dall'utente dopo ricerca web sui trend 2026 ("predictive
planning"). Filtrata sui vincoli reali dell'app (nessun backend, offline):
nuovo layer PREDITTIVO che si affianca al benchmark "Analisi intelligente"
già esistente, senza toccarlo.

Nuova funzione pura budgetForecast(): proietta il costo finale in base agli
RSVP reali. Le voci "a coperto" (costType perGuest) scalano col numero di
teste (accompagnatori inclusi), le fisse restano; modella il MINIMO
GARANTITO del catering (meta.minGuaranteed, finora inutilizzato in UI) sulla
voce a coperto più cara: paghi comunque N coperti anche se ne confermi meno.

Card "Proiezione & scenari" nella scheda Budget:
- semaforo verdetto (in linea / vicino al tetto / rischio sforamento) dal
  confronto proiezione peggiore vs tetto (preventivi + contingency);
- KPI costo-per-invitato confermato (tutto incluso) e catering-a-coperto;
- avviso minimo garantito: "confermati N < 170 -> M coperti a vuoto ≈ €X";
- tabella 3 scenari RSVP (Confermati / + In attesa / Previsti) con coperti,
  costo proiettato e ok/oltre-tetto per riga.
Tutte stime etichettate; nessun dato modificato.

Verifica: nuova suite budget_forecast_test 7/7 (rate/catering-max,
minimo garantito e coperti a vuoto, scenario +attesa, semaforo over/ok/na);
suite completa verde (22 suite). E2E 390px scheda Budget: sezione resa,
3 scenari ordinati, semaforo presente, KPI presenti, zero errori JS.
Numeri seed verificati a mano (0 confermati -> €63.300 per il solo minimo
garantito). sw.js v65->v66; APP_BUILD 2026-07-10.25.

## Giro 89 (Claude Code) — Voci di spesa comprimibili + proiezione più utile

Due richieste utente.

1) Voci di spesa comprimibili (come già la lista ospiti): nuovo
BUDGETLIST_OPEN (localStorage hub_budgetlist, per-dispositivo), toggle
"▲ Comprimi / ▼ Espandi" nel titolo e card "N voci · lista compressa"
cliccabile per riespandere. toggleBudgetList in READONLY_ACTS.

2) Proiezione & scenari più utile (era "poco utile"):
- Il costo a invitato ora si vede ANCHE senza conferme. Due KPI sempre
  disponibili: "costo di ogni invitato in più (a coperto)" = somma delle
  tariffe a coperto (marginale, indipendente dagli RSVP) e "costo medio a
  invitato tutto incluso" sullo scenario di riferimento (previsti > tutti in
  lista > confermati > minimo).
- Più scenari: Minimo garantito, Confermati, Metà attesa conferma, Tutti gli
  invitati, Previsti — deduplicati per numero di coperti e ordinati crescente.
- Nuova colonna "€/invitato" (medio, tutto incluso) per ogni scenario.

Verifica: budget_forecast_test 7->10 (scenario minimo a sé, metà/tutti
attesa, riferimento €/invitato = previsti, marginale sempre presente);
suite completa verde (22 suite). E2E 390px scheda Budget: comprimi/espandi
voci + persistenza al reload; colonna €/invitato, 4 scenari, KPI marginale e
medio presenti, costo a invitato mostrato anche con 0 confermati (€127);
zero errori JS. sw.js v66->v67; APP_BUILD 2026-07-10.26.

## Giro 90 (Claude Code) — Label proiezione budget auto-esplicative

Richiesta utente (dopo la domanda "come hai stimato 100€ a coperto?"):
rendere le etichette della card "Proiezione & scenari" comprensibili da sole.
Solo testi/label, nessuna logica cambiata.

- Verdetto semaforo: "In linea col budget" -> "Rientri nel budget"; "Vicino
  al tetto" -> "Vicino al budget massimo"; "Rischio sforamento" -> "Rischi di
  sforare il budget". "tetto" -> "budget massimo" ovunque.
- Intestazione: "Proiezione peggiore (N coperti): €X" -> "Nello scenario più
  caro (N coperti) spendi €X".
- KPI con spiegazione inline: "Quanto costa un invitato in più (solo voci a
  coperto)", "Costo medio a testa, tutto incluso (scenario: …)", e soprattutto
  "Prezzo del catering a coperto (preventivo ÷ ospiti previsti)" — che risponde
  direttamente al dubbio sul 100€.
- Nomi scenari discorsivi: "Se metà degli in attesa conferma", "Se confermano
  tutti gli invitati", "Solo chi ha già confermato", "Ospiti previsti".
- Tabella: colonna "Se alla fine vengono…", "Spesa totale stimata", "A testa".
- Minimo garantito: aggiunto "(li paghi anche se confermi meno persone)" e
  linguaggio più umano ("pasti pagati a vuoto").
- Nota finale riscritta come mini-guida di lettura.

Verifica: budget_forecast_test 10/10 (i test usano le chiavi scenario, non le
label -> invariati); suite completa verde (22 suite). E2E 390px scheda Budget
aggiornato alle nuove label: comprimi/espandi, colonna "a testa", 4 scenari,
KPI presenti, costo a testa con 0 confermati (€127); zero errori JS.
sw.js v67->v68; APP_BUILD 2026-07-10.27.

## Giro 91 (Claude Code) — Sottotitolo header non più tagliato

Bug segnalato dall'utente: nel banner in alto (intestazione app) il testo
veniva tagliato. Causa: .brand .sub (venue · data) aveva white-space:nowrap
+ overflow:hidden + text-overflow:ellipsis, quindi su iPhone (390px) diventava
"CASTELLO BENELLI · 1…". Fix CSS: rimosso nowrap/ellipsis, il sottotitolo ora
va a capo con clamp a 2 righe (-webkit-line-clamp:2) e letter-spacing ridotto
.16em->.14em; così un nome location lungo non gonfia l'header all'infinito.
Solo CSS, nessuna logica.

Verifica: screenshot Playwright 390px prima/dopo (prima "CASTELLO BENELLI · 1…",
dopo "CASTELLO BENELLI · 17 LUG 2027" su due righe, intero). Suite completa
verde (22 suite). sw.js v68->v69; APP_BUILD 2026-07-10.28.

## Giro 92 (Claude Code) — Header ridisegnato: compatto, più spazio all'app

Feedback utente: il fix del Giro 91 (sottotitolo su 2 righe) rendeva il banner
troppo spesso, rubando spazio utile. Ripensato il layout dell'header.

Prima: header flex-row con titolo grande (fino a 34px) che andava a capo su
2 righe + sottotitolo (nel .brand, stretto) su 2 righe -> ~126px.
Ora: header flex-column. Riga 1 (.topbar): titolo su UNA riga
(clamp 19-27px, ellipsis di sicurezza) + countdown compatto + campanella +
ingranaggio (42px). Riga 2: sottotitolo location·data a TUTTA larghezza, una
riga, senza troncamento per i contenuti tipici (ellipsis solo di sicurezza).
Countdown rimpicciolito (b 24->20, "giorni" 10px), gap e padding ridotti.
Risultato: header ~75px (da ~126), −40% di altezza, sottotitolo intero.
Solo HTML+CSS; #evSub/#evTitle/#cd invariati come id (JS non toccato); il
click "modifica intestazione" ora anche sul sottotitolo.

Verifica: screenshot 390px (nome su una riga, "CASTELLO BENELLI · 17 LUG 2027"
intero); altezza header 75px a 360/390/430; stress con nomi/location lunghi ->
ellipsis pulita, nessun overflow di pagina (docSW 391 vs 390 = 1px sub-pixel,
lo scroll orizzontale residuo è la striscia tab, preesistente e voluta). Suite
completa verde (22 suite); E2E Budget senza errori JS. sw.js v69->v70;
APP_BUILD 2026-07-10.29.

## Giro 93 (Claude Code) — Scadenzario decisioni personalizzabile (ripensato)

Richiesta utente: poter modificare lo scadenzario decisioni, versione completa,
pensata in modo olistico (non una patch). Prima: VENDOR_LEAD hardcoded, tabella
sola-lettura, e una nota "adattali pure" senza alcun controllo (promessa non
mantenuta). Ripensata l'intera parte.

Modello dati: VENDOR_LEAD resta solo come DEFAULT. La personalizzazione vive in
e.decisions[cat] = {months?, key?, date?, off?}, per-evento (sincronizzata e
salvata con lo stato; nessuna migrazione necessaria: assenza = default). Nuove
funzioni pure, unica fonte di verità per tabella E avvisi:
- decisionDefault(cat): mesi/chiave di prassi, fallback 3/no-avvisi per le
  categorie senza storico;
- decisionCats(): categorie = VCATS escluso "Altro" + eventuali custom;
- decisionCfg(cat): fonde default + override;
- decisionSet(cat, patch): salva SOLO lo scostamento (torna al default -> voce
  rimossa), tiene lo stato pulito;
- vendorDeadlines(): deadline = data manuale se presente, altrimenti data nozze
  − mesi; espone off/manual/custom oltre a deadline/status.

UI: ogni riga dello scadenzario è cliccabile -> editor per-categoria
(editDecision): mesi di anticipo, data limite manuale (priorità sui mesi),
avvisi on/off, nascondi; più "Ripristina" (per voce) e "Ripristina" globale in
testa quando ci sono personalizzazioni; "N voci nascoste" per mostrarle.
Indicatore "•" sulle voci personalizzate. Gli avvisi (motore centrale) ora
rispettano off + i mesi/chiave personalizzati.

Verifica: nuova suite decisions_test 11/11 (default/fallback, cats esclude
Altro + custom, cfg merge, deadline da mesi, override mesi, data manuale con
priorità, off, key override, stato da fornitori, decisionSet salva-solo-diff,
niente data nozze -> vuoto). Suite completa verde (23 suite). E2E 390px scheda
Fornitori: 11 categorie, "Altro" escluso, editor 4 campi, edit mesi cambia la
deadline (17 ott -> 17 lug, "12 mesi"), persistenza al reload, data manuale
"(manuale)" su Fiori, nascondi Beauty + link "voci nascoste", pulsante
Ripristina; zero errori JS. sw.js v70->v71; APP_BUILD 2026-07-10.30.

## Giro 94 (Claude Code) — Multi-evento vero + nuovo evento guidato

Domanda utente: creare un nuovo evento a matrimonio finito dev'essere organico,
facile e guidato. Verifica sul codice: NON lo era. Il vecchio newEvent() faceva
STATE=seedState() -> SOVRASCRIVEVA l'evento corrente (perdita dati salvo backup
JSON manuale); nessun elenco eventi né switch; nessuna guida dopo la creazione.
Scelta utente: "multi-evento completo". Ripensata la parte.

Nuovo modulo multi-evento (funzioni pure testabili + mutazioni su STATE.events):
- evBlank(id): evento vuoto pulito con flag fresh; evNewId() id univoci;
- eventSummary/eventIsFresh; setupSteps/setupAllDone (passi: nomi+data,
  invitati, budget, con "done" dai dati reali);
- switchEvent/duplicateEvent (deep-clone indipendente)/deleteEventById (ripunta
  l'attivo, protegge l'ultimo)/newEventBlank (ADDITIVO: aggiunge, non sostituisce;
  attiva il nuovo e apre subito l'editor intestazione = primo passo guidato).
UI: "I miei eventi" (⚙) elenca tutti gli eventi (attivo evidenziato) con
Apri/Rinomina/Duplica/Esporta(singolo)/Elimina + "+ Nuovo evento". Pannello
"Inizia da qui" sulla Dashboard, solo per eventi fresh, con i 3 passi e
scorciatoie (Imposta/Vai) + Nascondi. importEvent ora MERGE additivo (non
sostituisce più tutto lo stato). Il matrimonio attuale (rb27) non è fresh:
nessun pannello, nessun impatto.

Bug trovato e corretto in corsa: la conferma "Crea e inizia" aveva close di
default e cancellava il modale intestazione aperto da newEventBlank -> close:false.

Verifica: nuova suite event_test 10/10 (evBlank svuota+fresh, summary, fresh,
setupSteps/allDone, switch, newEventBlank additivo+guida, duplicate deep-clone,
delete ripunta+protegge ultimo). Suite completa verde (24 suite). E2E 390px:
crea nuovo evento -> vecchio archiviato -> parte l'editor nomi+data -> pannello
"inizia da qui" col passo header fatto -> "I miei eventi" mostra 2 eventi (nuovo
attivo) -> switch torna a Righi × Biondi senza pannello; zero errori JS.
sw.js v71->v72; APP_BUILD 2026-07-10.31.

## Giro 95 (Claude Code) — Backup/Importa consolidati in "I miei eventi"

Domanda utente: con l'export per-evento nuovo, "Esporta backup (tutti)" nel menu
ingranaggio serve ancora? Analisi: sì (è il backup COMPLETO di tutti gli eventi
+ impostazioni globali, unica rete di sicurezza col cloud dormiente), ma il posto
e il nome confondevano (due "esporta" sparsi). Scelta utente: consolidare.

Tolte "Esporta backup (tutti)" e "Importa" dal menu ingranaggio; spostate nel
modale "I miei eventi" come "Backup completo (tutti)" ed "Importa evento o
backup", con nota che chiarisce i tre livelli (Esporta singolo per riga / Backup
completo / Importa che unisce). importEvent ora riapre la lista aggiornata dopo
l'import. Un solo hub per creazione, apertura, export e backup. evBackupAll in
READONLY_ACTS.

Verifica: suite completa verde (24 suite). E2E 390px esteso: backup+importa
presenti dentro "I miei eventi" e ASSENTI dal menu ingranaggio; flusso completo
multi-evento invariato; zero errori JS. sw.js v72->v73; APP_BUILD 2026-07-10.32.

## Giro 96 (Claude Code) — Bandierine lingua in Gestione evento

Richiesta utente: nel menu Gestione evento, mostrare le bandierine per indicare
la lingua in uso. La voce "Lingua (IT/EN)" ora è "Lingua · 🇮🇹 ✓ / 🇬🇧"
(spunta sulla lingua attiva); toccandola cambia lingua e, con close:false +
openGear(), il menu resta aperto con la spunta spostata (feedback immediato).

Verifica: suite completa verde (24 suite). E2E 390px: entrambe le bandierine
presenti, spunta su Italiano di default, dopo il tocco spunta su English e tab
in inglese, menu resta aperto; zero errori JS. sw.js v73->v74; APP_BUILD
2026-07-10.33.

## Giro 97 (Claude Code) — Rimosso il selettore lingua (app solo IT)

Segnalazione utente: in inglese "non tutte le parole sono tradotte". Verifica
sul codice: l'i18n era una DEMO — solo le 8 etichette dei tab passavano da
t(); il ~99% dell'app è italiano hardcoded (0 chiamate t() con chiavi oltre i
tab). Layout verificato a 390px in EN: nessun overflow di pagina, nessun
troncamento (l'inglese è comunque più corto). Scelta utente tra 4 opzioni:
"togli il selettore" (l'app è per un matrimonio italiano; gli stranieri vedono
solo RSVP/scaletta pubbliche, non l'app).

Rimossa la voce lingua dal menu Gestione evento. La fondazione i18n
(appLang/t/I18N, testata da i18n_test) resta dormiente per un eventuale i18n
completo futuro, ma senza toggle utente non promette un bilinguismo assente.
Aggiunta migrateLangReset(): riporta STATE.lang a "it" (boot + pull cloud), così
chi aveva già switchato su "en" non resta bloccato coi tab in inglese.

Verifica: suite completa verde (24 suite; i18n_test 5/5 invariato). E2E 390px:
il menu non ha più il selettore; forzando lang=en nello stato e ricaricando, i
tab tornano italiani senza residui inglesi; zero errori JS. sw.js v74->v75;
APP_BUILD 2026-07-10.34.

## Giro 98 (Claude Code) — Scadenzario decisioni ordinato per data

Domanda utente: perché lo scadenzario non è in ordine di data? Verifica: era
ordinato per CATEGORIA (ordine fisso di VCATS), non per scadenza, quindi le date
saltavano. Corretto: ordino le righe per deadline crescente (la più vicina in
alto), con pareggio alfabetico sulla categoria. Solo il layer di rendering
(vendorDeadlinesCard); vendorDeadlines/avvisi invariati.

Verifica: suite completa verde (24 suite; decisions_test cerca per categoria,
indifferente all'ordine). E2E 390px: le 11 date risultano crescenti (17 lug
2026 -> 17 apr 2027); zero errori JS. sw.js v75->v76; APP_BUILD 2026-07-10.35.
