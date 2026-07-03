# Hub Nozze

App di pianificazione nozze (budget, ospiti, fornitori, tavoli, timeline).
PWA offline-first, senza backend: i dati restano sul dispositivo.

- App online: https://lucarighinet.github.io/Default/
- Codice e istruzioni: cartella [`hub-nozze/`](hub-nozze/) — vedi
  [`hub-nozze/LEGGIMI.md`](hub-nozze/LEGGIMI.md) per l'avvio su desktop e iPhone.
- Versione single-file da condividere: `hub-nozze/dist/Hub_Nozze.html`.

## Struttura

| Percorso | Contenuto |
|---|---|
| `hub-nozze/index.html` | L'app (versione hosted/PWA) |
| `hub-nozze/dist/` | Versione a file singolo, autosufficiente |
| `hub-nozze/legal/` | Privacy, cookie, termini |
| `hub-nozze/tests/` | Suite di test (CI: `node tests/run_all.js`) |
| `hub-nozze/tools/` | Build del file singolo |
| `hub-nozze/*.md` | Documentazione interna di sviluppo |

Il deploy su GitHub Pages è automatico a ogni push su `main` e pubblica solo i
file dell'app (i documenti interni e i test non finiscono sul sito).
