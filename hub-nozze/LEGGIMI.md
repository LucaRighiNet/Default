# Hub Nozze — come lanciarlo

Hai due artefatti:
- `dist/Hub_Nozze.html` — UN SOLO file, autosufficiente. Per il desktop e per la
  condivisione (email, AirDrop, chiavetta).
- `index.html` + `manifest.json` + `sw.js` + icone — la versione "hosted",
  installabile come PWA completa (offline + icona), da mettere su un URL.

## Desktop (Windows / Mac / Linux) — il più semplice
1. Prendi `dist/Hub_Nozze.html`.
2. Doppio clic: si apre nel browser e funziona. I dati si salvano nel browser
   (localStorage) legati a quel file.
Suggerimento "app-like": aprilo in Chrome/Edge e usa "Installa app" (menu ...) per
averlo come finestra dedicata; oppure aggiungilo ai preferiti.
Nota: per un doppio clic pulito usa Chrome/Edge/Firefox. Con Safari desktop va
bene aprirlo dal browser.

## iPhone / iPad — serve un URL (limite di iOS, non del codice)
iOS NON esegue JavaScript da un file locale (Files/Quick Look lo bloccano):
toccare il file NON avvia l'app. Il percorso corretto è aprirlo in Safari da un
indirizzo web e poi "Aggiungi a Home".

Modo consigliato (gratis): GitHub Pages.
1. Su GitHub: Settings -> Pages -> Source = "GitHub Actions".
2. Il workflow `.github/workflows/pages.yml` pubblica la cartella `hub-nozze/`.
   Otterrai un URL tipo `https://<utente>.github.io/<repo>/`.
3. Su iPhone: apri quell'URL in Safari -> Condividi -> "Aggiungi a Home".
   Ora hai l'icona, funziona offline (service worker) e i dati restano sul telefono.

Alternativa senza hosting: sulla stessa rete Wi-Fi, dal desktop nella cartella
`hub-nozze/` esegui `python3 -m http.server 8000`, poi su iPhone apri
`http://<ip-del-desktop>:8000/index.html` in Safari -> "Aggiungi a Home".

## Persistenza — importante
- I dati vivono nel dispositivo/browser dove apri l'app. Non si sincronizzano tra
  desktop e iPhone finché non colleghi il backend cloud (vedi BACKEND_P1.md).
- Su iPhone la persistenza è affidabile SOLO come app "Aggiungi a Home" usata con
  una certa regolarità (iOS può cancellare i dati di pagine non installate).
- Fai ogni tanto un backup: ingranaggio -> "Esporta" (scarica un JSON), e
  "Importa" per ripristinarlo.

## Rigenerare il file singolo
Dopo modifiche a `index.html`:  `node tools/build_singlefile.js`
