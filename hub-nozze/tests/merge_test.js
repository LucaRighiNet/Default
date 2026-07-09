"use strict";
/* MERGE P2 — merge a 3 vie per entita': due dispositivi che modificano
   contemporaneamente dalla stessa base non si sovrascrivono piu'. */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "const DIAG_KEY=";
const END = "/* ============ SEED";
const EXPORTS = ["merge3","Sync","makeMemoryRemote"];
const S = sandbox(START, END, EXPORTS, {});

let __pass = 0, __fail = 0, __q = [];
const ok = (n, f) => __q.push([n, f]);
async function run(){
  for (const [n, f] of __q){ try{ await f(); __pass++; } catch(e){ __fail++; console.error("  FAIL [merge_test] " + n + " :: " + e.message); } }
  console.log("merge_test: " + __pass + "/" + (__pass + __fail) + (__fail ? "  (" + __fail + " FAIL)" : ""));
  if (__fail) process.exitCode = 1;
}
const D=x=>JSON.parse(JSON.stringify(x)); // deep clone

// base di lavoro: un evento con vendors e payments
function mkBase(){
  return { _savedAt:100, events:{ ev1:{
    vendors:[{id:"v1",name:"Foto",quote:1000,status:"valutazione"},{id:"v2",name:"DJ",quote:800,status:"opzione"}],
    payments:[{id:"p1",label:"Caparra",amount:2000,paid:false},{id:"p2",label:"Saldo",amount:5000,paid:false}],
    meta:{venue:"Castello", plannedGuests:180}
  }}};
}

ok("entita' DIVERSE modificate dai due lati -> sopravvivono entrambe", () => {
  const base=mkBase();
  const a=D(base); a._savedAt=200; a.events.ev1.vendors[0].quote=1500;          // dispositivo A: fornitore
  const b=D(base); b._savedAt=210; b.events.ev1.payments[0].paid=true;          // dispositivo B: pagamento
  const m=S.merge3(base,a,b,200,210);
  assert.strictEqual(m.events.ev1.vendors[0].quote,1500,"modifica fornitore persa");
  assert.strictEqual(m.events.ev1.payments[0].paid,true,"modifica pagamento persa");
});
ok("aggiunte da entrambe le parti -> convivono", () => {
  const base=mkBase();
  const a=D(base); a.events.ev1.vendors.push({id:"vA",name:"Fiorista",quote:300});
  const b=D(base); b.events.ev1.payments.push({id:"pB",label:"Extra",amount:100,paid:false});
  const m=S.merge3(base,a,b,200,210);
  assert(m.events.ev1.vendors.some(v=>v.id==="vA"),"aggiunta locale persa");
  assert(m.events.ev1.payments.some(p=>p.id==="pB"),"aggiunta remota persa");
  assert.strictEqual(m.events.ev1.vendors.length,3);
});
ok("cancellazione da un lato, non toccata dall'altro -> resta cancellata", () => {
  const base=mkBase();
  const a=D(base); a.events.ev1.vendors=a.events.ev1.vendors.filter(v=>v.id!=="v2"); // A cancella DJ
  const b=D(base); b.events.ev1.payments[1].amount=5500;                              // B tocca altro
  const m=S.merge3(base,a,b,200,210);
  assert(!m.events.ev1.vendors.some(v=>v.id==="v2"),"cancellazione non rispettata");
  assert.strictEqual(m.events.ev1.payments[1].amount,5500);
});
ok("cancellazione vs MODIFICA della stessa entita' -> vince la modifica", () => {
  const base=mkBase();
  const a=D(base); a.events.ev1.vendors=a.events.ev1.vendors.filter(v=>v.id!=="v2"); // A cancella DJ
  const b=D(base); b.events.ev1.vendors[1].status="confermato";                       // B lo conferma
  const m=S.merge3(base,a,b,200,210);
  const dj=m.events.ev1.vendors.find(v=>v.id==="v2");
  assert(dj && dj.status==="confermato","la modifica doveva vincere sulla cancellazione");
});
ok("stessa entita', CAMPI diversi -> merge campo per campo", () => {
  const base=mkBase();
  const a=D(base); a.events.ev1.vendors[0].quote=1500;   // A cambia il preventivo
  const b=D(base); b.events.ev1.vendors[0].status="confermato"; // B lo stato
  const m=S.merge3(base,a,b,200,210);
  assert.strictEqual(m.events.ev1.vendors[0].quote,1500);
  assert.strictEqual(m.events.ev1.vendors[0].status,"confermato");
});
ok("STESSO campo modificato da entrambi -> vince il timestamp piu' recente", () => {
  const base=mkBase();
  const a=D(base); a.events.ev1.vendors[0].quote=1500;
  const b=D(base); b.events.ev1.vendors[0].quote=1700;
  let m=S.merge3(base,a,b,200,210);   // b piu' recente
  assert.strictEqual(m.events.ev1.vendors[0].quote,1700);
  m=S.merge3(base,a,b,300,210);       // a piu' recente
  assert.strictEqual(m.events.ev1.vendors[0].quote,1500);
});
ok("meta: campi scalari fusi (venue da A, plannedGuests da B)", () => {
  const base=mkBase();
  const a=D(base); a.events.ev1.meta.venue="Borgo";
  const b=D(base); b.events.ev1.meta.plannedGuests=150;
  const m=S.merge3(base,a,b,200,210);
  assert.strictEqual(m.events.ev1.meta.venue,"Borgo");
  assert.strictEqual(m.events.ev1.meta.plannedGuests,150);
});
ok("identici o cambiato un solo lato -> nessuna sorpresa", () => {
  const base=mkBase();
  assert.deepStrictEqual(S.merge3(base,D(base),D(base),1,2), D(base));
  const a=D(base); a.events.ev1.meta.venue="Borgo";
  assert.deepStrictEqual(S.merge3(base,a,D(base),1,2).events.ev1.meta.venue,"Borgo");
  assert.deepStrictEqual(S.merge3(base,D(base),a,1,2).events.ev1.meta.venue,"Borgo");
});

// ---- flusso Sync completo con antenato: conflitto -> merge pubblicato ----
ok("Sync: conflitto con antenato -> pubblica il MERGE (entrambe le modifiche)", async () => {
  const r = S.makeMemoryRemote();
  const base=mkBase();
  let adopted=null;
  S.Sync.enable(r, { version: 0, onRemoteWin: st=>{ adopted=st; } });
  await S.Sync.flush(base);                          // v1 = antenato condiviso (BASE={1,base})
  // "dispositivo B" pubblica sopra v1 la sua modifica ai pagamenti -> remoto a v2
  const docB=D(base); docB._savedAt=210; docB.events.ev1.payments[0].paid=true;
  await r.push(1, JSON.stringify(docB));
  // il locale (fermo a v1) modifica i FORNITORI e pubblica -> conflitto -> merge v3
  const docA=D(base); docA._savedAt=220; docA.events.ev1.vendors[0].quote=1500;
  await S.Sync.flush(docA);
  const got=JSON.parse((await r.pull()).data);
  assert.strictEqual(got.events.ev1.vendors[0].quote,1500,"modifica locale persa nel merge");
  assert.strictEqual(got.events.ev1.payments[0].paid,true,"modifica remota persa nel merge");
  assert(adopted && adopted.events.ev1.payments[0].paid===true && adopted.events.ev1.vendors[0].quote===1500,"il locale deve adottare il merge completo");
  assert.strictEqual(S.Sync.getStatus(),"synced");
  assert.strictEqual(S.Sync.version(),3,"il merge deve stare a v3");
  S.Sync.disable();
});
ok("Sync: dopo il merge, un nuovo push normale non riapre conflitti", async () => {
  const r = S.makeMemoryRemote();
  const base=mkBase();
  S.Sync.enable(r, { version: 0, onRemoteWin: ()=>{} });
  await S.Sync.flush(base);                                   // v1
  const docB=D(base); docB._savedAt=210; docB.events.ev1.payments[0].paid=true;
  await r.push(1, JSON.stringify(docB));                      // v2 (altro device)
  const docA=D(base); docA._savedAt=220; docA.events.ev1.vendors[0].quote=1500;
  await S.Sync.flush(docA);                                   // conflitto -> merge v3
  const merged=JSON.parse((await r.pull()).data);
  merged._savedAt=300; merged.events.ev1.meta.venue="Borgo";  // modifica successiva dal merge
  await S.Sync.flush(merged);                                 // push liscio v4
  assert.strictEqual(S.Sync.version(),4);
  const got=JSON.parse((await r.pull()).data);
  assert.strictEqual(got.events.ev1.meta.venue,"Borgo");
  assert.strictEqual(got.events.ev1.payments[0].paid,true);
  assert.strictEqual(got.events.ev1.vendors[0].quote,1500);
  S.Sync.disable();
});
ok("Sync: senza antenato valido -> fallback LWW (comportamento precedente)", async () => {
  const r = S.makeMemoryRemote();
  await r.push(0, JSON.stringify({ _savedAt: 2000, events: { src: "remoto" } })); // v1
  let won=null;
  S.Sync.enable(r, { version: 0, onRemoteWin: st=>{ won=st; } }); // BASE assente per v0
  await S.Sync.flush({ _savedAt: 1000, events: { src: "locale" } });
  assert(won && won.events.src==="remoto","fallback LWW: remoto piu' recente doveva vincere");
  S.Sync.disable();
});

run();
