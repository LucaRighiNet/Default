"use strict";
/* P0 — storage astratto (adapter), hardening del load, error tracking (Diag).
   Estrae il blocco DIAG+STORAGE da index.html ed esercita Store/Diag in Node
   (dove detectLocalAdapter ricade su memory). */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "const DIAG_KEY=";
const END = "/* ============ SEED";
const EXPORTS = ["Store","Diag","isValidState","makeMemoryAdapter","detectLocalAdapter"];
const S = sandbox(START, END, EXPORTS, {});

// runner locale async: le prove usano await (adapter get/set sono asincroni)
let __pass = 0, __fail = 0, __queue = [];
const r = { ok(name, fn){ __queue.push([name, fn]); } };
async function __run(){
  for (const [name, fn] of __queue){
    try { await fn(); __pass++; }
    catch (e) { __fail++; console.error("  FAIL [storage_test] " + name + " :: " + e.message); }
  }
  console.log("storage_test: " + __pass + "/" + (__pass + __fail) + (__fail ? "  (" + __fail + " FAIL)" : ""));
  if (__fail) process.exitCode = 1;
}

r.ok("detectLocalAdapter: in Node ricade su memory", () => {
  assert.strictEqual(S.detectLocalAdapter().name, "memory");
  assert.strictEqual(S.Store.backend, "memory");
});
r.ok("isValidState: forma attesa", () => {
  assert.strictEqual(S.isValidState({ events: {} }), true);
  assert.strictEqual(S.isValidState({ events: { rb27: {} } }), true);
  assert.strictEqual(S.isValidState(null), false);
  assert.strictEqual(S.isValidState({}), false);
  assert.strictEqual(S.isValidState({ events: null }), false);
  assert.strictEqual(S.isValidState("stringa"), false);
});
r.ok("round-trip: save+flush poi load restituisce lo stato", async () => {
  S.Store.save({ events: { rb27: { x: 1 } } });
  S.Store.flush();
  const s = await S.Store.load();
  assert(s && s.events && s.events.rb27 && s.events.rb27.x === 1);
});
r.ok("useAdapter: aggancia un adapter e cambia backend name (seam P1)", () => {
  const fake = { name: "remote-finto", async get(){ return null; }, async set(){}, async remove(){} };
  S.Store.useAdapter(fake);
  assert.strictEqual(S.Store.backend, "remote-finto");
});
r.ok("useAdapter: ignora un adapter senza get/set", () => {
  const before = S.Store.backend;
  S.Store.useAdapter({ name: "rotto" });
  assert.strictEqual(S.Store.backend, before);
});
r.ok("load: adapter remoto valido -> stato caricato", async () => {
  S.Store.useAdapter({ name:"r", async get(){ return JSON.stringify({ events:{ a:1 } }); }, async set(){}, async remove(){} });
  const s = await S.Store.load();
  assert(s && s.events && s.events.a === 1);
});
r.ok("hardening: JSON illeggibile -> non lancia, torna a memState, logga", async () => {
  S.Store.save({ events: { keep: 1 } });           // memState valido corrente
  const before = S.Diag.list().length;
  S.Store.useAdapter({ name:"corrotto", async get(){ return "{non json"; }, async set(){}, async remove(){} });
  const s = await S.Store.load();
  assert(s && s.events && s.events.keep === 1, "deve tornare al memState valido");
  assert(S.Diag.list().length > before, "deve loggare l'errore di storage");
  assert(S.Diag.list().some(e => e.kind === "storage"));
});
r.ok("hardening: JSON valido ma forma errata -> scartato, torna a memState", async () => {
  S.Store.save({ events: { keep2: 1 } });
  S.Store.useAdapter({ name:"forma", async get(){ return JSON.stringify({ foo: 1 }); }, async set(){}, async remove(){} });
  const s = await S.Store.load();
  assert(s && s.events && s.events.keep2 === 1);
});
r.ok("Diag: log/list/clear/exportText", () => {
  S.Diag.clear();
  assert.strictEqual(S.Diag.list().length, 0);
  S.Diag.log("error", "boom", "stack qui");
  const l = S.Diag.list();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].kind, "error");
  assert(/boom/.test(S.Diag.exportText()));
  S.Diag.clear();
  assert.strictEqual(S.Diag.list().length, 0);
});
r.ok("Diag.setReporter: il reporter riceve ogni voce loggata", () => {
  S.Diag.clear();
  const got = [];
  S.Diag.setReporter(e => got.push(e));
  S.Diag.log("cloud", "prova");
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].kind, "cloud");
  assert.strictEqual(got[0].msg, "prova");
  S.Diag.setReporter(null);
  S.Diag.log("x", "dopo-null");
  assert.strictEqual(got.length, 1, "dopo setReporter(null) non deve più ricevere");
  S.Diag.clear();
});
r.ok("Diag: buffer limitato a DIAG_MAX", () => {
  S.Diag.clear();
  for (let i = 0; i < 60; i++) S.Diag.log("error", "e" + i);
  assert(S.Diag.list().length <= 25, "atteso <=25, trovato " + S.Diag.list().length);
});

__run();
