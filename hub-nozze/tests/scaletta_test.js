"use strict";
/* SCALETTA — condivisione read-only autocontenuta nell'URL: encode/decode/payload. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "function rsvpParam(";
const END = "/* ============ EVENTS ============ */";
const EXPORTS = ["encodeScaletta","decodeScaletta","scalettaData","scalettaParam","rsTimeKey"];

let evState = { meta:{}, runshow:[] };
const S = sandbox(START, END, EXPORTS, {
  ev: () => evState, meta: () => evState.meta, musicUrl: u => u||""
});
const r = runner("scaletta_test");

r.ok("encode/decode: round-trip integro", () => {
  const obj={ a:"Righi", b:"Biondi", d:"2027-07-17", v:"Castello", r:[{t:"16:00",m:"Cerimonia",w:"Officiante",p:"https://x/y"}] };
  assert.deepStrictEqual(S.decodeScaletta(S.encodeScaletta(obj)), obj);
});
r.ok("encode: base64url pulito (niente + / =)", () => {
  const obj={ a:"A", b:"B", d:"", v:"", r:[{t:"1",m:"mmmm????",w:"",p:""}] };
  assert(!/[+/=]/.test(S.encodeScaletta(obj)));
});
r.ok("encode/decode: accenti e unicode conservati", () => {
  const obj={ a:"Niçòla", b:"È", d:"", v:"Città", r:[{t:"18:30",m:"Aperitivo à la française 🥂",w:"",p:""}] };
  assert.deepStrictEqual(S.decodeScaletta(S.encodeScaletta(obj)), obj);
});
r.ok("decode: input non valido -> null", () => {
  assert.strictEqual(S.decodeScaletta("§§§ non base64"), null);
  assert.strictEqual(S.decodeScaletta(""), null);
});
r.ok("scalettaData: filtra i vuoti, ordina per ora, chiavi corte", () => {
  evState = { meta:{coupleA:"Righi",coupleB:"Biondi",date:"2027-07-17",venue:"Benelli"}, runshow:[
    {id:"r2",time:"18:30",title:"Aperitivo",who:"Catering",playlist:"https://open.spotify.com/x"},
    {id:"r1",time:"16:00",title:"Cerimonia",who:"Officiante",playlist:""},
    {id:"r0",time:"",title:"",who:"",playlist:""}
  ]};
  const d=S.scalettaData();
  assert.strictEqual(d.a,"Righi"); assert.strictEqual(d.v,"Benelli");
  assert.strictEqual(d.r.length, 2);
  assert.deepStrictEqual(d.r.map(x=>x.t), ["16:00","18:30"]);
  assert.strictEqual(d.r[1].p, "https://open.spotify.com/x");
});
r.ok("scalettaParam: estrae il parametro dall'URL", () => {
  // scalettaParam legge location.search dell'ambiente: nel sandbox location non
  // esiste -> ritorna null senza crashare (try/catch).
  assert.strictEqual(S.scalettaParam(), null);
});
r.ok("scalettaData: nessuna scaletta -> lista vuota", () => {
  evState = { meta:{coupleA:"A",coupleB:"B"}, runshow:[] };
  assert.strictEqual(S.scalettaData().r.length, 0);
});

r.ok("scalettaData: ordina col 'giorno delle nozze' (01:00 dopo 23:00)", () => {
  evState = { meta:{}, runshow:[
    {id:"a",time:"01:00",title:"Chiusura",who:"Navetta"},
    {id:"b",time:"16:00",title:"Cerimonia",who:""},
    {id:"c",time:"23:00",title:"Ballo",who:""}
  ]};
  const d=S.scalettaData();
  assert.deepStrictEqual(d.r.map(x=>x.t), ["16:00","23:00","01:00"]);
});

r.done();
