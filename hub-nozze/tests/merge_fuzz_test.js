"use strict";
/* FUZZ STRUTTURATO di merge3 (P2): genera scenari casuali RIPRODUCIBILI (PRNG
   con seed) — stato realistico + script di modifiche concorrenti per due
   dispositivi — e verifica le PROPRIETA' del merge su ognuno:
   P1 nessuna perdita (modifiche/aggiunte su entita' non toccate dall'altro lato)
   P2 cancellazione rispettata (cancellata da uno, intoccata dall'altro -> via)
   P3 la modifica vince sulla cancellazione
   P4 determinismo (stessi input -> stesso output, due volte)
   P5 simmetria (scambiando i lati, stesse entita' e stessi contenuti)
   P6 identita' (un lato senza modifiche -> vince l'altro tal quale)
   P7 sopravvive al round-trip JSON (niente undefined/cicli)
   P8 struttura valida (events presenti, collezioni ancora array, id integri)
   Il numero di casi si controlla con FUZZ_N (default 400 in suite). */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "const DIAG_KEY=";
const END = "/* ============ SEED";
const S = sandbox(START, END, ["merge3","Sync","makeMemoryRemote"], {});
const merge3 = S.merge3;

const N = +(process.env.FUZZ_N || 400);
const SEED0 = +(process.env.FUZZ_SEED || 20260709);

// PRNG deterministico (mulberry32)
function rng(seed){ let t=seed>>>0; return function(){ t+=0x6D2B79F5; let r=Math.imul(t^t>>>15,1|t); r^=r+Math.imul(r^r>>>7,61|r); return ((r^r>>>14)>>>0)/4294967296; }; }
const D=x=>JSON.parse(JSON.stringify(x));
const J=x=>JSON.stringify(x);

// ---- generatore di stato realistico ----
function mkState(rnd){
  const nV=2+Math.floor(rnd()*4), nP=2+Math.floor(rnd()*4), nG=3+Math.floor(rnd()*5), nT=1+Math.floor(rnd()*3);
  const vendors=[], payments=[], guests=[], tasks=[];
  for(let i=0;i<nV;i++) vendors.push({id:"v"+i,name:"Fornitore "+i,category:["Location","Catering","Fiori","Musica/DJ"][i%4],status:["valutazione","opzione","confermato"][Math.floor(rnd()*3)],quote:Math.floor(rnd()*10000),notes:""});
  for(let i=0;i<nP;i++) payments.push({id:"p"+i,label:"Rata "+i,amount:100+Math.floor(rnd()*9000),dueDate:"2027-0"+(1+i%9)+"-15",paid:rnd()<.3,method:"Bonifico",vendorId:rnd()<.5?("v"+Math.floor(rnd()*nV)):null});
  for(let i=0;i<nG;i++) guests.push({id:"g"+i,name:"Ospite "+i,side:rnd()<.5?"A":"B",household:"H"+(i%3),group:"",rsvp:["conf","attesa","no"][Math.floor(rnd()*3)],meal:"adulto",intolerances:"",accessibility:"",shuttle:rnd()<.2,plusOne:rnd()<.1?1:0,gift:"",thanked:false});
  for(let i=0;i<nT;i++) tasks.push({id:"k"+i,title:"Attivita "+i,category:"Generale",due:"2027-03-0"+(1+i%9),assignee:"Sposi",done:rnd()<.3});
  return { schema:1, _savedAt:1000, activeEventId:"ev1", events:{ ev1:{
    id:"ev1", meta:{coupleA:"Righi",coupleB:"Biondi",venue:"Castello",plannedGuests:100+Math.floor(rnd()*100),contingencyPct:8},
    vendors, payments, guests, tasks,
    lists:[{id:"l1",title:"Lista",items:["a","b"]}], tables:[], runshow:[], budget:[], seating:{rules:[]}
  }}};
}

// ---- script di modifiche: ogni operazione registra cosa ha fatto ----
const COLLS=["vendors","payments","guests","tasks"];
const FIELDS={vendors:["quote","status","notes"],payments:["amount","paid","label"],guests:["rsvp","meal","shuttle"],tasks:["done","title","due"]};
function randVal(rnd,coll,f){
  if(f==="paid"||f==="done"||f==="shuttle") return rnd()<.5;
  if(f==="quote"||f==="amount") return Math.floor(rnd()*20000);
  if(f==="status") return ["valutazione","opzione","confermato","scartato"][Math.floor(rnd()*4)];
  if(f==="rsvp") return ["conf","attesa","no"][Math.floor(rnd()*3)];
  if(f==="due") return "2027-0"+(1+Math.floor(rnd()*9))+"-2"+Math.floor(rnd()*8);
  return "X"+Math.floor(rnd()*1e6);
}
function applyEdits(doc, rnd, tag, nOps){
  const log=[]; const e=doc.events.ev1;
  for(let i=0;i<nOps;i++){
    const coll=COLLS[Math.floor(rnd()*COLLS.length)], arr=e[coll];
    const op=rnd();
    if(op<0.45 && arr.length){                       // modifica campo
      const it=arr[Math.floor(rnd()*arr.length)];
      const f=FIELDS[coll][Math.floor(rnd()*FIELDS[coll].length)];
      const v=randVal(rnd,coll,f); it[f]=v;
      log.push({t:"mod",coll,id:it.id,f,v});
    } else if(op<0.7){                                // aggiunta
      const id=tag+"_"+coll+"_"+i;
      const nu={id,name:"Nuovo "+id};
      if(coll==="payments"){ nu.label="Rata "+id; nu.amount=1+Math.floor(rnd()*5000); nu.paid=false; }
      if(coll==="tasks"){ nu.title="Task "+id; nu.done=false; }
      if(coll==="guests"){ nu.rsvp="attesa"; nu.meal="adulto"; }
      arr.push(nu);
      log.push({t:"add",coll,id});
    } else if(arr.length>1){                          // cancellazione
      const idx=Math.floor(rnd()*arr.length), id=arr[idx].id;
      arr.splice(idx,1);
      log.push({t:"del",coll,id});
    }
  }
  return log;
}
const byId=(m,coll)=>{ const mp=new Map(); (m.events.ev1[coll]||[]).forEach(x=>mp.set(x.id,x)); return mp; };
const touched=log=>{ const s=new Set(); log.forEach(o=>s.add(o.coll+":"+o.id)); return s; };
const canon=m=>{ const c=D(m); COLLS.forEach(k=>{ if(Array.isArray(c.events.ev1[k])) c.events.ev1[k].sort((x,y)=>String(x.id).localeCompare(String(y.id))); }); return J(c); };

let fails=0, run=0;
const problems=[];
for(let caseN=0; caseN<N; caseN++){
  const seed=SEED0+caseN, rnd=rng(seed);
  const base=mkState(rnd);
  const a=D(base), b=D(base);
  const logA=applyEdits(a,rnd,"A",1+Math.floor(rnd()*6));
  const logB=applyEdits(b,rnd,"B",1+Math.floor(rnd()*6));
  a._savedAt=2000; b._savedAt=2010;
  const tA=touched(logA), tB=touched(logB);
  try{
    const m=merge3(D(base),D(a),D(b),2000,2010);
    run++;
    // P7: round-trip
    const m2=JSON.parse(JSON.stringify(m));
    assert.strictEqual(J(m),J(m2),"P7 round-trip");
    // P8: struttura
    assert(m && m.events && m.events.ev1, "P8 events");
    COLLS.forEach(k=>assert(Array.isArray(m.events.ev1[k]),"P8 "+k+" array"));
    COLLS.forEach(k=>m.events.ev1[k].forEach(x=>assert(x && x.id!=null,"P8 id mancante in "+k)));
    // P4: determinismo
    assert.strictEqual(J(m), J(merge3(D(base),D(a),D(b),2000,2010)), "P4 determinismo");
    // P5: simmetria (canonicalizzata; i conflitti stesso-campo risolvono uguale via ts)
    assert.strictEqual(canon(m), canon(merge3(D(base),D(b),D(a),2010,2000)), "P5 simmetria");
    // P6: identita'
    assert.strictEqual(J(merge3(D(base),D(base),D(b),1,2)), J(b), "P6 identita' (a=base)");
    assert.strictEqual(J(merge3(D(base),D(a),D(base),2,1)), J(a), "P6 identita' (b=base)");
    // P1/P2/P3 sull'ORACOLO ESATTO: diff effettivo base->doc per ciascun lato
    // (il log delle operazioni puo' essere rumoroso: add poi del dello stesso
    // lato, o una "modifica" che reimposta il valore gia' presente).
    for(const coll of COLLS){
      const m0=byId(base,coll), mA=byId(a,coll), mB=byId(b,coll), mM=byId(m,coll);
      const ids=new Set([...m0.keys(),...mA.keys(),...mB.keys()]);
      for(const id of ids){
        const e0=m0.get(id), eA=mA.get(id), eB=mB.get(id), eM=mM.get(id);
        const key=coll+":"+id;
        const chgA = e0===undefined ? eA!==undefined : (eA===undefined || J(eA)!==J(e0)); // A ha toccato?
        const chgB = e0===undefined ? eB!==undefined : (eB===undefined || J(eB)!==J(e0));
        if(!chgA && !chgB){ assert(eM && J(eM)===J(e0), "intoccata alterata "+key); continue; }
        if(chgA && !chgB){
          if(eA===undefined) assert(!eM, "P2 cancellazione A non rispettata "+key);
          else assert(eM && J(eM)===J(eA), "P1 modifica/aggiunta A persa "+key);
          continue;
        }
        if(chgB && !chgA){
          if(eB===undefined) assert(!eM, "P2 cancellazione B non rispettata "+key);
          else assert(eM && J(eM)===J(eB), "P1 modifica/aggiunta B persa "+key);
          continue;
        }
        // toccata da ENTRAMBI
        if(eA===undefined && eB===undefined){ assert(!eM, "cancellata da entrambi ma presente "+key); continue; }
        if(eA===undefined){ assert(eM && J(eM)===J(eB), "P3 modifica B doveva vincere sulla cancellazione A "+key); continue; }
        if(eB===undefined){ assert(eM && J(eM)===J(eA), "P3 modifica A doveva vincere sulla cancellazione B "+key); continue; }
        // entrambi modificata: campo per campo
        assert(eM, "entita' modificata da entrambi sparita "+key);
        const fields=new Set([...Object.keys(eA),...Object.keys(eB)]);
        for(const f of fields){
          const f0=e0?e0[f]:undefined;
          const dA=J(eA[f])!==J(f0), dB=J(eB[f])!==J(f0);
          if(dA && !dB) assert.strictEqual(J(eM[f]),J(eA[f]),"campo di A perso "+key+"."+f);
          else if(dB && !dA) assert.strictEqual(J(eM[f]),J(eB[f]),"campo di B perso "+key+"."+f);
          else if(dA && dB) assert.strictEqual(J(eM[f]),J(eB[f]),"stesso campo: doveva vincere B (ts) "+key+"."+f);
          else assert.strictEqual(J(eM[f]),J(f0),"campo intoccato alterato "+key+"."+f);
        }
      }
    }
  }catch(err){
    fails++;
    if(problems.length<5) problems.push("seed "+seed+": "+err.message);
  }
}
console.log("merge_fuzz_test: "+(run-fails)+"/"+N+(fails?("  ("+fails+" FAIL)"):"")+"  [seed base "+SEED0+", N="+N+"]");
problems.forEach(p=>console.error("  FAIL [merge_fuzz] "+p));
if(fails) process.exitCode=1;

/* ---- FUZZ del FLUSSO: round multipli di conflitto tra due dispositivi.
   A usa il motore Sync reale (con antenato); B pusha direttamente sul remoto.
   Modifiche DISGIUNTE garantite (A tocca i fornitori, B i pagamenti): dopo
   ogni round devono esserci TUTTE, e i push successivi devono filare lisci. */
(async function(){
  const NF=+(process.env.FLOW_N||120);
  let ok=0, bad=0; const errs=[];
  for(let c=0;c<NF;c++){
    const rnd=rng(500000+c);
    try{
      const r=S.makeMemoryRemote();
      let adopted=null;
      S.Sync.enable(r,{version:0,onRemoteWin:st=>{adopted=st;}});
      let cur=mkState(rnd);
      await S.Sync.flush(D(cur));                       // v1: antenato condiviso
      const rounds=1+Math.floor(rnd()*3);
      for(let round=0; round<rounds; round++){
        // B: modifica un pagamento e pusha direttamente sopra l'ultima versione
        const remoteDoc=JSON.parse((await r.pull()).data);
        const docB=D(remoteDoc); docB._savedAt=3000+round*10;
        const pB=docB.events.ev1.payments[Math.floor(rnd()*docB.events.ev1.payments.length)];
        pB.amount=(pB.amount||0)+1000+round; pB.paid=!pB.paid;
        await r.push((await r.pull()).version, JSON.stringify(docB));
        // A: parte dall'ultima versione che CONOSCE (cur) e tocca un fornitore
        const docA=D(cur); docA._savedAt=3005+round*10;
        const vA=docA.events.ev1.vendors[Math.floor(rnd()*docA.events.ev1.vendors.length)];
        vA.quote=(vA.quote||0)+500+round; vA.status="confermato";
        adopted=null;
        await S.Sync.flush(docA);                       // conflitto -> merge
        // il locale adotta il merge: da qui in poi A riparte dal risultato fuso
        cur=adopted||docA;
        const got=JSON.parse((await r.pull()).data), e=got.events.ev1;
        const gv=e.vendors.find(x=>x.id===vA.id), gp=e.payments.find(x=>x.id===pB.id);
        if(!(gv&&gv.quote===vA.quote&&gv.status==="confermato")) throw new Error("round "+round+": modifica fornitore persa");
        if(!(gp&&gp.amount===pB.amount&&gp.paid===pB.paid)) throw new Error("round "+round+": modifica pagamento persa");
        if(S.Sync.getStatus()!=="synced") throw new Error("round "+round+": status "+S.Sync.getStatus());
      }
      S.Sync.disable(); ok++;
    }catch(err){ S.Sync.disable(); bad++; if(errs.length<5) errs.push("case "+c+": "+err.message); }
  }
  console.log("merge_flow_fuzz: "+ok+"/"+NF+(bad?("  ("+bad+" FAIL)"):""));
  errs.forEach(e=>console.error("  FAIL [merge_flow_fuzz] "+e));
  if(bad) process.exitCode=1;
})();
