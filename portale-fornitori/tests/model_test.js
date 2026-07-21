"use strict";
/* Logica di dominio del Portale Fornitori: regole di visibilità dei lavori,
   ritardi, integrità del seed e helper di formattazione. Testate in isolamento
   dal blocco puro di index.html (Utility → helpers dominio, DOM escluso). */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============================ Utility";
const END   = "/* ============================ Render";
const EXPORTS = ["STATE","isLate","jobsForSupplier","daysTo","relDays","fmtMoney","fmtDate",
                 "dISO","supplier","byId","TIPOLOGIE","STATI","SETTORI","CARPENTERIA","REQ_TYPES","esc","uid"];
const S = sandbox(START, END, EXPORTS, {});
const r = runner("model_test");

/* ---- Seed integro ---- */
r.ok("seed: entità di base presenti", () => {
  assert(S.STATE.jobs.length >= 6, "almeno 6 lavori");
  assert(S.STATE.suppliers.length === 4);
  assert(S.STATE.capi.length === 3);
  assert(S.STATE.users.some(u => u.role === "righi"));
  assert(S.STATE.users.filter(u => u.role === "fornitore").length >= 3);
});
r.ok("seed: codici lavoro univoci", () => {
  const codes = S.STATE.jobs.map(j => j.code);
  assert.strictEqual(new Set(codes).size, codes.length, "codici duplicati");
});
r.ok("seed: integrità referenziale (capo + fornitore assegnato)", () => {
  for (const j of S.STATE.jobs) {
    assert(S.byId(S.STATE.capi, j.capoId), "capo mancante per " + j.code);
    if (j.assegnatoA) assert(S.supplier(j.assegnatoA), "fornitore mancante per " + j.code);
    assert(S.TIPOLOGIE[j.tipologia], "tipologia non valida: " + j.tipologia);
    assert(["inclusa","righi","no"].includes(j.carpenteria), "carpenteria non valida");
  }
});

/* ---- Regola di visibilità (il cuore del portale) ---- */
r.ok("visibilità: le bozze non sono mai visibili ai fornitori", () => {
  for (const s of S.STATE.suppliers) {
    const seen = S.jobsForSupplier(s.id).map(j => j.stato);
    assert(!seen.includes("bozza"), "una bozza è trapelata a " + s.id);
  }
});
r.ok("visibilità: 'tutti' visibile a ogni fornitore", () => {
  const j1 = S.jobsForSupplier("f3").find(j => j.code === "RGH-2601");
  assert(j1, "il lavoro pubblico deve essere visibile a f3");
});
r.ok("visibilità: 'selezionati' solo agli invitati", () => {
  // j3 (RGH-2603) è selezionato per f2,f4 → NON visibile a f3
  assert(!S.jobsForSupplier("f3").some(j => j.code === "RGH-2603"), "f3 non deve vedere il selezionato");
  assert(S.jobsForSupplier("f2").some(j => j.code === "RGH-2603"), "f2 (invitato) deve vederlo");
});
r.ok("visibilità: l'assegnatario vede sempre la propria commessa", () => {
  assert(S.jobsForSupplier("f2").some(j => j.assegnatoA === "f2"));
});
r.ok("visibilità: conteggi coerenti (f3 vede solo i pubblici/aperti)", () => {
  const codes = S.jobsForSupplier("f3").map(j => j.code).sort();
  assert.deepStrictEqual(codes, ["RGH-2585","RGH-2592","RGH-2601"], "f3 vede " + codes.join(","));
});

/* ---- Ritardi ---- */
r.ok("isLate: consegna superata su commessa attiva = in ritardo", () => {
  const j2 = S.STATE.jobs.find(j => j.code === "RGH-2598"); // in_corso, consegna -2gg
  assert.strictEqual(S.isLate(j2), true);
});
r.ok("isLate: consegnato non è mai in ritardo", () => {
  const j4 = S.STATE.jobs.find(j => j.code === "RGH-2585"); // consegnato
  assert.strictEqual(S.isLate(j4), false);
});
r.ok("isLate: consegna futura non è in ritardo", () => {
  const j1 = S.STATE.jobs.find(j => j.code === "RGH-2601");
  assert.strictEqual(S.isLate(j1), false);
});

/* ---- Helper puri ---- */
r.ok("daysTo/relDays: oggi/domani/ieri", () => {
  assert.strictEqual(S.daysTo(S.dISO(0)), 0);
  assert.strictEqual(S.relDays(S.dISO(1)), "domani");
  assert.strictEqual(S.relDays(S.dISO(-1)), "ieri");
});
r.ok("fmtMoney: euro senza decimali, — se vuoto", () => {
  assert.strictEqual(S.fmtMoney(""), "—");
  assert(/8\.?500/.test(S.fmtMoney(8500).replace(/\s/g," ")), "formato: " + S.fmtMoney(8500));
});
r.ok("fmtDate: ISO → gg/mm/aaaa", () => {
  assert.strictEqual(S.fmtDate("2026-07-21"), "21/07/2026");
  assert.strictEqual(S.fmtDate(""), "—");
});
r.ok("esc: neutralizza l'HTML", () => {
  assert.strictEqual(S.esc("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;");
});
r.ok("uid: identificatori distinti", () => {
  assert.notStrictEqual(S.uid("x"), S.uid("x"));
});
r.ok("cataloghi di dominio completi", () => {
  assert.deepStrictEqual(Object.keys(S.TIPOLOGIE).sort(), ["automazione","distribuzione","potenza"]);
  assert(S.SETTORI.length >= 6);
  assert(Object.keys(S.REQ_TYPES).includes("materiale") && Object.keys(S.REQ_TYPES).includes("dubbio"));
});

r.done();
