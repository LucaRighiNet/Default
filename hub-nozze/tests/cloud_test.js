"use strict";
/* P1 groundwork — adapter Supabase (contro un fake client), auth mock, Cloud dry-run.
   Verifica la LOGICA dell'adapter (pull/insert/update/conflict) senza backend reale. */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "const DIAG_KEY=";
const END = "/* ============ SEED";
const EXPORTS = ["makeSupabaseRemote","makeMockAuth","Cloud","Sync","makeMemoryRemote"];
const S = sandbox(START, END, EXPORTS, {});

// Fake supabase-js: replica il query builder per i soli metodi usati dall'adapter.
function makeFakeSupabase(){
  const rows = []; // {event_id, version, data, updated_at}
  function pick(r, cols){ if(!cols) return Object.assign({}, r); const o={}; cols.split(",").forEach(c=>{ o[c.trim()]=r[c.trim()]; }); return o; }
  function builder(){
    let op="select", cols=null, filters={}, values=null;
    function match(r){ return Object.keys(filters).every(k=>String(r[k])===String(filters[k])); }
    function exec(){
      if(op==="select"){ const r=rows.find(match); return { data: r?pick(r,cols):null, error:null }; }
      if(op==="update"){ const r=rows.find(match); if(!r) return { data:null, error:null }; Object.assign(r, values); return { data:pick(r,cols), error:null }; }
      if(op==="insert"){ if(rows.find(x=>x.event_id===values.event_id)) return { data:null, error:{message:"duplicate key"} }; rows.push(Object.assign({}, values)); return { data:pick(values,cols), error:null }; }
      return { data:null, error:null };
    }
    const api={ select(c){ cols=c; return api; }, update(v){ op="update"; values=v; return api; }, insert(v){ op="insert"; values=v; return api; }, eq(k,v){ filters[k]=v; return api; }, maybeSingle(){ return Promise.resolve(exec()); } };
    return api;
  }
  return { from(){ return builder(); }, _rows:rows };
}

let P=0,F=0,Q=[]; const ok=(n,f)=>Q.push([n,f]);
async function run(){ for(const [n,f] of Q){ try{ await f(); P++; } catch(e){ F++; console.error("  FAIL [cloud_test] "+n+" :: "+e.message); } } console.log("cloud_test: "+P+"/"+(P+F)+(F?"  ("+F+" FAIL)":"")); if(F) process.exitCode=1; }

ok("makeSupabaseRemote: pull null quando non esiste la riga", async () => {
  const r=S.makeSupabaseRemote(makeFakeSupabase(), "ev1");
  assert.strictEqual(await r.pull(), null);
});
ok("makeSupabaseRemote: primo push -> insert v1, poi pull lo trova", async () => {
  const fake=makeFakeSupabase(); const r=S.makeSupabaseRemote(fake, "ev1");
  const p=await r.push(0, '{"events":{"a":1}}');
  assert.deepStrictEqual(p, { ok:true, version:1 });
  const got=await r.pull();
  assert.strictEqual(got.version, 1);
  assert.strictEqual(JSON.parse(got.data).events.a, 1);
});
ok("makeSupabaseRemote: update con versione giusta -> ok, versione avanza", async () => {
  const fake=makeFakeSupabase(); const r=S.makeSupabaseRemote(fake, "ev1");
  await r.push(0, "A");                  // v1
  const p=await r.push(1, "B");          // v2
  assert.deepStrictEqual(p, { ok:true, version:2 });
  assert.strictEqual((await r.pull()).data, "B");
});
ok("makeSupabaseRemote: push con base stale -> conflict con stato remoto", async () => {
  const fake=makeFakeSupabase(); const r=S.makeSupabaseRemote(fake, "ev1");
  await r.push(0, "A");                   // v1
  await r.push(1, "B");                   // v2
  const c=await r.push(1, "C");           // base 1, remoto 2 -> conflict
  assert.strictEqual(c.conflict, true);
  assert.strictEqual(c.version, 2);
  assert.strictEqual(c.data, "B");
});
ok("makeSupabaseRemote: eventi diversi isolati", async () => {
  const fake=makeFakeSupabase();
  const r1=S.makeSupabaseRemote(fake,"evA"), r2=S.makeSupabaseRemote(fake,"evB");
  await r1.push(0,"A1"); await r2.push(0,"B1");
  assert.strictEqual((await r1.pull()).data,"A1");
  assert.strictEqual((await r2.pull()).data,"B1");
});
ok("makeMockAuth: signIn/getUser/signOut", async () => {
  const a=S.makeMockAuth();
  assert.strictEqual(a.getUser(), null);
  const u=await a.signIn("luca@esempio.it");
  assert(u.email==="luca@esempio.it" && a.getUser());
  await a.signOut();
  assert.strictEqual(a.getUser(), null);
});
ok("Cloud.login: non configurato -> errore", async () => {
  S.Cloud.logout && await S.Cloud.logout();
  let threw=false;
  try{ await S.Cloud.login("x@y.it"); }catch(e){ threw=true; }
  assert.strictEqual(threw, true);
});
ok("Cloud dry-run: login (mock) abilita Sync e pubblica lo stato locale al primo accesso", async () => {
  const remote=S.makeMemoryRemote();
  S.Cloud.configure(S.makeMockAuth(), remote);
  const res=await S.Cloud.login("sposi@esempio.it");
  assert(res.user && res.user.email==="sposi@esempio.it");
  assert.strictEqual(res.cloudState, null);      // remote vuoto al primo accesso
  assert.strictEqual(S.Sync.isEnabled(), true);
  await S.Sync.flush({ events:{ seed:1 } });      // simula il push del client
  assert.strictEqual((await remote.pull()).version, 1);
  await S.Cloud.logout();
  assert.strictEqual(S.Sync.isEnabled(), false);
});
ok("Cloud dry-run: login con stato già nel cloud -> lo restituisce", async () => {
  const remote=S.makeMemoryRemote();
  await remote.push(0, JSON.stringify({ events:{ cloud:42 } }));  // stato preesistente nel cloud
  S.Cloud.configure(S.makeMockAuth(), remote);
  const res=await S.Cloud.login("altro@esempio.it");
  assert(res.cloudState && res.cloudState.events.cloud===42);
  await S.Cloud.logout();
});
ok("Cloud.resume: sessione presente -> riabilita Sync e tira giù il cloud", async () => {
  const remote=S.makeMemoryRemote();
  await remote.push(0, JSON.stringify({ events:{ cloud:7 } }));
  // auth con sessione già valida (simula supabase-js che ha persistito il login)
  const auth={ name:"mock", async signIn(){ return {id:"u1",email:"a@b.it"}; }, async signOut(){}, async sessionUser(){ return {id:"u1",email:"a@b.it"}; } };
  S.Cloud.configure(auth, remote);
  const res=await S.Cloud.resume();
  assert(res && res.user && res.user.email==="a@b.it");
  assert(res.cloudState && res.cloudState.events.cloud===7);
  assert.strictEqual(S.Sync.isEnabled(), true);
  await S.Cloud.logout();
});
ok("Cloud.resume: nessuna sessione -> null, Sync resta spento", async () => {
  const remote=S.makeMemoryRemote();
  const auth={ name:"mock", async signIn(){ return null; }, async signOut(){}, async sessionUser(){ return null; } };
  S.Cloud.configure(auth, remote);
  const res=await S.Cloud.resume();
  assert.strictEqual(res, null);
  assert.strictEqual(S.Sync.isEnabled(), false);
});

run();
