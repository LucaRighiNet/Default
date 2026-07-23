"use strict";
/* TAVOLI — partizionamento di grafo: componenti must-link, fattibilità, KL. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ TAVOLI: partizionamento di grafo (fattibilità + Kernighan–Lin) ============ */";
const END = "/* ============ fine partizionamento grafo ============ */";
const EXPORTS = ["seatMustLinkComponents","seatFeasibility","seatKLRefine"];
const S = sandbox(START, END, EXPORTS, {});
const r = runner("graph_test");

const G = (id, hh) => ({ id:id, name:id, household:hh||"Senza nucleo" });
const set = (arr) => new Set(arr);
const key = (a,b) => a<b ? a+"|"+b : b+"|"+a;
const sameTable = (out, x, y) => Object.keys(out).some(t => out[t].indexOf(x)>=0 && out[t].indexOf(y)>=0);
const total = (out, sim) => { let s=0; Object.keys(out).forEach(t=>{ const L=out[t]; for(let i=0;i<L.length;i++) for(let j=i+1;j<L.length;j++) s+=sim(L[i],L[j]); }); return s; };

r.ok("componenti must-link: 'insieme' e stesso nucleo si fondono", () => {
  const guests=[G("A"),G("B"),G("C","Rossi"),G("D","Rossi"),G("E")];
  const comps=S.seatMustLinkComponents(guests, set([key("A","B")]));
  const sorted=comps.map(c=>c.slice().sort()).sort((a,b)=>a[0]<b[0]?-1:1);
  assert.deepStrictEqual(sorted, [["A","B"],["C","D"],["E"]]);
});

r.ok("fattibilità: 'lontani' dentro una componente 'insieme' = impossibile", () => {
  const guests=[G("A"),G("B"),G("C")];
  const f=S.seatFeasibility([{id:"t1",seats:8}], guests, set([key("A","B")]), set([key("A","B")]));
  assert.strictEqual(f.impossible.length, 1);
  assert.deepStrictEqual(f.impossible[0].slice().sort(), ["A","B"]);
});

r.ok("fattibilità: componente più grande del tavolo max = oversized", () => {
  const guests=[G("A","Big"),G("B","Big"),G("C","Big"),G("D","Big"),G("E","Big")];
  const f=S.seatFeasibility([{id:"t1",seats:4}], guests, set(), set());
  assert.strictEqual(f.oversized.length, 1);
  assert.strictEqual(f.oversized[0].n, 5);
  assert.strictEqual(f.maxCap, 4);
});

r.ok("KL: scambio che il greedy non trova aumenta l'affinità", () => {
  const guests=["A","B","C","D"].map(x=>G(x));
  const sim=(a,b)=> (key(a,b)===key("A","B")||key(a,b)===key("C","D"))?10:0;
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2}];
  const assign={t1:["A","C"], t2:["B","D"]}; // affinità 0
  const res=S.seatKLRefine(assign, tables, guests, set(), set(), sim);
  assert.strictEqual(res.before, 0);
  assert.strictEqual(res.after, 20);
  assert(res.after>=res.before, "mai peggiorativo");
  assert(res.moves>=1);
  assert(sameTable(res.assign,"A","B"), "A e B insieme");
  assert(sameTable(res.assign,"C","D"), "C e D insieme");
  assert.strictEqual(total(res.assign, sim), 20);
});

r.ok("KL: rispetta la capacità (mossa che sforerebbe non viene fatta)", () => {
  const guests=["A","B","C","D"].map(x=>G(x));
  const sim=(a,b)=> key(a,b)===key("A","D")?100:0;
  const tables=[{id:"t1",seats:3},{id:"t2",seats:1}];
  const assign={t1:["A","B","C"], t2:["D"]};
  const res=S.seatKLRefine(assign, tables, guests, set(), set(), sim);
  // A non può raggiungere D (t2 pieno) e lo swap non aiuta -> A resta a t1
  assert(res.assign.t1.indexOf("A")>=0, "A resta al suo tavolo");
  assert(res.assign.t2.length<=1, "capacità t2 non sforata");
  assert(res.after>=res.before);
});

r.ok("KL: rispetta il cannot-link ('lontani' non vengono avvicinati)", () => {
  const guests=["A","D"].map(x=>G(x));
  const sim=(a,b)=> key(a,b)===key("A","D")?100:0; // affini ma...
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2}];
  const assign={t1:["A"], t2:["D"]};
  const res=S.seatKLRefine(assign, tables, guests, set(), set([key("A","D")]), sim);
  assert(!sameTable(res.assign,"A","D"), "A e D restano separati nonostante l'affinità");
});

r.ok("KL: nessun duplicato e nessuna perdita dopo più mosse", () => {
  const ids=["A","B","C","D","E","F"];
  const guests=ids.map(x=>G(x));
  const w={}; w[key("A","B")]=10; w[key("C","D")]=10; w[key("E","F")]=10; w[key("A","C")]=1;
  const sim=(a,b)=> w[key(a,b)]||0;
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2},{id:"t3",seats:2}];
  const assign={t1:["A","D"], t2:["B","E"], t3:["C","F"]}; // coppie tutte separate
  const res=S.seatKLRefine(assign, tables, guests, set(), set(), sim);
  const all=[]; Object.keys(res.assign).forEach(t=>res.assign[t].forEach(g=>all.push(g)));
  assert.strictEqual(all.length, new Set(all).size, "nessun duplicato");
  assert.deepStrictEqual(all.slice().sort(), ids.slice().sort(), "tutte e sole le 6 persone");
  Object.keys(res.assign).forEach(t=>assert(res.assign[t].length<=2, "capacità rispettata a "+t));
  assert(res.after>=res.before);
});
r.ok("KL: senza mosse utili non cambia nulla (idempotente)", () => {
  const guests=["A","B"].map(x=>G(x));
  const sim=()=>0;
  const tables=[{id:"t1",seats:2},{id:"t2",seats:2}];
  const assign={t1:["A"], t2:["B"]};
  const res=S.seatKLRefine(assign, tables, guests, set(), set(), sim);
  assert.strictEqual(res.moves, 0);
  assert.strictEqual(res.after, res.before);
});

r.done();
