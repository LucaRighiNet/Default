# Gap analysis — Tableau_Matrimonio.html (originale) vs Hub Nozze nativo

Confronto tra l'app tavoli originale caricata dall'utente
(`Tableau_Matrimonio.html`, ~486 KB) e la scheda Tavoli nativa dentro
`hub-nozze/index.html`. Data: 2026-07-02.

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

## Gap prioritizzati

Priorità P1 = ciò che l'utente ha esplicitamente chiesto o che sblocca il resto.

    ID   Area                    Originale                         Nativo oggi              Prio
    ---  ----------------------  --------------------------------  -----------------------  ----
    G1   Variabili ottimizzatore 8 default + custom, peso,         affinità fissa a 3       P1
                                 modo unisci/separa, tendine       booleani, nessun peso
    G2   Attributi per ospite    g.attr{var:val}, compilazione     solo nucleo/gruppo/lato  P1
                                 bulk per gruppo, % completamento   singoli campi
    G3   Wizard abbinamenti      4 passi guidati (Variabili →      pulsanti sparsi          P2
                                 Compila → Regole → Genera)        (ottimizza/auto/regole)
    G4   Gruppi con colore       GROUPS con pallino colorato       gruppo = testo, no       P2
                                 (sposa/sposo/amici/lavoro/vip)    colore
    G5   Temi nomi tavoli        ~50 temi (città, gin, vini,       nome manuale             P3
                                 pittori…) auto-generati
    G6   Planimetria avanzata    drag tavolo, rotazione, resize,   drag ospite→posto, SVG,  P3
                                 zoom S/M/L, sfondo, elementi      auto-layout, no move/zoom
    G7   Filtri/ricerca ospiti   chip Tutti/Conf/Forse/No/Da       tabella per nucleo,      P2
                                 invitare + ricerca + ordina       nessun filtro
    G8   Export CSV / stampa     CSV ospiti + layout Tableau       solo backup JSON         P3
                                 stampabile
    G9   Undo generazione        snapshot + "annulla generazione"  nessun undo dedicato     P2
    G10  Dati seed realistici    ~130 ospiti reali                 seed piccolo (rb27)      P3

## Raccomandazione

Ordine consigliato, dal più utile al meno:

1. G1+G2 insieme (sono lo stesso pezzo): sistema variabili configurabili con
   attributi per ospite. È la richiesta dell'utente e senza questo G3 non ha
   contenuto. Stimo l'intervento più grande della lista; va isolato dietro test
   dedicati (una suite `vars_test` sul modello + `similarity`). [Guessing sulla
   stima] Prima di partire serve una conferma di scopo dall'utente: è un
   sotto-progetto, non un ritocco.
2. G7 (filtri/ricerca ospiti) e G9 (undo generazione): piccoli, alto ritorno,
   riducono i clic. Fattibili subito.
3. G4 (gruppi colorati): cosmetico ma migliora la leggibilità e prepara la
   "precompila dai gruppi" dell'originale.
4. G3 (wizard) dopo G1/G2, altrimenti è un contenitore vuoto.
5. G5/G6/G8/G10: rifiniture. G6 (drag/zoom tavoli) è la più vistosa ma anche la
   più rischiosa su touch (già pagato caro il drag ospiti); da fare solo con
   verifica su dispositivo reale, non a occhi chiusi.

Cosa NON vale la pena copiare pari-pari: la lista dei ~50 temi è graziosa ma è
tabella statica; se serve la porto in una riga, non è un gap "di prodotto".

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
