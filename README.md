# Default — app Righi

Questo repository ospita più web-app statiche **offline-first** (PWA, senza
backend: i dati restano sul dispositivo). Ogni app vive in una propria cartella
ed è pubblicata su GitHub Pages.

## App

### 🔌 Portale Fornitori Righi — [`portale-fornitori/`](portale-fornitori/)
Portale che mette in comunicazione **Righi** e i suoi **fornitori terzisti** sui
lavori di subappalto di manodopera (cablaggio e costruzione di quadri elettrici).
Pubblicazione lavori, notifiche mirate, accettazione e assegnazione, richieste
guidate al caposquadra. Vedi [`LEGGIMI`](portale-fornitori/LEGGIMI.md),
[`PIANO_PRODOTTO`](portale-fornitori/PIANO_PRODOTTO.md) e
[`BACKEND`](portale-fornitori/BACKEND.md).
_Online (dopo il merge su `main`): `…github.io/Default/portale/`._

### 💍 Hub Nozze — [`hub-nozze/`](hub-nozze/)
App di pianificazione nozze (budget, ospiti, fornitori, tavoli, timeline).
- App online: https://lucarighinet.github.io/Default/
- Istruzioni: [`hub-nozze/LEGGIMI.md`](hub-nozze/LEGGIMI.md).
- Versione single-file da condividere: `hub-nozze/dist/Hub_Nozze.html`.

## Deploy

Il deploy su GitHub Pages è automatico a ogni push su `main` e pubblica **solo i
file dell'app** (i documenti interni e i test restano nel repo ma non finiscono
sul sito):

- `hub-nozze/` → radice del sito
- `portale-fornitori/` → sotto `/portale/`

## Test

Ogni app ha la propria suite nativa Node (nessuna dipendenza esterna):

```bash
node hub-nozze/tests/run_all.js
node portale-fornitori/tests/run_all.js
```
