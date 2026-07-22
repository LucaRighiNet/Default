"use strict";
/* Logica di dominio del Portale Fornitori su scala reale (~40 da assegnare +
   ~150 assegnate): regole di visibilità, ritardi, filtro/ordinamento della
   vista massiva, integrità del seed, email e helper. Testate in isolamento dal
   blocco puro di index.html (Utility → filteredJobs, DOM escluso). */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============================ Utility";
const END   = "/* ============================ Render";
const EXPORTS = ["STATE","App","isLate","isLateStart","isLateReturn","keyDate","lateDays","jobsForSupplier","filteredJobs","daysTo","relDays","fmtMoney","fmtDate",
                 "dISO","addDays","supplier","capo","byId","mailto","isCapo","activeHours","supplierMonthlyLoad","monthKey",
                 "toCSV","parseCSV","supplierMetrics","freeCapacity","monthLoad","daysBetween","jobHealth","suggestSuppliers",
                 "TIPOLOGIE","STATI","SETTORI","LAVORAZIONI","LAV_KEYS","parseLavorazioni","REQ_TYPES","AVANZAMENTO","CERT","QUICK_REPLIES","esc","uid",
                 "DIMENSIONI","ATTREZZATURE","fitsSpazio","supplier"];
const S = sandbox(START, END, EXPORTS, {});
// secondo sandbox fino a "Eventi" per le funzioni-azione pure (senza DOM)
const SA = sandbox(START, "/* ============================ Eventi", ["STATE","applyDateChange","addDays",
  "consegneByMonth","pipelineStati","saluteCounts","puntualitaByMonth","tipologiaMix","capoCarico","jobHealth","isLate","monthKey"], {});
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
    assert(Array.isArray(j.lavorazioni) && j.lavorazioni.length >= 1, "lavorazioni mancanti: " + j.code);
    assert(j.lavorazioni.every(k => S.LAVORAZIONI[k]), "lavorazione non valida in " + j.code);
  }
});

/* ---- Email (nuovo canale) ---- */
r.ok("email: capisquadra hanno indirizzo; le email fornitore presenti sono valide", () => {
  assert(S.STATE.capi.every(c => /@/.test(c.email)), "caposquadra senza email");
  // dati reali: non tutti i terzisti hanno un contatto email, ma quelli presenti devono essere validi
  assert(S.STATE.suppliers.filter(s => s.email).every(s => /@/.test(s.email)), "email fornitore non valida");
  assert(S.STATE.suppliers.some(s => s.email), "nessun fornitore con email");
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
r.ok("isLate: rientro superato su commessa attiva = ritardo", () => {
  const j = S.STATE.jobs.find(x => ["assegnato","in_corso"].includes(x.stato) && S.daysTo(x.dataRientro) < 0);
  assert(j, "atteso almeno un attivo con rientro passato");
  assert.strictEqual(S.isLate(j), true);
});
r.ok("isLate: consegnato non è mai in ritardo", () => {
  for (const j of S.STATE.jobs.filter(x => x.stato === "consegnato"))
    assert.strictEqual(S.isLate(j), false);
});
r.ok("alert: isLate segue inizio/rientro, mai la consegna al cliente", () => {
  // consegna al cliente nel passato ma rientro futuro e lavori avviati -> NON in ritardo
  assert.strictEqual(S.isLate({ stato:"in_corso", dataConsegna:S.dISO(-5), dataRientro:S.dISO(10), dataInizioStimata:S.dISO(-20) }), false, "la consegna cliente non deve generare alert");
  // rientro superato su commessa attiva -> in ritardo
  assert.strictEqual(S.isLateReturn({ stato:"in_corso", dataRientro:S.dISO(-1) }), true);
  assert.strictEqual(S.isLate({ stato:"in_corso", dataRientro:S.dISO(-1), dataInizioStimata:S.dISO(-20) }), true);
  // assegnata oltre l'inizio stimato (non ancora avviata) -> ritardo di avvio
  assert.strictEqual(S.isLateStart({ stato:"assegnato", dataInizioStimata:S.dISO(-2), dataRientro:S.dISO(10) }), true);
  // in corso: la data di inizio non genera più alert di avvio
  assert.strictEqual(S.isLateStart({ stato:"in_corso", dataInizioStimata:S.dISO(-2) }), false);
});
r.ok("seed: date coerenti inizio <= rientro <= consegna al cliente", () => {
  const bad = S.STATE.jobs.filter(j => !(j.dataInizioStimata <= j.dataRientro && j.dataRientro <= j.dataConsegna));
  assert.strictEqual(bad.length, 0, bad.length + " commesse con date fuori ordine");
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
r.ok("filteredJobs: ordinamento per rientro crescente", () => {
  resetFilters(); S.App.sort = { key: "rientro", dir: 1 };
  const a = S.filteredJobs();
  for (let i = 1; i < a.length; i++) assert(S.keyDate(a[i-1]) <= S.keyDate(a[i]), "ordine rientro rotto");
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
  assert(Object.keys(S.REQ_TYPES).includes("slittamento"), "manca il tipo slittamento");
});

/* ---- Fase A/B: anagrafica categorizzata + capacità ---- */
r.ok("anagrafica: capacità sui attivi, coordinate dove c'è una sede", () => {
  for (const s of S.STATE.suppliers) {
    assert(Array.isArray(s.certificazioni) && Array.isArray(s.specialties), "array mancanti: " + s.id);
    if (s.citta) assert(typeof s.lat === "number" && typeof s.lng === "number" && s.zona, "coordinate/zona mancanti per " + s.id);
    if (s.attivo) assert(s.capacitaMese > 0, "capacità attivo non valida: " + s.id);
  }
});
r.ok("freeCapacity = capacità − carico del mese, mai > capacità", () => {
  const mk = S.monthKey(S.dISO(0));
  for (const s of S.STATE.suppliers) {
    const free = S.freeCapacity(s.id, mk);
    assert.strictEqual(free, s.capacitaMese - S.monthLoad(s.id, mk), "freeCapacity errata per " + s.id);
    assert(free <= s.capacitaMese);
  }
});
r.ok("seed: variabilità del carico dei terzisti attivi", () => {
  const att = S.STATE.suppliers.filter(s => s.attivo && s.capacitaMese > 0);
  const ratios = att.map(s => S.monthLoad(s.id, S.monthKey(S.dISO(0))) / s.capacitaMese);
  assert(Math.min(...ratios) < 0.6 && Math.max(...ratios) > 0.6, "carico non variabile: " + ratios.map(x=>x.toFixed(2)).join(","));
});

/* ---- Fase B: metriche fornitore ---- */
r.ok("supplierMetrics: campi coerenti e puntualità 0..100", () => {
  for (const s of S.STATE.suppliers) {
    const m = S.supplierMetrics(s.id);
    assert(m.puntualita === null || (m.puntualita >= 0 && m.puntualita <= 100), "puntualità fuori range");
    assert(m.consegnate >= 0 && m.commesseAttive >= 0 && m.oreAttive >= 0);
    assert(m.tassoAccett === null || (m.tassoAccett >= 0 && m.tassoAccett <= 100));
  }
});
r.ok("supplierMetrics: puntualità = rientri on-time / consegnati (vs rientro richiesto)", () => {
  const s = S.STATE.suppliers.find(x => S.STATE.jobs.some(j => j.assegnatoA === x.id && j.stato === "consegnato" && j.dataRientroEff));
  assert(s, "atteso un fornitore con rientri effettivi");
  const del = S.STATE.jobs.filter(j => j.assegnatoA === s.id && j.stato === "consegnato" && j.dataRientroEff);
  const onTime = del.filter(j => j.dataRientroEff <= j.dataRientro).length;
  assert.strictEqual(S.supplierMetrics(s.id).puntualita, Math.round(onTime / del.length * 100));
});

/* ---- Fase C: cambio data di RIENTRO (slittamento/modifica) ---- */
r.ok("applyDateChange: sovrascrive il rientro e registra lo storico", () => {
  const j = SA.STATE.jobs.find(x => ["assegnato","in_corso"].includes(x.stato) && x.assegnatoA);
  const before = j.dataRientro; const n0 = (j.storicoDate||[]).length;
  const nd = SA.addDays(before, 12);
  assert.strictEqual(SA.applyDateChange(j, nd, "test", "fornitore", j.assegnatoA), true);
  assert.strictEqual(j.dataRientro, nd, "rientro non sovrascritto");
  assert.strictEqual(j.storicoDate.length, n0 + 1, "storico non aggiornato");
  assert.strictEqual(j.storicoDate[j.storicoDate.length-1].from, before);
});
r.ok("applyDateChange: no-op se il rientro non cambia", () => {
  const j = SA.STATE.jobs.find(x => ["assegnato","in_corso"].includes(x.stato) && x.assegnatoA);
  const n0 = j.storicoDate.length;
  assert.strictEqual(SA.applyDateChange(j, j.dataRientro, "x", "fornitore", j.assegnatoA), false);
  assert.strictEqual(j.storicoDate.length, n0, "storico non deve cambiare");
});

/* ---- Fase D: semaforo + assegnazione intelligente ---- */
r.ok("jobHealth: consegnato=done, in ritardo=rosso, livelli validi", () => {
  const done = S.STATE.jobs.find(j => j.stato === "consegnato");
  if (done) assert.strictEqual(S.jobHealth(done).level, "done");
  const lateJob = S.STATE.jobs.find(j => S.isLate(j));
  if (lateJob) assert.strictEqual(S.jobHealth(lateJob).level, "rosso");
  for (const j of S.STATE.jobs) assert(["verde","giallo","rosso","done","draft"].includes(S.jobHealth(j).level));
});
r.ok("suggestSuppliers: ordinato per punteggio, overload = libere < ore", () => {
  const job = S.STATE.jobs.find(j => j.stato === "pubblicato");
  const sg = S.suggestSuppliers(job);
  assert.strictEqual(sg.length, S.STATE.suppliers.filter(s => s.accredited && s.attivo).length, "solo terzisti attivi");
  for (let i = 1; i < sg.length; i++) assert(sg[i-1].score >= sg[i].score, "non ordinato");
  for (const x of sg) assert.strictEqual(x.overload, x.free < (job.oreStimate||0));
});
r.ok("suggestSuppliers: chi è specializzato+settore batte chi non lo è", () => {
  const job = S.STATE.jobs.find(j => j.stato === "pubblicato");
  const match = S.STATE.suppliers.find(s => s.specialties.includes(job.tipologia) && s.settori.includes(job.settore));
  const noMatch = S.STATE.suppliers.find(s => !s.specialties.includes(job.tipologia) && !s.settori.includes(job.settore));
  if (match && noMatch) {
    const sg = S.suggestSuppliers(job);
    const rm = sg.find(x => x.sid === match.id), rn = sg.find(x => x.sid === noMatch.id);
    assert(rm.score > rn.score, "il match deve avere punteggio maggiore");
  }
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

/* ---- Risposte rapide + richieste con foto ---- */
r.ok("QUICK_REPLIES: template presenti", () => {
  assert(Array.isArray(S.QUICK_REPLIES) && S.QUICK_REPLIES.length >= 3);
});
r.ok("seed: una richiesta con foto e una con risposta del caposquadra", () => {
  assert(S.STATE.requests.some(x => x.foto), "manca una richiesta con foto");
  const withReply = S.STATE.requests.find(x => Array.isArray(x.risposte) && x.risposte.length);
  assert(withReply, "manca una richiesta con risposta");
  assert.strictEqual(withReply.risposte[0].da, "righi");
});

/* ---- Analisi: aggregati dei grafici (cruscotto) ---- */
r.ok("analisi/consegne: mesi ordinati e conservazione del totale", () => {
  const d = SA.consegneByMonth();
  assert(d.months.length >= 1, "nessun mese");
  const sorted = d.months.slice().sort();
  assert.deepStrictEqual(d.months, sorted, "mesi non ordinati");
  let sum = 0; d.months.forEach(m => { const v = d.map[m]; sum += v.da + v.att + v.cons; });
  // ogni commessa ha una data di consegna -> la somma copre tutte le commesse
  assert.strictEqual(sum, SA.STATE.jobs.length, "somma mesi != totale commesse: " + sum);
  const maxTot = Math.max(...d.months.map(m => { const v = d.map[m]; return v.da + v.att + v.cons; }));
  assert.strictEqual(d.max, maxTot, "max non coerente");
});
r.ok("analisi/consegne: i bucket rispecchiano lo stato reale", () => {
  const d = SA.consegneByMonth();
  const da = Object.values(d.map).reduce((a, v) => a + v.da, 0);
  const att = Object.values(d.map).reduce((a, v) => a + v.att, 0);
  assert.strictEqual(da, SA.STATE.jobs.filter(j => ["bozza","da_approvare","pubblicato"].includes(j.stato)).length);
  assert.strictEqual(att, SA.STATE.jobs.filter(j => ["assegnato","in_corso"].includes(j.stato)).length);
});
r.ok("analisi/pipeline: somma per stato = totale, righe a zero escluse", () => {
  const d = SA.pipelineStati();
  const sum = d.rows.reduce((a, r) => a + r.n, 0);
  assert.strictEqual(sum, SA.STATE.jobs.length, "pipeline non conserva il totale");
  assert(d.rows.every(r => r.n > 0), "riga a zero non filtrata");
  const pub = d.rows.find(r => r.st === "pubblicato");
  assert(pub && pub.n === SA.STATE.jobs.filter(j => j.stato === "pubblicato").length);
});
r.ok("analisi/salute: verde+giallo+rosso = commesse attive", () => {
  const d = SA.saluteCounts();
  assert.strictEqual(d.verde + d.giallo + d.rosso, d.tot, "somma semaforo != attive");
  const attive = SA.STATE.jobs.filter(j => ["pubblicato","assegnato","in_corso"].includes(j.stato)).length;
  assert.strictEqual(d.tot, attive, "tot attive errato");
  assert.strictEqual(d.late, SA.STATE.jobs.filter(SA.isLate).length, "ritardi errati");
});
r.ok("analisi/puntualità: solo consegne con data effettiva, % coerente", () => {
  const d = SA.puntualitaByMonth();
  const deliv = SA.STATE.jobs.filter(j => ["consegnato","chiuso"].includes(j.stato) && j.dataRientroEff);
  assert.strictEqual(d.tot, deliv.length, "conteggio consegne errato");
  assert(d.tot > 0, "il seed deve avere consegne registrate");
  d.months.forEach(m => { const v = d.map[m]; assert(v.ok + v.late > 0, "mese vuoto: " + m); });
});
r.ok("analisi/mix: tre tipologie, somma = totale", () => {
  const d = SA.tipologiaMix();
  assert.strictEqual(d.rows.length, 3, "tipologie != 3");
  assert.strictEqual(d.rows.reduce((a, r) => a + r.n, 0), SA.STATE.jobs.length);
});
r.ok("analisi/capisquadra: somma attive = commesse assegnate/in corso, ordinate desc", () => {
  const d = SA.capoCarico();
  const attive = SA.STATE.jobs.filter(j => ["assegnato","in_corso"].includes(j.stato)).length;
  assert.strictEqual(d.rows.reduce((a, r) => a + r.n, 0), attive, "carico capi != attive");
  for (let i = 1; i < d.rows.length; i++) assert(d.rows[i].n <= d.rows[i-1].n, "non ordinate desc");
});

/* ---- Lavorazioni industrializzate (multi-selezione) ---- */
r.ok("lavorazioni: cinque opzioni previste", () => {
  assert.strictEqual(S.LAV_KEYS.length, 5);
  ["carp_esterna","foratura","piastra_barre","sbroglio","piastra_comp"].forEach(k =>
    assert(S.LAVORAZIONI[k] && S.LAVORAZIONI[k].label, "manca lavorazione: " + k));
});
r.ok("lavorazioni: le commesse possono averne più d'una", () => {
  assert(S.STATE.jobs.some(j => j.lavorazioni.length >= 2), "nessuna commessa multi-lavorazione");
});
r.ok("parseLavorazioni: accetta chiavi, etichette e separatori misti", () => {
  assert.deepStrictEqual(S.parseLavorazioni("foratura|sbroglio"), ["foratura","sbroglio"]);
  assert.deepStrictEqual(S.parseLavorazioni("Foratura piastre, Sbroglio fili"), ["foratura","sbroglio"]);
  assert.deepStrictEqual(S.parseLavorazioni("piastra_barre / piastra_comp"), ["piastra_barre","piastra_comp"]);
});
r.ok("parseLavorazioni: ignora valori sconosciuti e duplicati, vuoto -> []", () => {
  assert.deepStrictEqual(S.parseLavorazioni(""), []);
  assert.deepStrictEqual(S.parseLavorazioni("foratura|foratura|xyz"), ["foratura"]);
});
r.ok("import CSV: la colonna 'lavorazioni' entra come array valido", () => {
  const csv = "titolo;tipologia;settore;lavorazioni;budget;ore;data_consegna;caposquadra;visibilita\r\n"
            + "Quadro test;potenza;Vetro;foratura|piastra_comp;9000;150;2026-09-01;Andrea Bianchi;tutti";
  const rows = S.parseCSV(csv);
  assert.strictEqual(rows[1][3], "foratura|piastra_comp");
  assert.deepStrictEqual(S.parseLavorazioni(rows[1][3]), ["foratura","piastra_comp"]);
});

/* ---- Capacità operative: spazio/ingombro + attrezzature ---- */
r.ok("capacità operative: ogni fornitore ha dimensioneMax e attrezzature", () => {
  assert(S.STATE.suppliers.every(s => S.DIMENSIONI[s.dimensioneMax] && Array.isArray(s.attrezzature)),
    "fornitore senza dimensioneMax/attrezzature valide");
});
r.ok("spazio: fitsSpazio confronta l'ingombro richiesto con la capacità del fornitore", () => {
  assert.strictEqual(S.fitsSpazio({dimensioneMax:"l"}, "l"), true);
  assert.strictEqual(S.fitsSpazio({dimensioneMax:"s"}, "l"), false, "s non deve reggere l");
  assert.strictEqual(S.fitsSpazio({dimensioneMax:"m"}, "s"), true);
  assert.strictEqual(S.fitsSpazio({dimensioneMax:"s"}, null), true, "senza requisito passa sempre");
});
r.ok("assegnazione intelligente: chi ha spazio insufficiente è penalizzato e segnalato", () => {
  const anyDate = S.STATE.jobs[0].dataConsegna;
  const job = {tipologia:"potenza", settore:"Vetro", dataConsegna:anyDate, oreStimate:100, ingombro:"l", capoId:"cs1"};
  const res = S.suggestSuppliers(job);
  // i terzisti attivi la cui dimensione non regge 'l' devono essere segnalati
  const tooSmall = res.filter(r => { const s=S.supplier(r.sid); return s && S.DIMENSIONI[s.dimensioneMax].ord < 3; });
  assert(tooSmall.length > 0, "attesi terzisti con ingombro < l");
  tooSmall.forEach(r => { assert.strictEqual(r.spazioOk, false); assert(r.reasons.includes("spazio insuff.")); });
  const big = res.find(r => (S.supplier(r.sid)||{}).dimensioneMax === "l");
  if (big) assert.strictEqual(big.spazioOk, true, "un fornitore grande deve adattarsi");
});
r.ok("preferenze OTL: la % del file entra nel punteggio di suggerimento", () => {
  const anyDate = S.STATE.jobs[0].dataConsegna;
  // AEG ha 60% per Smeraldi (cs4): con job del suo OTL, pref>0 e reason presente
  const aeg = S.STATE.suppliers.find(s => s.name === "AEG");
  const job = {tipologia:"automazione", settore:"Packaging", dataConsegna:anyDate, oreStimate:100, ingombro:null, capoId:"cs4"};
  const r4 = S.suggestSuppliers(job).find(x => x.sid === aeg.id);
  assert(r4 && r4.pref === 60, "pref OTL cs4 attesa 60, ottenuto " + (r4&&r4.pref));
  assert(r4.reasons.includes("preferito OTL"), "manca reason preferito OTL");
  // con un OTL per cui AEG ha 0% (cs2), nessun bonus preferenza
  const job2 = {...job, capoId:"cs2"};
  const r2 = S.suggestSuppliers(job2).find(x => x.sid === aeg.id);
  assert.strictEqual(r2.pref, 0);
});

/* ---- Workflow di approvazione (caposquadra -> responsabile) ---- */
r.ok("approvazione: il seed contiene commesse 'da approvare' inviate dai capisquadra", () => {
  const da = SA.STATE.jobs.filter(j => j.stato === "da_approvare");
  assert(da.length >= 1, "nessuna commessa da approvare nel seed");
  assert(da.every(j => j.richiedente && j.capoId), "da_approvare senza richiedente/capoId");
});
r.ok("approvazione: 'da_approvare' è uno stato noto e non visibile ai fornitori", () => {
  assert(SA.STATE, "state assente");
  const S2 = S; // usa il sandbox con STATI/jobsForSupplier
  assert(S2.STATI && S2.STATI.da_approvare, "STATI manca da_approvare");
  // un fornitore non deve mai vedere una commessa da approvare
  const da = S2.STATE.jobs.find(j => j.stato === "da_approvare");
  if (da) for (const sup of S2.STATE.suppliers)
    assert(!S2.jobsForSupplier(sup.id).some(j => j.id === da.id), "fornitore vede una da_approvare");
});
r.ok("approvazione: la pipeline include lo stato 'da approvare'", () => {
  assert(SA.pipelineStati().rows.some(r => r.st === "da_approvare"), "pipeline senza da_approvare");
});

/* ---- Firma leggera dell'accettazione ---- */
r.ok("firma: ogni accettazione del seed è firmata (nome + timestamp)", () => {
  const accs = S.STATE.responses.filter(r => r.tipo === "accettazione");
  assert(accs.length > 0, "nessuna accettazione nel seed");
  assert(accs.every(r => r.firma && r.firma.nome && r.firma.ts), "accettazione senza firma");
});
r.ok("firma: il nominativo firmato corrisponde al fornitore", () => {
  const one = S.STATE.responses.find(r => r.tipo === "accettazione");
  assert.strictEqual(one.firma.nome, S.supplier(one.supplierId).name);
});

r.done();
