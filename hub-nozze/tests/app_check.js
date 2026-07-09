
"use strict";
(function(){
// Versione visibile della build (ingranaggio -> prima riga). Serve a capire al
// volo quale versione sta girando su un dispositivo (cache vs deploy).
const APP_BUILD="2026-07-09.12";

/* ============ DIAGNOSTICA / ERROR TRACKING (P0) ============ */
// Senza backend gli errori di produzione sarebbero invisibili. Diag li cattura in
// un buffer limitato, persistente (chiave separata) e ispezionabile dalla voce
// "Diagnostica" nel menù. In P1/P3 qui si aggancerà l'invio a un servizio remoto.
const DIAG_KEY="hub_diag_v1", DIAG_MAX=25;
const Diag=(function(){
  let buf=[], reporter=null;
  function persist(){ try{ if(typeof localStorage!=="undefined") localStorage.setItem(DIAG_KEY, JSON.stringify(buf.slice(-DIAG_MAX))); }catch(e){} }
  try{ if(typeof localStorage!=="undefined"){ const r=localStorage.getItem(DIAG_KEY); if(r) buf=JSON.parse(r)||[]; } }catch(e){ buf=[]; }
  return {
    log(kind,msg,extra){ const ent={t:new Date().toISOString(),kind:String(kind||"error"),msg:String(msg||"").slice(0,300),extra:extra?String(extra).slice(0,600):""}; buf.push(ent); if(buf.length>DIAG_MAX) buf=buf.slice(-DIAG_MAX); persist(); if(reporter){ try{ reporter(ent); }catch(e){} } },
    // Seam per l'osservabilità remota (es. Sentry) in P3: dormiente finché non impostato.
    setReporter(fn){ reporter=(typeof fn==="function")?fn:null; },
    list(){ return buf.slice(); },
    clear(){ buf=[]; persist(); },
    exportText(){ return buf.map(e=>e.t+" ["+e.kind+"] "+e.msg+(e.extra?" | "+e.extra:"")).join("\n"); }
  };
})();
if(typeof window!=="undefined"){
  window.addEventListener("error", function(e){ Diag.log("error", e.message, (e.filename||"")+":"+(e.lineno||"")); });
  window.addEventListener("unhandledrejection", function(e){ Diag.log("promise", (e.reason&&e.reason.message)||String(e.reason||"rejection"), e.reason&&e.reason.stack); });
}

/* ============ STORAGE (adapter astratto: local-first, pronto per backend remoto) ============ */
// L'app resta local-first. StorageAdapter isola il MEZZO di persistenza dietro
// un'interfaccia async (get/set/remove); Store gestisce debounce, flush, hardening
// e la scelta dell'adapter. In P1 si aggiunge un adapter remoto/sync via
// Store.useAdapter(...) senza toccare i chiamanti (render/commit/INIT invariati).
const KEY="hub_state_v1", BAK_KEY="hub_state_v1_bak";
let memState=null, saveTimer=null;
const memMap={};
function makeWindowStorageAdapter(){ return { name:"window.storage",
  async get(){ const r=await window.storage.get(KEY); return r&&r.value ? r.value : null; },
  async set(v){ await window.storage.set(KEY, v); },
  async remove(){ try{ await window.storage.set(KEY, ""); }catch(e){} } }; }
function makeLocalStorageAdapter(){ return { name:"localStorage",
  async get(){ return localStorage.getItem(KEY); },
  async set(v){ localStorage.setItem(KEY, v); },
  async remove(){ localStorage.removeItem(KEY); } }; }
function makeMemoryAdapter(){ return { name:"memory",
  async get(){ return memMap[KEY]!=null?memMap[KEY]:null; },
  async set(v){ memMap[KEY]=v; },
  async remove(){ delete memMap[KEY]; } }; }
// Feature detection (non user-agent): window.storage (Claude.ai) → localStorage → RAM.
function detectLocalAdapter(){
  try{ if(typeof window!=="undefined" && window.storage && typeof window.storage.get==="function" && typeof window.storage.set==="function") return makeWindowStorageAdapter(); }catch(e){}
  try{ if(typeof localStorage!=="undefined"){ const p="__hub_probe__"; localStorage.setItem(p,"1"); localStorage.removeItem(p); return makeLocalStorageAdapter(); } }catch(e){}
  return makeMemoryAdapter();
}
// Validazione minima dello stato caricato: deve avere la forma attesa.
function isValidState(s){ return !!(s && typeof s==="object" && s.events && typeof s.events==="object"); }
const Store={
  adapter: detectLocalAdapter(),
  get backend(){ return this.adapter.name; },
  // Seam per P1: aggancia un adapter remoto/sync senza cambiare i chiamanti.
  useAdapter(a){ if(a && typeof a.get==="function" && typeof a.set==="function") this.adapter=a; return this.adapter; },
  async load(){
    let raw=null;
    try{ raw=await this.adapter.get(); }catch(e){ Diag.log("storage","load get fallita", e&&e.message); }
    if(raw==null) return memState;
    let parsed;
    try{ parsed=JSON.parse(raw); }
    catch(e){ this._backupCorrupt(raw, "JSON illeggibile: "+(e&&e.message)); return memState; }
    if(!isValidState(parsed)){ this._backupCorrupt(raw, "forma stato non valida"); return memState; }
    return parsed;
  },
  // Non perdere mai dati: uno stato illeggibile viene messo da parte, non sovrascritto in silenzio.
  _backupCorrupt(raw, why){
    Diag.log("storage", "stato illeggibile, salvato backup", why);
    try{ if(typeof localStorage!=="undefined") localStorage.setItem(BAK_KEY, raw); }catch(e){}
  },
  save(state){
    // Timbro affidabile per il Last-Write-Wins tra dispositivi: la modifica piu'
    // recente (questo _savedAt) vince in caso di conflitto. Vedi Sync._push.
    try{ if(state) state._savedAt=Date.now(); }catch(e){}
    memState=state;
    clearTimeout(saveTimer);
    const self=this;
    saveTimer=setTimeout(function(){ Promise.resolve(self.adapter.set(JSON.stringify(state))).catch(function(e){ Diag.log("storage","save fallita", e&&e.message); }); },250);
    try{ if(typeof Sync!=="undefined") Sync.notify(state); }catch(e){} // sync dormiente finché non abilitato
  },
  // Scrittura immediata di una save in sospeso: chiude la finestra di 250ms in cui
  // una chiusura/reload perderebbe l'ultima modifica.
  flush(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; }
    if(memState!=null){ try{ Promise.resolve(this.adapter.set(JSON.stringify(memState))).catch(function(e){ Diag.log("storage","flush fallito", e&&e.message); }); }catch(e){ Diag.log("storage","flush fallito", e&&e.message); } }
  }
};

/* ---- Merge a 3 vie per singola entita' (P2). base = antenato comune (l'ultimo
   stato sincronizzato), a = locale, b = remoto. Regole:
   - cambiato solo da una parte -> vince quella parte;
   - oggetti: merge campo per campo (ricorsivo);
   - array di entita' con id (budget, payments, guests, vendors, tasks, ...):
     merge per id — aggiunte da entrambe le parti convivono, la MODIFICA vince
     sulla cancellazione, stessa entita' modificata da entrambi -> merge ricorsivo;
   - scalari/array semplici modificati da entrambi -> vince il documento col
     timestamp (_savedAt) piu' recente (LWW deterministico, come prima). ---- */
function merge3(base, a, b, aTs, bTs, _depth){
  _depth=_depth||0;
  if(_depth>64) return (bTs>aTs)?b:a; // paracadute: profondita' anomala -> LWW
  const J=x=>JSON.stringify(x);
  const Ja=J(a), Jb=J(b), J0=J(base);
  if(Ja===Jb) return a;
  if(Ja===J0) return b;   // ha cambiato solo il remoto
  if(Jb===J0) return a;   // ha cambiato solo il locale
  const isObj=x=>x&&typeof x==="object"&&!Array.isArray(x);
  const isIdArr=x=>Array.isArray(x)&&x.length>0&&x.every(e=>e&&typeof e==="object"&&!Array.isArray(e)&&e.id!=null);
  if(isObj(a)&&isObj(b)){
    const b0=isObj(base)?base:{};
    const out={}, keys=new Set(Object.keys(a).concat(Object.keys(b)).concat(Object.keys(b0)));
    keys.forEach(function(k){
      const inA=Object.prototype.hasOwnProperty.call(a,k), inB=Object.prototype.hasOwnProperty.call(b,k);
      const bk=Object.prototype.hasOwnProperty.call(b0,k)?b0[k]:undefined;
      if(inA&&inB){ out[k]=merge3(bk,a[k],b[k],aTs,bTs,_depth+1); }
      else if(inA){ if(!(bk!==undefined && J(a[k])===J(bk))) out[k]=a[k]; } // b ha tolto: se a non l'ha toccato, resta tolto
      else if(inB){ if(!(bk!==undefined && J(b[k])===J(bk))) out[k]=b[k]; }
    });
    return out;
  }
  if((isIdArr(a)||isIdArr(b)) && Array.isArray(a) && Array.isArray(b)){
    const byId=arr=>{ const m=new Map(); (Array.isArray(arr)?arr:[]).forEach(e=>{ if(e&&typeof e==="object"&&e.id!=null) m.set(e.id,e); }); return m; };
    const m0=byId(base), mA=byId(a), mB=byId(b);
    const out=[], seen=new Set();
    const put=(id,val)=>{ if(!seen.has(id)){ seen.add(id); out.push(val); } };
    mA.forEach(function(ea,id){
      const eb=mB.get(id), e0=m0.get(id);
      if(eb!==undefined){ put(id, merge3(e0,ea,eb,aTs,bTs,_depth+1)); }
      else if(e0===undefined){ put(id, ea); }              // aggiunta locale
      else if(J(ea)!==J(e0)){ put(id, ea); }               // remoto ha cancellato ma locale ha modificato -> vince la modifica
      /* else: cancellata dal remoto e non toccata qui -> resta cancellata */
    });
    mB.forEach(function(eb,id){
      if(mA.has(id)) return;
      const e0=m0.get(id);
      if(e0===undefined){ put(id, eb); }                    // aggiunta remota
      else if(J(eb)!==J(e0)){ put(id, eb); }                // locale ha cancellato ma remoto ha modificato -> vince la modifica
    });
    return out;
  }
  return (bTs>aTs)?b:a; // conflitto non componibile: LWW sul timestamp documento
}

/* ============ SYNC (scaffolding P1: local-first + backend remoto) ============ */
// DORMIENTE finché Sync.enable(remote) non viene chiamato (in P1, dopo il login).
// RemoteAdapter (contratto):
//   pull() -> {version:int, data:string} | null
//   push(baseVersion:int, data:string) -> {ok:true, version:int}
//                                       | {conflict:true, version:int, data:string}
// v1: sync dell'intero documento evento con versione + last-writer-wins (policy
// pluggabile via onConflict). Multi-editor concorrente fitto -> per-entità/CRDT (P2).
const Sync=(function(){
  let remote=null, enabled=false, baseVersion=0, pushTimer=null, onConflict=null, onStatus=null, onRemoteWin=null;
  let status="local", pendingStr=null;   // status: local|synced|syncing|offline (niente "conflict" persistente)
  let _syncBusy=false, _lastSyncNow=0;   // guardie syncNow: niente doppioni ne' raffiche
  let _pushing=false, _queuedStr=null;   // un solo push in volo; le raffiche si fondono nell'ultimo
  let _statusSince=0;                     // da quanto siamo nello stato corrente (per il chip)
  let _debounceMs=1200, _graceMs=800;     // raffiche coalescate; "Sincronizzo..." solo se dura
  // Antenato comune per il merge P2: l'ultimo stato SINCRONIZZATO {v, data}.
  // Persistito per sopravvivere ai riavvii (il conflitto tipico nasce proprio
  // alla riapertura). Senza antenato valido si ricade nel LWW.
  const BASE_KEY="hub_state_base_v1";
  let BASE=null;
  function setBase(v, data){ BASE={v:v, data:data}; try{ if(typeof localStorage!=="undefined") localStorage.setItem(BASE_KEY, JSON.stringify(BASE)); }catch(e){} }
  function loadBase(){ try{ if(typeof localStorage!=="undefined"){ const raw=localStorage.getItem(BASE_KEY); if(raw){ const o=JSON.parse(raw); if(o&&typeof o.v==="number"&&typeof o.data==="string") BASE=o; } } }catch(e){ BASE=null; } }
  function setStatus(s){ if(s!==status){ status=s; _statusSince=Date.now(); } if(onStatus){ try{ onStatus(s); }catch(e){} } }
  // Timestamp affidabile per la risoluzione dei conflitti: lo stato porta _savedAt
  // (impostato da Store.save a ogni modifica). Chi ha salvato piu' di recente vince.
  function savedAt(str){ try{ const o=JSON.parse(str); return (o&&+o._savedAt)||0; }catch(e){ return 0; } }
  // Contenuto identico all'ultimo stato sincronizzato? (il timbro _savedAt cambia
  // a ogni save: va ignorato nel confronto). Evita upload fotocopia.
  function _norm(str){ return String(str).replace(/"_savedAt":\d+/, '"_savedAt":0'); }
  function _sameAsBase(str){ return !!(BASE && BASE.data && _norm(BASE.data)===_norm(str)); }
  function _push(str){
    if(!enabled||!remote) return Promise.resolve();
    // GUARDIA IN VOLO: mai due push sovrapposti. Un secondo push partirebbe con
    // versione gia' vecchia -> conflitto con se stessi -> merge -> altro upload
    // (era la causa del "Sincronizzo..." continuo dopo una raffica di modifiche).
    // Il contenuto nuovo si accoda e VIAGGERA' UNA VOLTA SOLA a fine volo.
    if(_pushing){ _queuedStr=str; pendingStr=str; return Promise.resolve(); }
    _pushing=true;
    pendingStr=str; setStatus("syncing");
    const myBase=baseVersion; // versione da cui partono le MIE modifiche
    return Promise.resolve(remote.push(baseVersion, str)).then(function(res){
      if(res&&res.ok){ baseVersion=res.version; pendingStr=null; setBase(res.version, str); setStatus("synced"); }
      else if(res&&res.conflict){
        // CONFLITTO = un altro dispositivo ha avanzato la versione.
        baseVersion=res.version;
        const localTs=savedAt(str), remoteTs=savedAt(res.data);
        if(onConflict){ try{ onConflict(res); }catch(e){} }
        // P2: se ho l'antenato comune di QUESTA modifica, fondo per entita':
        // le modifiche di entrambi i dispositivi convivono.
        if(BASE && BASE.v===myBase){
          try{
            const merged=merge3(JSON.parse(BASE.data), JSON.parse(str), JSON.parse(res.data), localTs, remoteTs);
            if(typeof isValidState==="function" && !isValidState(merged)) throw new Error("merge non valido");
            const mstr=JSON.stringify(merged);
            pendingStr=mstr; // se il push del merge fallisse, il retry ripubblica il MERGE
            return Promise.resolve(remote.push(baseVersion, mstr)).then(function(r2){
              if(r2&&r2.ok){
                baseVersion=r2.version; pendingStr=null; setBase(r2.version, mstr); setStatus("synced");
                // adotto localmente il risultato fuso (contiene anche le modifiche remote)
                if(mstr!==str && onRemoteWin){ try{ onRemoteWin(JSON.parse(mstr), r2.version); }catch(e){ Diag.log("sync","merge adopt", e&&e.message); } }
              }
            });
          }catch(err){ Diag.log("sync","merge fallito, fallback LWW", err&&err.message); pendingStr=str; }
        }
        // Fallback (nessun antenato valido): LWW deterministico su _savedAt.
        if(remoteTs>localTs){
          pendingStr=null; setBase(res.version, res.data); setStatus("synced");
          if(onRemoteWin){ try{ const st=JSON.parse(res.data); onRemoteWin(st, res.version); }catch(e){ Diag.log("sync","remote win parse", e&&e.message); } }
          return;
        }
        return Promise.resolve(remote.push(baseVersion, str)).then(function(r2){ if(r2&&r2.ok){ baseVersion=r2.version; pendingStr=null; setBase(r2.version, str); setStatus("synced"); } });
      }
    }).catch(function(e){ Diag.log("sync","push fallita (offline?)", e&&e.message); setStatus("offline"); })
      .then(function(r){ _pushing=false; if(_queuedStr!=null){ const q=_queuedStr; _queuedStr=null; if(!_sameAsBase(q)) return _push(q); pendingStr=null; } return r; });
  }
  return {
    isEnabled(){ return enabled; },
    version(){ return baseVersion; },
    getStatus(){ return enabled?status:"local"; },
    // Stato per la UI: un push lampo non deve far sfarfallare "Sincronizzo...".
    displayStatus(){ if(!enabled) return "local"; if(status==="syncing" && (Date.now()-_statusSince)<_graceMs) return "synced"; return status; },
    hasPending(){ return pendingStr!=null; },
    enable(r, opts){ remote=r; enabled=!!r; opts=opts||{}; onConflict=opts.onConflict||null; onStatus=opts.onStatus||null; onRemoteWin=opts.onRemoteWin||null; baseVersion=opts.version||0; pendingStr=null; BASE=null; loadBase(); _syncBusy=false; _lastSyncNow=0; _pushing=false; _queuedStr=null; _debounceMs=opts.debounceMs||1200; _graceMs=(opts.graceMs!=null?opts.graceMs:800); setStatus("synced"); return this; },
    disable(){ enabled=false; remote=null; pendingStr=null; setStatus("local"); },
    pull(){
      if(!enabled||!remote) return Promise.resolve(null);
      setStatus("syncing");
      return Promise.resolve(remote.pull()).then(function(res){
        setStatus("synced");
        if(res){ baseVersion=res.version; setBase(res.version, res.data); try{ return JSON.parse(res.data); }catch(e){ Diag.log("sync","pull JSON illeggibile"); return null; } }
        return null;
      }).catch(function(e){ Diag.log("sync","pull fallita", e&&e.message); setStatus("offline"); return null; });
    },
    // Sincronizzazione al ritorno in primo piano: se ho modifiche locali in coda le
    // pubblico, altrimenti CONTROLLO SOLO LA VERSIONE (head, pochi byte) e scarico
    // il documento intero solo se il cloud e' davvero avanti. Con guardia
    // anti-doppione: focus e visibilitychange spesso scattano insieme.
    syncNow(){
      if(!enabled||!remote) return Promise.resolve();
      const now=Date.now();
      if(_syncBusy || (now-_lastSyncNow)<3000) return Promise.resolve(); // in corso o appena fatta
      _lastSyncNow=now;
      if(pendingStr!=null) return this.retry();
      _syncBusy=true; setStatus("syncing");
      const fetchIfAhead=function(){
        if(typeof remote.head==="function"){
          return Promise.resolve(remote.head()).then(function(h){
            if(!h || Number(h.version)<=baseVersion) return null;   // nessuna novita': ~0.3KB e stop
            return Promise.resolve(remote.pull());
          });
        }
        return Promise.resolve(remote.pull()); // remote senza head: comportamento classico
      };
      return fetchIfAhead().then(function(res){
        _syncBusy=false; setStatus("synced");
        if(res && Number(res.version)>baseVersion){
          baseVersion=Number(res.version);
          setBase(baseVersion, res.data);
          if(onRemoteWin){ try{ const st=JSON.parse(res.data); onRemoteWin(st, res.version); }catch(e){ Diag.log("sync","syncNow parse", e&&e.message); } }
        }
      }).catch(function(e){ _syncBusy=false; Diag.log("sync","syncNow fallita", e&&e.message); setStatus("offline"); });
    },
    notify(state){ if(!enabled||!remote) return; clearTimeout(pushTimer); const str=JSON.stringify(state); if(_sameAsBase(str)){ pendingStr=null; setStatus("synced"); return; } pushTimer=setTimeout(function(){ _push(str); }, _debounceMs); },
    // Riprova un push rimasto in sospeso (es. dopo che la rete torna).
    retry(){ if(enabled&&remote&&pendingStr!=null) return _push(pendingStr); return Promise.resolve(); },
    flush(state){ clearTimeout(pushTimer); if(enabled&&remote&&state!=null){ const str=JSON.stringify(state); if(_sameAsBase(str)){ pendingStr=null; return Promise.resolve(); } return _push(str); } return Promise.resolve(); }
  };
})();
// Remote mock in memoria: per test e sviluppo, stesso contratto del backend reale.
function makeMemoryRemote(){
  let store={version:0, data:null};
  return {
    name:"memory-remote",
    head(){ return Promise.resolve(store.data==null?null:{version:store.version}); },
    pull(){ return Promise.resolve(store.data==null?null:{version:store.version, data:store.data}); },
    push(baseVersion, data){
      if(baseVersion===store.version){ store.version++; store.data=data; return Promise.resolve({ok:true, version:store.version}); }
      return Promise.resolve({conflict:true, version:store.version, data:store.data});
    }
  };
}
/* ---- Adapter Supabase (P1): STESSO contratto del mock. Scritto contro le API di
   supabase-js; da collegare quando il backend esiste (vedi BACKEND_P1.md). ---- */
function makeSupabaseRemote(supabase, eventId){
  const T="event_state", asStr=v=> typeof v==="string"?v:JSON.stringify(v);
  return {
    name:"supabase",
    // Solo la versione: risposta di pochi byte. syncNow la usa per capire se
    // serve davvero scaricare il documento intero.
    async head(){
      const r=await supabase.from(T).select("version").eq("event_id",eventId).maybeSingle();
      if(r.error) throw new Error(r.error.message||"head");
      if(!r.data) return null;
      return { version:Number(r.data.version) };
    },
    async pull(){
      const r=await supabase.from(T).select("version,data").eq("event_id",eventId).maybeSingle();
      if(r.error) throw new Error(r.error.message||"pull");
      if(!r.data) return null;
      return { version:Number(r.data.version), data:asStr(r.data.data) };
    },
    async push(baseVersion, data){
      // update ottimistico con guardia di versione
      const up=await supabase.from(T).update({data:data, version:baseVersion+1, updated_at:new Date().toISOString()})
        .eq("event_id",eventId).eq("version",baseVersion).select("version").maybeSingle();
      if(up.error) throw new Error(up.error.message||"push");
      if(up.data) return { ok:true, version:Number(up.data.version) };
      // nessuna riga aggiornata: o non esiste ancora, o la versione è avanzata
      const cur=await supabase.from(T).select("version,data").eq("event_id",eventId).maybeSingle();
      if(cur.error) throw new Error(cur.error.message||"reread");
      if(!cur.data){
        const ins=await supabase.from(T).insert({event_id:eventId, data:data, version:1, updated_at:new Date().toISOString()}).select("version").maybeSingle();
        if(ins.error){ const c2=await supabase.from(T).select("version,data").eq("event_id",eventId).maybeSingle(); if(c2.data) return {conflict:true, version:Number(c2.data.version), data:asStr(c2.data.data)}; throw new Error(ins.error.message||"insert"); }
        return { ok:true, version:Number(ins.data.version) };
      }
      return { conflict:true, version:Number(cur.data.version), data:asStr(cur.data.data) };
    }
  };
}
/* ---- Auth (P1): mock per dry-run + adapter Supabase ---- */
function makeMockAuth(){ let user=null; return {
  name:"mock",
  async signIn(email){ user={id:"u_"+((email||"anon").split("@")[0]), email:email||"anon@example.com"}; return user; },
  async signOut(){ user=null; },
  getUser(){ return user; }
}; }
function makeSupabaseAuth(supabase){ return {
  name:"supabase",
  // Login email+password (niente link da cliccare): risolve subito a una sessione.
  async signIn(email, password){ const r=await supabase.auth.signInWithPassword({email:email, password:password||""}); if(r.error) throw new Error(r.error.message); return r.data&&r.data.user; },
  async signOut(){ await supabase.auth.signOut(); },
  // Sessione già presente (persistita da supabase-js): serve al resume dopo un reload.
  async sessionUser(){ try{ const r=await supabase.auth.getSession(); return (r&&r.data&&r.data.session)?r.data.session.user:null; }catch(e){ return null; } }
}; }
/* ---- Cloud controller: lega auth + remote + Sync. Dormiente finché non configurato. ---- */
const Cloud=(function(){
  let auth=null, remote=null, user=null;
  return {
    configure(a, r){ auth=a; remote=r; },
    configured(){ return !!(auth && remote); },
    currentUser(){ return user; },
    _enableSync(){
      Sync.enable(remote, {
        onStatus:function(){ if(typeof updateSyncChip==="function") updateSyncChip(); },
        // Conflitto risolto: toast temporaneo, nessun elemento persistente nella UI.
        onConflict:function(){ if(typeof toast==="function") toast("Sincronizzazione: allineo con l'altra modifica"); },
        // Il remoto e' piu' recente (LWW) o e' arrivato in foreground: adotto lo
        // stato del cloud come fa il resume, con le migrazioni, e ridisegno.
        onRemoteWin:function(st){
          try{
            if(!st) return;
            STATE=st;
            if(typeof migrateBudgetV2==="function") migrateBudgetV2();
            if(typeof migrateSeedLabels==="function") migrateSeedLabels();
            if(typeof migrateTaskVendorCat==="function") migrateTaskVendorCat();
            if(typeof migrateGuestsRoster2==="function") migrateGuestsRoster2();
            if(typeof migrateMealSplit==="function") migrateMealSplit();
            try{ Store.save(STATE); }catch(e){} // persiste subito lo stato adottato/fuso
            if(typeof recompute==="function") recompute();
            if(typeof render==="function") render();
            if(typeof toast==="function") toast("Aggiornato dalle modifiche sull'altro dispositivo");
          }catch(e){ if(typeof Diag!=="undefined") Diag.log("sync","applica stato remoto", e&&e.message); }
        }
      });
    },
    async login(email, password){
      if(!this.configured()) throw new Error("cloud non configurato");
      user=await auth.signIn(email, password);
      // ruolo dalla membership (owner/editor/viewer); default owner finché il backend non lo fornisce
      if(typeof Session!=="undefined") Session.setRole((user&&user.role) || (auth.getRole&&auth.getRole()) || inviteRoleParam() || "owner");
      this._enableSync();
      const cloudState=await Sync.pull();   // stato dal cloud (o null se primo accesso)
      return { user:user, cloudState:cloudState };
    },
    // Riprende una sessione già valida (dopo un reload) senza richiedere le credenziali.
    async resume(){
      if(!this.configured() || !auth.sessionUser) return null;
      const u=await auth.sessionUser();
      if(!u) return null;
      user=u;
      if(typeof Session!=="undefined") Session.setRole("owner");
      this._enableSync();
      const cloudState=await Sync.pull();
      return { user:user, cloudState:cloudState };
    },
    async logout(){ if(auth){ try{ await auth.signOut(); }catch(e){} } user=null; if(typeof Session!=="undefined") Session.setRole("owner"); Sync.disable(); }
  };
})();
// Flush quando la pagina passa in background o viene chiusa (iOS: pagehide/
// visibilitychange sono gli eventi affidabili; 'unload' non è garantito su Safari).
if(typeof window!=="undefined"){
  window.addEventListener("pagehide", function(){ Store.flush(); if(typeof Sync!=="undefined") Sync.flush(memState); });
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState==="hidden"){ Store.flush(); if(typeof Sync!=="undefined") Sync.flush(memState); }
    // Ritorno in primo piano (riapertura app senza reload, tipico su iPhone):
    // riscarico dal cloud le modifiche fatte sull'altro dispositivo.
    else if(document.visibilityState==="visible"){ if(typeof Sync!=="undefined" && Sync.isEnabled()) Sync.syncNow(); }
  });
  window.addEventListener("focus", function(){ if(typeof Sync!=="undefined" && Sync.isEnabled()) Sync.syncNow(); });
  window.addEventListener("online", function(){ if(typeof Sync!=="undefined") Sync.retry(); }); // ripubblica ciò che era rimasto offline
}

/* ============ SEED (motore generico: questi dati sono SEED, non codice) ============ */
// Lista invitati UFFICIALE (bonifica forzata 2026-07-09, file Excel dell'utente:
// 131 invitati, tutti "in attesa"). Factory: array NUOVO a ogni chiamata, cosi'
// seed e migrazione non condividono riferimenti. Id stabili g2607_N: servono
// identici in entrambi i percorsi.
function guestsRoster2(){
  return [
    {id:"g2607_1", name:"Greta Berardi", side:"B", household:"Berardi-Olivares", group:"", rsvp:"attesa", meal:"vegetariano", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_2", name:"Alex Olivares", side:"B", household:"Berardi-Olivares", group:"", rsvp:"attesa", meal:"vegetariano", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_3", name:"Michela Rocchi", side:"B", household:"Senza nucleo", group:"Testimoni", rsvp:"attesa", meal:"celiaco", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "lato": "Sposa", "ambiente": "Amici", "stato": "Single"}},
    {id:"g2607_4", name:"Lisa Balzani", side:"B", household:"Catania", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_5", name:"Carlo Catania", side:"A", household:"Catania", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_6", name:"Natalia Sora", side:"B", household:"Sura", group:"Pisti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Sposa", "stato": "In coppia"}},
    {id:"g2607_7", name:"Luca Cantoni", side:"B", household:"Sura", group:"Pisti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Sposa", "stato": "In coppia"}},
    {id:"g2607_8", name:"Giada Comandini", side:"B", household:"Senza nucleo", group:"Pisti", rsvp:"attesa", meal:"vegetariano", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "lato": "Sposa", "stato": "In coppia"}},
    {id:"g2607_9", name:"Viola Castellucci", side:"B", household:"Senza nucleo", group:"Pisti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "lato": "Sposa", "eta": "Adulto", "ambiente": "Amici", "stato": "Single"}},
    {id:"g2607_10", name:"Alex Casadei", side:"B", household:"Pistolas", group:"Pisti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_11", name:"Davide Vagnetti", side:"B", household:"Pistolas", group:"Pisti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "lato": "Sposa", "ambiente": "Amici"}},
    {id:"g2607_12", name:"Jessika Berardi", side:"B", household:"Senza nucleo", group:"Pisti", rsvp:"attesa", meal:"vegetariano", intolerances:"", accessibility:"", shuttle:false, plusOne:1, gift:"", thanked:false, attr:{"lato": "Sposa", "stato": "In coppia"}},
    {id:"g2607_13", name:"Giacomo Gaviani", side:"B", household:"Gaviani", group:"", rsvp:"attesa", meal:"vegano", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_14", name:"Giulia Gaviani", side:"B", household:"Gaviani", group:"", rsvp:"attesa", meal:"vegano", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_15", name:"Erica Fabiano", side:"B", household:"Fabiano-Lanci", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_16", name:"Luca Lancioni", side:"B", household:"Fabiano-Lanci", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_17", name:"Vittoria Lancioni", side:"B", household:"Fabiano-Lanci", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_18", name:"Sabrina Zaccheroni", side:"B", household:"Bastoni-Zaccheroni", group:"Compagni di scuola", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "lato": "Sposa"}},
    {id:"g2607_19", name:"Luca Bastistini", side:"B", household:"Bastoni-Zaccheroni", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"stato": "In coppia"}},
    {id:"g2607_20", name:"Valentina Telloli", side:"B", household:"Telloli", group:"Compagni di scuola", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_21", name:"Gigi Petrozzino", side:"B", household:"Telloli", group:"Compagni di scuola", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_22", name:"Irene Petruzzino", side:"B", household:"Telloli", group:"Compagni di scuola", rsvp:"attesa", meal:"celiaco", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"eta": "Bambino"}},
    {id:"g2607_23", name:"Emma Petruzzino", side:"B", household:"Telloli", group:"Compagni di scuola", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"eta": "Bambino"}},
    {id:"g2607_24", name:"Carlotta Pantani", side:"B", household:"Gianfanti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_25", name:"Andrea Gianfanti", side:"B", household:"Gianfanti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_26", name:"Stella Gianfanti", side:"B", household:"Gianfanti", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_27", name:"Giulia Paganelli", side:"A", household:"Visani", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_28", name:"Marco Visani", side:"B", household:"Visani", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_29", name:"Tommaso Visani", side:"B", household:"Visani", group:"Ostetriche", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_30", name:"Ludovica Visani", side:"B", household:"Visani", group:"Ostetriche", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_31", name:"Anna Biondi", side:"B", household:"Senza nucleo", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "lato": "Sposa", "ambiente": "Colleghi", "stato": "In coppia"}},
    {id:"g2607_32", name:"Tinta Unita", side:"B", household:"Senza nucleo", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "lato": "Sposa", "eta": "Adulto", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_33", name:"Martina Cicognani", side:"B", household:"Forti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_34", name:"Marco Forti", side:"B", household:"Forti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_35", name:"Romeo Forti", side:"B", household:"Forti", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_36", name:"Olivia Forti", side:"B", household:"Forti", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_37", name:"Francesca Lutti", side:"B", household:"Piazza", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_38", name:"Gianmarco Piazza", side:"B", household:"Piazza", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_39", name:"Adele Piazza", side:"B", household:"Piazza", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_40", name:"Leonardo Piazza", side:"B", household:"Piazza", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_41", name:"Aurora Falcone", side:"B", household:"Falcone", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"ambiente": "Colleghi"}},
    {id:"g2607_42", name:"Bob", side:"B", household:"Falcone", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_43", name:"Viola", side:"B", household:"Falcone", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"eta": "Bambino"}},
    {id:"g2607_44", name:"Giulia", side:"A", household:"Falcone", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"eta": "Bambino"}},
    {id:"g2607_45", name:"Angela Di Ianni", side:"B", household:"Di Ianni", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_46", name:"Fabio (compagno di Angela)", side:"B", household:"Di Ianni", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_47", name:"Francesco Di Ianni", side:"B", household:"Di Ianni", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_48", name:"Nicole (dell'Abruzzo)", side:"B", household:"Senza nucleo", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"ambiente": "Colleghi", "stato": "Single"}},
    {id:"g2607_49", name:"Maria Ferrara", side:"B", household:"Ferrara", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_50", name:"Danilo Caisi", side:"B", household:"Ferrara", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_51", name:"Francesco Ferrara", side:"B", household:"Ferrara", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_52", name:"Sara dalla Croce", side:"B", household:"Dalla Croce", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Sposa", "ambiente": "Colleghi", "stato": "Famiglia"}},
    {id:"g2607_53", name:"Luca", side:"B", household:"Dalla Croce", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "ambiente": "Colleghi", "stato": "Famiglia"}},
    {id:"g2607_54", name:"Brando", side:"A", household:"Dalla Croce", group:"Ostetriche", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"1", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposa", "ambiente": "Colleghi", "stato": "Famiglia"}},
    {id:"g2607_55", name:"Deva", side:"B", household:"Dalla Croce", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"ambiente": "Colleghi", "stato": "Famiglia"}},
    {id:"g2607_56", name:"Valeria Ciotti", side:"B", household:"Ciotti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_57", name:"Francesco Ciotti", side:"B", household:"Ciotti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_58", name:"Michele Fusai", side:"A", household:"Fusai", group:"Compagni di scuola", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_59", name:"Matilde Danesi", side:"A", household:"Fusai", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_60", name:"Camilla Davi", side:"A", household:"Zani", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_61", name:"Nicola Zani", side:"A", household:"Zani", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_62", name:"Nicola Giannini", side:"A", household:"Senza nucleo", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Entrambi", "ambiente": "Amici", "stato": "Single"}},
    {id:"g2607_63", name:"Angelo Gualdaroni", side:"A", household:"Senza nucleo", group:"Compagni di scuola", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Entrambi", "ambiente": "Amici", "stato": "Single"}},
    {id:"g2607_64", name:"Fabio Bartolomei", side:"A", household:"Bartolomei", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_65", name:"Jessika Braschi", side:"A", household:"Bartolomei", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_66", name:"Elena Bartolomei", side:"A", household:"Bartolomei", group:"Amici", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_67", name:"Alessia Bartolomei", side:"A", household:"Bartolomei", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_68", name:"Filippo Socci", side:"A", household:"Socci", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "stato": "In coppia"}},
    {id:"g2607_69", name:"Melissa Socci", side:"A", household:"Socci", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_70", name:"Filippo Collinelli", side:"A", household:"Collinelli", group:"Compagni di scuola", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "ambiente": "Scuola", "stato": "In coppia"}},
    {id:"g2607_71", name:"Silvia collinelli", side:"A", household:"Collinelli", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "stato": "In coppia"}},
    {id:"g2607_72", name:"Enrico Cangini", side:"A", household:"Senza nucleo", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "ambiente": "Sport", "stato": "Single"}},
    {id:"g2607_73", name:"Matteo Canestrini", side:"A", household:"Canestrini", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_74", name:"Paola Canestrini", side:"A", household:"Canestrini", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_75", name:"Figlio Canestrini (nome da definire)", side:"A", household:"Canestrini", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_76", name:"Logan Para", side:"A", household:"Para", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_77", name:"Moglie di Logan (nome da definire)", side:"A", household:"Para", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_78", name:"Figlio di Logan (nome da definire)", side:"A", household:"Para", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_79", name:"Secondo figlio di Logan (nome da definire)", side:"A", household:"Para", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_80", name:"Marco Zani", side:"A", household:"Zani (Marco)", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_81", name:"Laura (compagna di Marco Zani)", side:"A", household:"Zani (Marco)", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_82", name:"Figlia di Marco e Laura (nome da definire)", side:"A", household:"Zani (Marco)", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_83", name:"Thomas Marri", side:"A", household:"Marri", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Entrambi", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_84", name:"Sofia Lucchi", side:"A", household:"Marri", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Entrambi", "stato": "In coppia"}},
    {id:"g2607_85", name:"Alessandro Eshani", side:"A", household:"Eshani", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Entrambi", "ambiente": "Amici"}},
    {id:"g2607_86", name:"Maria Vittoria", side:"A", household:"Eshani", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Entrambi", "ambiente": "Amici"}},
    {id:"g2607_87", name:"Damiano Zani", side:"A", household:"Eshani", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_88", name:"Luigi Ceccaroni", side:"A", household:"Ceccaroni", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_89", name:"Lucia Magnani", side:"A", household:"Ceccaroni", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_90", name:"Manuel Guidi", side:"A", household:"Senza nucleo", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Entrambi", "eta": "Adulto", "ambiente": "Amici", "stato": "Single"}},
    {id:"g2607_91", name:"Alessandro Lustri", side:"A", household:"Senza nucleo", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Amici", "stato": "Single"}},
    {id:"g2607_92", name:"Nicola Zavalloni", side:"A", household:"Zavalloni", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Entrambi", "eta": "Adulto", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_93", name:"Marianna", side:"A", household:"Zavalloni", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"lato": "Entrambi", "eta": "Adulto", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_94", name:"Alex Minotti", side:"A", household:"Minotti", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_95", name:"Caterina Gianni", side:"A", household:"Minotti", group:"Amici", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Amici", "stato": "In coppia"}},
    {id:"g2607_96", name:"Federico Giannini", side:"A", household:"Senza nucleo", group:"Compagni di scuola", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:1, gift:"", thanked:false, attr:{"nucleo": "Amici sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Scuola", "stato": "In coppia"}},
    {id:"g2607_97", name:"Matteo Merli", side:"A", household:"Merli", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_98", name:"Compagna di Matteo Merli (nome da definire)", side:"A", household:"Merli", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_99", name:"Chiara Casadei", side:"A", household:"Monti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_100", name:"Giulio Monti", side:"A", household:"Monti", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_101", name:"Alberto Monti", side:"A", household:"Monti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_102", name:"Fede Rossi", side:"B", household:"Rossi (Fede)", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_103", name:"Giacomo Rossi", side:"B", household:"Rossi (Fede)", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_104", name:"Compagno di Fede - Matteo", side:"B", household:"Rossi (Fede)", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_105", name:"Camilla Rossi", side:"B", household:"Rossi (Fede)", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_106", name:"Joe (ostetrica)", side:"B", household:"Senza nucleo", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Colleghi", "lato": "Sposa", "ambiente": "Colleghi"}},
    {id:"g2607_107", name:"Rachele (ostetrica)", side:"B", household:"Senza nucleo", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Colleghi", "lato": "Sposa", "ambiente": "Colleghi"}},
    {id:"g2607_108", name:"Nadia (ostetrica)", side:"B", household:"Senza nucleo", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Colleghi", "lato": "Sposa", "ambiente": "Colleghi"}},
    {id:"g2607_109", name:"Chiara Alvisi", side:"A", household:"Senza nucleo", group:"Ostetriche", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Colleghi", "lato": "Sposa", "ambiente": "Colleghi"}},
    {id:"g2607_110", name:"Bernardo Vaccari", side:"A", household:"Vaccari", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_111", name:"Francesca Santucci", side:"A", household:"Vaccari", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_112", name:"Marghe (di Bernardo)", side:"A", household:"Vaccari", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_113", name:"Martino Ciotti", side:"B", household:"Ciotti", group:"", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_114", name:"Ludovica Catania", side:"B", household:"Catania", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_115", name:"Alessandro Catania", side:"B", household:"Catania", group:"", rsvp:"attesa", meal:"bambino", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false},
    {id:"g2607_116", name:"Mauro Righi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "ambiente": "Parenti"}},
    {id:"g2607_117", name:"Brunella Marconi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "ambiente": "Parenti"}},
    {id:"g2607_118", name:"Laura Righi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "ambiente": "Parenti"}},
    {id:"g2607_119", name:"Anna Bertozzi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Anziano", "ambiente": "Parenti"}},
    {id:"g2607_120", name:"Ezio Righi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Anziano", "ambiente": "Parenti"}},
    {id:"g2607_121", name:"Valentina Righi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Parenti"}},
    {id:"g2607_122", name:"Roberto Fusai", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Parenti"}},
    {id:"g2607_123", name:"Cecilia Fusai", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Giovane", "ambiente": "Parenti"}},
    {id:"g2607_124", name:"Francesco Fusai", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Giovane", "ambiente": "Parenti"}},
    {id:"g2607_125", name:"Roberto Riceputi", side:"A", household:"Righi", group:"Parenti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Parenti"}},
    {id:"g2607_126", name:"Elisabetta Risciolo", side:"A", household:"Righi", group:"Parenti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Parenti"}},
    {id:"g2607_127", name:"Riccardo Riceputi", side:"A", household:"Righi", group:"Parenti", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Giovane", "ambiente": "Parenti"}},
    {id:"g2607_128", name:"Silvia Guidi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Giovane", "ambiente": "Parenti", "stato": "Single"}},
    {id:"g2607_129", name:"Sara Guidi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Parenti", "stato": "Single"}},
    {id:"g2607_130", name:"Filiberto Guidi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:0, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "eta": "Adulto", "ambiente": "Amici"}},
    {id:"g2607_131", name:"Roberta Marconi", side:"A", household:"Righi", group:"Famiglia sposo", rsvp:"attesa", meal:"adulto", intolerances:"", accessibility:"", shuttle:false, plusOne:1, gift:"", thanked:false, attr:{"nucleo": "Famiglia sposo", "lato": "Sposo", "ambiente": "Parenti"}}
  ];
}
function seedState(){
  // 50 voci reali dal budget: [tier1-5, voce, stimato, perGuest]
  const B=[
   [1,"Location / affitto sala o agriturismo",7000,0],[1,"Ristorante / catering",18000,1],
   [1,"Abito sposa",8000,0],[1,"Abito sposo",2500,0],[1,"Fedi nuziali",1500,0],
   [1,"Fotografo / video",3500,0],[1,"Musica / DJ / intrattenimento",8000,0],
   [1,"Partecipazioni / inviti",800,1],[1,"Bomboniere",0,1],[1,"Fiori / allestimenti floreali",2000,0],
   [2,"Trucco e parrucco sposa",800,0],[2,"Torta nuziale",1500,0],[2,"Auto sposi / noleggio trasporto",0,0],
   [2,"Addobbi cerimonia",1500,0],[2,"Confettata / sweet table",500,1],
   [2,"Allestimenti tavoli / tableau / segnaposto",300,0],[2,"SIAE / permessi musica / pratiche",200,0],
   [2,"Piano B maltempo / tensostruttura",0,0],[2,"Pernottamento sposi prima notte",0,0],
   [2,"Wedding planner / coordinamento evento",3500,0],
   [3,"Open bar / angolo cocktail",1500,1],[3,"Animazione bambini",300,0],[3,"Servizio baby-sitting",500,0],
   [3,"Navetta per invitati",1200,1],[3,"Pernottamento invitati",0,0],[3,"Regalo testimoni / damigelle",500,0],
   [3,"Abiti damigelle / accessori coordinati",0,0],[3,"Accessori sposa",0,0],[3,"Accessori sposo",0,0],
   [3,"Messa in piega / barber / beauty sposo",0,0],
   [4,"Cerimonia religiosa: offerta chiesa / coro",1000,0],[4,"Cerimonia civile: sala comunale / celebrante",0,0],
   [4,"Corsi prematrimoniali / documenti / bolli",0,0],[4,"Viaggio di nozze",0,0],[4,"Mini luna di miele",0,0],
   [4,"Photo booth / gadget ospiti",600,0],[4,"Fuochi d'artificio / effetti speciali",1200,0],
   [4,"Live painting / illustratore evento",0,0],[4,"Sito web matrimonio / lista nozze",600,0],
   [4,"Ringraziamenti post matrimonio",0,0],
   [5,"Noleggio arredi extra / lounge / pedane",0,0],[5,"Generatore elettrico / service tecnico",0,0],
   [5,"Sicurezza / vigilanza / steward",0,0],[5,"Assicurazione evento",900,0],
   [5,"Traduzioni / interprete ospiti stranieri",0,0],[5,"Corner sigari / rum / degustazioni",400,0],
   [5,"Brunch del giorno prima",800,1],[5,"Kit emergenza ospiti / comfort",0,0],
   [5,"Dog sitter / pet wedding service",0,0],[5,"Dress code personalizzato / merchandising",0,0]
  ];
  const planned=180;
  const budget=B.map((r,i)=>({
    id:"b"+i, tier:r[0], item:r[1], estimated:r[2], quote:0, actual:0,
    costType:r[3]?"perGuest":"fixed", perHead:r[3]&&planned?+(r[2]/planned).toFixed(2):0,
    vendorId:(i===1?"fenice":null), dueDate:null, paid:false
  }));
  return {
    schema:1, activeEventId:"rb27",
    events:{ rb27:{
      id:"rb27",
      meta:{
        coupleA:"Righi", coupleB:"Biondi", groom:"Luca", date:"2027-07-17",
        venue:"Castello Benelli", venueAddr:"Via San Vito 17, Bellaria-Igea Marina (RN)",
        currency:"EUR", locale:"it-IT", plannedGuests:planned, minGuaranteed:170,
        vat:{catering:10, third:22}, contingencyPct:8,
        contacts:[{name:"La Fenice — Vittorio Fiore", phone:"+39 331 668 2055", role:"Catering"}]
      },
      budget,
      payments:[
        {id:"p1", vendorId:"fenice", label:"Caparra conferma", amount:3850, dueDate:"2026-09-01", paid:false, method:"Bonifico"},
        {id:"p2", vendorId:"fenice", label:"Acconto 40% (−40 gg)", amount:7200, dueDate:"2027-05-24", paid:false, method:"Bonifico"},
        {id:"p3", vendorId:"fenice", label:"Saldo (−10 gg)", amount:6950, dueDate:"2027-06-23", paid:false, method:"Bonifico"}
      ],
      guests: guestsRoster2(),
      vendors:[
        {id:"fenice",name:"La Fenice Catering & Banqueting",category:"Catering",contact:"Vittorio Fiore",phone:"+39 331 668 2055",email:"",website:"lafenicecatering.com",status:"confermato",quote:18000,budgetLineId:"b1",rating:"",reviews:"",pastEvents:"",notes:"Tasting a Faenza",source:"preventivo",updated:""},
        {id:"benelli",name:"Castello Benelli",category:"Location",contact:"",phone:"",email:"",website:"",status:"confermato",quote:7000,budgetLineId:"b0",rating:"",reviews:"",pastEvents:"",notes:"Via San Vito 17, Bellaria-Igea Marina (RN)",source:"contratto",updated:""},
        {id:"fregnano",name:"Borgo Fregnano",category:"Location",contact:"",phone:"",email:"",website:"borgofregnano.com",status:"opzione",quote:4500,budgetLineId:null,rating:"",reviews:"",pastEvents:"",notes:"Opzione presa per il 17/07/2027 (data alternativa a Castello Benelli).",source:"opzione",updated:"2027-07-03"}
      ], tasks:[
        {id:"k1",title:"Bloccare location e catering",category:"Fornitori",due:"2026-07-03",assignee:"Sposi",done:true},
        {id:"k2",title:"Confermare location",category:"Fornitori",vendorCat:"Location",due:"2026-07-03",assignee:"Sposi",done:false},
        {id:"k3",title:"Confermare catering",category:"Catering",vendorCat:"Catering",due:"2026-07-03",assignee:"Sposi",done:false},
        {id:"k4",title:"Scegliere foto e video",category:"Fornitori",vendorCat:"Foto/Video",due:"2026-10-03",assignee:"Sposi",done:false},
        {id:"k5",title:"Confermare numeri al catering",category:"Catering",due:"2027-05-24",assignee:"Sposi",done:false},
        {id:"k6",title:"Saldo fornitori",category:"Pagamenti",due:"2027-06-23",assignee:"Sposi",done:false}
      ], runshow:[
        {id:"r1",time:"16:00",title:"Cerimonia",who:"Officiante"},
        {id:"r2",time:"17:30",title:"Aperitivo",who:"La Fenice"},
        {id:"r3",time:"20:00",title:"Cena",who:"La Fenice"},
        {id:"r4",time:"22:30",title:"Taglio torta",who:"La Fenice"},
        {id:"r5",time:"23:00",title:"Primo ballo",who:"DJ"},
        {id:"r6",time:"01:00",title:"Chiusura e navetta",who:"Navetta"}
      ], lists:[
        {id:"l1",title:"Musica — da suonare",items:["Apertura balli","Canzone primo ballo"]},
        {id:"l2",title:"Musica — da evitare",items:["(da inserire)"]},
        {id:"l3",title:"Ordine processione",items:["Damigelle","Sposo","Sposa con il padre"]},
        {id:"l4",title:"Lista foto di famiglia",items:["Sposi con genitori Righi","Sposi con genitori Biondi"]},
        {id:"l5",title:"Packing sposi",items:["Fedi","Documenti"]}
      ], tables:[],
      sim:{
        stations:[
          {id:1,name:"Bar / Bere",service:25,pop:1.5,servers:5,welcome:true,lines:1,color:"#2563eb"},
          {id:2,name:"Finger food",service:18,pop:2,servers:3,welcome:false,lines:1,color:"#1a8a4a"},
          {id:3,name:"Norcineria (salumi)",service:40,pop:1,servers:3,welcome:false,lines:1,color:"#d97706"},
          {id:4,name:"Casaro (formaggi)",service:45,pop:1,servers:3,welcome:false,lines:1,color:"#9333ea"}
        ],
        G:{pNav:0.40,travelMean:30,sigma:10,shuttleOffset:0,unloadMin:4,welcomeTray:true,apDur:50,greenSec:20,amberSec:45},
        seq:4, scenarios:[]
      },
      seating:{rules:[]}
    }}
  };
}

/* ============ STATE + DERIVED ============ */
let STATE=null;
function ev(){ return STATE.events[STATE.activeEventId]; }
function meta(){ return ev().meta; }

let DERIVED={};
function recompute(){
  const e=ev(), m=e.meta, g=m.plannedGuests||0;
  // budget: per-guest lines scale with planned guests
  let est=0,quo=0,act=0;
  e.budget.forEach(b=>{
    b._total = (b.costType==="perGuest") ? Math.round((b.perHead||0)*g) : b.estimated;
    est+=b._total; quo+=(+b.quote||0); act+=(+b.actual||0);
  });
  // Base del budget = PREVENTIVI (la colonna Stima e' stata rimossa: i valori
  // sono migrati nei preventivi, vedi migrateBudgetV2).
  const cont=Math.round(quo*(m.contingencyPct||0)/100);
  const ceiling=quo+cont;
  const committed = act||quo; // impegnato
  // payments cash-flow by month
  const cf={};
  e.payments.forEach(p=>{ if(p.dueDate){ const k=p.dueDate.slice(0,7); cf[k]=(cf[k]||0)+(+p.amount||0); } });
  const paidSum=e.payments.filter(p=>p.paid).reduce((s,p)=>s+(+p.amount||0),0);
  const dueSum=e.payments.filter(p=>!p.paid).reduce((s,p)=>s+(+p.amount||0),0);
  // guests
  const conf=e.guests.filter(x=>x.rsvp==="conf");
  const head=conf.reduce((s,x)=>s+1+(+x.plusOne||0),0);
  const counts={attesa:e.guests.filter(x=>x.rsvp==="attesa").length, no:e.guests.filter(x=>x.rsvp==="no").length, conf:conf.length};
  // catering report: meals among confirmed (+plus one counts as adulto)
  const meals={};
  conf.forEach(x=>{ meals[x.meal||"normale"]=(meals[x.meal||"normale"]||0)+1; if(x.plusOne){meals["normale"]=(meals["normale"]||0)+(+x.plusOne);} });
  const intoll=conf.filter(x=>x.intolerances).map(x=>x.name+": "+x.intolerances);
  const shuttle=conf.filter(x=>x.shuttle).reduce((s,x)=>s+1+(+x.plusOne||0),0);
  const kidsN=conf.filter(x=>x.ptype==="bambino").length;
  const accessList=conf.filter(x=>x.accessibility).map(x=>x.name+": "+x.accessibility);
  // seating (modello nativo: posti in tables[].seatIds, capienza in t.seats)
  const tablesArr=e.tables||[];
  const gids=new Set(e.guests.map(x=>x.id));
  const assignedHead=tablesArr.reduce((s,t)=>s+((t.seatIds||[]).filter(x=>x&&gids.has(x)).length),0);
  const seatCap=tablesArr.reduce((s,t)=>s+(+t.seats||0),0);
  const vendorsArr=e.vendors||[];
  const vConf=vendorsArr.filter(v=>v.status==="confermato").length;
  const tk=e.tasks||[]; const todayISO=new Date().toISOString().slice(0,10);
  const tasksTotal=tk.length, tasksDone=tk.filter(taskDone).length, overdue=tk.filter(t=>!taskDone(t)&&t.due&&t.due<todayISO).length;
  DERIVED={est,quo,act,cont,ceiling,committed,variance:committed-ceiling,cf,paidSum,dueSum,head,counts,meals,intoll,shuttle,kidsN,accessList,plannedGuests:g,tablesN:tablesArr.length,assignedHead,seatCap,vendorsN:vendorsArr.length,vConf,tasksTotal,tasksDone,overdue};
}

/* ============ CENTRO AVVISI (motore centrale) ============ */
// Un'unica fonte di verità per gli avvisi: regole -> lista tipizzata
// {id stabile, sev: alta|media|info, area, testo, tab}. La campanella, il
// pannello e la card in Dashboard leggono tutti da qui.
function alertsPrefs(){ const e=ev(); if(!e.alertsCfg) e.alertsCfg={payDays:14, taskDays:14, muted:[]}; if(!e.alertsCfg.muted) e.alertsCfg.muted=[]; return e.alertsCfg; }
function alertsCompute(){
  const e=ev(), d=DERIVED, m=meta(), cfg=alertsPrefs();
  const today=new Date().toISOString().slice(0,10);
  const soon=(dt,days)=>{ if(!dt) return false; const n=daysTo(dt); return n>=0&&n<=days; };
  // ref: id delle righe interessate -> goAlert le evidenzia con una sfumatura.
  const A=[]; const add=(id,sev,area,text,tab,ref)=>A.push({id,sev,area,text,tab,ref:ref||[]});
  // Budget: scostamenti
  if(d.variance>0) add("bud_over","alta","Budget","Impegnato oltre il budget massimo di "+money(d.variance)+".","budget");
  (e.budget||[]).forEach(b=>{ if((+b.quote)>0&&(+b.actual)>(+b.quote)) add("bud_var_"+b.id,"media","Budget","\""+b.item+"\": effettivo "+money(b.actual)+" sopra il preventivo "+money(b.quote)+".","budget",[b.id]); });
  // Pagamenti: scaduti e imminenti
  const late=(e.payments||[]).filter(p=>!p.paid&&p.dueDate&&p.dueDate<today);
  if(late.length) add("pay_late","alta","Pagamenti",late.length+" rate scadute ("+money(late.reduce((s,p)=>s+(+p.amount||0),0))+") da saldare.","budget",late.map(p=>p.id));
  const due=(e.payments||[]).filter(p=>!p.paid&&soon(p.dueDate,cfg.payDays));
  if(due.length) add("pay_due","media","Pagamenti",due.length+" rate in scadenza entro "+cfg.payDays+" giorni ("+money(due.reduce((s,p)=>s+(+p.amount||0),0))+").","budget",due.map(p=>p.id));
  // Attività: scadute, imminenti, in sospeso da troppo
  const tlate=(e.tasks||[]).filter(t=>!taskDone(t)&&t.due&&t.due<today);
  if(d.overdue>0) add("task_late","alta","Attività",d.overdue+" attività scadute da recuperare.","timeline",tlate.map(t=>t.id));
  const tsoon=(e.tasks||[]).filter(t=>!taskDone(t)&&soon(t.due,cfg.taskDays));
  if(tsoon.length) add("task_due","media","Attività",tsoon.length+" attività in scadenza entro "+cfg.taskDays+" giorni.","timeline",tsoon.map(t=>t.id));
  const stale=(e.tasks||[]).filter(t=>!taskDone(t)&&!t.due&&t.createdAt&&daysTo(t.createdAt)<=-30);
  if(stale.length) add("task_stale","info","Attività",stale.length+" attività senza scadenza ferme da oltre 30 giorni.","timeline",stale.map(t=>t.id));
  // Ospiti
  if(d.head&&m.minGuaranteed&&d.head<m.minGuaranteed) add("g_min","media","Ospiti","Coperti confermati ("+d.head+") sotto il minimo garantito ("+m.minGuaranteed+").","guests");
  if(d.counts.attesa>0&&m.date&&daysTo(m.date)<=60) add("g_attesa","media","Ospiti",d.counts.attesa+" inviti ancora in attesa a "+daysTo(m.date)+" giorni dalle nozze.","guests",(e.guests||[]).filter(g=>g.rsvp==="attesa").map(g=>g.id));
  // Tavoli
  if(d.seatCap>0&&d.head>d.seatCap) add("s_cap","alta","Tavoli","Coperti confermati ("+d.head+") oltre la capienza dei tavoli ("+d.seatCap+").","seating");
  if((e.tables||[]).length){
    const seated=new Set(); (e.tables||[]).forEach(t=>(t.seatIds||[]).forEach(g=>{ if(g) seated.add(g); }));
    const unseated=(e.guests||[]).filter(g=>g.rsvp==="conf"&&!seated.has(g.id));
    if(unseated.length) add("s_unseated","info","Tavoli",unseated.length+" ospiti confermati senza posto assegnato.","seating",unseated.map(g=>g.id));
  }
  // Fornitori
  const keyCats=["Location","Catering","Foto/Video","Musica/DJ"];
  if(m.date&&daysTo(m.date)<=180){
    keyCats.forEach(c=>{ if(!(e.vendors||[]).some(v=>v.category===c&&v.status==="confermato")) add("v_key_"+c,"media","Fornitori","Nessun fornitore confermato per \""+c+"\" a "+daysTo(m.date)+" giorni dalle nozze.","vendors"); });
  }
  (e.vendors||[]).forEach(v=>{
    if(v.optionUntil&&v.status!=="confermato"&&v.status!=="scartato"){
      const n=daysTo(v.optionUntil);
      if(n<0) add("v_opt_"+v.id,"alta","Fornitori","Opzione \""+v.name+"\" scaduta il "+fdate(v.optionUntil)+".","vendors",[v.id]);
      else if(n<=30) add("v_opt_"+v.id,"media","Fornitori","Opzione \""+v.name+"\" scade tra "+n+" giorni ("+fdate(v.optionUntil)+").","vendors",[v.id]);
    }
  });
  const muted=cfg.muted||[];
  const order={alta:0,media:1,info:2};
  return A.filter(a=>!muted.includes(a.id)).sort((x,y)=>order[x.sev]-order[y.sev]);
}
function alertsMutedCount(){ return (alertsPrefs().muted||[]).length; }
const ALERT_PILL={alta:"no",media:"warn",info:"todo"};
const ALERT_LABEL={alta:"critico",media:"attenzione",info:"info"};
let _alertsModal=null;
function updateAlertBell(){
  const el=document.getElementById("alertBell"); if(!el) return;
  let A=[]; try{ A=alertsCompute(); }catch(e){ el.style.display="none"; return; }
  const badge=document.getElementById("alertBadge");
  el.style.display="";
  if(badge){ if(A.length){ badge.textContent=A.length; badge.style.display=""; badge.style.background=A.some(a=>a.sev==="alta")?"var(--no)":"var(--gold)"; } else badge.style.display="none"; }
}
function openAlerts(){
  const A=alertsCompute(), cfg=alertsPrefs();
  const rows=A.length?A.map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)">
      <span class="pill ${ALERT_PILL[a.sev]}" style="flex:0 0 auto">${ALERT_LABEL[a.sev]}</span>
      <button class="lnkbtn" data-act="goAlert" data-target="${a.tab}" data-ref="${esc((a.ref||[]).join(","))}" style="flex:1;text-align:left;background:none;border:none;padding:0;font-size:13px;color:var(--ink);cursor:pointer;min-height:auto">${esc(a.text)}<span class="muted" style="font-size:11px"> · ${esc(a.area)} →</span></button>
      <button class="btn sm ghost" data-act="muteAlert" data-id="${esc(a.id)}" aria-label="Silenzia" title="Silenzia questo avviso">Ignora</button>
    </div>`).join("")
    :'<p class="muted" style="font-size:13px">Nessun avviso: tutto in ordine.</p>';
  const mutedN=alertsMutedCount();
  const body=rows
    +(mutedN?`<p class="muted" style="font-size:12px;margin-top:8px">${mutedN} avvisi silenziati. <button class="btn sm ghost" data-act="unmuteAlerts">Riattiva tutti</button></p>`:"")
    +`<details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:12px">Soglie di preavviso</summary>
       <div class="two" style="margin-top:6px">
         <div class="field"><label>Rate: giorni di preavviso</label><input class="inp" type="number" id="al_pay" min="1" max="90" value="${cfg.payDays}"></div>
         <div class="field"><label>Attività: giorni di preavviso</label><input class="inp" type="number" id="al_task" min="1" max="90" value="${cfg.taskDays}"></div>
       </div><div class="btnbar"><button class="btn sm" data-act="alertsCfgSave">Salva soglie</button></div></details>`;
  _alertsModal=modal("Avvisi ("+A.length+")", body, [{label:"Chiudi"}]);
}
/* Dopo il salto da un avviso: evidenzia con una sfumatura le righe interessate
   e porta in vista la prima. Le righe si trovano tramite i pulsanti/tag con
   data-id gia' presenti in ogni vista (riga tabella, card fornitore, tag ospite). */
function flashRows(ids){
  try{
    const acts=["editPayment","editBudget","editTask","toggleTask","editVendor","cycleRsvp"];
    let first=null;
    (ids||[]).forEach(rid=>{
      const cid=(window.CSS&&CSS.escape)?CSS.escape(rid):rid;
      const sel=acts.map(x=>'#view [data-act="'+x+'"][data-id="'+cid+'"]').join(",")+',#view [data-drag-guest="'+cid+'"]';
      const el=document.querySelector(sel); if(!el) return;
      const row=el.closest("tr")||(el.hasAttribute("data-drag-guest")?el:el.closest(".card"))||el;
      row.classList.remove("rowflash"); void row.offsetWidth; row.classList.add("rowflash");
      row.addEventListener("animationend",()=>row.classList.remove("rowflash"),{once:true});
      if(!first) first=row;
    });
    if(first){ const f=first; setTimeout(()=>{ try{ f.scrollIntoView({behavior:"smooth",block:"center"}); }catch(e){ f.scrollIntoView(); } },60); }
  }catch(e){}
}

/* ---- Migrazione budget v2: colonna Stima rimossa dalla UI. I valori di stima
   (per le voci a persona: tariffa x ospiti previsti) passano nel PREVENTIVO
   dove il preventivo e' vuoto, cosi' non si perde nulla. Una tantum per evento
   (flag budgetV2); idempotente comunque grazie alla condizione quote==0. ---- */
function migrateBudgetV2(){
  try{
    Object.keys((STATE&&STATE.events)||{}).forEach(k=>{
      const e=STATE.events[k]; if(!e||e.budgetV2) return;
      const g=(e.meta&&e.meta.plannedGuests)||0;
      (e.budget||[]).forEach(b=>{
        if((+b.quote||0)>0) return;
        const tot=(b.costType==="perGuest") ? Math.round((+b.perHead||0)*g) : (+b.estimated||0);
        if(tot>0) b.quote=tot;
      });
      e.budgetV2=true;
    });
    Store.save(STATE);
  }catch(err){ Diag.log("budget","migrazione v2 fallita", err&&err.message); }
}

/* ---- Migrazione titoli seed: le due liste musica erano nate in inglese.
   Rinomina SOLO i titoli esattamente uguali a quelli del seed (se l'utente li
   ha cambiati non tocca nulla). Idempotente: si puo' richiamare a ogni boot e
   dopo ogni pull dal cloud (stessa regola della migrazione budget). ---- */
function migrateSeedLabels(){
  try{
    const MAP={"Musica — must play":"Musica — da suonare","Musica — do not play":"Musica — da evitare"};
    let n=0;
    Object.keys((STATE&&STATE.events)||{}).forEach(k=>{
      ((STATE.events[k]||{}).lists||[]).forEach(l=>{ if(MAP[l.title]){ l.title=MAP[l.title]; n++; } });
    });
    if(n) Store.save(STATE);
  }catch(err){ Diag.log("lists","migrazione titoli fallita", err&&err.message); }
}

/* ---- Bonifica forzata lista invitati (2026-07-09, ordinata dall'utente):
   sostituisce PER INTERO e.guests con la lista ufficiale del file Excel
   (guestsRoster2, 131 invitati). Gli id cambiano tutti, quindi per coerenza
   vengono svuotati i posti ai tavoli e azzerate le regole di vicinanza (i
   riferimenti vecchi sarebbero orfani); i tavoli restano (nome/forma/posti).
   Flag guestsRosterV2: gira UNA volta per evento, poi mai piu' (le modifiche
   future dell'utente non vengono toccate). Boot + ogni pull dal cloud. ---- */
function migrateGuestsRoster2(){
  try{
    let n=0;
    Object.keys((STATE&&STATE.events)||{}).forEach(k=>{
      const e=STATE.events[k]; if(!e||e.guestsRosterV2) return;
      e.guests=guestsRoster2();
      (e.tables||[]).forEach(t=>{ t.seatIds=(t.seatIds||[]).map(()=>null); });
      if(e.seating) e.seating.rules=[];
      delete e.mealSplitV1; // il roster porta il campo menu "misto": lo split deve rigirare
      e.guestsRosterV2=true; n++;
    });
    if(n) Store.save(STATE);
  }catch(err){ Diag.log("guests","bonifica lista fallita", err&&err.message); }
}

/* ---- Migrazione tipo/menu (2026-07-09): il vecchio campo Menu mischiava
   eta' (adulto/bambino) e regime (vegetariano...). Separa: ptype = tipologia
   persona, meal = tipologia menu. bambino/adulto -> menu "normale"; l'eta'
   viene dedotta dal vecchio valore O dalla variabile tavoli "Fascia d'eta'"
   (cosi' Irene, celiaca E bambina, resta entrambe le cose). Flag mealSplitV1;
   gira a boot e dopo ogni pull dal cloud. ---- */
function migrateMealSplit(){
  try{
    let n=0;
    Object.keys((STATE&&STATE.events)||{}).forEach(k=>{
      const e=STATE.events[k]; if(!e||e.mealSplitV1) return;
      (e.guests||[]).forEach(g=>{
        if(!g.ptype) g.ptype=(g.meal==="bambino"||(g.attr&&g.attr.eta==="Bambino"))?"bambino":"adulto";
        if(g.meal==="bambino"||g.meal==="adulto"||!g.meal) g.meal="normale";
      });
      e.mealSplitV1=true; n++;
    });
    if(n) Store.save(STATE);
  }catch(err){ Diag.log("guests","migrazione tipo/menu fallita", err&&err.message); }
}

/* ============ HELPERS ============ */
const $=s=>document.querySelector(s);
function money(n){ return new Intl.NumberFormat(meta().locale,{style:"currency",currency:meta().currency,maximumFractionDigits:0}).format(n||0); }
function dnum(n){ return new Intl.NumberFormat("it-IT").format(n||0); }
function daysTo(d){ const t=new Date(d+"T00:00:00"), now=new Date(); now.setHours(0,0,0,0); return Math.round((t-now)/86400000); }
function fdate(d){ if(!d) return "—"; return new Date(d+"T00:00:00").toLocaleDateString("it-IT",{day:"2-digit",month:"short",year:"numeric"}); }
function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }
function announce(t){ $("#aria").textContent=t; }
function toast(t){ const el=$("#toast"); el.textContent=t; el.classList.add("show"); announce(t); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove("show"),1800); }
function commit(msg){ recompute(); Store.save(STATE); render(); if(msg) toast(msg); }

let _modalKey=null; // keydown handler del modale corrente (per pulizia su annidamento)
function modal(title, bodyHtml, actions){
  const root=$("#modalRoot");
  const prevFocus=document.activeElement;
  if(_modalKey){ document.removeEventListener("keydown",_modalKey,true); _modalKey=null; }
  root.innerHTML='<div class="modal-bg" id="mbg"><div class="modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'" tabindex="-1"><h3>'+esc(title)+'</h3><div id="mbody">'+bodyHtml+'</div><div class="btnbar" id="mact"></div></div></div>';
  const dialog=root.querySelector(".modal");
  const act=$("#mact");
  (actions||[{label:"Chiudi",close:true}]).forEach(a=>{
    const b=document.createElement("button");
    // Convenzione app: cls:"" = azione primaria/conferma -> stile "primary" + Invio.
    const primary=(a.cls===""); b.className="btn "+(primary?"primary":(a.cls||"ghost")); b.textContent=a.label;
    if(primary) b.setAttribute("data-primary","1");
    b.onclick=()=>{ if(a.fn) a.fn(); if(a.close!==false) close(); };
    act.appendChild(b);
  });
  function focusables(){ return Array.prototype.slice.call(dialog.querySelectorAll('a[href],button,select,textarea,input,[tabindex]:not([tabindex="-1"])')).filter(function(el){ return !el.disabled && el.offsetParent!==null; }); }
  function onKey(e){
    // Auto-sanante: se il dialog non è più nel DOM (chiuso senza close()),
    // de-registra il listener e lascia passare il tasto alla pagina.
    if(!document.body.contains(dialog)){ document.removeEventListener("keydown",onKey,true); if(_modalKey===onKey)_modalKey=null; return; }
    if(e.key==="Escape"){ e.preventDefault(); close(); return; }
    if(e.key==="Enter" && document.activeElement && document.activeElement.tagName==="INPUT"){
      // Invio da un campo di testo = conferma azione primaria (meno clic).
      const prim=act.querySelector('[data-primary]');
      if(prim){ e.preventDefault(); prim.click(); return; }
    }
    if(e.key==="Tab"){ const f=focusables(); if(!f.length){ e.preventDefault(); dialog.focus(); return; }
      const first=f[0], last=f[f.length-1];
      if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    }
  }
  _modalKey=onKey; document.addEventListener("keydown", onKey, true);
  ariaEnhance(dialog);
  $("#mbg").addEventListener("click",e=>{ if(e.target.id==="mbg") close(); });
  // focus iniziale: primo campo di input, altrimenti primo bottone, altrimenti il dialog
  const f=focusables(); (f.filter(function(el){ return /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName); })[0] || f[0] || dialog).focus();
  function close(){ if(_modalKey===onKey){ document.removeEventListener("keydown",onKey,true); _modalKey=null; } root.innerHTML=""; try{ if(prevFocus && prevFocus.focus) prevFocus.focus(); }catch(e){} }
  return {close};
}

/* ============ ROUTER ============ */
/* ============ I18N (fondamenta P3) ============ */
// Meccanismo pronto; qui tradotte le etichette schede come slice dimostrativo.
// L'estrazione completa delle stringhe resta una passata dedicata (vedi PIANO).
const I18N={
  it:{ "tab.dash":"Dashboard","tab.budget":"Budget & Finanze","tab.guests":"Ospiti & RSVP","tab.vendors":"Fornitori","tab.seating":"Tavoli","tab.aperitivo":"Aperitivo","tab.timeline":"Timeline","tab.lists":"Note & Liste" },
  en:{ "tab.dash":"Dashboard","tab.budget":"Budget & Finance","tab.guests":"Guests & RSVP","tab.vendors":"Vendors","tab.seating":"Tables","tab.aperitivo":"Aperitif","tab.timeline":"Timeline","tab.lists":"Notes & Lists" }
};
function appLang(){ try{ return (typeof STATE!=="undefined" && STATE && STATE.lang) ? STATE.lang : "it"; }catch(e){ return "it"; } }
function t(key){ const L=I18N[appLang()]||I18N.it; return (L && L[key]) || I18N.it[key] || key; }
function toggleLang(){ if(typeof STATE==="undefined"||!STATE) return; STATE.lang = appLang()==="it" ? "en" : "it"; commit(appLang()==="it"?"Lingua: Italiano":"Language: English"); }
/* ==== fine blocco i18n ==== */
const TABS=[["dash"],["budget"],["guests"],["vendors"],["seating"],["aperitivo"],["timeline"],["lists"]];
let active="dash";
function renderTabs(){
  $("#tabs").innerHTML=TABS.map(x=>'<button role="tab" data-tab="'+x[0]+'" aria-selected="'+(active===x[0])+'">'+esc(t("tab."+x[0]))+'</button>').join("");
}
function render(){
  const m=meta(), d=DERIVED;
  $("#evTitle").textContent=m.coupleA+" × "+m.coupleB;
  $("#evSub").textContent=(m.venue? m.venue+" · " : "")+fdate(m.date);
  const dd=daysTo(m.date); $("#cd").textContent=dd>=0?dnum(dd):"—";
  renderTabs();
  const v=$("#view");
  if(active==="dash") v.innerHTML=viewDash();
  else if(active==="budget") v.innerHTML=viewBudget();
  else if(active==="guests") v.innerHTML=viewGuests();
  else if(active==="seating") v.innerHTML=viewSeating();
  else if(active==="vendors") v.innerHTML=viewVendors();
  else if(active==="aperitivo") v.innerHTML=viewAperitivo();
  else if(active==="timeline") v.innerHTML=viewTimeline();
  else if(active==="lists") v.innerHTML=viewLists();
  else v.innerHTML=viewPlaceholder(active);
  v.innerHTML=hintBanner(active)+v.innerHTML;
  try{ document.documentElement.lang=appLang(); }catch(e){}
  ariaEnhance(v);
  if(active==="aperitivo") wireAperitivo();
  if(active==="seating") wireSeating();
  if(active==="guests") wireGuests();
  if(active==="budget") wireBudget();
  updateSyncChip();
  try{ updateAlertBell(); }catch(e){}
}
// Swipe sulle voci di spesa: scorri a sinistra per far apparire "Elimina",
// a destra (o tocca un'altra riga) per richiudere. I listener stanno sulla
// tabella, ricreata a ogni render: niente accumulo su #view.
function wireBudget(){
  const host=document.getElementById('view'); if(!host) return;
  const first=host.querySelector('tr[data-brow]'); if(!first) return;
  const tbl=first.closest('table'); if(!tbl) return;
  let sx=0, sy=0, row=null;
  tbl.addEventListener('touchstart',e=>{ const t=e.touches[0]; sx=t.clientX; sy=t.clientY; row=e.target.closest('tr[data-brow]'); },{passive:true});
  tbl.addEventListener('touchend',e=>{
    if(!row) return;
    const t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy;
    if(Math.abs(dy)<40&&Math.abs(dx)>40){
      tbl.querySelectorAll('tr.swiped').forEach(r=>{ if(r!==row) r.classList.remove('swiped'); });
      row.classList.toggle('swiped', dx<0);
    }
    row=null;
  },{passive:true});
}
// Filtri (chip RSVP) + ricerca ospiti (G7), lato client per non perdere il focus.
let GUESTVIEW={filter:'all', q:''};
// Filtro del Report catering: conf -> attesa -> all (ciclico al tocco del pill).
let CATERING_SCOPE="conf";
function wireGuests(){
  const host=document.getElementById('view'); if(!host) return;
  const search=host.querySelector('#guestSearch'), clear=host.querySelector('#guestSearchClear');
  const syncClear=()=>{ if(clear) clear.style.display=GUESTVIEW.q?'':'none'; };
  if(search){ search.value=GUESTVIEW.q; search.oninput=()=>{ GUESTVIEW.q=search.value; syncClear(); guestApplyFilter(); }; }
  // Tasto rapido per svuotare la ricerca: appare solo quando c'e' testo.
  if(clear){ clear.onclick=()=>{ GUESTVIEW.q=''; if(search){ search.value=''; search.focus(); } syncClear(); guestApplyFilter(); }; }
  syncClear();
  host.querySelectorAll('[data-gfilter]').forEach(b=>{
    b.classList.remove('primary'); // pulizia da versioni precedenti
    b.classList.toggle('fon', b.getAttribute('data-gfilter')===GUESTVIEW.filter);
    b.onclick=()=>{ GUESTVIEW.filter=b.getAttribute('data-gfilter');
      host.querySelectorAll('[data-gfilter]').forEach(x=>x.classList.toggle('fon', x===b)); guestApplyFilter(); };
  });
  guestApplyFilter();
}
function guestApplyFilter(){
  const q=(GUESTVIEW.q||'').trim().toLowerCase(), f=GUESTVIEW.filter||'all';
  let shown=0;
  document.querySelectorAll('tr[data-grow]').forEach(tr=>{
    const okF=(f==='all'||f===tr.getAttribute('data-rsvp'));
    const okQ=(!q||(tr.getAttribute('data-name')||'').indexOf(q)>=0);
    const vis=okF&&okQ; tr.style.display=vis?'':'none'; if(vis) shown++;
  });
  document.querySelectorAll('tr[data-hh]').forEach(h=>{
    let n=h.nextElementSibling, any=false;
    while(n && n.getAttribute('data-grow')!==null && n.hasAttribute('data-grow')){ if(n.style.display!=='none') any=true; n=n.nextElementSibling; }
    h.style.display=any?'':'none';
  });
  const empty=document.getElementById('guestEmpty'); if(empty) empty.style.display=shown?'none':'';
}
// Export CSV della lista ospiti (G8).
function exportGuestsCsv(){
  const vars=seatActiveVars();
  // Esporta TUTTI i campi presenti nell'app: anagrafica, RSVP/menu, logistica,
  // tavolo assegnato (derivato dai Tavoli) e regali/ringraziamenti, piu' le
  // variabili personalizzate attive.
  const head=["Nome","Lato","Nucleo","Gruppo","RSVP","Tipo","Menu","Intolleranze","Accessibilita","Navetta","Accompagnatori","Tavolo","Regalo","Ringraziato"].concat(vars.map(v=>v.name));
  const q=s=>{ s=(s==null?"":String(s)); return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const rows=(ev().guests||[]).map(g=>{
    const tbl=seatTableOf(g.id);
    const base=[g.name, g.side==="A"?meta().coupleA:meta().coupleB, g.household||"", g.group||"", (RSVP[g.rsvp]&&RSVP[g.rsvp][1])||g.rsvp, g.ptype||"adulto", g.meal||"normale", g.intolerances||"", g.accessibility||"", g.shuttle?"Sì":"No", g.plusOne||0, tbl?tbl.name:"", g.gift||"", g.thanked?"Sì":"No"];
    return base.concat(vars.map(v=>(g.attr&&g.attr[v.id])||"")).map(q).join(",");
  });
  const csv="﻿"+head.map(q).join(",")+"\n"+rows.join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download="ospiti_"+meta().coupleA+"_"+meta().coupleB+".csv"; a.click();
  toast("CSV esportato ("+rows.length+" ospiti)");
}
// Tableau stampabile (G8): apre una finestra con i tavoli e i loro ospiti.
function printTables(){
  const tables=ev().tables||[]; if(!tables.length){ toast("Nessun tavolo"); return; }
  const cards=tables.map(t=>{
    const names=(t.seatIds||[]).filter(Boolean).map(id=>esc(seatGuestName(id)));
    return `<div class="pt-card"><h3>${esc(t.name)}</h3><div class="pt-sub">${names.length}/${t.seats} posti</div><ol>${names.map(n=>`<li>${n}</li>`).join("")||'<li class="pt-empty">—</li>'}</ol></div>`;
  }).join("");
  const w=window.open("","_blank");
  if(!w){ toast("Consenti i popup per stampare"); return; }
  w.document.write('<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Tableau — '+esc(meta().coupleA)+' & '+esc(meta().coupleB)+'</title><style>body{font-family:system-ui,-apple-system,Arial,sans-serif;margin:20px;color:#1E2A30}h1{text-align:center;font-weight:600;font-size:20px}.pt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}.pt-card{border:1px solid #ccc;border-radius:10px;padding:10px;break-inside:avoid}.pt-card h3{margin:0 0 2px;font-size:15px}.pt-sub{font-size:12px;color:#666;margin-bottom:6px}ol{margin:0;padding-left:18px}li{font-size:13px;margin:2px 0}.pt-empty{list-style:none;margin-left:-18px;color:#aaa}@media print{.noprint{display:none}}</style></head><body><h1>Tableau — '+esc(meta().coupleA)+' &amp; '+esc(meta().coupleB)+'</h1><div class="noprint" style="text-align:center;margin-bottom:12px"><button onclick="window.print()">Stampa</button></div><div class="pt-grid">'+cards+'</div></body></html>');
  w.document.close();
}
// Etichette accessibili per i pulsanti icona senza testo (es. "×", "⚙").
function ariaEnhance(root){
  if(!root) return;
  try{ const bs=root.querySelectorAll('button:not([aria-label]):not([aria-labelledby])');
    for(let i=0;i<bs.length;i++){ const tx=(bs[i].textContent||"").trim(); if(tx==="×"||tx==="✕"||tx==="&times;") bs[i].setAttribute("aria-label","Rimuovi"); }
  }catch(e){}
}
// Indicatore di stato sync in header: visibile solo se il cloud è configurato.
function updateSyncChip(){
  const el=document.getElementById("syncChip"); if(!el) return;
  if(typeof Cloud==="undefined" || !Cloud.configured()){ el.style.display="none"; return; }
  el.style.display="";
  if(!Sync.isEnabled()){ el.textContent="Accedi per sincronizzare"; return; }
  const map={synced:"☁ Sincronizzato", syncing:"☁ Sincronizzo…", offline:"☁ Offline", local:"☁ —"};
  // Stato "visibile": i push lampo non mostrano "Sincronizzo…" (soglia in Sync).
  const shown=Sync.displayStatus?Sync.displayStatus():Sync.getStatus();
  let txt=map[shown]||("☁ "+shown);
  // se il sync e' in corso ma sotto soglia, ricontrolla tra poco (senza accumulare timer)
  if(Sync.getStatus()==="syncing" && shown!=="syncing"){ clearTimeout(updateSyncChip._t); updateSyncChip._t=setTimeout(updateSyncChip, 850); }
  if(typeof Session!=="undefined" && Session.role()==="viewer") txt+=" · sola lettura";
  el.textContent=txt;
}

/* ============ DASHBOARD ============ */
/* Cifre riservate in Dashboard: sfocate finche' non le tocchi. Lo stato dei
   valori rivelati vive SOLO in memoria (Set runtime): a ogni apertura
   dell'app si riparte offuscati. Il toggle non rifa' il render. */
const PRIVACY_REVEALED=new Set();
function blurMoney(key, html){
  const on=PRIVACY_REVEALED.has(key);
  return `<span class="blurval${on?' revealed':''}" data-act="togglePrivacy" data-key="${key}" role="button" tabindex="0" aria-label="Importo riservato: tocca per mostrare o nascondere" title="Tocca per mostrare/nascondere">${html}</span>`;
}
function viewDash(){
  const d=DERIVED, m=meta(), e=ev();
  const next=e.payments.filter(p=>!p.paid).sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||"")).slice(0,3);
  const alerts=alertsCompute(); // stessa fonte della campanella
  const pct=d.ceiling?Math.min(100,Math.round(d.committed/d.ceiling*100)):0;
  return `
  <div class="grid cards">
    <div class="card kpi" data-act="goTab" data-target="budget" role="link" title="Apri Budget & Finanze"><div class="v">${blurMoney("k_ceiling",money(d.ceiling))}</div><div class="l">Budget massimo (preventivi + ${m.contingencyPct}% imprevisti)</div></div>
    <div class="card kpi" data-act="goTab" data-target="budget" role="link" title="Apri Budget & Finanze"><div class="v">${blurMoney("k_committed",money(d.committed))}</div><div class="l">Impegnato (spese o preventivi accettati)</div>
      <div class="barwrap"><div class="bar ${d.variance>0?'over':''}" style="width:${pct}%"></div></div></div>
    <div class="card kpi" data-act="goTab" data-target="budget" role="link" title="Apri Budget & Finanze"><div class="v">${blurMoney("k_due",money(d.dueSum))}</div><div class="l">Da pagare (${e.payments.filter(p=>!p.paid).length} rate)</div>
      <div class="l" style="margin-top:3px">Già pagato: ${blurMoney("k_paid",money(d.paidSum))} (${e.payments.filter(p=>p.paid).length} rate)</div></div>
    <div class="card kpi" data-act="goTab" data-target="guests" role="link" title="Apri Ospiti & RSVP"><div class="v">${d.counts.conf} <span class="muted" style="font-size:16px">/ ${e.guests.length}</span></div><div class="l">RSVP confermati · ${d.head} a tavola</div></div>
    <div class="card kpi" data-act="goTab" data-target="vendors" role="link" title="Apri Fornitori"><div class="v">${d.vConf}/${d.vendorsN}</div><div class="l">Fornitori confermati</div></div>
    <div class="card kpi" data-act="goTab" data-target="timeline" role="link" title="Apri Timeline"><div class="v">${d.tasksDone}/${d.tasksTotal}</div><div class="l">Attività completate</div></div>
  </div>

  <div class="sec-title"><h2>Prossimi pagamenti</h2><span class="pill">cash-flow</span></div>
  <div class="scroll-x"><table class="tbl"><thead><tr><th>Voce</th><th>Scadenza</th><th class="num">Importo</th></tr></thead><tbody>
  ${next.length?next.map(p=>`<tr data-act="goTab" data-target="budget" role="link" title="Apri Budget & Finanze" style="cursor:pointer"><td>${esc(p.label)}</td><td>${fdate(p.dueDate)} <span class="muted">(${daysTo(p.dueDate)} gg)</span></td><td class="num">${blurMoney("p_"+p.id,money(p.amount))}</td></tr>`).join(""):`<tr><td colspan="3" class="muted">Nessuna rata in sospeso.</td></tr>`}
  </tbody></table></div>

  <div class="sec-title"><h2>RSVP</h2></div>
  <div class="grid cards">
    <div class="card kpi" data-act="goTab" data-target="guests" role="link" title="Apri Ospiti & RSVP"><div class="v">${d.counts.conf}</div><div class="l">Confermati</div></div>
    <div class="card kpi" data-act="goTab" data-target="guests" role="link" title="Apri Ospiti & RSVP"><div class="v">${d.counts.attesa}</div><div class="l">In attesa</div></div>
    <div class="card kpi" data-act="goTab" data-target="guests" role="link" title="Apri Ospiti & RSVP"><div class="v">${d.counts.no}</div><div class="l">Non vengono</div></div>
    <div class="card kpi" data-act="goTab" data-target="seating" role="link" title="Apri Tavoli"><div class="v">${d.assignedHead}/${d.seatCap||0}</div><div class="l">Posti assegnati / capienza tavoli</div></div>
  </div>

  <div class="sec-title"><h2>Avvisi</h2><span>${alerts.length?`<button class="btn sm ghost" data-act="openAlerts">Apri centro avvisi</button>`:""}</span></div>
  <div class="card">${alerts.length?alerts.map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><span class="pill ${ALERT_PILL[a.sev]}">${ALERT_LABEL[a.sev]}</span><button data-act="goAlert" data-target="${a.tab}" data-ref="${esc((a.ref||[]).join(","))}" style="flex:1;text-align:left;background:none;border:none;padding:0;font-size:13px;color:var(--ink);cursor:pointer;min-height:auto">${esc(a.text)}</button></div>`).join(""):'<span class="muted">Tutto in ordine.</span>'}</div>
  `;
}

/* ============ BUDGET ============ */
const TIER=["","Quasi certa","Molto probabile","Probabile","Possibile","Meno probabile"];
function viewBudget(){
  const e=ev(), m=meta(), d=DERIVED;
  let rows="";
  for(let t=1;t<=5;t++){
    const items=e.budget.filter(b=>b.tier===t);
    if(!items.length) continue;
    rows+=`<tr class="row-group"><td colspan="4">${TIER[t]}</td></tr>`;
    items.forEach(b=>{
      rows+=`<tr data-brow="${b.id}">
        <td>${esc(b.item)}${b.paid?' <span class="pill ok">pagata</span>':''}</td>
        <td class="num">${b.quote?money(b.quote):'<span class="muted">—</span>'}</td>
        <td class="num">${b.actual?money(b.actual):'<span class="muted">—</span>'}</td>
        <td class="num"><button class="btn sm ghost" data-act="editBudget" data-id="${b.id}" aria-label="Modifica ${esc(b.item)}" title="Modifica">&#9998;</button><button class="btn sm danger swdel" data-act="delBudget" data-id="${b.id}" aria-label="Elimina ${esc(b.item)}" title="Elimina">&times;</button></td>
      </tr>`;
    });
  }
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${money(d.quo)}</div><div class="l">Preventivi totali</div></div>
    <div class="card kpi"><div class="v">${money(d.act)}</div><div class="l">Effettivo</div></div>
    <div class="card kpi"><div class="v">${money(d.act-d.quo)}</div><div class="l">Scostamento (effettivo − preventivi)</div></div>
    <div class="card kpi"><div class="v">${money(d.ceiling)}</div><div class="l">Budget massimo (preventivi + ${m.contingencyPct}% imprevisti)</div></div>
  </div>

  <div class="sec-title"><h2>Pianificazione</h2><span class="pill">${dnum(m.plannedGuests)} ospiti previsti</span></div>
  <div class="card">
    <div class="two">
      <div class="field"><label>Ospiti previsti (per catering e aperitivo)</label><input class="inp" type="number" id="plg" value="${m.plannedGuests}" min="0"></div>
      <div class="field"><label>Contingenza %</label><input class="inp" type="number" id="cpct" value="${m.contingencyPct}" min="0" max="30"></div>
    </div>
    <div class="btnbar"><button class="btn" data-act="applyPlan">Applica</button>
    <span class="muted" style="align-self:center">Riserva: ${money(d.cont)}</span></div>
  </div>

  <div class="sec-title"><h2>Voci di spesa</h2><button class="btn sm" data-act="addBudget">+ Voce</button></div>
  <div class="scroll-x"><table class="tbl">
    <thead><tr><th>Voce</th><th class="num">Preventivo</th><th class="num">Effettivo</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>

  ${(function(){
    const today=new Date().toISOString().slice(0,10);
    const pays=[...e.payments].sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||""));
    const overdueSum=pays.filter(p=>!p.paid&&p.dueDate&&p.dueDate<today).reduce((s,p)=>s+(+p.amount||0),0);
    const next=pays.filter(p=>!p.paid&&(!p.dueDate||p.dueDate>=today))[0];
    const planned=d.paidSum+d.dueSum, pct=planned?Math.round(d.paidSum*100/planned):0;
    const rows=pays.length?pays.map(p=>{
      const over=!p.paid&&p.dueDate&&p.dueDate<today;
      const stato=p.paid?'<span class="pill ok">pagata</span>':(over?'<span class="pill no">scaduta</span>':'<span class="pill warn">da pagare</span>');
      const vn=pmVendorName(p.vendorId);
      return `<tr><td>${esc(p.label)}${vn?`<div class="muted" style="font-size:12px">${esc(vn)}</div>`:""}</td>
        <td>${fdate(p.dueDate)}</td><td class="num">${money(p.amount)}</td><td>${stato}</td>
        <td class="num"><button class="btn sm ${p.paid?'ghost':''}" data-act="togglePay" data-id="${p.id}">${p.paid?'riapri':'segna pagata'}</button> <button class="btn sm ghost" data-act="editPayment" data-id="${p.id}">Modifica</button> <button class="btn sm danger" data-act="delPayment" data-id="${p.id}">&times;</button></td></tr>`;
    }).join(""):'<tr><td colspan="5" class="muted">Nessuna rata. Aggiungine una o collegala a un fornitore.</td></tr>';
    return `
  <div class="sec-title"><h2>Pagamenti</h2><button class="btn sm" data-act="addPayment">+ Rata</button></div>
  <div class="grid cards" style="grid-template-columns:1fr 1fr">
    <div class="card kpi"><div class="v">${money(d.paidSum)}</div><div class="l">Pagato</div></div>
    <div class="card kpi"><div class="v">${money(d.dueSum)}</div><div class="l">Da pagare${overdueSum>0?` · <span style="color:var(--no)">${money(overdueSum)} scaduto</span>`:""}</div></div>
  </div>
  <div class="card" style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>Avanzamento pagamenti</span><b>${pct}%</b></div>
    <div style="height:8px;background:var(--line);border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--sea)"></div></div>
    <div class="muted" style="font-size:12px;margin-top:8px">Prossima: ${next?`${esc(next.label)} · ${fdate(next.dueDate)} · ${money(next.amount)}`:"nessuna in sospeso"}</div>
    <div class="muted" style="font-size:12px;margin-top:2px">Rate pianificate ${money(planned)} · preventivi impegnati ${money(d.committed)}${planned<d.committed?` · <span style="color:var(--gold)">${money(d.committed-planned)} non ancora messo a rata</span>`:""}</div>
  </div>
  <div class="scroll-x"><table class="tbl">
    <thead><tr><th>Rata</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <p class="muted" style="font-size:13px;margin-top:8px">Cash-flow mensile: ${Object.keys(DERIVED.cf).sort().map(k=>k+" → "+money(DERIVED.cf[k])).join(" · ")||"—"}</p>`;
  })()}
  `;
}

/* ============ GUESTS ============ */
// Separazione tipologia persona / tipologia menu (richiesta utente):
// PTYPES = chi e' (adulto/bambino), MEALS = che menu mangia.
const PTYPES=["adulto","bambino"];
const MEALS=["normale","vegetariano","celiaco","vegano"];
const RSVP={conf:["ok","Confermato"],attesa:["warn","In attesa"],no:["no","Non viene"]};
function viewGuests(){
  const e=ev(), d=DERIVED;
  const hh={}; e.guests.forEach(g=>{ (hh[g.household]=hh[g.household]||[]).push(g); });
  let blocks="";
  Object.keys(hh).sort().forEach(name=>{
    blocks+=`<tr class="row-group" data-hh="${esc(name)}"><td colspan="4">${esc(name)} <span class="muted" style="font-weight:400">· lato ${hh[name][0].side==="A"?meta().coupleA:meta().coupleB}</span></td></tr>`;
    hh[name].forEach(g=>{
      const r=RSVP[g.rsvp]||["todo","?"];
      const dot=`<span class="gdot" style="background:${seatGroupColor(g.group)};margin-right:6px;vertical-align:middle" title="${esc(g.group||'nessun gruppo')}"></span>`;
      blocks+=`<tr data-grow="1" data-rsvp="${g.rsvp}" data-name="${esc((g.name||'').toLowerCase())}">
        <td>${dot}${esc(g.name)}${g.plusOne?` <span class="tag">+${g.plusOne}</span>`:""}${g.shuttle?' <span class="tag">navetta</span>':""}${g.accessibility?` <span class="tag">${esc(g.accessibility)}</span>`:""}${(function(){var _t=seatTableOf(g.id);return _t?` <span class="tag">${esc(_t.name)}</span>`:"";})()}</td>
        <td><button class="pill ${r[0]}" data-act="cycleRsvp" data-id="${g.id}" title="Clic per cambiare stato RSVP" style="cursor:pointer;border:none;font:inherit">${r[1]}</button></td>
        <td>${esc(g.meal||"normale")}${g.ptype==="bambino"?' <span class="tag">bambino</span>':""}${g.intolerances?` <span class="muted">· ${esc(g.intolerances)}</span>`:""}</td>
        <td class="num"><button class="btn sm ghost" data-act="editGuest" data-id="${g.id}" aria-label="Modifica ${esc(g.name)}" title="Modifica">&#9998;</button> <button class="btn sm danger" data-act="delGuest" data-id="${g.id}" aria-label="Elimina ${esc(g.name)}" title="Elimina">×</button></td>
      </tr>`;
    });
  });
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${d.head}</div><div class="l">A tavola (confermati + accompagnatori)</div></div>
    <div class="card kpi"><div class="v">${d.counts.attesa}</div><div class="l">In attesa</div></div>
    <div class="card kpi"><div class="v">${meta().plannedGuests}</div><div class="l">Previsti (pianificazione)</div></div>
    <div class="card kpi"><div class="v">${d.intoll.length}</div><div class="l">Con intolleranze</div></div>
  </div>

  <div class="card" style="margin-top:14px"><span class="pill todo">sorgente unica</span> ${ev().guests.length} ospiti in lista. Con Importa aggiungi in blocco da Excel, Google Sheets o CSV: incolli o carichi il file, mappi le colonne e confermi. Da qui i dati alimentano catering e tavoli.</div>

  <div class="sec-title"><h2>Ospiti per nucleo</h2><span><button class="btn sm ghost" data-act="shareRsvp">Link RSVP</button> <button class="btn sm ghost" data-act="exportGuestsCsv">Esporta CSV</button> <button class="btn sm ghost" data-act="importGuests">Importa</button> <button class="btn sm" data-act="addGuest">+ Ospite</button></span></div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
    <span style="position:relative;flex:1;min-width:150px;display:inline-flex"><input class="inp" id="guestSearch" placeholder="Cerca ospite…" style="width:100%;padding-right:38px" aria-label="Cerca ospite"><button id="guestSearchClear" aria-label="Svuota ricerca" title="Svuota ricerca" style="display:none;position:absolute;right:4px;top:50%;transform:translateY(-50%);border:none;background:var(--card2);color:var(--ink-soft);border-radius:50%;width:28px;height:28px;min-height:28px;font-size:15px;line-height:1;padding:0;cursor:pointer">×</button></span>
    <button class="btn sm ghost" data-gfilter="all">Tutti</button>
    <button class="btn sm ghost" data-gfilter="conf">Confermati</button>
    <button class="btn sm ghost" data-gfilter="attesa">In attesa</button>
    <button class="btn sm ghost" data-gfilter="no">Non viene</button>
  </div>
  <div class="scroll-x"><table class="tbl">
    <thead><tr><th>Nome</th><th>RSVP</th><th>Menù</th><th></th></tr></thead>
    <tbody>${blocks}</tbody>
  </table></div>
  <div id="guestEmpty" class="muted" style="display:none;padding:10px;font-size:13px">Nessun ospite corrisponde al filtro.</div>

  ${(function(){
    // Report catering filtrabile: il pill cicla confermati -> in attesa -> tutti.
    const SCOPES={conf:["ok","solo confermati","Nessun confermato."], attesa:["warn","solo in attesa","Nessuno in attesa."], all:["todo","tutti in lista","Lista vuota."]};
    const sc=SCOPES[CATERING_SCOPE]?CATERING_SCOPE:"conf", lab=SCOPES[sc];
    const sel=e.guests.filter(x=>sc==="all"?true:x.rsvp===sc);
    const head=sel.reduce((s,x)=>s+1+(+x.plusOne||0),0);
    const kids=sel.filter(x=>x.ptype==="bambino").length;
    // matrice menu x tipologia: righe = menu, colonne = adulti/bambini
    const mx={};
    sel.forEach(x=>{ const m=x.meal||"normale", p=(x.ptype==="bambino")?"b":"a"; mx[m]=mx[m]||{a:0,b:0}; mx[m][p]++; if(x.plusOne){ mx["normale"]=mx["normale"]||{a:0,b:0}; mx["normale"].a+=(+x.plusOne); } });
    const intoll=sel.filter(x=>x.intolerances).map(x=>x.name+": "+x.intolerances);
    const access=sel.filter(x=>x.accessibility).map(x=>x.name+": "+x.accessibility);
    const mealRows=Object.keys(mx).map(k=>`<tr><td>${esc(k)}</td><td class="num">${mx[k].a||""}</td><td class="num">${mx[k].b||""}</td><td class="num"><b>${mx[k].a+mx[k].b}</b></td></tr>`).join("")||`<tr><td colspan="4" class="muted">${lab[2]}</td></tr>`;
    return `
  <div class="sec-title"><h2>Report catering</h2><button class="pill ${lab[0]}" data-act="cycleCateringScope" title="Clic per cambiare: confermati / in attesa / tutti" aria-label="Filtro report: ${lab[1]}. Tocca per cambiare." style="cursor:pointer;border:none;font:inherit">${lab[1]} &#8635;</button></div>
  <div class="grid cards">
    <div class="card kpi"><div class="v">${head}</div><div class="l">Coperti totali${head>sel.length?`</div><div class="l" style="margin-top:2px">${sel.length} invitati + ${head-sel.length} accompagnatori (+1)`:""}</div></div>
    <div class="card kpi"><div class="v">${kids}</div><div class="l">Bambini</div></div>
    <div class="card kpi"><div class="v">${intoll.length}</div><div class="l">Con intolleranze</div></div>
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">
    <div class="card" style="grid-column:1 / -1"><h3>Pasti (menù × tipologia)</h3><div class="scroll-x" style="border:none"><table class="tbl"><thead><tr><th>Menù</th><th class="num">Adulti</th><th class="num">Bambini</th><th class="num">Totale</th></tr></thead><tbody>${mealRows}</tbody></table></div><p class="muted" style="font-size:12px;margin-top:6px">Gli accompagnatori (+1) contano come adulti, menù normale.</p></div>
    <div class="card"><h3>Intolleranze</h3>${intoll.length?intoll.map(x=>`<div style="padding:4px 0">${esc(x)}</div>`).join(""):'<span class="muted">Nessuna.</span>'}${access.length?`<div style="margin-top:8px"><h3 style="font-size:14px">Accessibilità</h3>${access.map(x=>`<div style="padding:4px 0">${esc(x)}</div>`).join("")}</div>`:""}</div>
  </div>`;
  })()}

  <div class="sec-title"><h2>Navetta</h2><span class="pill">${d.shuttle} posti</span></div>
  <div class="card">${(function(){
    const sh=e.guests.filter(x=>x.rsvp==="conf"&&x.shuttle);
    if(!sh.length) return '<span class="muted">Nessun confermato ha chiesto la navetta.</span>';
    return sh.map(x=>`<div style="padding:4px 0;border-bottom:1px solid var(--line)">${esc(x.name)}${(+x.plusOne)?` <span class="tag">+${x.plusOne}</span>`:""}</div>`).join("")
      +'<p class="muted" style="font-size:12px;margin-top:6px">I posti contano anche gli accompagnatori.</p>';
  })()}</div>
  `;
}

/* ============ TAVOLI (riepilogo dal Tableau; l'editor è il Tableau) ============ */
function tableName(id){ const t=ev().tables.find(x=>x.id===id); return t?t.name:""; }

/* ---- modello dati posti (nativo, B1): forme, vicinati, ingombro, validazione ---- */
const SEAT_SHAPES={round:'Tonda',rect:'Rettangolare',square:'Quadrata',imperial:'Imperiale',serpentine:'Serpentina'};
const SEAT_CFG={wNear:10,wFar:12,wAffinity:3,sideWeight:1.0,faceWeight:0.85,restarts:5,maxSwaps:2000};
function seatColRow(idx){ return {col:Math.floor(idx/2),row:idx%2}; }
function seatAdjacency(n){
  const adj=[]; for(let i=0;i<n;i++) adj.push({side:[],face:null});
  for(let i=0;i<n;i++){ const cr=seatColRow(i);
    const faceIdx=cr.row===0?i+1:i-1;
    if(faceIdx>=0&&faceIdx<n&&seatColRow(faceIdx).col===cr.col) adj[i].face=faceIdx;
    [i-2,i+2].forEach(j=>{ if(j>=0&&j<n&&seatColRow(j).row===cr.row) adj[i].side.push(j); });
  }
  return adj;
}
function seatPairs(n){
  const adj=seatAdjacency(n), pairs=[], seen=new Set();
  const add=(a,b,w)=>{ const k=a<b?a+'-'+b:b+'-'+a; if(seen.has(k))return; seen.add(k); pairs.push({a:Math.min(a,b),b:Math.max(a,b),w:w}); };
  for(let i=0;i<n;i++){ if(adj[i].face!=null) add(i,adj[i].face,SEAT_CFG.faceWeight); adj[i].side.forEach(j=>add(i,j,SEAT_CFG.sideWeight)); }
  return pairs;
}
function seatFootprint(t){
  const s=t.seats;
  if(t.shape==='round'){ const c=Math.max(s*0.6,3.77); const d=c/Math.PI; return {w:d+1.8,h:d+1.8,lin:d}; }
  if(t.shape==='square'){ const side=Math.max(1.2,Math.ceil(s/4)*0.7); return {w:side+1.8,h:side+1.8,lin:side}; }
  const len=Math.max(1.6,Math.ceil(s/2)*0.65); const depth=(t.shape==='imperial'||t.shape==='serpentine')?1.0:0.9;
  const lin=t.shape==='serpentine'?len*1.15:len; return {w:len+1.6,h:depth+1.8,lin:lin};
}
function seatValidateSerpentine(t,guestExists){
  const issues=[];
  if(!t||t.shape!=='serpentine')return issues;
  const ids=t.seatIds||[];
  if(ids.length>t.seats)issues.push('più persone ('+ids.length+') dei posti ('+t.seats+')');
  const seen=new Set();
  ids.forEach(id=>{ if(id===undefined||id===null)return; if(seen.has(id))issues.push('persona duplicata nel tavolo: '+id); seen.add(id); if(guestExists&&!guestExists(id))issues.push('persona inesistente: '+id); });
  const adj=seatAdjacency(t.seats);
  adj.forEach((a,i)=>{ if(a.face!=null&&adj[a.face].face!==i)issues.push('dirimpettaio non reciproco al posto '+(i+1)); });
  return issues;
}
function seatableGuests(){ return ev().guests.filter(g=>g.rsvp==='conf'||g.rsvp==='attesa'); }
function seatTableOf(gid){ return (ev().tables||[]).find(t=>(t.seatIds||[]).indexOf(gid)>=0); }
function seatHeadAt(t){ return (t.seatIds||[]).filter(id=>id!=null).length; }
// Integrità: rimuove ogni riferimento a un ospite (posti a tavola + regole).
// Ritorna le regole ripulite; azzera i posti in-place. Usato da delGuest.
function seatPurgeGuest(tables, rules, gid){
  (tables||[]).forEach(t=>{ if(t.seatIds) t.seatIds=t.seatIds.map(x=>x===gid?null:x); });
  return (rules||[]).filter(r=>r.a!==gid && r.b!==gid);
}

/* ---- optimizer posti 2-opt con vincoli e affinità (nativo, B2) ---- */
function seatRng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function seatShuffle(arr,rng){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); const tmp=arr[i]; arr[i]=arr[j]; arr[j]=tmp; } return arr; }
function seatCost(order,n,rulesIdx,affinityFn){
  const pairs=seatPairs(n); let cost=0;
  for(const pr of pairs){ const ga=order[pr.a],gb=order[pr.b];
    if(ga===undefined||gb===undefined)continue;
    const key=ga<gb?ga+'|'+gb:gb+'|'+ga;
    if(rulesIdx.separate.has(key))cost+=SEAT_CFG.wFar*pr.w;
    else if(rulesIdx.together.has(key))cost-=SEAT_CFG.wNear*pr.w;
    else if(affinityFn&&affinityFn(ga,gb))cost-=SEAT_CFG.wAffinity*pr.w;
  }
  return cost;
}
function seatOptimize(gids,seats,rulesIdx,affinityFn){
  const people=gids.filter(x=>x!=null);
  const baseOrder=new Array(seats).fill(undefined); people.forEach((g,i)=>baseOrder[i]=g);
  const before=seatCost(baseOrder,seats,rulesIdx,affinityFn);
  let bestOrder=baseOrder.slice(),bestCost=before,swapBudget=SEAT_CFG.maxSwaps;
  const evalOrder=ord=>seatCost(ord,seats,rulesIdx,affinityFn);
  for(let r=0;r<SEAT_CFG.restarts&&swapBudget>0;r++){
    let cur=baseOrder.slice();
    if(r>0){ const rng=seatRng(0x9E3779B9 ^ (r*2654435761)); const arr=people.slice(); seatShuffle(arr,rng); cur=new Array(seats).fill(undefined); const slots=[]; for(let i=0;i<seats;i++)slots.push(i); seatShuffle(slots,rng); arr.forEach((g,i)=>cur[slots[i]]=g); }
    let curCost=evalOrder(cur),improved=true;
    while(improved&&swapBudget>0){ improved=false;
      for(let i=0;i<seats&&swapBudget>0;i++){ for(let j=i+1;j<seats&&swapBudget>0;j++){
        if(cur[i]===undefined&&cur[j]===undefined)continue;
        swapBudget--;
        const ti=cur[i]; cur[i]=cur[j]; cur[j]=ti;
        const c=evalOrder(cur);
        if(c<curCost-1e-9){ curCost=c; improved=true; }
        else { const t2=cur[i]; cur[i]=cur[j]; cur[j]=t2; }
      } }
    }
    if(curCost<bestCost-1e-9){ bestCost=curCost; bestOrder=cur.slice(); }
  }
  return {order:bestOrder,before:before,after:bestCost,improved:bestCost<before-1e-9};
}
function seatRulesIdx(){ const together=new Set(),separate=new Set(); ((ev().seating&&ev().seating.rules)||[]).forEach(r=>{ const k=r.a<r.b?r.a+'|'+r.b:r.b+'|'+r.a; if(r.kind==='together')together.add(k); else separate.add(k); }); return {together:together,separate:separate}; }
// Variabili configurabili dell'ottimizzatore (G1): peso + modo unisci/separa +
// tendina di valori. Le prime 4 attive; le altre pronte ma spente. L'utente può
// aggiungerne di sue (custom). Vivono in ev().seating.vars; g.attr{varId:valore}.
const SEAT_VARS_DEF=[
  {id:'nucleo',   name:'Nucleo / Famiglia', on:true,  weight:10, mode:'cluster', values:['','Sposa','Sposo','Famiglia sposa','Famiglia sposo','Amici sposa','Amici sposo','Colleghi','Vicini']},
  {id:'lato',     name:'Lato',              on:true,  weight:5,  mode:'cluster', values:['','Sposa','Sposo','Entrambi']},
  {id:'eta',      name:"Fascia d'età",      on:true,  weight:4,  mode:'cluster', values:['','Bambino','Giovane','Adulto','Anziano']},
  {id:'ambiente', name:'Ambiente',          on:true,  weight:6,  mode:'cluster', values:['','Parenti','Amici','Colleghi','Vicini','Scuola','Sport']},
  {id:'lingua',   name:'Lingua',            on:false, weight:7,  mode:'cluster', values:['','Italiano','Inglese','Spagnolo','Francese','Tedesco']},
  {id:'uscita',   name:"Vicino all'uscita", on:false, weight:3,  mode:'cluster', values:['','Sì','No']},
  {id:'fumatori', name:'Fumatori',          on:false, weight:2,  mode:'separate', values:['','Sì','No']},
  {id:'sposi',    name:'Vicino agli sposi', on:false, weight:8,  mode:'cluster', values:['','Sì','No']},
  {id:'stato',    name:'Stato (single/coppia)', on:true, weight:5, mode:'cluster', values:['','Single','In coppia','Famiglia']}
];
const SEAT_VARS_VER=2; // v2: aggiunta 'stato' (single/coppia/famiglia)
function seatVars(){
  const e=ev(); e.seating=e.seating||{rules:[]};
  if(!e.seating.vars){ e.seating.vars=JSON.parse(JSON.stringify(SEAT_VARS_DEF)); e.seating.varsVer=SEAT_VARS_VER; return e.seating.vars; }
  // Migrazione a versioni: integra SOLO le variabili nuove di questa versione,
  // una volta sola (così una default eliminata dall'utente non riappare).
  if((e.seating.varsVer||1)<2){
    const have=new Set(e.seating.vars.map(v=>v.id));
    ['stato'].forEach(id=>{ if(!have.has(id)){ const def=SEAT_VARS_DEF.find(v=>v.id===id); if(def) e.seating.vars.push(JSON.parse(JSON.stringify(def))); } });
    e.seating.varsVer=2;
  }
  return e.seating.vars;
}
function seatActiveVars(){ return seatVars().filter(v=>v.on); }
function seatVarById(id){ return seatVars().find(v=>v.id===id); }
// Similarità pesata con segno (G2): stesso valore -> +peso (unisci) o -peso (separa).
function seatSimilarity(a,b){ let s=0; if(!a||!b) return 0; seatActiveVars().forEach(v=>{ const av=a.attr&&a.attr[v.id], bv=b.attr&&b.attr[v.id]; if(!av||!bv) return; if(av===bv){ s+= v.mode==='separate'? -v.weight : v.weight; } }); return s; }
function seatSimilarityFn(){ const by={}; ev().guests.forEach(g=>by[g.id]=g); return function(ga,gb){ return seatSimilarity(by[ga],by[gb]); }; }
function seatAffinityFn(){ const by={}; ev().guests.forEach(g=>by[g.id]=g); return function(ga,gb){ const a=by[ga],b=by[gb]; if(!a||!b)return false; const sameHH=a.household&&a.household!=='Senza nucleo'&&a.household===b.household; const sameGroup=a.group&&b.group&&a.group===b.group; const kids=a.meal==='bambino'&&b.meal==='bambino'; return !!(sameHH||sameGroup||kids|| seatSimilarity(a,b)>0); }; }
function seatOptimizeTable(t){ return seatOptimize((t.seatIds||[]).slice(), t.seats, seatRulesIdx(), seatAffinityFn()); }
// Pianificazione assegnazione globale ospiti->tavoli (pura, testabile).
// Euristica: raggruppa per vincoli "insieme" + stesso nucleo (union-find), poi
// bin-packing dei gruppi nei tavoli rispettando capienza e vincoli "lontano".
// together/separate = Set di chiavi "min|max" (come da seatRulesIdx).
// simFn(gidA,gidB)->numero (opzionale): se dato, il tavolo si sceglie per affinità
// pesata (variabili) con chi è già seduto, non solo per posti liberi.
function seatPlanAssignment(tables, guests, together, separate, simFn){
  const byId={}; guests.forEach(g=>byId[g.id]=g);
  const parent={}; guests.forEach(g=>parent[g.id]=g.id);
  function find(x){ while(parent[x]!==x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; }
  function union(a,b){ if(byId[a]&&byId[b]) parent[find(a)]=find(b); }
  (together||new Set()).forEach(k=>{ const p=k.split("|"); union(p[0],p[1]); });
  const hh={}; guests.forEach(g=>{ const h=g.household; if(h&&h!=="Senza nucleo"){ if(hh[h]) union(hh[h],g.id); else hh[h]=g.id; } });
  const groups={}; guests.forEach(g=>{ const r=find(g.id); (groups[r]=groups[r]||[]).push(g.id); });
  const groupList=Object.keys(groups).map(k=>groups[k]).sort((a,b)=>b.length-a.length);
  const sepKey=(a,b)=> a<b?a+"|"+b:b+"|"+a;
  const sep=separate||new Set();
  function conflicts(members, placed){ for(const m of members) for(const p of placed){ if(sep.has(sepKey(m,p))) return true; } return false; }
  const assign={}, cap={}; tables.forEach(t=>{ assign[t.id]=[]; cap[t.id]=t.seats||0; });
  const unseated=[], warnings=[];
  for(const grp of groupList){
    let remaining=grp.slice();
    while(remaining.length){
      let best=null, bestFree=0, bestScore=-Infinity, bestFits=false;
      for(const t of tables){ const free=cap[t.id]-assign[t.id].length; if(free<=0) continue; if(conflicts(remaining, assign[t.id])) continue;
        if(simFn){ let aff=0; for(const m of remaining) for(const p of assign[t.id]) aff+=simFn(m,p);
          const fits=free>=remaining.length, score=aff + free*1e-3;
          // preferisci i tavoli che contengono tutto il gruppo; a parità, per affinità
          if((fits&&!bestFits) || (fits===bestFits && score>bestScore)){ best=t; bestScore=score; bestFree=free; bestFits=fits; } }
        else if(free>bestFree){ best=t; bestFree=free; } }
      if(!best){ unseated.push.apply(unseated, remaining); break; }
      const take=remaining.slice(0, Math.min(bestFree, remaining.length));
      if(take.length<remaining.length) warnings.push("Gruppo diviso ("+take.length+"/"+remaining.length+")");
      assign[best.id]=assign[best.id].concat(take);
      remaining=remaining.slice(take.length);
    }
  }
  return {assign:assign, unseated:unseated, warnings:warnings};
}


/* ---- planimetria SVG nativa (B3) ---- */
// Geometria dei posti in unità "mondo" (coerenti con seatFootprint), centro tavolo a (0,0).
// Per serpentine/imperial/rect usa il modello 2-file di seatColRow, così il disegno
// rispecchia le adiacenze face/side usate da seatPairs/optimizer.
function seatPositions(t){
  const n=Math.max(0,t.seats|0), f=seatFootprint(t), pos=[];
  if(t.shape==='round'){
    const r=Math.max(f.w,f.h)/2-0.4;
    for(let i=0;i<n;i++){ const a=(2*Math.PI*i)/n - Math.PI/2; pos.push({x:r*Math.cos(a), y:r*Math.sin(a)}); }
    return pos;
  }
  if(t.shape==='square'){
    const per=Math.max(1,Math.ceil(n/4)), half=f.w/2-0.4;
    for(let i=0;i<n;i++){
      const side=Math.floor(i/per)%4, k=i%per, off=((k+0.5)/per*2-1)*half;
      if(side===0) pos.push({x:off,y:-half});
      else if(side===1) pos.push({x:half,y:off});
      else if(side===2) pos.push({x:off,y:half});
      else pos.push({x:-half,y:off});
    }
    return pos;
  }
  const cols=Math.max(1,Math.ceil(n/2)), colGap=(f.w-0.8)/cols, rowY=(f.h/2)-0.3;
  for(let i=0;i<n;i++){ const cr=seatColRow(i);
    pos.push({x:(cr.col-(cols-1)/2)*colGap, y:cr.row===0?-rowY:rowY});
  }
  return pos;
}
function seatGuestById(gid){ return (ev().guests||[]).find(g=>g.id===gid); }
function seatInitials(g){ if(!g)return""; const p=(g.name||"").trim().split(/\s+/); return (((p[0]||"")[0]||"")+((p[1]||"")[0]||"")).toUpperCase(); }
// Layout a griglia con celle dimensionate sull'ingombro MASSIMO: nessuna
// sovrapposizione, qualunque siano forma e numero di posti dei tavoli.
function seatLayout(tables){
  let cw=0, ch=0;
  tables.forEach(t=>{ const f=seatFootprint(t); if(f.w>cw)cw=f.w; if(f.h>ch)ch=f.h; });
  cw+=1.8; ch+=2.2; // margine tra tavoli + spazio per l'etichetta sotto
  const cols=Math.max(1,Math.ceil(Math.sqrt(tables.length)));
  const pos={};
  // Posizione manuale (drag, G6) se x,y numerici; altrimenti griglia automatica.
  tables.forEach((t,i)=>{ const c=i%cols, r=Math.floor(i/cols);
    if(typeof t.x==="number"&&isFinite(t.x)&&typeof t.y==="number"&&isFinite(t.y)) pos[t.id]={x:t.x, y:t.y};
    else pos[t.id]={x:c*cw+cw/2, y:r*ch+ch/2}; });
  return pos;
}
function renderPlanimetria(){
  const tables=ev().tables||[];
  if(!tables.length) return `<div class="placeholder"><div class="ic">&#9638;</div><p>Nessun tavolo. Usa "+ Tavolo" per disegnare la planimetria.</p></div>`;
  const LP=seatLayout(tables);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  tables.forEach(t=>{ const f=seatFootprint(t), x=LP[t.id].x, y=LP[t.id].y;
    minX=Math.min(minX,x-f.w/2-0.7); maxX=Math.max(maxX,x+f.w/2+0.7);
    minY=Math.min(minY,y-f.h/2-0.9); maxY=Math.max(maxY,y+f.h/2+0.9);
  });
  const W=Math.max(1,maxX-minX), H=Math.max(1,maxY-minY);
  let body="";
  tables.forEach(t=>{
    const f=seatFootprint(t), x=LP[t.id].x, y=LP[t.id].y;
    let shapeSvg;
    if(t.shape==='round'){ shapeSvg=`<circle cx="0" cy="0" r="${(f.lin/2).toFixed(2)}" fill="#e9eef0" stroke="#9bb0b3" stroke-width="0.05"/>`; }
    else if(t.shape==='square'){ const sd=f.lin; shapeSvg=`<rect x="${(-sd/2).toFixed(2)}" y="${(-sd/2).toFixed(2)}" width="${sd.toFixed(2)}" height="${sd.toFixed(2)}" rx="0.15" fill="#e9eef0" stroke="#9bb0b3" stroke-width="0.05"/>`; }
    else { const bw=f.lin, bh=Math.max(0.6,f.h-1.8); shapeSvg=`<rect x="${(-bw/2).toFixed(2)}" y="${(-bh/2).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="0.15" fill="#e9eef0" stroke="#9bb0b3" stroke-width="0.05"/>`; }
    const pos=seatPositions(t), ids=t.seatIds||[];
    let seats="";
    pos.forEach((p,i)=>{
      const gid=ids[i], g=gid?seatGuestById(gid):null;
      const fill=g?(g.side==='A'?'#cfe3ee':'#f0ddd0'):'#ffffff';
      const stroke=g?'#5c8aa3':'#c2cdcf';
      const dash=g?'':' stroke-dasharray="0.12 0.12"';
      seats+=`<g transform="translate(${p.x.toFixed(2)},${p.y.toFixed(2)})" data-act="assignSeat" data-table="${t.id}" data-idx="${i}" data-seat-target="1"${g?` data-drag-guest="${gid}"`:""} style="cursor:pointer;touch-action:none">`
        +`<circle r="0.34" fill="${fill}" stroke="${stroke}" stroke-width="0.04"${dash}/>`
        +(g?`<text x="0" y="0.12" text-anchor="middle" font-size="0.34" fill="#23373b">${esc(seatInitials(g))}</text>`:"")
        +`</g>`;
    });
    const label=esc(t.name)+" · "+seatHeadAt(t)+"/"+t.seats;
    body+=`<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})" data-drag-table="${t.id}" style="cursor:move">${shapeSvg}${seats}`
      +`<text x="0" y="${(f.h/2+0.55).toFixed(2)}" text-anchor="middle" font-size="0.42" fill="#5b6b6e" style="pointer-events:none">${label}</text></g>`;
  });
  // touch-action:none sull'SVG: su touch il browser altrimenti reclama il gesto
  // per lo scroll e annulla il drag (pointercancel). Il resto della pagina resta
  // scrollabile (cards, KPI, aree fuori dall'SVG).
  const zoom=(typeof SEATZOOM==="number"&&SEATZOOM>0)?SEATZOOM:1;
  const zbar=`<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin-bottom:4px"><span class="muted" style="font-size:12px">Zoom</span><button class="btn sm ghost" data-act="seatZoomOut" aria-label="Riduci">−</button><button class="btn sm ghost" data-act="seatZoomReset">${Math.round(zoom*100)}%</button><button class="btn sm ghost" data-act="seatZoomIn" aria-label="Ingrandisci">+</button></div>`;
  return zbar+`<div style="overflow:auto;max-height:64vh"><svg id="planiSvg" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${W.toFixed(2)} ${H.toFixed(2)}" style="width:${(100*zoom).toFixed(0)}%;height:auto;background:#fbfcfc;border-radius:10px;touch-action:none" role="img" aria-label="Planimetria tavoli">${body}</svg></div>`;
}
/* ---- CRUD tavoli nativo (B3) ---- */
function seatNextSeq(){ const e=ev(); e.seating=e.seating||{rules:[]}; e.seating.seq=(e.seating.seq||0)+1; return e.seating.seq; }
function addTable(){ tableEditor(null); }
function editTable(id){ tableEditor(id); }
function tableEditor(id){
  const e=ev(); e.tables=e.tables||[];
  const t=id?e.tables.find(x=>x.id===id):null, isNew=!t;
  const cur=t||{name:seatThemeName(e.tables.length),shape:"round",seats:8};
  modal(isNew?"Nuovo tavolo":"Modifica tavolo",
    `<div class="field"><label>Nome</label><input class="inp" id="tb_name" value="${esc(cur.name)}"></div>
     <div class="two">
       <div class="field"><label>Forma</label><select class="inp" id="tb_shape">${Object.keys(SEAT_SHAPES).map(k=>`<option value="${k}"${k===cur.shape?" selected":""}>${SEAT_SHAPES[k]}</option>`).join("")}</select></div>
       <div class="field"><label>Posti</label><input class="inp" type="number" min="1" max="40" id="tb_seats" value="${cur.seats}"></div>
     </div>`,
    [{label:"Annulla"},{label:isNew?"Crea":"Salva",cls:"",fn:()=>{
       const name=($("#tb_name").value||"").trim()||"Tavolo";
       const shape=$("#tb_shape").value, seats=Math.max(1,Math.min(40,+$("#tb_seats").value||8));
       if(isNew){
         const idx=e.tables.length, cols=4;
         e.tables.push({id:"tb"+seatNextSeq(),name,shape,seats,seatIds:new Array(seats).fill(null),x:null,y:null});
       } else {
         const old=t.seatIds||[], ns=new Array(seats).fill(null);
         for(let i=0;i<Math.min(seats,old.length);i++) ns[i]=old[i];
         t.name=name; t.shape=shape; t.seats=seats; t.seatIds=ns;
       }
       commit(isNew?"Tavolo creato":"Tavolo aggiornato");
     }}]);
}
function delTable(id){ const e=ev(); e.tables=(e.tables||[]).filter(t=>t.id!==id); commit("Tavolo eliminato"); }
function optimizeTable(id){
  const e=ev(), t=(e.tables||[]).find(x=>x.id===id); if(!t) return;
  if(seatHeadAt(t)<2){ toast("Servono almeno 2 ospiti seduti"); return; }
  const res=seatOptimizeTable(t);
  t.seatIds=res.order.map(x=>x===undefined?null:x);
  commit(res.improved?("Ottimizzato: costo "+res.before.toFixed(1)+" → "+res.after.toFixed(1)):"Nessun miglioramento possibile");
}
function optimizeAllTables(){
  const e=ev(); let improved=false, done=0;
  (e.tables||[]).forEach(t=>{ if(seatHeadAt(t)>=2){ const r=seatOptimizeTable(t); t.seatIds=r.order.map(x=>x===undefined?null:x); improved=improved||r.improved; done++; } });
  if(!done){ toast("Nessun tavolo con almeno 2 ospiti"); return; }
  commit(improved?("Ottimizzati "+done+" tavoli"):"Nessun miglioramento possibile");
}
function autoAssignConfirm(){
  const e=ev();
  if(!(e.tables||[]).length){ toast("Crea prima i tavoli"); return; }
  modal("Assegnazione automatica",
    `<p>Riassegna automaticamente tutti gli ospiti ai tavoli in base a vicinanze, nucleo familiare e capienza, poi ottimizza i posti. Sostituisce la disposizione attuale.</p>`,
    [{label:"Annulla"},{label:"Assegna",cls:"",fn:()=>seatAutoAssign()}]);
}
// Core: assegna + ottimizza senza commit/render (riusabile dal wizard con undo).
function seatAutoAssignRun(){
  const e=ev(), tables=e.tables||[]; if(!tables.length) return null;
  const guests=seatableGuests(); if(!guests.length) return {empty:true};
  const idx=seatRulesIdx();
  const plan=seatPlanAssignment(tables, guests, idx.together, idx.separate, seatSimilarityFn());
  tables.forEach(t=>{ const gs=(plan.assign[t.id]||[]).slice(0,t.seats); const arr=new Array(t.seats).fill(null); gs.forEach((g,i)=>arr[i]=g); t.seatIds=arr; });
  tables.forEach(t=>{ if(seatHeadAt(t)>=2){ const r=seatOptimizeTable(t); t.seatIds=r.order.map(x=>x===undefined?null:x); } });
  return {assigned:guests.length-plan.unseated.length, total:guests.length, unseated:plan.unseated.length};
}
function seatAutoAssign(){
  const r=seatAutoAssignRun();
  if(r===null){ toast("Crea prima i tavoli"); return; }
  if(r.empty){ toast("Nessun ospite da sedere"); return; }
  let msg="Assegnati "+r.assigned+"/"+r.total+" ospiti";
  if(r.unseated) msg+=" · "+r.unseated+" senza posto (capienza insufficiente)";
  commit(msg);
}
/* ---- Categorizzazione: vicinanze insieme/lontano (alimentano l'ottimizzatore) ---- */
function seatGuestName(gid){ const g=seatGuestById(gid); return g?g.name:"(ospite rimosso)"; }
function seatRuleEditor(){
  const e=ev(), gs=seatableGuests();
  if(gs.length<2){ toast("Servono almeno 2 ospiti sedibili"); return; }
  const opts=gs.map(g=>`<option value="${g.id}">${esc(g.name)} (${g.side})</option>`).join("");
  modal("Nuova vicinanza",
    `<div class="field"><label>Ospite</label><select class="inp" id="ru_a">${opts}</select></div>
     <div class="field"><label>Relazione</label><select class="inp" id="ru_k"><option value="together">Insieme (vicini di posto)</option><option value="separate">Lontani</option></select></div>
     <div class="field"><label>Con</label><select class="inp" id="ru_b">${opts}</select></div>
     <p class="muted" style="font-size:12px">La regola conta quando i due ospiti sono allo stesso tavolo: l'ottimizzatore li avvicina o li allontana di posto.</p>`,
    [{label:"Annulla"},{label:"Aggiungi",cls:"",fn:()=>{
       const a=$("#ru_a").value, b=$("#ru_b").value, kind=$("#ru_k").value;
       if(!a||!b||a===b){ toast("Scegli due ospiti diversi"); return; }
       e.seating=e.seating||{rules:[]}; e.seating.rules=e.seating.rules||[];
       const key=(a<b?a+"|"+b:b+"|"+a);
       e.seating.rules=e.seating.rules.filter(r=>((r.a<r.b?r.a+"|"+r.b:r.b+"|"+r.a)!==key)); // una sola regola per coppia
       e.seating.rules.push({id:"sr"+seatNextSeq(),a:a,b:b,kind:kind});
       commit("Vicinanza aggiunta");
     }}]);
}
function delSeatRule(id){ const e=ev(); e.seating=e.seating||{rules:[]}; e.seating.rules=(e.seating.rules||[]).filter(r=>r.id!==id); commit("Vicinanza rimossa"); }
function renderSeatRules(){
  const rules=((ev().seating&&ev().seating.rules)||[]);
  if(!rules.length) return `<p class="muted" style="font-size:13px">Nessuna vicinanza definita. Aggiungi chi deve stare insieme o lontano: "Ottimizza" ne terrà conto. Anche stesso nucleo familiare e bambini creano affinità automatica.</p>`;
  return rules.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)"><span style="font-size:13px">${esc(seatGuestName(r.a))} <span class="pill ${r.kind==="together"?"ok":"no"}">${r.kind==="together"?"insieme":"lontani"}</span> ${esc(seatGuestName(r.b))}</span><button class="btn sm danger" data-act="delRule" data-id="${r.id}">&times;</button></div>`).join("");
}
// Core riusabile da modale (click) e drag-drop (B4): assegna/libera un posto con dedup.
function seatAssignCore(tableId, idx, gid){
  const e=ev(), t=(e.tables||[]).find(x=>x.id===tableId); if(!t) return;
  idx=+idx; t.seatIds=t.seatIds||new Array(t.seats).fill(null);
  if(gid){ (e.tables||[]).forEach(tt=>{ (tt.seatIds||[]).forEach((g,i)=>{ if(g===gid) tt.seatIds[i]=null; }); }); }
  t.seatIds[idx]=gid||null;
  commit(gid?"Posto assegnato":"Posto liberato");
}
function seatUnseat(gid){
  if(!gid) return; const e=ev(); let changed=false;
  (e.tables||[]).forEach(tt=>{ (tt.seatIds||[]).forEach((g,i)=>{ if(g===gid){ tt.seatIds[i]=null; changed=true; } }); });
  if(changed) commit("Ospite rimosso dal tavolo");
}
function assignSeat(tableId, idx){
  const e=ev(), t=(e.tables||[]).find(x=>x.id===tableId); if(!t) return;
  idx=+idx; const occupied=(t.seatIds||[])[idx]||"";
  const seated=new Set(); (e.tables||[]).forEach(tt=>(tt.seatIds||[]).forEach(g=>{ if(g) seated.add(g); }));
  const cand=seatableGuests().filter(g=>!seated.has(g.id)||g.id===occupied);
  const opts=cand.map(g=>`<option value="${g.id}"${g.id===occupied?" selected":""}>${esc(g.name)} (${g.side})</option>`).join("");
  modal("Posto "+(idx+1)+" — "+esc(t.name),
    `<div class="field"><label>Ospite</label><select class="inp" id="seat_g"><option value="">— vuoto —</option>${opts}</select></div>`,
    [{label:"Annulla"},{label:"Assegna",cls:"",fn:()=>{ seatAssignCore(tableId, idx, $("#seat_g").value||null); }}]);
}
/* ---- drag-drop posti (B4): touch + mouse via Pointer Events ---- */
// Ri-agganciato dopo ogni render() (listener non delegati, pattern wireAperitivo).
function wireSeating(){
  const host=document.getElementById("planiHost"); if(!host) return;
  let st=null;
  const opts={capture:true,passive:false};
  const nameOf=gid=>{ const g=seatGuestById(gid); return g?g.name:"ospite"; };
  function cleanup(){
    document.removeEventListener("pointermove",onMove,opts);
    document.removeEventListener("pointerup",onUp,opts);
    document.removeEventListener("pointercancel",onCancel,opts);
    if(st && st.ghost) st.ghost.remove();
  }
  function onMove(e){
    if(!st || e.pointerId!==st.pointerId) return;
    const dx=e.clientX-st.x0, dy=e.clientY-st.y0;
    if(!st.dragging && Math.hypot(dx,dy)>6){ st.dragging=true; if(st.ghost) st.ghost.style.display=""; }
    if(!st.dragging) return;
    e.preventDefault();
    if(st.mode==="table"){
      // converte lo spostamento schermo in unità SVG (scala uniforme = CTM.a)
      const sc=st.scale||1; st.nx=st.baseX+dx/sc; st.ny=st.baseY+dy/sc;
      if(st.node) st.node.setAttribute("transform","translate("+st.nx.toFixed(2)+","+st.ny.toFixed(2)+")");
      return;
    }
    // NB: niente setPointerCapture — i listener su document in cattura ricevono già
    // tutti i pointer event, e la cattura interferisce con la consegna del pointerup su touch.
    st.ghost.style.left=e.clientX+"px"; st.ghost.style.top=e.clientY+"px";
  }
  function onCancel(e){ if(!st || e.pointerId!==st.pointerId) return; cleanup(); st=null; }
  function onUp(e){
    if(!st || e.pointerId!==st.pointerId) return;
    const s=st, dragging=st.dragging; cleanup(); st=null;
    if(!dragging) return; // nessun movimento: era un tap, lascia partire il click (modale)
    if(s.mode==="table"){
      const t=(ev().tables||[]).find(x=>x.id===s.tid);
      if(t && typeof s.nx==="number"){ t.x=+s.nx.toFixed(2); t.y=+s.ny.toFixed(2); commit("Tavolo spostato"); }
      return;
    }
    // sopprimi il click che segue il pointerup per non aprire la modale dopo un drag
    const sup=ce=>{ ce.stopPropagation(); ce.preventDefault(); document.removeEventListener("click",sup,true); };
    document.addEventListener("click",sup,true);
    // se il click post-drag non arriva mai (capita su touch), il soppressore
    // NON deve restare armato a mangiare il prossimo tocco legittimo
    setTimeout(()=>document.removeEventListener("click",sup,true), 350);
    const el=document.elementFromPoint(e.clientX,e.clientY); if(!el||!el.closest) return;
    const seat=el.closest("[data-seat-target]");
    if(seat){ seatAssignCore(seat.getAttribute("data-table"), seat.getAttribute("data-idx"), s.gid); return; }
    if(el.closest("#seatTray")){ seatUnseat(s.gid); return; }
  }
  host.addEventListener("pointerdown", e=>{
    if(st) return; // trascinamento già in corso: ignora un secondo dito (multi-touch)
    if(typeof Session!=="undefined" && !Session.canEdit()) return; // sola lettura: niente drag
    const src=e.target.closest&&e.target.closest("[data-drag-guest]");
    if(!src){
      // nessun ospite sotto il dito: prova a spostare il tavolo (G6)
      const onSeat=e.target.closest&&e.target.closest("[data-seat-target]");
      const tnode=(!onSeat&&e.target.closest)?e.target.closest("[data-drag-table]"):null;
      if(tnode){
        const tid=tnode.getAttribute("data-drag-table");
        const svg=document.getElementById("planiSvg");
        let scale=1; try{ const ctm=svg&&svg.getScreenCTM(); if(ctm&&ctm.a) scale=ctm.a; }catch(_){}
        const m=/translate\(([-\d.]+),([-\d.]+)\)/.exec(tnode.getAttribute("transform")||"");
        const baseX=m?+m[1]:0, baseY=m?+m[2]:0;
        try{ if(e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId); }catch(_){}
        st={mode:"table",tid,node:tnode,scale,baseX,baseY,pointerId:e.pointerId,x0:e.clientX,y0:e.clientY,dragging:false};
        document.addEventListener("pointermove",onMove,opts);
        document.addEventListener("pointerup",onUp,opts);
        document.addEventListener("pointercancel",onCancel,opts);
      }
      return;
    }
    const gid=src.getAttribute("data-drag-guest"); if(!gid) return;
    // Su touch il browser assegna cattura implicita del pointer all'elemento
    // sorgente (in SVG trattiene pointermove/up): la rilascio così gli eventi
    // arrivano ai listener su document e il drop viene rilevato ovunque.
    try{ if(e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId); }catch(_){}
    const ghost=document.createElement("div");
    ghost.textContent=nameOf(gid);
    ghost.style.cssText="position:fixed;z-index:9999;transform:translate(-50%,-50%);pointer-events:none;background:#23373b;color:#fff;padding:4px 9px;border-radius:9px;font-size:12px;display:none;left:"+e.clientX+"px;top:"+e.clientY+"px";
    document.body.appendChild(ghost);
    st={gid,pointerId:e.pointerId,x0:e.clientX,y0:e.clientY,dragging:false,ghost};
    document.addEventListener("pointermove",onMove,opts);
    document.addEventListener("pointerup",onUp,opts);
    document.addEventListener("pointercancel",onCancel,opts);
  });
}
/* ---- Wizard abbinamenti (G3): Variabili -> Compila -> Regole -> Genera ---- */
const GUEST_GROUP_COLORS={"Famiglia sposo":"#7e8b6f","Famiglia sposa":"#c08a87","Parenti":"#b58a5a","Amici":"#6f86a6","Colleghi":"#8a7ea6","Compagni di scuola":"#5aa0a6","Vicini":"#a68f5a","Altro":"#9aa0a6"};
function seatGroupColor(grp){ return GUEST_GROUP_COLORS[grp]||"#c9cfd2"; }
/* Temi per i nomi dei tavoli (G5): "numeri" = Tavolo 1,2…; gli altri usano la lista. */
const SEAT_THEMES=[
  {id:'numeri', name:'Numeri', list:[]},
  {id:'citta',  name:'Città', list:["Parigi","Londra","New York","Tokyo","Roma","Barcellona","Vienna","Praga","Amsterdam","Lisbona","Berlino","Sydney","Istanbul","Marrakech","Kyoto","Rio"]},
  {id:'fiori',  name:'Fiori', list:["Rosa","Tulipano","Orchidea","Girasole","Peonia","Lavanda","Glicine","Mimosa","Camelia","Magnolia","Iris","Gelsomino","Dalia","Ortensia","Narciso","Calla"]},
  {id:'isole',  name:'Isole', list:["Santorini","Capri","Maldive","Bali","Mykonos","Sardegna","Sicilia","Ibiza","Zanzibar","Bora Bora","Formentera","Creta","Madeira","Pantelleria","Procida","Tahiti"]},
  {id:'vini',   name:'Vini', list:["Barolo","Brunello","Amarone","Chianti","Franciacorta","Prosecco","Lambrusco","Vermentino","Sagrantino","Gavi","Soave","Primitivo","Aglianico","Greco","Fiano","Nero d'Avola"]},
  {id:'pittori',name:'Pittori', list:["Caravaggio","Van Gogh","Monet","Klimt","Picasso","Vermeer","Botticelli","Rembrandt","Matisse","Renoir","Cézanne","Turner","Hopper","Frida","Chagall","Dalí"]},
  {id:'stelle', name:'Stelle', list:["Sirio","Vega","Antares","Rigel","Betelgeuse","Polare","Aldebaran","Altair","Arturo","Spica","Deneb","Capella","Procione","Regolo","Bellatrix","Mizar"]}
];
function seatThemeId(){ const e=ev(); e.seating=e.seating||{rules:[]}; return e.seating.theme||"numeri"; }
function seatThemeName(i){ const th=SEAT_THEMES.find(t=>t.id===seatThemeId()); if(!th||!th.list.length||i>=th.list.length) return "Tavolo "+(i+1); return th.list[i]; }
function seatApplyTheme(id){ const e=ev(); e.seating=e.seating||{rules:[]}; e.seating.theme=id; (e.tables||[]).forEach((t,i)=>{ t.name=seatThemeName(i); }); commit("Nomi tavoli: "+((SEAT_THEMES.find(t=>t.id===id)||{}).name||id)); }
function seatThemePicker(){
  if(!(ev().tables||[]).length){ toast("Crea prima i tavoli"); return; }
  const cur=seatThemeId();
  modal("Nomi dei tavoli (tema)",
    `<div class="field"><label>Tema</label><select class="inp" id="th_sel">${SEAT_THEMES.map(t=>`<option value="${t.id}"${t.id===cur?" selected":""}>${esc(t.name)}</option>`).join("")}</select></div>
     <p class="muted" style="font-size:12px">Rinomina tutti i tavoli secondo il tema scelto. "Numeri" li chiama Tavolo 1, 2, …</p>`,
    [{label:"Annulla"},{label:"Applica",cls:"",fn:()=>seatApplyTheme($("#th_sel").value)}]);
}
let SEATZOOM=1; // zoom planimetria (G6), solo vista
function seatZoom(delta){ SEATZOOM=Math.max(0.5,Math.min(3, +(SEATZOOM+delta).toFixed(2))); render(); }
let SEATWIZ={step:1, sel:{}, fillVar:null, snapshot:null};
function seatWizard(){
  if(!(ev().tables||[]).length){ toast("Crea prima almeno un tavolo"); return; }
  SEATWIZ={step:1, sel:{}, fillVar:null, snapshot:null};
  modal("Genera disposizione tavoli", '<div id="wizBody"></div>', [{label:"Chiudi", fn:()=>render()}]);
  seatWizRender();
}
function seatWizNav(step){
  let h='<div class="wiznav">';
  if(step>1) h+=`<button type="button" class="btn ghost" data-ws="${step-1}">← Indietro</button>`;
  h+='<span style="flex:1"></span>';
  if(step<4) h+=`<button type="button" class="btn primary" data-ws="${step+1}">Avanti →</button>`;
  return h+'</div>';
}
function seatWizRender(){
  const host=document.getElementById("wizBody"); if(!host) return;
  const step=SEATWIZ.step, names=['Variabili','Compila','Regole','Genera'];
  let h='<div class="wizbar">'+names.map((t,i)=>`<button type="button" class="wizstep${i+1===step?' on':''}" data-ws="${i+1}">${i+1}. ${esc(t)}</button>`).join('')+'</div>';
  if(step===1) h+=seatWizVars();
  else if(step===2) h+=seatWizFill();
  else if(step===3) h+=seatWizRules();
  else h+=seatWizGen();
  host.innerHTML=h;
  host.querySelectorAll("[data-ws]").forEach(b=>b.onclick=()=>{ SEATWIZ.step=+b.getAttribute("data-ws"); seatWizRender(); });
  if(step===1) seatWizVarsBind(host);
  else if(step===2) seatWizFillBind(host);
  else if(step===3) seatWizRulesBind(host);
  else seatWizGenBind(host);
}
function seatWizVars(){
  const vars=seatVars();
  let h='<p class="muted" style="font-size:13px">Scegli quali caratteristiche l\'algoritmo usa per abbinare gli ospiti. Il peso dice quanto conta; "unisci" avvicina chi condivide il valore, "separa" li allontana.</p>';
  h+='<div style="text-align:right;margin:2px 0 6px"><button type="button" class="btn sm ghost" id="wz-prefill" title="Deriva nucleo, lato ed età dai dati già inseriti">Precompila dai dati</button></div>';
  vars.forEach((v,i)=>{
    h+=`<div class="varrow"><button type="button" class="switch${v.on?' on':''}" data-vtog="${i}" aria-pressed="${v.on?'true':'false'}" aria-label="Attiva ${esc(v.name)}"></button>`
      +`<div class="vn">${esc(v.name)}<span class="muted" style="font-size:11px;display:block">${v.values.filter(Boolean).length} valori</span></div>`
      +`<label class="muted" style="font-size:11px">peso <input type="number" class="inp" style="width:52px;padding:4px" min="0" max="20" value="${v.weight}" data-vw="${i}"></label>`
      +`<select class="inp" style="width:96px;padding:4px" data-vm="${i}"><option value="cluster"${v.mode!=='separate'?' selected':''}>unisci</option><option value="separate"${v.mode==='separate'?' selected':''}>separa</option></select>`
      +(v.custom?`<button type="button" class="btn sm danger" data-vdel="${i}" aria-label="Elimina">&times;</button>`:'')+`</div>`;
  });
  h+=`<div class="varadd"><input class="inp" id="wz-nvname" placeholder="Nuova variabile (es. Hobby)"><input class="inp" id="wz-nvvals" placeholder="Valori separati da virgola"><button type="button" class="btn sm primary" id="wz-nvadd">Aggiungi</button></div>`;
  return h+seatWizNav(1);
}
function seatWizVarsBind(host){
  const vars=seatVars();
  host.querySelectorAll("[data-vtog]").forEach(b=>b.onclick=()=>{ const v=vars[+b.getAttribute("data-vtog")]; v.on=!v.on; Store.save(STATE); seatWizRender(); });
  host.querySelectorAll("[data-vw]").forEach(inp=>inp.onchange=()=>{ vars[+inp.getAttribute("data-vw")].weight=Math.max(0,Math.min(20,+inp.value||0)); Store.save(STATE); });
  host.querySelectorAll("[data-vm]").forEach(sel=>sel.onchange=()=>{ vars[+sel.getAttribute("data-vm")].mode=sel.value; Store.save(STATE); });
  host.querySelectorAll("[data-vdel]").forEach(b=>b.onclick=()=>{ vars.splice(+b.getAttribute("data-vdel"),1); Store.save(STATE); seatWizRender(); });
  const add=host.querySelector("#wz-nvadd"); if(add) add.onclick=()=>{
    const n=(host.querySelector("#wz-nvname").value||"").trim();
    const vals=(host.querySelector("#wz-nvvals").value||"").split(",").map(s=>s.trim()).filter(Boolean);
    if(!n){ toast("Dai un nome alla variabile"); return; }
    vars.push({id:"cv"+Date.now(),name:n,on:true,weight:5,mode:"cluster",values:[""].concat(vals),custom:true});
    Store.save(STATE); seatWizRender(); toast("Variabile aggiunta");
  };
  const pf=host.querySelector("#wz-prefill"); if(pf) pf.onclick=()=>{ seatPrefillAttrs(); seatWizRender(); };
}
function seatAttrFillPct(){ const vars=seatActiveVars(), people=seatableGuests(); const cells=vars.length*people.length; if(!cells) return 0; let f=0; people.forEach(g=>vars.forEach(v=>{ if(g.attr&&g.attr[v.id]) f++; })); return Math.round(f*100/cells); }
function seatPrefillAttrs(){
  const e=ev(); let n=0;
  (e.guests||[]).forEach(g=>{ g.attr=g.attr||{};
    if(g.household&&g.household!=="Senza nucleo"&&!g.attr.nucleo){ g.attr.nucleo=g.household; n++; }
    if(!g.attr.eta){ g.attr.eta=(g.ptype==="bambino"?"Bambino":"Adulto"); n++; }
    if(!g.attr.lato){ g.attr.lato=(g.side==="A"?"Sposa":"Sposo"); n++; }
    const map={"Amici":"Amici","Colleghi":"Colleghi","Parenti":"Parenti","Vicini":"Vicini","Compagni di scuola":"Scuola"};
    if(g.group&&map[g.group]&&!g.attr.ambiente){ g.attr.ambiente=map[g.group]; n++; }
  });
  // Stato (single/coppia/famiglia) dedotto dal nucleo: con bambini o 3+ = Famiglia,
  // 2 = In coppia; senza nucleo: +1 = In coppia, da solo = Single. Correggibile.
  (function(){
    const hhs={}; (e.guests||[]).forEach(g=>{ const h=g.household; if(h&&h!=="Senza nucleo"){ (hhs[h]=hhs[h]||[]).push(g); } });
    (e.guests||[]).forEach(g=>{
      g.attr=g.attr||{}; if(g.attr.stato) return;
      const fam=hhs[g.household];
      if(fam){ const kids=fam.some(x=>x.ptype==="bambino"); g.attr.stato=(kids||fam.length>=3)?"Famiglia":(fam.length===2?"In coppia":"Single"); n++; }
      else { g.attr.stato=(+g.plusOne>0)?"In coppia":"Single"; n++; }
    });
  })();
  const nv=seatVarById("nucleo"); if(nv){ (e.guests||[]).forEach(g=>{ if(g.attr&&g.attr.nucleo&&nv.values.indexOf(g.attr.nucleo)<0) nv.values.push(g.attr.nucleo); }); }
  Store.save(STATE); toast("Precompilate "+n+" caratteristiche");
}
function seatWizFill(){
  const vars=seatActiveVars();
  if(!vars.length) return '<div class="muted" style="font-size:13px">Nessuna variabile attiva. Torna al passo 1 e attivane almeno una.</div>'+seatWizNav(2);
  if(!SEATWIZ.fillVar || !vars.some(v=>v.id===SEATWIZ.fillVar)) SEATWIZ.fillVar=vars[0].id;
  const v=seatVarById(SEATWIZ.fillVar), people=seatableGuests(), pct=seatAttrFillPct();
  const selCount=people.filter(g=>SEATWIZ.sel[g.id]).length;
  let h=`<div style="font-size:13px;margin-bottom:4px">Compilazione: <b>${pct}%</b></div>`;
  h+='<p class="muted" style="font-size:12px">1) scegli una caratteristica · 2) spunta gli invitati (o tutti / per gruppo) · 3) scegli il valore e premi Assegna. Puoi anche usare il menù su ogni riga.</p>';
  h+=`<div class="varadd"><select class="inp" id="wz-fv" style="flex:1">${vars.map(x=>`<option value="${x.id}"${x.id===SEATWIZ.fillVar?' selected':''}>${esc(x.name)}</option>`).join("")}</select></div>`;
  h+=`<div class="varadd" style="margin-top:6px"><button type="button" class="btn sm ghost" id="wz-selall">Tutti</button><button type="button" class="btn sm ghost" id="wz-selnone">Nessuno</button><select class="inp" id="wz-selgrp" style="flex:1"><option value="">…o per gruppo</option>${guestGroups().map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join("")}</select></div>`;
  h+=`<div class="varadd" style="margin-top:6px"><select class="inp" id="wz-bval" style="flex:1">${v.values.map(val=>`<option value="${esc(val)}">${val===''?'(svuota)':esc(val)}</option>`).join("")}</select><button type="button" class="btn sm primary" id="wz-bapply">Assegna${selCount?` (${selCount})`:''}</button></div>`;
  h+='<div style="max-height:36vh;overflow:auto;margin-top:8px">';
  people.forEach(g=>{ const cur=(g.attr&&g.attr[SEATWIZ.fillVar])||'';
    h+=`<div class="fillrow"><span class="fchk${SEATWIZ.sel[g.id]?' on':''}" data-selg="${g.id}"></span><span class="gdot" style="background:${seatGroupColor(g.group)}"></span><span style="flex:1">${esc(g.name)}</span><select class="inp" style="width:120px;padding:4px" data-frow="${g.id}">${v.values.map(val=>`<option value="${esc(val)}"${val===cur?' selected':''}>${val===''?'—':esc(val)}</option>`).join("")}</select></div>`;
  });
  h+='</div>';
  return h+seatWizNav(2);
}
function seatWizFillBind(host){
  const people=seatableGuests();
  const fv=host.querySelector("#wz-fv"); if(fv) fv.onchange=()=>{ SEATWIZ.fillVar=fv.value; seatWizRender(); };
  host.querySelectorAll("[data-selg]").forEach(c=>c.onclick=()=>{ const id=c.getAttribute("data-selg"); SEATWIZ.sel[id]=!SEATWIZ.sel[id]; c.classList.toggle("on"); });
  host.querySelectorAll("[data-frow]").forEach(sel=>sel.onchange=()=>{ const g=seatGuestById(sel.getAttribute("data-frow")); if(!g) return; g.attr=g.attr||{}; if(sel.value) g.attr[SEATWIZ.fillVar]=sel.value; else delete g.attr[SEATWIZ.fillVar]; Store.save(STATE); });
  const sa=host.querySelector("#wz-selall"); if(sa) sa.onclick=()=>{ people.forEach(g=>SEATWIZ.sel[g.id]=true); seatWizRender(); };
  const sn=host.querySelector("#wz-selnone"); if(sn) sn.onclick=()=>{ SEATWIZ.sel={}; seatWizRender(); };
  const sg=host.querySelector("#wz-selgrp"); if(sg) sg.onchange=()=>{ const grp=sg.value; if(grp){ people.forEach(g=>{ if(g.group===grp) SEATWIZ.sel[g.id]=true; }); seatWizRender(); } };
  const ap=host.querySelector("#wz-bapply"); if(ap) ap.onclick=()=>{ const val=host.querySelector("#wz-bval").value; let n=0; people.forEach(g=>{ if(SEATWIZ.sel[g.id]){ g.attr=g.attr||{}; if(val) g.attr[SEATWIZ.fillVar]=val; else delete g.attr[SEATWIZ.fillVar]; n++; } }); SEATWIZ.sel={}; Store.save(STATE); seatWizRender(); toast(n+" invitati aggiornati"); };
}
function seatWizRulesList(){
  const rules=((ev().seating&&ev().seating.rules)||[]);
  if(!rules.length) return '<p class="muted" style="font-size:13px">Nessuna vicinanza definita.</p>';
  return rules.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)"><span style="font-size:13px">${esc(seatGuestName(r.a))} <span class="pill ${r.kind==="together"?"ok":"no"}">${r.kind==="together"?"insieme":"lontani"}</span> ${esc(seatGuestName(r.b))}</span><button type="button" class="btn sm danger" data-wzdel="${r.id}" aria-label="Rimuovi">&times;</button></div>`).join("");
}
function seatWizRules(){
  const gs=seatableGuests();
  let h='<p class="muted" style="font-size:13px">Vincoli espliciti tra due ospiti: "insieme" li mette vicini, "lontani" li separa. Sono opzionali.</p>';
  if(gs.length>=2){
    const opts=gs.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join("");
    h+=`<div class="varadd"><select class="inp" id="wz-ra" style="flex:1">${opts}</select><select class="inp" id="wz-rk" style="flex:0 0 auto;width:96px"><option value="together">insieme</option><option value="separate">lontani</option></select><select class="inp" id="wz-rb" style="flex:1">${opts}</select><button type="button" class="btn sm primary" id="wz-radd">Aggiungi</button></div>`;
  }
  h+=`<div style="margin-top:10px">${seatWizRulesList()}</div>`;
  return h+seatWizNav(3);
}
function seatWizRulesBind(host){
  const add=host.querySelector("#wz-radd"); if(add) add.onclick=()=>{
    const a=host.querySelector("#wz-ra").value, b=host.querySelector("#wz-rb").value, kind=host.querySelector("#wz-rk").value;
    if(!a||!b||a===b){ toast("Scegli due ospiti diversi"); return; }
    const e=ev(); e.seating=e.seating||{rules:[]}; e.seating.rules=e.seating.rules||[];
    const key=(a<b?a+"|"+b:b+"|"+a);
    e.seating.rules=e.seating.rules.filter(r=>((r.a<r.b?r.a+"|"+r.b:r.b+"|"+r.a)!==key));
    e.seating.rules.push({id:"sr"+seatNextSeq(),a:a,b:b,kind:kind});
    Store.save(STATE); seatWizRender(); toast("Vicinanza aggiunta");
  };
  host.querySelectorAll("[data-wzdel]").forEach(b=>b.onclick=()=>{ const id=b.getAttribute("data-wzdel"); const e=ev(); e.seating=e.seating||{rules:[]}; e.seating.rules=(e.seating.rules||[]).filter(r=>r.id!==id); Store.save(STATE); seatWizRender(); });
}
function seatRulesOutcome(){
  const rules=((ev().seating&&ev().seating.rules)||[]); if(!rules.length) return '';
  const tof={}; (ev().tables||[]).forEach(t=>(t.seatIds||[]).forEach(id=>{ if(id) tof[id]=t.id; }));
  let ok=0,ko=0;
  rules.forEach(r=>{ const same=tof[r.a]&&tof[r.a]===tof[r.b]; const good=r.kind==='together'?same:!same; if(good)ok++; else ko++; });
  return `<div style="font-size:13px;margin-top:4px">Regole rispettate: ${ok}/${rules.length}${ko?` · <span style="color:var(--no)">${ko} non soddisfatte</span>`:''}</div>`;
}
function seatWizGen(){
  const pct=seatAttrFillPct();
  let h='<p class="muted" style="font-size:13px">Distribuisce gli ospiti sui tavoli per affinità (variabili + regole), poi ottimizza i posti a ogni tavolo. Puoi annullare subito dopo.</p>';
  if(pct<20) h+='<div style="font-size:12px;color:var(--gold);margin-bottom:6px">Suggerimento: compilazione bassa ('+pct+'%). Con più caratteristiche l\'abbinamento migliora, ma puoi generare comunque.</div>';
  h+=`<div class="wiznav" style="margin-top:2px"><button type="button" class="btn primary" id="wz-gen">Genera disposizione</button><span style="flex:1"></span><button type="button" class="btn ghost" id="wz-undo"${SEATWIZ.snapshot?'':' disabled'}>↶ Annulla</button></div>`;
  h+='<div id="wz-report" style="margin-top:10px"></div>';
  return h+seatWizNav(4);
}
function seatWizGenBind(host){
  const gen=host.querySelector("#wz-gen"); if(gen) gen.onclick=()=>{
    SEATWIZ.snapshot=JSON.stringify(ev().tables||[]);
    const r=seatAutoAssignRun(); Store.save(STATE);
    let out;
    if(!r||r.empty){ out='<div class="muted">Niente da assegnare.</div>'; SEATWIZ.snapshot=null; }
    else out=`<div style="font-size:13px">Assegnati <b>${r.assigned}/${r.total}</b> ospiti su ${(ev().tables||[]).length} tavoli.</div>`+(r.unseated?`<div style="font-size:13px;color:var(--no)">${r.unseated} senza posto (capienza insufficiente).</div>`:'')+seatRulesOutcome();
    seatWizRender();
    const rep=document.getElementById("wz-report"); if(rep) rep.innerHTML=out;
    toast("Disposizione generata");
  };
  const undo=host.querySelector("#wz-undo"); if(undo && !undo.disabled) undo.onclick=()=>{
    if(SEATWIZ.snapshot){ ev().tables=JSON.parse(SEATWIZ.snapshot); SEATWIZ.snapshot=null; Store.save(STATE); seatWizRender(); const rep=document.getElementById("wz-report"); if(rep) rep.innerHTML='<div style="font-size:13px">Ripristinata la disposizione precedente.</div>'; toast("Annullato"); }
  };
}
function viewSeating(){
  const tables=ev().tables||[];
  const totSeats=tables.reduce((s,t)=>s+(t.seats||0),0);
  const seated=tables.reduce((s,t)=>s+seatHeadAt(t),0);
  const seatedSet=new Set(); tables.forEach(t=>(t.seatIds||[]).forEach(g=>{ if(g) seatedSet.add(g); }));
  const unseated=seatableGuests().filter(g=>!seatedSet.has(g.id));
  const tray=`<div id="seatTray" data-tray="1" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;padding:8px;border:1px dashed var(--line);border-radius:10px;min-height:38px">`
    +(unseated.length?unseated.map(g=>`<span class="tag" data-drag-guest="${g.id}" style="cursor:grab;touch-action:none">${esc(g.name)} (${g.side})</span>`).join("")
      :`<span class="muted" style="font-size:13px">Tutti gli ospiti sedibili sono assegnati.</span>`)+`</div>`;
  return `
  <div class="card"><span class="pill todo">come funziona</span> Crea i tavoli con + Tavolo, poi premi <b>Genera (guidato)</b>: in 4 passi scegli le caratteristiche che contano (nucleo, età, gruppo…), le compili in blocco, aggiungi i vincoli insieme/lontani e generi la disposizione — con Annulla se non convince. Ritocchi a mano: tocca un posto o trascina un nome dalla riserva; trascina un tavolo per spostarlo sulla planimetria.</div>
  <div class="grid cards">
    <div class="card kpi"><div class="v">${tables.length}</div><div class="l">Tavoli</div></div>
    <div class="card kpi"><div class="v">${seated}/${totSeats}</div><div class="l">Posti occupati</div></div>
    <div class="card kpi"><div class="v">${unseated.length}</div><div class="l">Ospiti da sedere</div></div>
  </div>
  <div class="sec-title"><h2>Planimetria</h2><span><button class="btn sm" data-act="addTable">+ Tavolo</button></span></div>
  ${tables.length?`<div class="tbar">
    <button class="btn sm primary" data-act="seatWizard">Genera (guidato)</button>
    <button class="btn sm ghost" data-act="autoAssign">Assegna auto</button>
    <button class="btn sm ghost" data-act="optimizeAll">Ottimizza</button>
    <button class="btn sm ghost" data-act="themeTables">Nomi tema</button>
    <button class="btn sm ghost" data-act="printTables">Stampa</button>
  </div>`:''}
  <div id="planiHost">
    <div class="card" style="padding:8px">${renderPlanimetria()}</div>
    <div class="sec-title" style="margin-top:6px"><h2 style="font-size:15px">Riserva ospiti</h2></div>
    ${tray}
  </div>
  ${tables.length?`<div class="scroll-x"><table class="tbl"><thead><tr><th>Tavolo</th><th>Forma</th><th class="num">Occupati</th><th></th></tr></thead><tbody>${tables.map(t=>`<tr><td>${esc(t.name)}</td><td>${SEAT_SHAPES[t.shape]||esc(t.shape)}</td><td class="num">${seatHeadAt(t)}/${t.seats}</td><td class="num"><button class="btn sm ghost" data-act="optimizeTable" data-id="${t.id}">Ottimizza</button> <button class="btn sm ghost" data-act="editTable" data-id="${t.id}">Modifica</button> <button class="btn sm danger" data-act="delTable" data-id="${t.id}">&times;</button></td></tr>`).join("")}</tbody></table></div>`:""}
  <div class="sec-title" style="margin-top:14px"><h2>Vicinanze</h2><span><button class="btn sm" data-act="addRule">+ Regola</button></span></div>
  <div class="card">${renderSeatRules()}</div>
  `;
}

/* ============ FORNITORI (CRM + aggiornamento web con degradazione) ============ */
const VCATS=["Location","Catering","Fiori","Foto/Video","Musica/DJ","Intrattenimento","Torta","Trasporti/Navetta","Beauty","Allestimenti","Officiante/Pratiche","Altro"];
const VSTATUS={valutazione:["todo","In valutazione"],contattato:["todo","Contattato"],preventivo:["warn","Preventivo"],opzione:["warn","Opzione"],confermato:["ok","Confermato"],scartato:["no","Scartato"]};
function vendorCard(v){
  const st=VSTATUS[v.status]||["todo","?"];
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h3>${esc(v.name)}</h3><span class="pill ${st[0]}">${st[1]}</span></div>
    <div class="muted" style="font-size:13px;margin:4px 0">${esc(v.category)}${v.contact?" · "+esc(v.contact):""}</div>
    <div style="font-size:14px;margin:6px 0">
      ${v.phone?`<div>Tel: ${esc(v.phone)}</div>`:""}
      ${v.email?`<div>Email: ${esc(v.email)}</div>`:""}
      ${v.website?`<div>Sito: ${esc(v.website)}</div>`:""}
      ${v.quote?`<div>Preventivo: ${money(v.quote)}${v.budgetLineId?' · collegato al budget':''}</div>`:""}
      ${v.rating?`<div>Rating: ${esc(v.rating)}</div>`:""}
      ${v.reviews?`<div class="muted">Recensioni: ${esc(v.reviews)}</div>`:""}
      ${v.pastEvents?`<div class="muted">Eventi passati (non verificati): ${esc(v.pastEvents)}</div>`:""}
      ${v.notes?`<div class="muted">Note: ${esc(v.notes)}</div>`:""}
      ${v.updated?`<div class="muted" style="font-size:12px">Aggiornato ${esc(v.updated)} · fonte: ${esc(v.source||"—")}</div>`:""}
    </div>
    <div class="btnbar">
      <button class="btn sm" data-act="editVendor" data-id="${v.id}">Modifica</button>
      <button class="btn sm ghost" data-act="webVendor" data-id="${v.id}">Aggiorna dal web</button>
      <button class="btn sm danger" data-act="delVendor" data-id="${v.id}">Elimina</button>
    </div>
  </div>`;
}
function viewVendors(){
  const e=ev();
  const byCat={}; e.vendors.forEach(v=>{ (byCat[v.category]=byCat[v.category]||[]).push(v); });
  let html="";
  VCATS.forEach(cat=>{
    const list=byCat[cat]; if(!list||!list.length) return;
    const multi=list.length>1;
    html+=`<div class="sec-title"><h2>${esc(cat)}</h2>${multi?'<span class="pill">confronto '+list.length+' preventivi</span>':''}</div>`;
    if(multi){
      html+=`<div class="scroll-x"><table class="tbl"><thead><tr><th>Fornitore</th><th>Stato</th><th class="num">Preventivo</th><th>Rating</th><th></th></tr></thead><tbody>`+
        list.map(v=>`<tr><td>${esc(v.name)}</td><td><span class="pill ${(VSTATUS[v.status]||["todo",""])[0]}">${(VSTATUS[v.status]||["",""])[1]}</span></td><td class="num">${v.quote?money(v.quote):"—"}</td><td>${v.rating?esc(v.rating):"—"}</td><td class="num"><button class="btn sm ghost" data-act="editVendor" data-id="${v.id}">Apri</button></td></tr>`).join("")+
        `</tbody></table></div>`;
    } else { html+=vendorCard(list[0]); }
  });
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${e.vendors.filter(v=>v.status==="confermato").length}</div><div class="l">Confermati</div></div>
    <div class="card kpi"><div class="v">${e.vendors.length}</div><div class="l">Fornitori</div></div>
    <div class="card kpi"><div class="v">${new Set(e.vendors.map(v=>v.category)).size}</div><div class="l">Categorie coperte</div></div>
    <div class="card kpi"><div class="v">${VCATS.length}</div><div class="l">Categorie totali</div></div>
  </div>
  <p class="muted" style="margin-top:12px;font-size:12px">I dati dei fornitori si inseriscono con Modifica. "Aggiorna dal web" è attivo solo nella versione integrata in Claude.ai; su questo sito mostra un avviso e non modifica nulla.</p>
  <div class="btnbar" style="margin-top:12px"><button class="btn" data-act="addVendor">+ Fornitore</button></div>
  ${html||'<div class="placeholder"><div class="ic">&#9742;</div><p>Nessun fornitore.</p></div>'}
  `;
}
function editVendor(id){
  const e=ev(), v=e.vendors.find(x=>x.id===id), isNew=!v;
  const x=v||{name:"",category:"Catering",contact:"",phone:"",email:"",website:"",status:"valutazione",quote:0,rating:"",reviews:"",pastEvents:"",notes:"",budgetLineId:""};
  const blOpts=`<option value="">— nessuna —</option>`+e.budget.map(b=>`<option value="${b.id}"${x.budgetLineId===b.id?" selected":""}>${esc(b.item)}</option>`).join("");
  modal(isNew?"Nuovo fornitore":"Modifica fornitore",
    `<div class="field"><label>Nome</label><input class="inp" id="v_name" value="${esc(x.name)}"></div>
     <div class="two">
       <div class="field"><label>Categoria</label><select class="inp" id="v_cat">${VCATS.map(c=>`<option${x.category===c?" selected":""}>${c}</option>`).join("")}</select></div>
       <div class="field"><label>Stato</label><select class="inp" id="v_st">${Object.keys(VSTATUS).map(k=>`<option value="${k}"${x.status===k?" selected":""}>${VSTATUS[k][1]}</option>`).join("")}</select></div>
     </div>
     <div class="field"><label>Referente</label><input class="inp" id="v_ref" value="${esc(x.contact)}"></div>
     <div class="two">
       <div class="field"><label>Telefono</label><input class="inp" id="v_ph" value="${esc(x.phone)}"></div>
       <div class="field"><label>Email</label><input class="inp" id="v_em" value="${esc(x.email)}"></div>
     </div>
     <div class="two">
       <div class="field"><label>Sito</label><input class="inp" id="v_web" value="${esc(x.website)}"></div>
       <div class="field"><label>Preventivo (€)</label><input class="inp" type="number" id="v_q" value="${x.quote||0}"></div>
     </div>
     <div class="two">
       <div class="field"><label>Rating</label><input class="inp" id="v_rt" value="${esc(x.rating)}"></div>
       <div class="field"><label>Voce di budget collegata</label><select class="inp" id="v_bl">${blOpts}</select></div>
     </div>
     <div class="field"><label>Opzione valida fino al <span class="muted" style="font-size:11px">(se hai bloccato una data)</span></label><input class="inp" type="date" id="v_opt" value="${esc(x.optionUntil||"")}"></div>
     <div class="field"><label>Recensioni (sintesi)</label><input class="inp" id="v_rev" value="${esc(x.reviews)}"></div>
     <div class="field"><label>Eventi passati</label><input class="inp" id="v_pe" value="${esc(x.pastEvents)}"></div>
     <div class="field"><label>Note / log</label><input class="inp" id="v_nt" value="${esc(x.notes)}"></div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const name=$("#v_name").value.trim(); if(!name) return;
      const data={name,category:$("#v_cat").value,status:$("#v_st").value,contact:$("#v_ref").value.trim(),phone:$("#v_ph").value.trim(),email:$("#v_em").value.trim(),website:$("#v_web").value.trim(),quote:+$("#v_q").value||0,rating:$("#v_rt").value.trim(),budgetLineId:$("#v_bl").value,optionUntil:$("#v_opt").value||"",reviews:$("#v_rev").value.trim(),pastEvents:$("#v_pe").value.trim(),notes:$("#v_nt").value.trim()};
      let vv;
      const E=ev();
      if(isNew){ vv=Object.assign({id:"v"+Date.now(),source:"",updated:""},data); E.vendors.push(vv); }
      else { vv=E.vendors.find(x=>x.id===id); if(!vv){ toast("Fornitore non più presente (aggiornato da un altro dispositivo)"); return; } Object.assign(vv,data); }
      if(vv.status==="confermato"&&vv.budgetLineId&&vv.quote){ const bl=e.budget.find(b=>b.id===vv.budgetLineId); if(bl) bl.quote=vv.quote; }
      commit(isNew?"Fornitore aggiunto":"Fornitore aggiornato");
    }}]);
}
function delVendor(id){ const v=ev().vendors.find(x=>x.id===id); if(!v) return; modal("Eliminare il fornitore?",`<p>Rimuovo <b>${esc(v.name)}</b>.</p>`,[{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{ ev().vendors=ev().vendors.filter(x=>x.id!==id); commit("Fornitore eliminato"); }}]); }
async function webVendor(id){
  const v=ev().vendors.find(x=>x.id===id); if(!v) return;
  const loading=modal("Aggiornamento dal web",`<p>Ricerca in corso per <b>${esc(v.name)}</b>…</p><p class="muted">Disponibile solo nella versione integrata in Claude.ai.</p>`,[{label:"Annulla"}]);
  const q=`Cerca sul web informazioni pubbliche aggiornate sul fornitore per matrimoni "${v.name}"${v.category?(" ("+v.category+")"):""} in Italia, zona Emilia-Romagna/Rimini se pertinente. Rispondi SOLO con un oggetto JSON valido, senza testo né markdown, con chiavi: phone, email, website, rating, reviews_summary, past_events, source. Stringhe vuote se non trovi. Indica reviews_summary e past_events come non verificati se incerti.`;
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,messages:[{role:"user",content:q}],tools:[{type:"web_search_20250305",name:"web_search"}]})});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data=await r.json();
    const txt=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
    const clean=txt.replace(/```json|```/g,"").trim();
    let obj; try{ obj=JSON.parse(clean); }catch(_){ const mm=clean.match(/\{[\s\S]*\}/); obj=mm?JSON.parse(mm[0]):null; }
    if(!obj) throw new Error("risposta non interpretabile");
    if(obj.phone) v.phone=obj.phone; if(obj.email) v.email=obj.email; if(obj.website) v.website=obj.website;
    if(obj.rating) v.rating=String(obj.rating); if(obj.reviews_summary) v.reviews=obj.reviews_summary; if(obj.past_events) v.pastEvents=obj.past_events;
    v.source=obj.source||"web (Claude)"; v.updated=new Date().toLocaleDateString("it-IT");
    loading.close(); commit("Scheda aggiornata dal web");
  }catch(err){
    loading.close();
    modal("Aggiornamento non disponibile",`<p>La ricerca automatica dal web funziona solo dentro Claude.ai, dove l'app può usare l'API con ricerca web. Qui non è partita (${esc(err.message)}).</p><p class="muted">Inserisci i dati a mano con Modifica.</p>`,[{label:"Ho capito"}]);
  }
}

/* ============ MOTORE SIMULATORE APERITIVO (nativo, port completo) ============ */
function simRandn(){ let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function simLognormal(mean,cv){ const s=Math.sqrt(Math.log(1+cv*cv)); const m=Math.log(mean)-s*s/2; return Math.exp(m+s*simRandn()); }
function simPoisson(l){ if(l<=0)return 0; const L=Math.exp(-l); let k=0,p=1; do{ k++; p*=Math.random(); }while(p>L); return k-1; }
const SIM_REPS=40;
const SIM_PALETTE=['#2563eb','#1a8a4a','#d97706','#9333ea','#0891b2','#db2777','#65a30d','#e11d48','#0d9488','#7c3aed'];
const SIM_TYPES={
 'Bar / Bere':{service:25,pop:1.5,welcome:true},
 'Finger food':{service:18,pop:2,welcome:false},
 'Fritti':{service:18,pop:1.5,welcome:false},
 'Norcineria (salumi)':{service:40,pop:1,welcome:false},
 'Casaro (formaggi)':{service:45,pop:1,welcome:false},
 'Pescheria':{service:35,pop:1,welcome:false},
 'Tartare':{service:30,pop:0.8,welcome:false},
 'Cocktail bar':{service:45,pop:1,welcome:true},
 'Carretto gelato':{service:30,pop:0.8,welcome:false},
 'Galleria dolci':{service:20,pop:1,welcome:false},
 'Personalizzata':{service:30,pop:1,welcome:false}
};
function simErlangC(a,c){ if(c<=a)return 1; let B=1; for(let n=1;n<=c;n++)B=a*B/(n+a*B); return c*B/(c-a+a*B); }
function simP95an(a,c,ES){ if(c<=a)return Infinity; const C=simErlangC(a,c); if(C<=0.05)return 0; const rate=(1/ES)*(c-a); return Math.log(C/0.05)/rate; }
function simLoadOf(s,N,G){ const tray=G.welcomeTray; const extra=(s.welcome&&!tray)?1:0; const L=Math.max(1,s.lines||1); return (N*(s.pop+extra)/G.apDur/60/L)*s.service; }
function simRecServers(s,target,N,G){ const a=simLoadOf(s,N,G); for(let c=1;c<=14;c++){ if(c<=a)continue; if(simP95an(a,c,s.service)<=target)return c; } return 14; }
function simulateAperitivo(N,stations,G,opts){
  opts=opts||{}; const reps=opts.reps||SIM_REPS; const tray=(opts.tray===undefined)?G.welcomeTray:opts.tray;
  const nNav=Math.round(N*G.pNav), nSelf=N-nNav;
  const tShuttle=G.travelMean+G.shuttleOffset;
  const GRID=Math.max(70,Math.ceil(G.travelMean+G.apDur+3*G.sigma));
  const apDur=G.apDur;
  const covDiff=stations.map(()=>new Float64Array(GRID+1));
  const arrBins=new Float64Array(GRID), navBins=new Float64Array(GRID);
  const acc=stations.map(()=>({waits:[],sumMaxQ:0}));
  let firstArr=1e9,lastArr=-1e9;
  for(let r=0;r<reps;r++){
    const guests=[];
    for(let i=0;i<nSelf;i++){ let t=G.travelMean+Math.abs(simRandn())*G.sigma; guests.push(t); arrBins[Math.min(GRID-1,Math.max(0,Math.floor(t)))]++; if(t<firstArr)firstArr=t; if(t>lastArr)lastArr=t; }
    for(let i=0;i<nNav;i++){ const t=tShuttle+Math.random()*G.unloadMin; guests.push(t); const b=Math.min(GRID-1,Math.max(0,Math.floor(t))); arrBins[b]++; navBins[b]++; if(t<firstArr)firstArr=t; if(t>lastArr)lastArr=t; }
    const evs=stations.map(()=>[]);
    for(const t of guests){
      stations.forEach((s,si)=>{
        const L=Math.max(1,s.lines||1);
        if(s.welcome && !tray && (L===1||Math.random()<1/L)) evs[si].push(t+0.15);
        const k=simPoisson(s.pop/L);
        for(let j=0;j<k;j++) evs[si].push(t+0.5+Math.random()*apDur);
      });
    }
    stations.forEach((s,si)=>{
      const arr=evs[si].sort((a,b)=>a-b);
      const free=new Array(Math.max(1,s.servers)).fill(-1e9);
      const pts=[];
      for(const a of arr){
        let j=0; for(let q=1;q<free.length;q++) if(free[q]<free[j])j=q;
        const start=Math.max(a,free[j]);
        acc[si].waits.push((start-a)*60);
        free[j]=start+simLognormal(s.service,0.5)/60;
        pts.push([a,1]); pts.push([start,-1]);
        const b0=Math.max(0,Math.floor(a)),b1=Math.min(GRID-1,Math.floor(start)); covDiff[si][b0]++; covDiff[si][b1+1]--;
      }
      pts.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
      let cur=0,mx=0; for(const pd of pts){ cur+=pd[1]; if(cur>mx)mx=cur; }
      acc[si].sumMaxQ+=mx;
    });
  }
  let pk=0; for(let b=0;b<GRID;b++) if(arrBins[b]>arrBins[pk])pk=b;
  const out=stations.map((s,si)=>{
    acc[si].waits.sort((a,b)=>a-b);
    const w=acc[si].waits;
    const mean=w.length?w.reduce((a,b)=>a+b,0)/w.length:0;
    const p95=w.length?(w[Math.floor(w.length*0.95)]||0):0;
    const L=Math.max(1,s.lines||1);
    const extra=(s.welcome&&!tray)?1:0;
    const lam=N*(s.pop+extra)/apDur/L;
    const load=lam*s.service/60;
    let run=0; const q=new Array(GRID); for(let b=0;b<GRID;b++){ run+=covDiff[si][b]; q[b]=(run/reps)*L; }
    return Object.assign({},s,{mean:mean,p95:p95,maxQ:(acc[si].sumMaxQ/reps)*L,load:load,queue:q,active:(s.pop>0)||(s.welcome&&!tray)});
  });
  return {nNav:nNav,nSelf:nSelf,GRID:GRID,peakRate:arrBins[pk]/reps,peakMin:pk,gap:(lastArr>=firstArr)?lastArr-firstArr:0,arr:Array.from(arrBins).map(v=>v/reps),nav:Array.from(navBins).map(v=>v/reps),tShuttle:tShuttle,unload:G.unloadMin,stations:out};
}
function simSnapshot(R,G,N){
  const tot=R.stations.reduce((a,s)=>a+s.servers*(s.lines||1),0);
  const overload=R.stations.some(s=>s.load>=s.servers);
  const worst=R.stations.length?R.stations.reduce((a,b)=>b.p95>a.p95?b:a):null;
  let cls='amber';
  if(R.stations.length){ if(overload)cls='red'; else if(worst.p95<=G.greenSec)cls='green'; else if(worst.p95<=G.amberSec)cls='amber'; else cls='red'; }
  return {staff:tot,nNav:R.nNav,worstName:worst?worst.name:'—',worstP95:worst?Math.round(worst.p95):0,overload:overload,cls:cls,N:N,pNav:Math.round(G.pNav*100),tray:G.welcomeTray,apDur:G.apDur,green:G.greenSec,amber:G.amberSec};
}
function runSimAperitivo(opts){ const s=ev().sim; return simulateAperitivo(meta().plannedGuests, s.stations, s.G, opts); }

/* ============ APERITIVO (riepilogo dal simulatore; il motore è il simulatore) ============ */
function viewAperitivo(){
  const G=ev().sim.G;
  const ctrlDefs=[
    ['pNav','In navetta',0,100,5,Math.round(G.pNav*100)],
    ['travelMean','Tempo di viaggio',5,60,1,G.travelMean],
    ['sigma','Scaglionamento auto',0,30,1,G.sigma],
    ['shuttleOffset','Sfasamento navetta',-20,20,1,G.shuttleOffset],
    ['unloadMin','Scarico navetta',1,12,1,G.unloadMin],
    ['apDur','Durata aperitivo',20,100,5,G.apDur],
    ['greenSec','Soglia ideale',5,60,5,G.greenSec],
    ['amberSec','Soglia massima',10,90,5,G.amberSec]
  ];
  const ctrls=ctrlDefs.map(d=>'<div class="field"><label>'+d[1]+' <b id="simv_'+d[0]+'">'+simCtrlFmt(d[0],d[5])+'</b></label><input type="range" id="simr_'+d[0]+'" min="'+d[2]+'" max="'+d[3]+'" step="'+d[4]+'" value="'+d[5]+'"></div>').join("");
  return `
  <div class="card"><span class="pill todo">come funziona</span> Dimensiona l'aperitivo partendo da ${meta().plannedGuests} invitati (dal modulo Ospiti). Muovi i controlli, aggiungi o togli stazioni, leggi attese e consigli. I valori variano un po' a ogni ricalcolo perché gli arrivi sono casuali. Tieni le stazioni a coda lunga lontane dall'ingresso della location.</div>
  <div id="simVerdict" class="card"></div>
  <div class="sec-title"><h2>Scenario d'arrivo</h2></div>
  <div class="card">
    <div class="two">
      <div class="field"><label>Invitati <span class="muted">(dal modulo Ospiti)</span></label><input class="inp" value="${meta().plannedGuests}" disabled></div>
      ${ctrls}
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-top:6px"><input type="checkbox" id="simr_tray" ${G.welcomeTray?'checked':''}> Welcome drink su vassoio all'ingresso (assorbe lo sbarco della navetta)</label>
  </div>
  <div id="simFacts" class="grid cards" style="margin-top:12px"></div>
  <div class="sec-title"><h2>Arrivi nel tempo</h2></div>
  <div class="card"><canvas id="simArr" style="width:100%;height:220px;display:block"></canvas><div id="simArrLeg" class="simleg"></div></div>
  <div class="sec-title"><h2>Code nel tempo</h2></div>
  <div class="card"><div id="simQThr" class="simleg"></div><canvas id="simQ" style="width:100%;height:240px;display:block;touch-action:none"></canvas><div id="simQLeg" class="simleg"></div></div>
  <div class="sec-title"><h2>Stazioni</h2><span><select id="simType" class="inp" style="max-width:190px;display:inline-block;width:auto"></select> <button class="btn sm" id="simAdd">Aggiungi</button></span></div>
  <div id="simStations"></div>
  <div class="sec-title"><h2>Cosa dire al catering</h2></div>
  <div id="simSay" class="card"></div>
  <div class="sec-title"><h2>Scenari</h2></div>
  <div class="card">
    <div class="two">
      <div class="field"><label>Nome scenario</label><input class="inp" id="simScenName" placeholder="es. 14 camerieri · vassoi"></div>
      <div class="field"><label>&nbsp;</label><div class="btnbar"><button class="btn" id="simSave">Salva scenario</button> <button class="btn ghost" id="simEx">Esempi</button></div></div>
    </div>
    <div id="simCmp" style="margin-top:10px"></div>
    <details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Esporta / importa scenari</summary>
      <textarea class="inp" id="simIO" rows="3" placeholder="Codice scenari (incolla qui per importare)" style="margin-top:8px"></textarea>
      <div class="btnbar"><button class="btn sm ghost" id="simGen">Genera codice</button> <button class="btn sm ghost" id="simCopy">Copia</button> <button class="btn sm ghost" id="simImp">Importa</button></div>
      <div id="simIOmsg" class="muted" style="font-size:12px;margin-top:4px"></div>
    </details>
  </div>
  `;
}
function simCtrlFmt(key,v){
  if(key==='pNav') return Math.round(v)+'%';
  if(key==='sigma') return v<=6?'compatto':(v<=12?'medio':'sparso');
  if(key==='shuttleOffset') return v<-6?'arriva prima':(v>6?'arriva dopo':'in contemporanea');
  if(key==='greenSec'||key==='amberSec') return v+' s';
  return v+' min';
}
function simStatusOf(s,G){ if(s.load>=s.servers) return {cls:'red',txt:'Sovraccarico'}; if(s.p95<=G.greenSec) return {cls:'green',txt:'Ottimo'}; if(s.p95<=G.amberSec) return {cls:'amber',txt:'Accettabile'}; return {cls:'red',txt:'Troppo lungo'}; }
function simMakeStation(name){ const t=SIM_TYPES[name]||SIM_TYPES['Personalizzata']; const s=ev().sim; s.seq=(s.seq||s.stations.length)+1; return {id:s.seq,name:name==='Personalizzata'?'Nuova stazione':name,service:t.service,pop:t.pop,servers:3,welcome:t.welcome,lines:1,color:SIM_PALETTE[s.seq%SIM_PALETTE.length]}; }
function simBuildAdvice(R,G,N,stations){
  if(!R.stations.length) return '<p style="margin:0;font-size:13.5px">Aggiungi almeno una stazione per ricevere i consigli.</p>';
  const green=G.greenSec, amber=G.amberSec;
  const st=R.stations.map(s=>Object.assign({},s,{status:simStatusOf(s,G)}));
  const welcome=st.filter(s=>s.welcome);
  const notGreen=st.filter(s=>s.status.cls!=='green');
  const worst=st.reduce((a,b)=>b.p95>a.p95?b:a);
  const sec=(h,inner)=>'<div style="margin:10px 0"><div style="font-weight:600;font-size:13px;margin-bottom:4px">'+h+'</div>'+inner+'</div>';
  let html='';
  const okCount=st.filter(s=>s.status.cls==='green').length;
  html+=sec('In sintesi','<div style="font-size:13.5px">'+okCount+' stazioni su '+st.length+' entro la soglia ideale di '+green+' s. '+(notGreen.length===0?'Tutto sotto controllo.':'Da sistemare: '+notGreen.map(s=>esc(s.name)).join(', ')+'.')+'</div>');
  let prob='';
  if(R.nNav>0 && !G.welcomeTray && welcome.length){
    const cf=simulateAperitivo(N,stations,G,{tray:true,reps:15});
    const wIds=welcome.map(w=>w.id), cfW=cf.stations.filter(s=>wIds.indexOf(s.id)>=0);
    const before=Math.round(Math.max.apply(null,welcome.map(s=>s.p95)));
    const after=Math.round(Math.max.apply(null,cfW.map(s=>s.p95)));
    const qmax=Math.round(Math.max.apply(null,welcome.map(s=>s.maxQ)));
    prob='<div style="font-size:13.5px">Lo sbarco della navetta ('+R.nNav+' persone insieme verso il minuto '+R.peakMin+') intasa '+welcome.map(s=>esc(s.name)).join(', ')+': attesa fino a ~'+before+' s, coda ~'+qmax+' persone. Soluzione: welcome drink su vassoio all\'ingresso, l\'attesa scende a ~'+after+' s senza personale extra al bar.</div>';
  } else {
    const ov=st.filter(s=>s.load>=s.servers);
    if(ov.length) prob='<div style="font-size:13.5px">'+ov.map(s=>esc(s.name)).join(', ')+(ov.length>1?' sono sovraccariche':' è sovraccarica')+': arriva più lavoro di quanto i camerieri attuali smaltiscano, la coda non si riassorbe. Va aumentato l\'organico.</div>';
    else if(worst.p95>amber) prob='<div style="font-size:13.5px">Punto critico: '+esc(worst.name)+' (~'+Math.round(worst.p95)+' s nel caso peggiore, oltre '+amber+' s). Intervenire lì per primo.</div>';
    else if(worst.p95>green) prob='<div style="font-size:13.5px">Tutto accettabile; il più lento è '+esc(worst.name)+' (~'+Math.round(worst.p95)+' s). Per portarlo sotto '+green+' s basta un ritocco.</div>';
    else prob='<div style="font-size:13.5px">Nessuna criticità: ogni fila resta entro '+green+' s. Configurazione solida.</div>';
  }
  html+=sec('Problema principale',prob);
  if(notGreen.length){
    let rows='';
    notGreen.forEach(s=>{ const overloaded=s.load>=s.servers; let why,fix;
      if(s.welcome && !G.welcomeTray){ why='è la prima tappa e subisce l\'ondata d\'arrivo'; fix='attiva i vassoi, oppure porta i camerieri a '+simRecServers(s,green,N,G); }
      else if(overloaded){ why='carico superiore alla capacità ('+s.load.toFixed(1)+' contro '+s.servers+' camerieri)'; fix='almeno '+simRecServers(s,green,N,G)+' camerieri, oppure servizio più rapido'; }
      else { why='regge, ma il picco d\'arrivo la rallenta'; fix=simRecServers(s,green,N,G)+' camerieri per stare sotto '+green+' s (oggi '+s.servers+')'; }
      const pc=s.status.cls==='green'?'ok':(s.status.cls==='amber'?'warn':'no');
      rows+='<div style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><span class="pill '+pc+'">'+(overloaded?'∞':Math.round(s.p95)+'s')+'</span><div style="font-size:13.5px"><b>'+esc(s.name)+'</b>: '+why+'. <span style="color:#555">Rimedio: '+fix+'.</span></div></div>';
    });
    html+=sec('Stazione per stazione',rows);
  }
  const Gt=Object.assign({},G,{welcomeTray:true});
  const recs=st.map(s=>({name:s.name,cur:s.servers,rec:Math.max(s.servers,simRecServers(s,green,N,Gt))})).filter(r=>r.rec>r.cur);
  if(recs.length){
    const totRec=st.reduce((a,s)=>a+Math.max(s.servers,simRecServers(s,green,N,Gt))*(s.lines||1),0);
    let t=''; recs.forEach(r=>{ t+='<tr><td>'+esc(r.name)+'</td><td>'+r.cur+' → '+r.rec+'</td></tr>'; });
    html+=sec('Configurazione consigliata (target '+green+' s, vassoi attivi)','<div style="overflow:auto"><table class="tbl">'+t+'</table></div><div style="margin-top:6px;color:#555;font-size:13px">Totale alle stazioni: '+totRec+' persone, più gli addetti ai vassoi.</div>');
  }
  const lev=[];
  if(!G.welcomeTray && R.nNav>0) lev.push('Welcome drink su vassoio: assorbe lo sbarco senza personale extra.');
  if(G.apDur<70) lev.push('Allunga l\'aperitivo: verso 70–80 minuti la stessa folla si distribuisce e le code calano, a parità di camerieri.');
  if(Math.abs(G.shuttleOffset)<=6 && R.nNav>0) lev.push('Sfasa la navetta: farla arrivare qualche minuto prima o dopo il grosso delle auto evita di sommare i due picchi.');
  lev.push('Sposta le stazioni a coda lunga (salumi, formaggi) lontano dall\'ingresso, così il flusso non si blocca all\'arrivo.');
  html+=sec('Leve a basso costo','<ul style="margin:4px 0 0;padding-left:18px">'+lev.map(t=>'<li style="margin:4px 0;font-size:13.5px">'+t+'</li>').join('')+'</ul>');
  html+=sec('Promemoria logistico','<div style="font-size:13.5px">Primo e ultimo arrivo distano ~'+Math.round(R.gap)+' minuti: tieni il servizio attivo per tutta la finestra. Personale alle stazioni: '+st.reduce((a,s)=>a+s.servers*(s.lines||1),0)+' persone.</div>');
  return html;
}
function renderSimStations(){
  const host=$("#simStations"); if(!host) return; host.innerHTML='';
  ev().sim.stations.forEach(s=>{
    const card=document.createElement('div'); card.className='card'; card.style.marginBottom='12px';
    card.innerHTML=
      '<div style="display:flex;align-items:center;gap:8px"><span style="width:12px;height:12px;border-radius:50%;background:'+s.color+';flex:0 0 auto;display:inline-block"></span>'+
      '<input class="inp" id="simname_'+s.id+'" value="'+esc(s.name)+'" style="flex:1"><button class="btn sm danger" id="simrm_'+s.id+'">×</button></div>'+
      '<label style="display:flex;align-items:center;gap:6px;margin:8px 0;font-size:13px"><input type="checkbox" id="simwel_'+s.id+'" '+(s.welcome?'checked':'')+'> prima tappa all\'arrivo (subisce l\'ondata)</label>'+
      '<div id="simres_'+s.id+'" class="muted" style="font-size:12.5px;margin:6px 0">—</div>'+
      '<div class="field"><label>Camerieri <b id="simvS_'+s.id+'">'+s.servers+'</b> <span class="muted" id="simrec_'+s.id+'"></span></label><input type="range" id="simS_'+s.id+'" min="1" max="12" step="1" value="'+s.servers+'"></div>'+
      '<div class="field"><label>Tempo di servizio <b id="simvT_'+s.id+'">'+s.service+'</b> s</label><input type="range" id="simT_'+s.id+'" min="6" max="80" step="1" value="'+s.service+'"></div>'+
      '<div class="field"><label>'+(s.welcome?'Visite extra per ospite':'Visite per ospite')+' <b id="simvP_'+s.id+'">'+s.pop.toFixed(1)+'</b></label><input type="range" id="simP_'+s.id+'" min="0" max="4" step="0.5" value="'+s.pop+'"></div>'+
      '<div class="field"><label>Postazioni in parallelo <b id="simvL_'+s.id+'">'+(s.lines||1)+'</b></label><input type="range" id="simL_'+s.id+'" min="1" max="6" step="1" value="'+(s.lines||1)+'"></div>';
    host.appendChild(card);
    $("#simname_"+s.id).addEventListener('input',e=>{ s.name=e.target.value; simRecalcThrottled(); });
    $("#simwel_"+s.id).addEventListener('change',e=>{ s.welcome=e.target.checked; simRecalc(); });
    $("#simrm_"+s.id).addEventListener('click',()=>{ ev().sim.stations=ev().sim.stations.filter(x=>x.id!==s.id); renderSimStations(); simRecalc(); });
    $("#simS_"+s.id).addEventListener('input',e=>{ s.servers=+e.target.value; $("#simvS_"+s.id).textContent=s.servers; simRecalcThrottled(); });
    $("#simT_"+s.id).addEventListener('input',e=>{ s.service=+e.target.value; $("#simvT_"+s.id).textContent=s.service; simRecalcThrottled(); });
    $("#simP_"+s.id).addEventListener('input',e=>{ s.pop=+e.target.value; $("#simvP_"+s.id).textContent=s.pop.toFixed(1); simRecalcThrottled(); });
    $("#simL_"+s.id).addEventListener('input',e=>{ s.lines=+e.target.value; $("#simvL_"+s.id).textContent=(s.lines||1); simRecalcThrottled(); });
  });
}
let simT=null;
function simRecalcThrottled(){ clearTimeout(simT); simT=setTimeout(simRecalc,130); }
function simRecalc(){
  if(!$("#simVerdict")) return;
  const G=ev().sim.G, N=meta().plannedGuests, stations=ev().sim.stations;
  const R=simulateAperitivo(N,stations,G,{});
  stations.forEach(s=>{ const el=$("#simres_"+s.id); if(!el)return; const st=simStatusOf(s,G); const pc=st.cls==='green'?'ok':(st.cls==='amber'?'warn':'no');
    el.innerHTML='<span class="pill '+pc+'">'+st.txt+'</span> <b>'+(s.load>=s.servers?'coda in crescita':Math.round(s.p95)+' s')+'</b> caso peggiore · media '+Math.round(s.mean)+' s · coda max ~'+Math.round(s.maxQ)+(s.lines>1?' · '+s.lines+' postazioni':'');
    const rh=$("#simrec_"+s.id); if(rh){ const rec=simRecServers(s,G.greenSec,N,G); if(rec>s.servers){ rh.textContent='consigliati '+rec; rh.style.color='var(--gold)'; } else { rh.textContent='ok'; rh.style.color='var(--ok)'; } }
  });
  const facts=[]; if(R.nNav>0) facts.push([R.nNav,'in navetta (insieme)']); facts.push([Math.round(R.peakRate)+'/min','picco arrivi']); facts.push([Math.round(R.gap)+' min','primo↔ultimo']); facts.push(["~"+R.peakMin+"'",'minuto del picco']);
  const fh=$("#simFacts"); if(fh) fh.innerHTML=facts.map(f=>'<div class="card kpi"><div class="v">'+f[0]+'</div><div class="l">'+f[1]+'</div></div>').join('');
  const vb=$("#simVerdict"); if(vb){
    if(!R.stations.length){ vb.innerHTML='<span class="pill warn">vuoto</span> Aggiungi almeno una stazione (bar, cibo) qui sotto.'; }
    else { const overloaded=R.stations.filter(s=>s.load>=s.servers); const worst=R.stations.reduce((a,b)=>b.p95>a.p95?b:a); let cls,txt;
      if(overloaded.length){ cls='no'; txt='Alcune stazioni non reggono: '+overloaded.map(s=>esc(s.name)).join(', ')+'. La coda cresce: aggiungi camerieri o riduci il servizio.'; }
      else if(worst.p95<=G.greenSec){ cls='ok'; txt='Tutto entro '+G.greenSec+' secondi. Configurazione ottimale.'; }
      else if(worst.p95<=G.amberSec){ cls='warn'; txt='Accettabile, entro '+G.amberSec+' s. Punto critico: '+esc(worst.name)+' (~'+Math.round(worst.p95)+' s). Un cameriere in più lì lo porta sotto '+G.greenSec+' s.'; }
      else { cls='no'; txt='Attese lunghe: '+esc(worst.name)+' ~'+Math.round(worst.p95)+' s. Aggiungi camerieri o velocizza il servizio.'; }
      vb.innerHTML='<span class="pill '+cls+'">esito</span> '+txt;
    }
  }
  const say=$("#simSay"); if(say) say.innerHTML=simBuildAdvice(R,G,N,stations);
  simLastR=R;
  if($("#simArr")){ simDrawArr(R); const al=$("#simArrLeg"); if(al) al.innerHTML=(R.nSelf>0?'<span><i style="background:#c9b27f"></i>arrivi in auto</span>':'')+(R.nNav>0?'<span><i style="background:#c0392b"></i>navetta</span>':''); }
  if($("#simQ")){ simDrawQ(R,simCrossX); simRenderQLegend(R); const thr=$("#simQThr"); if(thr) thr.innerHTML='<span><i style="background:#1a8a4a"></i>entro '+G.greenSec+'s</span><span><i style="background:#c47d12"></i>entro '+G.amberSec+'s</span><span><i style="background:#c0392b"></i>oltre o sovraccarico</span>'; }
  Store.save(STATE);
}
function wireAperitivo(){
  if(!$("#simType")) return;
  const ts=$("#simType"); if(!ts.options.length){ Object.keys(SIM_TYPES).forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; ts.appendChild(o); }); }
  ['pNav','travelMean','sigma','shuttleOffset','unloadMin','apDur','greenSec','amberSec'].forEach(key=>{
    const el=$("#simr_"+key); if(!el) return;
    el.addEventListener('input',()=>{ const v=parseFloat(el.value);
      if(key==='pNav') ev().sim.G.pNav=v/100; else ev().sim.G[key]=v;
      $("#simv_"+key).textContent=simCtrlFmt(key,v);
      if(key==='greenSec' && ev().sim.G.greenSec>ev().sim.G.amberSec){ ev().sim.G.amberSec=ev().sim.G.greenSec; const a=$("#simr_amberSec"); if(a){ a.value=ev().sim.G.amberSec; $("#simv_amberSec").textContent=ev().sim.G.amberSec+' s'; } }
      if(key==='amberSec' && ev().sim.G.amberSec<ev().sim.G.greenSec){ ev().sim.G.greenSec=ev().sim.G.amberSec; const g=$("#simr_greenSec"); if(g){ g.value=ev().sim.G.greenSec; $("#simv_greenSec").textContent=ev().sim.G.greenSec+' s'; } }
      simRecalcThrottled();
    });
  });
  const tray=$("#simr_tray"); if(tray) tray.addEventListener('change',()=>{ ev().sim.G.welcomeTray=tray.checked; simRecalc(); });
  const add=$("#simAdd"); if(add) add.addEventListener('click',()=>{ ev().sim.stations.push(simMakeStation($("#simType").value)); renderSimStations(); simRecalc(); });
  renderSimStations();
  simRecalc();
  const sb=$("#simSave"); if(sb) sb.addEventListener('click',simSaveScenario);
  const se=$("#simEx"); if(se) se.addEventListener('click',simSeedExamples);
  const sg=$("#simGen"); if(sg) sg.addEventListener('click',simExportCode);
  const scp=$("#simCopy"); if(scp) scp.addEventListener('click',simCopyCode);
  const si=$("#simImp"); if(si) si.addEventListener('click',simImportCode);
  simRenderComparison();
  const qc=$("#simQ");
  if(qc){
    qc.addEventListener('mousemove',e=>{ simCrossX=simToMin(e,qc); if(simLastR) simDrawQ(simLastR,simCrossX); });
    qc.addEventListener('mouseleave',()=>{ simCrossX=null; if(simLastR) simDrawQ(simLastR,simCrossX); });
    qc.addEventListener('touchmove',e=>{ if(e.touches&&e.touches[0]){ simCrossX=simToMin(e.touches[0],qc); if(simLastR) simDrawQ(simLastR,simCrossX); } },{passive:true});
    qc.addEventListener('touchend',()=>{ simCrossX=null; if(simLastR) simDrawQ(simLastR,simCrossX); });
  }
}
let simHidden=new Set(), simLastR=null, simCrossX=null;
function simSetupCanvas(cv,hCss){ const dpr=window.devicePixelRatio||1; const w=cv.clientWidth||600; const nw=Math.round(w*dpr),nh=Math.round(hCss*dpr); if(cv.width!==nw||cv.height!==nh){ cv.width=nw; cv.height=nh; } const ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,hCss); return {ctx:ctx,w:w,h:hCss}; }
function simToMin(e,cv){ const r=cv.getBoundingClientRect(); const padL=34,padR=8; const n=simLastR?simLastR.GRID:70; const frac=(e.clientX-r.left-padL)/(r.width-padL-padR); return Math.max(0,Math.min(n-1,Math.round(frac*n))); }
function simDrawArr(R){
  const cv=$("#simArr"); if(!cv) return; const o=simSetupCanvas(cv,220); const ctx=o.ctx,w=o.w,h=o.h;
  const padL=34,padB=26,padT=10,padR=8,n=R.GRID;
  const maxV=Math.max.apply(null,[1].concat(R.arr)), bw=(w-padL-padR)/n;
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(padL,padT); ctx.lineTo(padL,h-padB); ctx.lineTo(w-padR,h-padB); ctx.stroke();
  ctx.fillStyle='#999'; ctx.font='10px sans-serif';
  for(let m=0;m<=n;m+=10){ const x=padL+m*bw; ctx.fillText(m+"'",x-6,h-padB+14); }
  ctx.save(); ctx.translate(11,h/2); ctx.rotate(-Math.PI/2); ctx.fillStyle='#999'; ctx.fillText('arrivi / min',-26,0); ctx.restore();
  for(let b=0;b<n;b++){ const x=padL+b*bw,navv=R.nav[b],tot=R.arr[b],autov=tot-navv;
    const hA=(autov/maxV)*(h-padT-padB),hN=(navv/maxV)*(h-padT-padB);
    if(hA>0){ ctx.fillStyle='#c9b27f'; ctx.fillRect(x+0.5,h-padB-hA,Math.max(1,bw-1),hA); }
    if(hN>0){ ctx.fillStyle='#c0392b'; ctx.fillRect(x+0.5,h-padB-hA-hN,Math.max(1,bw-1),hN); } }
  const px=padL+R.peakMin*bw; ctx.strokeStyle='#333'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(px,padT); ctx.lineTo(px,h-padB); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#333'; ctx.fillText('picco '+Math.round(R.peakRate)+'/min',Math.min(px+3,w-92),padT+10);
}
function simDrawQ(R,cross){
  const cv=$("#simQ"); if(!cv) return; const o=simSetupCanvas(cv,240); const ctx=o.ctx,w=o.w,h=o.h;
  const padL=34,padB=26,padT=10,padR=8,n=R.GRID;
  const vis=s=>s.active&&!simHidden.has(s.id);
  let maxV=1; R.stations.forEach(s=>{ if(!vis(s))return; s.queue.forEach(v=>{ if(v>maxV)maxV=v; }); }); maxV=Math.ceil(maxV*1.1)||1;
  const X=b=>padL+(b/n)*(w-padL-padR), Y=v=>h-padB-(v/maxV)*(h-padT-padB);
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(padL,padT); ctx.lineTo(padL,h-padB); ctx.lineTo(w-padR,h-padB); ctx.stroke();
  ctx.fillStyle='#999'; ctx.font='10px sans-serif';
  for(let m=0;m<=n;m+=10){ const x=X(m); ctx.fillText(m+"'",x-6,h-padB+14); }
  for(let g=0;g<=maxV;g+=Math.max(1,Math.round(maxV/4))){ const y=Y(g); ctx.fillStyle='#bbb'; ctx.fillText(g,4,y+3); ctx.strokeStyle='#f3f3f3'; ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke(); }
  ctx.save(); ctx.translate(11,h/2); ctx.rotate(-Math.PI/2); ctx.fillStyle='#999'; ctx.fillText('persone in coda',-40,0); ctx.restore();
  if(R.nNav>0){ const sx0=X(R.tShuttle),sx1=X(R.tShuttle+R.unload); ctx.fillStyle='rgba(192,57,43,.08)'; ctx.fillRect(sx0,padT,Math.max(2,sx1-sx0),h-padT-padB); ctx.fillStyle='#c0392b'; ctx.font='9px sans-serif'; ctx.fillText('navetta',sx0+2,padT+9); }
  R.stations.forEach(s=>{ if(!vis(s))return; ctx.strokeStyle=s.color; ctx.lineWidth=2; ctx.beginPath(); for(let b=0;b<n;b++){ const x=X(b),y=Y(s.queue[b]); if(b===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); } ctx.stroke(); });
  if(cross!=null && cross>=0 && cross<n){
    const x=X(cross);
    ctx.strokeStyle='#999'; ctx.setLineDash([4,3]); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,padT); ctx.lineTo(x,h-padB); ctx.stroke(); ctx.setLineDash([]);
    const rows=R.stations.filter(vis).map(s=>({c:s.color,t:s.name,v:Math.round(s.queue[cross])}));
    R.stations.forEach(s=>{ if(!vis(s))return; ctx.fillStyle=s.color; ctx.beginPath(); ctx.arc(x,Y(s.queue[cross]),3.2,0,6.2832); ctx.fill(); });
    ctx.font='10px sans-serif'; let tw=ctx.measureText('minuto '+cross+"'").width;
    rows.forEach(r=>{ tw=Math.max(tw,ctx.measureText(r.t+': '+r.v).width+12); });
    const bw=tw+16, bh=(rows.length+1)*14+6;
    let bx=(x<w/2)?x+10:x-bw-10; bx=Math.max(padL+1,Math.min(bx,w-padR-bw)); const by=padT+2;
    ctx.fillStyle='rgba(255,255,255,.94)'; ctx.fillRect(bx,by,bw,bh); ctx.strokeStyle='#ddd'; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh);
    ctx.fillStyle='#333'; ctx.font='bold 10px sans-serif'; ctx.fillText('minuto '+cross+"'",bx+7,by+12); ctx.font='10px sans-serif';
    rows.forEach((r,i)=>{ const ty=by+12+(i+1)*14; ctx.fillStyle=r.c; ctx.fillRect(bx+7,ty-8,7,7); ctx.fillStyle='#333'; ctx.fillText(r.t+': '+r.v,bx+18,ty); });
  }
}
function simRenderQLegend(R){
  const host=$("#simQLeg"); if(!host) return;
  host.innerHTML=R.stations.filter(s=>s.active).map(s=>'<span class="qtog'+(simHidden.has(s.id)?' off':'')+'" data-id="'+s.id+'"><i style="background:'+s.color+'"></i>'+esc(s.name)+'</span>').join('');
  Array.prototype.forEach.call(host.querySelectorAll('.qtog'),el=>el.addEventListener('click',()=>{ const id=+el.getAttribute('data-id'); if(simHidden.has(id))simHidden.delete(id); else simHidden.add(id); simRenderQLegend(R); if(simLastR)simDrawQ(simLastR,simCrossX); }));
}
function simSuggestName(R,G,N){
  const c=[];
  if(N!==180) c.push(N+' osp');
  if(Math.round(G.pNav*100)!==40) c.push(Math.round(G.pNav*100)+'% nav');
  c.push(G.welcomeTray?'vassoi':'no vassoi');
  c.push(R.stations.reduce((a,s)=>a+s.servers*(s.lines||1),0)+' cam');
  const sn=simSnapshot(R,G,N);
  c.push(sn.overload?'critico':(sn.cls==='green'?'OK':(sn.cls==='amber'?'limite':'lento')));
  return c.join(' · ');
}
function simNextScenId(){ const s=ev().sim; s.seqS=(s.seqS||(s.scenarios||[]).reduce((m,x)=>Math.max(m,x.id||0),0))+1; return s.seqS; }
function simSaveScenario(){
  const G=ev().sim.G, N=meta().plannedGuests;
  const R=simulateAperitivo(N, ev().sim.stations, G, {});
  const ni=$("#simScenName"); const name=((ni&&ni.value||'').trim())||simSuggestName(R,G,N);
  ev().sim.scenarios=ev().sim.scenarios||[];
  ev().sim.scenarios.push({id:simNextScenId(),name:name,snap:simSnapshot(R,G,N),config:{G:Object.assign({},G),stations:ev().sim.stations.map(s=>Object.assign({},s))}});
  Store.save(STATE); simRenderComparison(); if(ni) ni.value=''; toast('Scenario salvato');
}
function simSeedExamples(){
  const G=ev().sim.G, N=meta().plannedGuests;
  const R=simulateAperitivo(N, ev().sim.stations, G, {});
  ev().sim.scenarios=ev().sim.scenarios||[];
  ev().sim.scenarios.push({id:simNextScenId(),name:'Di partenza',snap:simSnapshot(R,G,N),config:{G:Object.assign({},G),stations:ev().sim.stations.map(s=>Object.assign({},s))}});
  const Gt=Object.assign({},G,{welcomeTray:true});
  const opt=ev().sim.stations.map(s=>{ const o=Object.assign({},s); o.servers=Math.max(o.servers,simRecServers(o,G.greenSec,N,Gt)); return o; });
  const Ropt=simulateAperitivo(N, opt, G, {});
  ev().sim.scenarios.push({id:simNextScenId(),name:'Esempio ottimizzato',snap:simSnapshot(Ropt,G,N),config:{G:Object.assign({},G),stations:opt.map(s=>Object.assign({},s))}});
  Store.save(STATE); simRenderComparison(); toast('Esempi aggiunti');
}
function simRenderComparison(){
  const host=$("#simCmp"); if(!host) return;
  const sc=ev().sim.scenarios||[];
  if(!sc.length){ host.innerHTML='<div class="muted">Nessuno scenario salvato. Configura e premi Salva: comparirà qui per il confronto.</div>'; return; }
  const greens=sc.filter(s=>s.snap.cls==='green');
  const bestId=greens.length?greens.reduce((a,b)=>b.snap.staff<a.snap.staff?b:a).id:null;
  let rows='';
  sc.forEach(s=>{ const pc=s.snap.cls==='green'?'ok':(s.snap.cls==='amber'?'warn':'no');
    rows+='<tr'+(s.id===bestId?' style="background:rgba(111,148,102,.14)"':'')+'><td><span class="pill '+pc+'">'+(s.snap.overload?'∞':s.snap.worstP95+'s')+'</span> '+esc(s.name)+'</td><td class="num">'+s.snap.N+'</td><td class="num">'+s.snap.staff+'</td><td>'+esc(s.snap.worstName)+'</td><td class="num"><button class="btn sm ghost" data-act="simLoadScen" data-id="'+s.id+'">carica</button> <button class="btn sm danger" data-act="simDelScen" data-id="'+s.id+'">×</button></td></tr>';
  });
  host.innerHTML='<div style="overflow:auto"><table class="tbl"><tr><th>Scenario</th><th class="num">Osp</th><th class="num">Cam</th><th>Punto critico</th><th></th></tr>'+rows+'</table></div>'+(bestId?'<div class="muted" style="margin-top:6px;color:var(--ok)">In evidenza: lo scenario verde con meno personale.</div>':'');
}
function simLoadScenario(id){
  const sc=(ev().sim.scenarios||[]).find(x=>x.id===id); if(!sc) return;
  ev().sim.G=Object.assign({},sc.config.G);
  ev().sim.stations=sc.config.stations.map(s=>Object.assign({},s));
  ev().sim.seq=Math.max(ev().sim.seq||0, ev().sim.stations.reduce((m,s)=>Math.max(m,s.id||0),0));
  commit('Scenario caricato');
}
function simDelScenario(id){ ev().sim.scenarios=(ev().sim.scenarios||[]).filter(x=>x.id!==id); Store.save(STATE); simRenderComparison(); }
function simIOMsg(t,c){ const m=$("#simIOmsg"); if(m){ m.textContent=t; m.style.color=c||'var(--muted)'; } }
function simExportCode(){ try{ const json=JSON.stringify((ev().sim.scenarios||[]).map(s=>({name:s.name,snap:s.snap,config:s.config}))); const ta=$("#simIO"); if(ta) ta.value=btoa(unescape(encodeURIComponent(json))); simIOMsg('Codice generato: copialo e conservalo.',''); }catch(e){ simIOMsg('Errore nella generazione.','var(--no)'); } }
function simImportCode(){ const ta=$("#simIO"); const txt=(ta&&ta.value||'').trim(); if(!txt){ simIOMsg('Incolla prima un codice.','var(--no)'); return; } try{ const arr=JSON.parse(decodeURIComponent(escape(atob(txt)))); if(!Array.isArray(arr))throw 0; let n=0; ev().sim.scenarios=ev().sim.scenarios||[]; arr.forEach(o=>{ if(o&&o.snap&&o.config){ ev().sim.scenarios.push({id:simNextScenId(),name:o.name||'Scenario',snap:o.snap,config:o.config}); n++; } }); Store.save(STATE); simRenderComparison(); simIOMsg('Importati '+n+' scenari.','var(--ok)'); }catch(e){ simIOMsg('Codice non valido.','var(--no)'); } }
function simCopyCode(){ const ta=$("#simIO"); if(!ta) return; if(!ta.value) simExportCode(); ta.focus(); try{ ta.select(); ta.setSelectionRange(0,99999); }catch(e){} if(window.navigator&&navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(ta.value).then(()=>simIOMsg('Copiato.','var(--ok)')).catch(()=>{}); } else { let ok=false; try{ ok=document.execCommand('copy'); }catch(e){} simIOMsg(ok?'Copiato.':'Seleziona il testo e copia a mano.',ok?'var(--ok)':'var(--muted)'); } }

/* ============ TIMELINE & CHECKLIST + RUN-OF-SHOW ============ */
function taskDone(t){ if(t.done) return true; if(t.vendorCat) return ev().vendors.some(v=>v.category===t.vendorCat&&v.status==="confermato"); return false; }
// 8.3: il fornitore confermato che soddisfa l'auto-spunta del task (per trasparenza in timeline).
function taskVendor(t){ if(!t.vendorCat) return null; return ev().vendors.find(v=>v.category===t.vendorCat&&v.status==="confermato")||null; }
let rsFilter="";
// Attivita' "prenota/assicura fornitore" -> categoria fornitore (VCATS esatte):
// queste si auto-spuntano quando esiste un fornitore confermato di quella
// categoria e mostrano il suo nome (vedi taskDone/taskVendor). NON includiamo
// attivita'-evento (degustazioni, prove, "confermare numeri") che non devono
// spuntarsi solo perche' il fornitore e' confermato.
const TASK_VENDORCAT={
  "Scegliere foto e video":"Foto/Video",
  "Scegliere musica / DJ":"Musica/DJ",
  "Fiori e allestimenti":"Fiori",
  "Scegliere torta":"Torta",
  "Confermare navetta e trasporti":"Trasporti/Navetta"
};
// Collega le attivita' seed gia' salvate che dovrebbero puntare a un fornitore
// ma sono senza vendorCat (idempotente; solo titoli identici alla mappa e senza
// vendorCat gia' impostato). Boot + dopo ogni pull dal cloud, come le altre.
function migrateTaskVendorCat(){
  try{
    let n=0;
    Object.keys((STATE&&STATE.events)||{}).forEach(k=>{
      ((STATE.events[k]||{}).tasks||[]).forEach(t=>{ if(t && !t.vendorCat && TASK_VENDORCAT[t.title]){ t.vendorCat=TASK_VENDORCAT[t.title]; n++; } });
    });
    if(n) Store.save(STATE);
  }catch(err){ Diag.log("timeline","migrazione vendorCat fallita", err&&err.message); }
}
function genChecklist(){
  const e=ev(), base=new Date(meta().date+"T00:00:00");
  const M=n=>{ const d=new Date(base); d.setMonth(d.getMonth()-n); return d.toISOString().slice(0,10); };
  const W=n=>{ const d=new Date(base); d.setDate(d.getDate()-7*n); return d.toISOString().slice(0,10); };
  const tpl=[["Bloccare location e catering","Fornitori",M(12)],["Lista invitati preliminare","Ospiti",M(12)],["Scegliere foto e video","Fornitori",M(9)],["Scegliere musica / DJ","Fornitori",M(9)],["Acquisto abito sposa","Abiti",M(9)],["Ordinare partecipazioni","Inviti",M(6)],["Fiori e allestimenti","Fornitori",M(6)],["Scegliere torta","Fornitori",M(6)],["Prove menu e degustazione","Catering",M(3)],["Prova trucco e acconciatura","Beauty",M(3)],["Ordinare bomboniere","Extra",M(3)],["Confermare numeri al catering","Catering",M(1)],["Tableau e disposizione tavoli","Ospiti",M(1)],["Scaletta e run-of-show","Coordinamento",W(2)],["Confermare navetta e trasporti","Logistica",W(2)],["Saldo fornitori","Pagamenti",W(1)],["Kit emergenza e dettagli finali","Coordinamento",W(1)]];
  const have=new Set(e.tasks.map(t=>t.title)); let added=0;
  tpl.forEach(r=>{ if(!have.has(r[0])){ const task={id:"k"+Date.now()+"_"+added,title:r[0],category:r[1],due:r[2],assignee:"Sposi",done:false}; if(TASK_VENDORCAT[r[0]]) task.vendorCat=TASK_VENDORCAT[r[0]]; e.tasks.push(task); added++; } });
  commit("Checklist generata: +"+added+" attività");
}
function viewTimeline(){
  const e=ev(), today=new Date().toISOString().slice(0,10), d=DERIVED;
  const tasks=[...e.tasks].sort((a,b)=>(a.due||"").localeCompare(b.due||""));
  const trows=tasks.map(t=>{
    const done=taskDone(t), auto=!t.done&&done, over=!done&&t.due&&t.due<today, tvendor=taskVendor(t);
    return `<tr>
      <td><button class="btn sm ${done?"":"ghost"}" data-act="toggleTask" data-id="${t.id}">${done?"&#10003;":"&#9675;"}</button></td>
      <td>${esc(t.title)} ${auto?'<span class="tag">auto</span>':""}<div class="muted" style="font-size:12px">${esc(t.category||"")}${t.assignee?" · "+esc(t.assignee):""}</div></td>
      <td>${t.due?fdate(t.due):"—"} ${over?'<span class="pill no">scaduta</span>':""}</td>
      <td class="num"><button class="btn sm ghost" data-act="editTask" data-id="${t.id}" aria-label="Modifica ${esc(t.title)}" title="Modifica">&#9998;</button> <button class="btn sm danger" data-act="delTask" data-id="${t.id}" aria-label="Elimina ${esc(t.title)}" title="Elimina">×</button>${t.vendorCat?`<div class="muted" style="font-size:11px;white-space:normal;max-width:120px;margin-top:3px;text-align:right" title="Si spunta da sola quando confermi un fornitore ${esc(t.vendorCat)}. Puoi comunque modificarla o eliminarla.">${tvendor?"Confermato: "+esc(tvendor.name):"da fornitore ("+esc(t.vendorCat)+")"}</div>`:""}</td>
    </tr>`;
  }).join("");
  const responsibles=[...new Set(e.runshow.map(r=>r.who).filter(Boolean))];
  const rs=[...e.runshow].sort((a,b)=>(a.time||"").localeCompare(b.time||"")).filter(r=>!rsFilter||r.who===rsFilter);
  const rsrows=rs.map(r=>{
    const pl=musicUrl(r.playlist);
    const plLink=pl?`<div style="margin-top:2px"><a href="${esc(pl)}" target="_blank" rel="noopener" class="pill todo" style="text-decoration:none;display:inline-block">&#9654; ${esc(musicLabel(pl))}</a></div>`:"";
    return `<tr><td class="num">${esc(r.time||"")}</td><td>${esc(r.title)}${plLink}</td><td>${esc(r.who||"")}</td><td class="num"><button class="btn sm ghost" data-act="editRs" data-id="${r.id}" aria-label="Modifica ${esc(r.title)}" title="Modifica">&#9998;</button> <button class="btn sm danger" data-act="delRs" data-id="${r.id}" aria-label="Elimina ${esc(r.title)}" title="Elimina">×</button></td></tr>`;
  }).join("");
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${d.tasksDone}/${d.tasksTotal}</div><div class="l">Completate</div></div>
    <div class="card kpi"><div class="v">${d.overdue}</div><div class="l">Scadute</div></div>
  </div>
  <div class="sec-title"><h2>Checklist</h2><span><button class="btn sm ghost" data-act="genChecklist">Genera standard</button> <button class="btn sm" data-act="addTask">+ Attività</button></span></div>
  <div class="scroll-x"><table class="tbl"><thead><tr><th></th><th>Attività</th><th>Scadenza</th><th></th></tr></thead><tbody>${trows||'<tr><td colspan="4" class="muted">Nessuna attività. Usa Genera standard.</td></tr>'}</tbody></table></div>
  <div class="sec-title"><h2>Scaletta</h2><span><button class="btn sm ghost" data-act="genRunShow">Scaletta standard</button> <button class="btn sm" data-act="addRs">+ Momento</button></span></div>
  <div class="card" style="margin-bottom:10px"><div class="field"><label>Filtra per responsabile</label><select class="inp" id="rs_filter"><option value="">Tutti</option>${responsibles.map(w=>`<option value="${esc(w)}"${rsFilter===w?" selected":""}>${esc(w)}</option>`).join("")}</select></div></div>
  <div class="scroll-x"><table class="tbl"><thead><tr><th>Ora</th><th>Momento</th><th>Responsabile</th><th></th></tr></thead><tbody>${rsrows||'<tr><td colspan="4" class="muted">Nessun momento.</td></tr>'}</tbody></table></div>
  `;
}
function editTask(id){
  const e=ev(), t=e.tasks.find(x=>x.id===id), isNew=!t;
  const x=t||{title:"",category:"",due:"",assignee:"Sposi",done:false,vendorCat:""};
  modal(isNew?"Nuova attività":"Modifica attività",
    `<div class="field"><label>Attività</label><input class="inp" id="t_title" value="${esc(x.title)}"></div>
     <div class="two"><div class="field"><label>Categoria</label><input class="inp" id="t_cat" value="${esc(x.category||"")}"></div>
     <div class="field"><label>Scadenza</label><input class="inp" type="date" id="t_due" value="${esc(x.due||"")}"></div></div>
     <div class="field"><label>Responsabile</label><select class="inp" id="t_as">${["Sposi","Silvia","Famiglia Righi","Famiglia Biondi","Wedding planner"].map(a=>`<option${x.assignee===a?" selected":""}>${a}</option>`).join("")}</select></div>
     <div class="field"><label>Si spunta da sola con fornitore confermato <span class="muted" style="font-size:11px">(vuoto = attività solo manuale)</span></label><select class="inp" id="t_vcat"><option value=""${!x.vendorCat?" selected":""}>— nessun collegamento —</option>${VCATS.map(c=>`<option value="${esc(c)}"${x.vendorCat===c?" selected":""}>${esc(c)}</option>`).join("")}</select></div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const title=$("#t_title").value.trim(); if(!title) return;
      const data={title,category:$("#t_cat").value.trim(),due:$("#t_due").value,assignee:$("#t_as").value,vendorCat:$("#t_vcat").value||""};
      const E=ev();
      if(isNew){ E.tasks.push(Object.assign({id:"k"+Date.now(),done:false,createdAt:new Date().toISOString().slice(0,10)},data)); }
      else { const cur=E.tasks.find(x=>x.id===id); if(!cur){ toast("Attività non più presente (aggiornata da un altro dispositivo)"); return; } Object.assign(cur,data); }
      commit(isNew?"Attività aggiunta":"Attività aggiornata");
    }}]);
}
function delTask(id){
  const t=ev().tasks.find(x=>x.id===id); if(!t) return;
  modal("Eliminare l'attività?",`<p>Rimuovo <b>${esc(t.title)}</b> dalla checklist.</p>`,
    [{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{ ev().tasks=ev().tasks.filter(x=>x.id!==id); commit("Attività rimossa"); }}]);
}
function editRs(id){
  const e=ev(), r=e.runshow.find(x=>x.id===id), isNew=!r;
  const x=r||{time:"",title:"",who:""};
  modal(isNew?"Nuovo momento":"Modifica momento",
    `<div class="two"><div class="field"><label>Ora</label><input class="inp" type="time" id="r_time" value="${esc(x.time||"")}"></div>
     <div class="field"><label>Responsabile</label>${managedSelect("r_who", x.who||"", [""].concat(runShowWho()))}</div></div>
     <div class="field"><label>Momento</label>${managedSelect("r_title", x.title||"", [""].concat(RUNSHOW_SUGGEST))}</div>
     <div class="field"><label>Link playlist <span class="muted" style="font-size:11px">(Spotify, Apple/YouTube Music, Amazon, Deezer o qualsiasi URL)</span></label><input class="inp" id="r_pl" value="${esc(x.playlist||"")}" placeholder="https://open.spotify.com/playlist/…" inputmode="url"></div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const title=(managedValue("r_title")||"").trim(); if(!title){ toast("Scegli o scrivi il momento"); return; }
      const rawpl=($("#r_pl").value||"").trim(), pl=musicUrl(rawpl);
      if(rawpl && !pl) toast("Link ignorato: non è un URL http/https valido"); // salvo il momento senza il link
      const data={time:($("#r_time").value||"").trim(),title,who:(managedValue("r_who")||"").trim(),playlist:pl};
      const E=ev(); E.runshow=E.runshow||[];
      if(isNew){ E.runshow.push(Object.assign({id:"r"+Date.now()},data)); }
      else { const cur=E.runshow.find(x=>x.id===id); if(!cur){ toast("Momento non più presente (aggiornato da un altro dispositivo)"); return; } Object.assign(cur,data); }
      commit(isNew?"Momento aggiunto":"Momento aggiornato");
    }}]);
}
// Suggerimenti guidati per il run-of-show.
const RUNSHOW_SUGGEST=["Arrivo invitati","Cerimonia","Aperitivo","Ingresso sposi","Cena","Taglio torta","Primo ballo","Bouquet","Open bar","Dopocena / party","Saluti finali","Chiusura e navetta"];
// Link playlist per momento (Spotify, Apple Music, YouTube Music, Amazon, Deezer,
// o qualsiasi URL). Accetta SOLO http/https (niente javascript: o altro), e
// completa "spotify.com/..." aggiungendo https://. Vuoto se non valido.
function musicUrl(raw){
  let s=(raw||"").trim(); if(!s) return "";
  if(!/^[a-z][a-z0-9+.\-]*:\/\//i.test(s)){ if(/^[\w.\-]+\.[a-z]{2,}(\/|$)/i.test(s)) s="https://"+s; else return ""; }
  try{ const u=new URL(s); return (u.protocol==="http:"||u.protocol==="https:")?u.href:""; }catch(e){ return ""; }
}
// Etichetta breve del servizio, dal dominio del link.
function musicLabel(url){ try{ const h=new URL(url).hostname.replace(/^www\./,""); const m={"open.spotify.com":"Spotify","spotify.com":"Spotify","music.apple.com":"Apple Music","music.youtube.com":"YouTube Music","youtube.com":"YouTube","youtu.be":"YouTube","music.amazon.com":"Amazon Music","music.amazon.it":"Amazon Music","deezer.com":"Deezer","deezer.page.link":"Deezer"}; return m[h]||"Playlist"; }catch(e){ return "Playlist"; } }
function runShowWho(){ const s=new Set(); (ev().runshow||[]).forEach(r=>{ if(r.who) s.add(r.who); }); return Array.from(s); }
// Scaletta standard: aggiunge i momenti tipici mancanti con un orario suggerito.
function genRunShow(){
  const e=ev(); e.runshow=e.runshow||[];
  const std=[["16:00","Cerimonia","Officiante"],["17:30","Aperitivo","Catering"],["20:00","Cena","Catering"],["22:30","Taglio torta","Catering"],["23:00","Primo ballo","DJ"],["01:00","Chiusura e navetta","Navetta"]];
  const have=new Set(e.runshow.map(r=>(r.title||"").toLowerCase()));
  let n=0; std.forEach(s=>{ if(!have.has(s[1].toLowerCase())){ e.runshow.push({id:"r"+Date.now()+"_"+(n++),time:s[0],title:s[1],who:s[2]}); } });
  commit(n?("Aggiunti "+n+" momenti alla scaletta"):"Scaletta già completa");
}
function delRs(id){
  const r=ev().runshow.find(x=>x.id===id); if(!r) return;
  modal("Eliminare il momento?",`<p>Rimuovo <b>${esc(r.title)}</b>${r.time?" ("+esc(r.time)+")":""} dalla scaletta.</p>`,
    [{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{ ev().runshow=ev().runshow.filter(x=>x.id!==id); commit("Momento rimosso"); }}]);
}

/* ============ NOTE & LISTE ============ */
function viewLists(){
  const e=ev();
  const cards=e.lists.map(l=>`<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h3 data-inline="title" data-id="${l.id}" title="Doppio clic per rinominare" style="cursor:text">${esc(l.title)}</h3><button class="btn sm danger" data-act="delList" data-id="${l.id}">Elimina</button></div>
    <div style="margin:8px 0">${l.items.length?l.items.map((it,i)=>`<div style="padding:4px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px"><span data-inline="item" data-id="${l.id}" data-i="${i}" title="Doppio clic per modificare" style="cursor:text;flex:1">${esc(it)}</span><button class="btn sm danger" data-act="delItem" data-id="${l.id}" data-i="${i}" aria-label="Rimuovi">×</button></div>`).join(""):'<span class="muted">Vuota. Scrivi qui sotto e premi Invio per aggiungere.</span>'}</div>
    <div class="two" style="grid-template-columns:1fr auto"><input class="inp" id="li_${l.id}" placeholder="Aggiungi voce…"><button class="btn sm" data-act="addItem" data-id="${l.id}">+</button></div>
  </div>`).join("");
  return `
  <div class="btnbar"><button class="btn" data-act="addList">+ Lista</button></div>
  <div style="margin-top:12px">${cards||'<div class="placeholder"><div class="ic">&#9776;</div><p>Nessuna lista.</p></div>'}</div>
  `;
}
function addList(){
  modal("Nuova lista",`<div class="field"><label>Titolo</label><input class="inp" id="nl_t" placeholder="Es. Lista regali testimoni"></div>`,
   [{label:"Annulla"},{label:"Crea",cls:"",fn:()=>{ const t=$("#nl_t").value.trim(); if(!t) return; ev().lists.push({id:"l"+Date.now(),title:t,items:[]}); commit("Lista creata"); }}]);
}
function delList(id){ const l=ev().lists.find(x=>x.id===id); if(!l) return; modal("Eliminare la lista?",`<p>Rimuovo <b>${esc(l.title)}</b> e le sue voci.</p>`,[{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{ ev().lists=ev().lists.filter(x=>x.id!==id); commit("Lista eliminata"); }}]); }
function addItem(id){ const l=ev().lists.find(x=>x.id===id); if(!l) return; const inp=document.getElementById("li_"+id); const val=inp?inp.value.trim():""; if(!val) return; l.items.push(val); commit("Voce aggiunta"); }
function delItem(id,i){ const l=ev().lists.find(x=>x.id===id); if(l){ l.items.splice(+i,1); commit("Voce rimossa"); } }

/* ============ STRUMENTI ORIGINALI (embed via iframe, lazy) ============ */
/* ============ PLACEHOLDER (stadi successivi) ============ */
const STAGE={vendors:"S4 — CRM fornitori: inserimento e confronto preventivi; l'aggiornamento dal web e' attivo solo nella versione integrata in Claude.ai.",
  seating:"S3 — inglobamento del Tableau esistente, con gli ospiti letti da questa sorgente unica.",
  floor:"S3/S5 — planimetria e flussi dall'ingresso unico.",
  aperitivo:"S5 — inglobamento del simulatore Monte Carlo, rivestito con questo shell.",
  timeline:"S6 — checklist a ritroso dal 03/07/2027 e run-of-show con viste filtrate.",
  lists:"S6 — liste templater (musica, processione, foto, packing)."};
function viewPlaceholder(k){
  const name=(TABS.find(t=>t[0]===k)||["",k])[1];
  return `<div class="placeholder"><div class="ic">✦</div><h2 class="serif" style="font-size:30px;margin-bottom:6px">${esc(name)}</h2><p style="max-width:420px">${esc(STAGE[k]||"In arrivo nei prossimi stadi del workflow.")}</p></div>`;
}

/* ============ EDIT FORMS ============ */
function editBudget(id){
  const b=ev().budget.find(x=>x.id===id); if(!b) return;
  modal("Modifica voce",
    `<div class="field"><label>Voce</label><input class="inp" id="f_item" value="${esc(b.item)}"></div>
     <div class="two">
       <div class="field"><label>Preventivo (€)</label><input class="inp" type="number" id="f_quote" value="${b.quote||0}"></div>
       <div class="field"><label>Effettivo (€)</label><input class="inp" type="number" id="f_act" value="${b.actual||0}"></div>
     </div>
     <div class="field"><label>Stato</label><select class="inp" id="f_paid"><option value="0"${!b.paid?" selected":""}>Da pagare</option><option value="1"${b.paid?" selected":""}>Pagata</option></select></div>`,
    [{label:"Annulla"},
     // setTimeout: la conferma va aperta DOPO che close() ha svuotato #modalRoot.
     {label:"Elimina",cls:"danger",fn:()=>{ setTimeout(()=>delBudget(id),0); }},
     {label:"Salva",cls:"",fn:()=>{
      // ri-risolvi per id: lo stato puo' essere stato sostituito (sync) mentre la modale era aperta
      const cur=ev().budget.find(x=>x.id===id);
      if(!cur){ toast("Voce non più presente (aggiornata da un altro dispositivo)"); return; }
      cur.item=$("#f_item").value.trim()||cur.item;
      cur.quote=+$("#f_quote").value||0; cur.actual=+$("#f_act").value||0; cur.paid=$("#f_paid").value==="1";
      commit("Voce aggiornata");
    }}]);
}
function delBudget(id){
  const e=ev(), b=(e.budget||[]).find(x=>x.id===id); if(!b) return;
  const amt=(+b.actual||0)||(+b.quote||0);
  modal("Eliminare la voce?",`<p>Rimuovo <b>${esc(b.item)}</b>${amt?" ("+money(amt)+")":""} dal budget. L'azione non è reversibile.</p>`,
    [{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{
      const E=ev(); // stato fresco: non quello catturato all'apertura
      E.budget=E.budget.filter(x=>x.id!==id);
      (E.vendors||[]).forEach(v=>{ if(v.budgetLineId===id) v.budgetLineId=null; });
      commit("Voce eliminata");
    }}]);
}
function addBudget(){
  modal("Nuova voce",
    `<div class="field"><label>Voce</label><input class="inp" id="n_item" placeholder="Es. Noleggio lounge"></div>
     <div class="two"><div class="field"><label>Tier</label><select class="inp" id="n_tier">${[1,2,3,4,5].map(t=>`<option value="${t}">${TIER[t]}</option>`).join("")}</select></div>
     <div class="field"><label>Preventivo (€)</label><input class="inp" type="number" id="n_est" value="0"></div></div>`,
    [{label:"Annulla"},{label:"Aggiungi",cls:"",fn:()=>{
      const item=$("#n_item").value.trim(); if(!item) return;
      ev().budget.push({id:"b"+Date.now(),tier:+$("#n_tier").value,item,estimated:0,quote:+$("#n_est").value||0,actual:0,costType:"fixed",perHead:0,vendorId:null,dueDate:null,paid:false});
      commit("Voce aggiunta");
    }}]);
}
/* ---- Pagamenti / rate: CRUD + collegamento fornitore ---- */
function pmVendorName(id){ if(!id) return ""; const v=(ev().vendors||[]).find(x=>x.id===id); return v?v.name:""; }
const PM_METHODS=["Bonifico","Contanti","Carta","Assegno","Altro"];
function editPayment(id){
  const e=ev(); e.payments=e.payments||[];
  const p=id?e.payments.find(x=>x.id===id):null, isNew=!p;
  const x=p||{label:"",amount:0,dueDate:"",method:"Bonifico",vendorId:null,paid:false};
  const vopts='<option value="">— nessuno —</option>'+(e.vendors||[]).map(v=>`<option value="${esc(v.id)}"${x.vendorId===v.id?" selected":""}>${esc(v.name)}</option>`).join("");
  modal(isNew?"Nuova rata":"Modifica rata",
    `<div class="field"><label>Descrizione</label><input class="inp" id="pm_label" value="${esc(x.label||"")}" placeholder="Es. Acconto catering"></div>
     <div class="two">
       <div class="field"><label>Importo (€)</label><input class="inp" type="number" id="pm_amount" value="${x.amount||0}" min="0"></div>
       <div class="field"><label>Scadenza</label><input class="inp" type="date" id="pm_due" value="${esc(x.dueDate||"")}"></div>
     </div>
     <div class="two">
       <div class="field"><label>Metodo</label><select class="inp" id="pm_method">${PM_METHODS.map(mt=>`<option${x.method===mt?" selected":""}>${mt}</option>`).join("")}</select></div>
       <div class="field"><label>Fornitore</label><select class="inp" id="pm_vendor">${vopts}</select></div>
     </div>
     <div class="field"><label>Stato</label><select class="inp" id="pm_paid"><option value="0"${!x.paid?" selected":""}>Da pagare</option><option value="1"${x.paid?" selected":""}>Pagata</option></select></div>`,
    [{label:"Annulla"},{label:isNew?"Aggiungi":"Salva",cls:"",fn:()=>{
       const data={label:($("#pm_label").value||"").trim()||"Rata", amount:+$("#pm_amount").value||0, dueDate:($("#pm_due").value||"").trim(), method:$("#pm_method").value, vendorId:$("#pm_vendor").value||null, paid:$("#pm_paid").value==="1"};
       const E=ev(); E.payments=E.payments||[];
      if(isNew){ E.payments.push(Object.assign({id:"p"+Date.now()},data)); }
      else { const cur=E.payments.find(x=>x.id===id); if(!cur){ toast("Rata non più presente (aggiornata da un altro dispositivo)"); return; } Object.assign(cur,data); }
       commit(isNew?"Rata aggiunta":"Rata aggiornata");
    }}]);
}
function delPayment(id){
  const e=ev(); const p=(e.payments||[]).find(x=>x.id===id); if(!p) return;
  modal("Eliminare la rata?",`<p>Rimuovo <b>${esc(p.label)}</b> (${money(p.amount)}).</p>`,
    [{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{ const E=ev(); E.payments=(E.payments||[]).filter(x=>x.id!==id); commit("Rata eliminata"); }}]);
}
/* ============ IMPORT GUIDATO LISTE (motore nativo, E1) ============ */
function impNorm(s){ return String(s==null?'':s).toLowerCase().trim().replace(/[àáâ]/g,'a').replace(/[èéê]/g,'e').replace(/[ìí]/g,'i').replace(/[òóô]/g,'o').replace(/[ùú]/g,'u').replace(/\s+/g,' '); }
function impDelim(text){
  // Un separatore vale solo se compare nella MAGGIORANZA delle righe: una lista
  // di soli nomi con qualche virgola occasionale ("Rossi, quello di Milano")
  // deve restare a 1 colonna, non troncare i nomi alla virgola.
  const lines=String(text).split(/\r?\n/).filter(l=>l.trim()!=='').slice(0,200);
  if(!lines.length) return ',';
  const has=(l,d)=>{ let q=false; for(const ch of l){ if(ch==='"') q=!q; else if(!q&&ch===d) return true; } return false; };
  let best=',', bestFrac=0;
  for(const d of ['\t',';',',']){ const f=lines.filter(l=>has(l,d)).length/lines.length; if(f>bestFrac){ bestFrac=f; best=d; } }
  return bestFrac>=0.5 ? best : '\u0000'; // sentinella mai presente nel testo -> nessuno split (1 colonna)
}
function impSplitRows(text){
  const delim=impDelim(text);
  const s=String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const rows=[]; let row=[],cell='',q=false;
  for(let i=0;i<s.length;i++){ const ch=s[i];
    if(q){ if(ch==='"'){ if(s[i+1]==='"'){ cell+='"'; i++; } else q=false; } else cell+=ch; }
    else { if(ch==='"') q=true;
      else if(ch===delim){ row.push(cell); cell=''; }
      else if(ch==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
      else cell+=ch; }
  }
  row.push(cell); rows.push(row);
  const clean=rows.filter(r=>r.some(c=>String(c).trim()!==''));
  return {rows:clean, delim:delim};
}
const IMP_SYN={
  name:['nome','name','ospite','invitato','nominativo','nome e cognome','cognome e nome','nome cognome'],
  side:['lato','side','parte','sposo','sposa','famiglia di'],
  household:['nucleo','household','famiglia','gruppo','tavolo'],
  rsvp:['rsvp','conferma','stato','presenza','partecipa','risposta','conferma presenza','presente'],
  meal:['pasto','menu','meal','pietanza','tipo pasto','tipo menu','menu scelto'],
  intolerances:['intolleranze','allergie','intolleranza','allergia','dieta','note alimentari','alimentari'],
  plusOne:['+1','accompagnatori','accompagnatore','plus','plusone','plus one','acc','accomp'],
  shuttle:['navetta','shuttle','bus','pullman'],
  accessibility:['accessibilita','accessibility','esigenze','seggiolone','disabili','note accessibilita']
};
const IMP_FIELDS=['name','side','household','rsvp','meal','intolerances','plusOne','shuttle','accessibility'];
function impAutoMap(header){
  const map={}, used=new Set(), cells=(header||[]).map(impNorm);
  for(const field of IMP_FIELDS){ const syn=IMP_SYN[field]; let found=-1;
    for(let i=0;i<cells.length;i++){ if(used.has(i))continue; if(syn.some(k=>cells[i]===k)){ found=i; break; } }
    if(found<0) for(let i=0;i<cells.length;i++){ if(used.has(i))continue; if(syn.some(k=>cells[i].includes(k))){ found=i; break; } }
    if(found>=0){ map[field]=found; used.add(found); }
  }
  return map;
}
function impGuessHeader(rows){ if(!rows||!rows.length) return false; return Object.keys(impAutoMap(rows[0])).length>=1; }
function impRsvp(v){ const n=impNorm(v);
  if(['si','s','yes','y','ok','confermato','conferma','presente','partecipa','1','true','x','vero','viene'].includes(n)) return 'conf';
  if(['no','n','declina','assente','non viene','non partecipa','0','false','rifiuta','nv'].includes(n)) return 'no';
  return 'attesa';
}
function impPtype(v){ const n=impNorm(v);
  return ['bambino','bimbo','bimba','child','kid','baby','bambini','ridotto'].includes(n)?'bambino':'adulto'; }
function impMeal(v){ const n=impNorm(v);
  if(['bambino','bimbo','bimba','child','kid','baby','bambini','ridotto'].includes(n)) return 'normale';
  if(['vegetariano','vegetariana','veg','vegetarian'].includes(n)) return 'vegetariano';
  if(['vegano','vegana','vegan'].includes(n)) return 'vegano';
  if(['celiaco','celiaca','senza glutine','gluten free','gf','sg','no glutine'].includes(n)) return 'celiaco';
  return 'normale'; // adulto/vuoto/sconosciuto: menu standard (il tipo persona lo decide impPtype)
}
function impBool(v){ const n=impNorm(v); return ['si','s','yes','y','1','true','x','vero','navetta'].includes(n); }
function impPlus(v){ const n=impNorm(v); const num=parseInt(n,10); if(!isNaN(num)) return Math.max(0,num); if(['si','s','yes','y','x'].includes(n)) return 1; return 0; }
function impSide(v,coupleA,coupleB){ const n=impNorm(v), a=impNorm(coupleA), b=impNorm(coupleB);
  if(n===b||['b','sposa','bride','lei'].includes(n)||(b&&n.includes(b))) return 'B';
  if(n===a||['a','sposo','groom','lui'].includes(n)||(a&&n.includes(a))) return 'A';
  return 'A';
}
function impRowsToGuests(rows, mapping, hasHeader, opts){
  opts=opts||{}; const cA=opts.coupleA||'A', cB=opts.coupleB||'B';
  const data=hasHeader?rows.slice(1):rows;
  const get=(r,f)=> (mapping[f]!=null && r[mapping[f]]!=null) ? String(r[mapping[f]]).trim() : '';
  const out=[];
  for(const r of data){
    const name = mapping.name!=null ? get(r,'name') : (r[0]!=null?String(r[0]).trim():'');
    if(!name) continue;
    out.push({
      name:name,
      side: mapping.side!=null ? impSide(get(r,'side'),cA,cB) : 'A',
      household: (mapping.household!=null && get(r,'household')) ? get(r,'household') : 'Senza nucleo',
      rsvp: mapping.rsvp!=null ? impRsvp(get(r,'rsvp')) : 'attesa',
      meal: mapping.meal!=null ? impMeal(get(r,'meal')) : 'normale',
      ptype: mapping.meal!=null ? impPtype(get(r,'meal')) : 'adulto',
      intolerances: mapping.intolerances!=null ? get(r,'intolerances') : '',
      accessibility: mapping.accessibility!=null ? get(r,'accessibility') : '',
      shuttle: mapping.shuttle!=null ? impBool(get(r,'shuttle')) : false,
      plusOne: mapping.plusOne!=null ? impPlus(get(r,'plusOne')) : 0
    });
  }
  return out;
}
function impDedupe(candidates, existing){
  const ex=new Set((existing||[]).map(g=>impNorm(g.name))), seen=new Set(), toAdd=[], dups=[];
  candidates.forEach((c,i)=>{ const k=impNorm(c.name);
    if(ex.has(k)) dups.push({name:c.name,index:i,reason:'già presente'});
    else if(seen.has(k)) dups.push({name:c.name,index:i,reason:'ripetuto nel file'});
    else { seen.add(k); toAdd.push(c); }
  });
  return {toAdd:toAdd, dups:dups};
}
function buildImportPlan(text, opts){
  opts=opts||{};
  const parsed=impSplitRows(text);
  const hasHeader=(opts.hasHeader!=null)?opts.hasHeader:impGuessHeader(parsed.rows);
  const mapping=opts.mapping || (hasHeader?impAutoMap(parsed.rows[0]):{});
  const candidates=impRowsToGuests(parsed.rows, mapping, hasHeader, opts);
  const dd=impDedupe(candidates, opts.existing||[]);
  return {delim:parsed.delim, rows:parsed.rows, hasHeader:hasHeader, mapping:mapping, candidates:candidates, toAdd:dd.toAdd, dups:dd.dups};
}
function impNewGuests(toAdd){ const base=Date.now(); return toAdd.map((c,i)=>Object.assign({id:'g'+base+'_'+i, gift:'', thanked:false}, c)); }

function importWizard(){
  const cA=meta().coupleA, cB=meta().coupleB;
  const FLD=[['name','Nome'],['side','Lato'],['household','Nucleo'],['rsvp','RSVP'],['meal','Menù'],['intolerances','Intolleranze'],['plusOne','Accompagnatori'],['shuttle','Navetta'],['accessibility','Accessibilità']];
  let mapOverride=null, plan=null;
  const body=`
    <div class="field"><label>Incolla da Excel, Google Sheets o CSV</label>
      <textarea class="inp" id="imp_text" rows="6" placeholder="Nome;Lato;RSVP;Menù&#10;Mario Rossi;Righi;Sì;Adulto&#10;Lucia Bianchi;Biondi;Forse;Bambino"></textarea></div>
    <div class="two">
      <div class="field"><label>oppure carica un file (.csv .txt)</label><input class="inp" type="file" id="imp_file" accept=".csv,.txt,text/csv,text/plain"></div>
      <div class="field"><label>Prima riga è intestazione</label><select class="inp" id="imp_head"><option value="auto">Rileva automaticamente</option><option value="yes">Sì</option><option value="no">No</option></select></div>
    </div>
    <div class="btnbar"><button class="btn" id="imp_go">Analizza</button></div>
    <div id="imp_prev" style="margin-top:12px"><div class="muted">Incolla i dati o carica un file, poi premi Analizza. Basta una colonna con i nomi; le altre sono opzionali e le mappi dopo.</div></div>
  `;
  modal("Importa ospiti", body, [{label:"Chiudi"}]);
  const T=()=>($("#imp_text").value||""), headOpt=()=>{ const v=$("#imp_head").value; return v==="yes"?true:(v==="no"?false:null); };
  $("#imp_file").addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; if(!f)return; const rd=new FileReader(); rd.onload=()=>{ $("#imp_text").value=String(rd.result||""); analyze(); }; rd.readAsText(f); });
  $("#imp_go").addEventListener("click",analyze);
  $("#imp_head").addEventListener("change",()=>{ mapOverride=null; analyze(); });
  function build(){ return buildImportPlan(T().trim(),{coupleA:cA,coupleB:cB,existing:ev().guests,hasHeader:headOpt(),mapping:mapOverride||undefined}); }
  function analyze(){ const prev=$("#imp_prev"); if(!T().trim()){ prev.innerHTML='<div class="muted">Incolla i dati o carica un file, poi premi Analizza.</div>'; return; } plan=build(); drawPrev(); }
  function colLabel(i){ const h=plan.hasHeader?plan.rows[0]:null; const t=(h&&h[i]!=null)?String(h[i]).trim():""; return t||("Colonna "+(i+1)); }
  function drawPrev(){
    const prev=$("#imp_prev"); let ncols=0; plan.rows.forEach(r=>{ if(r.length>ncols)ncols=r.length; });
    const maps=FLD.map(function(fl){ const f=fl[0], lab=fl[1]; const cur=(plan.mapping[f]!=null)?plan.mapping[f]:(f==='name'?0:-1);
      let opts='<option value="-1"'+(cur===-1?' selected':'')+'>— nessuna —</option>';
      for(let i=0;i<ncols;i++){ opts+='<option value="'+i+'"'+(cur===i?' selected':'')+'>'+esc(colLabel(i))+'</option>'; }
      return '<div class="field"><label>'+lab+(f==='name'?' (obbligatorio)':'')+'</label><select class="inp imp_map" data-f="'+f+'">'+opts+'</select></div>';
    }).join("");
    const dataRows=plan.hasHeader?plan.rows.slice(1):plan.rows;
    let head='<tr>'; for(let i=0;i<ncols;i++) head+='<th>'+esc(colLabel(i))+'</th>'; head+='</tr>';
    const prevRows=dataRows.slice(0,6).map(function(r){ let s='<tr>'; for(let i=0;i<ncols;i++) s+='<td>'+esc(r[i]!=null?r[i]:"")+'</td>'; return s+'</tr>'; }).join("");
    const dupList=plan.dups.slice(0,12).map(d=>'<li>'+esc(d.name)+' <span class="muted">· '+d.reason+'</span></li>').join("");
    const more=plan.dups.length>12?'<li class="muted">…e altri '+(plan.dups.length-12)+'</li>':"";
    const n=plan.toAdd.length, delimTxt=(plan.delim==='\t'?'tab':plan.delim);
    prev.innerHTML=
      '<div class="sec-title"><h2>Mappatura colonne</h2><span class="muted">separatore: '+delimTxt+'</span></div>'+
      '<div class="two">'+maps+'</div>'+
      '<div class="sec-title"><h2>Anteprima</h2></div>'+
      '<div style="overflow:auto"><table class="tbl">'+head+prevRows+'</table></div>'+
      '<div class="card" style="margin-top:10px"><span class="pill '+(n>0?'ok':'warn')+'">'+n+' nuovi</span> '+(plan.dups.length?'<span class="pill warn">'+plan.dups.length+' duplicati saltati</span>':'')+(dupList?'<ul style="margin:8px 0 0 18px">'+dupList+more+'</ul>':'')+'</div>'+
      '<div class="btnbar"><button class="btn" id="imp_add"'+(n>0?'':' disabled')+'>Aggiungi '+n+' ospiti</button></div>';
    Array.prototype.forEach.call(document.querySelectorAll(".imp_map"),sel=>sel.addEventListener("change",onMap));
    const add=$("#imp_add"); if(add) add.addEventListener("click",doAdd);
  }
  function onMap(){ const m={}; Array.prototype.forEach.call(document.querySelectorAll(".imp_map"),sel=>{ const v=+sel.value; if(v>=0) m[sel.getAttribute("data-f")]=v; }); mapOverride=m; plan=build(); drawPrev(); }
  function doAdd(){ if(!plan||!plan.toAdd.length)return; const n=plan.toAdd.length; ev().guests=ev().guests.concat(impNewGuests(plan.toAdd)); $("#modalRoot").innerHTML=""; commit("Importati "+n+" ospiti"); toast(n+" ospiti importati"); }
}

/* ---- Categorizzazione ospiti a tendina (valori gestiti, estensibili) ---- */
const GUEST_GROUPS_DEF=["Famiglia sposo","Famiglia sposa","Parenti","Amici","Colleghi","Compagni di scuola","Vicini","Altro"];
function guestHouseholds(){ const s=new Set(); (ev().guests||[]).forEach(g=>{ if(g.household&&g.household!=="Senza nucleo") s.add(g.household); }); return Array.from(s).sort(); }
function guestGroups(){ const s=new Set(); GUEST_GROUPS_DEF.forEach(x=>s.add(x)); (ev().guests||[]).forEach(g=>{ if(g.group) s.add(g.group); }); return Array.from(s); }
// Select con valori esistenti + "+ Nuovo…" (mostra un campo testo). Niente più testo libero
// per i campi che alimentano l'ottimizzatore: valori coerenti = raggruppamenti corretti.
function managedSelect(id, current, options){
  const opts=options.slice(); if(current && current!=="__new__" && opts.indexOf(current)<0) opts.unshift(current);
  const optHtml=opts.map(o=>`<option value="${esc(o)}"${o===current?" selected":""}>${o===""?"— nessuno —":esc(o)}</option>`).join("");
  return `<select class="inp" id="${id}" data-managed>${optHtml}<option value="__new__">+ Nuovo…</option></select>`
    +`<input class="inp" id="${id}_new" placeholder="Scrivi il nuovo valore" style="display:none;margin-top:6px">`;
}
function managedValue(id){ const sel=$("#"+id); if(!sel) return ""; if(sel.value==="__new__"){ const t=$("#"+id+"_new"); return t?(t.value||"").trim():""; } return sel.value; }
// Campi attributi per ospite (G2): una tendina per ogni variabile attiva.
function seatGuestAttrFields(x){
  const vars=seatActiveVars(); if(!vars.length) return "";
  const attr=x.attr||{};
  const rows=vars.map(v=>`<div class="field"><label>${esc(v.name)}</label><select class="inp" data-gattr="${v.id}">${v.values.map(val=>`<option value="${esc(val)}"${(attr[v.id]||"")===val?" selected":""}>${val===""?"—":esc(val)}</option>`).join("")}</select></div>`).join("");
  return `<details style="margin-top:6px"><summary class="muted" style="cursor:pointer">Caratteristiche per i tavoli (${vars.length})</summary><div class="two" style="margin-top:6px">${rows}</div></details>`;
}
function seatReadAttrFields(prev){
  const attr=Object.assign({}, prev||{});
  document.querySelectorAll("[data-gattr]").forEach(sel=>{ const k=sel.getAttribute("data-gattr"); if(sel.value) attr[k]=sel.value; else delete attr[k]; });
  return attr;
}
function editGuest(id){
  const g=ev().guests.find(x=>x.id===id); const isNew=!g;
  const x=g||{name:"",side:"A",household:"",group:"",rsvp:"attesa",ptype:"adulto",meal:"normale",intolerances:"",accessibility:"",shuttle:false,plusOne:0};
  modal(isNew?"Nuovo ospite":"Modifica ospite",
    `<div class="field"><label>Nome</label><input class="inp" id="g_name" value="${esc(x.name)}"></div>
     <div class="two">
       <div class="field"><label>Lato</label><select class="inp" id="g_side"><option value="A"${x.side==="A"?" selected":""}>${meta().coupleA}</option><option value="B"${x.side==="B"?" selected":""}>${meta().coupleB}</option></select></div>
       <div class="field"><label>Nucleo</label>${managedSelect("g_hh", x.household||"Senza nucleo", ["Senza nucleo"].concat(guestHouseholds()))}</div>
     </div>
     <div class="field"><label>Gruppo <span class="muted" style="font-size:11px">(l'ottimizzatore tiene vicini chi è dello stesso gruppo)</span></label>${managedSelect("g_group", x.group||"", [""].concat(guestGroups()))}</div>
     <div class="two">
       <div class="field"><label>RSVP</label><select class="inp" id="g_rsvp">${Object.keys(RSVP).map(k=>`<option value="${k}"${x.rsvp===k?" selected":""}>${RSVP[k][1]}</option>`).join("")}</select></div>
       <div class="field"><label>Menù</label><select class="inp" id="g_meal">${MEALS.map(m=>`<option value="${m}"${(x.meal||"normale")===m?" selected":""}>${m}</option>`).join("")}</select></div>\n     </div>\n     <div class="two">\n       <div class="field"><label>Tipo persona</label><select class="inp" id="g_ptype">${PTYPES.map(p=>`<option value="${p}"${(x.ptype||"adulto")===p?" selected":""}>${p}</option>`).join("")}</select></div>
     </div>
     <div class="two">
       <div class="field"><label>Intolleranze</label><input class="inp" id="g_int" value="${esc(x.intolerances)}"></div>
       <div class="field"><label>Accompagnatori (+)</label><input class="inp" type="number" id="g_plus" value="${x.plusOne||0}" min="0"></div>
     </div>
     <div class="two">
       <div class="field"><label>Accessibilità</label><input class="inp" id="g_acc" value="${esc(x.accessibility)}" placeholder="Seggiolone, disabili…"></div>
       <div class="field"><label>Navetta</label><select class="inp" id="g_sh"><option value="0"${!x.shuttle?" selected":""}>No</option><option value="1"${x.shuttle?" selected":""}>Sì</option></select></div>
     </div>
     ${seatGuestAttrFields(x)}`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const name=$("#g_name").value.trim(); if(!name) return;
      const data={name,side:$("#g_side").value,household:managedValue("g_hh")||"Senza nucleo",group:managedValue("g_group"),rsvp:$("#g_rsvp").value,ptype:$("#g_ptype").value,meal:$("#g_meal").value,intolerances:$("#g_int").value.trim(),accessibility:$("#g_acc").value.trim(),shuttle:$("#g_sh").value==="1",plusOne:+$("#g_plus").value||0,attr:seatReadAttrFields(x.attr)};
      if(isNew){ ev().guests.push(Object.assign({id:"g"+Date.now(),gift:"",thanked:false},data)); }
      else { const cur=ev().guests.find(x=>x.id===id); if(!cur){ toast("Ospite non più presente (aggiornato da un altro dispositivo)"); return; } Object.assign(cur,data); }
      commit(isNew?"Ospite aggiunto":"Ospite aggiornato");
    }}]);
}
function delGuest(id){
  const g=ev().guests.find(x=>x.id===id); if(!g) return;
  modal("Eliminare l'ospite?",`<p>Stai per rimuovere <b>${esc(g.name)}</b>. L'azione non è reversibile.</p>`,
    [{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{
      const e=ev();
      // Integrità: rimuovi ogni riferimento all'ospite (posti a tavola + vicinanze),
      // altrimenti resta un posto "fantasma" occupato da un id morto e regole orfane.
      e.seating=e.seating||{rules:[]};
      e.seating.rules=seatPurgeGuest(e.tables, e.seating.rules||[], id);
      e.guests=e.guests.filter(x=>x.id!==id); commit("Ospite eliminato");
    }}]);
}

/* ============ EVENT MENU (nuovo/reset/clona/export/import con guardrail) ============ */
// Editor intestazione: nomi (= lati A/B), location, indirizzo, data. Modificabile.
function editEventHeader(){
  const m=meta();
  modal("Intestazione e data",
    `<div class="two">
       <div class="field"><label>Nome 1 <span class="muted" style="font-size:11px">(lato A)</span></label><input class="inp" id="ev_a" value="${esc(m.coupleA||"")}"></div>
       <div class="field"><label>Nome 2 <span class="muted" style="font-size:11px">(lato B)</span></label><input class="inp" id="ev_b" value="${esc(m.coupleB||"")}"></div>
     </div>
     <div class="field"><label>Location <span class="muted" style="font-size:11px">(vuota se non definita)</span></label><input class="inp" id="ev_venue" value="${esc(m.venue||"")}" placeholder="Es. Borgo Fregnano"></div>
     <div class="field"><label>Indirizzo location <span class="muted" style="font-size:11px">(opzionale)</span></label><input class="inp" id="ev_addr" value="${esc(m.venueAddr||"")}"></div>
     <div class="field"><label>Data</label><input class="inp" type="date" id="ev_date" value="${esc(m.date||"")}"></div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
       m.coupleA=($("#ev_a").value||"").trim()||"Sposo";
       m.coupleB=($("#ev_b").value||"").trim()||"Sposa";
       m.venue=($("#ev_venue").value||"").trim();
       m.venueAddr=($("#ev_addr").value||"").trim();
       const d=($("#ev_date").value||"").trim(); if(d) m.date=d;
       commit("Intestazione aggiornata");
    }}]);
}
function exportEvent(){
  const blob=new Blob([JSON.stringify(STATE,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download="hub_nozze_"+meta().coupleA+"_"+meta().coupleB+".json"; a.click();
  toast("Evento esportato");
}
function importEvent(){
  const inp=document.createElement("input"); inp.type="file"; inp.accept="application/json";
  inp.onchange=()=>{ const f=inp.files[0]; if(!f) return; const r=new FileReader();
    r.onload=()=>{ try{ const s=JSON.parse(r.result); if(s&&s.events){ STATE=s; commit("Evento importato"); } else toast("File non valido"); }catch(e){ toast("File non valido"); } };
    r.readAsText(f); };
  inp.click();
}
function resetEvent(){
  modal("Reset evento",
    `<p>Il reset riporta l'evento ai dati seed e cancella le tue modifiche. Per sicurezza esporta prima un backup.</p>`,
    [{label:"Esporta prima",cls:"ghost",fn:()=>exportEvent(),close:false},
     {label:"Reset comunque",cls:"danger",fn:()=>{ STATE=seedState(); commit("Evento ripristinato al seed"); }}]);
}
function newEvent(){
  modal("Nuovo evento vuoto",
    `<p>Crea un evento generico vuoto (motore riutilizzabile). Esporta prima l'evento attuale se vuoi conservarlo.</p>`,
    [{label:"Esporta attuale",cls:"ghost",fn:()=>exportEvent(),close:false},
     {label:"Crea vuoto",cls:"",fn:()=>{
        const s=seedState(); const e=s.events.rb27;
        // Svuotamento COMPLETO: il seed riempie anche vendors/tasks/lists/tables/
        // sim/seating, che prima restavano e rendevano l'evento solo parzialmente
        // vuoto (handoff 8.1). Azzerati tutti i dati specifici dell'evento.
        e.budget.forEach(b=>{b.quote=0;b.actual=0;b.paid=false;}); e.guests=[]; e.payments=[];
        e.vendors=[]; e.tasks=[]; e.lists=[]; e.tables=[]; e.runshow=[];
        e.sim.scenarios=[]; e.seating.rules=[];
        // Una stazione generica di default invece delle 4 specifiche del seed,
        // cosi' il simulatore parte usabile ma non eredita dati altrui.
        e.sim.stations=[{id:1,name:"Bar / Bere",service:25,pop:1.5,servers:3,welcome:true,lines:1,color:"#2563eb"}];
        e.sim.seq=1;
        e.meta.coupleA="Sposo"; e.meta.coupleB="Sposa"; e.meta.groom=""; e.meta.venue="Location";
        e.meta.contacts=[]; STATE=s; commit("Nuovo evento creato");
     }}]);
}
function openGear(){
  modal("Gestione evento",
    `<p class="muted" style="margin-bottom:10px">Motore generico: un evento attivo, riutilizzabile e portabile.<br>Versione app: <b>${esc(APP_BUILD)}</b></p>`,
    [{label:"Intestazione e data",cls:"ghost",fn:()=>{editEventHeader();},close:false},
     {label:"Esporta",cls:"ghost",fn:()=>exportEvent(),close:false},
     {label:"Importa",cls:"ghost",fn:()=>{importEvent();},},
     {label:"Guida",cls:"ghost",fn:()=>{openGuide(0);},close:false},
     {label:"Account e sync",cls:"ghost",fn:()=>{openAccount();},close:false},
     {label:"Diagnostica",cls:"ghost",fn:()=>{openDiag();},close:false},
     {label:"Privacy e dati",cls:"ghost",fn:()=>{openPrivacy();},close:false},
     {label:"Abbonamento",cls:"ghost",fn:()=>{openBilling();},close:false},
     {label:"Lingua (IT/EN)",cls:"ghost",fn:()=>{toggleLang();}},
     {label:"Nuovo evento vuoto",cls:"ghost",fn:()=>{newEvent();},close:false},
     {label:"Reset al seed",cls:"danger",fn:()=>{resetEvent();},close:false}]);
}

/* ============ GUIDA / ONBOARDING (D) ============ */
// Tour guidato di tutte le schede: il modale resta aperto mentre sotto cambia la
// scheda reale (il modale vive in #modalRoot e sopravvive a render()).
const GUIDE=[
  { tab:"dash", title:"Benvenuto", body:`<p>Questo è l'hub unico per organizzare le nozze: un solo file, funziona offline e si salva da solo sul dispositivo. Si condivide aprendolo in Safari e poi "Aggiungi a Home".</p><p>Ti accompagno per le 8 schede. Usa Avanti e Indietro; puoi riaprire questa guida quando vuoi dall'ingranaggio in alto a destra.</p>` },
  { tab:"dash", title:"Dashboard", body:`<p>La panoramica: giorni mancanti, stato del budget, conferme degli ospiti, attività in scadenza. È il punto da cui controllare a colpo d'occhio se qualcosa è indietro.</p>` },
  { tab:"budget", title:"Budget & Finanze", body:`<p>Le voci di spesa con stima, preventivo e pagamenti. Collega una voce a un fornitore: quando il fornitore è confermato, il preventivo aggiorna la voce.</p><p>Aggiungi voci con + e registra le rate per tenere i pagamenti sotto controllo.</p>` },
  { tab:"guests", title:"Ospiti & RSVP", body:`<p>La sorgente unica degli invitati: nome, lato (sposo A / sposa B), nucleo, gruppo (con pallino colorato), RSVP, pasto, intolleranze, accessibilità, navetta, +1.</p><p>Scorciatoie: clicca la pill RSVP per cambiare stato in un tocco (Confermato → In attesa → Non viene); filtra con i bottoni o cerca per nome; "Esporta CSV" scarica la lista per il catering.</p><p>Hai già una lista? Usa Importa: incolli o carichi un CSV/TSV, l'app riconosce le colonne, toglie i doppioni e unisce.</p>` },
  { tab:"vendors", title:"Fornitori", body:`<p>Il piccolo CRM dei fornitori con i loro stati (da valutazione a confermato) e i preventivi. Un fornitore "Confermato" spunta automaticamente il task collegato nella Timeline, e mostra lì il suo nome.</p>` },
  { tab:"seating", title:"Tavoli", body:`<p>Planimetria nativa. Crea i tavoli con + Tavolo (forma e posti), poi la via più semplice è <b>Genera (guidato)</b>: 4 passi — scegli le caratteristiche che contano (nucleo, età, lingua… con pesi), compilale in blocco, aggiungi eventuali vincoli "insieme/lontani", genera. Se il risultato non piace, Annulla lo ripristina.</p><p>Ritocchi a mano: tocca un posto e scegli dall'elenco, o trascina un nome dalla "Riserva ospiti"; trascina un tavolo per spostarlo; zoom +/− per ingrandire. "Nomi tema" battezza i tavoli (fiori, città…), "Stampa" produce il tableau da esporre.</p>` },
  { tab:"aperitivo", title:"Aperitivo", body:`<p>Il simulatore delle code dell'aperitivo: imposta stazioni, personale e tempi di arrivo, e vedi attese e code stimate. Salva più scenari e confrontali per decidere quanti camerieri servono.</p>` },
  { tab:"timeline", title:"Timeline", body:`<p>La checklist a ritroso dalla data delle nozze e la scaletta del giorno (run-of-show). I task legati a una categoria di fornitore si spuntano da soli quando quel fornitore è confermato.</p>` },
  { tab:"lists", title:"Note & Liste", body:`<p>Liste pronte: musica da suonare e da evitare, ordine della processione, foto di famiglia, packing.</p><p>Scrivi nel campo e premi Invio per aggiungere una voce. Doppio clic su una voce (o sul titolo) per modificarla al volo: Invio salva, Esc annulla, svuotarla la elimina.</p>` },
  { tab:"guests", title:"Condividere", body:`<p>Due modi di condividere, diversi tra loro:</p><p><b>Collaboratori</b> (partner, wedding planner): fai accedere la persona con la <b>stessa email e password</b> che usi tu — vede e modifica tutto in tempo reale. Lo trovi da ingranaggio → Account e sync → "Invita a collaborare".</p><p><b>Invitati</b>: dalla scheda Ospiti, "Link RSVP" crea un link da mandare (WhatsApp, Messaggi). L'invitato conferma la presenza e, con un tocco, ti rimanda la risposta da inserire.</p>` },
  { tab:null, title:"Pronto", body:`<p>Tutto qui. Il lavoro si salva da solo: non c'è un pulsante "salva". Ritrovi questa guida dall'ingranaggio in alto a destra, voce "Guida".</p><p>Buona organizzazione.</p>` }
];
let guideAt=0;
function openGuide(i){
  guideAt=Math.max(0,Math.min(GUIDE.length-1,i|0));
  const step=GUIDE[guideAt];
  if(step.tab && active!==step.tab){ active=step.tab; render(); }
  const acts=[];
  if(guideAt>0) acts.push({label:"Indietro",cls:"ghost",fn:()=>openGuide(guideAt-1),close:false});
  if(guideAt<GUIDE.length-1) acts.push({label:"Avanti",cls:"",fn:()=>openGuide(guideAt+1),close:false});
  else acts.push({label:"Fine",cls:"",fn:()=>finishGuide()});
  acts.push({label:"Chiudi",cls:"ghost",fn:()=>finishGuide()});
  modal("Guida · "+(guideAt+1)+"/"+GUIDE.length+" — "+step.title, step.body, acts);
}
function finishGuide(){ if(STATE && !STATE.onboarded){ STATE.onboarded=true; Store.save(STATE); } }

// Diagnostica: rende visibili gli errori registrati da Diag (P0: "errori visibili").
function openDiag(){
  const items=Diag.list();
  const txt=items.length?Diag.exportText():"Nessun errore registrato.";
  const body=`<p class="muted" style="font-size:13px;margin-bottom:8px">Backend dati: ${esc(Store.backend)} · errori registrati: ${items.length}. Se qualcosa non va, copia questo testo e invialo al supporto.</p>`
    +`<textarea class="inp" rows="8" readonly style="font-size:12px;font-family:monospace;white-space:pre">${esc(txt)}</textarea>`;
  modal("Diagnostica", body, [{label:"Svuota",cls:"ghost",fn:()=>{ Diag.clear(); toast("Diagnostica svuotata"); }},{label:"Chiudi"}]);
}
// Privacy e diritti sui dati (GDPR): sintesi + export + rimando ai documenti.
function openPrivacy(){
  modal("Privacy e dati",
    `<p class="muted" style="font-size:13px">I tuoi dati (evento, ospiti, fornitori) sono salvati sul dispositivo; con il sync cloud opzionale anche sul server (UE). Trattiamo dati personali degli ospiti, incluse informazioni alimentari e di accessibilità: raccoglile solo se necessarie e con il loro consenso.</p>
     <p class="muted" style="font-size:13px">Puoi esportare i tuoi dati o cancellare l'evento in ogni momento. Documenti completi: <code>legal/PRIVACY.md</code>, <code>legal/TERMS.md</code>, <code>legal/COOKIE.md</code>.</p>`,
    [{label:"Esporta i miei dati (JSON)",cls:"ghost",fn:()=>{ exportEvent(); },close:false},{label:"Chiudi"}]);
}
// Abbonamento (scaffold P2): piano free/premium. Pagamento (Stripe) da collegare al backend.
const Billing=(function(){ let plan="free"; return { plan(){ return plan; }, setPlan(p){ plan=(p==="premium")?"premium":"free"; }, isPremium(){ return plan==="premium"; } }; })();
function openBilling(){
  modal("Abbonamento",
    `<p class="muted" style="font-size:13px">Piano attuale: <b>${Billing.plan()==="premium"?"Premium":"Gratuito"}</b>. Il pagamento (Stripe) si attiverà quando il backend sarà configurato; qui è un'anteprima dell'interfaccia.</p>
     <p class="muted" style="font-size:12px">Premium (futuro): sincronizzazione multi-dispositivo illimitata, collaboratori, backup esteso, esportazioni avanzate.</p>`,
    [{label:"Chiudi"}]);
}

// Account e sync cloud (P1). Dormiente finché il backend non è configurato
// (window.HUB_CLOUD + supabase-js). Lo strato client è già pronto e testato.
function cloudDoLogin(email, pw){
  if(!email||!pw){ toast("Inserisci email e password"); return Promise.resolve(false); }
  return Cloud.login(email, pw).then(function(res){
    if(res.cloudState){ STATE=res.cloudState; migrateBudgetV2(); migrateSeedLabels(); migrateTaskVendorCat(); migrateGuestsRoster2(); migrateMealSplit(); recompute(); render(); toast("Accesso ok · dati dal cloud"); }
    else { Sync.notify(STATE); toast("Accesso ok · questo dispositivo diventa la copia madre"); }
    return true;
  }).catch(function(e){ toast("Accesso non riuscito: "+(e&&e.message||"")); Diag.log("cloud","login fallito", e&&e.message); return false; });
}
// All'avvio (PRIMA cosa): se il cloud è disponibile e non sei loggato, chiedi
// l'accesso; "Lavora in locale" bypassa. onDone() prosegue (es. mostra la guida).
function promptLoginStart(onDone){
  onDone=onDone||function(){};
  if(typeof Cloud==="undefined" || !Cloud.configured() || Cloud.currentUser()){ onDone(); return; }
  const mo=modal("Accedi per sincronizzare",
    `<p style="font-size:13px">Accedi con email e password per ritrovare gli stessi dati su tutti i tuoi dispositivi. Oppure continua solo su questo dispositivo.</p>
     <div class="field"><label>Email</label><input class="inp" id="cl_email" type="email" autocomplete="username" placeholder="tu@esempio.it"></div>
     <div class="field"><label>Password</label><input class="inp" id="cl_pw" type="password" autocomplete="current-password" placeholder="la tua password"></div>`,
    [{label:"Lavora in locale",cls:"ghost",fn:function(){ onDone(); }},
     {label:"Accedi",cls:"",close:false,fn:function(){
        cloudDoLogin(($("#cl_email").value||"").trim(), ($("#cl_pw").value||"")).then(function(ok){ if(ok){ mo.close(); onDone(); } });
     }}]);
}
function openAccount(){
  if(!Cloud.configured()){
    modal("Account e sync",
      `<p>Il backend cloud non è ancora configurato in questa build. Quando il progetto Supabase sarà pronto (vedi BACKEND_P1.md), account e sincronizzazione multi-dispositivo si attivano qui.</p><p class="muted" style="font-size:12px">Lo strato client — adapter Supabase, auth e sync — è già presente e testato: manca solo collegare le chiavi del backend.</p>`,
      [{label:"Chiudi"}]);
    return;
  }
  const u=Cloud.currentUser();
  if(u){
    const stLabel={synced:"sincronizzato",syncing:"sincronizzazione in corso",offline:"offline (riprovo al ritorno della rete)",local:"locale"};
    modal("Account", `<p>Connesso come <b>${esc(u.email||u.id)}</b>.</p><p class="muted" style="font-size:13px">Stato sync: ${esc(stLabel[Sync.getStatus()]||Sync.getStatus())}. Le modifiche si sincronizzano tra i tuoi dispositivi.</p>`,
      [{label:"Invita collaboratore",cls:"ghost",fn:()=>{ openInvite(); },close:false},
       {label:"Link RSVP ospiti",cls:"ghost",fn:()=>{ const t=eventRsvpToken(); commit("Link RSVP pronto"); showShareLink("Link RSVP per gli ospiti", rsvpURL(location.origin, location.pathname, t)); },close:false},
       {label:"Esci",cls:"danger",fn:()=>{ Cloud.logout().then(()=>{ toast("Disconnesso"); }); }},{label:"Chiudi"}]);
    return;
  }
  modal("Accedi",
    `<div class="field"><label>Email</label><input class="inp" id="cl_email" type="email" autocomplete="username" placeholder="tu@esempio.it"></div>
     <div class="field"><label>Password</label><input class="inp" id="cl_pw" type="password" autocomplete="current-password" placeholder="la tua password"></div>
     <p class="muted" style="font-size:12px">Accedi con la stessa email e password su tutti i tuoi dispositivi: i dati si sincronizzano da soli.</p>`,
    [{label:"Annulla"},{label:"Accedi",cls:"",fn:()=>{ cloudDoLogin(($("#cl_email").value||"").trim(), ($("#cl_pw").value||"")); }}]);
}

// Suggerimento contestuale per scheda (riga compatta in cima alla vista).
const TAB_TIP={
  dash:"I numeri chiave a colpo d'occhio. Apri la Guida per il tour completo.",
  budget:"Aggiungi voci e rate; collega i fornitori alle voci di budget.",
  guests:"Sorgente unica degli ospiti. Hai una lista? Usa + Importa (CSV/TSV).",
  vendors:"Censisci i fornitori. 'Confermato' spunta i task collegati in Timeline.",
  seating:"Crea i tavoli, poi \"Genera (guidato)\" dispone gli ospiti in 4 passi.",
  aperitivo:"Simula le code dell'aperitivo e confronta scenari di personale.",
  timeline:"Checklist a ritroso e scaletta; le attività da fornitore si spuntano da sole.",
  lists:"Liste pronte per musica, processione, foto e packing."
};
let tipHidden={};
function hintBanner(tab){
  if(tipHidden[tab]||!TAB_TIP[tab]) return "";
  return `<div class="card" style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px;border-left:3px solid var(--sea)">`
    +`<span style="font-size:13px">${esc(TAB_TIP[tab])}</span>`
    +`<span style="white-space:nowrap"><button class="btn sm ghost" data-act="openGuide">Guida</button> <button class="btn sm ghost" data-act="hideTip" aria-label="Nascondi suggerimento">Nascondi</button></span></div>`;
}

/* ============ RUOLI E PERMESSI (P2) ============ */
// Ruolo dell'utente sull'evento. Default 'owner' (uso locale/senza cloud = pieno
// accesso). In P2 il ruolo arriva dalla membership (owner/editor/viewer).
const Session=(function(){ let role="owner"; return {
  role(){ return role; },
  setRole(r){ role=(r==="editor"||r==="viewer")?r:"owner"; },
  canEdit(){ return role==="owner"||role==="editor"; }
}; })();
// Azioni non-mutanti sempre permesse (navigazione/aiuto/account/diagnostica).
const READONLY_ACTS={ openGuide:1, openAccount:1, openDiag:1, hideTip:1, exportGuestsCsv:1, printTables:1, seatZoomIn:1, seatZoomOut:1, seatZoomReset:1, openAlerts:1, goAlert:1, togglePrivacy:1, goTab:1, cycleCateringScope:1 };
function actIsMutating(act){ return !READONLY_ACTS[act]; }
function permBlocks(act){ return !Session.canEdit() && actIsMutating(act); }
/* ==== fine blocco permessi ==== */

/* ============ CONDIVISIONE (P2): inviti collaboratori + RSVP pubblico ============ */
function makeInviteToken(){ return "inv_"+Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function inviteURL(origin, path, token, role){ return origin+path+"?invite="+encodeURIComponent(token)+"&role="+encodeURIComponent(role==="viewer"?"viewer":"editor"); }
function rsvpURL(origin, path, token){ return origin+path+"?rsvp="+encodeURIComponent(token); }
// Payload RSVP normalizzato (dalla pagina pubblica verso il backend).
function buildRsvpPayload(token, form){
  form=form||{};
  const rsvp=(form.rsvp==="no")?"no":((form.rsvp==="conf")?"conf":"attesa");
  return { token:String(token||""), name:String(form.name||"").trim(),
    rsvp:rsvp, meal:form.meal||"adulto", plusOne:Math.max(0,parseInt(form.plusOne,10)||0),
    intolerances:String(form.intolerances||"").trim(), ts:new Date().toISOString() };
}
function rsvpParam(){ try{ const m=(location.search||"").match(/[?&]rsvp=([^&]+)/); return m?decodeURIComponent(m[1]):null; }catch(e){ return null; } }
function inviteRoleParam(){ try{ const m=(location.search||"").match(/[?&]role=([^&]+)/); return m?decodeURIComponent(m[1]):null; }catch(e){ return null; } }
// Scheda di partenza da URL: ?tab=dash (o #dash). Abilita i "widget"/scorciatoie
// della Home iPhone (app Shortcuts o long-press dell'icona PWA) ad aprire l'app
// direttamente su una scheda. Valida contro le schede esistenti.
function startTab(){
  try{
    const valid=TABS.map(x=>x[0]);
    let m=(location.search||"").match(/[?&]tab=([^&]+)/); let v=m?decodeURIComponent(m[1]):null;
    if(!v && location.hash){ v=location.hash.replace(/^#/,""); }
    return (v && valid.indexOf(v)>=0)?v:null;
  }catch(e){ return null; }
}
/* ==== fine blocco condivisione ==== */
// --- UI condivisione (usa DOM/ev/modal; dormiente per gli inviti finché il cloud non è configurato) ---
function eventInvites(){ const e=ev(); e.invites=e.invites||[]; return e.invites; }
function eventRsvpToken(){ const e=ev(); if(!e.rsvpToken) e.rsvpToken="rsvp_"+Math.random().toString(36).slice(2,10); return e.rsvpToken; }
function copyText(text, okMsg){
  function ok(){ toast(okMsg||"Copiato"); }
  try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(ok,function(){ fallback(); }); return; } }catch(e){}
  fallback();
  function fallback(){ try{ const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); ok(); }catch(e){ toast("Copia non riuscita: seleziona e copia a mano"); } }
}
function shareOrCopy(payload, copyStr, okMsg){
  // navigator.share apre il foglio nativo (iPhone: WhatsApp, Messaggi, Mail…); se assente, copia.
  try{ if(navigator.share){ navigator.share(payload).catch(function(){}); return; } }catch(e){}
  copyText(copyStr, okMsg);
}
function showShareLink(title, url, msg){
  const full=(msg? msg+" " : "")+url;
  modal(title,
    (msg? '<p style="font-size:13px">'+esc(msg)+'</p>' : '')
    +'<p class="muted" style="font-size:12px">Tocca "Condividi" per mandarlo su WhatsApp o Messaggi, oppure "Copia link".</p>'
    +'<textarea class="inp" rows="3" readonly style="font-size:12px" onclick="this.select()">'+esc(url)+'</textarea>',
    [{label:"Condividi…",cls:"",fn:function(){ shareOrCopy({title:title,text:(msg||""),url:url}, full, "Link copiato"); },close:false},
     {label:"Copia link",cls:"ghost",fn:function(){ copyText(url,"Link copiato"); },close:false},
     {label:"Chiudi",cls:"ghost"}]);
}
function openInvite(){
  const m=meta(), appURL=location.origin+location.pathname;
  const istr="Ti va di aiutarmi a organizzare le nozze ("+m.coupleA+" × "+m.coupleB+")?\n"
    +"1) Apri questo link: "+appURL+"\n"
    +"2) Tocca l'ingranaggio in alto a destra → \"Account e sync\" → \"Accedi\"\n"
    +"3) Entra con l'email e la password che ti mando a parte.\n"
    +"Vedrai e potrai modificare tutto: le modifiche si aggiornano tra noi in tempo reale.";
  modal("Invita a collaborare",
    '<p style="font-size:13px">Per organizzare le nozze in più persone (il partner, un wedding planner) basta farle accedere con <b>la stessa email e password</b> che usi tu, su un loro dispositivo. Vedranno e modificheranno tutto, sincronizzato in tempo reale.</p>'
    +'<div class="card" style="background:var(--paper2,transparent);border:1px solid var(--line);padding:10px;margin:8px 0"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Come fare in 3 mosse</div><ol style="margin:0;padding-left:18px;font-size:13px"><li>Mandale il link dell\'app e le credenziali.</li><li>Lei apre → ingranaggio → Account e sync → Accedi.</li><li>Fatto: siete sugli stessi dati.</li></ol></div>'
    +'<p class="muted" style="font-size:12px">Sicurezza: manda la password con un canale diverso dal link (a voce o in un altro messaggio). Chiunque abbia email+password può modificare i dati, quindi condividile solo con chi ti fidi.</p>',
    [{label:"Condividi istruzioni",cls:"",fn:function(){ shareOrCopy({text:istr}, istr, "Istruzioni copiate"); },close:false},
     {label:"Copia istruzioni",cls:"ghost",fn:function(){ copyText(istr,"Istruzioni copiate"); },close:false},
     {label:"Chiudi",cls:"ghost"}]);
}
function revokeInvite(id){ const e=ev(); e.invites=(e.invites||[]).filter(function(x){return x.id!==id;}); commit("Invito revocato"); }
function renderPublicRSVP(token){
  try{ const tb=document.getElementById("tabs"); if(tb) tb.style.display="none"; }catch(e){}
  try{ const gb=document.getElementById("gearBtn"); if(gb) gb.style.display="none"; const sc=document.getElementById("syncChip"); if(sc) sc.style.display="none"; const ab=document.getElementById("alertBell"); if(ab) ab.style.display="none"; }catch(e){}
  try{ const br=document.querySelector(".brand"); if(br){ br.removeAttribute("data-act"); br.style.cursor="default"; } const pn=document.getElementById("editPencil"); if(pn) pn.style.display="none"; }catch(e){}
  try{ const et=document.getElementById("evTitle"); if(et) et.textContent="Le nostre nozze"; const es=document.getElementById("evSub"); if(es) es.textContent="Conferma la tua presenza"; const cd=document.getElementById("cd"); if(cd&&cd.parentNode) cd.parentNode.style.display="none"; }catch(e){}
  const meals=(typeof MEALS!=="undefined")?MEALS:["adulto","bambino","vegetariano","celiaco","vegano"];
  const v=document.getElementById("view"); if(!v) return;
  v.innerHTML='<div class="card" style="max-width:520px;margin:16px auto">'
    +'<div class="sec-title" style="margin-top:2px"><h2>Ci sarai?</h2></div>'
    +'<p class="muted" style="font-size:13px;margin-top:-4px;margin-bottom:12px">Compila e tocca "Invia": la tua risposta arriva direttamente agli sposi.</p>'
    +'<div class="field"><label>Nome e cognome</label><input class="inp" id="rs_name" placeholder="Mario Rossi"></div>'
    +'<div class="field"><label>Parteciperai?</label><select class="inp" id="rs_go"><option value="conf">Sì, ci sarò</option><option value="no">No, non posso</option><option value="attesa">Forse</option></select></div>'
    +'<div class="two"><div class="field"><label>Menù</label><select class="inp" id="rs_meal">'+meals.map(function(m){return '<option value="'+m+'">'+m+'</option>';}).join("")+'</select></div>'
    +'<div class="field"><label>Accompagnatori (+)</label><input class="inp" type="number" min="0" id="rs_plus" value="0"></div></div>'
    +'<div class="field"><label>Intolleranze / allergie <span class="muted" style="font-size:11px">(facoltativo)</span></label><input class="inp" id="rs_int" placeholder="Es. celiaco, niente frutta secca…"></div>'
    +'<div class="btnbar"><button class="btn primary" id="rs_send" style="flex:1">Invia risposta</button></div>'
    +'<div id="rs_msg" style="font-size:13px;margin-top:8px;color:var(--no)"></div></div>';
  const send=document.getElementById("rs_send");
  if(send) send.addEventListener("click", function(){
    const payload=buildRsvpPayload(token, { name:document.getElementById("rs_name").value, rsvp:document.getElementById("rs_go").value, meal:document.getElementById("rs_meal").value, plusOne:document.getElementById("rs_plus").value, intolerances:document.getElementById("rs_int").value });
    if(!payload.name){ document.getElementById("rs_msg").textContent="Inserisci il tuo nome per continuare."; return; }
    const goTxt=payload.rsvp==="conf"?"Ci sarò":(payload.rsvp==="no"?"Non posso":"Forse");
    const line="RSVP nozze — "+payload.name+": "+goTxt+(payload.plusOne?(" +"+payload.plusOne):"")+" · menù "+payload.meal+(payload.intolerances?(" · "+payload.intolerances):"");
    if(typeof Diag!=="undefined") Diag.log("rsvp","risposta", line.slice(0,200));
    // La risposta torna agli sposi: foglio di condivisione nativo (o copia).
    shareOrCopy({title:"RSVP nozze", text:line}, line, "Risposta copiata: incollala e inviala agli sposi");
    v.innerHTML='<div class="card" style="max-width:520px;margin:16px auto;text-align:center">'
      +'<div style="font-size:40px;margin:6px 0">'+(payload.rsvp==="conf"?"🎉":(payload.rsvp==="no"?"🤍":"🙂"))+'</div>'
      +'<div class="sec-title" style="justify-content:center"><h2>Grazie, '+esc(payload.name)+'!</h2></div>'
      +'<p style="font-size:14px">'+(payload.rsvp==="conf"?"Non vediamo l\'ora di festeggiare con te.":(payload.rsvp==="no"?"Ci dispiace che tu non possa esserci, grazie di avercelo detto.":"Grazie, aspettiamo la tua conferma."))+'</p>'
      +'<p class="muted" style="font-size:13px;margin-top:10px">Se non si è aperta la condivisione, tocca qui sotto per mandare la tua risposta agli sposi.</p>'
      +'<div class="btnbar" style="justify-content:center"><button class="btn primary" id="rs_share2">Invia agli sposi</button></div></div>';
    var b=document.getElementById("rs_share2"); if(b) b.addEventListener("click", function(){ shareOrCopy({title:"RSVP nozze", text:line}, line, "Risposta copiata"); });
  });
}

/* ============ EVENTS ============ */
document.addEventListener("click",e=>{ try{
  const tab=e.target.closest("[data-tab]"); if(tab){ active=tab.getAttribute("data-tab"); render(); return; }
  const a=e.target.closest("[data-act]"); if(!a) return;
  const act=a.getAttribute("data-act"), id=a.getAttribute("data-id");
  if(permBlocks(act)){ toast("Sola lettura: non hai i permessi di modifica"); return; }
  if(act==="editBudget") editBudget(id);
  else if(act==="delBudget") delBudget(id);
  else if(act==="addBudget") addBudget();
  else if(act==="togglePay"){ const p=ev().payments.find(x=>x.id===id); if(p){p.paid=!p.paid; commit(p.paid?"Rata segnata pagata":"Rata riaperta");} }
  else if(act==="addPayment") editPayment(null);
  else if(act==="editPayment") editPayment(id);
  else if(act==="delPayment") delPayment(id);
  else if(act==="applyPlan"){ const g=+$("#plg").value||0, c=+$("#cpct").value||0; meta().plannedGuests=g; meta().contingencyPct=c; commit("Pianificazione aggiornata"); }
  else if(act==="importGuests") importWizard();
  else if(act==="exportGuestsCsv") exportGuestsCsv();
  else if(act==="shareRsvp"){ const t=eventRsvpToken(); commit("Link RSVP pronto"); showShareLink("Link RSVP per gli invitati", rsvpURL(location.origin, location.pathname, t), "Confermi la tua presenza alle nostre nozze?"); }
  else if(act==="addGuest") editGuest(null);
  else if(act==="editGuest") editGuest(id);
  else if(act==="cycleRsvp"){ const e=ev(), g=e.guests.find(x=>x.id===id); if(g){ const seq=["conf","attesa","no"]; g.rsvp=seq[(seq.indexOf(g.rsvp)+1)%seq.length]; if(g.rsvp==="no"){ e.seating=e.seating||{rules:[]}; e.seating.rules=seatPurgeGuest(e.tables, e.seating.rules||[], g.id); } commit("RSVP: "+(RSVP[g.rsvp]?RSVP[g.rsvp][1]:g.rsvp)); } }
  else if(act==="delGuest") delGuest(id);
  else if(act==="addVendor") editVendor(null);
  else if(act==="editVendor") editVendor(id);
  else if(act==="delVendor") delVendor(id);
  else if(act==="webVendor") webVendor(id);
  else if(act==="toggleTask"){ const t=ev().tasks.find(x=>x.id===id); if(t){ t.done=!t.done; commit(t.done?"Completata":"Riaperta"); } }
  else if(act==="addTask") editTask(null);
  else if(act==="editTask") editTask(id);
  else if(act==="delTask") delTask(id);
  else if(act==="genChecklist") genChecklist();
  else if(act==="genRunShow") genRunShow();
  else if(act==="addRs") editRs(null);
  else if(act==="editRs") editRs(id);
  else if(act==="delRs") delRs(id);
  else if(act==="addList") addList();
  else if(act==="delList") delList(id);
  else if(act==="addItem") addItem(id);
  else if(act==="delItem") delItem(id, a.getAttribute("data-i"));
  else if(act==="simLoadScen") simLoadScenario(+id);
  else if(act==="simDelScen") simDelScenario(+id);
  else if(act==="addTable") addTable();
  else if(act==="editTable") editTable(id);
  else if(act==="delTable") delTable(id);
  else if(act==="optimizeTable") optimizeTable(id);
  else if(act==="optimizeAll") optimizeAllTables();
  else if(act==="autoAssign") autoAssignConfirm();
  else if(act==="seatWizard") seatWizard();
  else if(act==="themeTables") seatThemePicker();
  else if(act==="printTables") printTables();
  else if(act==="seatZoomIn") seatZoom(0.25);
  else if(act==="seatZoomOut") seatZoom(-0.25);
  else if(act==="seatZoomReset"){ SEATZOOM=1; render(); }
  else if(act==="addRule") seatRuleEditor();
  else if(act==="delRule") delSeatRule(id);
  else if(act==="assignSeat") assignSeat(a.getAttribute("data-table"), a.getAttribute("data-idx"));
  else if(act==="editHeader") editEventHeader();
  else if(act==="togglePrivacy"){ const k=a.getAttribute("data-key"); if(PRIVACY_REVEALED.has(k)) PRIVACY_REVEALED.delete(k); else PRIVACY_REVEALED.add(k); a.classList.toggle("revealed", PRIVACY_REVEALED.has(k)); }
  else if(act==="goTab"){ active=a.getAttribute("data-target")||"dash"; render(); }
  else if(act==="cycleCateringScope"){ CATERING_SCOPE=CATERING_SCOPE==="conf"?"attesa":(CATERING_SCOPE==="attesa"?"all":"conf"); render(); }
  else if(act==="openAlerts") openAlerts();
  else if(act==="goAlert"){
    if(_alertsModal){ _alertsModal.close(); _alertsModal=null; }
    active=a.getAttribute("data-target")||"dash";
    const ref=(a.getAttribute("data-ref")||"").split(",").filter(Boolean);
    if(active==="guests"&&ref.length) GUESTVIEW={filter:'all',q:''}; // il filtro attivo nasconderebbe le righe da evidenziare
    render();
    if(ref.length) flashRows(ref);
  }
  else if(act==="muteAlert"){ alertsPrefs().muted.push(id); commit("Avviso silenziato"); openAlerts(); }
  else if(act==="unmuteAlerts"){ alertsPrefs().muted=[]; commit("Avvisi riattivati"); openAlerts(); }
  else if(act==="alertsCfgSave"){ const c=alertsPrefs(); c.payDays=Math.max(1,Math.min(90,+$("#al_pay").value||14)); c.taskDays=Math.max(1,Math.min(90,+$("#al_task").value||14)); commit("Soglie avvisi salvate"); openAlerts(); }
  else if(act==="openGuide") openGuide(0);
  else if(act==="openAccount") openAccount();
  else if(act==="revokeInvite") revokeInvite(id);
  else if(act==="hideTip"){ tipHidden[active]=true; render(); }
  }catch(err){ Diag.log("action","azione fallita",(err&&err.stack)||(err&&err.message)); toast("Si è verificato un errore"); }
});
$("#gearBtn").addEventListener("click",openGear);
document.addEventListener("change",function(e){
  if(e.target&&e.target.id==="rs_filter"){ rsFilter=e.target.value; render(); }
  if(e.target&&e.target.matches&&e.target.matches("select[data-managed]")){
    const inp=document.getElementById(e.target.id+"_new");
    if(inp){ if(e.target.value==="__new__"){ inp.style.display=""; inp.focus(); } else { inp.style.display="none"; inp.value=""; } }
  }
});
// Doppio clic per modificare inline (voci e titoli delle liste): niente tasto "Modifica".
document.addEventListener("dblclick", function(e){
  const el=e.target.closest && e.target.closest('[data-inline]'); if(!el) return;
  if(typeof Session!=="undefined" && !Session.canEdit()){ toast("Sola lettura"); return; }
  const kind=el.getAttribute("data-inline"), id=el.getAttribute("data-id");
  startInlineEdit(el, function(txt){
    const l=ev().lists.find(x=>x.id===id); if(!l) return;
    if(kind==="title"){ if(txt){ l.title=txt; commit("Lista rinominata"); } else render(); }
    else { const i=+el.getAttribute("data-i"); if(txt){ l.items[i]=txt; commit("Voce modificata"); } else { l.items.splice(i,1); commit("Voce rimossa"); } }
  });
});
function startInlineEdit(el, onSave){
  const orig=el.textContent; let done=false;
  el.setAttribute("contenteditable","true"); el.classList.add("editing"); el.focus();
  try{ const rng=document.createRange(); rng.selectNodeContents(el); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(rng); }catch(err){}
  function finish(save){ if(done) return; done=true; el.removeAttribute("contenteditable"); el.removeEventListener("keydown",onKey); el.removeEventListener("blur",onBlur);
    const txt=(el.textContent||"").trim();
    if(save && txt!==(orig||"").trim()) onSave(txt); else el.textContent=orig; }
  function onKey(ev){ if(ev.key==="Enter"){ ev.preventDefault(); el.blur(); } else if(ev.key==="Escape"){ ev.preventDefault(); finish(false); } }
  function onBlur(){ finish(true); }
  el.addEventListener("keydown",onKey); el.addEventListener("blur",onBlur);
}
// Invio per aggiungere una voce lista senza cliccare "+".
document.addEventListener("keydown", function(e){
  if(e.key!=="Enter") return;
  const t=e.target;
  if(t && t.id && t.id.indexOf("li_")===0){ e.preventDefault(); addItem(t.id.slice(3)); }
});
/* ============ INIT ============ */
(async function(){
  // Pagina pubblica RSVP per gli ospiti: schermata dedicata, non l'app intera.
  if(rsvpParam()){ renderPublicRSVP(rsvpParam()); return; }
  STATE=await Store.load();
  if(!STATE||!STATE.events){ STATE=seedState(); Store.save(STATE); }
  migrateBudgetV2(); // stima -> preventivo (una tantum, vedi funzione)
  migrateSeedLabels(); // titoli liste seed in italiano
  migrateTaskVendorCat(); // collega attivita' seed ai fornitori
  migrateGuestsRoster2(); // bonifica lista invitati (una tantum)
  migrateMealSplit(); // separa tipologia persona / menu (una tantum)
  active=startTab()||active; // scheda di partenza da ?tab= (widget/scorciatoie Home)
  recompute(); render();
  // Bootstrap cloud: attivo solo se la build fornisce config + supabase-js.
  // Assente per ora -> Cloud resta dormiente e l'app è puramente locale.
  try{
    if(typeof window!=="undefined" && window.HUB_CLOUD && window.supabase && window.supabase.createClient){
      const sc=window.supabase.createClient(window.HUB_CLOUD.url, window.HUB_CLOUD.anonKey);
      Cloud.configure(makeSupabaseAuth(sc), makeSupabaseRemote(sc, STATE.activeEventId||"rb27"));
      // Se c'è già una sessione valida (login precedente), riprendi e tira giù il cloud.
      // Migrazione DOPO il pull: lo stato del cloud vince su quello locale,
      // quindi va migrato lui (Store.save dentro migrate rispinge nel cloud).
      try{ const res=await Cloud.resume(); if(res && res.cloudState){ STATE=res.cloudState; migrateBudgetV2(); migrateSeedLabels(); migrateTaskVendorCat(); migrateGuestsRoster2(); migrateMealSplit(); recompute(); render(); } }
      catch(e){ Diag.log("cloud","resume fallito", e&&e.message); }
    }
  }catch(e){ Diag.log("cloud","bootstrap fallito", e&&e.message); }
  updateSyncChip(); // il bootstrap gira dopo render(): aggiorna subito l'indicatore
  // Login come PRIMA cosa quando il cloud è pronto e non sei loggato; poi la guida.
  // Se si arriva da un widget/scorciatoia su una scheda precisa (?tab=), non
  // dirottare con la guida: la guida navigherebbe alla sua scheda annullando il deep-link.
  const deepLinked=!!startTab();
  if(typeof Cloud!=="undefined" && Cloud.configured() && !Cloud.currentUser()){
    promptLoginStart(function(){ if(!STATE.onboarded && !deepLinked) openGuide(0); });
  } else if(!STATE.onboarded && !deepLinked){ openGuide(0); }
  // PWA: registra il service worker (solo su http(s); su file:// fallisce silenziosamente)
  try{ if(typeof navigator!=="undefined" && navigator.serviceWorker && location.protocol.indexOf("http")===0){ navigator.serviceWorker.register("sw.js").catch(function(e){ Diag.log("pwa","SW register fallita", e&&e.message); }); } }catch(e){}
})();
})();
