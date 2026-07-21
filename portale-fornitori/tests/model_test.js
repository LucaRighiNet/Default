"use strict";
/* Logica di dominio del Portale Fornitori su scala reale (~40 da assegnare +
   ~150 assegnate): regole di visibilità, ritardi, filtro/ordinamento della
   vista massiva, integrità del seed, email e helper. Testate in isolamento dal
   blocco puro di index.html (Utility → filteredJobs, DOM escluso). */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============================ Utility";
const END   = "/* ============================ Render";
const EXPORTS = ["STATE","App","isLate","jobsForSupplier","filteredJobs","daysTo","relDays","fmtMoney","fmtDate",
                 "dISO","supplier","capo","byId","mailto","isCapo","activeHours","supplierMonthlyLoad","monthKey",
                 "toCSV","parseCSV","TIPOLOGIE","STATI","SETTORI","CARPENTERIA","REQ_TYPES","esc","uid"];
const S = sandbox(START, END, EXPORTS, {});
const r = runner("model_test");
const resetFilters = () => { S.App.filters = {q:"",stato:"",tipologia:"",settore:"",capo:"",fornitore:"",late:false}; S.App.sort={key:"consegna",dir:1}; };

/* ---- Scala e integrità del seed ---- */
r.ok("seed: volume su scala reale (~40 da assegnare, ~150 attive)", () => {
  const pub = S.STATE.jobs.filter(j => j.stato === "pubblicato").length;
  const att = S.STATE.jobs.filter(j => ["assegnato","in_corso"].includes(j.stato)).length;
  assert(pub >= 30, "da assegnare: " + pub);
  assert(att >= 120, "attive: " + att);
  assert(S.STATE.jobs.length >= 180, "totale: " + S.STATE.jobs.length);
});
r.ok("seed: entità di supporto (fornitori, capi, utenti)", () => {
  assert(S.STATE.suppliers.length >= 6);
  assert(S.STATE.capi.length >= 3);
  assert(S.STATE.users.some(u => u.role === "righi"));
  assert(S.STATE.users.filter(u => u.role === "fornitore").length >= 2);
});
r.ok("seed: codici lavoro univoci", () => {
  const codes = S.STATE.jobs.map(j => j.code);
  assert.strictEqual(new Set(codes).size, codes.length, "codici duplicati");
});
r.ok("seed: integrità referenziale + tipologie/carpenteria valide", () => {
  for (const j of S.STATE.jobs) {
    assert(S.byId(S.STATE.capi, j.capoId), "capo mancante per " + j.code);
    if (j.assegnatoA) assert(S.supplier(j.assegnatoA), "fornitore mancante per " + j.code);
    assert(S.TIPOLOGIE[j.tipologia], "tipologia non valida: " + j.tipologia);
    assert(["inclusa","righi","no"].includes(j.carpenteria));
  }
});

/* ---- Email (nuovo canale) ---- */
r.ok("email: ogni fornitore e ogni caposquadra ha un indirizzo", () => {
  assert(S.STATE.suppliers.every(s => /@/.test(s.email)), "fornitore senza email");
  assert(S.STATE.capi.every(c => /@/.test(c.email)), "caposquadra senza email");
});
r.ok("mailto: costruisce lo schema con oggetto e corpo", () => {
  const m = S.mailto("a@b.it", "Oggetto X", "Corpo Y");
  assert(m.startsWith("mailto:"), m);
  assert(m.includes("subject=Oggetto%20X"));
  assert(m.includes("body=Corpo%20Y"));
});
r.ok("mailto: più destinatari separati da virgola", () => {
  const m = S.mailto(["a@b.it","c@d.it"], "x");
  assert(m.includes(","), "manca la virgola tra destinatari: " + m);
});

/* ---- Visibilità (invarianti, robuste al seed casuale) ---- */
r.ok("visibilità: nessuna bozza è visibile ai fornitori", () => {
  for (const s of S.STATE.suppliers)
    assert(!S.jobsForSupplier(s.id).some(j => j.stato === "bozza"), "bozza trapelata a " + s.id);
});
r.ok("visibilità: un lavoro 'tutti' pubblicato è visibile a ogni fornitore", () => {
  const j = S.STATE.jobs.find(x => x.stato === "pubblicato" && x.visibility === "tutti");
  assert(j, "atteso almeno un pubblicato 'tutti'");
  for (const s of S.STATE.suppliers)
    assert(S.jobsForSupplier(s.id).some(x => x.id === j.id), "non visibile a " + s.id);
});
r.ok("visibilità: 'selezionati' (non assegnato) solo agli invitati", () => {
  const j = S.STATE.jobs.find(x => x.visibility === "selezionati" && x.stato === "pubblicato" && (x.invitati||[]).length);
  assert(j, "atteso almeno un pubblicato selezionato");
  const invited = j.invitati[0];
  const outsider = S.STATE.suppliers.find(s => !j.invitati.includes(s.id));
  assert(S.jobsForSupplier(invited).some(x => x.id === j.id), "l'invitato deve vederlo");
  if (outsider) assert(!S.jobsForSupplier(outsider.id).some(x => x.id === j.id), "un estraneo non deve vederlo");
});
r.ok("visibilità: un lavoro ASSEGNATO è visibile solo all'assegnatario", () => {
  // requisito: i fornitori non vedono i lavori assegnati ad altri, neanche se 'tutti'
  const j = S.STATE.jobs.find(x => x.assegnatoA && x.visibility === "tutti" && x.stato !== "consegnato");
  assert(j, "atteso un assegnato con visibilità 'tutti'");
  assert(S.jobsForSupplier(j.assegnatoA).some(x => x.id === j.id), "l'assegnatario deve vederlo");
  const other = S.STATE.suppliers.find(s => s.id !== j.assegnatoA);
  assert(!S.jobsForSupplier(other.id).some(x => x.id === j.id), "un altro fornitore NON deve vedere un lavoro assegnato ad altri");
});

/* ---- Ritardi ---- */
r.ok("isLate: consegna superata su commessa attiva = ritardo", () => {
  const j = S.STATE.jobs.find(x => ["assegnato","in_corso"].includes(x.stato) && S.daysTo(x.dataConsegna) < 0);
  assert(j, "atteso almeno un attivo con consegna passata");
  assert.strictEqual(S.isLate(j), true);
});
r.ok("isLate: consegnato non è mai in ritardo", () => {
  for (const j of S.STATE.jobs.filter(x => x.stato === "consegnato"))
    assert.strictEqual(S.isLate(j), false);
});

/* ---- Vista massiva: filtro + ordinamento ---- */
r.ok("filteredJobs: filtro 'da assegnare' → solo pubblicati", () => {
  resetFilters(); S.App.filters.stato = "da_assegnare";
  const a = S.filteredJobs();
  assert(a.length > 0 && a.every(j => j.stato === "pubblicato"));
});
r.ok("filteredJobs: filtro 'attivi' → assegnato/in corso", () => {
  resetFilters(); S.App.filters.stato = "attivi";
  assert(S.filteredJobs().every(j => ["assegnato","in_corso"].includes(j.stato)));
});
r.ok("filteredJobs: filtro fornitore", () => {
  resetFilters(); const sid = S.STATE.jobs.find(j => j.assegnatoA).assegnatoA;
  S.App.filters.fornitore = sid;
  const a = S.filteredJobs();
  assert(a.length > 0 && a.every(j => j.assegnatoA === sid));
});
r.ok("filteredJobs: filtro 'solo ritardi'", () => {
  resetFilters(); S.App.filters.late = true;
  assert(S.filteredJobs().every(j => S.isLate(j)));
});
r.ok("filteredJobs: ricerca testuale per codice", () => {
  resetFilters(); const code = S.STATE.jobs[10].code;
  S.App.filters.q = code.toLowerCase();
  assert(S.filteredJobs().some(j => j.code === code));
});
r.ok("filteredJobs: ordinamento per consegna crescente", () => {
  resetFilters(); S.App.sort = { key: "consegna", dir: 1 };
  const a = S.filteredJobs();
  for (let i = 1; i < a.length; i++) assert(a[i-1].dataConsegna <= a[i].dataConsegna, "ordine consegna rotto");
});

/* ---- Helper puri ---- */
r.ok("relDays: oggi/domani/ieri", () => {
  assert.strictEqual(S.relDays(S.dISO(1)), "domani");
  assert.strictEqual(S.relDays(S.dISO(-1)), "ieri");
});
r.ok("fmtMoney / fmtDate / esc", () => {
  assert.strictEqual(S.fmtMoney(""), "—");
  assert.strictEqual(S.fmtDate("2026-07-21"), "21/07/2026");
  assert.strictEqual(S.esc("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;");
});
r.ok("cataloghi di dominio completi", () => {
  assert.deepStrictEqual(Object.keys(S.TIPOLOGIE).sort(), ["automazione","distribuzione","potenza"]);
  assert(S.SETTORI.length >= 6);
  assert(Object.keys(S.REQ_TYPES).includes("materiale") && Object.keys(S.REQ_TYPES).includes("dubbio"));
});

/* ---- Ruoli Righi ---- */
r.ok("ruoli: un responsabile e almeno due caposquadra con capoId valido", () => {
  const righi = S.STATE.users.filter(u => u.role === "righi");
  assert(righi.some(u => u.righiRole === "responsabile"), "manca il responsabile");
  const capi = righi.filter(u => u.righiRole === "caposquadra");
  assert(capi.length >= 2, "servono >=2 caposquadra");
  for (const c of capi) assert(S.byId(S.STATE.capi, c.capoId), "capoId non valido: " + c.capoId);
});
r.ok("isCapo: riconosce il caposquadra", () => {
  assert.strictEqual(S.isCapo({ role: "righi", righiRole: "caposquadra", capoId: "cs1" }), true);
  assert.strictEqual(S.isCapo({ role: "righi", righiRole: "responsabile" }), false);
  assert.strictEqual(S.isCapo({ role: "fornitore" }), false);
});

/* ---- Ore stimate e carico terzisti (dati solo Righi) ---- */
r.ok("ore: ogni commessa ha ore stimate numeriche > 0", () => {
  assert(S.STATE.jobs.every(j => typeof j.oreStimate === "number" && j.oreStimate > 0), "commessa senza ore");
});
r.ok("carico: activeHours somma le ore delle commesse attive del terzista", () => {
  for (const s of S.STATE.suppliers) {
    const expected = S.STATE.jobs.filter(j => ["assegnato","in_corso"].includes(j.stato) && j.assegnatoA === s.id)
      .reduce((a, j) => a + j.oreStimate, 0);
    assert.strictEqual(S.activeHours(s.id), expected, "ore attive errate per " + s.id);
  }
});
r.ok("carico: matrice mese × terzista coerente con activeHours", () => {
  const load = S.supplierMonthlyLoad();
  assert(Array.isArray(load.months) && load.months.every((m,i,a) => i===0 || a[i-1] <= m), "mesi non ordinati");
  for (const s of S.STATE.suppliers) {
    const row = load.map[s.id] || {};
    const tot = Object.values(row).reduce((a,b) => a+b, 0);
    assert.strictEqual(tot, S.activeHours(s.id), "somma mensile != totale attivo per " + s.id);
  }
});

/* ---- Import/Export CSV ---- */
r.ok("CSV: round-trip toCSV → parseCSV", () => {
  const rows = [["titolo","budget","note"], ["Quadro A","8000","linea 3"], ["Quadro B","5000","reparto"]];
  const back = S.parseCSV(S.toCSV(rows));
  assert.deepStrictEqual(back, rows);
});
r.ok("CSV: gestisce delimitatore ';' e valori con virgola/virgolette", () => {
  const rows = [["a","b"], ["x; y","testo, con virgola"]];
  const back = S.parseCSV(S.toCSV(rows));
  assert.deepStrictEqual(back, rows);
});
r.ok("CSV: import legge le intestazioni del template", () => {
  const csv = "titolo;tipologia;settore;budget;ore;data_consegna;caposquadra;visibilita\r\n"
            + "Quadro test;potenza;Vetro;9000;150;2026-09-01;Andrea Bianchi;tutti";
  const rows = S.parseCSV(csv);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1][0], "Quadro test");
  assert.strictEqual(rows[1][4], "150");
});

r.done();
