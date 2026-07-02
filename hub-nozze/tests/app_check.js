
"use strict";
(function(){

/* ============ DIAGNOSTICA / ERROR TRACKING (P0) ============ */
// Senza backend gli errori di produzione sarebbero invisibili. Diag li cattura in
// un buffer limitato, persistente (chiave separata) e ispezionabile dalla voce
// "Diagnostica" nel menù. In P1/P3 qui si aggancerà l'invio a un servizio remoto.
const DIAG_KEY="hub_diag_v1", DIAG_MAX=25;
const Diag=(function(){
  let buf=[];
  function persist(){ try{ if(typeof localStorage!=="undefined") localStorage.setItem(DIAG_KEY, JSON.stringify(buf.slice(-DIAG_MAX))); }catch(e){} }
  try{ if(typeof localStorage!=="undefined"){ const r=localStorage.getItem(DIAG_KEY); if(r) buf=JSON.parse(r)||[]; } }catch(e){ buf=[]; }
  return {
    log(kind,msg,extra){ buf.push({t:new Date().toISOString(),kind:String(kind||"error"),msg:String(msg||"").slice(0,300),extra:extra?String(extra).slice(0,600):""}); if(buf.length>DIAG_MAX) buf=buf.slice(-DIAG_MAX); persist(); },
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
    memState=state;
    clearTimeout(saveTimer);
    const self=this;
    saveTimer=setTimeout(function(){ Promise.resolve(self.adapter.set(JSON.stringify(state))).catch(function(e){ Diag.log("storage","save fallita", e&&e.message); }); },250);
  },
  // Scrittura immediata di una save in sospeso: chiude la finestra di 250ms in cui
  // una chiusura/reload perderebbe l'ultima modifica.
  flush(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; }
    if(memState!=null){ try{ Promise.resolve(this.adapter.set(JSON.stringify(memState))).catch(function(e){ Diag.log("storage","flush fallito", e&&e.message); }); }catch(e){ Diag.log("storage","flush fallito", e&&e.message); } }
  }
};
// Flush quando la pagina passa in background o viene chiusa (iOS: pagehide/
// visibilitychange sono gli eventi affidabili; 'unload' non è garantito su Safari).
if(typeof window!=="undefined"){
  window.addEventListener("pagehide", function(){ Store.flush(); });
  document.addEventListener("visibilitychange", function(){ if(document.visibilityState==="hidden") Store.flush(); });
}

/* ============ SEED (motore generico: questi dati sono SEED, non codice) ============ */
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
        coupleA:"Righi", coupleB:"Biondi", groom:"Luca", date:"2027-07-03",
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
      guests:[
        g("Marco Righi","A","Genitori Righi","conf","adulto"),
        g("Anna Righi","A","Genitori Righi","conf","adulto"),
        g("Davide Righi","A","Righi","conf","adulto"),
        g("Giulia Conti","A","Conti","attesa","vegetariano",{plus:1}),
        g("Paolo Biondi","B","Genitori Biondi","conf","adulto"),
        g("Elena Biondi","B","Genitori Biondi","conf","celiaco"),
        g("Sofia Biondi","B","Biondi","conf","bambino",{access:"Seggiolone"}),
        g("Martina Ferri","B","Ferri","attesa","adulto",{plus:1}),
        g("Luca Bianchi","A","Amici sposo","conf","adulto",{shuttle:true}),
        g("Chiara Neri","B","Amici sposa","no","adulto")
      ],
      vendors:[
        {id:"fenice",name:"La Fenice Catering & Banqueting",category:"Catering",contact:"Vittorio Fiore",phone:"+39 331 668 2055",email:"",website:"lafenicecatering.com",status:"confermato",quote:18000,budgetLineId:"b1",rating:"",reviews:"",pastEvents:"",notes:"Tasting a Faenza",source:"preventivo",updated:""},
        {id:"benelli",name:"Castello Benelli",category:"Location",contact:"",phone:"",email:"",website:"",status:"confermato",quote:7000,budgetLineId:"b0",rating:"",reviews:"",pastEvents:"",notes:"Via San Vito 17, Bellaria-Igea Marina (RN)",source:"contratto",updated:""}
      ], tasks:[
        {id:"k1",title:"Bloccare location e catering",category:"Fornitori",due:"2026-07-03",assignee:"Sposi",done:true},
        {id:"k2",title:"Confermare location",category:"Fornitori",vendorCat:"Location",due:"2026-07-03",assignee:"Sposi",done:false},
        {id:"k3",title:"Confermare catering",category:"Catering",vendorCat:"Catering",due:"2026-07-03",assignee:"Sposi",done:false},
        {id:"k4",title:"Scegliere foto e video",category:"Fornitori",due:"2026-10-03",assignee:"Sposi",done:false},
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
        {id:"l1",title:"Musica — must play",items:["Apertura balli","Canzone primo ballo"]},
        {id:"l2",title:"Musica — do not play",items:["(da inserire)"]},
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
  function g(name,side,hh,rsvp,meal,o){o=o||{};return{id:"g"+Math.random().toString(36).slice(2,8),name,side,household:hh,rsvp,meal,intolerances:"",accessibility:o.access||"",shuttle:!!o.shuttle,plusOne:o.plus||0,gift:"",thanked:false}}
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
  const cont=Math.round(est*(m.contingencyPct||0)/100);
  const ceiling=est+cont;
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
  conf.forEach(x=>{ meals[x.meal]=(meals[x.meal]||0)+1; if(x.plusOne){meals["adulto"]=(meals["adulto"]||0)+(+x.plusOne);} });
  const intoll=conf.filter(x=>x.intolerances).map(x=>x.name+": "+x.intolerances);
  const shuttle=conf.filter(x=>x.shuttle).reduce((s,x)=>s+1+(+x.plusOne||0),0);
  // seating
  const tablesArr=e.tables||[];
  const assignedHead=conf.reduce((s,x)=>s+(x.table?1+(+x.plusOne||0):0),0);
  const seatCap=tablesArr.reduce((s,t)=>s+(+t.capacity||0),0);
  const vendorsArr=e.vendors||[];
  const vConf=vendorsArr.filter(v=>v.status==="confermato").length;
  const tk=e.tasks||[]; const todayISO=new Date().toISOString().slice(0,10);
  const tasksTotal=tk.length, tasksDone=tk.filter(taskDone).length, overdue=tk.filter(t=>!taskDone(t)&&t.due&&t.due<todayISO).length;
  DERIVED={est,quo,act,cont,ceiling,committed,variance:committed-ceiling,cf,paidSum,dueSum,head,counts,meals,intoll,shuttle,plannedGuests:g,tablesN:tablesArr.length,assignedHead,seatCap,vendorsN:vendorsArr.length,vConf,tasksTotal,tasksDone,overdue};
}

/* ============ HELPERS ============ */
const $=s=>document.querySelector(s);
function money(n){ return new Intl.NumberFormat(meta().locale,{style:"currency",currency:meta().currency,maximumFractionDigits:0}).format(n||0); }
function dnum(n){ return new Intl.NumberFormat("it-IT").format(n||0); }
function daysTo(d){ const t=new Date(d+"T00:00:00"), now=new Date(); now.setHours(0,0,0,0); return Math.round((t-now)/86400000); }
function fdate(d){ if(!d) return "—"; return new Date(d+"T00:00:00").toLocaleDateString("it-IT",{day:"2-digit",month:"short",year:"numeric"}); }
function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }
function announce(t){ $("#aria").textContent=t; }
function toast(t){ const el=$("#toast"); el.textContent=t; el.classList.add("show"); announce(t); setTimeout(()=>el.classList.remove("show"),1800); }
function commit(msg){ recompute(); Store.save(STATE); render(); if(msg) toast(msg); }

function modal(title, bodyHtml, actions){
  const root=$("#modalRoot");
  root.innerHTML='<div class="modal-bg" id="mbg"><div class="modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><h3>'+esc(title)+'</h3><div id="mbody">'+bodyHtml+'</div><div class="btnbar" id="mact"></div></div></div>';
  const act=$("#mact");
  (actions||[{label:"Chiudi",close:true}]).forEach(a=>{
    const b=document.createElement("button");
    b.className="btn "+(a.cls||"ghost"); b.textContent=a.label;
    b.onclick=()=>{ if(a.fn) a.fn(); if(a.close!==false) close(); };
    act.appendChild(b);
  });
  $("#mbg").addEventListener("click",e=>{ if(e.target.id==="mbg") close(); });
  function close(){ root.innerHTML=""; }
  return {close};
}

/* ============ ROUTER ============ */
const TABS=[
  ["dash","Dashboard"],["budget","Budget & Finanze"],["guests","Ospiti & RSVP"],
  ["vendors","Fornitori"],["seating","Tavoli"],
  ["aperitivo","Aperitivo"],["timeline","Timeline"],["lists","Note & Liste"]
];
let active="dash";
function renderTabs(){
  $("#tabs").innerHTML=TABS.map(t=>'<button role="tab" data-tab="'+t[0]+'" aria-selected="'+(active===t[0])+'">'+esc(t[1])+'</button>').join("");
}
function render(){
  const m=meta(), d=DERIVED;
  $("#evTitle").textContent=m.coupleA+" × "+m.coupleB;
  $("#evSub").textContent=m.venue+" · "+fdate(m.date);
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
  if(active==="aperitivo") wireAperitivo();
  if(active==="seating") wireSeating();
}

/* ============ DASHBOARD ============ */
function viewDash(){
  const d=DERIVED, m=meta(), e=ev();
  const next=e.payments.filter(p=>!p.paid).sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||"")).slice(0,3);
  const alerts=[];
  if(d.head && d.head<m.minGuaranteed) alerts.push("Numerica confermata ("+d.head+") sotto il minimo garantito ("+m.minGuaranteed+").");
  if(d.variance>0) alerts.push("Impegnato oltre il tetto di "+money(d.variance)+".");
  if(e.budget.some(b=>b.costType==="perGuest"&&!b.perHead)) alerts.push("Alcune voci a persona non hanno tariffa (es. Bomboniere).");
  if(d.overdue>0) alerts.push(d.overdue+" attività scadute da recuperare.");
  const pct=d.ceiling?Math.min(100,Math.round(d.committed/d.ceiling*100)):0;
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${money(d.ceiling)}</div><div class="l">Tetto (stima + ${m.contingencyPct}% contingenza)</div></div>
    <div class="card kpi"><div class="v">${money(d.committed)}</div><div class="l">Impegnato</div>
      <div class="barwrap"><div class="bar ${d.variance>0?'over':''}" style="width:${pct}%"></div></div></div>
    <div class="card kpi"><div class="v">${money(d.dueSum)}</div><div class="l">Da pagare (${e.payments.filter(p=>!p.paid).length} rate)</div></div>
    <div class="card kpi"><div class="v">${d.counts.conf} <span class="muted" style="font-size:16px">/ ${e.guests.length}</span></div><div class="l">RSVP confermati · ${d.head} a tavola</div></div>
    <div class="card kpi"><div class="v">${d.vConf}/${d.vendorsN}</div><div class="l">Fornitori confermati</div></div>
    <div class="card kpi"><div class="v">${d.tasksDone}/${d.tasksTotal}</div><div class="l">Attività completate</div></div>
  </div>

  <div class="sec-title"><h2>Prossimi pagamenti</h2><span class="pill">cash-flow</span></div>
  <div class="scroll-x"><table class="tbl"><thead><tr><th>Voce</th><th>Scadenza</th><th class="num">Importo</th></tr></thead><tbody>
  ${next.length?next.map(p=>`<tr><td>${esc(p.label)}</td><td>${fdate(p.dueDate)} <span class="muted">(${daysTo(p.dueDate)} gg)</span></td><td class="num">${money(p.amount)}</td></tr>`).join(""):`<tr><td colspan="3" class="muted">Nessuna rata in sospeso.</td></tr>`}
  </tbody></table></div>

  <div class="sec-title"><h2>RSVP</h2></div>
  <div class="grid cards">
    <div class="card kpi"><div class="v">${d.counts.conf}</div><div class="l">Confermati</div></div>
    <div class="card kpi"><div class="v">${d.counts.attesa}</div><div class="l">In attesa</div></div>
    <div class="card kpi"><div class="v">${d.counts.no}</div><div class="l">Non vengono</div></div>
    <div class="card kpi"><div class="v">${d.shuttle}</div><div class="l">Navetta</div></div>
    <div class="card kpi"><div class="v">${d.assignedHead}/${d.head}</div><div class="l">Assegnati a tavolo</div></div>
  </div>

  <div class="sec-title"><h2>Avvisi</h2></div>
  <div class="card">${alerts.length?alerts.map(a=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="pill warn">!</span> ${esc(a)}</div>`).join(""):'<span class="muted">Tutto in ordine.</span>'}</div>
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
    rows+=`<tr class="row-group"><td colspan="6">${TIER[t]}</td></tr>`;
    items.forEach(b=>{
      const stato=b.paid?'<span class="pill ok">pagata</span>':(b.quote?'<span class="pill warn">preventivo</span>':'<span class="pill todo">da stimare</span>');
      rows+=`<tr>
        <td>${esc(b.item)} ${b.costType==="perGuest"?'<span class="tag">a persona</span>':''}</td>
        <td class="num">${b._total?money(b._total):'<span class="muted">—</span>'}</td>
        <td class="num">${b.quote?money(b.quote):'<span class="muted">—</span>'}</td>
        <td class="num">${b.actual?money(b.actual):'<span class="muted">—</span>'}</td>
        <td>${stato}</td>
        <td class="num"><button class="btn sm ghost" data-act="editBudget" data-id="${b.id}">Modifica</button></td>
      </tr>`;
    });
  }
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${money(d.est)}</div><div class="l">Stima totale</div></div>
    <div class="card kpi"><div class="v">${money(d.quo)}</div><div class="l">Preventivi</div></div>
    <div class="card kpi"><div class="v">${money(d.act)}</div><div class="l">Effettivo</div></div>
    <div class="card kpi"><div class="v">${money(d.ceiling)}</div><div class="l">Tetto + contingenza ${m.contingencyPct}%</div></div>
  </div>

  <div class="sec-title"><h2>Pianificazione</h2><span class="pill">${dnum(m.plannedGuests)} ospiti previsti</span></div>
  <div class="card">
    <div class="two">
      <div class="field"><label>Ospiti previsti (ricalcola voci a persona)</label><input class="inp" type="number" id="plg" value="${m.plannedGuests}" min="0"></div>
      <div class="field"><label>Contingenza %</label><input class="inp" type="number" id="cpct" value="${m.contingencyPct}" min="0" max="30"></div>
    </div>
    <div class="btnbar"><button class="btn" data-act="applyPlan">Applica</button>
    <span class="muted" style="align-self:center">Riserva: ${money(d.cont)}</span></div>
  </div>

  <div class="sec-title"><h2>Voci di spesa</h2><button class="btn sm" data-act="addBudget">+ Voce</button></div>
  <div class="scroll-x"><table class="tbl">
    <thead><tr><th>Voce</th><th class="num">Stima</th><th class="num">Preventivo</th><th class="num">Effettivo</th><th>Stato</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>

  <div class="sec-title"><h2>Pagamenti</h2><span class="pill">${money(d.paidSum)} pagati · ${money(d.dueSum)} da pagare</span></div>
  <div class="scroll-x"><table class="tbl">
    <thead><tr><th>Voce</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th></tr></thead>
    <tbody>${e.payments.sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||"")).map(p=>`
      <tr><td>${esc(p.label)}</td><td>${fdate(p.dueDate)}</td><td class="num">${money(p.amount)}</td>
      <td><button class="btn sm ${p.paid?'ghost':''}" data-act="togglePay" data-id="${p.id}">${p.paid?'pagata':'segna pagata'}</button></td></tr>`).join("")}
    </tbody>
  </table></div>
  <p class="muted" style="font-size:13px;margin-top:8px">Cash-flow mensile: ${Object.keys(DERIVED.cf).sort().map(k=>k+" → "+money(DERIVED.cf[k])).join(" · ")||"—"}</p>
  `;
}

/* ============ GUESTS ============ */
const MEALS=["adulto","bambino","vegetariano","celiaco","vegano"];
const RSVP={conf:["ok","Confermato"],attesa:["warn","In attesa"],no:["no","Non viene"]};
function viewGuests(){
  const e=ev(), d=DERIVED;
  const hh={}; e.guests.forEach(g=>{ (hh[g.household]=hh[g.household]||[]).push(g); });
  let blocks="";
  Object.keys(hh).sort().forEach(name=>{
    blocks+=`<tr class="row-group"><td colspan="5">${esc(name)} <span class="muted" style="font-weight:400">· lato ${hh[name][0].side==="A"?meta().coupleA:meta().coupleB}</span></td></tr>`;
    hh[name].forEach(g=>{
      const r=RSVP[g.rsvp]||["todo","?"];
      blocks+=`<tr>
        <td>${esc(g.name)}${g.plusOne?` <span class="tag">+${g.plusOne}</span>`:""}${g.shuttle?' <span class="tag">navetta</span>':""}${g.accessibility?` <span class="tag">${esc(g.accessibility)}</span>`:""}${(function(){var _t=seatTableOf(g.id);return _t?` <span class="tag">${esc(_t.name)}</span>`:"";})()}</td>
        <td><span class="pill ${r[0]}">${r[1]}</span></td>
        <td>${esc(g.meal)}${g.intolerances?` <span class="muted">· ${esc(g.intolerances)}</span>`:""}</td>
        <td class="num"><button class="btn sm ghost" data-act="editGuest" data-id="${g.id}">Modifica</button></td>
        <td class="num"><button class="btn sm danger" data-act="delGuest" data-id="${g.id}">×</button></td>
      </tr>`;
    });
  });
  const mealRows=Object.keys(d.meals).map(k=>`<tr><td>${esc(k)}</td><td class="num">${d.meals[k]}</td></tr>`).join("")||`<tr><td colspan="2" class="muted">Nessun confermato.</td></tr>`;
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${d.head}</div><div class="l">A tavola (confermati + accompagnatori)</div></div>
    <div class="card kpi"><div class="v">${d.counts.attesa}</div><div class="l">In attesa</div></div>
    <div class="card kpi"><div class="v">${meta().plannedGuests}</div><div class="l">Previsti (pianificazione)</div></div>
    <div class="card kpi"><div class="v">${d.intoll.length}</div><div class="l">Con intolleranze</div></div>
  </div>

  <div class="card" style="margin-top:14px"><span class="pill todo">sorgente unica</span> ${ev().guests.length} ospiti in lista. Con Importa aggiungi in blocco da Excel, Google Sheets o CSV: incolli o carichi il file, mappi le colonne e confermi. Da qui i dati alimentano catering e tavoli.</div>

  <div class="sec-title"><h2>Ospiti per nucleo</h2><span><button class="btn sm ghost" data-act="importGuests">Importa</button> <button class="btn sm" data-act="addGuest">+ Ospite</button></span></div>
  <div class="scroll-x"><table class="tbl">
    <thead><tr><th>Nome</th><th>RSVP</th><th>Menù</th><th></th><th></th></tr></thead>
    <tbody>${blocks}</tbody>
  </table></div>

  <div class="sec-title"><h2>Report catering</h2><span class="pill ok">pronto</span></div>
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">
    <div class="card"><h3>Pasti</h3><table class="tbl"><tbody>${mealRows}</tbody></table></div>
    <div class="card"><h3>Intolleranze</h3>${d.intoll.length?d.intoll.map(x=>`<div style="padding:4px 0">${esc(x)}</div>`).join(""):'<span class="muted">Nessuna.</span>'}<div style="margin-top:8px"><span class="pill">Navetta: ${d.shuttle}</span></div></div>
  </div>
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
function seatAffinityFn(){ const by={}; ev().guests.forEach(g=>by[g.id]=g); return function(ga,gb){ const a=by[ga],b=by[gb]; if(!a||!b)return false; const sameHH=a.household&&a.household!=='Senza nucleo'&&a.household===b.household; const kids=a.meal==='bambino'&&b.meal==='bambino'; return !!(sameHH||kids); }; }
function seatOptimizeTable(t){ return seatOptimize((t.seatIds||[]).slice(), t.seats, seatRulesIdx(), seatAffinityFn()); }


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
  tables.forEach((t,i)=>{ const c=i%cols, r=Math.floor(i/cols); pos[t.id]={x:c*cw+cw/2, y:r*ch+ch/2}; });
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
    body+=`<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})">${shapeSvg}${seats}`
      +`<text x="0" y="${(f.h/2+0.55).toFixed(2)}" text-anchor="middle" font-size="0.42" fill="#5b6b6e">${label}</text></g>`;
  });
  // touch-action:none sull'SVG: su touch il browser altrimenti reclama il gesto
  // per lo scroll e annulla il drag (pointercancel). Il resto della pagina resta
  // scrollabile (cards, KPI, aree fuori dall'SVG).
  return `<svg viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${W.toFixed(2)} ${H.toFixed(2)}" style="width:100%;height:auto;max-height:60vh;background:#fbfcfc;border-radius:10px;touch-action:none" role="img" aria-label="Planimetria tavoli">${body}</svg>`;
}
/* ---- CRUD tavoli nativo (B3) ---- */
function seatNextSeq(){ const e=ev(); e.seating=e.seating||{rules:[]}; e.seating.seq=(e.seating.seq||0)+1; return e.seating.seq; }
function addTable(){ tableEditor(null); }
function editTable(id){ tableEditor(id); }
function tableEditor(id){
  const e=ev(); e.tables=e.tables||[];
  const t=id?e.tables.find(x=>x.id===id):null, isNew=!t;
  const cur=t||{name:"Tavolo "+(e.tables.length+1),shape:"round",seats:8};
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
         e.tables.push({id:"tb"+seatNextSeq(),name,shape,seats,seatIds:new Array(seats).fill(null),x:(idx%cols)*7,y:Math.floor(idx/cols)*6});
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
    if(!st.dragging && Math.hypot(dx,dy)>6){ st.dragging=true; st.ghost.style.display=""; }
    // NB: niente setPointerCapture — i listener su document in cattura ricevono già
    // tutti i pointer event, e la cattura interferisce con la consegna del pointerup su touch.
    if(st.dragging){ e.preventDefault(); st.ghost.style.left=e.clientX+"px"; st.ghost.style.top=e.clientY+"px"; }
  }
  function onCancel(e){ if(!st || e.pointerId!==st.pointerId) return; cleanup(); st=null; }
  function onUp(e){
    if(!st || e.pointerId!==st.pointerId) return;
    const s=st, dragging=st.dragging; cleanup(); st=null;
    if(!dragging) return; // nessun movimento: era un tap, lascia partire il click (modale)
    // sopprimi il click che segue il pointerup per non aprire la modale dopo un drag
    const sup=ce=>{ ce.stopPropagation(); ce.preventDefault(); document.removeEventListener("click",sup,true); };
    document.addEventListener("click",sup,true);
    const el=document.elementFromPoint(e.clientX,e.clientY); if(!el||!el.closest) return;
    const seat=el.closest("[data-seat-target]");
    if(seat){ seatAssignCore(seat.getAttribute("data-table"), seat.getAttribute("data-idx"), s.gid); return; }
    if(el.closest("#seatTray")){ seatUnseat(s.gid); return; }
  }
  host.addEventListener("pointerdown", e=>{
    if(st) return; // trascinamento già in corso: ignora un secondo dito (multi-touch)
    const src=e.target.closest&&e.target.closest("[data-drag-guest]"); if(!src) return;
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
  <div class="card"><span class="pill todo">come funziona</span> Crea i tavoli e assegna gli ospiti: tocca un posto per sceglierlo dall'elenco, oppure trascina un nome dalla riserva su un posto (e trascinalo sulla riserva per liberarlo). Definisci le vicinanze (chi insieme, chi lontano) qui sotto, poi premi Ottimizza: l'ottimizzatore dispone i posti rispettando le vicinanze, il nucleo familiare e i bambini.</div>
  <div class="grid cards">
    <div class="card kpi"><div class="v">${tables.length}</div><div class="l">Tavoli</div></div>
    <div class="card kpi"><div class="v">${seated}/${totSeats}</div><div class="l">Posti occupati</div></div>
    <div class="card kpi"><div class="v">${unseated.length}</div><div class="l">Ospiti da sedere</div></div>
  </div>
  <div class="sec-title"><h2>Planimetria</h2><span>${tables.length?'<button class="btn sm ghost" data-act="optimizeAll">Ottimizza tutti</button> ':''}<button class="btn sm" data-act="addTable">+ Tavolo</button></span></div>
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
      <button class="btn sm" data-act="webVendor" data-id="${v.id}">Aggiorna dal web</button>
      <button class="btn sm ghost" data-act="editVendor" data-id="${v.id}">Modifica</button>
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
  <div class="card" style="margin-top:14px"><span class="pill todo">web</span> "Aggiorna dal web" funziona dentro Claude.ai: cerca e sintetizza contatti e recensioni pubbliche. Sul file autonomo la chiamata non parte e resta l'inserimento manuale. Gli eventi passati sono marcati non verificati.</div>
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
     <div class="field"><label>Recensioni (sintesi)</label><input class="inp" id="v_rev" value="${esc(x.reviews)}"></div>
     <div class="field"><label>Eventi passati</label><input class="inp" id="v_pe" value="${esc(x.pastEvents)}"></div>
     <div class="field"><label>Note / log</label><input class="inp" id="v_nt" value="${esc(x.notes)}"></div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const name=$("#v_name").value.trim(); if(!name) return;
      const data={name,category:$("#v_cat").value,status:$("#v_st").value,contact:$("#v_ref").value.trim(),phone:$("#v_ph").value.trim(),email:$("#v_em").value.trim(),website:$("#v_web").value.trim(),quote:+$("#v_q").value||0,rating:$("#v_rt").value.trim(),budgetLineId:$("#v_bl").value,reviews:$("#v_rev").value.trim(),pastEvents:$("#v_pe").value.trim(),notes:$("#v_nt").value.trim()};
      let vv;
      if(isNew){ vv=Object.assign({id:"v"+Date.now(),source:"",updated:""},data); e.vendors.push(vv); }
      else { Object.assign(v,data); vv=v; }
      if(vv.status==="confermato"&&vv.budgetLineId&&vv.quote){ const bl=e.budget.find(b=>b.id===vv.budgetLineId); if(bl) bl.quote=vv.quote; }
      commit(isNew?"Fornitore aggiunto":"Fornitore aggiornato");
    }}]);
}
function delVendor(id){ const v=ev().vendors.find(x=>x.id===id); if(!v) return; modal("Eliminare il fornitore?",`<p>Rimuovo <b>${esc(v.name)}</b>.</p>`,[{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{ ev().vendors=ev().vendors.filter(x=>x.id!==id); commit("Fornitore eliminato"); }}]); }
async function webVendor(id){
  const v=ev().vendors.find(x=>x.id===id); if(!v) return;
  const loading=modal("Aggiornamento dal web",`<p>Ricerca in corso per <b>${esc(v.name)}</b>…</p><p class="muted">Solo dentro Claude.ai.</p>`,[{label:"Annulla"}]);
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
  <div class="card"><span class="pill todo">come funziona</span> Dimensiona l'aperitivo partendo da ${meta().plannedGuests} invitati (dal modulo Ospiti). Muovi i controlli, aggiungi o togli stazioni, leggi attese e consigli. I valori variano un po' a ogni ricalcolo perché gli arrivi sono casuali. Tieni le stazioni a coda lunga lontane dall'ingresso unico del Castello.</div>
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
function genChecklist(){
  const e=ev(), base=new Date(meta().date+"T00:00:00");
  const M=n=>{ const d=new Date(base); d.setMonth(d.getMonth()-n); return d.toISOString().slice(0,10); };
  const W=n=>{ const d=new Date(base); d.setDate(d.getDate()-7*n); return d.toISOString().slice(0,10); };
  const tpl=[["Bloccare location e catering","Fornitori",M(12)],["Lista invitati preliminare","Ospiti",M(12)],["Scegliere foto e video","Fornitori",M(9)],["Scegliere musica / DJ","Fornitori",M(9)],["Acquisto abito sposa","Abiti",M(9)],["Ordinare partecipazioni","Inviti",M(6)],["Fiori e allestimenti","Fornitori",M(6)],["Scegliere torta","Fornitori",M(6)],["Prove menu e degustazione","Catering",M(3)],["Prova trucco e acconciatura","Beauty",M(3)],["Ordinare bomboniere","Extra",M(3)],["Confermare numeri al catering","Catering",M(1)],["Tableau e disposizione tavoli","Ospiti",M(1)],["Scaletta e run-of-show","Coordinamento",W(2)],["Confermare navetta e trasporti","Logistica",W(2)],["Saldo fornitori","Pagamenti",W(1)],["Kit emergenza e dettagli finali","Coordinamento",W(1)]];
  const have=new Set(e.tasks.map(t=>t.title)); let added=0;
  tpl.forEach(r=>{ if(!have.has(r[0])){ e.tasks.push({id:"k"+Date.now()+"_"+added,title:r[0],category:r[1],due:r[2],assignee:"Sposi",done:false}); added++; } });
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
      <td class="num">${t.vendorCat?`<span class="muted" style="font-size:12px" title="Voce derivata dai Fornitori (categoria ${esc(t.vendorCat)})">${tvendor?"Confermato: "+esc(tvendor.name):"da fornitore ("+esc(t.vendorCat)+")"}</span>`:`<button class="btn sm ghost" data-act="editTask" data-id="${t.id}">Modifica</button> <button class="btn sm danger" data-act="delTask" data-id="${t.id}">×</button>`}</td>
    </tr>`;
  }).join("");
  const responsibles=[...new Set(e.runshow.map(r=>r.who).filter(Boolean))];
  const rs=[...e.runshow].sort((a,b)=>(a.time||"").localeCompare(b.time||"")).filter(r=>!rsFilter||r.who===rsFilter);
  const rsrows=rs.map(r=>`<tr><td class="num">${esc(r.time||"")}</td><td>${esc(r.title)}</td><td>${esc(r.who||"")}</td><td class="num"><button class="btn sm ghost" data-act="editRs" data-id="${r.id}">Modifica</button> <button class="btn sm danger" data-act="delRs" data-id="${r.id}">×</button></td></tr>`).join("");
  return `
  <div class="grid cards">
    <div class="card kpi"><div class="v">${d.tasksDone}/${d.tasksTotal}</div><div class="l">Completate</div></div>
    <div class="card kpi"><div class="v">${d.overdue}</div><div class="l">Scadute</div></div>
  </div>
  <div class="sec-title"><h2>Checklist</h2><span><button class="btn sm ghost" data-act="genChecklist">Genera standard</button> <button class="btn sm" data-act="addTask">+ Task</button></span></div>
  <div class="scroll-x"><table class="tbl"><thead><tr><th></th><th>Attività</th><th>Scadenza</th><th></th></tr></thead><tbody>${trows||'<tr><td colspan="4" class="muted">Nessuna attività. Usa Genera standard.</td></tr>'}</tbody></table></div>
  <div class="sec-title"><h2>Run-of-show</h2><button class="btn sm" data-act="addRs">+ Momento</button></div>
  <div class="card" style="margin-bottom:10px"><div class="field"><label>Filtra per responsabile</label><select class="inp" id="rs_filter"><option value="">Tutti</option>${responsibles.map(w=>`<option value="${esc(w)}"${rsFilter===w?" selected":""}>${esc(w)}</option>`).join("")}</select></div></div>
  <div class="scroll-x"><table class="tbl"><thead><tr><th>Ora</th><th>Momento</th><th>Responsabile</th><th></th></tr></thead><tbody>${rsrows||'<tr><td colspan="4" class="muted">Nessun momento.</td></tr>'}</tbody></table></div>
  `;
}
function editTask(id){
  const e=ev(), t=e.tasks.find(x=>x.id===id), isNew=!t;
  const x=t||{title:"",category:"",due:"",assignee:"Sposi",done:false};
  modal(isNew?"Nuovo task":"Modifica task",
    `<div class="field"><label>Attività</label><input class="inp" id="t_title" value="${esc(x.title)}"></div>
     <div class="two"><div class="field"><label>Categoria</label><input class="inp" id="t_cat" value="${esc(x.category||"")}"></div>
     <div class="field"><label>Scadenza</label><input class="inp" type="date" id="t_due" value="${esc(x.due||"")}"></div></div>
     <div class="field"><label>Responsabile</label><select class="inp" id="t_as">${["Sposi","Silvia","Famiglia Righi","Famiglia Biondi","Wedding planner"].map(a=>`<option${x.assignee===a?" selected":""}>${a}</option>`).join("")}</select></div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const title=$("#t_title").value.trim(); if(!title) return;
      const data={title,category:$("#t_cat").value.trim(),due:$("#t_due").value,assignee:$("#t_as").value};
      if(isNew){ e.tasks.push(Object.assign({id:"k"+Date.now(),done:false},data)); } else Object.assign(t,data);
      commit(isNew?"Task aggiunto":"Task aggiornato");
    }}]);
}
function delTask(id){ ev().tasks=ev().tasks.filter(x=>x.id!==id); commit("Task rimosso"); }
function editRs(id){
  const e=ev(), r=e.runshow.find(x=>x.id===id), isNew=!r;
  const x=r||{time:"",title:"",who:""};
  modal(isNew?"Nuovo momento":"Modifica momento",
    `<div class="two"><div class="field"><label>Ora</label><input class="inp" id="r_time" value="${esc(x.time||"")}" placeholder="20:00"></div>
     <div class="field"><label>Responsabile</label><input class="inp" id="r_who" value="${esc(x.who||"")}"></div></div>
     <div class="field"><label>Momento</label><input class="inp" id="r_title" value="${esc(x.title||"")}"></div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const title=$("#r_title").value.trim(); if(!title) return;
      const data={time:$("#r_time").value.trim(),title,who:$("#r_who").value.trim()};
      if(isNew){ e.runshow.push(Object.assign({id:"r"+Date.now()},data)); } else Object.assign(r,data);
      commit(isNew?"Momento aggiunto":"Momento aggiornato");
    }}]);
}
function delRs(id){ ev().runshow=ev().runshow.filter(x=>x.id!==id); commit("Momento rimosso"); }

/* ============ NOTE & LISTE ============ */
function viewLists(){
  const e=ev();
  const cards=e.lists.map(l=>`<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h3>${esc(l.title)}</h3><button class="btn sm danger" data-act="delList" data-id="${l.id}">Elimina</button></div>
    <div style="margin:8px 0">${l.items.length?l.items.map((it,i)=>`<div style="padding:4px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px"><span>${esc(it)}</span><button class="btn sm danger" data-act="delItem" data-id="${l.id}" data-i="${i}">×</button></div>`).join(""):'<span class="muted">Vuota.</span>'}</div>
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
const STAGE={vendors:"S4 — CRM fornitori con aggiornamento dal web (solo in Claude.ai; fuori degrada a inserimento manuale).",
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
       <div class="field"><label>Tipo costo</label><select class="inp" id="f_ct"><option value="fixed"${b.costType==="fixed"?" selected":""}>Fisso</option><option value="perGuest"${b.costType==="perGuest"?" selected":""}>A persona</option></select></div>
       <div class="field"><label>${b.costType==="perGuest"?"Tariffa a persona (€)":"Stima (€)"}</label><input class="inp" type="number" id="f_est" value="${b.costType==="perGuest"?(b.perHead||0):b.estimated}"></div>
     </div>
     <div class="two">
       <div class="field"><label>Preventivo (€)</label><input class="inp" type="number" id="f_quote" value="${b.quote||0}"></div>
       <div class="field"><label>Effettivo (€)</label><input class="inp" type="number" id="f_act" value="${b.actual||0}"></div>
     </div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      b.item=$("#f_item").value.trim()||b.item;
      b.costType=$("#f_ct").value;
      const val=+$("#f_est").value||0;
      if(b.costType==="perGuest"){ b.perHead=val; } else { b.estimated=val; }
      b.quote=+$("#f_quote").value||0; b.actual=+$("#f_act").value||0;
      commit("Voce aggiornata");
    }}]);
}
function addBudget(){
  modal("Nuova voce",
    `<div class="field"><label>Voce</label><input class="inp" id="n_item" placeholder="Es. Noleggio lounge"></div>
     <div class="two"><div class="field"><label>Tier</label><select class="inp" id="n_tier">${[1,2,3,4,5].map(t=>`<option value="${t}">${TIER[t]}</option>`).join("")}</select></div>
     <div class="field"><label>Stima (€)</label><input class="inp" type="number" id="n_est" value="0"></div></div>`,
    [{label:"Annulla"},{label:"Aggiungi",cls:"",fn:()=>{
      const item=$("#n_item").value.trim(); if(!item) return;
      ev().budget.push({id:"b"+Date.now(),tier:+$("#n_tier").value,item,estimated:+$("#n_est").value||0,quote:0,actual:0,costType:"fixed",perHead:0,vendorId:null,dueDate:null,paid:false});
      commit("Voce aggiunta");
    }}]);
}
/* ============ IMPORT GUIDATO LISTE (motore nativo, E1) ============ */
function impNorm(s){ return String(s==null?'':s).toLowerCase().trim().replace(/[àáâ]/g,'a').replace(/[èéê]/g,'e').replace(/[ìí]/g,'i').replace(/[òóô]/g,'o').replace(/[ùú]/g,'u').replace(/\s+/g,' '); }
function impDelim(text){
  const line=(text.split(/\r?\n/).find(l=>l.trim()!=='')||'');
  const counts={'\t':0,';':0,',':0}; let q=false;
  for(const ch of line){ if(ch==='"') q=!q; else if(!q && counts[ch]!==undefined) counts[ch]++; }
  let best=',',bc=-1; for(const d of ['\t',';',',']){ if(counts[d]>bc){ bc=counts[d]; best=d; } }
  return bc>0?best:',';
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
function impMeal(v){ const n=impNorm(v);
  if(['bambino','bimbo','bimba','child','kid','baby','bambini','ridotto'].includes(n)) return 'bambino';
  if(['vegetariano','vegetariana','veg','vegetarian'].includes(n)) return 'vegetariano';
  if(['vegano','vegana','vegan'].includes(n)) return 'vegano';
  if(['celiaco','celiaca','senza glutine','gluten free','gf','sg','no glutine'].includes(n)) return 'celiaco';
  return 'adulto';
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
      meal: mapping.meal!=null ? impMeal(get(r,'meal')) : 'adulto',
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

function editGuest(id){
  const g=ev().guests.find(x=>x.id===id); const isNew=!g;
  const x=g||{name:"",side:"A",household:"",rsvp:"attesa",meal:"adulto",intolerances:"",accessibility:"",shuttle:false,plusOne:0};
  modal(isNew?"Nuovo ospite":"Modifica ospite",
    `<div class="field"><label>Nome</label><input class="inp" id="g_name" value="${esc(x.name)}"></div>
     <div class="two">
       <div class="field"><label>Lato</label><select class="inp" id="g_side"><option value="A"${x.side==="A"?" selected":""}>${meta().coupleA}</option><option value="B"${x.side==="B"?" selected":""}>${meta().coupleB}</option></select></div>
       <div class="field"><label>Nucleo</label><input class="inp" id="g_hh" value="${esc(x.household)}"></div>
     </div>
     <div class="two">
       <div class="field"><label>RSVP</label><select class="inp" id="g_rsvp">${Object.keys(RSVP).map(k=>`<option value="${k}"${x.rsvp===k?" selected":""}>${RSVP[k][1]}</option>`).join("")}</select></div>
       <div class="field"><label>Menù</label><select class="inp" id="g_meal">${MEALS.map(m=>`<option value="${m}"${x.meal===m?" selected":""}>${m}</option>`).join("")}</select></div>
     </div>
     <div class="two">
       <div class="field"><label>Intolleranze</label><input class="inp" id="g_int" value="${esc(x.intolerances)}"></div>
       <div class="field"><label>Accompagnatori (+)</label><input class="inp" type="number" id="g_plus" value="${x.plusOne||0}" min="0"></div>
     </div>
     <div class="two">
       <div class="field"><label>Accessibilità</label><input class="inp" id="g_acc" value="${esc(x.accessibility)}" placeholder="Seggiolone, disabili…"></div>
       <div class="field"><label>Navetta</label><select class="inp" id="g_sh"><option value="0"${!x.shuttle?" selected":""}>No</option><option value="1"${x.shuttle?" selected":""}>Sì</option></select></div>
     </div>`,
    [{label:"Annulla"},{label:"Salva",cls:"",fn:()=>{
      const name=$("#g_name").value.trim(); if(!name) return;
      const data={name,side:$("#g_side").value,household:$("#g_hh").value.trim()||"Senza nucleo",rsvp:$("#g_rsvp").value,meal:$("#g_meal").value,intolerances:$("#g_int").value.trim(),accessibility:$("#g_acc").value.trim(),shuttle:$("#g_sh").value==="1",plusOne:+$("#g_plus").value||0};
      if(isNew){ ev().guests.push(Object.assign({id:"g"+Date.now(),gift:"",thanked:false},data)); }
      else Object.assign(g,data);
      commit(isNew?"Ospite aggiunto":"Ospite aggiornato");
    }}]);
}
function delGuest(id){
  const g=ev().guests.find(x=>x.id===id); if(!g) return;
  modal("Eliminare l'ospite?",`<p>Stai per rimuovere <b>${esc(g.name)}</b>. L'azione non è reversibile.</p>`,
    [{label:"Annulla"},{label:"Elimina",cls:"danger",fn:()=>{
      ev().guests=ev().guests.filter(x=>x.id!==id); commit("Ospite eliminato");
    }}]);
}

/* ============ EVENT MENU (nuovo/reset/clona/export/import con guardrail) ============ */
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
    `<p class="muted" style="margin-bottom:10px">Motore generico: un evento attivo, riutilizzabile e portabile.</p>`,
    [{label:"Esporta",cls:"ghost",fn:()=>exportEvent(),close:false},
     {label:"Importa",cls:"ghost",fn:()=>{importEvent();},},
     {label:"Guida",cls:"ghost",fn:()=>{openGuide(0);},close:false},
     {label:"Diagnostica",cls:"ghost",fn:()=>{openDiag();},close:false},
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
  { tab:"guests", title:"Ospiti & RSVP", body:`<p>La sorgente unica degli invitati: nome, lato (sposo A / sposa B), nucleo, RSVP, pasto, intolleranze, accessibilità, navetta, +1.</p><p>Hai già una lista? Usa + Importa: incolli o carichi un CSV/TSV, l'app riconosce le colonne, toglie i doppioni e unisce. Il numero invitati alimenta anche il simulatore aperitivo.</p>` },
  { tab:"vendors", title:"Fornitori", body:`<p>Il piccolo CRM dei fornitori con i loro stati (da valutazione a confermato) e i preventivi. Un fornitore "Confermato" spunta automaticamente il task collegato nella Timeline, e mostra lì il suo nome.</p>` },
  { tab:"seating", title:"Tavoli", body:`<p>Planimetria nativa. Crea i tavoli con + Tavolo scegliendo forma e numero di posti.</p><p>Per sedere un ospite: tocca un posto e scegli dall'elenco, oppure trascina un nome dalla "Riserva ospiti" su un posto. Trascina un ospite sulla riserva per liberarlo. "Ottimizza" dispone il tavolo rispettando vicini e vincoli.</p>` },
  { tab:"aperitivo", title:"Aperitivo", body:`<p>Il simulatore delle code dell'aperitivo: imposta stazioni, personale e tempi di arrivo, e vedi attese e code stimate. Salva più scenari e confrontali per decidere quanti camerieri servono.</p>` },
  { tab:"timeline", title:"Timeline", body:`<p>La checklist a ritroso dalla data delle nozze e la scaletta del giorno (run-of-show). I task legati a una categoria di fornitore si spuntano da soli quando quel fornitore è confermato.</p>` },
  { tab:"lists", title:"Note & Liste", body:`<p>Liste pronte: musica da suonare e da evitare, ordine della processione, foto di famiglia, packing. Aggiungi voci e nuove liste secondo necessità.</p>` },
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

// Suggerimento contestuale per scheda (riga compatta in cima alla vista).
const TAB_TIP={
  dash:"I numeri chiave a colpo d'occhio. Apri la Guida per il tour completo.",
  budget:"Aggiungi voci e rate; collega i fornitori alle voci di budget.",
  guests:"Sorgente unica degli ospiti. Hai una lista? Usa + Importa (CSV/TSV).",
  vendors:"Censisci i fornitori. 'Confermato' spunta i task collegati in Timeline.",
  seating:"Crea i tavoli, poi assegna: tocca un posto o trascina dalla riserva.",
  aperitivo:"Simula le code dell'aperitivo e confronta scenari di personale.",
  timeline:"Checklist a ritroso e scaletta; i task da fornitore si spuntano da soli.",
  lists:"Liste pronte per musica, processione, foto e packing."
};
let tipHidden={};
function hintBanner(tab){
  if(tipHidden[tab]||!TAB_TIP[tab]) return "";
  return `<div class="card" style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px;border-left:3px solid var(--sea)">`
    +`<span style="font-size:13px">${esc(TAB_TIP[tab])}</span>`
    +`<span style="white-space:nowrap"><button class="btn sm ghost" data-act="openGuide">Guida</button> <button class="btn sm ghost" data-act="hideTip" aria-label="Nascondi suggerimento">Nascondi</button></span></div>`;
}

/* ============ EVENTS ============ */
document.addEventListener("click",e=>{ try{
  const tab=e.target.closest("[data-tab]"); if(tab){ active=tab.getAttribute("data-tab"); render(); return; }
  const a=e.target.closest("[data-act]"); if(!a) return;
  const act=a.getAttribute("data-act"), id=a.getAttribute("data-id");
  if(act==="editBudget") editBudget(id);
  else if(act==="addBudget") addBudget();
  else if(act==="togglePay"){ const p=ev().payments.find(x=>x.id===id); if(p){p.paid=!p.paid; commit(p.paid?"Rata segnata pagata":"Rata riaperta");} }
  else if(act==="applyPlan"){ const g=+$("#plg").value||0, c=+$("#cpct").value||0; meta().plannedGuests=g; meta().contingencyPct=c; commit("Pianificazione aggiornata"); }
  else if(act==="importGuests") importWizard();
  else if(act==="addGuest") editGuest(null);
  else if(act==="editGuest") editGuest(id);
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
  else if(act==="addRule") seatRuleEditor();
  else if(act==="delRule") delSeatRule(id);
  else if(act==="assignSeat") assignSeat(a.getAttribute("data-table"), a.getAttribute("data-idx"));
  else if(act==="openGuide") openGuide(0);
  else if(act==="hideTip"){ tipHidden[active]=true; render(); }
  }catch(err){ Diag.log("action","azione fallita",(err&&err.stack)||(err&&err.message)); toast("Si è verificato un errore"); }
});
$("#gearBtn").addEventListener("click",openGear);
document.addEventListener("change",function(e){ if(e.target&&e.target.id==="rs_filter"){ rsFilter=e.target.value; render(); } });
/* ============ INIT ============ */
(async function(){
  STATE=await Store.load();
  if(!STATE||!STATE.events){ STATE=seedState(); Store.save(STATE); }
  recompute(); render();
  if(!STATE.onboarded) openGuide(0);
})();
})();
