"use strict";
/* ANALISI — target benchmark personalizzabili (lo/hi per macro-voce). */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ ANALISI: target benchmark personalizzabili ============ */";
const END = "/* ============ fine target benchmark ============ */";
const EXPORTS = ["benchTarget","benchIsCustom","benchSet"];

let evState = { benchTargets:{} };
const S = sandbox(START, END, EXPORTS, {
  ev: () => evState,
  BUDGET_BENCH: [ {id:"locat",lo:45,hi:60}, {id:"foto",lo:8,hi:12}, {id:"torta",lo:1,hi:3} ]
});
const r = runner("bench_test");

r.ok("target di default quando non personalizzato", () => {
  evState = { benchTargets:{} };
  assert.deepStrictEqual(S.benchTarget("locat"), {lo:45,hi:60});
  assert.strictEqual(S.benchIsCustom("locat"), false);
});

r.ok("override: lo/hi personalizzati e marcati custom", () => {
  evState = { benchTargets:{ foto:{lo:10,hi:15} } };
  assert.deepStrictEqual(S.benchTarget("foto"), {lo:10,hi:15});
  assert.strictEqual(S.benchIsCustom("foto"), true);
  assert.strictEqual(S.benchIsCustom("locat"), false); // altri restano default
});

r.ok("override parziale: solo hi cambia, lo resta default", () => {
  evState = { benchTargets:{ torta:{hi:5} } };
  assert.deepStrictEqual(S.benchTarget("torta"), {lo:1,hi:5});
});

r.ok("benchSet: salva solo lo scostamento; ritorno al default rimuove la voce", () => {
  evState = { benchTargets:{} };
  S.benchSet("locat", 50, 65);
  assert.deepStrictEqual(evState.benchTargets.locat, {lo:50,hi:65});
  S.benchSet("locat", 45, 60); // = default -> rimosso
  assert.strictEqual(evState.benchTargets.locat, undefined);
});

r.ok("benchSet: normalizza lo<=hi (scambia) e clampa 0-100", () => {
  evState = { benchTargets:{} };
  S.benchSet("foto", 20, 5); // invertiti -> 5..20
  assert.deepStrictEqual(evState.benchTargets.foto, {lo:5,hi:20});
  S.benchSet("foto", -10, 150); // clamp -> 0..100
  assert.deepStrictEqual(evState.benchTargets.foto, {lo:0,hi:100});
});

r.ok("benchSet: id sconosciuto ignorato senza crash", () => {
  evState = { benchTargets:{} };
  S.benchSet("boh", 10, 20);
  assert.deepStrictEqual(evState.benchTargets, {});
});

r.done();
