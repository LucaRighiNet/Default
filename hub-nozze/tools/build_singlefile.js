"use strict";
/* Genera dist/Hub_Nozze.html: un UNICO file autosufficiente, senza riferimenti
   esterni (manifest/sw), con l'apple-touch-icon inline. Per doppio clic su
   desktop e per condivisione. La versione "hosted" (index.html + manifest.json +
   sw.js + icone) resta quella installabile come PWA completa. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// icona inline (data URI) per l'icona home su iOS quando si fa "Aggiungi a Home"
const icoB64 = fs.readFileSync(path.join(root, "apple-touch-icon.png")).toString("base64");
html = html.replace(
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  '<link rel="apple-touch-icon" href="data:image/png;base64,' + icoB64 + '">'
);
// niente manifest esterno nel file singolo (evita 404 quando distribuito da solo)
html = html.replace('<link rel="manifest" href="manifest.json">\n', '');
html = html.replace('<link rel="manifest" href="manifest.json">', '');

const outDir = path.join(root, "dist");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "Hub_Nozze.html");
fs.writeFileSync(out, html);
console.log("scritto", out, "(" + html.length + " byte)");
