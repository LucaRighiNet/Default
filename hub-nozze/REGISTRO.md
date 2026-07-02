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
