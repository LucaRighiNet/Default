"use strict";
/* Seam di sync (RemoteAdapter): contratto pull/push/conflict del backend futuro.
   Sync è dormiente finché enable(); il remote di riferimento è makeMemoryRemote,
   che il backend reale (BACKEND.md) deve replicare fedelmente. */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "/* ============================ Utility";
const END   = "/* ============================ Render";
const S = sandbox(START, END, ["Sync","makeMemoryRemote","STATE"], {});

let pass = 0, fail = 0, q = [];
const ok = (name, fn) => q.push([name, fn]);

ok("makeMemoryRemote: pull null iniziale", async () => {
  const r = S.makeMemoryRemote();
  assert.strictEqual(await r.pull(), null);
});
ok("makeMemoryRemote: push incrementa la versione", async () => {
  const r = S.makeMemoryRemote();
  const p1 = await r.push(0, '{"v":1}');
  assert.deepStrictEqual(p1, { ok: true, version: 1 });
  const got = await r.pull();
  assert.strictEqual(got.version, 1);
  assert.strictEqual(got.data, '{"v":1}');
});
ok("makeMemoryRemote: baseVersion stale → conflict", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, "A");            // → v1
  const c = await r.push(0, "B");  // base 0 != 1 → conflict
  assert.strictEqual(c.conflict, true);
  assert.strictEqual(c.version, 1);
  assert.strictEqual(c.data, "A");
});
ok("Sync: dormiente → pull null senza remote", async () => {
  assert.strictEqual(await S.Sync.pull(), null);
});
ok("Sync.enable + pull: adotta lo stato dal remote", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, JSON.stringify({ jobs: [{ id: "z" }] }));
  S.Sync.enable(r);
  const st = await S.Sync.pull();
  assert(st && st.jobs[0].id === "z");
});
ok("Sync.push: pubblica lo stato locale e allinea la versione", async () => {
  const r = S.makeMemoryRemote();
  S.Sync.enable(r);
  const res = await S.Sync.push();
  assert(res && res.ok === true && res.version === 1);
  const got = await r.pull();
  assert(got && JSON.parse(got.data).jobs, "lo stato deve contenere i lavori del seed");
});

(async () => {
  for (const [n, f] of q) { try { await f(); pass++; } catch (e) { fail++; console.error("  FAIL [sync_test] " + n + " :: " + e.message); } }
  console.log("sync_test: " + pass + "/" + (pass + fail) + (fail ? "  (" + fail + " FAIL)" : ""));
  if (fail) process.exitCode = 1;
})();
