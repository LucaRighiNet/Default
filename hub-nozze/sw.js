/* Service worker: app shell cache-first + fallback offline a index.html.
   Abilita installabilità PWA e uso offline su Chrome/Android (iOS "Aggiungi a
   Home" funziona comunque). Bump CACHE per invalidare dopo un deploy. */
const CACHE = "hub-nozze-v2"; // bump: lista invitati reale nel seed + bonifica dati test
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return resp;
    }).catch(() => caches.match("./index.html")))
  );
});
