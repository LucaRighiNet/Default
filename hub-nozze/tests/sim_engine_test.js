"use strict";
/* A1 — motore aperitivo: Erlang-C, p95 analitico, carico, server consigliati,
   primitive stocastiche, e struttura della simulazione Monte Carlo. */
const assert = require("assert");
const { sandbox, runner, near } = require("./_harness");

const START = "function simRandn(";
const END = "function simRecalcThrottled(";
const EXPORTS = ["simErlangC","simP95an","simLoadOf","simRecServers","simLognormal","simPoisson",
  "simulateAperitivo","SIM_REPS"];
const S = sandbox(START, END, EXPORTS, { ev: () => ({ sim: { stations: [], scenarios: [] } }) });
const r = runner("sim_engine_test");

r.ok("simErlangC: c<=a -> 1 (saturazione)", () => {
  assert.strictEqual(S.simErlangC(2, 2), 1);
  assert.strictEqual(S.simErlangC(3, 2), 1);
});
r.ok("simErlangC(1,2) = 1/3", () => {
  assert(near(S.simErlangC(1, 2), 1/3, 1e-9), "ottenuto " + S.simErlangC(1,2));
});
r.ok("simErlangC: monotona decrescente nei server", () => {
  assert(S.simErlangC(2, 3) > S.simErlangC(2, 5));
});
r.ok("simP95an: c<=a -> Infinity", () => {
  assert.strictEqual(S.simP95an(2, 2, 1), Infinity);
});
r.ok("simP95an: coda quasi assente -> 0", () => {
  assert.strictEqual(S.simP95an(0.1, 5, 1), 0);
});
r.ok("simP95an: caso normale finito e positivo", () => {
  const v = S.simP95an(1, 2, 1);
  assert(isFinite(v) && v > 0, "ottenuto " + v);
});
r.ok("simLoadOf: formula deterministica", () => {
  const s = { pop: 2, service: 30, welcome: false, lines: 1 };
  const G = { apDur: 50, welcomeTray: true };
  assert(near(S.simLoadOf(s, 100, G), 2.0, 1e-9), "ottenuto " + S.simLoadOf(s, 100, G));
});
r.ok("simLoadOf: welcome senza vassoio aggiunge 1 alla pop", () => {
  const s = { pop: 0, service: 60, welcome: true, lines: 1 };
  const G = { apDur: 60, welcomeTray: false };
  // (100*(0+1)/60/60/1)*60 = 100/60 = 1.6667
  assert(near(S.simLoadOf(s, 100, G), 100/60, 1e-9));
});
r.ok("simLoadOf: più linee riducono il carico", () => {
  const G = { apDur: 50, welcomeTray: true };
  const s1 = { pop: 2, service: 30, welcome: false, lines: 1 };
  const s2 = { pop: 2, service: 30, welcome: false, lines: 2 };
  assert(S.simLoadOf(s2, 100, G) < S.simLoadOf(s1, 100, G));
});
r.ok("simRecServers: intero in [1,14]", () => {
  const s = { pop: 2, service: 30, welcome: false, lines: 1 };
  const G = { apDur: 50, welcomeTray: true };
  const c = S.simRecServers(s, 20, 100, G);
  assert(Number.isInteger(c) && c >= 1 && c <= 14, "ottenuto " + c);
});
r.ok("simRecServers: target più severo -> servers >= ", () => {
  const s = { pop: 2, service: 30, welcome: false, lines: 1 };
  const G = { apDur: 50, welcomeTray: true };
  const loose = S.simRecServers(s, 60, 100, G);
  const tight = S.simRecServers(s, 10, 100, G);
  assert(tight >= loose, "tight " + tight + " < loose " + loose);
});
r.ok("simRecServers: target impossibile -> cap 14", () => {
  const s = { pop: 4, service: 60, welcome: false, lines: 1 };
  const G = { apDur: 30, welcomeTray: true };
  assert.strictEqual(S.simRecServers(s, 0, 300, G), 14);
});
r.ok("simPoisson: lambda<=0 -> 0", () => {
  assert.strictEqual(S.simPoisson(0), 0);
  assert.strictEqual(S.simPoisson(-1), 0);
});
r.ok("simPoisson: media campionaria ~ lambda", () => {
  let sum = 0, n = 40000;
  for (let i = 0; i < n; i++) sum += S.simPoisson(3);
  const avg = sum / n;
  assert(avg > 2.7 && avg < 3.3, "media " + avg);
});
r.ok("simLognormal: media campionaria ~ mean", () => {
  let sum = 0, n = 60000;
  for (let i = 0; i < n; i++) sum += S.simLognormal(10, 0.5);
  const avg = sum / n;
  assert(avg > 9 && avg < 11, "media " + avg);
});
r.ok("simulateAperitivo: struttura output coerente", () => {
  // Math.random seedato per riproducibilità
  const orig = Math.random;
  let seed = 123456789;
  Math.random = () => { seed = (1103515245 * seed + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  try {
    const G = { pNav:0.4, travelMean:30, sigma:10, shuttleOffset:0, unloadMin:4, welcomeTray:true, apDur:50, greenSec:20, amberSec:45 };
    const stations = [
      { id:1, name:"Bar", service:25, pop:1.5, servers:5, welcome:true, lines:1 },
      { id:2, name:"Food", service:18, pop:2, servers:3, welcome:false, lines:1 }
    ];
    const R = S.simulateAperitivo(100, stations, G, { reps: 5 });
    // simulateAperitivo ritorna un oggetto riepilogo: {nNav,nSelf,GRID,arr,nav,...,stations:[...]}
    assert(typeof R === "object" && Array.isArray(R.stations), "atteso oggetto con .stations");
    assert.strictEqual(R.stations.length, 2);
    assert(typeof R.GRID === "number" && R.GRID > 0, "GRID mancante");
    assert(Array.isArray(R.arr) && R.arr.length === R.GRID, "istogramma arrivi incoerente");
    R.stations.forEach(o => {
      assert(typeof o.p95 === "number" && o.p95 >= 0, "p95 non valido");
      assert(typeof o.load === "number" && o.load >= 0, "load non valido");
      assert(Array.isArray(o.queue) && o.queue.length > 0, "queue mancante");
    });
  } finally { Math.random = orig; }
});

r.done();
