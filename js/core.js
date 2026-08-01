"use strict";
const LEVELS=[1,2,4,8,16,32,64,128,256,512,1024,2048,4096];
const RAWS=["Ingots","Bits","Concrete"];
const PRODUCTS=["Glass","Bricks","Plates","Rods","Frames","Gel","Wire"];
// Display order matching the in-game material list (raws and crafted interleaved).
// Every menu/list shown to the user renders in this order; RAWS/PRODUCTS stay the
// solver-facing groupings.
const GAME_ORDER=["Bits","Concrete","Glass","Bricks","Gel","Ingots","Plates","Rods","Frames","Wire"];
// Gel is produced only on user-reserved lines (free mined ore inputs), never freely crafted by the optimizer.
const GEL="Gel";
const RECIPE={
  Glass:{inputs:["Bits"]},
  Bricks:{inputs:["Concrete"]},
  Plates:{inputs:["Ingots"]},
  Rods:{inputs:["Ingots"]},
  Frames:{inputs:["Plates","Rods"]},
  Gel:{inputs:[]},
  Wire:{inputs:["Gel","Rods"]}   // Bits are pre-produced (see PREPROD_BITS), never given a crafting line
};
const KIND={Ingots:"raw",Bits:"raw",Concrete:"raw",Glass:"pr",Bricks:"pr",Plates:"pr",Rods:"pr",Frames:"fin",Gel:"pr",Wire:"fin"};
// Bits consumed per uncompressed unit by products that assume their Bits are PRE-PRODUCED —
// kept OUT of the line optimization (Bits never earn a dedicated crafting line for these), used
// only for the planning readout / pre-produce demand. Frames: 8 Bits each; Wire: 2 Bits each
// (its recipe's old Bits coefficient). Glass keeps Bits as a real, line-crafted input.
const PREPROD_BITS={Frames:8,Wire:2};
const FRAME_BITS=PREPROD_BITS.Frames;   // back-compat alias
/* ---- project unlock dependencies (shopping-list ordering) ----
   A project that unlocks a craftable material: anything consuming that material must be
   scheduled after it. Keyed by catalog id → unlocked material. Only enforced when the
   unlock project is itself in the list (the only signal we have that it's still locked). */
const UNLOCKS={"frame-factory":"Frames","gel-refinery":"Gel","wire-tower":"Wire"};
const UNLOCK_MATERIALS=Object.keys(UNLOCKS).map(k=>UNLOCKS[k]);   // ["Frames","Gel","Wire"]
/* Explicit "finish project X before project Y" building unlocks not captured by material
   costs. Keyed by the dependent's catId → prerequisite catIds; extend as the tree is
   confirmed. (Subsurface Scan Towers gate Frame Factory but aren't catalog projects, so
   they can never be in the list and need no edge here.) */
const PROJECT_PREREQS={"gel-refinery":["vescas-workshop-mk2"]};
/* ---- project-mode + shopping-list helpers (additive; match live's existing inline behavior) ---- */
const ALLITEMS=[...GAME_ORDER];   // same members as RAWS+PRODUCTS, in in-game display order
const MIN_CRAFT_S=1;
function effSpeed(sp,ct){return Math.min(sp,(ct||Infinity)/MIN_CRAFT_S);}
// Final max crafting speed for a line. The user enters the speed × they currently see
// in-game (spx) plus how many turbo stacks are active right now (turbo, +1% each). Back
// out the base (turbo-free) speed, then project it up to the global maximum turbo stacks
// (S.maxTurbo) — the sustained ceiling the planner solves against.
function lineSpeed(row){
  const disp=Math.max(1e-6,num(row.spx)||1);
  const cur=Math.max(0,num(row.turbo)||0);
  const mx=Math.max(0,num(S.maxTurbo)||0);
  return (disp/(1+cur/100))*(1+mx/100);
}
// Duplication chance (%), entered once and global to every crafter — the average %
// of crafts that drop a free duplicate. dupeMult() is the output multiplier.
function dupeChance(){return Math.max(0,num(S.dupe)||0);}
function dupeMult(){return 1+dupeChance()/100;}
const newId=()=>"p"+Date.now().toString(36)+Math.floor(Math.random()*46656).toString(36);
const escapeAttr=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
function fmtDuration(h){
  if(!isFinite(h)||h<=0)return "—";
  let s=Math.round(h*3600);
  const d=Math.floor(s/86400);s-=d*86400;
  const hr=Math.floor(s/3600);s-=hr*3600;
  const m=Math.floor(s/60);s-=m*60;
  const parts=[];if(d)parts.push(d+"d");if(hr)parts.push(hr+"h");if(m)parts.push(m+"m");
  if(!d&&!hr&&(s>0||!m))parts.push(s+"s");
  return parts.slice(0,3).join(" ")||"0s";
}

function defaults(){
  const c=(coef)=>{const o={};LEVELS.forEach(L=>{o[L]=coef*Math.pow(3,Math.log2(L));});return o;};
  const prodCost={
    Glass:{Bits:c(2)},
    Bricks:{Concrete:c(3)},
    Plates:{Ingots:c(2)},
    Rods:{Ingots:c(2)},
    Frames:{Plates:c(2),Rods:c(4)},
    Gel:{},                                  // free mined ore inputs — not modelled
    Wire:{Gel:c(2),Rods:c(16)}               // Bits pre-produced (PREPROD_BITS.Wire), not a line input
  };
  const baseTime={Ingots:10,Bits:6.178,Concrete:9.273,Glass:92.68,Bricks:108.2,Plates:30.89,Rods:46.34,Frames:308.9,Gel:3201,Wire:5400.8};
  const nulls=()=>{const o={};[...RAWS,...PRODUCTS].forEach(it=>o[it]=null);return o;};
  const tg={};PRODUCTS.forEach(p=>tg[p]={on:p==="Frames",w:1});RAWS.forEach(r=>tg[r]={on:false,w:1});
  return {
    lines:[
      {max:512,spx:49.38,turbo:0},
      {max:512,spx:45.02,turbo:0},
      {max:128,spx:43.85,turbo:0},
      {max:64,spx:45.20,turbo:0},
      {max:32,spx:42.87,turbo:0}
    ],
    maxTurbo:0,dupe:12.40,
    prodCost,baseTime,margin:0,mode:"items",solveBudget:2000,
    sellPrice:nulls(),priceText:{},
    forgie:nulls(),forgieText:{},
    gelVesp:null,gelVespText:"",
    targets:tg,
    projects:[],inventory:nulls(),inventoryText:{},projectSeq:true,projectGate:true,
    // How a project phase uses each crafting line. "split" (default) = the makespan LP, where a line
    // may divide its time between jobs ("Ingots for 35m, then Concrete for 7m") to finish the phase as
    // fast as possible. "static" = set & forget: one job per line for the whole phase, chosen so every
    // demanded item finishes at roughly the same time. See staticSchedule() in solver.js.
    projLineMode:"split",
    planStart:null,
    manual:[],manualSaved:[],manualActiveId:null
  };
}

// Manual mode: keep S.manual (one {job,lvl} per line) in sync with the line list,
// clamping each level to its line's max cap and falling back to idle on bad data.
function syncManual(st){
  if(!st)return;
  if(!Array.isArray(st.manual))st.manual=[];
  (st.lines||[]).forEach((ln,i)=>{
    let m=st.manual[i];
    if(!m||typeof m!=="object")m={job:"Idle",lvl:ln.max,sell:false};
    if(m.job!=="Idle"&&!ALLITEMS.includes(m.job))m.job="Idle";
    if(!LEVELS.includes(m.lvl))m.lvl=ln.max;
    if(m.lvl>ln.max)m.lvl=ln.max;
    m.sell=!!m.sell;
    st.manual[i]=m;
  });
  st.manual.length=(st.lines||[]).length;
}

const LSKEY="forgePlannerState_v3";
function normalize(st){if(!st)return st;if(!Array.isArray(st.lines))st.lines=[];st.lines.forEach(l=>{if(l.spx==null||isNaN(l.spx)||l.spx<=0)l.spx=1;if(l.turbo==null||isNaN(l.turbo)||l.turbo<0)l.turbo=0;});if(st.maxTurbo==null||isNaN(st.maxTurbo)||st.maxTurbo<0)st.maxTurbo=0;if(st.dupe==null||isNaN(st.dupe)||st.dupe<0){let _d;if(st.attrDupe!=null&&!isNaN(st.attrDupe))_d=Math.max(0,Number(st.attrDupe)+(Number(st.maxTurbo)||0)*(Number(st.trio4)||0));else{const _l=st.lines.find(l=>l&&l.dup!=null&&!isNaN(l.dup));_d=_l?_l.dup:12.40;}st.dupe=_d;}delete st.attrDupe;delete st.trio4;if(st.margin==null||isNaN(st.margin))st.margin=0;if(st.solveBudget==null||isNaN(st.solveBudget)||st.solveBudget<200||st.solveBudget>60000)st.solveBudget=2000;if(!st.baseTime)st.baseTime={};const _DB=defaults().baseTime,_PB={Ingots:9.63,Bits:9.63,Concrete:9.63,Glass:87.3,Bricks:114.3,Plates:29.23,Rods:44.46,Frames:311.38};const _migrate=!st.baseTimeRev||st.baseTimeRev<2;[...RAWS,...PRODUCTS].forEach(it=>{const v=st.baseTime[it];if(v==null||isNaN(v)||v<=0)st.baseTime[it]=_DB[it];else if(_migrate&&(Math.abs(v-(_PB[it]||-1))<1e-4||Math.abs(v-12.85)<1e-4))st.baseTime[it]=_DB[it];});st.baseTimeRev=2;const _DP=defaults().prodCost;if(!st.prodCost)st.prodCost={};PRODUCTS.forEach(P=>{if(!st.prodCost[P])st.prodCost[P]={};RECIPE[P].inputs.forEach(k=>{if(!st.prodCost[P][k]||Object.keys(st.prodCost[P][k]).length===0)st.prodCost[P][k]=_DP[P][k];else LEVELS.forEach(L=>{if(!(L in st.prodCost[P][k]))st.prodCost[P][k][L]=_DP[P][k][L];});});});if(!st.sellPrice)st.sellPrice={};[...RAWS,...PRODUCTS].forEach(it=>{if(st.sellPrice[it]===undefined)st.sellPrice[it]=null;});if(!st.priceText)st.priceText={};if(!st.forgie)st.forgie={};[...RAWS,...PRODUCTS].forEach(it=>{if(st.forgie[it]===undefined)st.forgie[it]=null;});if(!st.forgieText)st.forgieText={};if(!st.targets)st.targets={};PRODUCTS.forEach(p=>{if(!st.targets[p])st.targets[p]={on:false,w:1};});RAWS.forEach(r=>{if(!st.targets[r])st.targets[r]={on:false,w:1};});if(st.gelVesp===undefined||st.gelVesp!==null&&(typeof st.gelVesp!=="number"||isNaN(st.gelVesp)||st.gelVesp<0))st.gelVesp=null;if(typeof st.gelVespText!=="string")st.gelVespText=st.gelVesp!=null?String(st.gelVesp):"";delete st.gelLines;delete st.gelComp;if(st.mode!=="credits"&&st.mode!=="items"&&st.mode!=="project"&&st.mode!=="manual")st.mode="items";if(!Array.isArray(st.projects))st.projects=[];st.projects.forEach(p=>{if(!p.id)p.id="p"+Math.random().toString(36).slice(2,9);if(typeof p.name!=="string")p.name="Project";p.on=p.on!==false;if(p.prio!=null){const _pr=Math.floor(Number(p.prio));p.prio=_pr>=1?_pr:null;}else p.prio=p.first?1:null;delete p.first;if(p.catId&&typeof PROJECT_CATALOG!=="undefined"&&Array.isArray(PROJECT_CATALOG)){const _src=PROJECT_CATALOG.find(c=>c.catId===p.catId);if(_src){p.levels=JSON.parse(JSON.stringify(_src.levels));p.name=_src.name;p.description=_src.description||"";}}if(!Array.isArray(p.levels)||p.levels.length===0)p.levels=[{costs:[]}];p.levels.forEach(L=>{if(!Array.isArray(L.costs))L.costs=[];L.costs.forEach(c=>{if(!RAWS.includes(c.item)&&!PRODUCTS.includes(c.item))c.item=PRODUCTS[0];if(c.qty!=null&&(typeof c.qty!=="number"||isNaN(c.qty)||c.qty<0))c.qty=null;});});p.from=Math.max(1,Math.min(p.levels.length,Math.floor(Number(p.from)||1)));p.to=Math.max(p.from,Math.min(p.levels.length,Math.floor(Number(p.to)||p.levels.length)));p.done=Math.max(0,Math.min(p.to-p.from+1,Math.floor(Number(p.done)||0)));});if(!st.inventory)st.inventory={};ALLITEMS.forEach(it=>{if(st.inventory[it]===undefined)st.inventory[it]=null;});if(!st.inventoryText)st.inventoryText={};if(typeof st.projectSeq!=="boolean")st.projectSeq=true;if(typeof st.projectGate!=="boolean")st.projectGate=true;if(st.projLineMode!=="static")st.projLineMode="split";if(!Array.isArray(st.manualSaved))st.manualSaved=[];st.manualSaved=st.manualSaved.filter(p=>p&&typeof p==="object"&&Array.isArray(p.config)).map(p=>({id:typeof p.id==="string"?p.id:("m"+Math.random().toString(36).slice(2,9)),name:typeof p.name==="string"?p.name:"Setup",config:p.config.map(c=>({job:(c&&ALLITEMS.includes(c.job))?c.job:"Idle",lvl:(c&&LEVELS.includes(c.lvl))?c.lvl:1,sell:!!(c&&c.sell)}))}));if(typeof st.manualActiveId!=="string")st.manualActiveId=null;if(typeof st.planStart!=="number"||!isFinite(st.planStart))st.planStart=null;syncManual(st);return st;}
let S=normalize(load())||defaults();syncManual(S);

function load(){try{const r=localStorage.getItem(LSKEY);return r?JSON.parse(r):null;}catch(e){return null;}}
function save(){try{localStorage.setItem(LSKEY,JSON.stringify(S));flashSaved();}catch(e){document.getElementById("saveind").innerHTML="<b style='color:var(--ink3)'>local save unavailable here</b>";}}
let savT;
function flashSaved(){const el=document.getElementById("saveind");el.innerHTML="<b>saved</b>";clearTimeout(savT);savT=setTimeout(()=>el.textContent="auto-saves locally",1400);}

const num=v=>{if(v===""||v===null||v===undefined)return null;const n=Number(v);return isFinite(n)?n:null;};
const fmt=(n,d=0)=>n.toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:0});

/* ---------- game number notation (k m b t qa qu sx sp o n d → exponent) ---------- */
const SUFFIX={k:1e3,m:1e6,b:1e9,t:1e12,qa:1e15,qu:1e18,sx:1e21,sp:1e24,o:1e27,n:1e30,d:1e33};
const SUFFIX_DESC=[["d",1e33],["n",1e30],["o",1e27],["sp",1e24],["sx",1e21],["qu",1e18],["qa",1e15],["t",1e12],["b",1e9],["m",1e6],["k",1e3]];
function parseGameNum(str){
  if(str==null)return null;
  if(typeof str==="number")return isFinite(str)?str:null;
  let s=String(str).trim().toLowerCase().replace(/,/g,"").replace(/\s+/g,"");
  if(s===""||s==="-"||s==="+")return null;
  const m=s.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)([a-z]*)$/);
  if(!m)return null;
  let val=Number(m[1]);
  if(!isFinite(val))return null;
  const suf=m[2];
  if(suf){if(SUFFIX[suf]==null)return null;val*=SUFFIX[suf];}
  return val;
}
function trimNum(v,dec){let s=v.toFixed(dec);if(s.indexOf(".")>=0)s=s.replace(/\.?0+$/,"");return s;}
function formatGameNum(n,dec=2){
  if(n==null||!isFinite(n))return "—";
  if(n===0)return "0";
  const neg=n<0;n=Math.abs(n);
  let out;
  if(n>=1e36){let[mant,exp]=n.toExponential(2).split("e");mant=mant.replace(/\.?0+$/,"");exp=exp.replace("+","");out=mant+"e"+exp;}
  else{
    let hit=null;
    for(const[suf,mult]of SUFFIX_DESC){if(n>=mult){hit=[suf,mult];break;}}
    out=hit?trimNum(n/hit[1],dec)+hit[0]:trimNum(n,dec);
  }
  return (neg?"-":"")+out;
}
const disp=n=>formatGameNum(n,2);

/* ---------- Gel mined-ore cost (shared by the solver, the panel readout, and the modal) ----------
   Gel is forged from mined ore, not crafter inputs. One craft @1× costs 100sx rocks + 500t vespium;
   each compression level triples the cost (same scaling as every craft). Vespium is the scarce input
   the planner budgets against — rocks stay informational (see the ore-cost modal). */
const GEL_ROCKS_BASE=parseGameNum("100sx"), GEL_VESP_BASE=parseGameNum("500t");
function gelOreCost(L){const s=Math.pow(3,Math.log2(L));return {rocks:GEL_ROCKS_BASE*s,vesp:GEL_VESP_BASE*s};}

