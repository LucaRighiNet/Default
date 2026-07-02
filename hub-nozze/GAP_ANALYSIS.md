# Gap analysis — Tableau_Matrimonio.html (originale) vs Hub Nozze nativo

Confronto tra l'app tavoli originale caricata dall'utente
(`Tableau_Matrimonio.html`, ~486 KB) e la scheda Tavoli nativa dentro
`hub-nozze/index.html`. Data: 2026-07-02.

## Stato: CHIUSA

Tutti i gap funzionali (G1–G9) sono stati implementati e verificati end-to-end
(Playwright) il 2026-07-02. Resta fuori solo G10 (dati seed finti), scelta
deliberata: l'app importa i dati reali dell'utente, non ha senso gonfiare il
seed con 130 nomi inventati. Dettaglio per gap nella tabella sotto.

## In sintesi (difetto principale per primo)

Il divario più grosso non è l'algoritmo: il motore di ottimizzazione nativo
(`seatCost`/`seatOptimize`) è funzionalmente equivalente a quello originale
(`serpCost`/`optimizeSerpentine`) — stesso modello a due file serpentina, stessi
pesi face/side, stesso 2-opt, stessi vincoli together/separate. [Certain]

Il divario è nel MODELLO DEI DATI su cui l'algoritmo lavora. L'originale offre un
sistema di variabili configurabili (pesi, modalità unisci/separa, tendine di
valori, variabili personalizzate, attributi multipli per ospite); il nativo ha
solo un'affinità fissa a tre booleani (nucleo, gruppo, bambini) più le regole
esplicite. Di conseguenza l'utente non può dire "l'età conta poco, la lingua
molto, i fumatori tienili lontani": può solo mettere/togliere ospiti dallo stesso
nucleo/gruppo. Questo è il "poche variabili" segnalato dall'utente. [Certain]

Rischio se si porta tutto: il sistema variabili tocca stato (`g.attr`),
assegnazione globale (`similarity`→`binScore`) e una UI a wizard non banale;
è la voce più costosa dell'elenco. Va fatto per primo ma va isolato e testato,
non incastrato di fretta.

## Cosa è già allineato (nessun intervento)

- Algoritmo intra-tavolo: serpentina 2-opt con pesi face 0.85 / side 1.0. [Certain]
- Vincoli together/separate: presenti (regole + `seatRulesIdx`). [Certain]
- Assegnazione globale ospiti→tavoli: presente (`seatPlanAssignment`, union-find
  + bin-packing) — l'originale usa `binScore`/`placePart`, stessa idea. [Likely]
- Bambini raggruppabili: coperto via affinità meal="bambino". [Likely]
- Import ospiti da Excel/CSV: presente e più guidato dell'originale (wizard
  mappatura colonne). [Certain]
- Backup JSON export/import: presente. [Certain]

## Gap: stato di chiusura

    ID   Area                    Cosa è stato fatto                                   Stato
    ---  ----------------------  ---------------------------------------------------  ------
    G1   Variabili ottimizzatore 8 variabili (4 attive) con peso 0–20, modo           FATTO
                                 unisci/separa, tendine di valori, variabili custom;
                                 editor nel wizard passo 1. SEAT_VARS_DEF.
    G2   Attributi per ospite    g.attr{var:val}; compilazione bulk (tutti / per      FATTO
                                 gruppo / singolo) con % completamento nel wizard
                                 passo 2; tendine anche in "Modifica ospite";
                                 "Precompila dai dati" deriva nucleo/lato/età.
    G3   Wizard abbinamenti      4 passi (Variabili → Compila → Regole → Genera)      FATTO
                                 con barra passi; pulsante "Genera (guidato)".
    G4   Gruppi con colore       Pallino colorato per gruppo nella lista ospiti e     FATTO
                                 nel wizard (GUEST_GROUP_COLORS).
    G5   Temi nomi tavoli        7 temi (Numeri, Città, Fiori, Isole, Vini,           FATTO
                                 Pittori, Stelle); "Nomi tema" rinomina tutti;
                                 nuovi tavoli auto-nominati dal tema attivo.
    G6   Planimetria avanzata    Drag del tavolo sulla planimetria (coordinate SVG    FATTO*
                                 via getScreenCTM) + zoom 50–300%. Rotazione/resize/
                                 sfondo NON portati (vedi nota).
    G7   Filtri/ricerca ospiti   Chip Tutti/Confermati/In attesa/Non viene +          FATTO
                                 ricerca testo, lato client (nessuna perdita focus).
    G8   Export CSV / stampa     Export CSV (con colonne variabili) + tableau         FATTO
                                 stampabile (finestra dedicata, window.print).
    G9   Undo generazione        Snapshot pre-generazione + "Annulla" nel wizard.     FATTO
    G10  Dati seed realistici    NON fatto per scelta: l'utente importa i suoi        SALTATO
                                 dati; niente 130 nomi finti nel seed.

*G6: il drag tavolo e lo zoom sono verificati in headless (Playwright). Il drag
touch su dispositivo reale resta da confermare sul campo — è storicamente il
punto più fragile (vedi post mortem drag ospiti nel REGISTRO). Rotazione, resize
e immagine di sfondo dei tavoli non sono stati portati: sono rifiniture estetiche
a più alto rischio/beneficio marginale; da valutare solo se richiesti.

## Come funziona ora l'ottimizzatore (per chi legge il codice)

Le variabili pesate alimentano `seatSimilarity(a,b)` (somma con segno: stesso
valore su una variabile "unisci" = +peso, su una "separa" = −peso). Questa entra
in due punti:
- assegnazione globale ai tavoli (`seatPlanAssignment` con parametro `simFn`):
  ogni gruppo va sul tavolo che massimizza l'affinità con chi è già seduto,
  preferendo i tavoli che contengono tutto il gruppo;
- ordinamento dei posti dentro il tavolo (`seatAffinityFn` → `seatOptimize`):
  l'affinità booleana ora considera anche `seatSimilarity>0`.
Retrocompatibilità: `simFn` è opzionale, le firme storiche restano valide (suite
b1/b2 invariate). Nuova suite `vars_test` (11 casi) blocca il comportamento.

## Interventi già applicati in questo giro (clic minimi e guidati)

Richiesta esplicita dell'utente: editing liste a doppio clic + clic minimi su
tutta l'app. Fatto e verificato via Playwright:

- Liste: doppio clic su voce o titolo per modificare in-linea, Invio per
  aggiungere una voce, Esc per annullare. Niente più tasto "Modifica". [Certain]
- Ospiti: la pill RSVP è cliccabile e cicla Confermato → In attesa → Non viene
  in un clic (prima servivano Modifica → modale → tendina → Salva = 4 clic).
  Passando a "Non viene" libera automaticamente il posto a tavola. [Certain]
- Modali: Invio da un campo di testo conferma l'azione primaria; il bottone di
  conferma ora ha stile "primary" oro, chiaramente distinto dai secondari. Meno
  clic e più guida visiva. [Certain]

## Audit clic sul resto dell'app (dove è già minimo, dove no)

    Scheda      Stato                                              Nota
    ----------  -------------------------------------------------  --------------------------
    Dashboard   ok, sola lettura                                   nessuna azione ripetitiva
    Budget      voci via modale (Modifica)                         accettabile, edit non seriale
    Ospiti      RSVP ora 1 clic; resto via modale                  mancano filtri/ricerca (G7)
    Fornitori   via modale                                         edit non seriale, ok
    Tavoli      assegna = clic posto → lista; drag ospite          guidato; manca move/zoom (G6)
    Aperitivo   input diretti                                      già a basso attrito
    Timeline    momenti via modale (Modifica)                      candidabile a doppio clic
    Note/Liste  doppio clic in-linea                               allineato alla richiesta

Conclusione audit: dopo gli interventi di questo giro i punti ad alta frequenza
(RSVP, voci lista) sono a un clic. I residui a più clic (Budget, Fornitori,
Timeline) sono modifiche non seriali, quindi la modale è accettabile; l'unico
con ritorno concreto sarebbe estendere il doppio clic alla Timeline e aggiungere
i filtri ospiti (G7). Nessuno dei due è bloccante.
