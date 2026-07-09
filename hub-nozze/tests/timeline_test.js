"use strict";
/* TIMELINE — collegamento attività checklist <-> fornitori: mappa titolo->categoria,
   auto-spunta su fornitore confermato, fornitore mostrato. */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "function taskDone(t){";
const END = "function genChecklist(){";
const EXPORTS = ["taskDone","taskVendor","TASK_VENDORCAT"];
let evState = { vendors: [] };
const S = sandbox(START, END, EXPORTS, { ev: () => evState });

let __pass = 0, __fail = 0, __q = [];
const ok = (n, f) => __q.push([n, f]);
function run(){
  for (const [n, f] of __q){ try{ f(); __pass++; } catch(e){ __fail++; console.error("  FAIL [timeline_test] " + n + " :: " + e.message); } }
  console.log("timeline_test: " + __pass + "/" + (__pass + __fail) + (__fail ? "  (" + __fail + " FAIL)" : ""));
  if (__fail) process.exitCode = 1;
}

// Le stesse categorie fornitore usate nella scheda Fornitori (VCATS).
const VCATS=["Location","Catering","Fiori","Foto/Video","Musica/DJ","Intrattenimento","Torta","Trasporti/Navetta","Beauty","Allestimenti","Officiante/Pratiche","Altro"];

ok("TASK_VENDORCAT: mappa attesa, tutte categorie valide (VCATS)", () => {
  const m = S.TASK_VENDORCAT;
  assert.strictEqual(m["Scegliere foto e video"], "Foto/Video");
  assert.strictEqual(m["Scegliere musica / DJ"], "Musica/DJ");
  assert.strictEqual(m["Fiori e allestimenti"], "Fiori");
  assert.strictEqual(m["Scegliere torta"], "Torta");
  assert.strictEqual(m["Confermare navetta e trasporti"], "Trasporti/Navetta");
  Object.keys(m).forEach(k => assert(VCATS.indexOf(m[k])>=0, "categoria fuori VCATS: "+m[k]));
});
ok("taskDone: attività con vendorCat si spunta se esiste fornitore confermato di quella categoria", () => {
  evState.vendors = [{ name:"FotoStudio", category:"Foto/Video", status:"confermato" }];
  assert.strictEqual(S.taskDone({ title:"Scegliere foto e video", vendorCat:"Foto/Video", done:false }), true);
});
ok("taskDone: NON si spunta se il fornitore è solo in opzione/valutazione", () => {
  evState.vendors = [{ name:"FotoStudio", category:"Foto/Video", status:"opzione" }];
  assert.strictEqual(S.taskDone({ title:"Scegliere foto e video", vendorCat:"Foto/Video", done:false }), false);
});
ok("taskDone: categoria diversa non spunta", () => {
  evState.vendors = [{ name:"DJ Mario", category:"Musica/DJ", status:"confermato" }];
  assert.strictEqual(S.taskDone({ vendorCat:"Foto/Video", done:false }), false);
});
ok("taskDone: attività senza vendorCat dipende solo da done", () => {
  evState.vendors = [];
  assert.strictEqual(S.taskDone({ title:"Ordinare bomboniere", done:false }), false);
  assert.strictEqual(S.taskDone({ title:"Ordinare bomboniere", done:true }), true);
});
ok("taskDone: done manuale vince comunque", () => {
  evState.vendors = [];
  assert.strictEqual(S.taskDone({ vendorCat:"Foto/Video", done:true }), true);
});
ok("taskVendor: restituisce il fornitore confermato collegato, altrimenti null", () => {
  evState.vendors = [{ name:"FotoStudio", category:"Foto/Video", status:"confermato" }];
  assert.strictEqual(S.taskVendor({ vendorCat:"Foto/Video" }).name, "FotoStudio");
  evState.vendors = [{ name:"FotoStudio", category:"Foto/Video", status:"opzione" }];
  assert.strictEqual(S.taskVendor({ vendorCat:"Foto/Video" }), null);
  assert.strictEqual(S.taskVendor({ title:"senza categoria" }), null);
});

run();
