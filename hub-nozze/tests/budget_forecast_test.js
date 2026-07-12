"use strict";
/* BUDGET FORECAST — proiezione predittiva su RSVP + minimo garantito (funzione pura). */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ BUDGET: PROIEZIONE & SCENARI (predittivo) ============ */";
const END = "function viewBudget(";
const EXPORTS = ["budgetForecast"];

let evState = { meta:{}, guests:[], budget:[] };
const S = sandbox(START, END, EXPORTS, {
  ev: () => evState, meta: () => evState.meta,
  money: n => "€"+(n||0), esc: s => String(s==null?"":s), dnum: n => String(n||0)
});
const r = runner("budget_forecast");

const g = (rsvp, plus) => ({ id:"x", name:"X", rsvp:rsvp, plusOne:plus||0 });
// catering a coperto (100), navetta a coperto (10), una voce fissa (quote 5000)
const LINES = () => ([
  { item:"Catering", costType:"perGuest", perHead:100, quote:0, actual:0, estimated:0 },
  { item:"Navetta",  costType:"perGuest", perHead:10,  quote:0, actual:0, estimated:0 },
  { item:"Fotografo",costType:"fixed",    perHead:0,   quote:5000, actual:0, estimated:0 }
]);

r.ok("rate: catering = voce a coperto più cara; rateOther e fixedBase corretti", () => {
  evState = { meta:{plannedGuests:0, minGuaranteed:0, contingencyPct:0}, guests:[], budget:LINES() };
  const f=S.budgetForecast();
  assert.strictEqual(f.cateringRate, 100);
  assert.strictEqual(f.cateringName, "Catering");
  assert.strictEqual(f.rateAll, 110);
  assert.strictEqual(f.rateOther, 10);
  assert.strictEqual(f.fixedBase, 5000);
});

r.ok("minimo garantito: catering fatturato su max(teste, minG); coperti a vuoto", () => {
  // 100 teste confermate (una con +1 -> 2, più 98 singoli = 100)
  const guests=[g("conf",1)]; for(let i=0;i<98;i++) guests.push(g("conf"));
  evState = { meta:{plannedGuests:0, minGuaranteed:170, contingencyPct:0}, guests, budget:LINES() };
  const f=S.budgetForecast();
  assert.strictEqual(f.headsConf, 100);
  // proj(100) = 5000 + 100*max(100,170) + 10*100 = 5000+17000+1000 = 23000
  assert.strictEqual(f.scenarios[0].cost, 23000);
  assert.strictEqual(f.perHeadReal, 230);
  assert.strictEqual(f.emptyCovers, 70);
  assert.strictEqual(f.wasted, 7000); // 70 * 100
});

r.ok("scenario '+ in attesa': somma teste conf + attesa, catering sopra il minimo", () => {
  const guests=[]; for(let i=0;i<100;i++) guests.push(g("conf"));
  for(let i=0;i<80;i++) guests.push(g("attesa"));
  evState = { meta:{plannedGuests:0, minGuaranteed:170, contingencyPct:0}, guests, budget:LINES() };
  const f=S.budgetForecast();
  assert.strictEqual(f.headsAttesa, 80);
  assert.strictEqual(f.scenarios[1].heads, 180);
  // proj(180) = 5000 + 100*180 + 10*180 = 5000+18000+1800 = 24800
  assert.strictEqual(f.scenarios[1].cost, 24800);
});

r.ok("nessun coperto a vuoto quando i confermati superano il minimo", () => {
  const guests=[]; for(let i=0;i<200;i++) guests.push(g("conf"));
  evState = { meta:{plannedGuests:0, minGuaranteed:170, contingencyPct:0}, guests, budget:LINES() };
  const f=S.budgetForecast();
  assert.strictEqual(f.emptyCovers, 0);
  assert.strictEqual(f.wasted, 0);
});

r.ok("semaforo: over quando la proiezione peggiore supera il tetto", () => {
  const guests=[]; for(let i=0;i<100;i++) guests.push(g("conf"));
  // tetto piccolo: solo la voce fissa fa quote 5000 -> ceiling 5000 (cont 0)
  evState = { meta:{plannedGuests:200, minGuaranteed:170, contingencyPct:0}, guests, budget:LINES() };
  const f=S.budgetForecast();
  assert.strictEqual(f.ceiling, 5000);
  assert.strictEqual(f.worstHeads, 200); // max(100, 200)
  assert.strictEqual(f.verdict, "over");
});

r.ok("semaforo: ok quando il tetto copre la proiezione peggiore", () => {
  const guests=[]; for(let i=0;i<100;i++) guests.push(g("conf"));
  const lines=LINES(); lines[0].quote=30000; // tetto alto via preventivo catering
  evState = { meta:{plannedGuests:100, minGuaranteed:0, contingencyPct:10}, guests, budget:lines };
  const f=S.budgetForecast();
  // quoteSum=30000(catering)+5000(fisso)=35000, cont=3500, ceiling=38500;
  // worst=proj(100)=5000+10000+1000=16000 < 38500
  assert.strictEqual(f.ceiling, 38500);
  assert.strictEqual(f.verdict, "ok");
});

r.ok("semaforo: na quando non c'è tetto (nessun preventivo)", () => {
  evState = { meta:{plannedGuests:100, minGuaranteed:0, contingencyPct:0}, guests:[g("conf")], budget:[LINES()[0]] };
  const f=S.budgetForecast();
  assert.strictEqual(f.ceiling, 0);
  assert.strictEqual(f.verdict, "na");
});

r.done();
