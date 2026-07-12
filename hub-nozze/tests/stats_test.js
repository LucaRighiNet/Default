"use strict";
/* STATS — composizione ospiti (business intelligence): aggregati puri. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ COMPOSIZIONE OSPITI (business intelligence) ============ */";
const END = "/* ============ TAVOLI (riepilogo dal Tableau; l'editor è il Tableau) ============ */";
const EXPORTS = ["guestStats","statEta","statStato","statMembers"];

let evState = { guests: [], meta: {} };
const S = sandbox(START, END, EXPORTS, {
  ev: () => evState,
  meta: () => evState.meta,
  MEALS: ["normale","vegetariano","celiaco","vegano"],
  esc: s => String(s==null?"":s),
  seatGroupColor: () => "#000"
});
const r = runner("stats_test");

const G = (over) => Object.assign({ id:"x", name:"X", side:"A", household:"Senza nucleo", group:"", rsvp:"conf", ptype:"adulto", meal:"normale", intolerances:"", accessibility:"", shuttle:false, plusOne:0, attr:{} }, over);

r.ok("scope: conf/attesa/all filtrano per RSVP", () => {
  evState = { meta:{coupleA:"R",coupleB:"B"}, guests:[ G({rsvp:"conf"}), G({rsvp:"attesa"}), G({rsvp:"no"}) ] };
  assert.strictEqual(S.guestStats("conf").invitati, 1);
  assert.strictEqual(S.guestStats("attesa").invitati, 1);
  assert.strictEqual(S.guestStats("all").invitati, 3);
});
r.ok("heads: gli accompagnatori (+1) contano nei coperti e nel lato", () => {
  evState = { meta:{}, guests:[ G({side:"A", plusOne:2}), G({side:"B"}) ] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.invitati, 2);
  assert.strictEqual(s.plus, 2);
  assert.strictEqual(s.heads, 4);
  assert.strictEqual(s.lato.A, 3); // 1 invitato + 2 accompagnatori
  assert.strictEqual(s.lato.B, 1);
});
r.ok("adulti/bambini: i +1 sono adulti", () => {
  evState = { meta:{}, guests:[ G({ptype:"bambino"}), G({ptype:"adulto", plusOne:1}) ] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.bambini, 1);
  assert.strictEqual(s.adulti, 2); // heads 3 - 1 bambino
});
r.ok("fasce età: da attr.eta se presente, altrimenti da ptype; +1 come Adulto", () => {
  evState = { meta:{}, guests:[ G({attr:{eta:"Anziano"}}), G({ptype:"bambino"}), G({ptype:"adulto", plusOne:1}) ] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.eta.Anziano, 1);
  assert.strictEqual(s.eta.Bambino, 1);
  assert.strictEqual(s.eta.Adulto, 2); // 1 adulto senza attr + 1 accompagnatore
});
r.ok("menù: speciali contati per invitato, i +1 sommano a normale", () => {
  evState = { meta:{}, guests:[ G({meal:"celiaco"}), G({meal:"vegano", plusOne:2}) ] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.meals.celiaco, 1);
  assert.strictEqual(s.meals.vegano, 1);
  assert.strictEqual(s.meals.normale, 2); // i due +1
});
r.ok("gruppi ordinati per numerosità (heads), 'senza gruppo' incluso", () => {
  evState = { meta:{}, guests:[ G({group:"Amici", plusOne:1}), G({group:"Amici"}), G({group:""}) ] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.groups["Amici"], 3);
  assert.strictEqual(s.groupsTop[0][0], "Amici");
  assert.strictEqual(s.groupsTop[0][1], 3);
  assert(s.groups["— senza gruppo"]===1);
});
r.ok("nuclei: conta household reali, max, con bambini; esclude 'Senza nucleo'", () => {
  evState = { meta:{}, guests:[
    G({household:"Rossi"}), G({household:"Rossi", ptype:"bambino"}), G({household:"Rossi"}),
    G({household:"Verdi"}), G({household:"Senza nucleo"}) ] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.nuclei, 2);
  assert.strictEqual(s.nucleoMax, 3);
  assert.strictEqual(s.nucleoConBimbi, 1);
  assert.strictEqual(s.senzaNucleo, 1);
});
r.ok("navetta, intolleranze, accessibilità, stato", () => {
  evState = { meta:{}, guests:[
    G({shuttle:true, plusOne:1, intolerances:"noci", attr:{stato:"Single"}}),
    G({accessibility:"sedia", attr:{stato:"In coppia"}}) ] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.shuttle, 2); // 1 invitato + 1 accompagnatore
  assert.strictEqual(s.intoll, 1);
  assert.strictEqual(s.access, 1);
  assert.strictEqual(s.stato.Single, 1);
  assert.strictEqual(s.stato["In coppia"], 1);
});
r.ok("insight bambini: presente quando ci sono bambini", () => {
  evState = { meta:{}, guests:[ G({ptype:"bambino"}), G(), G() ] };
  const s=S.guestStats("conf");
  assert(s.insights.some(i=>/bambini/i.test(i.t)));
});
r.ok("insight navetta: dimensiona i bus", () => {
  const gs=[]; for(let i=0;i<60;i++) gs.push(G({shuttle:true}));
  evState = { meta:{}, guests:gs };
  const s=S.guestStats("conf");
  const nav=s.insights.find(i=>/navetta/i.test(i.t));
  assert(nav && /2 bus/.test(nav.t)); // 60/50 -> 2
});
r.ok("nessun dato: heads 0, nessun insight", () => {
  evState = { meta:{}, guests:[] };
  const s=S.guestStats("conf");
  assert.strictEqual(s.heads, 0);
  assert.strictEqual(s.insights.length, 0);
});
r.ok("statEta/statStato: fallback e override", () => {
  assert.strictEqual(S.statEta(G({ptype:"bambino"})), "Bambino");
  assert.strictEqual(S.statEta(G({ptype:"adulto"})), "Adulto");
  assert.strictEqual(S.statEta(G({ptype:"adulto", attr:{eta:"Giovane"}})), "Giovane");
  assert.strictEqual(S.statStato(G({attr:{stato:"Famiglia"}})), "Famiglia");
  assert.strictEqual(S.statStato(G({attr:{}})), "");
});

r.ok("rsvp: breakdown per stato con +1 inclusi (scope all)", () => {
  evState = { meta:{}, guests:[ G({rsvp:"conf", plusOne:1}), G({rsvp:"attesa"}), G({rsvp:"no"}), G({rsvp:"conf"}) ] };
  const s=S.guestStats("all");
  assert.strictEqual(s.rsvp.conf, 3); // 2 conf + 1 accompagnatore
  assert.strictEqual(s.rsvp.attesa, 1);
  assert.strictEqual(s.rsvp.no, 1);
});

r.ok("statMembers lato: nomi del lato con +N annotato, somma = heads della barra", () => {
  evState = { meta:{}, guests:[ G({name:"Anna", side:"A", plusOne:2}), G({name:"Bea", side:"A"}), G({name:"Carlo", side:"B"}) ] };
  const a=S.statMembers("conf","lato","A");
  assert.deepStrictEqual(a, ["Anna (+2)","Bea"]);
  assert.deepStrictEqual(S.statMembers("conf","lato","B"), ["Carlo"]);
});
r.ok("statMembers eta Adulto: include invitati adulti e i soli accompagnatori", () => {
  evState = { meta:{}, guests:[ G({name:"Ada", ptype:"adulto"}), G({name:"Bimbo", ptype:"bambino", plusOne:1}), G({name:"Cesare", ptype:"adulto", plusOne:1}) ] };
  const a=S.statMembers("conf","eta","Adulto");
  // Ada (adulto), Cesare adulto con +1, Bimbo contribuisce solo l'accompagnatore
  assert.deepStrictEqual(a, ["Ada","Bimbo — solo accompagnatori (+1)","Cesare (+1)"]);
  assert.deepStrictEqual(S.statMembers("conf","eta","Bambino"), ["Bimbo"]);
});
r.ok("statMembers rsvp: rispetta lo scope e annota +N", () => {
  evState = { meta:{}, guests:[ G({name:"A", rsvp:"conf", plusOne:1}), G({name:"B", rsvp:"attesa"}), G({name:"C", rsvp:"no"}) ] };
  assert.deepStrictEqual(S.statMembers("all","rsvp","conf"), ["A (+1)"]);
  assert.deepStrictEqual(S.statMembers("all","rsvp","no"), ["C"]);
});
r.ok("statMembers gruppo: '— senza gruppo' e gruppi reali", () => {
  evState = { meta:{}, guests:[ G({name:"A", group:"Amici"}), G({name:"B", group:""}) ] };
  assert.deepStrictEqual(S.statMembers("conf","grp","Amici"), ["A"]);
  assert.deepStrictEqual(S.statMembers("conf","grp","— senza gruppo"), ["B"]);
});
r.ok("statMembers servizi: navetta con +N, menù speciali/intolleranze annotati", () => {
  evState = { meta:{}, guests:[ G({name:"A", shuttle:true, plusOne:1, meal:"celiaco", intolerances:"noci"}), G({name:"B", meal:"normale"}) ] };
  assert.deepStrictEqual(S.statMembers("conf","shuttle",null), ["A (+1)"]);
  assert.deepStrictEqual(S.statMembers("conf","mealspecial",null), ["A · celiaco"]);
  assert.deepStrictEqual(S.statMembers("conf","intoll",null), ["A · noci"]);
});
r.ok("statMembers all: tutti gli invitati dello scope, con +N", () => {
  evState = { meta:{}, guests:[ G({name:"A", plusOne:1}), G({name:"B", rsvp:"no"}) ] };
  assert.deepStrictEqual(S.statMembers("conf","all",null), ["A (+1)"]);
  assert.strictEqual(S.statMembers("all","all",null).length, 2);
});
r.ok("statMembers: nome mancante -> placeholder", () => {
  evState = { meta:{}, guests:[ G({name:"", side:"A"}) ] };
  assert.deepStrictEqual(S.statMembers("conf","lato","A"), ["— senza nome"]);
});

r.done();
