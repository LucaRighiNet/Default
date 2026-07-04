/* Service worker.
   - Navigazione (index.html): NETWORK-FIRST -> quando sei online prendi sempre
     l'ultima versione dell'app; offline usi la copia in cache. Così un deploy
     nuovo arriva da solo al prossimo avvio, senza dover svuotare la cache.
   - Asset statici (icone, manifest): cache-first (veloci, cambiano di rado).
   Bump CACHE a ogni release per ripulire le versioni vecchie. */
const CACHE = "hub-nozze-v15"; // bump: evidenziazione riga dagli avvisi
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
function isNav(req){ return req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") >= 0; }
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (isNav(e.request)) {
    // network-first: prova la rete, aggiorna la cache; se offline ricadi sulla cache
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy));
        return resp;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }
  // cache-first per gli asset statici
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return resp;
    }).catch(() => caches.match("./index.html")))
  );
});
