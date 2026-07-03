"use strict";
/* E1 — import guidato: parser CSV/TSV, normalizzazione campi, mappatura, dedup. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "function impNorm(";
const END = "function importWizard(";
const EXPORTS = ["impNorm","impDelim","impSplitRows","impAutoMap","impGuessHeader","impRsvp","impMeal",
  "impBool","impPlus","impSide","impRowsToGuests","impDedupe","buildImportPlan","impNewGuests","IMP_FIELDS"];
const S = sandbox(START, END, EXPORTS, {});
const r = runner("import_test");

r.ok("impNorm: lowercase + trim + collapse spazi", () => {
  assert.strictEqual(S.impNorm("  Mario   Rossi  "), "mario rossi");
});
r.ok("impNorm: pieghe accenti", () => {
  assert.strictEqual(S.impNorm("Caffè"), "caffe");
  assert.strictEqual(S.impNorm("PERÒ"), "pero");
});
r.ok("impNorm: null/undefined -> stringa vuota", () => {
  assert.strictEqual(S.impNorm(null), "");
  assert.strictEqual(S.impNorm(undefined), "");
});
r.ok("impDelim: virgola", () => assert.strictEqual(S.impDelim("a,b,c"), ","));
r.ok("impDelim: tab", () => assert.strictEqual(S.impDelim("a\tb\tc"), "\t"));
r.ok("impDelim: punto e virgola", () => assert.strictEqual(S.impDelim("a;b;c"), ";"));
r.ok("impDelim: delimitatori dentro virgolette ignorati", () => {
  assert.strictEqual(S.impDelim('"a,b,c";d'), ";");
});
r.ok("impDelim: nessun delimitatore -> virgola di default", () => {
  assert.strictEqual(S.impDelim("soloNome"), ",");
});
r.ok("impSplitRows: CSV semplice", () => {
  const { rows } = S.impSplitRows("a,b\nc,d");
  assert.deepStrictEqual(rows, [["a","b"],["c","d"]]);
});
r.ok("impSplitRows: campo quotato con virgola interna", () => {
  const { rows } = S.impSplitRows('nome,note\n"Rossi, Mario",vip');
  assert.deepStrictEqual(rows[1], ["Rossi, Mario","vip"]);
});
r.ok("impSplitRows: virgolette escape (\"\")", () => {
  const { rows } = S.impSplitRows('x\n"dice ""ciao"""');
  assert.strictEqual(rows[1][0], 'dice "ciao"');
});
r.ok("impSplitRows: righe vuote scartate", () => {
  const { rows } = S.impSplitRows("a,b\n\n\nc,d\n");
  assert.strictEqual(rows.length, 2);
});
r.ok("impSplitRows: CRLF normalizzati", () => {
  const { rows } = S.impSplitRows("a,b\r\nc,d");
  assert.deepStrictEqual(rows, [["a","b"],["c","d"]]);
});
r.ok("impAutoMap: header italiano standard", () => {
  const m = S.impAutoMap(["Nome","Lato","RSVP","Pasto"]);
  assert.strictEqual(m.name, 0);
  assert.strictEqual(m.side, 1);
  assert.strictEqual(m.rsvp, 2);
  assert.strictEqual(m.meal, 3);
});
r.ok("impAutoMap: match per inclusione quando non esatto", () => {
  const m = S.impAutoMap(["Nome e cognome","Conferma presenza"]);
  assert.strictEqual(m.name, 0);
  assert.strictEqual(m.rsvp, 1);
});
r.ok("impAutoMap: una colonna non mappata resta assente", () => {
  const m = S.impAutoMap(["Nome","ColonnaIgnota"]);
  assert.strictEqual(m.name, 0);
  assert(!("side" in m));
});
r.ok("impGuessHeader: true se almeno un campo mappa", () => {
  assert.strictEqual(S.impGuessHeader([["Nome","Lato"]]), true);
  assert.strictEqual(S.impGuessHeader([["xxx","yyy"]]), false);
});
r.ok("impRsvp: conf/no/attesa", () => {
  assert.strictEqual(S.impRsvp("si"), "conf");
  assert.strictEqual(S.impRsvp("confermato"), "conf");
  assert.strictEqual(S.impRsvp("no"), "no");
  assert.strictEqual(S.impRsvp("boh"), "attesa");
});
r.ok("impMeal: categorie pasto", () => {
  assert.strictEqual(S.impMeal("bambino"), "bambino");
  assert.strictEqual(S.impMeal("veg"), "vegetariano");
  assert.strictEqual(S.impMeal("vegan"), "vegano");
  assert.strictEqual(S.impMeal("senza glutine"), "celiaco");
  assert.strictEqual(S.impMeal(""), "adulto");
});
r.ok("impBool: valori veri", () => {
  assert.strictEqual(S.impBool("si"), true);
  assert.strictEqual(S.impBool("x"), true);
  assert.strictEqual(S.impBool("no"), false);
});
r.ok("impPlus: numerico e booleano", () => {
  assert.strictEqual(S.impPlus("2"), 2);
  assert.strictEqual(S.impPlus("si"), 1);
  assert.strictEqual(S.impPlus(""), 0);
  assert.strictEqual(S.impPlus("-3"), 0);
});
r.ok("impSide: A/B da sposo/sposa e da nomi coppia", () => {
  assert.strictEqual(S.impSide("Sposo","Righi","Biondi"), "A");
  assert.strictEqual(S.impSide("Sposa","Righi","Biondi"), "B");
  assert.strictEqual(S.impSide("Biondi","Righi","Biondi"), "B");
  assert.strictEqual(S.impSide("ignoto","Righi","Biondi"), "A");
});
r.ok("impRowsToGuests: salta header e righe senza nome", () => {
  const rows = [["Nome","Lato"],["Mario","Sposo"],["","Sposa"]];
  const out = S.impRowsToGuests(rows, {name:0,side:1}, true, {coupleA:"Righi",coupleB:"Biondi"});
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "Mario");
  assert.strictEqual(out[0].side, "A");
});
r.ok("impRowsToGuests: default su campi non mappati", () => {
  const out = S.impRowsToGuests([["Anna"]], {name:0}, false, {});
  assert.strictEqual(out[0].rsvp, "attesa");
  assert.strictEqual(out[0].meal, "adulto");
  assert.strictEqual(out[0].household, "Senza nucleo");
  assert.strictEqual(out[0].plusOne, 0);
});
r.ok("impDedupe: dup contro esistenti e ripetuti nel file", () => {
  const cand = [{name:"Mario Rossi"},{name:"Anna Verdi"},{name:"mario rossi"}];
  const res = S.impDedupe(cand, [{name:"Anna Verdi"}]);
  const added = res.toAdd.map(c => c.name);
  assert.deepStrictEqual(added, ["Mario Rossi"]);
  assert.strictEqual(res.dups.length, 2);
  assert(res.dups.some(d => /già presente/.test(d.reason)));
  assert(res.dups.some(d => /ripetuto/.test(d.reason)));
});
r.ok("buildImportPlan: integrazione CSV con header", () => {
  const text = "Nome,Lato,RSVP\nMario Rossi,Sposo,si\nLucia Bianchi,Sposa,no";
  const plan = S.buildImportPlan(text, { coupleA:"Righi", coupleB:"Biondi", existing:[] });
  assert.strictEqual(plan.hasHeader, true);
  assert.strictEqual(plan.candidates.length, 2);
  assert.strictEqual(plan.toAdd.length, 2);
  assert.strictEqual(plan.candidates[0].side, "A");
  assert.strictEqual(plan.candidates[0].rsvp, "conf");
  assert.strictEqual(plan.candidates[1].side, "B");
  assert.strictEqual(plan.candidates[1].rsvp, "no");
});
r.ok("buildImportPlan: dedup contro ospiti esistenti", () => {
  const text = "Nome\nMario Rossi\nAnna Verdi";
  const plan = S.buildImportPlan(text, { existing:[{name:"Mario Rossi"}] });
  assert.strictEqual(plan.toAdd.length, 1);
  assert.strictEqual(plan.dups.length, 1);
});
r.ok("impNewGuests: aggiunge id, gift, thanked", () => {
  const g = S.impNewGuests([{ name:"Tizio", side:"A" }]);
  assert.strictEqual(g.length, 1);
  assert(/^g\d+_0$/.test(g[0].id));
  assert.strictEqual(g[0].gift, "");
  assert.strictEqual(g[0].thanked, false);
  assert.strictEqual(g[0].name, "Tizio");
});

r.done();
