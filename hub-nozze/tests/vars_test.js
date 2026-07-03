"use strict";
/* VARS — variabili configurabili (G1) + similarità pesata (G2) + assegnazione
   guidata da simFn. Estrae le funzioni seat native dallo <script>. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const SEAT_START = "const SEAT_SHAPES=";
const SEAT_END = "/* ---- planimetria SVG nativa (B3) ---- */";
const EXPORTS = ["seatSimilarity","seatActiveVars","seatVars","seatVarById","seatPlanAssignment","SEAT_VARS_DEF"];

let evState = { guests: [], tables: [], seating: { rules: [] } };
const S = sandbox(SEAT_START, SEAT_END, EXPORTS, { ev: () => evState });
const r = runner("vars_test");

function setVars(vars){ evState = { guests: [], tables: [], seating: { rules: [], vars: vars } }; }

r.ok("SEAT_VARS_DEF: 8 variabili, 4 attive di default", () => {
  assert.strictEqual(S.SEAT_VARS_DEF.length, 8);
  assert.strictEqual(S.SEAT_VARS_DEF.filter(v=>v.on).length, 4);
});
r.ok("seatVars: inizializza da default se assenti", () => {
  evState = { guests: [], tables: [], seating: { rules: [] } };
  assert.strictEqual(S.seatVars().length, 8);
});
r.ok("seatActiveVars: solo on", () => {
  setVars([{id:"a",name:"A",on:true,weight:5,mode:"cluster",values:["","x"]},
           {id:"b",name:"B",on:false,weight:5,mode:"cluster",values:["","y"]}]);
  assert.deepStrictEqual(S.seatActiveVars().map(v=>v.id), ["a"]);
});
r.ok("seatSimilarity: stesso valore, modo unisci = +peso", () => {
  setVars([{id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",values:["","Rossi"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{nucleo:"Rossi"}},{attr:{nucleo:"Rossi"}}), 10);
});
r.ok("seatSimilarity: stesso valore, modo separa = -peso", () => {
  setVars([{id:"fum",name:"F",on:true,weight:3,mode:"separate",values:["","Sì"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{fum:"Sì"}},{attr:{fum:"Sì"}}), -3);
});
r.ok("seatSimilarity: valori diversi = 0", () => {
  setVars([{id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",values:["","Rossi","Verdi"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{nucleo:"Rossi"}},{attr:{nucleo:"Verdi"}}), 0);
});
r.ok("seatSimilarity: variabile spenta ignorata", () => {
  setVars([{id:"nucleo",name:"N",on:false,weight:10,mode:"cluster",values:["","Rossi"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{nucleo:"Rossi"}},{attr:{nucleo:"Rossi"}}), 0);
});
r.ok("seatSimilarity: somma su più variabili", () => {
  setVars([{id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",values:["","Rossi"]},
           {id:"eta",name:"E",on:true,weight:4,mode:"cluster",values:["","Adulto"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{nucleo:"Rossi",eta:"Adulto"}},{attr:{nucleo:"Rossi",eta:"Adulto"}}), 14);
});
r.ok("seatSimilarity: attr mancante = 0, nessun crash", () => {
  setVars([{id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",values:["","Rossi"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{nucleo:"Rossi"}},{}), 0);
  assert.strictEqual(S.seatSimilarity(null,{attr:{}}), 0);
});
r.ok("seatPlanAssignment(simFn): avvicina chi ha alta affinità", () => {
  // due tavoli da 2. a,b affini (nucleo Rossi). Se a è già su t1, b deve seguire.
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2}];
  const guests=[{id:"a",attr:{n:"R"}},{id:"b",attr:{n:"R"}},{id:"c",attr:{n:"V"}},{id:"d",attr:{n:"V"}}];
  const by={}; guests.forEach(g=>by[g.id]=g);
  setVars([{id:"n",name:"N",on:true,weight:10,mode:"cluster",values:["","R","V"]}]);
  const sim=(x,y)=>S.seatSimilarity(by[x],by[y]);
  const plan=S.seatPlanAssignment(tables, guests, new Set(), new Set(), sim);
  const tableOf=gid=>Object.keys(plan.assign).find(k=>plan.assign[k].includes(gid));
  assert.strictEqual(tableOf("a"), tableOf("b"), "a e b (stesso nucleo) su tavoli diversi");
  assert.strictEqual(tableOf("c"), tableOf("d"), "c e d (stesso nucleo) su tavoli diversi");
  assert.notStrictEqual(tableOf("a"), tableOf("c"), "nuclei diversi non separati");
});
r.ok("seatPlanAssignment: senza simFn resta retrocompatibile (posti liberi)", () => {
  const tables=[{id:"t1",seats:4},{id:"t2",seats:4}];
  const guests=[{id:"a"},{id:"b"}];
  const plan=S.seatPlanAssignment(tables, guests, new Set(), new Set());
  assert.strictEqual(plan.unseated.length, 0);
});

r.done();
