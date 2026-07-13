"use strict";
/* MULTI-EVENTO — creazione additiva, switch, duplica, elimina, guida setup. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ MULTI-EVENTO: gestione, creazione, guida ============ */";
const END = "/* ============ fine multi-evento ============ */";
const EXPORTS = ["evBlank","eventSummary","eventIsFresh","setupSteps","setupAllDone","switchEvent","duplicateEvent","deleteEventById","newEventBlank","evNewId"];

function fullEvent(id, over){
  return Object.assign({
    id:id, meta:{coupleA:"Righi",coupleB:"Biondi",date:"2027-07-17",venue:"Castello"},
    budget:[{quote:100,actual:0}], guests:[{id:"g1"}], payments:[{}], vendors:[{}], tasks:[{}],
    lists:[{}], tables:[{}], runshow:[{}], sim:{scenarios:[{}],stations:[1,2,3,4],seq:9},
    seating:{rules:[{}]}, decisions:{Catering:{months:10}}
  }, over||{});
}
const STATE = {};
function reset(){ STATE.schema=1; STATE.activeEventId="rb27"; STATE.events={ rb27: fullEvent("rb27") }; }
let lastCommit=null, headerOpened=false;
const S = sandbox(START, END, EXPORTS, {
  STATE: STATE,
  seedState: () => ({ schema:1, activeEventId:"rb27", events:{ rb27: fullEvent("rb27") } }),
  commit: (m)=>{ lastCommit=m; },
  editEventHeader: ()=>{ headerOpened=true; }
});
const r = runner("event_test");

r.ok("evNewId: id unici e nel namespace 'ev'", () => {
  const a=S.evNewId(), b=S.evNewId();
  assert(/^ev/.test(a) && a!==b);
});

r.ok("evBlank: svuota tutti i dati, nomi placeholder, flag fresh", () => {
  const e=S.evBlank("evX");
  assert.strictEqual(e.id, "evX");
  assert.strictEqual(e.guests.length, 0);
  assert.strictEqual(e.vendors.length, 0);
  assert.strictEqual(e.tasks.length, 0);
  assert.strictEqual(e.tables.length, 0);
  assert.strictEqual(e.runshow.length, 0);
  assert.strictEqual(e.budget[0].quote, 0);
  assert.deepStrictEqual(e.decisions, {});
  assert.strictEqual(e.meta.coupleA, "Sposo");
  assert.strictEqual(e.meta.date, "");
  assert.strictEqual(e.fresh, true);
});

r.ok("eventSummary: nome 'A × B' e conteggio invitati", () => {
  const s=S.eventSummary(fullEvent("rb27"));
  assert.strictEqual(s.name, "Righi × Biondi");
  assert.strictEqual(s.guests, 1);
});

r.ok("eventIsFresh: vero solo col flag", () => {
  assert.strictEqual(S.eventIsFresh({fresh:true}), true);
  assert.strictEqual(S.eventIsFresh(fullEvent("x")), false);
});

r.ok("setupSteps: evento vuoto tutto da fare; evento pieno tutto fatto", () => {
  const blank=S.evBlank("evX");
  const steps=S.setupSteps(blank);
  assert.deepStrictEqual(steps.map(s=>s.done), [false,false,false]);
  assert.strictEqual(S.setupAllDone(blank), false);
  assert.strictEqual(S.setupAllDone(fullEvent("rb27")), true);
});

r.ok("setupSteps: passo header richiede nomi reali + data", () => {
  const e=S.evBlank("evX");
  e.meta.coupleA="Anna"; e.meta.coupleB="Bea"; // manca la data
  assert.strictEqual(S.setupSteps(e)[0].done, false);
  e.meta.date="2028-06-01";
  assert.strictEqual(S.setupSteps(e)[0].done, true);
});

r.ok("switchEvent: cambia l'evento attivo", () => {
  reset(); STATE.events["ev2"]=fullEvent("ev2",{meta:{coupleA:"Aldo",coupleB:"Bea"}});
  S.switchEvent("ev2");
  assert.strictEqual(STATE.activeEventId, "ev2");
  assert(/Aldo/.test(lastCommit));
});

r.ok("newEventBlank: aggiunge (non sostituisce), attiva il nuovo, apre l'intestazione", () => {
  reset(); headerOpened=false;
  const before=Object.keys(STATE.events).length;
  S.newEventBlank();
  assert.strictEqual(Object.keys(STATE.events).length, before+1);
  assert(STATE.events.rb27, "l'evento precedente resta archiviato");
  assert.notStrictEqual(STATE.activeEventId, "rb27");
  assert.strictEqual(S.eventIsFresh(STATE.events[STATE.activeEventId]), true);
  assert.strictEqual(headerOpened, true);
});

r.ok("duplicateEvent: copia indipendente, nuovo id, nome (copia), attivo=copia", () => {
  reset();
  S.duplicateEvent("rb27");
  const nid=STATE.activeEventId;
  assert.notStrictEqual(nid, "rb27");
  assert(/\(copia\)/.test(STATE.events[nid].meta.coupleA));
  // indipendenza deep-clone: muto la copia, l'originale non cambia
  STATE.events[nid].guests.push({id:"g2"});
  assert.strictEqual(STATE.events.rb27.guests.length, 1);
  assert.strictEqual(STATE.events[nid].guests.length, 2);
});

r.ok("deleteEventById: elimina e ripunta l'attivo; protegge l'ultimo", () => {
  reset(); STATE.events["ev2"]=fullEvent("ev2");
  assert.strictEqual(S.deleteEventById("rb27"), true);
  assert.strictEqual(STATE.events.rb27, undefined);
  assert.strictEqual(STATE.activeEventId, "ev2"); // ripuntato
  // ora resta un solo evento: non eliminabile
  assert.strictEqual(S.deleteEventById("ev2"), false);
  assert(STATE.events.ev2, "l'ultimo evento resta");
});

r.done();
