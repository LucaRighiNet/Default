"use strict";
/* B2 — optimizer 2-opt: costo, vincoli together/separate, affinità, ottimizzazione. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const SEAT_START = "const SEAT_SHAPES=";
const SEAT_END = "/* ---- planimetria SVG nativa (B3) ---- */";
const EXPORTS = ["seatCost","seatOptimize","seatRulesIdx","seatAffinityFn","seatOptimizeTable","SEAT_CFG"];

let evState = { guests: [], tables: [], seating: { rules: [] } };
const S = sandbox(SEAT_START, SEAT_END, EXPORTS, { ev: () => evState });
const r = runner("b2_test");

const idx = (tog, sep) => ({ together: new Set(tog||[]), separate: new Set(sep||[]) });

// Lezione documentata: in ['A',,'C','D'] le posizioni 0 e 2 sono adiacenti side;
// together{A|C} dà -wNear*1.0, NON 0.
r.ok("seatCost: ['A',,'C','D'] together{A|C} = -wNear", () => {
  assert.strictEqual(S.seatCost(["A",undefined,"C","D"], 4, idx(["A|C"]), null), -S.SEAT_CFG.wNear);
});
r.ok("seatCost: ['A',,'C','D'] separate{A|C} = +wFar", () => {
  assert.strictEqual(S.seatCost(["A",undefined,"C","D"], 4, idx(null,["A|C"]), null), S.SEAT_CFG.wFar);
});
r.ok("seatCost: posti vuoti adiacenti non contano", () => {
  assert.strictEqual(S.seatCost([undefined,undefined,undefined,undefined], 4, idx(["A|C"]), null), 0);
});
r.ok("seatCost: coppia non in regole e senza affinità = 0", () => {
  assert.strictEqual(S.seatCost(["A","B","C","D"], 4, idx(), null), 0);
});
r.ok("seatCost: affinità riduce il costo", () => {
  const aff = (a,b) => (a==="A"&&b==="B")||(a==="B"&&b==="A");
  // posizioni 0,1 sono face (w0.85): A,B affini -> -wAffinity*0.85
  const c = S.seatCost(["A","B",undefined,undefined], 4, idx(), aff);
  assert(near(c, -S.SEAT_CFG.wAffinity*S.SEAT_CFG.faceWeight), "costo affinità inatteso: " + c);
  function near(x,y){ return Math.abs(x-y) < 1e-9; }
});
r.ok("seatCost: separate prevale su affinità (else-if)", () => {
  const aff = () => true;
  // separate{A|C} su posizioni adiacenti side -> +wFar (non sconto affinità)
  assert.strictEqual(S.seatCost(["A",undefined,"C",undefined], 4, idx(null,["A|C"]), aff), S.SEAT_CFG.wFar);
});
r.ok("seatOptimize: non peggiora mai (after <= before)", () => {
  const res = S.seatOptimize(["A","B","C","D"], 4, idx(["A|C"]), null);
  assert(res.after <= res.before + 1e-9);
});
r.ok("seatOptimize: avvicina una coppia together (costo finale negativo)", () => {
  // 6 posti, A e C devono stare insieme: l'ottimizzatore deve trovare un'adiacenza
  const res = S.seatOptimize(["A","B","C","D","E","F"], 6, idx(["A|C"]), null);
  assert(res.after < 0, "atteso costo finale < 0, ottenuto " + res.after);
});
r.ok("seatOptimize: separate viene allontanata (nessun +wFar residuo)", () => {
  const res = S.seatOptimize(["A","B","C","D","E","F"], 6, idx(null,["A|C"]), null);
  assert(res.after <= 0, "separate non allontanata: " + res.after);
});
r.ok("seatOptimize: ritorna order della lunghezza dei posti", () => {
  const res = S.seatOptimize(["A","B"], 4, idx(), null);
  assert.strictEqual(res.order.length, 4);
});
r.ok("seatRulesIdx: normalizza chiavi a<b e separa kind", () => {
  evState = { guests:[], seating:{ rules:[
    { a:"g2", b:"g1", kind:"together" },
    { a:"g3", b:"g4", kind:"separate" }
  ]}};
  const i = S.seatRulesIdx();
  assert(i.together.has("g1|g2"));
  assert(i.separate.has("g3|g4"));
  assert(!i.together.has("g3|g4"));
});
r.ok("seatRulesIdx: nessuna regola -> set vuoti", () => {
  evState = { guests:[], seating:{ rules:[] } };
  const i = S.seatRulesIdx();
  assert.strictEqual(i.together.size, 0);
  assert.strictEqual(i.separate.size, 0);
});
r.ok("seatAffinityFn: stesso household", () => {
  evState = { guests:[ {id:"a",household:"Rossi",meal:"adulto"}, {id:"b",household:"Rossi",meal:"adulto"} ] };
  assert.strictEqual(S.seatAffinityFn()("a","b"), true);
});
r.ok("seatAffinityFn: due bambini", () => {
  evState = { guests:[ {id:"a",household:"X",meal:"bambino"}, {id:"b",household:"Y",meal:"bambino"} ] };
  assert.strictEqual(S.seatAffinityFn()("a","b"), true);
});
r.ok("seatAffinityFn: 'Senza nucleo' non crea affinità", () => {
  evState = { guests:[ {id:"a",household:"Senza nucleo",meal:"adulto"}, {id:"b",household:"Senza nucleo",meal:"adulto"} ] };
  assert.strictEqual(S.seatAffinityFn()("a","b"), false);
});
r.ok("seatAffinityFn: gid sconosciuto -> false", () => {
  evState = { guests:[ {id:"a",household:"R",meal:"adulto"} ] };
  assert.strictEqual(S.seatAffinityFn()("a","zzz"), false);
});
r.ok("seatOptimizeTable: usa seatIds e seats del tavolo", () => {
  evState = { guests:[], seating:{ rules:["x"].length?[{a:"A",b:"C",kind:"together"}]:[] } };
  const res = S.seatOptimizeTable({ seats:6, seatIds:["A","B","C","D","E","F"] });
  assert(res.order.length === 6 && res.after <= res.before + 1e-9);
});

r.done();
