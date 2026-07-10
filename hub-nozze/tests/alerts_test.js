"use strict";
/* ALERTS — motore centrale avvisi: regole, gravità, silenziamento, soglie. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ CENTRO AVVISI (motore centrale) ============ */";
const END = "/* ============ HELPERS ============ */";
const EXPORTS = ["alertsCompute","alertsPrefs","vendorDeadlines","budgetAdvisor","budgetClassify","meteoHistStats","meteoPickDay","VENDOR_LEAD","BUDGET_BENCH"];

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
r.ok("scadenzario (I3): Location in ritardo a 300 giorni (lead 12 mesi) = alta", () => {
  resetAll(); evState.meta={date:daysFromNow(300)};
  const A=S.alertsCompute();
  const a=A.find(x=>x.id==="v_key_Location");
  assert(a && a.sev==="alta", "Location scaduta deve essere alta");
  evState.vendors=[{id:"v1",category:"Location",status:"confermato"}];
  assert(!ids().includes("v_key_Location"), "confermato -> niente avviso");
});
r.ok("scadenzario (I3): dentro la finestra dei 60 giorni = media; lontano = niente", () => {
  resetAll(); evState.meta={date:daysFromNow(400)}; // deadline Location tra ~35 gg
  const a=S.alertsCompute().find(x=>x.id==="v_key_Location");
  assert(a && a.sev==="media", "atteso media, avvisi: "+JSON.stringify(ids()));
  resetAll(); evState.meta={date:daysFromNow(700)}; // deadline tra ~335 gg
  assert(!ids().includes("v_key_Location"));
});
r.ok("scadenzario (I3): categorie non chiave (es. Torta) non generano avvisi", () => {
  resetAll(); evState.meta={date:daysFromNow(30)};
  assert(!ids().some(x=>x==="v_key_Torta"||x==="v_key_Fiori"));
});
r.ok("vendorDeadlines: date, stato e conteggio per categoria", () => {
  resetAll(); evState.meta={date:"2027-07-17"};
  evState.vendors=[{id:"v1",category:"Catering",status:"trattativa"},{id:"v2",category:"Catering",status:"opzione"}];
  const dls=S.vendorDeadlines();
  const cat=dls.find(d=>d.cat==="Catering");
  assert.strictEqual(cat.deadline, "2026-10-17"); // 9 mesi prima
  assert.strictEqual(cat.status, "in corsa");
  assert.strictEqual(cat.n, 2);
  assert.strictEqual(dls.find(d=>d.cat==="Location").status, "scoperto");
});
r.ok("qualità (I1): doppione nome ospite (normalizzato)", () => {
  resetAll(); evState.guests=[{id:"g1",name:"Mario Rossi"},{id:"g2",name:"  mario  ROSSI "},{id:"g3",name:"Pia"}];
  const A=S.alertsCompute();
  const d=A.find(a=>a.id.indexOf("q_dup_")===0);
  assert(d && d.ref.includes("g1") && d.ref.includes("g2"));
});
r.ok("qualità (I1): nucleo con lati misti = info", () => {
  resetAll(); evState.guests=[{id:"g1",name:"A",household:"Rossi",side:"A"},{id:"g2",name:"B",household:"Rossi",side:"B"}];
  const a=S.alertsCompute().find(x=>x.id.indexOf("q_hhside_")===0);
  assert(a && a.sev==="info");
});
r.ok("qualità (I1): bambino solo al tavolo senza il suo nucleo", () => {
  resetAll();
  evState.guests=[{id:"k1",name:"Bimbo",ptype:"bambino",household:"Rossi"},{id:"a1",name:"Papà",household:"Rossi"},{id:"x1",name:"Estraneo",household:"Verdi"}];
  evState.tables=[{id:"t1",name:"Uno",seats:4,seatIds:["k1","x1",null,null]},{id:"t2",name:"Due",seats:4,seatIds:["a1",null,null,null]}];
  assert(ids().includes("q_kid_k1"));
  // se il papà si siede con lui, niente avviso
  evState.tables[0].seatIds=["k1","a1",null,null]; evState.tables[1].seatIds=[null,null,null,null];
  assert(!ids().includes("q_kid_k1"));
});
r.ok("qualità (I1): fornitore confermato senza contatti; rate oltre preventivo", () => {
  resetAll();
  evState.vendors=[{id:"v1",name:"Foto X",status:"confermato",phone:"",email:"",quote:1000}];
  evState.payments=[{id:"p1",vendorId:"v1",amount:700},{id:"p2",vendorId:"v1",amount:600}];
  const A=S.alertsCompute();
  assert(A.some(a=>a.id==="q_vcontact_v1"));
  assert(A.some(a=>a.id==="q_paysum_v1"));
  // rate nel preventivo: niente q_paysum
  evState.payments=[{id:"p1",vendorId:"v1",amount:400}];
  assert(!ids().includes("q_paysum_v1"));
});
r.ok("meteo (I4): pioggia >=50 alta, 30-49 media, <30 niente; solo sul giorno giusto", () => {
  resetAll(); evState.meta={date:daysFromNow(10)};
  const day=evState.meta.date;
  evState.meteo={fc:{date:day, prain:60}};
  assert(S.alertsCompute().find(a=>a.id==="meteo_rain").sev==="alta");
  evState.meteo={fc:{date:day, prain:35}};
  assert(S.alertsCompute().find(a=>a.id==="meteo_rain").sev==="media");
  evState.meteo={fc:{date:day, prain:10}};
  assert(!ids().includes("meteo_rain"));
  evState.meteo={fc:{date:"1999-01-01", prain:90}}; // previsione di un altro giorno
  assert(!ids().includes("meteo_rain"));
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

r.ok("budgetClassify: fornitore collegato batte le parole chiave; poi keyword; poi null", () => {
  const vb={v1:{id:"v1",category:"Foto/Video"}};
  assert.strictEqual(S.budgetClassify({item:"Torta nuziale",vendorId:"v1"}, vb), "foto"); // vendor vince
  assert.strictEqual(S.budgetClassify({item:"Bomboniere e confetti"}, {}), "torta"); // keyword confett
  assert.strictEqual(S.budgetClassify({item:"Voce misteriosa"}, {}), null);
});
r.ok("budgetAdvisor: quote, verdetti e proiezione", () => {
  resetAll(); D.ceiling=10000;
  evState.vendors=[{id:"v1",category:"Catering"}];
  evState.budget=[
    {id:"b1",item:"Menu ricevimento",vendorId:"v1",quote:7000,actual:0},
    {id:"b2",item:"Servizio fotografico",quote:500,actual:0},
    {id:"b3",item:"Voce misteriosa",quote:400,actual:0}
  ];
  const a=S.budgetAdvisor();
  assert.strictEqual(a.total, 7900);
  assert.strictEqual(a.unclassified, 400);
  const loc=a.rows.find(r=>r.id==="locat"); assert.strictEqual(loc.pct, 70); assert.strictEqual(loc.verdict, "sopra");
  const foto=a.rows.find(r=>r.id==="foto"); assert.strictEqual(foto.pct, 5); assert.strictEqual(foto.verdict, "sotto");
  assert(a.projected>a.total, "le macro-voci a zero entrano nella proiezione");
});
r.ok("budgetAdvisor: effettivo batte il preventivo nella somma", () => {
  resetAll(); D.ceiling=0;
  evState.budget=[{id:"b1",item:"Fiori e addobbi",quote:1000,actual:1200}];
  const a=S.budgetAdvisor();
  assert.strictEqual(a.total, 1200);
  assert.strictEqual(a.denom, 1200); // senza ceiling usa il totale
});
r.ok("meteoHistStats: media, pioggia e caldo su finestra +-5 giorni (con wrap anno)", () => {
  const rows=[];
  for(let y=2020;y<2023;y++){
    rows.push({date:y+"-07-15",tmax:30,tmin:20,prcp:0});
    rows.push({date:y+"-07-17",tmax:34,tmin:22,prcp:5});
    rows.push({date:y+"-07-22",tmax:99,tmin:0,prcp:99}); // fuori finestra (17+5=22 incluso? diff 5 -> incluso)
    rows.push({date:y+"-01-01",tmax:5,tmin:0,prcp:9});   // fuori finestra
  }
  const st=S.meteoHistStats(rows, "07-17");
  assert.strictEqual(st.n, 9); // 15,17,22 per 3 anni (22 e' a distanza 5: incluso)
  assert(st.tmaxAvg>30 && st.rainPct>0 && st.hotPct>0);
  assert.strictEqual(S.meteoHistStats([], "07-17"), null);
});
r.ok("meteoPickDay: estrae il giorno o null", () => {
  const daily={time:["2027-07-16","2027-07-17"],temperature_2m_max:[30,33],temperature_2m_min:[21,22],precipitation_probability_max:[10,55],weather_code:[1,61]};
  const d=S.meteoPickDay(daily,"2027-07-17");
  assert.deepStrictEqual(d, {date:"2027-07-17",tmax:33,tmin:22,prain:55,code:61});
  assert.strictEqual(S.meteoPickDay(daily,"2027-08-01"), null);
  assert.strictEqual(S.meteoPickDay(null,"2027-07-17"), null);
});

r.done();
