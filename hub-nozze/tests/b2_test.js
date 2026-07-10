"use strict";
/* B2 — optimizer 2-opt: costo, vincoli together/separate, similarità pesata (A3),
   adiacenze per forma (A2), segnaposto +1 (C4). */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const SEAT_START = "const SEAT_SHAPES=";
const SEAT_END = "/* ---- planimetria SVG nativa (B3) ---- */";
const EXPORTS = ["seatCost","seatOptimize","seatRulesIdx","seatRulesIdxAll","seatPersonSimFn","seatSimilarity",
  "seatOptimizeTable","seatPlanAssignment","SEAT_CFG","seatPairs","seatPairsFor","seatPositions",
  "seatPeople","seatPersonById","seatCompanionsOf","seatOwnerId","seatSweepStale","seatVarValueOf","seatVars",
  "seatPrintStats"];

let evState = { guests: [], tables: [], seating: { rules: [] } };
const S = sandbox(SEAT_START, SEAT_END, EXPORTS, { ev: () => evState, MEALS: ["normale","vegetariano","celiaco","vegano"] });
const r = runner("b2_test");

const idx = (tog, sep) => ({ together: new Set(tog||[]), separate: new Set(sep||[]) });
const near = (x,y) => Math.abs(x-y) < 1e-9;

// Lezione documentata: in ['A',,'C','D'] le posizioni 0 e 2 sono adiacenti side
// (modello 2-file di default); together{A|C} dà -wNear*1.0, NON 0.
r.ok("seatCost: ['A',,'C','D'] together{A|C} = -wNear", () => {
  assert.strictEqual(S.seatCost(["A",undefined,"C","D"], 4, idx(["A|C"]), null), -S.SEAT_CFG.wNear);
});
r.ok("seatCost: ['A',,'C','D'] separate{A|C} = +wFar", () => {
  assert.strictEqual(S.seatCost(["A",undefined,"C","D"], 4, idx(null,["A|C"]), null), S.SEAT_CFG.wFar);
});
r.ok("seatCost: posti vuoti adiacenti non contano", () => {
  assert.strictEqual(S.seatCost([undefined,undefined,undefined,undefined], 4, idx(["A|C"]), null), 0);
});
r.ok("seatCost: coppia non in regole e senza similarità = 0", () => {
  assert.strictEqual(S.seatCost(["A","B","C","D"], 4, idx(), null), 0);
});
r.ok("seatCost (A3): la similarità pesata REALE entra nel costo, non un binario", () => {
  const sim = (a,b) => (a==="A"&&b==="B")||(a==="B"&&b==="A") ? 16 : 0;
  // posizioni 0,1 sono face (w0.85): -16*0.85
  const c = S.seatCost(["A","B",undefined,undefined], 4, idx(), sim);
  assert(near(c, -16*S.SEAT_CFG.faceWeight), "costo similarità inatteso: " + c);
});
r.ok("seatCost: separate prevale su similarità (else-if)", () => {
  const sim = () => 99;
  assert.strictEqual(S.seatCost(["A",undefined,"C",undefined], 4, idx(null,["A|C"]), sim), S.SEAT_CFG.wFar);
});
r.ok("seatCost: le regole dominano la similarità massima (wNear > sim max ~30)", () => {
  assert(S.SEAT_CFG.wNear > 30 && S.SEAT_CFG.wFar > S.SEAT_CFG.wNear);
});
r.ok("seatCost: pairs custom rispettati (adiacenza per forma)", () => {
  // con pairs espliciti solo 0-1 conta
  const pairs=[{a:0,b:1,w:1}];
  assert.strictEqual(S.seatCost(["A","B","C","D"], 4, idx(["A|B"]), null, pairs), -S.SEAT_CFG.wNear);
  assert.strictEqual(S.seatCost(["A","C","B","D"], 4, idx(["A|B"]), null, pairs), 0);
});

// --- A2: adiacenze per forma ---
r.ok("seatPairsFor(round 8): anello chiuso — 8 coppie consecutive incluso 0-7", () => {
  const p = S.seatPairsFor({shape:"round", seats:8});
  assert.strictEqual(p.length, 8);
  const keys = new Set(p.map(x=>x.a+"-"+x.b));
  for(let i=0;i<8;i++){ const a=i, b=(i+1)%8; assert(keys.has(Math.min(a,b)+"-"+Math.max(a,b)), "manca coppia "+a+"-"+b); }
});
r.ok("seatPairsFor(round): 0-2 NON è adiacente (era il difetto del modello 2-file)", () => {
  const keys = new Set(S.seatPairsFor({shape:"round", seats:8}).map(x=>x.a+"-"+x.b));
  assert(!keys.has("0-2"));
});
r.ok("seatPairsFor(square 8): ogni posto ha vicini, nessun duplicato", () => {
  const p = S.seatPairsFor({shape:"square", seats:8});
  const seen=new Set(); const deg={};
  p.forEach(x=>{ const k=x.a+"-"+x.b; assert(!seen.has(k)); seen.add(k); deg[x.a]=(deg[x.a]||0)+1; deg[x.b]=(deg[x.b]||0)+1; });
  for(let i=0;i<8;i++) assert(deg[i]>=1, "posto "+i+" isolato");
});
r.ok("seatPairsFor(rect): identico al modello 2-file", () => {
  assert.deepStrictEqual(S.seatPairsFor({shape:"rect", seats:6}), S.seatPairs(6));
});
r.ok("seatPairsFor(round 2): una sola coppia", () => {
  assert.strictEqual(S.seatPairsFor({shape:"round", seats:2}).length, 1);
});

r.ok("seatOptimize: non peggiora mai (after <= before)", () => {
  const res = S.seatOptimize(["A","B","C","D"], 4, idx(["A|C"]), null);
  assert(res.after <= res.before + 1e-9);
});
r.ok("seatOptimize: avvicina una coppia together (costo finale negativo)", () => {
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
r.ok("seatOptimize su tonda: rispetta l'anello (together su coppia wrap 0-n-1 possibile)", () => {
  const pairs = S.seatPairsFor({shape:"round", seats:6});
  const res = S.seatOptimize(["A","B","C","D","E","F"], 6, idx(["A|F"]), null, pairs);
  assert(res.after < 0, "l'anello deve permettere A adiacente a F: " + res.after);
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

// --- A1/B1: similarità con variabili derivate dai campi nativi ---
function freshVars(){ return { rules: [] }; } // seatVars() li inizializza dai default v3
r.ok("similarità: stesso household -> +10 (nucleo derivato)", () => {
  evState = { guests:[], tables:[], seating: freshVars() };
  const s = S.seatSimilarity({household:"Rossi"},{household:"Rossi"});
  assert(s >= 10, "atteso >=10, ottenuto " + s);
});
r.ok("similarità: due bambini via ptype -> eta derivata conta (fix A1)", () => {
  evState = { guests:[], tables:[], seating: freshVars() };
  const s = S.seatSimilarity({ptype:"bambino"},{ptype:"bambino"});
  assert(s > 0, "bambini non riconosciuti: " + s);
});
r.ok("similarità: bambino vs adulto -> eta non contribuisce", () => {
  evState = { guests:[], tables:[], seating: freshVars() };
  const a = S.seatSimilarity({ptype:"bambino"},{ptype:"adulto"});
  const b = S.seatSimilarity({ptype:"adulto"},{ptype:"adulto"});
  assert(b > a, "adulto/adulto deve valere più di bambino/adulto");
});
r.ok("similarità: stesso gruppo -> ambiente derivato conta", () => {
  evState = { guests:[], tables:[], seating: freshVars() };
  const s = S.seatSimilarity({group:"Amici"},{group:"Amici"});
  assert(s > 0);
});
r.ok("similarità: 'Senza nucleo' non crea affinità di nucleo", () => {
  evState = { guests:[], tables:[], seating: freshVars() };
  // ptype diversi per azzerare il contributo dell'età: resta solo il nucleo
  const s = S.seatSimilarity({household:"Senza nucleo",ptype:"bambino"},{household:"Senza nucleo",ptype:"adulto"});
  assert.strictEqual(s, 0);
});
r.ok("seatVarValueOf: override età (Giovane) batte il derivato", () => {
  evState = { guests:[], tables:[], seating: freshVars() };
  const eta = S.seatVars().find(v=>v.id==="eta");
  assert.strictEqual(S.seatVarValueOf({ptype:"adulto", attr:{eta:"Giovane"}}, eta), "Giovane");
  assert.strictEqual(S.seatVarValueOf({ptype:"bambino"}, eta), "Bambino");
});
r.ok("seatPersonSimFn: risolve i segnaposto sul titolare; stesso titolare = forte", () => {
  evState = { guests:[{id:"g1",rsvp:"conf",household:"Rossi",plusOne:1},{id:"g2",rsvp:"conf",household:"Rossi"}], tables:[], seating: freshVars() };
  const f = S.seatPersonSimFn();
  assert(f("g1","g1#p1") >= 15, "titolare-segnaposto deve essere forte");
  assert(f("g1#p1","g2") >= 10, "il segnaposto eredita il nucleo del titolare");
});

// --- C4: segnaposto accompagnatori ---
r.ok("seatPeople: include i +1 come segnaposto (default on)", () => {
  evState = { guests:[{id:"g1",name:"Anna",rsvp:"conf",plusOne:2},{id:"g2",name:"Bea",rsvp:"no",plusOne:1}], tables:[], seating:{rules:[]} };
  const ids = S.seatPeople().map(p=>p.id);
  assert.deepStrictEqual(ids, ["g1","g1#p1","g1#p2"]); // g2 rsvp=no esclusa, e i suoi +1 pure
});
r.ok("seatPeople: con plus1=false solo ospiti reali", () => {
  evState = { guests:[{id:"g1",name:"Anna",rsvp:"conf",plusOne:2}], tables:[], seating:{rules:[], plus1:false} };
  assert.deepStrictEqual(S.seatPeople().map(p=>p.id), ["g1"]);
});
r.ok("seatPersonById: valido, oltre il plusOne -> null, owner parsing", () => {
  evState = { guests:[{id:"g1",name:"Anna",rsvp:"conf",plusOne:1}], tables:[], seating:{rules:[]} };
  assert.strictEqual(S.seatPersonById("g1#p1").name, "Anna +1");
  assert.strictEqual(S.seatPersonById("g1#p2"), null);
  assert.strictEqual(S.seatPersonById("g1").id, "g1");
  assert.strictEqual(S.seatOwnerId("g1#p2"), "g1");
  assert.strictEqual(S.seatOwnerId("g1"), "g1");
});
r.ok("seatRulesIdxAll: vincolo implicito titolare|segnaposto", () => {
  evState = { guests:[{id:"g1",rsvp:"conf",plusOne:1}], tables:[], seating:{rules:[]} };
  const i = S.seatRulesIdxAll();
  assert(i.together.has("g1|g1#p1"));
});
r.ok("seatSweepStale: libera id morti (+1 ridotti, ospite eliminato)", () => {
  evState = { guests:[{id:"g1",rsvp:"conf",plusOne:0}], tables:[{id:"t1",seats:3,seatIds:["g1","g1#p1","gDEAD"]}], seating:{rules:[]} };
  const n = S.seatSweepStale();
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(evState.tables[0].seatIds, ["g1",null,null]);
});
r.ok("seatOptimizeTable: usa seatIds e seats del tavolo", () => {
  evState = { guests:[], tables:[], seating:{ rules:[{a:"A",b:"C",kind:"together"}] } };
  const res = S.seatOptimizeTable({ seats:6, seatIds:["A","B","C","D","E","F"] });
  assert(res.order.length === 6 && res.after <= res.before + 1e-9);
});

// --- documento catering (seatPrintStats) ---
r.ok("seatPrintStats: conteggi menù/bambini per tavolo e totali", () => {
  evState = { guests:[
    {id:"a",name:"Anna",rsvp:"conf",meal:"vegetariano",ptype:"adulto",intolerances:"noci"},
    {id:"b",name:"Bea",rsvp:"conf",meal:"celiaco",ptype:"bambino"},
    {id:"c",name:"Ciro",rsvp:"conf",ptype:"adulto",plusOne:1,accessibility:"sedia rotelle"}
  ], tables:[{id:"t1",name:"Uno",shape:"round",seats:6,seatIds:["a","b","c","c#p1",null,null]}], seating:{rules:[]} };
  const st=S.seatPrintStats();
  const r1=st.rows[0];
  assert.strictEqual(r1.people.length, 4);
  assert.strictEqual(r1.meals.vegetariano, 1);
  assert.strictEqual(r1.meals.celiaco, 1);
  assert.strictEqual(r1.meals.normale, 2); // Ciro + il suo +1 (convenzione)
  assert.strictEqual(r1.bambini, 1);
  assert.strictEqual(r1.plus, 1);
  assert.deepStrictEqual(r1.intoll, ["Anna: noci"]);
  assert.deepStrictEqual(r1.acc, ["Ciro: sedia rotelle"]);
  assert.strictEqual(st.tot.seated, 4);
  assert.strictEqual(st.tot.adulti, 3);
  assert.strictEqual(st.tot.bambini, 1);
  assert.strictEqual(st.tot.intoll, 1);
});
r.ok("seatPrintStats: posti in ordine, numerazione 1-based, id morti ignorati", () => {
  evState = { guests:[{id:"a",name:"Anna",rsvp:"conf"}], tables:[{id:"t1",name:"Uno",shape:"round",seats:4,seatIds:[null,"a","gDEAD",null]}], seating:{rules:[]} };
  const st=S.seatPrintStats();
  assert.deepStrictEqual(st.rows[0].people.map(p=>[p.seat,p.name]), [[2,"Anna"]]);
});
r.ok("seatPrintStats: senza posto elencati (inclusi i +1)", () => {
  evState = { guests:[{id:"a",name:"Anna",rsvp:"conf",plusOne:1},{id:"b",name:"Bea",rsvp:"conf"}], tables:[{id:"t1",name:"Uno",shape:"round",seats:4,seatIds:["a",null,null,null]}], seating:{rules:[]} };
  const st=S.seatPrintStats();
  assert.deepStrictEqual(st.unseated.sort(), ["Anna +1","Bea"]);
});

// --- assegnazione globale ospiti->tavoli (seatPlanAssignment) ---
const tableOf = (plan, gid) => Object.keys(plan.assign).find(k => plan.assign[k].includes(gid));
r.ok("seatPlanAssignment: coppia 'insieme' finisce sullo stesso tavolo", () => {
  const tables=[{id:"t1",seats:4},{id:"t2",seats:4}];
  const guests=[{id:"a"},{id:"b"},{id:"c"},{id:"d"}];
  const plan=S.seatPlanAssignment(tables, guests, new Set(["a|b"]), new Set());
  assert.strictEqual(tableOf(plan,"a"), tableOf(plan,"b"));
});
r.ok("seatPlanAssignment: coppia 'lontano' su tavoli diversi", () => {
  const tables=[{id:"t1",seats:4},{id:"t2",seats:4}];
  const guests=[{id:"a"},{id:"b"}];
  const plan=S.seatPlanAssignment(tables, guests, new Set(), new Set(["a|b"]));
  assert.notStrictEqual(tableOf(plan,"a"), tableOf(plan,"b"));
});
r.ok("seatPlanAssignment: stesso nucleo raggruppato", () => {
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2}];
  const guests=[{id:"a",household:"Rossi"},{id:"b",household:"Rossi"},{id:"c",household:"Verdi"},{id:"d",household:"Verdi"}];
  const plan=S.seatPlanAssignment(tables, guests, new Set(), new Set());
  assert.strictEqual(tableOf(plan,"a"), tableOf(plan,"b"));
  assert.strictEqual(tableOf(plan,"c"), tableOf(plan,"d"));
});
r.ok("seatPlanAssignment: capienza insufficiente -> unseated", () => {
  const tables=[{id:"t1",seats:2}];
  const guests=[{id:"a"},{id:"b"},{id:"c"}];
  const plan=S.seatPlanAssignment(tables, guests, new Set(), new Set());
  assert.strictEqual(plan.unseated.length, 1);
});
r.ok("seatPlanAssignment: 'Senza nucleo' non raggruppa", () => {
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2}];
  const guests=[{id:"a",household:"Senza nucleo"},{id:"b",household:"Senza nucleo"},{id:"c",household:"Senza nucleo"},{id:"d",household:"Senza nucleo"}];
  const plan=S.seatPlanAssignment(tables, guests, new Set(), new Set());
  const total=Object.keys(plan.assign).reduce((n,k)=>n+plan.assign[k].length,0);
  assert.strictEqual(total, 4);
});
r.ok("seatPlanAssignment: titolare e segnaposto +1 sullo stesso tavolo (via regola implicita)", () => {
  evState = { guests:[{id:"a",rsvp:"conf",plusOne:1},{id:"b",rsvp:"conf"},{id:"c",rsvp:"conf"}], tables:[], seating:{rules:[]} };
  const people=S.seatPeople();
  const i=S.seatRulesIdxAll();
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2}];
  const plan=S.seatPlanAssignment(tables, people, i.together, i.separate, S.seatPersonSimFn());
  assert.strictEqual(tableOf(plan,"a"), tableOf(plan,"a#p1"));
});

r.done();
