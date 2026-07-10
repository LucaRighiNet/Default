"use strict";
/* VARS — variabili configurabili (G1) + similarità pesata (G2) + derivazione dai
   campi nativi e migrazione v3 (B1). Estrae le funzioni seat native dallo <script>. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const SEAT_START = "const SEAT_SHAPES=";
const SEAT_END = "/* ---- planimetria SVG nativa (B3) ---- */";
const EXPORTS = ["seatSimilarity","seatActiveVars","seatFillableVars","seatVars","seatVarById","seatVarValueOf","seatVarCoverage","seatPlanAssignment","SEAT_VARS_DEF","SEAT_VARS_VER"];

let evState = { guests: [], tables: [], seating: { rules: [] } };
const S = sandbox(SEAT_START, SEAT_END, EXPORTS, { ev: () => evState });
const r = runner("vars_test");

function setVars(vars){ evState = { guests: [], tables: [], seating: { rules: [], vars: vars, varsVer: S.SEAT_VARS_VER } }; }

r.ok("SEAT_VARS_DEF: 9 variabili, 5 attive, 4 derivate dai campi nativi", () => {
  assert.strictEqual(S.SEAT_VARS_DEF.length, 9);
  assert.strictEqual(S.SEAT_VARS_DEF.filter(v=>v.on).length, 5);
  assert.deepStrictEqual(S.SEAT_VARS_DEF.filter(v=>v.src).map(v=>v.id).sort(), ["ambiente","eta","lato","nucleo"]);
});
r.ok("seatVars: inizializza da default v3 se assenti", () => {
  evState = { guests: [], tables: [], seating: { rules: [] } };
  const vs=S.seatVars();
  assert.strictEqual(vs.length, 9);
  assert.strictEqual(evState.seating.varsVer, S.SEAT_VARS_VER);
  assert.strictEqual(vs.find(v=>v.id==="nucleo").src, "household");
});
r.ok("migrazione v1->v3: aggiunge 'stato' e marca le derivate", () => {
  evState = { guests: [], tables: [], seating: { rules: [], vars: [{id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",values:[""]}] } };
  const vs=S.seatVars();
  assert.strictEqual(vs.length, 2);
  assert(vs.some(v=>v.id==="stato"));
  assert.strictEqual(vs.find(v=>v.id==="nucleo").src, "household");
  assert.strictEqual(S.seatVars().length, 2); // idempotente
});
r.ok("migrazione v2->v3: purga gli attr doppione, conserva età Giovane/Anziano", () => {
  evState = { guests: [
    {id:"g1", attr:{nucleo:"Fam. Rossi", lato:"Sposa", ambiente:"Amici", eta:"Adulto", stato:"Single"}},
    {id:"g2", attr:{eta:"Giovane", lingua:"Inglese"}}
  ], tables: [], seating: { rules: [], varsVer: 2, vars: [
    {id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",values:[""]},
    {id:"eta",name:"E",on:true,weight:4,mode:"cluster",values:[""]}
  ] } };
  S.seatVars();
  assert.deepStrictEqual(evState.guests[0].attr, {stato:"Single"});
  assert.deepStrictEqual(evState.guests[1].attr, {eta:"Giovane", lingua:"Inglese"});
  assert.strictEqual(evState.seating.vars.find(v=>v.id==="eta").override, true);
  assert.strictEqual(evState.seating.varsVer, 3);
});
r.ok("seatVars: default eliminata dall'utente NON riappare (varsVer già corrente)", () => {
  setVars([{id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",src:"household",values:[""]}]);
  assert.strictEqual(S.seatVars().length, 1);
});
r.ok("seatActiveVars: solo on; seatFillableVars: senza src (o con override)", () => {
  setVars([{id:"a",name:"A",on:true,weight:5,mode:"cluster",values:["","x"]},
           {id:"b",name:"B",on:false,weight:5,mode:"cluster",values:["","y"]},
           {id:"lato",name:"L",on:true,weight:5,mode:"cluster",src:"side",values:[""]},
           {id:"eta",name:"E",on:true,weight:4,mode:"cluster",src:"ptype",override:true,values:[""]}]);
  assert.deepStrictEqual(S.seatActiveVars().map(v=>v.id), ["a","lato","eta"]);
  assert.deepStrictEqual(S.seatFillableVars().map(v=>v.id), ["a","eta"]);
});
r.ok("seatVarValueOf: derivate leggono i campi nativi live", () => {
  setVars([{id:"lato",name:"L",on:true,weight:5,mode:"cluster",src:"side",values:[""]},
           {id:"nucleo",name:"N",on:true,weight:10,mode:"cluster",src:"household",values:[""]},
           {id:"ambiente",name:"G",on:true,weight:6,mode:"cluster",src:"group",values:[""]}]);
  const g={side:"A",household:"Rossi",group:"Amici",attr:{lato:"VECCHIO"}};
  assert.strictEqual(S.seatVarValueOf(g, S.seatVarById("lato")), "A"); // attr ignorato: live
  assert.strictEqual(S.seatVarValueOf(g, S.seatVarById("nucleo")), "Rossi");
  assert.strictEqual(S.seatVarValueOf({household:"Senza nucleo"}, S.seatVarById("nucleo")), "");
  assert.strictEqual(S.seatVarValueOf(g, S.seatVarById("ambiente")), "Amici");
});
r.ok("seatVarCoverage: conta i valori effettivi sui sedibili", () => {
  evState = { guests:[{id:"a",rsvp:"conf",side:"A"},{id:"b",rsvp:"attesa"},{id:"c",rsvp:"no",side:"B"}], tables:[],
    seating:{ rules:[], varsVer:S.SEAT_VARS_VER, vars:[{id:"lato",name:"L",on:true,weight:5,mode:"cluster",src:"side",values:[""]}] } };
  const c=S.seatVarCoverage(S.seatVarById("lato"));
  assert.deepStrictEqual({n:c.n,tot:c.tot}, {n:1,tot:2}); // c escluso (rsvp no); b senza side
});
r.ok("seatSimilarity: stesso valore, modo unisci = +peso (var custom)", () => {
  setVars([{id:"hobby",name:"H",on:true,weight:7,mode:"cluster",values:["","Golf"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{hobby:"Golf"}},{attr:{hobby:"Golf"}}), 7);
});
r.ok("seatSimilarity: stesso valore, modo separa = -peso", () => {
  setVars([{id:"fum",name:"F",on:true,weight:3,mode:"separate",values:["","Sì"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{fum:"Sì"}},{attr:{fum:"Sì"}}), -3);
});
r.ok("seatSimilarity: valori diversi = 0", () => {
  setVars([{id:"hobby",name:"H",on:true,weight:7,mode:"cluster",values:["","Golf","Vela"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{hobby:"Golf"}},{attr:{hobby:"Vela"}}), 0);
});
r.ok("seatSimilarity: variabile spenta ignorata", () => {
  setVars([{id:"hobby",name:"H",on:false,weight:7,mode:"cluster",values:["","Golf"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{hobby:"Golf"}},{attr:{hobby:"Golf"}}), 0);
});
r.ok("seatSimilarity: somma su più variabili (custom + derivata)", () => {
  setVars([{id:"hobby",name:"H",on:true,weight:7,mode:"cluster",values:["","Golf"]},
           {id:"lato",name:"L",on:true,weight:5,mode:"cluster",src:"side",values:[""]}]);
  assert.strictEqual(S.seatSimilarity({side:"A",attr:{hobby:"Golf"}},{side:"A",attr:{hobby:"Golf"}}), 12);
});
r.ok("seatSimilarity: attr mancante = 0, nessun crash", () => {
  setVars([{id:"hobby",name:"H",on:true,weight:7,mode:"cluster",values:["","Golf"]}]);
  assert.strictEqual(S.seatSimilarity({attr:{hobby:"Golf"}},{}), 0);
  assert.strictEqual(S.seatSimilarity(null,{attr:{}}), 0);
});
r.ok("seatPlanAssignment(simFn): avvicina chi ha alta affinità", () => {
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
