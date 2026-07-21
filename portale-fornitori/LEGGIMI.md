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
- **Dashboard**: lavori pubblicati/assegnati, **ritardi**, accettazioni da
  valutare, richieste dei fornitori.
- **Lavori**: pipeline a **bacheca Kanban** o elenco; apri una scheda per
  pubblicare, **notificare** fornitori, **assegnare**.
- **Nuovo lavoro**: form a input guidati (tipologia, settore, carpenteria come
  chip; layout allegabile; budget, date, caposquadra; visibilità *tutti /
  selezionati*).
- **Richieste** e anagrafica **Fornitori** accreditati.

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
