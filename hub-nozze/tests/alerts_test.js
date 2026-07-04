"use strict";
/* ALERTS — motore centrale avvisi: regole, gravità, silenziamento, soglie. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ CENTRO AVVISI (motore centrale) ============ */";
const END = "/* ============ HELPERS ============ */";
const EXPORTS = ["alertsCompute","alertsPrefs"];

// Stato mutabile condiviso con il sandbox (mutare, MAI riassegnare).
let evState;
const D = {}; // DERIVED
function resetAll(){
  evState = { budget:[], payments:[], tasks:[], guests:[], tables:[], vendors:[], meta:{} };
  for(const k of Object.keys(D)) delete D[k];
  Object.assign(D, { variance:0, overdue:0, head:0, counts:{attesa:0}, seatCap:0 });
}
resetAll();
const iso=d=>d.toISOString().slice(0,10);
const daysFromNow=n=>{ const t=new Date(); t.setHours(12,0,0,0); t.setDate(t.getDate()+n); return iso(t); };

const S = sandbox(START, END, EXPORTS, {
  ev: () => evState,
  DERIVED: D,
  meta: () => evState.meta,
  money: n => "EUR " + (n||0),
  daysTo: d => { const t=new Date(d+"T00:00:00"), now=new Date(); now.setHours(0,0,0,0); return Math.round((t-now)/86400000); },
  fdate: d => d||"—",
  taskDone: t => !!t.done
});
const r = runner("alerts_test");
const ids = () => S.alertsCompute().map(a=>a.id);

r.ok("nessun dato -> nessun avviso", () => {
  resetAll();
  assert.deepStrictEqual(ids(), []);
});
r.ok("variance>0 -> bud_over (alta)", () => {
  resetAll(); D.variance=500;
  const A=S.alertsCompute();
  assert(A.some(a=>a.id==="bud_over"&&a.sev==="alta"));
});
r.ok("effettivo sopra preventivo -> scostamento per voce (media)", () => {
  resetAll(); evState.budget=[{id:"b1",item:"Fiori",quote:1000,actual:1400}];
  assert(ids().includes("bud_var_b1"));
});
r.ok("rate scadute -> pay_late (alta), imminenti -> pay_due (media)", () => {
  resetAll();
  evState.payments=[
    {id:"p1",amount:100,paid:false,dueDate:daysFromNow(-3)},
    {id:"p2",amount:200,paid:false,dueDate:daysFromNow(5)},
    {id:"p3",amount:300,paid:true, dueDate:daysFromNow(-9)}
  ];
  const A=S.alertsCompute();
  assert(A.some(a=>a.id==="pay_late"&&a.sev==="alta"), "manca pay_late");
  assert(A.some(a=>a.id==="pay_due"&&a.sev==="media"), "manca pay_due");
});
r.ok("rata pagata scaduta NON genera avvisi", () => {
  resetAll(); evState.payments=[{id:"p1",amount:100,paid:true,dueDate:daysFromNow(-3)}];
  assert.deepStrictEqual(ids(), []);
});
r.ok("task: scadute (DERIVED.overdue), imminenti, stagnanti senza data", () => {
  resetAll(); D.overdue=2;
  evState.tasks=[
    {id:"k1",done:false,due:daysFromNow(3)},
    {id:"k2",done:false,createdAt:daysFromNow(-45)},
    {id:"k3",done:true, createdAt:daysFromNow(-99)}
  ];
  const A=S.alertsCompute();
  assert(A.some(a=>a.id==="task_late"), "manca task_late");
  assert(A.some(a=>a.id==="task_due"), "manca task_due");
  assert(A.some(a=>a.id==="task_stale"), "manca task_stale");
});
r.ok("coperti sotto minimo garantito -> g_min", () => {
  resetAll(); D.head=100; evState.meta={minGuaranteed:170};
  assert(ids().includes("g_min"));
});
r.ok("attesa a ridosso delle nozze -> g_attesa solo entro 60 giorni", () => {
  resetAll(); D.counts={attesa:5}; evState.meta={date:daysFromNow(30)};
  assert(ids().includes("g_attesa"));
  evState.meta={date:daysFromNow(200)};
  assert(!ids().includes("g_attesa"));
});
r.ok("coperti oltre capienza -> s_cap; confermati senza posto -> s_unseated", () => {
  resetAll(); D.head=10; D.seatCap=8;
  evState.tables=[{id:"t1",seats:8,seatIds:["a",null]}];
  evState.guests=[{id:"a",rsvp:"conf"},{id:"b",rsvp:"conf"},{id:"c",rsvp:"attesa"}];
  const A=S.alertsCompute();
  assert(A.some(a=>a.id==="s_cap"&&a.sev==="alta"), "manca s_cap");
  const un=A.find(a=>a.id==="s_unseated");
  assert(un && un.text.indexOf("1 ospiti")===0, "s_unseated deve contare solo b (conf senza posto)");
});
r.ok("categorie chiave senza confermato: solo entro 180 giorni", () => {
  resetAll(); evState.meta={date:daysFromNow(100)};
  assert(ids().includes("v_key_Location"));
  evState.vendors=[{id:"v1",category:"Location",status:"confermato"}];
  assert(!ids().includes("v_key_Location"));
  evState.meta={date:daysFromNow(300)}; evState.vendors=[];
  assert(!ids().includes("v_key_Location"));
});
r.ok("opzione fornitore: scaduta = alta, entro 30 giorni = media, confermato = niente", () => {
  resetAll();
  evState.vendors=[{id:"v1",name:"Borgo",status:"opzione",optionUntil:daysFromNow(-1)}];
  let a=S.alertsCompute().find(x=>x.id==="v_opt_v1");
  assert(a && a.sev==="alta");
  evState.vendors=[{id:"v1",name:"Borgo",status:"opzione",optionUntil:daysFromNow(10)}];
  a=S.alertsCompute().find(x=>x.id==="v_opt_v1");
  assert(a && a.sev==="media");
  evState.vendors=[{id:"v1",name:"Borgo",status:"confermato",optionUntil:daysFromNow(-1)}];
  assert(!ids().includes("v_opt_v1"));
});
r.ok("silenziato non compare; ordinamento per gravità", () => {
  resetAll(); D.variance=1; D.overdue=1;
  evState.budget=[{id:"b1",item:"X",quote:1,actual:2}];
  S.alertsPrefs().muted=["bud_var_b1"];
  const A=S.alertsCompute();
  assert(!A.some(a=>a.id==="bud_var_b1"), "silenziato presente");
  const sevs=A.map(a=>a.sev);
  const order={alta:0,media:1,info:2};
  for(let i=1;i<sevs.length;i++) assert(order[sevs[i-1]]<=order[sevs[i]], "non ordinato");
});
r.ok("ref: gli avvisi portano gli id delle righe da evidenziare", () => {
  resetAll();
  evState.budget=[{id:"b1",item:"Fiori",quote:1000,actual:1400}];
  evState.payments=[{id:"p1",amount:100,paid:false,dueDate:daysFromNow(-3)},{id:"p2",amount:50,paid:false,dueDate:daysFromNow(-1)}];
  evState.tasks=[{id:"k1",done:false,due:daysFromNow(3)}];
  evState.vendors=[{id:"v1",name:"Borgo",status:"opzione",optionUntil:daysFromNow(-1)}];
  const A=S.alertsCompute(), by=id=>A.find(a=>a.id===id);
  assert.deepStrictEqual(by("bud_var_b1").ref, ["b1"]);
  assert.deepStrictEqual(by("pay_late").ref, ["p1","p2"]);
  assert.deepStrictEqual(by("task_due").ref, ["k1"]);
  assert.deepStrictEqual(by("v_opt_v1").ref, ["v1"]);
});
r.ok("ref: s_unseated elenca i confermati senza posto, g_attesa gli inviti in attesa", () => {
  resetAll(); D.counts={attesa:1}; evState.meta={date:daysFromNow(30)};
  evState.tables=[{id:"t1",seats:8,seatIds:["a"]}];
  evState.guests=[{id:"a",rsvp:"conf"},{id:"b",rsvp:"conf"},{id:"c",rsvp:"attesa"}];
  const A=S.alertsCompute(), by=id=>A.find(a=>a.id===id);
  assert.deepStrictEqual(by("s_unseated").ref, ["b"]);
  assert.deepStrictEqual(by("g_attesa").ref, ["c"]);
});
r.ok("ref: avviso senza righe specifiche ha ref vuoto", () => {
  resetAll(); D.variance=500;
  const a=S.alertsCompute().find(x=>x.id==="bud_over");
  assert.deepStrictEqual(a.ref, []);
});
r.ok("soglia payDays configurabile", () => {
  resetAll();
  evState.payments=[{id:"p1",amount:100,paid:false,dueDate:daysFromNow(20)}];
  assert(!ids().includes("pay_due"), "20 gg fuori soglia default 14");
  S.alertsPrefs().payDays=30;
  assert(ids().includes("pay_due"), "20 gg dentro soglia 30");
});

r.done();
