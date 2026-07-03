"use strict";
/* B1 — modello dati posti: forme, vicinati, ingombro, validazione. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const SEAT_START = "const SEAT_SHAPES=";
const SEAT_END = "/* ---- planimetria SVG nativa (B3) ---- */";
const EXPORTS = ["seatColRow","seatAdjacency","seatPairs","seatFootprint","seatValidateSerpentine",
  "seatHeadAt","seatableGuests","seatTableOf","seatPurgeGuest","SEAT_SHAPES","SEAT_CFG"];

let evState = { guests: [], tables: [], seating: { rules: [] } };
const S = sandbox(SEAT_START, SEAT_END, EXPORTS, { ev: () => evState });

const r = runner("b1_test");

r.ok("SEAT_SHAPES: 5 forme attese", () => {
  assert.deepStrictEqual(Object.keys(S.SEAT_SHAPES).sort(),
    ["imperial","rect","round","serpentine","square"]);
});
r.ok("seatColRow: modello 2 file", () => {
  assert.deepStrictEqual(S.seatColRow(0), { col:0, row:0 });
  assert.deepStrictEqual(S.seatColRow(1), { col:0, row:1 });
  assert.deepStrictEqual(S.seatColRow(2), { col:1, row:0 });
  assert.deepStrictEqual(S.seatColRow(5), { col:2, row:1 });
});
r.ok("seatAdjacency(4): face reciproco", () => {
  const a = S.seatAdjacency(4);
  assert.strictEqual(a[0].face, 1);
  assert.strictEqual(a[1].face, 0);
  assert.strictEqual(a[2].face, 3);
  assert.strictEqual(a[3].face, 2);
});
r.ok("seatAdjacency(4): side per fila", () => {
  const a = S.seatAdjacency(4);
  assert.deepStrictEqual(a[0].side, [2]);
  assert.deepStrictEqual(a[2].side, [0]);
});
r.ok("seatAdjacency(2): nessun side, face presente", () => {
  const a = S.seatAdjacency(2);
  assert.strictEqual(a[0].face, 1);
  assert.deepStrictEqual(a[0].side, []);
});
r.ok("seatPairs(4): 4 coppie uniche con pesi", () => {
  const p = S.seatPairs(4);
  assert.strictEqual(p.length, 4);
  const m = new Set(p.map(x => x.a+"-"+x.b+"@"+x.w));
  assert(m.has("0-1@"+S.SEAT_CFG.faceWeight));
  assert(m.has("2-3@"+S.SEAT_CFG.faceWeight));
  assert(m.has("0-2@"+S.SEAT_CFG.sideWeight));
  assert(m.has("1-3@"+S.SEAT_CFG.sideWeight));
});
r.ok("seatPairs: a<b sempre (chiavi normalizzate)", () => {
  S.seatPairs(8).forEach(p => assert(p.a < p.b));
});
r.ok("seatFootprint: dimensioni positive per ogni forma", () => {
  ["round","square","rect","imperial","serpentine"].forEach(shape => {
    const f = S.seatFootprint({ shape, seats: 10 });
    assert(f.w > 0 && f.h > 0 && f.lin > 0, "forma " + shape);
  });
});
r.ok("seatFootprint: round è ~quadrato (w==h), rect no", () => {
  const ro = S.seatFootprint({ shape:"round", seats:8 });
  assert(near0(ro.w - ro.h), "round w!=h");
  const re = S.seatFootprint({ shape:"rect", seats:8 });
  assert(re.w !== re.h, "rect w==h inatteso");
  function near0(x){ return Math.abs(x) < 1e-9; }
});
r.ok("seatFootprint: più posti -> tavolo più grande", () => {
  const a = S.seatFootprint({ shape:"round", seats:6 });
  const b = S.seatFootprint({ shape:"round", seats:12 });
  assert(b.lin > a.lin);
});
r.ok("seatValidateSerpentine: non-serpentina -> nessun issue", () => {
  assert.deepStrictEqual(S.seatValidateSerpentine({ shape:"round", seats:4, seatIds:[] }), []);
});
r.ok("seatValidateSerpentine: overflow posti", () => {
  const iss = S.seatValidateSerpentine({ shape:"serpentine", seats:2, seatIds:["a","b","c"] });
  assert(iss.some(x => /più persone/.test(x)));
});
r.ok("seatValidateSerpentine: persona duplicata", () => {
  const iss = S.seatValidateSerpentine({ shape:"serpentine", seats:4, seatIds:["a","a",null,null] });
  assert(iss.some(x => /duplicata/.test(x)));
});
r.ok("seatValidateSerpentine: persona inesistente", () => {
  const exists = id => id === "a";
  const iss = S.seatValidateSerpentine({ shape:"serpentine", seats:4, seatIds:["a","z",null,null] }, exists);
  assert(iss.some(x => /inesistente/.test(x)));
});
r.ok("seatHeadAt: conta i posti non nulli", () => {
  assert.strictEqual(S.seatHeadAt({ seatIds:["a",null,"b",null] }), 2);
  assert.strictEqual(S.seatHeadAt({ seatIds:[] }), 0);
});
r.ok("seatTableOf: trova il tavolo che contiene il gid", () => {
  evState = { guests:[], tables:[
    { id:"t1", seatIds:["g1",null] },
    { id:"t2", seatIds:[null,"g2"] }
  ], seating:{rules:[]} };
  assert.strictEqual(S.seatTableOf("g2").id, "t2");
  assert.strictEqual(S.seatTableOf("gX"), undefined);
});
r.ok("seatableGuests: solo conf/attesa", () => {
  evState = { guests:[
    { id:"a", rsvp:"conf" }, { id:"b", rsvp:"attesa" },
    { id:"c", rsvp:"no" }, { id:"d", rsvp:"conf" }
  ], tables:[], seating:{rules:[]} };
  const list = S.seatableGuests().map(g => g.id).sort();
  assert.deepStrictEqual(list, ["a","b","d"]);
});

r.ok("seatPurgeGuest: azzera i posti dell'ospite e rimuove le sue regole", () => {
  const tables = [
    { id:"t1", seatIds:["gA","gDEAD",null] },
    { id:"t2", seatIds:[null,"gDEAD"] }
  ];
  const rules = [
    { id:"r1", a:"gDEAD", b:"gA", kind:"together" },
    { id:"r2", a:"gB", b:"gC", kind:"separate" },
    { id:"r3", a:"gX", b:"gDEAD", kind:"separate" }
  ];
  const out = S.seatPurgeGuest(tables, rules, "gDEAD");
  assert.deepStrictEqual(tables[0].seatIds, ["gA", null, null], "posto t1 non azzerato");
  assert.deepStrictEqual(tables[1].seatIds, [null, null], "posto t2 non azzerato");
  assert.deepStrictEqual(out.map(r => r.id), ["r2"], "regole orfane non rimosse");
});
r.ok("seatPurgeGuest: ospite non presente -> nessun effetto", () => {
  const tables = [{ id:"t1", seatIds:["gA", null] }];
  const rules = [{ id:"r1", a:"gA", b:"gB", kind:"together" }];
  const out = S.seatPurgeGuest(tables, rules, "gZZZ");
  assert.deepStrictEqual(tables[0].seatIds, ["gA", null]);
  assert.strictEqual(out.length, 1);
});

r.done();
