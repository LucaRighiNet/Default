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

run();
