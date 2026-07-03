"use strict";
/* A2 — UI/logica aperitivo: stato stazione, creazione stazione, snapshot verdetto. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "function simRandn(";
const END = "function simRecalcThrottled(";
const EXPORTS = ["simStatusOf","simMakeStation","simSnapshot","SIM_TYPES","SIM_PALETTE"];

let evState = { sim: { stations: [], seq: 0 } };
const S = sandbox(START, END, EXPORTS, { ev: () => evState });
const r = runner("a2_test");

const G = { greenSec: 20, amberSec: 45, pNav: 0.4, welcomeTray: true, apDur: 50 };

r.ok("simStatusOf: sovraccarico (load>=servers) -> rosso", () => {
  const s = S.simStatusOf({ load: 5, servers: 5, p95: 1 }, G);
  assert.strictEqual(s.cls, "red");
  assert.strictEqual(s.txt, "Sovraccarico");
});
r.ok("simStatusOf: p95<=green -> verde Ottimo", () => {
  const s = S.simStatusOf({ load: 1, servers: 5, p95: 15 }, G);
  assert.strictEqual(s.cls, "green");
});
r.ok("simStatusOf: green<p95<=amber -> ambra", () => {
  const s = S.simStatusOf({ load: 1, servers: 5, p95: 40 }, G);
  assert.strictEqual(s.cls, "amber");
});
r.ok("simStatusOf: p95>amber -> rosso Troppo lungo", () => {
  const s = S.simStatusOf({ load: 1, servers: 5, p95: 80 }, G);
  assert.strictEqual(s.cls, "red");
  assert.strictEqual(s.txt, "Troppo lungo");
});
r.ok("simStatusOf: confine green incluso", () => {
  assert.strictEqual(S.simStatusOf({ load: 1, servers: 5, p95: 20 }, G).cls, "green");
});
r.ok("simMakeStation: tipo noto copia service/pop/welcome", () => {
  evState = { sim: { stations: [], seq: 0 } };
  const st = S.simMakeStation("Bar / Bere");
  assert.strictEqual(st.service, 25);
  assert.strictEqual(st.pop, 1.5);
  assert.strictEqual(st.welcome, true);
  assert.strictEqual(st.servers, 3);
  assert.strictEqual(st.lines, 1);
});
r.ok("simMakeStation: Personalizzata rinominata 'Nuova stazione'", () => {
  evState = { sim: { stations: [], seq: 0 } };
  const st = S.simMakeStation("Personalizzata");
  assert.strictEqual(st.name, "Nuova stazione");
});
r.ok("simMakeStation: tipo ignoto ricade su Personalizzata", () => {
  evState = { sim: { stations: [], seq: 0 } };
  const st = S.simMakeStation("Inesistente");
  assert.strictEqual(st.service, 30);
  assert.strictEqual(st.pop, 1);
});
r.ok("simMakeStation: id incrementale e colore dalla palette", () => {
  evState = { sim: { stations: [], seq: 3 } };
  const st = S.simMakeStation("Fritti");
  assert.strictEqual(st.id, 4);
  assert.strictEqual(st.color, S.SIM_PALETTE[4 % S.SIM_PALETTE.length]);
});
r.ok("simSnapshot: staff = somma servers*lines", () => {
  const R = { nNav: 10, stations: [
    { servers: 5, lines: 1, load: 1, p95: 10, name: "Bar" },
    { servers: 3, lines: 2, load: 1, p95: 12, name: "Food" }
  ]};
  const snap = S.simSnapshot(R, G, 100);
  assert.strictEqual(snap.staff, 5 * 1 + 3 * 2);
});
r.ok("simSnapshot: peggiore stazione per p95", () => {
  const R = { nNav: 10, stations: [
    { servers: 5, lines: 1, load: 1, p95: 10, name: "Bar" },
    { servers: 3, lines: 1, load: 1, p95: 30, name: "Food" }
  ]};
  const snap = S.simSnapshot(R, G, 100);
  assert.strictEqual(snap.worstName, "Food");
  assert.strictEqual(snap.worstP95, 30);
});
r.ok("simSnapshot: overload -> cls rosso", () => {
  const R = { nNav: 0, stations: [{ servers: 2, lines: 1, load: 3, p95: 5, name: "X" }] };
  const snap = S.simSnapshot(R, G, 50);
  assert.strictEqual(snap.overload, true);
  assert.strictEqual(snap.cls, "red");
});
r.ok("simSnapshot: tutto sotto soglia ideale -> verde", () => {
  const R = { nNav: 0, stations: [{ servers: 5, lines: 1, load: 1, p95: 12, name: "X" }] };
  assert.strictEqual(S.simSnapshot(R, G, 50).cls, "green");
});
r.ok("simSnapshot: riporta N e pNav in percentuale", () => {
  const R = { nNav: 0, stations: [{ servers: 5, lines: 1, load: 1, p95: 12, name: "X" }] };
  const snap = S.simSnapshot(R, G, 77);
  assert.strictEqual(snap.N, 77);
  assert.strictEqual(snap.pNav, 40);
});

r.done();
