"use strict";
/* Rete di regressione PARZIALE — solo funzioni posti native (B1/B2).
   NON sostituisce le 7 suite originali (sim_engine, a2, a4, import, b1, b2,
   bisync) che non sono nel workspace. Copre ciò su cui B3 si appoggia.
   Estrae le funzioni pure da index.html col pattern new Function(...) + stub ev(),
   come prescritto dalla disciplina di test del progetto. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("const SEAT_SHAPES=");
const end = html.indexOf("function viewSeating(){");
assert(start > 0 && end > start, "blocco funzioni posti non localizzato");
const block = html.slice(start, end);

// Esporta le funzioni native; ev() iniettata come parametro (chiusura).
const make = new Function("ev",
  block +
  "\nreturn {seatColRow,seatAdjacency,seatPairs,seatFootprint,seatCost,seatOptimize," +
  "seatRng,seatShuffle,seatRulesIdx,seatAffinityFn,seatOptimizeTable,SEAT_CFG,SEAT_SHAPES};");

let evStub = () => ({ seating: { rules: [] }, guests: [], tables: [] });
const S = make((...a) => evStub(...a));

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { console.error("  FAIL " + name + " :: " + e.message); process.exitCode = 1; }
}

ok("seatColRow: pari=fila sopra, dispari=sotto, colonna=floor(idx/2)", () => {
  assert.deepStrictEqual(S.seatColRow(0), { col: 0, row: 0 });
  assert.deepStrictEqual(S.seatColRow(1), { col: 0, row: 1 });
  assert.deepStrictEqual(S.seatColRow(2), { col: 1, row: 0 });
  assert.deepStrictEqual(S.seatColRow(3), { col: 1, row: 1 });
});

ok("seatAdjacency(4): face reciproci, side per fila", () => {
  const a = S.seatAdjacency(4);
  assert.strictEqual(a[0].face, 1);
  assert.strictEqual(a[1].face, 0);
  assert.strictEqual(a[2].face, 3);
  assert.strictEqual(a[3].face, 2);
  assert.deepStrictEqual(a[0].side, [2]);
  assert.deepStrictEqual(a[1].side, [3]);
});

ok("seatPairs(4): (0,1)face.85 (2,3)face.85 (0,2)side1 (1,3)side1", () => {
  const p = S.seatPairs(4);
  const key = pr => pr.a + "-" + pr.b + "@" + pr.w;
  const set = new Set(p.map(key));
  assert.strictEqual(p.length, 4, "attese 4 coppie, trovate " + p.length);
  assert(set.has("0-1@" + S.SEAT_CFG.faceWeight), "manca (0,1) face");
  assert(set.has("2-3@" + S.SEAT_CFG.faceWeight), "manca (2,3) face");
  assert(set.has("0-2@" + S.SEAT_CFG.sideWeight), "manca (0,2) side");
  assert(set.has("1-3@" + S.SEAT_CFG.sideWeight), "manca (1,3) side");
});

ok("seatFootprint: dimensioni positive per ogni forma", () => {
  ["round", "square", "rect", "imperial", "serpentine"].forEach(shape => {
    const f = S.seatFootprint({ shape, seats: 8 });
    assert(f.w > 0 && f.h > 0 && f.lin > 0, "footprint non valido per " + shape);
  });
});

// Caso sottile B2 (lezione documentata): in ['A',undefined,'C','D'] le posizioni
// 0 e 2 sono adiacenti side; together{A|C} dà costo -wNear*1.0 = -10, NON 0.
ok("seatCost B2: ['A',,'C','D'] con together{A|C} = -10", () => {
  const rulesIdx = { together: new Set(["A|C"]), separate: new Set() };
  const cost = S.seatCost(["A", undefined, "C", "D"], 4, rulesIdx, null);
  assert.strictEqual(cost, -S.SEAT_CFG.wNear, "atteso -" + S.SEAT_CFG.wNear + ", ottenuto " + cost);
});

ok("seatCost: separate{A|C} adiacenti = +wFar", () => {
  const rulesIdx = { together: new Set(), separate: new Set(["A|C"]) };
  const cost = S.seatCost(["A", undefined, "C", "D"], 4, rulesIdx, null);
  assert.strictEqual(cost, S.SEAT_CFG.wFar);
});

ok("seatOptimize: non peggiora mai il costo (after <= before)", () => {
  // together su due persone messe lontane: l'optimizer deve migliorare o pari.
  const rulesIdx = { together: new Set(["A|C"]), separate: new Set() };
  const res = S.seatOptimize(["A", "B", "C", "D"], 4, rulesIdx, null);
  assert(res.after <= res.before + 1e-9, "after " + res.after + " > before " + res.before);
});

ok("seatRulesIdx: legge ev().seating.rules", () => {
  evStub = () => ({ seating: { rules: [{ a: "g2", b: "g1", kind: "together" }, { a: "g3", b: "g4", kind: "separate" }] } });
  const S2 = make((...a) => evStub(...a));
  const idx = S2.seatRulesIdx();
  assert(idx.together.has("g1|g2"), "chiave together normalizzata mancante");
  assert(idx.separate.has("g3|g4"), "chiave separate mancante");
  evStub = () => ({ seating: { rules: [] }, guests: [], tables: [] });
});

ok("seatAffinityFn: stesso household o due bambini = affini", () => {
  evStub = () => ({ guests: [
    { id: "g1", household: "Rossi", meal: "adulto" },
    { id: "g2", household: "Rossi", meal: "adulto" },
    { id: "g3", household: "Verdi", meal: "bambino" },
    { id: "g4", household: "Bianchi", meal: "bambino" },
    { id: "g5", household: "Senza nucleo", meal: "adulto" },
    { id: "g6", household: "Senza nucleo", meal: "adulto" }
  ] });
  const S2 = make((...a) => evStub(...a));
  const aff = S2.seatAffinityFn();
  assert.strictEqual(aff("g1", "g2"), true, "stesso household");
  assert.strictEqual(aff("g3", "g4"), true, "due bambini");
  assert.strictEqual(aff("g1", "g3"), false, "household diverso, non bambini");
  assert.strictEqual(aff("g5", "g6"), false, "'Senza nucleo' non crea affinità");
  evStub = () => ({ seating: { rules: [] }, guests: [], tables: [] });
});

console.log("\nseat_native_test: " + pass + " ok" + (process.exitCode ? " (con FAIL)" : ""));
