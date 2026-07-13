"use strict";
/* SCADENZARIO DECISIONI — default + override per-evento (mesi/data/avvisi/nascondi). */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ SCADENZARIO DECISIONI (I3: entro quando confermare) ============ */";
const END = "/* ============ fine scadenzario decisioni ============ */";
const EXPORTS = ["decisionDefault","decisionCfg","decisionSet","decisionCats","decisionIsCustom","vendorDeadlines"];

let evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{} };
const S = sandbox(START, END, EXPORTS, {
  ev: () => evState, meta: () => evState.meta,
  VCATS: ["Location","Catering","Fiori","Foto/Video","Musica/DJ","Intrattenimento","Torta","Trasporti/Navetta","Beauty","Allestimenti","Officiante/Pratiche","Altro"],
  daysTo: d => Math.round((new Date(d+"T00:00:00") - new Date("2026-07-13T00:00:00"))/86400000)
});
const r = runner("decisions_test");
const dl = (cat) => S.vendorDeadlines().find(x=>x.cat===cat);

r.ok("default: mesi/key noti dalla prassi; categorie ignote -> fallback 3/no-avvisi", () => {
  assert.deepStrictEqual(S.decisionDefault("Location"), {months:12,key:true});
  assert.deepStrictEqual(S.decisionDefault("Beauty"), {months:3,key:false});
  assert.deepStrictEqual(S.decisionDefault("Intrattenimento"), {months:3,key:false});
});

r.ok("decisionCats: categorie fornitori escluso 'Altro', più eventuali custom", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{} };
  const cats=S.decisionCats();
  assert(cats.indexOf("Altro")<0, "'Altro' escluso");
  assert(cats.indexOf("Location")>=0 && cats.indexOf("Intrattenimento")>=0);
  evState.decisions={"Wedding cake topper":{months:2}};
  assert(S.decisionCats().indexOf("Wedding cake topper")>=0, "categoria custom inclusa");
});

r.ok("cfg default: nessun override -> valori di prassi, niente data/off", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{} };
  assert.deepStrictEqual(S.decisionCfg("Catering"), {months:9,key:true,date:null,off:false});
});

r.ok("deadline calcolata = data nozze meno i mesi di anticipo", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{} };
  assert.strictEqual(dl("Location").deadline, "2026-07-17"); // -12 mesi
  assert.strictEqual(dl("Catering").deadline, "2026-10-17"); // -9 mesi
  assert.strictEqual(dl("Catering").manual, false);
});

r.ok("override mesi: cambia la deadline ed è marcata custom", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{ Catering:{months:12} } };
  assert.strictEqual(dl("Catering").deadline, "2026-07-17"); // -12 mesi
  assert.strictEqual(dl("Catering").custom, true);
});

r.ok("data manuale: ha priorità sui mesi ed è marcata 'manual'", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{ Fiori:{date:"2027-01-10"} } };
  const f=dl("Fiori");
  assert.strictEqual(f.deadline, "2027-01-10");
  assert.strictEqual(f.manual, true);
  assert.strictEqual(f.custom, true);
});

r.ok("off: la voce resta ma è marcata off (esclusa dagli avvisi a monte)", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{ Beauty:{off:true} } };
  assert.strictEqual(dl("Beauty").off, true);
});

r.ok("key override: si possono accendere gli avvisi su una non-chiave", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{ Torta:{key:true} } };
  assert.strictEqual(dl("Torta").key, true);
  assert.strictEqual(dl("Torta").custom, true);
});

r.ok("stato: confermato se un fornitore della categoria è confermato", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[
    {id:"v1",category:"Location",status:"in corsa"},
    {id:"v2",category:"Catering",status:"confermato"} ], decisions:{} };
  assert.strictEqual(dl("Location").status, "in corsa");
  assert.strictEqual(dl("Location").n, 1);
  assert.strictEqual(dl("Catering").status, "confermato");
});

r.ok("decisionSet: salva solo lo scostamento; ritorno al default cancella la voce", () => {
  evState = { meta:{date:"2027-07-17"}, vendors:[], decisions:{} };
  S.decisionSet("Catering", {months:12});
  assert.deepStrictEqual(evState.decisions.Catering, {months:12});
  S.decisionSet("Catering", {months:9}); // = default -> rimosso
  assert.strictEqual(evState.decisions.Catering, undefined);
  // data + off insieme
  S.decisionSet("Fiori", {date:"2027-02-01", off:true});
  assert.deepStrictEqual(evState.decisions.Fiori, {date:"2027-02-01", off:true});
});

r.ok("nessuna data nozze -> scadenzario vuoto (nessun crash)", () => {
  evState = { meta:{}, vendors:[], decisions:{} };
  assert.deepStrictEqual(S.vendorDeadlines(), []);
});

r.done();
