"use strict";
/* Suoni del portale: si testa la SINTESI, non il fatto che una funzione esista.
   Il blocco Sfx di index.html gira in un sandbox con un finto Web Audio che
   registra ogni voce generata (forma d'onda, frequenza, attacco, durata, picco
   di volume). Da quella registrazione si verificano le regole di progetto:
   una sola scala, durate brevi, volumi bassi, direzione = significato, e
   soprattutto che ogni funzionalità suoni in modo DIVERSO dalle altre. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

/* ---- Finto Web Audio: registra le voci invece di suonarle ---------------- */
function fakeAudio() {
  const voci = [];          // {wave, freq, t0, t1, picco}
  let clock = 0;
  const gainOf = new Map(); // oscillatore/sorgente -> nodo gain a valle

  const param = (node, nome) => ({
    value: 0,
    setValueAtTime(v, t) { node.ev.push([nome, v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { node.ev.push([nome, v, t]); return this; },
    linearRampToValueAtTime(v, t) { node.ev.push([nome, v, t]); return this; },
  });
  const picco = g => g ? Math.max(0, ...g.ev.filter(e => e[0] === "gain").map(e => e[1])) : 0;

  function nodo(kind) {
    const n = { kind, ev: [], connect(dst) { gainOf.set(n, dst); return dst; } };
    return n;
  }

  const AC = function () {
    const c = {
      sampleRate: 44100,
      state: "running",
      destination: nodo("dest"),
      get currentTime() { return clock; },
      resume() { c.state = "running"; },
      createGain() { const g = nodo("gain"); g.gain = param(g, "gain"); return g; },
      createBiquadFilter() { const b = nodo("bq"); b.type = ""; b.Q = { value: 0 }; b.frequency = param(b, "freq"); return b; },
      createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; },
      createOscillator() {
        const o = nodo("osc"); o.type = "sine"; o.frequency = param(o, "freq");
        o.start = t => { o._t0 = t; };
        o.stop = t => {
          const f = (o.ev.find(e => e[0] === "freq") || [, 0])[1];
          voci.push({ wave: o.type, freq: f, t0: o._t0, t1: t, picco: picco(gainOf.get(o)) });
        };
        return o;
      },
      createBufferSource() {
        const s = nodo("src"); s.buffer = null;
        s.start = t => { s._t0 = t; };
        s.stop = t => {
          // il soffio passa dal filtro: il gain è due nodi più a valle
          const g = gainOf.get(gainOf.get(s));
          voci.push({ wave: "noise", freq: 0, t0: s._t0, t1: t, picco: picco(g) });
        };
        return s;
      },
    };
    return c;
  };
  return { AC, voci, avanza(sec) { clock += sec; }, ora() { return clock; }, reset() { voci.length = 0; } };
}

const fa = fakeAudio();
const mem = {};
const FakeStorage = { get: k => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; } };
const S = sandbox("/* ============================== Suoni", "/* ===================== Sync seam",
  ["Sfx", "SFXKEY"], { window: { AudioContext: fa.AC }, Storage: FakeStorage });

const r = runner("sfx_test");
// Suona un nome e restituisce le voci nell'ordine in cui sono state generate.
function suona(nome) {
  fa.reset(); fa.avanza(1);                    // il tempo avanza: mai bloccato dall'anti-raffica
  const ok = S.Sfx.play(nome);
  return { ok, voci: fa.voci.slice() };
}
/* Ricostruisce le NOTE dalle voci. Ogni nota è emessa come coppia adiacente
   (fondamentale + ottava di rinforzo, stesso istante d'attacco); il soffio di
   rumore non è una nota. Non basta dedurre "il doppio di" dall'insieme delle
   frequenze: nell'assegnazione il DO acuto è insieme nota propria e ottava
   del DO grave, e confonderli falsa tutte le verifiche a valle. */
function note(voci) {
  const out = [];
  for (let i = 0; i < voci.length; i++) {
    const a = voci[i]; if (a.wave === "noise") continue;
    const b = voci[i + 1];
    const coppia = !!(b && b.wave !== "noise" && Math.abs(b.freq - a.freq * 2) < 1 && Math.abs(b.t0 - a.t0) < 1e-9);
    out.push({ freq: a.freq, t0: a.t0, t1: a.t1, ottava: coppia });
    if (coppia) i++;                            // l'ottava è già consumata
  }
  return out.sort((x, y) => x.t0 - y.t0);
}
const fondamentali = voci => note(voci).map(n => n.freq);
const melodia = voci => note(voci).map(n => n.freq);   // già in ordine d'ascolto

const PENTA = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51]; // DO RE MI SOL LA
const ATTESI = ["assegnazione", "accettazione", "approvazione", "rifiuto", "pubblicazione", "completato",
  "avanzamento", "notifica", "messaggio", "richiesta", "email", "tocco", "avviso"];

/* ---- Repertorio ---- */
r.ok("repertorio: ci sono tutti i suoni previsti", () => {
  assert.deepStrictEqual(S.Sfx.nomi().slice().sort(), ATTESI.slice().sort());
});
r.ok("ogni suono genera davvero delle voci (nessun suono vuoto)", () => {
  for (const n of ATTESI) {
    const s = suona(n);
    assert(s.ok, n + ": play() non ha suonato");
    assert(s.voci.length > 0, n + ": nessuna voce generata");
  }
});
r.ok("nome sconosciuto: non suona nulla", () => {
  fa.reset(); fa.avanza(1);
  assert.strictEqual(S.Sfx.play("inesistente"), false);
  assert.strictEqual(fa.voci.length, 0);
});

/* ---- Regola 1-2: una sola voce timbrica, una sola scala ---- */
r.ok("una sola scala: tutte le note stanno nella pentatonica di DO", () => {
  for (const n of ATTESI) for (const f of fondamentali(suona(n).voci))
    assert(PENTA.some(p => Math.abs(p - f) < 0.5), n + ": nota fuori scala " + f.toFixed(2) + " Hz");
});
r.ok("una sola voce: solo sine/triangle, più il soffio di rumore", () => {
  for (const n of ATTESI) for (const v of suona(n).voci)
    assert(["sine", "triangle", "noise"].includes(v.wave), n + ": forma d'onda estranea " + v.wave);
});
r.ok("ogni nota porta la sua ottava di rinforzo", () => {
  for (const n of ATTESI) for (const x of note(suona(n).voci))
    assert(x.ottava, n + ": manca l'ottava di rinforzo su " + x.freq.toFixed(0) + " Hz");
});

/* ---- Regola 4: la durata è il peso ---- */
r.ok("suoni brevi: nessuno supera 1 secondo", () => {
  for (const n of ATTESI) {
    const v = suona(n).voci, dur = Math.max(...v.map(x => x.t1)) - Math.min(...v.map(x => x.t0));
    assert(dur <= 1.0, n + ": dura " + dur.toFixed(2) + " s");
  }
});
r.ok("solo l'assegnazione ha la coda lunga (>0,55 s)", () => {
  const dur = n => { const v = suona(n).voci; return Math.max(...v.map(x => x.t1)) - Math.min(...v.map(x => x.t0)); };
  assert(dur("assegnazione") > 0.55, "assegnazione troppo corta");
  for (const n of ATTESI) if (n !== "assegnazione")
    assert(dur(n) <= 0.55, n + " ruba spazio all'assegnazione: " + dur(n).toFixed(2) + " s");
});
r.ok("il tocco è il più breve di tutti", () => {
  const dur = n => { const v = suona(n).voci; return Math.max(...v.map(x => x.t1)) - Math.min(...v.map(x => x.t0)); };
  for (const n of ATTESI) if (n !== "tocco") assert(dur("tocco") <= dur(n), "tocco più lungo di " + n);
});

/* ---- Regola 6: volumi bassi ---- */
r.ok("volumi sotto controllo: nessuna voce oltre 0,20", () => {
  for (const n of ATTESI) for (const v of suona(n).voci)
    assert(v.picco > 0 && v.picco <= 0.2001, n + ": picco " + v.picco);
});
r.ok("attacco rapido ma senza clic: la rampa parte da un valore udibile", () => {
  for (const n of ATTESI) for (const v of suona(n).voci) assert(v.t1 > v.t0, n + ": voce a durata nulla");
});

/* ---- Regola 3: la direzione è il significato ---- */
r.ok("ascendenti: assegnazione, accettazione, approvazione, avanzamento, richiesta, notifica", () => {
  for (const n of ["assegnazione", "accettazione", "approvazione", "avanzamento", "richiesta", "notifica"]) {
    const m = melodia(suona(n).voci);
    for (let i = 1; i < m.length; i++) assert(m[i] > m[i - 1], n + ": non sale (" + m.join(" ") + ")");
  }
});
r.ok("discendenti: rifiuto e avviso", () => {
  for (const n of ["rifiuto", "avviso"]) {
    const m = melodia(suona(n).voci);
    assert(m.length >= 2, n + ": serve più di una nota per dare la direzione");
    for (let i = 1; i < m.length; i++) assert(m[i] < m[i - 1], n + ": non scende (" + m.join(" ") + ")");
  }
});
r.ok("completato risolve verso l'alto (parte grave, finisce acuto)", () => {
  const m = melodia(suona("completato").voci);
  assert(m[m.length - 1] > m[0], "completato non risolve in alto");
});

/* ---- Regola 5: l'assegnazione è l'eroe ---- */
r.ok("assegnazione: terzina che risolve sull'ottava, con soffio", () => {
  const v = suona("assegnazione").voci;
  assert(v.some(x => x.wave === "noise"), "manca il soffio");
  const m = melodia(v);
  assert.strictEqual(m.length, 4, "servono 4 note, trovate " + m.length);
  assert(Math.abs(m[3] - m[0] * 2) < 1, "non risolve sull'ottava della prima nota");
});
r.ok("assegnazione: è il suono con più voci di tutti", () => {
  const n = suona("assegnazione").voci.length;
  for (const x of ATTESI) if (x !== "assegnazione")
    assert(suona(x).voci.length < n, x + " ha almeno tante voci quante l'assegnazione");
});

/* ---- Distintività: il punto della richiesta ---- */
r.ok("ogni funzionalità ha una firma sonora diversa da tutte le altre", () => {
  const firme = new Map();
  for (const n of ATTESI) {
    const v = suona(n).voci, t0 = Math.min(...v.map(x => x.t0));
    const f = v.map(x => x.wave + "@" + (x.t0 - t0).toFixed(3) + ":" + x.freq.toFixed(0) + ":" + (x.t1 - x.t0).toFixed(3)).join("|");
    assert(!firme.has(f), n + " suona identico a " + firme.get(f));
    firme.set(f, n);
  }
});
r.ok("i due suoni di esito (approvazione/rifiuto) partono dalla stessa nota", () => {
  assert.strictEqual(melodia(suona("approvazione").voci)[0], melodia(suona("rifiuto").voci)[0]);
});

/* ---- Interruttore e persistenza ---- */
r.ok("spento: non suona niente e non rompe nulla", () => {
  S.Sfx.set(false); fa.reset(); fa.avanza(1);
  assert.strictEqual(S.Sfx.play("assegnazione"), false);
  assert.strictEqual(fa.voci.length, 0);
  assert.strictEqual(S.Sfx.enabled, false);
  S.Sfx.set(true);
});
r.ok("la preferenza si salva e si rilegge", () => {
  S.Sfx.set(false); assert.strictEqual(mem[S.SFXKEY], "0");
  S.Sfx.set(true); assert.strictEqual(mem[S.SFXKEY], "1");
});
r.ok("toggle inverte lo stato", () => {
  const p = S.Sfx.enabled;
  assert.strictEqual(S.Sfx.toggle(), !p);
  assert.strictEqual(S.Sfx.toggle(), p);
});

/* ---- Anti-raffica e esito del toast ---- */
r.ok("doppio clic: lo stesso suono non si somma a sé stesso", () => {
  fa.reset(); fa.avanza(1);
  assert.strictEqual(S.Sfx.play("tocco"), true);
  fa.avanza(0.02);
  assert.strictEqual(S.Sfx.play("tocco"), false, "il secondo tocco ravvicinato è passato");
  fa.avanza(0.5);
  assert.strictEqual(S.Sfx.play("tocco"), true, "dopo la pausa deve tornare a suonare");
});
r.ok("il toast 'ok' non suona, il toast 'warn' suona l'avviso", () => {
  fa.avanza(1); assert.strictEqual(S.Sfx.esito("ok"), false);
  fa.avanza(1); assert.strictEqual(S.Sfx.esito(), false);
  fa.reset(); fa.avanza(1);
  assert.strictEqual(S.Sfx.esito("warn"), true);
  assert(fa.voci.length > 0, "l'avviso non ha generato voci");
});
r.ok("l'avviso non raddoppia il suono di un'azione che ha già suonato", () => {
  fa.avanza(1); S.Sfx.play("rifiuto");
  fa.avanza(0.05); fa.reset();
  assert.strictEqual(S.Sfx.esito("warn"), false, "avviso sovrapposto al rifiuto");
  assert.strictEqual(fa.voci.length, 0);
});
r.ok("spento: nemmeno il toast 'warn' suona", () => {
  S.Sfx.set(false); fa.reset(); fa.avanza(1);
  assert.strictEqual(S.Sfx.esito("warn"), false);
  assert.strictEqual(fa.voci.length, 0);
  S.Sfx.set(true);
});

/* ---- Ambiente senza audio (Node, browser vecchi) ---- */
r.ok("senza Web Audio il portale non si rompe", () => {
  const S2 = sandbox("/* ============================== Suoni", "/* ===================== Sync seam",
    ["Sfx"], { window: {}, Storage: { get: () => null, set: () => { } } });
  assert.strictEqual(S2.Sfx.play("assegnazione"), false);
  assert.strictEqual(S2.Sfx.esito("warn"), false);
  assert.strictEqual(S2.Sfx.enabled, true);   // la preferenza resta leggibile
});

r.done();
