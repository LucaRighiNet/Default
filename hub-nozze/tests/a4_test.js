"use strict";
/* A4 — scenari aperitivo: id incrementale, salvataggio, caricamento, eliminazione. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "function simRandn(";
const END = "function simIOMsg(";
const EXPORTS = ["simNextScenId","simSaveScenario","simSeedExamples","simLoadScenario","simDelScenario"];

let evState;
const reset = () => { evState = {
  sim: {
    G: { pNav:0.4, travelMean:30, sigma:10, shuttleOffset:0, unloadMin:4, welcomeTray:true, apDur:50, greenSec:20, amberSec:45 },
    stations: [ { id:1, name:"Bar", service:25, pop:1.5, servers:5, welcome:true, lines:1 } ],
    scenarios: [], seq: 1, seqS: 0
  }
}; };
reset();

const S = sandbox(START, END, EXPORTS, {
  ev: () => evState,
  meta: () => ({ plannedGuests: 100 }),
  $: () => null,
  Store: { save() {} },
  STATE: {},
  toast: () => {},
  commit: () => {}
});
const r = runner("a4_test");

r.ok("simNextScenId: parte da 1 su lista vuota", () => {
  reset();
  assert.strictEqual(S.simNextScenId(), 1);
});
r.ok("simNextScenId: prosegue dal max id esistente", () => {
  reset();
  evState.sim.scenarios = [{ id: 5 }, { id: 2 }];
  evState.sim.seqS = 0;
  assert.strictEqual(S.simNextScenId(), 6);
});
r.ok("simNextScenId: incrementi successivi unici", () => {
  reset();
  const a = S.simNextScenId(), b = S.simNextScenId(), c = S.simNextScenId();
  assert(a < b && b < c);
});
r.ok("simSaveScenario: aggiunge uno scenario con snap e config", () => {
  reset();
  S.simSaveScenario();
  assert.strictEqual(evState.sim.scenarios.length, 1);
  const sc = evState.sim.scenarios[0];
  assert(typeof sc.id === "number");
  assert(sc.snap && ["green","amber","red"].includes(sc.snap.cls));
  assert(sc.config && Array.isArray(sc.config.stations) && sc.config.G);
});
r.ok("simSaveScenario: nome autogenerato se input assente", () => {
  reset();
  S.simSaveScenario();
  assert(typeof evState.sim.scenarios[0].name === "string" && evState.sim.scenarios[0].name.length > 0);
});
r.ok("simLoadScenario: ripristina G e stazioni dal config (round-trip)", () => {
  reset();
  S.simSaveScenario();
  const id = evState.sim.scenarios[0].id;
  // muta lo stato corrente
  evState.sim.G.apDur = 999;
  evState.sim.stations = [];
  S.simLoadScenario(id);
  assert.strictEqual(evState.sim.G.apDur, 50, "apDur non ripristinato");
  assert.strictEqual(evState.sim.stations.length, 1, "stazioni non ripristinate");
});
r.ok("simLoadScenario: id inesistente non altera lo stato", () => {
  reset();
  evState.sim.G.apDur = 50;
  S.simLoadScenario(12345);
  assert.strictEqual(evState.sim.G.apDur, 50);
});
r.ok("simDelScenario: rimuove per id", () => {
  reset();
  evState.sim.scenarios = [{ id:1, snap:{}, config:{} }, { id:2, snap:{}, config:{} }];
  S.simDelScenario(1);
  assert.deepStrictEqual(evState.sim.scenarios.map(s => s.id), [2]);
});
r.ok("simSeedExamples: aggiunge due scenari di esempio", () => {
  reset();
  S.simSeedExamples();
  assert.strictEqual(evState.sim.scenarios.length, 2);
  assert(evState.sim.scenarios.every(s => s.snap && s.config));
});

r.done();
