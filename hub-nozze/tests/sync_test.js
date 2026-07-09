"use strict";
/* P1 groundwork — scaffolding di sync: RemoteAdapter (mock), versioni, conflitti.
   Sync è dormiente finché enable(); qui lo abilitiamo su un remote in memoria. */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "const DIAG_KEY=";
const END = "/* ============ SEED";
const EXPORTS = ["Sync","makeMemoryRemote"];
const S = sandbox(START, END, EXPORTS, {});

let __pass = 0, __fail = 0, __q = [];
const ok = (name, fn) => __q.push([name, fn]);
async function run(){
  for (const [n, f] of __q){ try{ await f(); __pass++; } catch(e){ __fail++; console.error("  FAIL [sync_test] " + n + " :: " + e.message); } }
  console.log("sync_test: " + __pass + "/" + (__pass + __fail) + (__fail ? "  (" + __fail + " FAIL)" : ""));
  if (__fail) process.exitCode = 1;
}

ok("Sync: dormiente di default (isEnabled false)", () => {
  assert.strictEqual(S.Sync.isEnabled(), false);
});
ok("Sync.notify dormiente non tocca il remote", async () => {
  S.Sync.disable();
  const r = S.makeMemoryRemote();
  S.Sync.notify({ a: 1 });      // enabled=false -> no-op
  const pulled = await r.pull();
  assert.strictEqual(pulled, null);
});
ok("makeMemoryRemote: pull null iniziale, push incrementa versione", async () => {
  const r = S.makeMemoryRemote();
  assert.strictEqual(await r.pull(), null);
  const p1 = await r.push(0, '{"v":1}');
  assert.deepStrictEqual(p1, { ok: true, version: 1 });
  const got = await r.pull();
  assert.strictEqual(got.version, 1);
  assert.strictEqual(got.data, '{"v":1}');
});
ok("makeMemoryRemote: push con baseVersion stale -> conflict", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, "A");                 // -> v1
  const c = await r.push(0, "B");       // base 0 != 1 -> conflict
  assert.strictEqual(c.conflict, true);
  assert.strictEqual(c.version, 1);
  assert.strictEqual(c.data, "A");
});
ok("Sync.enable + flush: pubblica lo stato e allinea la versione", async () => {
  const r = S.makeMemoryRemote();
  S.Sync.enable(r);
  await S.Sync.flush({ events: { x: 1 } });
  assert.strictEqual(S.Sync.version(), 1);
  const got = await r.pull();
  assert(got && JSON.parse(got.data).events.x === 1);
  S.Sync.disable();
});
ok("Sync.pull: adotta versione e stato dal remote", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, JSON.stringify({ events: { y: 9 } }));   // remote a v1
  S.Sync.enable(r);
  const st = await S.Sync.pull();
  assert(st && st.events.y === 9);
  assert.strictEqual(S.Sync.version(), 1);
  S.Sync.disable();
});
ok("Sync: conflitto invoca il resolver onConflict", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, "iniziale");                 // remote v1
  let seen = null;
  S.Sync.enable(r, { version: 0, onConflict: (res) => { seen = res; } }); // base disallineata (0)
  await S.Sync.flush({ events: { z: 1 } });     // base 0 != 1 -> conflict -> resolver
  assert(seen && seen.conflict === true && seen.version === 1);
  S.Sync.disable();
});
ok("Sync: senza resolver, last-writer-wins (locale sovrascrive)", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, "vecchio");                    // remote v1
  S.Sync.enable(r, { version: 0 });              // base disallineata -> conflict, poi ri-push
  await S.Sync.flush({ events: { w: 7 } });
  const got = await r.pull();
  assert(JSON.parse(got.data).events.w === 7, "il locale deve aver vinto");
  S.Sync.disable();
});

// --- stato, notifica, retry offline ---
ok("Sync.getStatus: 'local' da spento, 'synced' dopo enable", () => {
  S.Sync.disable();
  assert.strictEqual(S.Sync.getStatus(), "local");
  S.Sync.enable(S.makeMemoryRemote());
  assert.strictEqual(S.Sync.getStatus(), "synced");
  S.Sync.disable();
});
ok("Sync: onStatus notifica le transizioni (syncing -> synced)", async () => {
  const seen = [];
  const r = S.makeMemoryRemote();
  S.Sync.enable(r, { onStatus: s => seen.push(s) });
  await S.Sync.flush({ events: { a: 1 } });
  assert(seen.indexOf("syncing") >= 0 && seen.indexOf("synced") >= 0, "transizioni: " + seen.join(","));
  S.Sync.disable();
});
ok("Sync: conflitto -> status 'conflict' + onConflict, poi 'synced' (LWW)", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, "remoto");                      // remote v1
  let notified = false;
  S.Sync.enable(r, { version: 0, onConflict: () => { notified = true; } });
  await S.Sync.flush({ events: { x: 1 } });        // base 0 != 1 -> conflict -> LWW
  assert.strictEqual(notified, true);
  assert.strictEqual(S.Sync.getStatus(), "synced"); // risolto
  assert(JSON.parse((await r.pull()).data).events.x === 1);
  S.Sync.disable();
});
// --- LWW deterministico per timestamp (_savedAt) ---
ok("Conflitto: il remoto PIU' RECENTE vince (onRemoteWin, niente sovrascrittura)", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, JSON.stringify({ _savedAt: 2000, events: { src: "remoto" } })); // remote v1, recente
  let won = null;
  S.Sync.enable(r, { version: 0, onRemoteWin: (st) => { won = st; } });
  await S.Sync.flush({ _savedAt: 1000, events: { src: "locale" } });               // locale piu' vecchio
  assert(won && won.events.src === "remoto", "doveva vincere il remoto piu' recente");
  const got = await r.pull();
  assert.strictEqual(JSON.parse(got.data).events.src, "remoto", "il remoto non deve essere sovrascritto");
  assert.strictEqual(S.Sync.getStatus(), "synced");
  S.Sync.disable();
});
ok("Conflitto: il locale PIU' RECENTE vince (ripubblica)", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, JSON.stringify({ _savedAt: 1000, events: { src: "remoto" } })); // remote v1, vecchio
  let won = null;
  S.Sync.enable(r, { version: 0, onRemoteWin: (st) => { won = st; } });
  await S.Sync.flush({ _savedAt: 2000, events: { src: "locale" } });               // locale piu' recente
  assert.strictEqual(won, null, "onRemoteWin non deve scattare se vince il locale");
  const got = await r.pull();
  assert.strictEqual(JSON.parse(got.data).events.src, "locale", "il locale piu' recente deve vincere");
  S.Sync.disable();
});
ok("syncNow: adotta lo stato remoto se la versione e' avanzata", async () => {
  const r = S.makeMemoryRemote();
  let won = null;
  S.Sync.enable(r, { version: 0, onRemoteWin: (st) => { won = st; } });
  await r.push(0, JSON.stringify({ _savedAt: 5, events: { m: 42 } }));  // un altro device pubblica v1
  await S.Sync.syncNow();
  assert(won && won.events.m === 42, "syncNow deve adottare il remoto piu' avanti");
  assert.strictEqual(S.Sync.version(), 1);
  S.Sync.disable();
});
ok("syncNow: senza avanzamenti non tocca nulla", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, JSON.stringify({ _savedAt: 5, events: { m: 1 } }));   // v1
  let won = null;
  S.Sync.enable(r, { version: 1, onRemoteWin: (st) => { won = st; } }); // gia' allineato a v1
  await S.Sync.syncNow();
  assert.strictEqual(won, null, "nessun avanzamento -> nessuna adozione");
  S.Sync.disable();
});
ok("Sync: push fallita -> 'offline' + pending, retry ripubblica", async () => {
  let failNext = true;
  const remote = {
    name: "flaky",
    pull(){ return Promise.resolve(null); },
    push(base, data){ if(failNext){ return Promise.reject(new Error("network")); } return Promise.resolve({ ok:true, version: base+1 }); }
  };
  S.Sync.enable(remote);
  await S.Sync.flush({ events: { z: 5 } });         // fallisce -> offline
  assert.strictEqual(S.Sync.getStatus(), "offline");
  assert.strictEqual(S.Sync.hasPending(), true);
  failNext = false;
  await S.Sync.retry();                             // rete tornata
  assert.strictEqual(S.Sync.getStatus(), "synced");
  assert.strictEqual(S.Sync.hasPending(), false);
  S.Sync.disable();
});


// --- prestazioni: head condizionale, anti-doppione, niente upload fotocopia ---
ok("syncNow con head: nessuna novita' -> NON scarica il documento", async () => {
  let headN=0, pullN=0;
  const remote={ name:"spy",
    head(){ headN++; return Promise.resolve({version:1}); },
    pull(){ pullN++; return Promise.resolve({version:1, data:"{}"}); },
    push(b,d){ return Promise.resolve({ok:true, version:b+1}); } };
  S.Sync.enable(remote, { version: 1 });
  await S.Sync.syncNow();
  assert.strictEqual(headN, 1, "head non chiamata");
  assert.strictEqual(pullN, 0, "documento scaricato inutilmente");
  assert.strictEqual(S.Sync.getStatus(), "synced");
  S.Sync.disable();
});
ok("syncNow con head: versione avanzata -> scarica e adotta", async () => {
  let won=null;
  const remote={ name:"spy2",
    head(){ return Promise.resolve({version:2}); },
    pull(){ return Promise.resolve({version:2, data:JSON.stringify({_savedAt:5, events:{m:7}})}); },
    push(b,d){ return Promise.resolve({ok:true, version:b+1}); } };
  S.Sync.enable(remote, { version: 1, onRemoteWin: st=>{ won=st; } });
  await S.Sync.syncNow();
  assert(won && won.events.m===7, "doveva adottare il remoto avanzato");
  assert.strictEqual(S.Sync.version(), 2);
  S.Sync.disable();
});
ok("syncNow: anti-doppione (focus+visibility insieme -> UN solo controllo)", async () => {
  let headN=0;
  const remote={ name:"spy3",
    head(){ headN++; return Promise.resolve({version:1}); },
    pull(){ return Promise.resolve(null); },
    push(b,d){ return Promise.resolve({ok:true, version:b+1}); } };
  S.Sync.enable(remote, { version: 1 });
  await Promise.all([S.Sync.syncNow(), S.Sync.syncNow(), S.Sync.syncNow()]);
  assert.strictEqual(headN, 1, "controlli ravvicinati non deduplicati: "+headN);
  S.Sync.disable();
});
ok("notify/flush: contenuto identico all'ultimo sincronizzato -> NESSUN upload", async () => {
  let pushN=0;
  const remote={ name:"spy4",
    head(){ return Promise.resolve({version:pushN}); },
    pull(){ return Promise.resolve(null); },
    push(b,d){ pushN++; return Promise.resolve({ok:true, version:b+1}); } };
  S.Sync.enable(remote, { version: 0, debounceMs: 100 });
  await S.Sync.flush({ _savedAt: 100, events: { x: 1 } });   // primo push reale
  assert.strictEqual(pushN, 1);
  // stesso contenuto, solo il timbro cambia (l'echo dopo un'adozione/merge)
  await S.Sync.flush({ _savedAt: 999, events: { x: 1 } });
  assert.strictEqual(pushN, 1, "upload fotocopia non evitato (flush)");
  S.Sync.notify({ _savedAt: 1234, events: { x: 1 } });
  await new Promise(r=>setTimeout(r, 600));
  assert.strictEqual(pushN, 1, "upload fotocopia non evitato (notify)");
  // contenuto DAVVERO diverso -> push regolare
  await S.Sync.flush({ _savedAt: 2000, events: { x: 2 } });
  assert.strictEqual(pushN, 2, "il push reale non deve essere bloccato");
  assert.strictEqual(S.Sync.getStatus(), "synced");
  S.Sync.disable();
});

// --- raffiche di modifiche: un solo push in volo, coalescing, chip calmo ---
ok("push in volo + raffica di notify -> UN solo upload aggiuntivo, ultimo contenuto, zero conflitti", async () => {
  let pushes=[], version=0;
  const remote={ name:"slow",
    pull(){ return Promise.resolve(null); },
    push(base, data){ return new Promise(res=>setTimeout(()=>{ 
      if(base!==version){ res({conflict:true, version, data:pushes[pushes.length-1]||"{}"}); return; }
      pushes.push(data); version++; res({ok:true, version}); }, 120)); } };
  S.Sync.enable(remote, { version: 0, debounceMs: 20 });
  const p1=S.Sync.flush({ _savedAt: 1, events: { n: 1 } });   // parte il volo (120ms)
  await new Promise(r=>setTimeout(r, 30));
  S.Sync.notify({ _savedAt: 2, events: { n: 2 } });            // durante il volo
  await new Promise(r=>setTimeout(r, 30));
  S.Sync.notify({ _savedAt: 3, events: { n: 3 } });            // ancora durante il volo
  await p1;
  await new Promise(r=>setTimeout(r, 400));                    // tempo per lo sgancio della coda
  assert.strictEqual(pushes.length, 2, "attesi 2 upload (iniziale + coalescato), fatti: "+pushes.length);
  assert.strictEqual(JSON.parse(pushes[1]).events.n, 3, "l'upload coalescato deve portare l'ULTIMO contenuto");
  assert.strictEqual(S.Sync.getStatus(), "synced");
  assert.strictEqual(S.Sync.hasPending(), false);
  S.Sync.disable();
});
ok("displayStatus: push lampo non mostra 'Sincronizzo', push lungo si'", async () => {
  const remote={ name:"slow2",
    pull(){ return Promise.resolve(null); },
    push(base, data){ return new Promise(res=>setTimeout(()=>res({ok:true, version: base+1}), 200)); } };
  S.Sync.enable(remote, { version: 0, graceMs: 80 });
  const p=S.Sync.flush({ _savedAt: 1, events: { q: 1 } });
  await new Promise(r=>setTimeout(r, 10));
  assert.strictEqual(S.Sync.getStatus(), "syncing", "stato reale");
  assert.strictEqual(S.Sync.displayStatus(), "synced", "sotto soglia il chip resta calmo");
  await new Promise(r=>setTimeout(r, 120));
  assert.strictEqual(S.Sync.displayStatus(), "syncing", "oltre soglia il chip informa");
  await p;
  assert.strictEqual(S.Sync.displayStatus(), "synced");
  S.Sync.disable();
});

run();