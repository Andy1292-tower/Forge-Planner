"use strict";
const LEVELS=[1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384];
const RAWS=["Ingots","Bits","Concrete"];
const PRODUCTS=["Glass","Bricks","Plates","Rods","Frames","Gel","Wire","Reinforced Concrete","Batteries"];
// Gel is crafted on a crafter line, spending budgeted Vespium plus informational Rocks.
const GEL="Gel";
const RECIPE={
  Glass:{inputs:["Bits"]},Bricks:{inputs:["Concrete"]},Plates:{inputs:["Ingots"]},
  Rods:{inputs:["Ingots"]},Frames:{inputs:["Plates","Rods"]},Gel:{inputs:[]},
  Wire:{inputs:["Gel","Rods"]},
  "Reinforced Concrete":{inputs:["Bricks","Concrete","Frames"]},
  Batteries:{inputs:["Wire","Gel"]}
};
const MINED_CRAFTS={
  Gel:{resource:"Vespium",baseCosts:{Vespium:5e14},informationalCosts:{Rocks:1e23}},
  Batteries:{resource:"Hydracite",baseCosts:{Hydracite:5e12},informationalCosts:{}}
};
const MINED_RESOURCES=["Vespium","Hydracite"];
function compressionLabel(L){return Number(L)===16384?"16.4k×":String(L)+"×";}
function minedCost(item,L){
  const cfg=MINED_CRAFTS[item],out={};if(!cfg)return out;
  const mult=Math.pow(3,Math.log2(L));
  Object.entries({...cfg.informationalCosts,...cfg.baseCosts}).forEach(([r,v])=>out[r]=v*mult);
  return out;
}
function isMinedResource(r){return MINED_RESOURCES.includes(r);}
function minedBudgetHr(r){return Math.max(0,num(S.minedIncome&&S.minedIncome[r])||0)*60;}
function setMinedIncome(r,text){
  if(!MINED_RESOURCES.includes(r))return;
  S.minedIncomeText[r]=String(text==null?"":text);
  const v=parseGameNum(text);S.minedIncome[r]=v!=null&&v>=0?v:null;
}
const KIND={Ingots:"raw",Bits:"raw",Concrete:"raw",Glass:"pr",Bricks:"pr",Plates:"pr",Rods:"pr",Frames:"fin",Gel:"pr",Wire:"fin","Reinforced Concrete":"fin",Batteries:"fin"};
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
const ALLITEMS=[...RAWS,...PRODUCTS];
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
    Gel:{},                                  // mined inputs are tracked separately from ordinary recipes
    Wire:{Gel:c(2),Rods:c(16)},              // Bits pre-produced (PREPROD_BITS.Wire), not a line input
    "Reinforced Concrete":{Bricks:c(10000),Concrete:c(100000),Frames:c(700)},
    Batteries:{Wire:c(500),Gel:c(100000)}
  };
  const baseTime={Ingots:10,Bits:6.178,Concrete:9.273,Glass:92.68,Bricks:108.2,Plates:30.89,Rods:46.34,Frames:308.9,Gel:3201,Wire:5400.8,"Reinforced Concrete":355531.88,Batteries:1034274.56};
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
    minedIncome:{Vespium:null,Hydracite:null},minedIncomeText:{Vespium:"",Hydracite:""},
    targets:tg,
    projects:[],inventory:nulls(),inventoryText:{},projectSeq:true,projectGate:true,
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
function normalize(st){
  if(!st)return st;
  if(!Array.isArray(st.lines))st.lines=[];
  st.lines.forEach(l=>{if(l.spx==null||isNaN(l.spx)||l.spx<=0)l.spx=1;if(l.turbo==null||isNaN(l.turbo)||l.turbo<0)l.turbo=0;});
  if(st.maxTurbo==null||isNaN(st.maxTurbo)||st.maxTurbo<0)st.maxTurbo=0;
  if(st.dupe==null||isNaN(st.dupe)||st.dupe<0){
    let _d;
    if(st.attrDupe!=null&&!isNaN(st.attrDupe))_d=Math.max(0,Number(st.attrDupe)+(Number(st.maxTurbo)||0)*(Number(st.trio4)||0));
    else{const _l=st.lines.find(l=>l&&l.dup!=null&&!isNaN(l.dup));_d=_l?_l.dup:12.40;}
    st.dupe=_d;
  }
  delete st.attrDupe;delete st.trio4;
  if(st.margin==null||isNaN(st.margin))st.margin=0;
  if(st.solveBudget==null||isNaN(st.solveBudget)||st.solveBudget<200||st.solveBudget>60000)st.solveBudget=2000;
  if(!st.baseTime)st.baseTime={};
  const _DB=defaults().baseTime,_PB={Ingots:9.63,Bits:9.63,Concrete:9.63,Glass:87.3,Bricks:114.3,Plates:29.23,Rods:44.46,Frames:311.38};
  const _migrate=!st.baseTimeRev||st.baseTimeRev<2;
  [...RAWS,...PRODUCTS].forEach(it=>{const v=st.baseTime[it];if(v==null||isNaN(v)||v<=0)st.baseTime[it]=_DB[it];else if(_migrate&&(Math.abs(v-(_PB[it]||-1))<1e-4||Math.abs(v-12.85)<1e-4))st.baseTime[it]=_DB[it];});
  st.baseTimeRev=2;
  const _DP=defaults().prodCost;
  if(!st.prodCost)st.prodCost={};
  PRODUCTS.forEach(P=>{if(!st.prodCost[P])st.prodCost[P]={};RECIPE[P].inputs.forEach(k=>{if(!st.prodCost[P][k]||Object.keys(st.prodCost[P][k]).length===0)st.prodCost[P][k]=_DP[P][k];else LEVELS.forEach(L=>{if(!(L in st.prodCost[P][k]))st.prodCost[P][k][L]=_DP[P][k][L];});});});
  if(!st.sellPrice)st.sellPrice={};
  [...RAWS,...PRODUCTS].forEach(it=>{if(st.sellPrice[it]===undefined)st.sellPrice[it]=null;});
  if(!st.priceText)st.priceText={};
  if(!st.forgie)st.forgie={};
  [...RAWS,...PRODUCTS].forEach(it=>{if(st.forgie[it]===undefined)st.forgie[it]=null;});
  if(!st.forgieText)st.forgieText={};
  if(!st.targets)st.targets={};
  PRODUCTS.forEach(p=>{if(!st.targets[p])st.targets[p]={on:false,w:1};});
  RAWS.forEach(r=>{if(!st.targets[r])st.targets[r]={on:false,w:1};});
  if(!st.minedIncome||typeof st.minedIncome!=="object"||Array.isArray(st.minedIncome))st.minedIncome={};
  if(!st.minedIncomeText||typeof st.minedIncomeText!=="object"||Array.isArray(st.minedIncomeText))st.minedIncomeText={};
  if(!Object.prototype.hasOwnProperty.call(st.minedIncome,"Vespium"))st.minedIncome.Vespium=st.gelVesp;
  if(!Object.prototype.hasOwnProperty.call(st.minedIncomeText,"Vespium"))st.minedIncomeText.Vespium=st.gelVespText;
  MINED_RESOURCES.forEach(r=>{
    const raw=st.minedIncome[r],v=Number(raw);
    st.minedIncome[r]=raw!==null&&raw!==undefined&&raw!==""&&Number.isFinite(v)&&v>=0?v:null;
    if(typeof st.minedIncomeText[r]!=="string")st.minedIncomeText[r]=st.minedIncome[r]!=null?String(st.minedIncome[r]):"";
  });
  delete st.gelVesp;delete st.gelVespText;
  delete st.gelLines;delete st.gelComp;
  if(st.mode!=="credits"&&st.mode!=="items"&&st.mode!=="project"&&st.mode!=="manual")st.mode="items";
  if(!Array.isArray(st.projects))st.projects=[];
  st.projects.forEach(p=>{if(!p.id)p.id="p"+Math.random().toString(36).slice(2,9);if(typeof p.name!=="string")p.name="Project";p.on=p.on!==false;if(p.prio!=null){const _pr=Math.floor(Number(p.prio));p.prio=_pr>=1?_pr:null;}else p.prio=p.first?1:null;delete p.first;if(p.catId&&typeof PROJECT_CATALOG!=="undefined"&&Array.isArray(PROJECT_CATALOG)){const _src=PROJECT_CATALOG.find(c=>c.catId===p.catId);if(_src){p.levels=JSON.parse(JSON.stringify(_src.levels));p.name=_src.name;p.description=_src.description||"";}}if(!Array.isArray(p.levels)||p.levels.length===0)p.levels=[{costs:[]}];p.levels.forEach(L=>{if(!Array.isArray(L.costs))L.costs=[];L.costs.forEach(c=>{if(!RAWS.includes(c.item)&&!PRODUCTS.includes(c.item))c.item=PRODUCTS[0];if(c.qty!=null&&(typeof c.qty!=="number"||isNaN(c.qty)||c.qty<0))c.qty=null;});});p.from=Math.max(1,Math.min(p.levels.length,Math.floor(Number(p.from)||1)));p.to=Math.max(p.from,Math.min(p.levels.length,Math.floor(Number(p.to)||p.levels.length)));p.done=Math.max(0,Math.min(p.to-p.from+1,Math.floor(Number(p.done)||0)));});
  if(!st.inventory)st.inventory={};
  ALLITEMS.forEach(it=>{if(st.inventory[it]===undefined)st.inventory[it]=null;});
  if(!st.inventoryText)st.inventoryText={};
  if(typeof st.projectSeq!=="boolean")st.projectSeq=true;
  if(typeof st.projectGate!=="boolean")st.projectGate=true;
  if(!Array.isArray(st.manualSaved))st.manualSaved=[];
  st.manualSaved=st.manualSaved.filter(p=>p&&typeof p==="object"&&Array.isArray(p.config)).map(p=>({id:typeof p.id==="string"?p.id:("m"+Math.random().toString(36).slice(2,9)),name:typeof p.name==="string"?p.name:"Setup",config:p.config.map(c=>({job:(c&&ALLITEMS.includes(c.job))?c.job:"Idle",lvl:(c&&LEVELS.includes(c.lvl))?c.lvl:1,sell:!!(c&&c.sell)}))}));
  if(typeof st.manualActiveId!=="string")st.manualActiveId=null;
  if(typeof st.planStart!=="number"||!isFinite(st.planStart))st.planStart=null;
  syncManual(st);
  return st;
}
let S=defaults();
let stateRevision=0;

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

;
"use strict";

/* Authoritative persisted-field rules. Task 8 may bind these descriptors to controls, but
 * validation and migrations own the rules now. Collection limits are deliberately generous
 * security ceilings, not recommendations for ordinary planner builds. */
const CURRENT_SCHEMA_VERSION=1;
const STATE_LIMITS=Object.freeze({
  maxBytes:2*1024*1024,
  maxDepth:10,
  maxNodes:50000,
  maxArrayLength:32768,
  maxObjectKeys:512,
  maxLines:64,
  maxProjects:128,
  maxLevelsPerProject:256,
  maxCostsPerLevel:64,
  maxTotalLevels:4096,
  maxTotalCosts:32768,
  maxPresets:128,
  maxStringLength:2048
});

const _FIELD_DEFAULTS=defaults();
const _field=(type,defaultValue,extra)=>Object.freeze({type,defaultValue,...extra});
const FIELD_SCHEMA=Object.freeze({
  schemaVersion:_field("integer",CURRENT_SCHEMA_VERSION,{min:CURRENT_SCHEMA_VERSION,max:CURRENT_SCHEMA_VERSION,allowBlank:false}),
  lineMax:_field("enum",_FIELD_DEFAULTS.lines[0].max,{values:Object.freeze(LEVELS.slice()),allowBlank:false}),
  lineSpeed:_field("number",1,{min:1e-6,max:1e9,allowBlank:false}),
  turbo:_field("number",0,{min:0,max:1e6,allowBlank:false}),
  maxTurbo:_field("number",_FIELD_DEFAULTS.maxTurbo,{min:0,max:1e6,allowBlank:false}),
  dupe:_field("number",_FIELD_DEFAULTS.dupe,{min:0,max:100,allowBlank:false}),
  margin:_field("number",_FIELD_DEFAULTS.margin,{min:0,max:20,allowBlank:false}),
  solveBudget:_field("integer",_FIELD_DEFAULTS.solveBudget,{min:200,max:60000,allowBlank:false}),
  baseTime:_field("number",null,{min:1e-6,max:1e15,allowBlank:false}),
  amount:_field("number",null,{min:0,max:1e100,allowBlank:true}),
  recipeCost:_field("number",null,{min:0,max:1e100,allowBlank:true}),
  targetEnabled:_field("boolean",false,{allowBlank:false}),
  targetWeight:_field("integer",1,{min:1,max:9,allowBlank:false}),
  mode:_field("enum",_FIELD_DEFAULTS.mode,{values:Object.freeze(["items","credits","project","manual"]),allowBlank:false}),
  flag:_field("boolean",false,{allowBlank:false}),
  displayText:_field("string","",{maxLength:128,allowBlank:true}),
  id:_field("string","",{maxLength:64,allowBlank:false,pattern:/^[A-Za-z][A-Za-z0-9_-]{0,63}$/}),
  projectName:_field("string","Project",{maxLength:256,allowBlank:true}),
  projectDescription:_field("string","",{maxLength:2048,allowBlank:true}),
  projectIndex:_field("integer",1,{min:1,max:1e6,allowBlank:false}),
  projectPriority:_field("integer",null,{min:1,max:1e6,allowBlank:true}),
  projectDone:_field("integer",0,{min:0,max:1e6,allowBlank:false}),
  item:_field("enum",PRODUCTS[0],{values:Object.freeze(ALLITEMS.slice()),allowBlank:false}),
  manualJob:_field("enum","Idle",{values:Object.freeze(["Idle",...ALLITEMS]),allowBlank:false}),
  timestamp:_field("number",null,{min:0,max:Number.MAX_SAFE_INTEGER,allowBlank:true})
});

;
"use strict";

const STATE_BACKUP_KEY=LSKEY+"_previous_good";
const STATE_REJECTED_KEY=LSKEY+"_rejected";
const STATE_REJECTED_REASON_KEY=STATE_REJECTED_KEY+"_reason";
let _activeStateRecovery=null;

function _plainObject(value){
  if(value===null||typeof value!=="object"||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  // A JSON object produced in another realm (an iframe or test VM) has a different
  // Object.prototype identity, but its prototype is still that realm's root prototype.
  return proto===null||proto===Object.prototype||Object.getPrototypeOf(proto)===null;
}
function _own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
function _freshCurrentDefaults(){
  const state=normalize(defaults());
  state.schemaVersion=CURRENT_SCHEMA_VERSION;
  return state;
}
function _pushError(errors,path,message){
  if(errors.length<100)errors.push(path+" "+message);
}
function _readData(object,key,path,errors){
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor)return undefined;
  if(!_own(descriptor,"value")){
    _pushError(errors,path,"must be ordinary data, not an accessor");
    return undefined;
  }
  return descriptor.value;
}
function _scanStructure(root,errors){
  const seen=new WeakSet();let nodes=0;
  const visit=(value,path,depth)=>{
    if(typeof value==="string"){
      if(value.length>STATE_LIMITS.maxStringLength)_pushError(errors,path,"exceeds the global string length limit");
      return;
    }
    if(value===null||typeof value!=="object")return;
    if(depth>STATE_LIMITS.maxDepth){_pushError(errors,path,"exceeds the object depth limit");return;}
    if(seen.has(value)){_pushError(errors,path,"must not contain circular references");return;}
    seen.add(value);nodes++;
    if(nodes>STATE_LIMITS.maxNodes){_pushError(errors,path,"exceeds the object count limit");return;}
    if(Array.isArray(value)){
      if(value.length>STATE_LIMITS.maxArrayLength){_pushError(errors,path,"exceeds the array length limit");return;}
      Object.keys(value).forEach(key=>visit(_readData(value,key,path+"["+key+"]",errors),path+"["+key+"]",depth+1));
      return;
    }
    if(!_plainObject(value)){_pushError(errors,path,"must contain only plain objects");return;}
    const keys=Object.keys(value);
    if(keys.length>STATE_LIMITS.maxObjectKeys){_pushError(errors,path,"exceeds the object key limit");return;}
    keys.forEach(key=>{
      if(key.length>STATE_LIMITS.maxStringLength)_pushError(errors,path,"contains an oversized key");
      visit(_readData(value,key,path+"."+key,errors),path+"."+key,depth+1);
    });
  };
  visit(root,"state",0);
}
function _number(value,rule,path,errors){
  if(value===null&&rule.allowBlank)return null;
  if(typeof value!=="number"||!Number.isFinite(value)){
    _pushError(errors,path,"must be a finite number");return undefined;
  }
  if(rule.type==="integer"&&!Number.isInteger(value))_pushError(errors,path,"must be an integer");
  if(value<rule.min||value>rule.max)_pushError(errors,path,"must be between "+rule.min+" and "+rule.max);
  return value;
}
function _string(value,rule,path,errors){
  if(typeof value!=="string"){
    _pushError(errors,path,"must be a string");return undefined;
  }
  if(!rule.allowBlank&&value.length===0)_pushError(errors,path,"must not be blank");
  if(value.length>rule.maxLength)_pushError(errors,path,"exceeds the "+rule.maxLength+" character length limit");
  if(rule.pattern&&!rule.pattern.test(value))_pushError(errors,path,"must use a safe ID format (letter first; then letters, numbers, underscores, or hyphens)");
  return value;
}
function _boolean(value,path,errors){
  if(typeof value!=="boolean"){
    _pushError(errors,path,"must be a boolean");return undefined;
  }
  return value;
}
function _enum(value,rule,path,errors){
  if(!rule.values.includes(value)){
    _pushError(errors,path,"must be one of the supported values");return undefined;
  }
  return value;
}
function _object(value,path,errors){
  if(!_plainObject(value)){_pushError(errors,path,"must be a plain object");return null;}
  return value;
}
function _array(value,path,errors,limit){
  if(!Array.isArray(value)){_pushError(errors,path,"must be an array");return null;}
  if(value.length>limit)_pushError(errors,path,"exceeds the "+limit+" entry limit");
  return value;
}
function _required(candidate,key,errors){
  if(!_own(candidate,key))_pushError(errors,key,"is required for schema version "+CURRENT_SCHEMA_VERSION);
}

function validateAndMigrate(candidate){
  const errors=[];
  if(!_plainObject(candidate))return {ok:false,errors:["state must be a plain object"],sourceVersion:null};
  _scanStructure(candidate,errors);
  if(errors.some(error=>/depth limit|object count limit|array length limit|only plain objects|circular references|accessor/.test(error)))return {ok:false,errors,sourceVersion:null};

  let sourceVersion=0;
  if(_own(candidate,"schemaVersion")){
    const rawVersion=_readData(candidate,"schemaVersion","schemaVersion",errors);
    if(typeof rawVersion!=="number"||!Number.isInteger(rawVersion)||rawVersion<1){
      _pushError(errors,"schemaVersion","must be a positive integer");
      sourceVersion=rawVersion;
    }else sourceVersion=rawVersion;
    if(sourceVersion>CURRENT_SCHEMA_VERSION){
      _pushError(errors,"schemaVersion","was written by a newer version of Forge Planner");
      return {ok:false,errors,sourceVersion};
    }
    if(sourceVersion!==CURRENT_SCHEMA_VERSION)return {ok:false,errors:["schemaVersion is not supported"],sourceVersion};
  }else{
    const legacyShape=Array.isArray(candidate.lines)&&_plainObject(candidate.prodCost)&&_plainObject(candidate.targets);
    if(!legacyShape)return {ok:false,errors:["unversioned save does not match a known Forge Planner shape"],sourceVersion:0};
  }

  const current=sourceVersion===CURRENT_SCHEMA_VERSION;
  if(current){
    ["lines","maxTurbo","dupe","prodCost","baseTime","baseTimeRev","margin","mode","solveBudget",
      "sellPrice","priceText","forgie","forgieText","minedIncome","minedIncomeText","targets",
      "projects","inventory","inventoryText","projectSeq","projectGate","planStart","manual","manualSaved",
      "manualActiveId"].forEach(key=>_required(candidate,key,errors));
  }
  const out=defaults();
  out.schemaVersion=CURRENT_SCHEMA_VERSION;

  const rawLines=_readData(candidate,"lines","lines",errors);
  const lines=_array(rawLines,"lines",errors,STATE_LIMITS.maxLines);
  if(lines){
    if(lines.length===0)_pushError(errors,"lines","must contain at least one crafter line");
    out.lines=[];
    lines.slice(0,STATE_LIMITS.maxLines).forEach((raw,index)=>{
      const path="lines["+index+"]",line=_object(raw,path,errors);if(!line)return;
      if(!_own(line,"max"))_pushError(errors,path+".max","is required");
      if(!_own(line,"spx"))_pushError(errors,path+".spx","is required");
      if(current&&!_own(line,"turbo"))_pushError(errors,path+".turbo","is required");
      const max=_enum(_readData(line,"max",path+".max",errors),FIELD_SCHEMA.lineMax,path+".max",errors);
      const spx=_number(_readData(line,"spx",path+".spx",errors),FIELD_SCHEMA.lineSpeed,path+".spx",errors);
      const turbo=_own(line,"turbo")?_number(_readData(line,"turbo",path+".turbo",errors),FIELD_SCHEMA.turbo,path+".turbo",errors):0;
      if(_own(line,"dup"))_number(_readData(line,"dup",path+".dup",errors),FIELD_SCHEMA.dupe,path+".dup",errors);
      out.lines.push({max,spx,turbo});
    });
  }

  if(_own(candidate,"maxTurbo"))out.maxTurbo=_number(_readData(candidate,"maxTurbo","maxTurbo",errors),FIELD_SCHEMA.maxTurbo,"maxTurbo",errors);
  if(_own(candidate,"dupe"))out.dupe=_number(_readData(candidate,"dupe","dupe",errors),FIELD_SCHEMA.dupe,"dupe",errors);
  else if(_own(candidate,"attrDupe")){
    const attr=_number(_readData(candidate,"attrDupe","attrDupe",errors),FIELD_SCHEMA.dupe,"attrDupe",errors);
    const trio=_own(candidate,"trio4")?_number(_readData(candidate,"trio4","trio4",errors),FIELD_SCHEMA.dupe,"trio4",errors):0;
    if(attr!==undefined&&trio!==undefined){
      const migrated=attr+(out.maxTurbo||0)*trio;
      out.dupe=_number(migrated,FIELD_SCHEMA.dupe,"dupe (migrated)",errors);
    }
  }else if(lines){
    const legacyLine=lines.find(line=>_plainObject(line)&&_own(line,"dup"));
    if(legacyLine)out.dupe=_number(_readData(legacyLine,"dup","lines[].dup",errors),FIELD_SCHEMA.dupe,"lines[].dup",errors);
  }
  if(_own(candidate,"margin"))out.margin=_number(_readData(candidate,"margin","margin",errors),FIELD_SCHEMA.margin,"margin",errors);
  if(_own(candidate,"mode"))out.mode=_enum(_readData(candidate,"mode","mode",errors),FIELD_SCHEMA.mode,"mode",errors);
  if(_own(candidate,"solveBudget"))out.solveBudget=_number(_readData(candidate,"solveBudget","solveBudget",errors),FIELD_SCHEMA.solveBudget,"solveBudget",errors);

  const rawBase=_readData(candidate,"baseTime","baseTime",errors),base=_object(rawBase,"baseTime",errors);
  if(base){
    ALLITEMS.forEach(item=>{
      if(current&&!_own(base,item))_pushError(errors,"baseTime."+item,"is required");
      if(_own(base,item))out.baseTime[item]=_number(_readData(base,item,"baseTime."+item,errors),FIELD_SCHEMA.baseTime,"baseTime."+item,errors);
    });
  }
  if(_own(candidate,"baseTimeRev"))out.baseTimeRev=_number(_readData(candidate,"baseTimeRev","baseTimeRev",errors),{type:"integer",min:0,max:CURRENT_SCHEMA_VERSION+10,allowBlank:false},"baseTimeRev",errors);

  const rawCosts=_readData(candidate,"prodCost","prodCost",errors),prodCost=_object(rawCosts,"prodCost",errors);
  if(prodCost){
    PRODUCTS.forEach(product=>{
      if(current&&!_own(prodCost,product))_pushError(errors,"prodCost."+product,"is required");
      if(!_own(prodCost,product))return;
      const productMap=_object(_readData(prodCost,product,"prodCost."+product,errors),"prodCost."+product,errors);if(!productMap)return;
      RECIPE[product].inputs.forEach(input=>{
        const path="prodCost."+product+"."+input;
        if(current&&!_own(productMap,input))_pushError(errors,path,"is required");
        if(!_own(productMap,input))return;
        const levelMap=_object(_readData(productMap,input,path,errors),path,errors);if(!levelMap)return;
        Object.keys(levelMap).forEach(level=>{if(!LEVELS.some(item=>String(item)===level))_pushError(errors,path+"."+level,"uses an unknown compression level");});
        LEVELS.forEach(level=>{
          if(current&&!_own(levelMap,String(level)))_pushError(errors,path+"."+level,"is required");
          if(_own(levelMap,String(level)))out.prodCost[product][input][level]=_number(_readData(levelMap,String(level),path+"."+level,errors),FIELD_SCHEMA.recipeCost,path+"."+level,errors);
        });
      });
    });
  }

  const copyItemMap=(key,rule,text)=>{
    if(!_own(candidate,key))return;
    const map=_object(_readData(candidate,key,key,errors),key,errors);if(!map)return;
    ALLITEMS.forEach(item=>{
      if(current&&!text&&!_own(map,item))_pushError(errors,key+"."+item,"is required");
      if(_own(map,item))out[key][item]=text?_string(_readData(map,item,key+"."+item,errors),rule,key+"."+item,errors):_number(_readData(map,item,key+"."+item,errors),rule,key+"."+item,errors);
    });
  };
  copyItemMap("sellPrice",FIELD_SCHEMA.amount,false);
  copyItemMap("priceText",FIELD_SCHEMA.displayText,true);
  copyItemMap("forgie",FIELD_SCHEMA.amount,false);
  copyItemMap("forgieText",FIELD_SCHEMA.displayText,true);
  copyItemMap("inventory",FIELD_SCHEMA.amount,false);
  copyItemMap("inventoryText",FIELD_SCHEMA.displayText,true);

  if(_own(candidate,"minedIncome")){
    const map=_object(_readData(candidate,"minedIncome","minedIncome",errors),"minedIncome",errors);
    if(map)MINED_RESOURCES.forEach(resource=>{
      if(current&&!_own(map,resource))_pushError(errors,"minedIncome."+resource,"is required");
      if(_own(map,resource))out.minedIncome[resource]=_number(_readData(map,resource,"minedIncome."+resource,errors),FIELD_SCHEMA.amount,"minedIncome."+resource,errors);
    });
  }else if(_own(candidate,"gelVesp"))out.minedIncome.Vespium=_number(_readData(candidate,"gelVesp","gelVesp",errors),FIELD_SCHEMA.amount,"gelVesp",errors);
  if(_own(candidate,"minedIncomeText")){
    const map=_object(_readData(candidate,"minedIncomeText","minedIncomeText",errors),"minedIncomeText",errors);
    if(map)MINED_RESOURCES.forEach(resource=>{
      if(current&&!_own(map,resource))_pushError(errors,"minedIncomeText."+resource,"is required");
      if(_own(map,resource))out.minedIncomeText[resource]=_string(_readData(map,resource,"minedIncomeText."+resource,errors),FIELD_SCHEMA.displayText,"minedIncomeText."+resource,errors);
    });
  }else if(_own(candidate,"gelVespText"))out.minedIncomeText.Vespium=_string(_readData(candidate,"gelVespText","gelVespText",errors),FIELD_SCHEMA.displayText,"gelVespText",errors);

  const rawTargets=_readData(candidate,"targets","targets",errors),targets=_object(rawTargets,"targets",errors);
  if(targets)ALLITEMS.forEach(item=>{
    const path="targets."+item;
    if(current&&!_own(targets,item))_pushError(errors,path,"is required");
    if(!_own(targets,item))return;
    const target=_object(_readData(targets,item,path,errors),path,errors);if(!target)return;
    if(!_own(target,"on"))_pushError(errors,path+".on","is required");
    if(!_own(target,"w"))_pushError(errors,path+".w","is required");
    out.targets[item]={
      on:_boolean(_readData(target,"on",path+".on",errors),path+".on",errors),
      w:_number(_readData(target,"w",path+".w",errors),FIELD_SCHEMA.targetWeight,path+".w",errors)
    };
  });

  let totalLevels=0,totalCosts=0;
  if(_own(candidate,"projects")){
    const projects=_array(_readData(candidate,"projects","projects",errors),"projects",errors,STATE_LIMITS.maxProjects);
    if(projects){out.projects=[];projects.slice(0,STATE_LIMITS.maxProjects).forEach((raw,index)=>{
      const path="projects["+index+"]",project=_object(raw,path,errors);if(!project)return;
      if(current)["id","name","on","prio","from","to","done","levels"].forEach(key=>{if(!_own(project,key))_pushError(errors,path+"."+key,"is required");});
      const rawLevels=_readData(project,"levels",path+".levels",errors),levels=_array(rawLevels,path+".levels",errors,STATE_LIMITS.maxLevelsPerProject);
      if(!levels||levels.length===0){_pushError(errors,path+".levels","must contain at least one level");return;}
      totalLevels+=levels.length;if(totalLevels>STATE_LIMITS.maxTotalLevels)_pushError(errors,"projects","exceeds the total level limit");
      const copiedLevels=[];
      levels.slice(0,STATE_LIMITS.maxLevelsPerProject).forEach((rawLevel,levelIndex)=>{
        const levelPath=path+".levels["+levelIndex+"]",level=_object(rawLevel,levelPath,errors);if(!level)return;
        const costs=_array(_readData(level,"costs",levelPath+".costs",errors),levelPath+".costs",errors,STATE_LIMITS.maxCostsPerLevel);if(!costs)return;
        totalCosts+=costs.length;if(totalCosts>STATE_LIMITS.maxTotalCosts)_pushError(errors,"projects","exceeds the total cost limit");
        const copiedCosts=[];
        costs.slice(0,STATE_LIMITS.maxCostsPerLevel).forEach((rawCost,costIndex)=>{
          const costPath=levelPath+".costs["+costIndex+"]",cost=_object(rawCost,costPath,errors);if(!cost)return;
          if(current)["item","qty"].forEach(key=>{if(!_own(cost,key))_pushError(errors,costPath+"."+key,"is required");});
          copiedCosts.push({
            item:_enum(_readData(cost,"item",costPath+".item",errors),FIELD_SCHEMA.item,costPath+".item",errors),
            qty:_number(_readData(cost,"qty",costPath+".qty",errors),FIELD_SCHEMA.amount,costPath+".qty",errors)
          });
        });
        copiedLevels.push({costs:copiedCosts});
      });
      const count=copiedLevels.length||1;
      const id=_own(project,"id")?_string(_readData(project,"id",path+".id",errors),FIELD_SCHEMA.id,path+".id",errors):"legacy-project-"+(index+1);
      const name=_own(project,"name")?_string(_readData(project,"name",path+".name",errors),FIELD_SCHEMA.projectName,path+".name",errors):"Project";
      const on=_own(project,"on")?_boolean(_readData(project,"on",path+".on",errors),path+".on",errors):true;
      const legacyCursorRule={type:"integer",min:-1e6,max:1e6,allowBlank:false};
      const cursorRule=current?{...FIELD_SCHEMA.projectIndex,max:count}:legacyCursorRule;
      const from=_own(project,"from")?_number(_readData(project,"from",path+".from",errors),cursorRule,path+".from",errors):1;
      const to=_own(project,"to")?_number(_readData(project,"to",path+".to",errors),cursorRule,path+".to",errors):count;
      if(current&&Number.isFinite(from)&&Number.isFinite(to)&&from>to)_pushError(errors,path+".from","must not exceed "+path+".to");
      const span=Number.isFinite(from)&&Number.isFinite(to)?Math.max(0,to-from+1):count;
      const doneRule=current?{...FIELD_SCHEMA.projectDone,max:span}:legacyCursorRule;
      const done=_own(project,"done")?_number(_readData(project,"done",path+".done",errors),doneRule,path+".done",errors):0;
      let prio=null;
      if(_own(project,"prio"))prio=_number(_readData(project,"prio",path+".prio",errors),FIELD_SCHEMA.projectPriority,path+".prio",errors);
      else if(_readData(project,"first",path+".first",errors)===true)prio=1;
      const copied={id,name,on,prio,from,to,done,levels:copiedLevels};
      if(_own(project,"catId"))copied.catId=_string(_readData(project,"catId",path+".catId",errors),FIELD_SCHEMA.id,path+".catId",errors);
      if(_own(project,"description"))copied.description=_string(_readData(project,"description",path+".description",errors),FIELD_SCHEMA.projectDescription,path+".description",errors);
      if(_own(project,"_open"))copied._open=_boolean(_readData(project,"_open",path+"._open",errors),path+"._open",errors);
      out.projects.push(copied);
    });}
  }

  if(_own(candidate,"projectSeq"))out.projectSeq=_boolean(_readData(candidate,"projectSeq","projectSeq",errors),"projectSeq",errors);
  if(_own(candidate,"projectGate"))out.projectGate=_boolean(_readData(candidate,"projectGate","projectGate",errors),"projectGate",errors);
  if(_own(candidate,"planStart"))out.planStart=_number(_readData(candidate,"planStart","planStart",errors),FIELD_SCHEMA.timestamp,"planStart",errors);

  if(_own(candidate,"manual")){
    const manual=_array(_readData(candidate,"manual","manual",errors),"manual",errors,STATE_LIMITS.maxLines);
    if(manual){if(current&&manual.length!==out.lines.length)_pushError(errors,"manual","must have one entry per crafter line");out.manual=[];manual.slice(0,STATE_LIMITS.maxLines).forEach((raw,index)=>{
      const path="manual["+index+"]",entry=_object(raw,path,errors);if(!entry)return;
      if(current)["job","lvl","sell"].forEach(key=>{if(!_own(entry,key))_pushError(errors,path+"."+key,"is required");});
      const job=_enum(_readData(entry,"job",path+".job",errors),FIELD_SCHEMA.manualJob,path+".job",errors);
      const lvl=_enum(_readData(entry,"lvl",path+".lvl",errors),FIELD_SCHEMA.lineMax,path+".lvl",errors);
      const sell=_boolean(_readData(entry,"sell",path+".sell",errors),path+".sell",errors);
      if(current&&Number.isFinite(lvl)&&out.lines[index]&&Number.isFinite(out.lines[index].max)&&lvl>out.lines[index].max)_pushError(errors,path+".lvl","must not exceed its crafter line cap");
      out.manual.push({job,lvl,sell});
    });}
  }
  if(_own(candidate,"manualSaved")){
    const presets=_array(_readData(candidate,"manualSaved","manualSaved",errors),"manualSaved",errors,STATE_LIMITS.maxPresets);
    if(presets){out.manualSaved=[];presets.slice(0,STATE_LIMITS.maxPresets).forEach((raw,index)=>{
      const path="manualSaved["+index+"]",preset=_object(raw,path,errors);if(!preset)return;
      if(current)["id","name","config"].forEach(key=>{if(!_own(preset,key))_pushError(errors,path+"."+key,"is required");});
      const config=_array(_readData(preset,"config",path+".config",errors),path+".config",errors,STATE_LIMITS.maxLines);if(!config)return;
      const copiedConfig=[];config.slice(0,STATE_LIMITS.maxLines).forEach((rawEntry,entryIndex)=>{
        const entryPath=path+".config["+entryIndex+"]",entry=_object(rawEntry,entryPath,errors);if(!entry)return;
        if(current)["job","lvl","sell"].forEach(key=>{if(!_own(entry,key))_pushError(errors,entryPath+"."+key,"is required");});
        copiedConfig.push({job:_enum(_readData(entry,"job",entryPath+".job",errors),FIELD_SCHEMA.manualJob,entryPath+".job",errors),lvl:_enum(_readData(entry,"lvl",entryPath+".lvl",errors),FIELD_SCHEMA.lineMax,entryPath+".lvl",errors),sell:_boolean(_readData(entry,"sell",entryPath+".sell",errors),entryPath+".sell",errors)});
      });
      out.manualSaved.push({id:_own(preset,"id")?_string(_readData(preset,"id",path+".id",errors),FIELD_SCHEMA.id,path+".id",errors):"legacy-preset-"+(index+1),name:_own(preset,"name")?_string(_readData(preset,"name",path+".name",errors),FIELD_SCHEMA.projectName,path+".name",errors):"Setup",config:copiedConfig});
    });}
  }
  if(_own(candidate,"manualActiveId")){
    const active=_readData(candidate,"manualActiveId","manualActiveId",errors);
    out.manualActiveId=active===null?null:_string(active,FIELD_SCHEMA.id,"manualActiveId",errors);
  }

  if(errors.length)return {ok:false,errors,sourceVersion};
  normalize(out);
  out.schemaVersion=CURRENT_SCHEMA_VERSION;
  return {ok:true,state:out,sourceVersion};
}

function parseStoredState(raw){
  if(raw===null||raw===undefined||raw==="")return {state:_freshCurrentDefaults(),recovery:null};
  if(typeof raw!=="string")return {state:_freshCurrentDefaults(),recovery:{raw:String(raw),reason:"Stored save must be text"}};
  if(raw.length>STATE_LIMITS.maxBytes)return {state:_freshCurrentDefaults(),recovery:{raw,reason:"Stored save is too large to open safely"}};
  let candidate;
  try{candidate=JSON.parse(raw);}catch(error){return {state:_freshCurrentDefaults(),recovery:{raw,reason:"Stored save is not valid JSON"}};}
  const result=validateAndMigrate(candidate);
  if(!result.ok)return {state:_freshCurrentDefaults(),recovery:{raw,reason:result.errors.join("; "),errors:result.errors,sourceVersion:result.sourceVersion}};
  return {state:result.state,recovery:null};
}
function importState(candidate){return validateAndMigrate(candidate);}
function validateWorkerState(candidate){return validateAndMigrate(candidate);}

function quarantineRejectedState(raw,reason){
  _activeStateRecovery={raw:typeof raw==="string"?raw:String(raw==null?"":raw),reason:String(reason||"Save rejected")};
  if(typeof localStorage!=="undefined")try{
    localStorage.setItem(STATE_REJECTED_KEY,_activeStateRecovery.raw);
    localStorage.setItem(STATE_REJECTED_REASON_KEY,_activeStateRecovery.reason);
  }catch(error){}
  return _activeStateRecovery;
}
function _acceptStateMutation(change){
  let result;
  if(typeof change==="function")result=change(S);
  else{S=change;result=S;}
  stateRevision+=1;
  return result===undefined?S:result;
}
function commitState(nextState){return _acceptStateMutation(nextState);}
function mutateState(mutator){
  if(typeof mutator!=="function")throw new TypeError("mutateState requires a mutation function");
  return _acceptStateMutation(mutator);
}
// Persistence validation returns a fresh, normalized clone of the already accepted state. Adopting
// that equivalent clone must not manufacture a second logical mutation/revision.
function _adoptValidatedClone(nextState){S=nextState;return S;}
function _readStorage(key){
  if(typeof localStorage==="undefined")return {ok:false,raw:null,error:"Local storage is unavailable"};
  try{return {ok:true,raw:localStorage.getItem(key)};}catch(error){return {ok:false,raw:null,error:(error&&error.message)||String(error)};}
}
function _restoreStorage(key,raw){if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);}
function _restorePersistedPair(mainRaw,backupRaw){
  try{_restoreStorage(LSKEY,mainRaw);}catch(error){}
  try{_restoreStorage(STATE_BACKUP_KEY,backupRaw);}catch(error){}
}
function _persistValidatedState(state,previousRaw){
  const validation=validateAndMigrate(state);
  if(!validation.ok)return {ok:false,errors:validation.errors};
  if(typeof localStorage==="undefined")return {ok:false,errors:["Local storage is unavailable"]};
  const nextRaw=JSON.stringify(validation.state);
  const oldMain=previousRaw!==undefined?previousRaw:_readStorage(LSKEY).raw;
  const oldBackup=_readStorage(STATE_BACKUP_KEY).raw;
  try{
    if(oldMain&&parseStoredState(oldMain).recovery===null)localStorage.setItem(STATE_BACKUP_KEY,oldMain);
    localStorage.setItem(LSKEY,nextRaw);
    return {ok:true,state:validation.state,raw:nextRaw};
  }catch(error){
    // Restore each key independently: an origin that rejects writes to the primary key
    // must not prevent restoration of the backup key changed earlier in the transaction.
    _restorePersistedPair(oldMain,oldBackup);
    return {ok:false,errors:[(error&&error.message)||String(error)]};
  }
}
function initializeState(render){
  const stored=_readStorage(LSKEY),raw=stored.raw;
  const backupBefore=_readStorage(STATE_BACKUP_KEY).raw;
  const parsed=stored.ok?parseStoredState(raw):{state:_freshCurrentDefaults(),recovery:null};
  commitState(parsed.state);
  let recovery=parsed.recovery;
  try{render();}
  catch(error){
    if(raw!==null){
      _restorePersistedPair(raw,backupBefore);
      recovery={raw,reason:"The saved build could not be rendered safely: "+((error&&error.message)||String(error))};
      commitState(_freshCurrentDefaults());
      render();
    }else throw error;
  }
  if(recovery)quarantineRejectedState(recovery.raw,recovery.reason);
  else if(stored.ok){
    const persisted=_persistValidatedState(S,raw);
    if(persisted.ok)_adoptValidatedClone(persisted.state);
  }
  return {state:S,recovery};
}
function applyImportedState(candidate,render,beforeRollback){
  const validation=importState(candidate);
  if(!validation.ok)return validation;
  const previousState=S,previousRaw=_readStorage(LSKEY).raw,previousBackup=_readStorage(STATE_BACKUP_KEY).raw;
  commitState(validation.state);
  try{render();}
  catch(error){
    _restorePersistedPair(previousRaw,previousBackup);
    if(typeof beforeRollback==="function")beforeRollback();
    commitState(previousState);
    try{render();}catch(rollbackError){}
    return {ok:false,errors:["Imported build could not be rendered: "+((error&&error.message)||String(error))]};
  }
  const persisted=_persistValidatedState(S,previousRaw);
  if(!persisted.ok){
    if(typeof beforeRollback==="function")beforeRollback();
    commitState(previousState);
    try{render();}catch(rollbackError){}
    return {ok:false,errors:persisted.errors};
  }
  _adoptValidatedClone(persisted.state);
  return {ok:true,state:S,sourceVersion:validation.sourceVersion};
}

let savT;
function save(){
  const previousRaw=_readStorage(LSKEY).raw;
  const persisted=_persistValidatedState(S,previousRaw);
  if(!persisted.ok){
    const el=typeof document!=="undefined"?document.getElementById("saveind"):null;
    if(el)el.textContent="invalid value not saved";
    return false;
  }
  _adoptValidatedClone(persisted.state);flashSaved();return true;
}
function flashSaved(){
  const el=typeof document!=="undefined"?document.getElementById("saveind"):null;if(!el)return;
  if(el.textContent!=="saved")el.innerHTML="<b>saved</b>";clearTimeout(savT);savT=setTimeout(()=>el.textContent="auto-saves locally",1400);
}

;
"use strict";
/* ---------- OPTIMIZER ---------- */
// Mined resources enter the solver as independent resources whose free supplies equal the
// user's corresponding mined incomes. Rocks remain informational rather than budgeted.
const VESP="Vespium";
// One correctness threshold for reconstructing project rates and executable LP plan entries.
const LP_ASSIGN_EPS=1e-9;
// A project-plan phase may credit an intermediate's leftover stock as free supply instead of
// crafting it (issue #73). Left uncapped, that credit scales with the phase's own throughput
// multiplier (z) exactly like an indefinitely-sustained production rate would, so a chronic (if
// small) shortfall between an item's real supply (Forgie + crafting) and its consumption gets
// entirely papered over by draining 100% of on-hand stock, with zero lines ever assigned to
// replenish it (issue #80). Reserving a margin forces the LP to keep some real production whenever
// stock alone can't be trusted to cover the gap, rather than banking on exhausting it to the unit.
const STOCK_SAFETY_FRAC=0.9;
// Line-assignment stability (issue #87 item 5). The makespan LP is rebuilt from scratch each solve
// with no memory of the previous assignment, and LP optima are frequently near-tied at the margin —
// so a small, unrelated edit can flip which physical line lands on which (item,level) for negligible
// benefit ("Line #N switched recipe"). HYST_FRAC is the hysteresis band: after the free solve we try
// a re-solve that pins each physical line to the jobs it ran last time, and keep that stable plan
// unless the free solve beats it by more than this fraction of throughput. _lineStability caches the
// prior per-line job sets, keyed by phase + line/item signature; it lives for the page session only
// (a reload starts from the canonical free solution), which is enough to kill mid-edit churn.
const HYST_FRAC=0.05;
// Cache shape: { [phaseKey+lineSig+itemSig]: { [physicalLineOrig]: ["item@lvl", ...] } }. Plain
// arrays (not Sets) so it survives the JSON/structured-clone round-trip to the solve worker — the
// worker is re-created per solve (true cancellation), so the main thread owns this cache and seeds
// the worker with it each solve, then copies the worker's updated copy back out (see results.js).
let _lineStability={};
function resetLineStability(){_lineStability={};}
function getLineStability(){return _lineStability;}
function setLineStability(o){_lineStability=(o&&typeof o==="object")?o:{};}
function relevantChain(targets){
  // A raw can now be a target itself (issue #78); only products have a recipe chain to expand,
  // so seed the product set from product targets and add any raw target straight into relR.
  const relP=new Set(targets.filter(t=>PRODUCTS.includes(t)));
  let changed=true;
  while(changed){changed=false;
    [...relP].forEach(P=>RECIPE[P].inputs.forEach(k=>{
      if(PRODUCTS.includes(k)&&!relP.has(k)){relP.add(k);changed=true;}
    }));
  }
  const relR=new Set(targets.filter(t=>RAWS.includes(t)));
  relP.forEach(P=>RECIPE[P].inputs.forEach(k=>{if(RAWS.includes(k))relR.add(k);}));
  return {prods:[...relP],raws:[...relR]};
}
function activeMinedResources(products){
  return [...new Set(products.map(p=>MINED_CRAFTS[p]&&MINED_CRAFTS[p].resource)
    .filter(r=>r&&minedBudgetHr(r)>0))];
}

function craftTime(item,L){return (num(S.baseTime&&S.baseTime[item])||1)*Math.pow(1.5,Math.log2(L));}
// Bits/hr consumed by crafts whose Bits are assumed PRE-PRODUCED (Frames, Wire). These products
// keep Bits out of the recipe graph, so this is a display-only read of the plan — it never feeds
// the line solver and never earns a dedicated Bits crafting line. Returns Bits/hr per such product.
function preprodBitsBreakdown(plan){
  const by={};
  (plan||[]).forEach(p=>{const j=p.job;
    if(j&&j.kind==="craft"&&PREPROD_BITS[j.res]){const L=j.lvl,ct=craftTime(j.res,L),sp=effSpeed(p.sp,ct);
      if(ct>0)by[j.res]=(by[j.res]||0)+(PREPROD_BITS[j.res]*Math.pow(3,Math.log2(L))/ct)*sp*3600;}});
  return by;
}
function preprodBitsHr(plan){return Object.values(preprodBitsBreakdown(plan)).reduce((a,b)=>a+b,0);}
// "8 per frame, 2 per wire" — per-unit note for the pre-produce readout, for the products present.
const PREPROD_BITS_UNIT={Frames:"frame",Wire:"wire"};
function preprodBitsNote(who){return who.map(n=>`${PREPROD_BITS[n]} per ${PREPROD_BITS_UNIT[n]||n.toLowerCase()}`).join(", ");}
function buildJobs(maxVal,resIndex,relRaws,relProds,targets,w){
  const allowed=LEVELS.filter(L=>L<=maxVal);
  const jobs=[{label:"Idle",kind:"idle",res:null,lvl:null,prod:[],cons:[],h:0}];
  relRaws.forEach(Rw=>{
    const ti=targets.indexOf(Rw);
    if(ti>=0){
      // Raw selected as an OUTPUT target (issue #78): offer every compression level, the way
      // products do, so the search can pick the floored-output-maximizing level (effective speed
      // is capped at the cycle time) and trade lines against the other targets — not just the
      // single fastest-rate feeder job.
      allowed.forEach(L=>{
        const t=craftTime(Rw,L);if(!(t>0))return;
        const rate=L/t;
        jobs.push({label:"Produce "+Rw,kind:"produce",res:Rw,lvl:L,ct:t,
          prod:[[resIndex[Rw],rate]],cons:[],h:rate/w[ti]});
      });
    }else{
      // Raw needed only as a feeder input: one fastest-rate produce job is enough.
      let best=null;
      allowed.forEach(L=>{
        const t=craftTime(Rw,L);if(!(t>0))return;
        const rate=L/t;
        if(!best||rate>best.rate)best={rate,L,t};
      });
      if(best)jobs.push({label:"Produce "+Rw,kind:"produce",res:Rw,lvl:best.L,ct:best.t,
        prod:[[resIndex[Rw],best.rate]],cons:[],h:0});
    }
  });
  relProds.forEach(P=>{
    const ins=RECIPE[P].inputs;
    allowed.forEach(L=>{
      const tt=craftTime(P,L);if(!(tt>0))return;
      let ok=true;const cons=[];
      ins.forEach(k=>{const c=S.prodCost[P][k][L];if(c==null||isNaN(c)||c<0){ok=false;}else cons.push([resIndex[k],c/tt]);});
      const mined=MINED_CRAFTS[P];
      if(mined){
        const r=mined.resource;
        if(resIndex[r]==null)return;
        const c=minedCost(P,L)[r];
        if(c==null||isNaN(c)||c<0)ok=false;else cons.push([resIndex[r],c/tt]);
      }
      if(!ok)return;
      const rate=L/tt;const ti=targets.indexOf(P);
      // ct = craft-cycle seconds at 1x speed; the line's effective speed is capped at ct (1s floor)
      jobs.push({label:"Craft "+P,kind:"craft",res:P,lvl:L,ct:tt,
        prod:[[resIndex[P],rate]],cons,h:ti>=0?rate/w[ti]:0});
    });
  });
  jobs.sort((a,b)=>b.h-a.h);
  return jobs;
}

function lineRows(){return S.lines.map((ln,i)=>({__i:i,max:ln.max,spx:ln.spx,turbo:ln.turbo}));}
const sortedLines=()=>lineRows().map(ln=>({orig:ln.__i,max:ln.max,sp:lineSpeed(ln),dp:dupeMult()})).sort((a,b)=>a.max-b.max||a.sp-b.sp||a.dp-b.dp);
const forgieHr=r=>num(S.forgie&&S.forgie[r])||0;

// Core solver: weighted max-min throughput for a set of product targets over their input
// chain. Priority weights set the desired output RATIO. Each line has a duplication chance
// (output ×(1+dup), input cost unchanged) and a margin tolerance allows a small paper
// shortfall ("may-work" plans). Anytime: multi-start + iterated local search seed a near-
// optimal feasible plan, then a wall-clock-bounded branch-and-bound proves/refines it.
// Finally, a tie-break pass minimises total input shortfall among plans tied on the
// objective, so a deficit the targets can't use (free to close from surplus feeders) gets
// closed instead of left on the margin as a phantom "may-work" plan.
function solveCore(targets,w,relProds,relRaws,timeBudget){
  // Each mined resource joins only when its craft is in the chain and it has a positive budget.
  // Its produced>=consumed balance then enforces that resource's burn independently.
  const mined=activeMinedResources(relProds);
  const resources=[...relRaws,...relProds,...mined];
  const resIndex={};resources.forEach((r,i)=>resIndex[r]=i);
  const R=resources.length;
  const tIdx=targets.map(t=>resIndex[t]);
  const tol=Math.max(0,Math.min(50,num(S.margin)||0))/100;
  // Active feasibility tolerance for the current search pass. The margin solve runs two passes
  // (strict tol=0, then the user's margin) so its result is monotone in margin — see the staged
  // search at the bottom of solveCore (issue #60).
  let curTol=tol;
  // Exogenous supply (per second) of each resource, added to the produced side. Craftable
  // materials use Lil' Forgie; mined resources use their own independent income budgets.
  const baseArr=Float64Array.from(resources.map(r=>
    isMinedResource(r)?minedBudgetHr(r)/3600:forgieHr(r)/3600));

  // data-availability check (cost only — time is computed from compression)
  const issues=[];
  relProds.forEach(P=>{
    const ins=RECIPE[P].inputs;
    const any=LEVELS.some(L=>ins.every(k=>S.prodCost[P][k][L]!=null&&!isNaN(S.prodCost[P][k][L])));
    if(!any)issues.push("No material cost entered for "+P+".");
  });

  // jobs per distinct max; per-line speed factor sp and dup factor dp
  const jobsByMax={};
  const sorted=sortedLines();
  sorted.forEach(s=>{if(!jobsByMax[s.max])jobsByMax[s.max]=buildJobs(s.max,resIndex,relRaws,relProds,targets,w);});
  const lineJobs=sorted.map(s=>jobsByMax[s.max]);
  const N=sorted.length;
  // effective speed per (line, job): a craft can't run under 1s real time, so speed is capped at the craft's cycle seconds (ct)
  const spEff=lineJobs.map((js,i)=>{const sp=sorted[i].sp;return js.map(j=>(j.ct>0&&sp>j.ct)?j.ct:sp);});
  const sameAsPrev=sorted.map((s,i)=>i>0&&s.max===sorted[i-1].max&&s.sp===sorted[i-1].sp&&s.dp===sorted[i-1].dp);
  // items bound: best (speed+dup scaled) production rate of each target reachable per line
  const bp=lineJobs.map((js,i)=>targets.map(t=>{let m=0;js.forEach(j=>{if((j.kind==="craft"||j.kind==="produce")&&j.res===t)m=Math.max(m,j.prod[0][1]);});return m*sorted[i].sp*sorted[i].dp;}));
  const SP=targets.map((t,ti)=>{const a=new Array(N+1).fill(0);for(let i=N-1;i>=0;i--)a[i]=a[i+1]+bp[i][ti];return a;});
  // feasibility prune: max extra production of each resource available from lines i..N-1.
  // If current produced + this suffix still can't cover current consumed, the branch is dead.
  const maxProd=Array.from({length:R},()=>new Float64Array(N+1));
  for(let r=0;r<R;r++)for(let i=N-1;i>=0;i--){let m=0;lineJobs[i].forEach(j=>{for(const[rr,a]of j.prod)if(rr===r)m=Math.max(m,a*sorted[i].sp*sorted[i].dp);});maxProd[r][i]=maxProd[r][i+1]+m;}

  const produced=new Float64Array(R), consumed=new Float64Array(R);
  const choice=new Array(N).fill(0);
  let best={score:0,choice:new Array(N).fill(0),produced:new Float64Array(R),consumed:new Float64Array(R)};
  const EPS=1e-9;

  let nodes=0;let capped=false;const tStart=performance.now();let tLastGain=tStart;
  // The budget is a ceiling, not a target: stop once the incumbent has gone this long without
  // improving, so a converged solve takes the same wall-time whether the budget is 1s or 15s
  // (the user's complaint). The window is fixed, not budget-scaled — it only needs to exceed the
  // largest gap between real improvements. Multi-target search has wider gaps (~0.6s seen) than a
  // single-target solve (each credits item), which converges almost immediately. Capped by the
  // budget so a tiny budget can still cut it short.
  const convergeWindow=Math.min(timeBudget,targets.length>1?1000:300);

  // Constructive feasible incumbent. The DFS prunes nothing until it owns a feasible
  // plan with positive score, and stumbling onto one by raw search is what made high
  // line-counts hang. So we build one cheaply: start every capable line on the chosen
  // resource, then repeatedly switch the line that most reduces the total input
  // shortfall until the plan balances. Seeds `best`, so the DFS prunes from the start.
  function evalChoice(ch){
    produced.set(baseArr);consumed.fill(0);
    for(let i=0;i<N;i++){const job=lineJobs[i][ch[i]],sp=spEff[i][ch[i]],dp=sorted[i].dp;for(const[r,a]of job.prod)produced[r]+=a*sp*dp;for(const[r,a]of job.cons)consumed[r]+=a*sp;}
  }
  const totalDeficit=()=>{let D=0;for(let r=0;r<R;r++){const d=consumed[r]-produced[r];if(d>0)D+=d;}return D;};
  const idleIdx=i=>{const k=lineJobs[i].findIndex(j=>j.kind==="idle");return k<0?0:k;};
  function bestJobFor(i,res){let bj=-1,bg=0;lineJobs[i].forEach((job,k)=>{for(const[r,a]of job.prod)if(r===res){const g=a*sorted[i].sp*sorted[i].dp;if(g>bg){bg=g;bj=k;}}});return bj;}
  const needFrac=r=>isMinedResource(resources[r])?1:(1-curTol);
  const feasibleNow=()=>{for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac(r)-1e-7)return false;return true;};
  const scoreNow=()=>{let sc=Infinity;for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}return sc;};
  // repair input shortfall down to a feasible plan: each step makes the single line-switch
  // (toward producing ANY short resource) that cuts total shortfall most. Returns feasibility.
  // Drive total input shortfall to zero. Each step makes the single line-switch (to ANY job
  // — produce an input, OR drop a craft to a cheaper/lower level) that cuts the shortfall most.
  function repair(ch){
    for(let guard=0;guard<6*N+40;guard++){
      evalChoice(ch);const D=totalDeficit();if(D<=1e-7)break;
      let bI=-1,bJ=-1,bRed=1e-12;
      for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i];
        for(let k=0;k<js.length;k++){if(k===old)continue;ch[i]=k;evalChoice(ch);const red=D-totalDeficit();if(red>bRed){bRed=red;bI=i;bJ=k;}}
        ch[i]=old;evalChoice(ch);}
      if(bI<0)break;ch[bI]=bJ;
    }
    evalChoice(ch);return feasibleNow();
  }
  // hill-climb the objective with single-line best-improvement moves, staying feasible
  function climb(ch){
    let cur=scoreNow();
    for(let pass=0;pass<N+3;pass++){
      let improved=false;
      for(let i=0;i<N;i++){const old=ch[i];let bk=old,bs=cur;
        const js=lineJobs[i];for(let k=0;k<js.length;k++){if(k===old)continue;ch[i]=k;evalChoice(ch);if(feasibleNow()){const s=scoreNow();if(s>bs+EPS){bs=s;bk=k;}}}
        ch[i]=bk;if(bk!==old){cur=bs;improved=true;}else evalChoice(ch);
      }
      if(!improved)break;
    }
    return cur;
  }
  // full local optimisation from a starting choice; returns its score or null if infeasible
  function localOpt(ch){if(!repair(ch))return null;const sc=climb(ch);evalChoice(ch);return feasibleNow()?sc:null;}
  // Tie-break: among plans that match the optimal objective, prefer the one with the least
  // total input shortfall. The objective only counts net TARGET output, so a deficit the
  // targets can't consume (e.g. a feeder running on the 1.5% margin while its raw sits in
  // surplus) costs the score nothing and the search has no reason to close it. Holding the
  // score fixed, hill-climb single-line switches that cut total deficit — typically bumping a
  // short feeder's compression, paid for from the surplus raw — so a free gap is balanced out
  // rather than reported as a phantom "may-work" plan.
  function minDeficitAtScore(ch,targetScore){
    evalChoice(ch);let curD=totalDeficit();
    for(let pass=0;pass<N+3&&curD>1e-7;pass++){
      let improved=false;
      for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i];let bk=old,bD=curD;
        for(let k=0;k<js.length;k++){if(k===old)continue;ch[i]=k;evalChoice(ch);
          if(feasibleNow()&&scoreNow()>=targetScore-EPS){const d=totalDeficit();if(d<bD-1e-9){bD=d;bk=k;}}}
        ch[i]=bk;evalChoice(ch);if(bk!==old){curD=bD;improved=true;}}
      if(!improved)break;
    }
    return ch;
  }
  let _rng=0x2545f491>>>0;const rnd=()=>{_rng^=_rng<<13;_rng^=_rng>>>17;_rng^=_rng<<5;_rng>>>=0;return _rng/4294967296;};

  function dfs(i,prevIdx){
    if(((++nodes)&8191)===0){const _n=performance.now();if(_n-tStart>timeBudget||_n-tLastGain>convergeWindow)capped=true;}
    if(capped)return;
    if(i===N){
      for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac(r)-1e-7)return;
      let sc=Infinity;
      for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}
      if(sc>best.score+EPS){best={score:sc,choice:choice.slice(),produced:produced.slice(),consumed:consumed.slice()};tLastGain=performance.now();}
      return;
    }
    // feasibility prune: any resource whose current shortfall can't be covered by remaining lines kills this branch
    for(let r=0;r<R;r++)if(produced[r]+maxProd[r][i]<consumed[r]*needFrac(r)-1e-7)return;
    // max-min upper bound: best achievable min-over-targets if remaining lines max-produce each target
    let ub=Infinity;
    for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]]+SP[k][i];ub=Math.min(ub,net/w[k]);}
    if(ub<=best.score+EPS)return;
    const js=lineJobs[i];const dp=sorted[i].dp,spE=spEff[i];
    const start=sameAsPrev[i]?prevIdx:0;
    for(let j=start;j<js.length;j++){
      if(capped)return;
      const job=js[j],sp=spE[j];
      for(const[r,a]of job.prod)produced[r]+=a*sp*dp;
      for(const[r,a]of job.cons)consumed[r]+=a*sp;
      choice[i]=j;
      dfs(i+1,j);
      for(const[r,a]of job.prod)produced[r]-=a*sp*dp;
      for(const[r,a]of job.cons)consumed[r]-=a*sp;
    }
  }
  // LP relaxation: let each line split its time fractionally across its jobs and maximize the
  // min target ratio z. It yields (a) an upper bound on the integer optimum and (b) a rounded
  // incumbent for the discrete search to refine. This is what lets the search FIND feasible plans
  // when Gel (a vespium-bounded intermediate) is in the chain — the pure combinatorial DFS can
  // miss them at scale, which the old line-reservation sweep used to paper over by decomposing.
  function lpRelax(){
    const offs=[];let nv=0;
    for(let i=0;i<N;i++){offs.push(nv);nv+=lineJobs[i].length;}
    const zc=nv,n=nv+1,A=[],b=[];
    for(let i=0;i<N;i++){const row=new Float64Array(n);for(let j=0;j<lineJobs[i].length;j++)row[offs[i]+j]=1;A.push(row);b.push(1);}
    const tw={};targets.forEach((t,k)=>tw[tIdx[k]]=w[k]);
    for(let r=0;r<R;r++){
      const row=new Float64Array(n);
      for(let i=0;i<N;i++)for(let j=0;j<lineJobs[i].length;j++){const job=lineJobs[i][j],sp=spEff[i][j],dp=sorted[i].dp;let net=0;
        for(const[rr,a]of job.prod)if(rr===r)net+=a*sp*dp;
        for(const[rr,a]of job.cons)if(rr===r)net-=a*sp;
        if(net)row[offs[i]+j]=-net;}
      if(tw[r]!==undefined)row[zc]=tw[r];
      A.push(row);b.push(baseArr[r]);
    }
    const c=new Float64Array(n);c[zc]=1;
    const sol=lpMaximize(c,A,b);
    if(!sol.x)return null;
    const choice=new Array(N),frac=[];
    for(let i=0;i<N;i++){let bj=0,bf=-1;const fr=new Array(lineJobs[i].length);
      for(let j=0;j<lineJobs[i].length;j++){const f=sol.x[offs[i]+j]||0;fr[j]=f>0?f:0;if(f>bf){bf=f;bj=j;}}
      choice[i]=bj;frac.push(fr);}
    return {z:sol.x[zc]||0,choice,frac};
  }
  // multi-start local search: diversified roundings of the LP relaxation + one seed per target,
  // then iterated local search. Pure argmax rounding flattens lines the LP split between Gel and a
  // target and loses a lot, so we also draw several randomized roundings weighted by the LP fractions.
  const lp=N>0?lpRelax():null;
  // Two-pass margin search for monotonicity (issue #60). A plan feasible with NO margin is feasible
  // at ANY margin with the same objective, so we solve strict (tol=0) first, then seed the relaxed
  // pass with that strict optimum — the margin result can only match or beat the no-margin result,
  // never fall below it. With no margin there's a single pass (identical to before). Both passes
  // share the wall-clock budget (tStart is global); each gets a fresh convergence window and
  // incumbent so an easy factory still has time left to exploit the margin.
  const stages=tol>0?[0,tol]:[tol];
  let carry=null;
  for(let si=0;si<stages.length;si++){
  curTol=stages[si];capped=false;tLastGain=performance.now();
  let inc=null;
  const trySeed=ch=>{const c=ch.slice();const sc=localOpt(c);if(sc!=null&&(!inc||sc>inc.sc)){inc={sc,ch:c.slice()};tLastGain=performance.now();}};
  if(carry)trySeed(carry);   // strict optimum seeds the relaxed pass -> never drops below no-margin
  // The seed set is fixed (budget-independent) on purpose: the ilsT/DFS caps are measured from the
  // solve start, so seeds just consume part of the budget rather than extending it — and a fixed set
  // keeps the search trajectory monotonic in budget (more time never yields a worse plan).
  if(lp&&lp.z>EPS){
    trySeed(lp.choice);
    for(let t=0;t<16;t++){const ch=new Array(N);
      for(let i=0;i<N;i++){const fr=lp.frac[i];let s=0;for(let j=0;j<fr.length;j++)s+=fr[j];
        let x=rnd()*(s>1e-12?s:1),pick=lp.choice[i];
        for(let j=0;j<fr.length;j++){x-=fr[j];if(x<=0){pick=j;break;}}
        ch[i]=pick;}
      trySeed(ch);}
  }
  // Reservation-style seeds: dedicate the k best Gel-efficiency lines to Gel (levels from the same
  // budget greedy the modal preview uses), and let localOpt fill the rest. This hands the unified
  // search the starting points the old per-k decomposition explored — so it's never worse on a
  // Gel chain — at the cost of M+1 cheap local optimisations, not nested solves.
  const gelBudgetHr=minedBudgetHr(VESP);
  if(resIndex[VESP]!=null&&gelBudgetHr>0){
    const o2s={};sorted.forEach((s,i)=>o2s[s.orig]=i);
    const ranked=lineRows().sort((a,b)=>gelOutHr(b,b.max)-gelOutHr(a,a.max));
    for(let k=1;k<=ranked.length;k++){
      const lo=gelLoadout(ranked.slice(0,k),gelBudgetHr);
      if(!lo.perLine.length)continue;
      const ch=new Array(N);for(let i=0;i<N;i++)ch[i]=idleIdx(i);
      lo.perLine.forEach(pl=>{const i=o2s[pl.__i];if(i==null)return;
        const j=lineJobs[i].findIndex(jb=>jb.kind==="craft"&&jb.res===GEL&&jb.lvl===pl.L);if(j>=0)ch[i]=j;});
      trySeed(ch);
    }
  }
  // Role-based seeds (single target): the LP reveals which feeder items the chain needs, but the
  // local search can't decide WHICH line takes each feeder role — putting the bottleneck feeder on
  // the fastest line briefly lowers the target, so no single improving move finds it. Enumerate the
  // line->role assignments (rest = target at an efficient level) and localOpt each. Bounded by a
  // fixed count, so it stays deterministic (monotonic in budget) and within the seed budget; full
  // coverage for up to ~8 lines / 3 feeders, a deterministic prefix beyond that.
  if(lp&&targets.length===1){
    const tgt=tIdx[0],tgtRes=resources[tgt];
    const arg=[];for(let i=0;i<N;i++){let bj=0,bf=-1;const fr=lp.frac[i];for(let j=0;j<fr.length;j++)if(fr[j]>bf){bf=fr[j];bj=j;}arg.push(lineJobs[i][bj]);}
    const feeders=[...new Set(arg.filter(j=>j&&j.kind!=="idle"&&j.res!==tgtRes).map(j=>j.res))];
    const roleJob=(li,res)=>{let bj=-1,bl=-1;const js=lineJobs[li];for(let k=0;k<js.length;k++){const j=js[k];if((j.kind==="craft"||j.kind==="produce")&&j.res===res&&j.lvl>bl){bl=j.lvl;bj=k;}}return bj;};
    const tgtSeed=i=>{const js=lineJobs[i];for(let k=0;k<js.length;k++)if(js[k].kind==="craft"&&js[k].res===tgtRes&&js[k].lvl<=8)return k;const b=bestJobFor(i,tgt);return b>=0?b:idleIdx(i);};
    if(feeders.length&&feeders.length<=4){
      let tried=0;const cap=350;
      const rec=(fi,used)=>{
        if(tried>=cap)return;
        if(fi===feeders.length){const ch=new Array(N);for(let i=0;i<N;i++)ch[i]=tgtSeed(i);
          for(let k=0;k<feeders.length;k++){const bj=roleJob(used[k],feeders[k]);if(bj>=0)ch[used[k]]=bj;}
          trySeed(ch);tried++;return;}
        for(let i=N-1;i>=0&&tried<cap;i--){if(used.indexOf(i)>=0)continue;rec(fi+1,used.concat(i));}  // fastest-first
      };
      rec(0,[]);
    }
  }
  targets.map(t=>resIndex[t]).forEach(res=>{const ch=new Array(N);for(let i=0;i<N;i++){const bj=bestJobFor(i,res);ch[i]=bj>=0?bj:idleIdx(i);}const sc=localOpt(ch);if(sc!=null&&(!inc||sc>inc.sc)){inc={sc,ch:ch.slice()};tLastGain=performance.now();}});
  if(inc&&N>0){
    // ILS gets the bulk of the budget so accuracy scales with the user's max-time setting: at high
    // line counts the exact DFS caps out without beating the heuristic, so perturbing the incumbent
    // is the productive use of extra time. A stagnation cutoff stops once perturbation stops paying
    // off, so an easy factory — or a generous budget on a simple one — doesn't burn time it can't use.
    // ILS uses an iteration-based stagnation cutoff (not wall-clock): stopping at a fixed iteration
    // is budget-independent, which keeps the result monotonic in budget. The single-target case
    // (each credits item) converges in a handful of iterations, so it gets a much smaller limit.
    const ilsT=timeBudget*0.8,stagLimit=targets.length>1?8000:1200;let stag=0;
    for(let it=0;it<2000000;it++){
      if(performance.now()-tStart>ilsT||stag>stagLimit)break;
      const ch=inc.ch.slice();const k=1+((rnd()*2)|0);
      for(let m=0;m<=k;m++){const li=(rnd()*N)|0,js=lineJobs[li];ch[li]=(rnd()*js.length)|0;}
      const sc=localOpt(ch);if(sc!=null&&sc>inc.sc+EPS){inc={sc,ch:ch.slice()};stag=0;tLastGain=performance.now();}else stag++;
    }
    evalChoice(inc.ch);best={score:scoreNow(),choice:inc.ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  produced.set(baseArr);consumed.fill(0);
  // LP z bounds the integer optimum; if the incumbent already reaches it, the search is done.
  if(!(lp&&best.score>=lp.z-1e-6*Math.max(1,lp.z)))dfs(0,0);
  // balance any free deficit out of the now-optimal plan (keeps the objective, trims the margin use)
  if(best.score>EPS&&N>0){
    const ch=minDeficitAtScore(best.choice.slice(),best.score);
    evalChoice(ch);best={score:scoreNow(),choice:ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  carry=best.choice.slice();   // hand this pass's optimum to the next (relaxed) pass as a floor
  }
  let usesMargin=false;for(let r=0;r<R;r++)if(best.produced[r]<best.consumed[r]-1e-6)usesMargin=true;
  const forgie={};resources.forEach((r,i)=>forgie[r]=baseArr[i]*3600);
  return {best,sorted,lineJobs,resources,resIndex,R,N,tIdx,tol,capped,usesMargin,issues,forgie,feasible:best.score>1e-9,ms:performance.now()-tStart};
}

function minedUsageFromItemPlan(plan){
  const by={};
  (plan||[]).forEach(p=>{const j=p&&p.job,cfg=j&&j.kind==="craft"&&MINED_CRAFTS[j.res];
    if(!cfg)return;
    const es=effSpeed(p.sp,j.ct);
    const outHr=j.prod[0][1]*es*p.dp*3600,craftsHr=j.ct>0?(es/j.ct)*3600:0;
    Object.entries(minedCost(j.res,j.lvl)).forEach(([resource,cost])=>{
      const inputHr=cost*craftsHr,key=j.res+"\u0000"+resource;
      if(!by[key])by[key]={item:j.res,resource,lines:0,outHr:0,inputHr:0,perLine:[]};
      const use=by[key];use.lines++;use.outHr+=outHr;use.inputHr+=inputHr;
      use.perLine.push({line:p.line,lvl:j.lvl,outHr,inputHr});
    });
  });
  return Object.values(by);
}

// Build the per-line plan + resource balance (per hour) from a core solve.
function planFrom(sr){
  const {best,sorted,lineJobs,resources,resIndex,feasible,forgie}=sr;
  const plan=new Array(sorted.length);
  sorted.forEach((s,i)=>{const idle=lineJobs[i].find(j=>j.kind==="idle")||lineJobs[i][0];
    const job=feasible?lineJobs[i][best.choice[i]]:idle;
    const row={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job};
    if(job&&job.kind==="craft"&&job.res===GEL)row.reserved=true;
    plan[s.orig]=row;});
  const minedUsage=minedUsageFromItemPlan(plan);
  const gelUse=minedUsage.find(u=>u.item===GEL&&u.resource===VESP);
  if(gelUse)gelUse.perLine.forEach(use=>{const row=plan[use.line-1];if(row){row.gelHr=use.outHr;row.vespHr=use.inputHr;}});
  // best.produced already includes Forgie's supply; split it back out for display. Mined budgets
  // are surfaced through minedUsage, so keep all of them out of the craftable balance table.
  const balance=resources.filter(r=>!MINED_RESOURCES.includes(r)).map(r=>{const i=resIndex[r];const f=(forgie&&forgie[r])||0;
    const total=feasible?best.produced[i]*3600:0;
    return {res:r,prod:Math.max(0,total-f),forgie:feasible?f:0,cons:feasible?best.consumed[i]*3600:0};});
  const gelReserved=gelUse?{lines:gelUse.lines,outHr:gelUse.outHr,vespHr:gelUse.inputHr}:null;
  return {plan,balance,minedUsage,gelReserved};
}
function idlePlan(){
  const plan=[];
  sortedLines().forEach(s=>{plan[s.orig]={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job:{kind:"idle",res:null,lvl:null,prod:[],cons:[]}};});
  return plan;
}
// Dedicate every line to producing one raw material (raws have no inputs).
function solveRaw(Rw){
  let total=0;const plan=[];const resIndex={[Rw]:0};
  sortedLines().forEach(s=>{
    const allowed=LEVELS.filter(L=>L<=s.max);let bst=null;
    // pick the level that maximises floored output (effective speed capped at the cycle time)
    allowed.forEach(L=>{const t=craftTime(Rw,L);if(t>0){const out=(L/t)*(s.sp>t?t:s.sp);if(!bst||out>bst.out)bst={rate:L/t,L,t,out};}});
    const job=bst?{kind:"produce",res:Rw,lvl:bst.L,ct:bst.t,prod:[[0,bst.rate]],cons:[]}:{kind:"idle",res:null,lvl:null,prod:[],cons:[]};
    if(bst)total+=bst.out*s.dp;
    plan[s.orig]={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job};
  });
  const fHr=forgieHr(Rw);   // Lil' Forgie (+ any reserved) free supply of this raw
  const lineOut=total*3600, out=lineOut+fHr;
  return {item:Rw,kind:"raw",out,plan,balance:[{res:Rw,prod:lineOut,forgie:fHr,cons:0}],resIndex,capped:false,feasible:out>1e-9};
}

function optimizeInner(timeBudget){
  // Budgets are an anytime CAP, not a fixed wait: solveCore returns the moment its branch-and-
  // bound completes, so an easy plan finishes in tens of ms and never hits this. The cap only
  // bounds the worst case for a genuinely hard factory — and it must leave a slow phone enough
  // room, since it does far less search per ms than a desktop. The old 250ms let mobile cap out
  // on a suboptimal, device-dependent plan (issue #34: a profile that proves out in ~250ms on
  // desktop capped at a worse plan on a phone). 600ms ~doubles a slow device's search while
  // keeping the worst-case freeze well under half a second (and it's one-shot, post-debounce).
  // User-set max solve time (ms); the budget is an anytime cap, so easy factories still finish early.
  // Runs off the main thread (Web Worker), so a larger default doesn't freeze the UI.
  const userBudget=Math.max(200,Math.min(60000,num(S.solveBudget)||2000));
  const itemsBudget=timeBudget||userBudget, credBudget=timeBudget||userBudget;
  const mode=S.mode==="credits"?"credits":"items";
  if(mode==="items"){
    const targets=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
    if(targets.length===0)return {empty:true,mode};
    const w=targets.map(it=>S.targets[it].w);
    const rc=relevantChain(targets);
    const t0=performance.now();
    const sr=solveCore(targets,w,rc.prods,rc.raws,itemsBudget);
    const {plan,balance,minedUsage,gelReserved}=planFrom(sr);
    const out={};targets.forEach((t,k)=>{out[t]=sr.feasible?(sr.best.produced[sr.tIdx[k]]-sr.best.consumed[sr.tIdx[k]])*3600:0;});
    const objective=sr.feasible?Math.min(...targets.map((t,k)=>(out[t]||0)/w[k])):0;
    return {empty:false,mode,issues:sr.issues,plan,balance,minedUsage,gelReserved,out,resIndex:sr.resIndex,targets,objective,tol:sr.tol,usesMargin:sr.usesMargin,feasible:sr.feasible,capped:sr.capped,ms:performance.now()-t0};
  }
  // credits: the optimum is always mono-product — dedicate the whole factory to ONE item.
  // So just compute each priced item's max output/hr × its price and take the winner.
  const t0=performance.now();
  const pricedP=PRODUCTS.filter(p=>(num(S.sellPrice&&S.sellPrice[p])||0)>0);
  const pricedR=RAWS.filter(r=>(num(S.sellPrice&&S.sellPrice[r])||0)>0);
  const issues=[];let capped=false,usesMargin=false;
  if(pricedP.length+pricedR.length===0)issues.push("No sell prices entered. Open the “Sell prices” button and add at least one.");
  const evalP=pricedP,evalR=pricedR;
  const budgetEach=Math.max(25,Math.floor(credBudget/Math.max(1,evalP.length)));
  const cand=[];
  evalP.forEach(P=>{
    const price=num(S.sellPrice[P])||0;
    const ins=RECIPE[P].inputs;
    const hasCost=LEVELS.some(L=>ins.every(k=>S.prodCost[P][k][L]!=null&&!isNaN(S.prodCost[P][k][L])));
    if(!hasCost){issues.push("No material cost entered for "+P+" — can't price it.");cand.push({item:P,kind:"product",out:0,price,credits:0,plan:null,balance:null,minedUsage:[],resIndex:{},feasible:false});return;}
    const rc=relevantChain([P]);
    const sr=solveCore([P],[1],rc.prods,rc.raws,budgetEach);
    if(sr.capped)capped=true;if(sr.usesMargin)usesMargin=true;
    const {plan,balance,minedUsage,gelReserved}=planFrom(sr);
    const out=sr.feasible?(sr.best.produced[sr.resIndex[P]]-sr.best.consumed[sr.resIndex[P]])*3600:0;
    cand.push({item:P,kind:"product",out,price,credits:out*price,plan,balance,minedUsage,gelReserved,resIndex:sr.resIndex,feasible:sr.feasible});
  });
  evalR.forEach(Rw=>{const s=solveRaw(Rw);const price=num(S.sellPrice[Rw])||0;cand.push({item:Rw,kind:"raw",out:s.out,price,credits:s.out*price,plan:s.plan,balance:s.balance,minedUsage:[],resIndex:s.resIndex,feasible:s.feasible});});
  cand.sort((a,b)=>b.credits-a.credits);
  const top=cand[0];
  const feasible=!!top&&top.credits>1e-9;
  return {empty:false,mode,issues,ranking:cand,bestItem:feasible?top.item:null,credits:feasible?top.credits:0,objective:feasible?top.credits:0,
    plan:feasible?top.plan:idlePlan(),balance:feasible?top.balance:[],minedUsage:feasible?top.minedUsage:[],gelReserved:feasible?top.gelReserved:null,resIndex:feasible?top.resIndex:{},
    tol:Math.max(0,Math.min(50,num(S.margin)||0))/100,usesMargin,feasible,capped,ms:performance.now()-t0};
}

/* ---------- Gel loadout ----------
   Gel is a native resource in the solve now (see solveCore / projectSchedule). gelLoadout powers
   both the Gel modal's "max Gel/hr + setup" preview and solveCore's reservation-style seeds. */
// Gel output / vespium burn for a whole line running Gel @L (≤ the line's own cap), full time.
function gelOutHr(row,L){const sp=lineSpeed(row),dp=dupeMult(),ct=craftTime(GEL,L);return ct>0?(L/ct)*effSpeed(sp,ct)*dp*3600:0;}
function gelVespHr(row,L){const sp=lineSpeed(row),ct=craftTime(GEL,L);return ct>0?gelOreCost(L).vesp*(effSpeed(sp,ct)/ct)*3600:0;}
// Maximum Gel/hr obtainable from `rows` within a vespium/hr budget. In-game a crafter runs ONE
// compression FULL-TIME (you can't throttle uptime or blend levels), so each used line is assigned
// a single whole level and the plan must stay under the budget — leftover vespium is simply profit,
// not wasted capacity. Raising compression doubles Gel but triples vespium, so marginal Gel-per-
// vespium falls with level: greedily apply the cheapest-per-Gel single-level step-up that still fits
// the remaining budget until none fit. Returns the total + per-line {__i,max,L,gelHr,vespHr,frac};
// frac is always 1 (full-time) — kept so the plan/balance display code can read it uniformly.
function gelLoadout(rows,vespBudgetHr){
  if(!(vespBudgetHr>0)||!rows.length)return {gelHr:0,vespHr:0,perLine:[]};
  const levelsFor=rows.map(row=>[0,...LEVELS.filter(L=>L<=(row.max||0))]);   // [off, 1×, 2×, …]
  const cur=rows.map(()=>0);   // chosen level index per line (0 = off)
  let spent=0,gel=0;
  for(;;){
    let bI=-1,bIdx=-1,bEff=-1,bDv=0,bDg=0;
    rows.forEach((row,ri)=>{
      const lv=levelsFor[ri],ci=cur[ri];
      if(ci+1>=lv.length)return;   // already at this line's cap
      const Lnow=lv[ci],Lnext=lv[ci+1];
      const dv=gelVespHr(row,Lnext)-(Lnow?gelVespHr(row,Lnow):0);
      const dg=gelOutHr(row,Lnext)-(Lnow?gelOutHr(row,Lnow):0);
      if(dv<=1e-9||dg<=0||spent+dv>vespBudgetHr+1e-6)return;   // no gain, or doesn't fit the budget
      const eff=dg/dv;
      if(eff>bEff){bEff=eff;bI=ri;bIdx=ci+1;bDv=dv;bDg=dg;}
    });
    if(bI<0)break;
    cur[bI]=bIdx;spent+=bDv;gel+=bDg;
  }
  const perLine=[];
  rows.forEach((row,ri)=>{const L=levelsFor[ri][cur[ri]];if(!L)return;
    perLine.push({__i:row.__i,max:row.max,L,gelHr:gelOutHr(row,L),vespHr:gelVespHr(row,L),frac:1});});
  return {gelHr:gel,vespHr:spent,perLine};
}
// Vespium/hr income from the user's vespium/minute figure (0 if unset → Gel off).
function gelVespBudgetHr(){return minedBudgetHr("Vespium");}
function projectDemand(){
  const gross={};ALLITEMS.forEach(it=>gross[it]=0);
  const perProject=[];
  (S.projects||[]).forEach(p=>{
    if(!p.on)return;
    const lv=p.levels||[];
    const from=Math.max(1,Math.min(lv.length,Math.floor(num(p.from)||1)));   // clamp to level count so from>levels isn't read as "complete" (issue #87)
    const to=Math.min(lv.length,Math.max(from,Math.floor(num(p.to)||lv.length)));
    // levels completed in the tracker are skipped — non-destructive progress that
    // raises the effective start level without touching the user's from→to target.
    const done=Math.max(0,Math.min(to-from+1,Math.floor(num(p.done)||0)));
    const start=from-1+done;
    if(start>=to)return;   // project fully checked off — nothing left to craft
    const sub={};ALLITEMS.forEach(it=>sub[it]=0);
    for(let i=start;i<to&&i<lv.length;i++){
      (lv[i].costs||[]).forEach(c=>{const it=c.item,q=num(c.qty)||0;if(ALLITEMS.includes(it)&&q>0){sub[it]+=q;gross[it]+=q;}});
    }
    perProject.push({id:p.id||"",name:p.name||"Project",catId:p.catId||"",prio:(p.prio!=null?p.prio:null),from:start+1,to,levels:lv.length,sub});
  });
  const inv=it=>num(S.inventory&&S.inventory[it])||0;
  const net={};ALLITEMS.forEach(it=>{net[it]=Math.max(0,gross[it]-inv(it));});
  // Frames & Wire each consume Bits that aren't in the recipe graph — fold them into Bits demand
  const ppBits=PREPROD_BITS.Frames*(net.Frames||0)+PREPROD_BITS.Wire*(net.Wire||0);
  if(ppBits>0)net.Bits=Math.max(0,(gross.Bits||0)+ppBits-inv("Bits"));
  return {gross,net,perProject};
}
// Which unavailable mined resources block this item or any product in its recipe chain?
// Passive supply of the item itself bypasses its crafting chain.
function chainMinedBlockers(item,seen){
  if(forgieHr(item)>1e-9)return [];
  seen=seen||new Set();if(seen.has(item))return [];seen.add(item);
  const out=[],cfg=MINED_CRAFTS[item];
  if(cfg&&minedBudgetHr(cfg.resource)<=0)out.push(cfg.resource);
  const rec=RECIPE[item];
  (rec&&rec.inputs||[]).forEach(k=>{
    if(PRODUCTS.includes(k))out.push(...chainMinedBlockers(k,new Set(seen)));
  });
  return [...new Set(out)];
}
// Dense single-phase simplex. Maximize c·x s.t. A x <= b (b>=0), x>=0. Bland's rule (no cycling).
function lpMaximize(c,A,b){
  const m=A.length,n=c.length,W=n+m+1;
  const T=[];
  for(let i=0;i<m;i++){const row=new Float64Array(W);for(let j=0;j<n;j++)row[j]=A[i][j];row[n+i]=1;row[W-1]=b[i];T.push(row);}
  const obj=new Float64Array(W);for(let j=0;j<n;j++)obj[j]=-c[j];T.push(obj);
  const basis=[];for(let i=0;i<m;i++)basis.push(n+i);
  for(let it=0;it<20000;it++){
    let piv=-1;for(let j=0;j<n+m;j++){if(T[m][j]<-1e-9){piv=j;break;}}   // entering (Bland)
    if(piv<0)break;
    let leave=-1,best=Infinity;
    for(let i=0;i<m;i++){const a=T[i][piv];if(a>1e-9){const r=T[i][W-1]/a;if(r<best-1e-12||(Math.abs(r-best)<1e-12&&(leave<0||basis[i]<basis[leave]))){best=r;leave=i;}}}
    if(leave<0)return {x:null,unbounded:true};
    const prow=T[leave],pv=prow[piv];
    for(let j=0;j<W;j++)prow[j]/=pv;
    for(let i=0;i<=m;i++){if(i===leave)continue;const f=T[i][piv];if(Math.abs(f)>1e-12){const ri=T[i];for(let j=0;j<W;j++)ri[j]-=f*prow[j];}}
    basis[leave]=piv;
  }
  const x=new Float64Array(n);for(let i=0;i<m;i++)if(basis[i]<n)x[basis[i]]=T[i][W-1];
  return {x};
}
// Assemble the makespan LP (A x <= b, maximize c·x) from a job-variable list. Split out of
// projectSchedule so the stability pass (issue #87 item 5) can rebuild it over a pinned subset of the
// jobs. Returns the tableau plus the z-column index and total width.
function buildScheduleLP(vars,lns,items,net,avail,D0){
  const nY=vars.length,zCol=nY,n=nY+1;
  const A=[],b=[];
  lns.forEach((ln,li)=>{const row=new Array(n).fill(0);vars.forEach((v,vi)=>{if(v.li===li)row[vi]=1;});A.push(row);b.push(1);});
  items.forEach(it=>{
    const row=new Array(n).fill(0);
    vars.forEach((v,vi)=>{if(v.item===it)row[vi]-=v.rate;v.cons.forEach(c=>{if(c.item===it)row[vi]+=c.perHr;});});
    row[zCol]=((net[it]||0)-(avail&&avail[it]||0)*STOCK_SAFETY_FRAC)/D0;
    A.push(row);b.push(isMinedResource(it)?minedBudgetHr(it):forgieHr(it));
  });
  const c=new Array(n).fill(0);c[zCol]=1;
  return {A,b,c,zCol,n};
}
// Build & solve the makespan LP: each line splits its time-fraction across (item,level) jobs so that
// net production meets the demand ratio. z = throughput multiplier (1/hr); makespan = 1/z.
// `avail` (optional) is per-item stock that may be DRAWN DOWN over the project instead of produced —
// e.g. Ingots held in inventory but never a direct project cost. Modelled as extra supply of
// avail[it]/T units/hr (T=makespan), which linearises to a +avail[it]·z/D0 term on the supply side,
// so a material fully covered by stock earns no crafting line at all (issue #73).
// `opts.stabilize` (with opts.phaseKey) opts this solve into the Tier-2 line-stability pass.
function projectSchedule(net,targets,avail,opts){
  const lns=sortedLines();
  const prodT=targets.filter(it=>PRODUCTS.includes(it));
  const rawT=targets.filter(it=>RAWS.includes(it));
  const rc=relevantChain(prodT);
  // Every mined craft is a normal LP job with its ordinary recipe inputs plus its own mined input.
  // Active mined resources join independently as constrained supplies from the user's incomes.
  const products=[...new Set([...rc.prods,...prodT])];
  const mined=activeMinedResources(products);
  const items=[...new Set([...rc.raws,...rawT,...products,...mined])];
  const itemIdx={};items.forEach((it,i)=>itemIdx[it]=i);
  // jobs: one variable per (line,item,level<=cap). Letting the LP pick the level finds the true
  // makespan-optimal compression (leans high for raw speed, eases off when materials bottleneck).
  const vars=[];
  lns.forEach((ln,li)=>{
    items.forEach(it=>{
      LEVELS.filter(L=>L<=ln.max).forEach(L=>{
        if(RAWS.includes(it)){const t=craftTime(it,L);if(!(t>0))return;const es=effSpeed(ln.sp,t);vars.push({li,item:it,lvl:L,rate:(L/t)*es*ln.dp*3600,cons:[]});}
        else if(PRODUCTS.includes(it)){const ins=RECIPE[it].inputs;const tt=craftTime(it,L);if(!(tt>0))return;
          if(!ins.every(k=>S.prodCost[it][k][L]!=null&&!isNaN(S.prodCost[it][k][L])))return;
          const es=effSpeed(ln.sp,tt),cons=ins.map(k=>({item:k,perHr:(S.prodCost[it][k][L]/tt)*es*3600}));
          const cfg=MINED_CRAFTS[it];
          if(cfg){if(!items.includes(cfg.resource))return;const c=minedCost(it,L)[cfg.resource];if(c==null||isNaN(c)||c<0)return;cons.push({item:cfg.resource,perHr:(c/tt)*es*3600});}
          vars.push({li,item:it,lvl:L,rate:(L/tt)*es*ln.dp*3600,cons});}
      });
    });
  });
  const D0=Math.max(1,...targets.map(it=>net[it]||0));   // normalize demand to keep LP coeffs sane
  // Free (unconstrained) solve — the makespan-optimal assignment, ignoring what ran last time.
  const free=buildScheduleLP(vars,lns,items,net,avail,D0);
  const zCol=free.zCol,n=free.n;
  let y=lpMaximize(free.c,free.A,free.b).x||new Float64Array(n);
  const zFree=y[zCol]||0;
  // Tier-2 hysteresis (issue #87 item 5): keep last solve's per-line jobs unless the free solve beats
  // a pinned re-solve by more than HYST_FRAC of throughput. Only real phase solves opt in
  // (opts.stabilize); the ordering/cost passes stay free so project sequencing reflects true makespans.
  let stabilized=false, stabKey=null, zPin=null;   // zPin: pinned-solve throughput (diagnostic / band test)
  if(opts&&opts.stabilize){
    // Key by phase + physical-line set + demanded-item set (sorted, so it's invariant to speed-driven
    // line reordering). Structural changes — add/remove a line, change a cap or which items are
    // demanded — bust the key and re-solve freely; speed/quantity/price edits keep it and stay stable.
    stabKey=(opts.phaseKey||"")+"||L:"+lns.slice().sort((a,b)=>a.orig-b.orig).map(l=>l.orig+":"+l.max).join(",")+"||I:"+items.slice().sort().join(",");
    const prior=_lineStability[stabKey];
    if(prior&&zFree>1e-15){
      // Restrict each physical line to the (item@lvl) jobs it ran last time (by orig, so speed-driven
      // sort reordering doesn't matter); a line with no prior record stays unpinned. Solve the reduced
      // LP and adopt it only if throughput holds within the band — otherwise the change was worth it.
      const allow=vars.map(v=>{const ps=prior[lns[v.li].orig];return ps?ps.indexOf(v.item+"@"+v.lvl)>=0:true;});
      if(allow.some(a=>!a)){
        const idxMap=[],rvars=[];
        vars.forEach((v,j)=>{if(allow[j]){idxMap.push(j);rvars.push(v);}});
        if(rvars.length){
          const pin=buildScheduleLP(rvars,lns,items,net,avail,D0);
          const y2=lpMaximize(pin.c,pin.A,pin.b).x;
          const z2=y2?(y2[pin.zCol]||0):0;
          zPin=z2/D0;
          if(y2&&z2>1e-15&&z2>=zFree*(1-HYST_FRAC)){
            const yFull=new Float64Array(n);
            for(let k=0;k<rvars.length;k++)yFull[idxMap[k]]=y2[k]||0;
            yFull[zCol]=z2;y=yFull;stabilized=true;
          }
        }
      }
    }
  }
  const rate={};items.forEach(it=>rate[it]=forgieHr(it));
  vars.forEach((v,vi)=>{const yi=y[vi]||0;if(yi<=LP_ASSIGN_EPS)return;rate[v.item]+=v.rate*yi;v.cons.forEach(c=>{rate[c.item]=(rate[c.item]||0)-c.perHr*yi;});});
  const plan=lns.map(ln=>({line:ln.orig+1,max:ln.max,sp:ln.sp,dp:ln.dp,entries:[]}));
  vars.forEach((v,vi)=>{const yi=y[vi]||0;if(yi<=LP_ASSIGN_EPS)return;plan[v.li].entries.push({item:v.item,lvl:v.lvl,frac:yi,outHr:v.rate*yi,cons:v.cons.map(c=>({item:c.item,hr:c.perHr*yi}))});});
  plan.forEach(p=>p.entries.sort((a,b)=>b.frac-a.frac));
  plan.sort((a,b)=>a.line-b.line);
  if(stabKey){   // remember this solve's per-line jobs (keyed by physical orig = plan.line-1) for next time
    const rec={};plan.forEach(p=>{const jobs=[];p.entries.forEach(e=>{const k=e.item+"@"+e.lvl;if(jobs.indexOf(k)<0)jobs.push(k);});rec[p.line-1]=jobs;});
    _lineStability[stabKey]=rec;
    const keys=Object.keys(_lineStability);if(keys.length>256)delete _lineStability[keys[0]];
  }
  return {rate,plan,items,z:(y[zCol]||0)/D0,stabilized,zFree:zFree/D0,zPin};
}
// Solve one batch of demand (a single project, or all of them combined) into a pipelined phase.
// `avail` (optional) is the stock the LP may draw down in place of producing an item (issue #73).
// `stabilize` opts this phase into the Tier-2 line-stability pass (issue #87 item 5) — set for the
// real phase solves whose plan the user sees, left off for the ordering/cost-estimation passes.
// `phaseKey` is the cache discriminator: a STABLE unique id (project id / member-id set), NOT the
// display name, so two projects sharing a name don't collide on one cache slot. Falls back to name.
function solvePhaseFor(net,name,avail,stabilize,phaseKey){
  const demandItems=ALLITEMS.filter(it=>net[it]>1e-9);
  const blockedMined={};
  demandItems.forEach(it=>{const blockers=chainMinedBlockers(it);if(blockers.length)blockedMined[it]=blockers;});
  const unsat=Object.keys(blockedMined);   // legacy item-level blocker list
  const targets=demandItems.filter(it=>!blockedMined[it]);
  if(targets.length===0)
    return {name,plan:[],balance:[],minedUsage:[],demandItems,net,rate:{},eta:0,bottleneck:null,infeasItems:[],unsat,blockedMined,atRisk:[],items:[],z:0,partial:false,feasible:false};
  const sch=projectSchedule(net,targets,avail,stabilize?{stabilize:true,phaseKey:(phaseKey!=null?phaseKey:name)}:null);
  const rate={};targets.forEach(it=>rate[it]=Math.max(0,sch.rate[it]||0));
  let eta=0,bottleneck=null;const infeasItems=[];
  targets.forEach(it=>{if(rate[it]<=1e-9)infeasItems.push(it);else{const t=net[it]/rate[it];if(t>eta){eta=t;bottleneck=it;}}});
  const hasThroughput=sch.z>1e-15;
  const feasible=unsat.length===0&&infeasItems.length===0&&hasThroughput;
  const prodHr={},consHr={};sch.items.forEach(it=>{prodHr[it]=0;consHr[it]=0;});
  sch.plan.forEach(p=>p.entries.forEach(e=>{prodHr[e.item]=(prodHr[e.item]||0)+e.outHr;e.cons.forEach(c=>{consHr[c.item]=(consHr[c.item]||0)+c.hr;});}));
  const minedUsage=minedUsageFromProjectPlan(sch.plan);
  // Mined budgets are not craftable materials; their usage is displayed separately.
  // `stock` is the /hr an item is pulled from inventory (the deficit the LP left the drawdown term to cover);
  // in a project LP a shortfall is only ever legitimate stock drawdown, never a paper margin.
  const balance=sch.items.filter(it=>!MINED_RESOURCES.includes(it)).map(it=>{const prod=prodHr[it]||0,cons=consHr[it]||0,f=forgieHr(it);
    return {res:it,prod,forgie:f,cons,stock:Math.max(0,cons-prod-f)};});
  // Flag items the plan is pressed up against the safety cap on — drawing stock down with ZERO
  // crafters assigned to replenish it, close enough to the STOCK_SAFETY_FRAC ceiling that the LP
  // would draw down MORE if it were allowed to (issue #80: "no Crafters set to Ingots, yet the plan
  // needs them"). A comfortably ample stock (issue #73's case) draws far less than its cap and
  // isn't flagged — only a plan that's genuinely running an item at its structural limit is.
  const atRisk=balance.filter(b=>{
    const av=(avail&&avail[b.res])||0;
    if(av<=1e-6||b.prod>1e-6)return false;
    const used=b.stock*eta;   // total units of this item's stock the phase draws down
    return used>=STOCK_SAFETY_FRAC*av*0.98;
  }).map(b=>b.res);
  return {name,plan:sch.plan,balance,minedUsage,demandItems,net,rate,eta,bottleneck,infeasItems,unsat,blockedMined,atRisk,items:sch.items,z:sch.z,partial:!feasible&&hasThroughput,feasible,stabilized:!!sch.stabilized,zFree:sch.zFree,zPin:sch.zPin};
}
// net demand for a project's level-sum `sub`, against an inventory map (folds in Frame bits).
function projNetVec(sub,invMap){
  const net={};ALLITEMS.forEach(it=>net[it]=Math.max(0,(sub[it]||0)-(invMap[it]||0)));
  const ppBits=PREPROD_BITS.Frames*(net.Frames||0)+PREPROD_BITS.Wire*(net.Wire||0);
  if(ppBits>0)net.Bits=Math.max(0,(sub.Bits||0)+ppBits-(invMap.Bits||0));
  return net;
}
// Stock available to DRAW DOWN for each item — the inventory left after covering the item's own
// direct project demand (projNetVec already nets that). For a raw/intermediate that's never a direct
// cost (e.g. Ingots) this is its whole stock; that stock feeds its consumers so they aren't produced
// from scratch (issue #73). Complements projNetVec: net covers "make less of what I hold", this covers
// "don't make an input I already have". Symmetric Bits fold-in so pre-produced Frame/Wire Bits count.
function projAvailVec(sub,invMap){
  const net=projNetVec(sub,invMap);
  const av={};ALLITEMS.forEach(it=>av[it]=Math.max(0,((invMap&&invMap[it])||0)-(sub[it]||0)));
  const ppBits=PREPROD_BITS.Frames*(net.Frames||0)+PREPROD_BITS.Wire*(net.Wire||0);
  av.Bits=Math.max(0,((invMap&&invMap.Bits)||0)-((sub.Bits||0)+ppBits));
  return av;
}
// Assign each project an "unlock layer": 0 if it depends on no in-list unlock, else
// 1 + the deepest unlock it depends on. Edges (prerequisite → dependent) come from material
// unlocks (a project unlocking material M precedes anything whose costs include M) and from
// explicit PROJECT_PREREQS building unlocks — both only when the prerequisite project is in
// the list. Every edge runs to a strictly higher layer, so ordering by layer is a valid
// topological order (Frame Factory → Gel Refinery → Wire Tower → their consumers).
function unlockLayers(perProject){
  const n=perProject.length;
  const unlockerOf={};   // material -> index of the in-list project that unlocks it
  const idxOfCat={};     // catId -> index
  perProject.forEach((p,i)=>{const m=UNLOCKS[p.catId];if(m)unlockerOf[m]=i;if(p.catId)idxOfCat[p.catId]=i;});
  const preds=perProject.map((p,i)=>{
    const set={};
    UNLOCK_MATERIALS.forEach(m=>{const u=unlockerOf[m];if(u!=null&&u!==i&&(p.sub[m]||0)>0)set[u]=1;});
    (PROJECT_PREREQS[p.catId]||[]).forEach(cat=>{const u=idxOfCat[cat];if(u!=null&&u!==i)set[u]=1;});
    return Object.keys(set).map(Number);
  });
  const layer=new Array(n).fill(-1);
  const calc=(i,stack)=>{
    if(layer[i]>=0)return layer[i];
    if(stack[i])return 0;            // defensive cycle guard
    stack[i]=1;let L=0;
    preds[i].forEach(u=>{const d=calc(u,stack)+1;if(d>L)L=d;});
    stack[i]=0;return layer[i]=L;
  };
  for(let i=0;i<n;i++)calc(i,{});
  return layer;
}
// Carry inventory to the next phase: subtract this phase's direct demand AND the stock it drew down
// on intermediates (ph.balance.stock × makespan), so a later phase can't spend the same units twice.
function consumeInv(invRun,sub,ph){
  const eta=isFinite(ph.eta)?(ph.eta||0):0;
  const draw={};(ph.balance||[]).forEach(b=>{draw[b.res]=(b.stock||0)*eta;});
  ALLITEMS.forEach(it=>{invRun[it]=Math.max(0,(invRun[it]||0)-(sub[it]||0)-(draw[it]||0));});
}
function buildProjectPhases(seq,net,perProject){
  const layer=unlockLayers(perProject);
  const maxL=perProject.length?Math.max.apply(null,layer):0;
  const invStart=()=>{const o={};ALLITEMS.forEach(it=>o[it]=num(S.inventory&&S.inventory[it])||0);return o;};
  if(!seq){
    // Single combined phase when nothing is gated, or when the user has turned unlock gating
    // off (projectGate===false) to craft the whole list at once, ignoring unlock waves.
    if(maxL===0||S.projectGate===false){
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=perProject.reduce((s,p)=>s+(p.sub[it]||0),0));
      const inv0=invStart();
      const combKey=perProject.length>1?perProject.map(p=>p.id).sort().join("+"):perProject[0].id;
      const ph=solvePhaseFor(net,perProject.length>1?"All projects":perProject[0].name,projAvailVec(sumSub,inv0),true,combKey);
      ph.demandSub=sumSub;ph.invStart=inv0;   // stock on hand when this phase begins (issue #87 on-hand projection)
      ph.doneAt=ph.eta;return [ph];
    }
    // unlocks force ordered "waves": combine within a layer, sequence the layers, carrying
    // crafted surplus forward as inventory so later waves only make what's still missing.
    const invRun=invStart();let cum=0;const phases=[];
    for(let L=0;L<=maxL;L++){
      const members=perProject.filter((_,i)=>layer[i]===L);
      if(!members.length)continue;
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=members.reduce((s,p)=>s+(p.sub[it]||0),0));
      const inv0=Object.assign({},invRun);   // snapshot before consumeInv draws it down for the next wave
      const ph=solvePhaseFor(projNetVec(sumSub,invRun),members.map(m=>m.name).join(" + "),projAvailVec(sumSub,invRun),true,members.map(m=>m.id).sort().join("+"));
      ph.members=members.map(m=>m.name);ph.demandSub=sumSub;ph.wave=phases.length+1;ph.invStart=inv0;
      consumeInv(invRun,sumSub,ph);
      cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
    }
    return phases;
  }
  // sequenced: one project per phase, ordered by (unlock layer, manual priority, cheapest makespan)
  const invInit=invStart();
  const cost=perProject.map(p=>{const ph=solvePhaseFor(projNetVec(p.sub,invInit),p.name,projAvailVec(p.sub,invInit));return ph.feasible?ph.eta:Infinity;});
  const order=perProject.map((p,i)=>({p,i})).sort((a,b)=>{
    if(layer[a.i]!==layer[b.i])return layer[a.i]-layer[b.i];   // unlock precedence (hard)
    const pa=a.p.prio,pb=b.p.prio;
    if(pa!=null&&pb!=null){if(pa!==pb)return pa-pb;}            // manual order, lower first
    else if(pa!=null)return -1;
    else if(pb!=null)return 1;
    return cost[a.i]-cost[b.i];                                // else cheapest makespan
  });
  const invRun=invStart();let cum=0;const phases=[];
  order.forEach(({p})=>{
    const inv0=Object.assign({},invRun);   // snapshot before consumeInv draws it down for the next phase
    const ph=solvePhaseFor(projNetVec(p.sub,invRun),p.name,projAvailVec(p.sub,invRun),true,p.id);
    ph.prio=(p.prio!=null?p.prio:null);ph.demandSub=p.sub;ph.invStart=inv0;
    consumeInv(invRun,p.sub,ph);
    cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
  });
  return phases;
}
// Display summary of the Gel a phase's LP chose to forge (which lines, total Gel/hr and vespium
// burn), derived from the solution — Gel is a normal LP output now, not a reserved subset.
function gelReservedFromPlan(plan){
  const perLine=[];let outHr=0,vespHr=0;
  (plan||[]).forEach(p=>(p.entries||[]).forEach(e=>{if(e.item!==GEL)return;
    const ct=craftTime(GEL,e.lvl),v=ct>0?(gelOreCost(e.lvl).vesp/ct)*effSpeed(p.sp,ct)*(e.frac||0)*3600:0;
    outHr+=e.outHr||0;vespHr+=v;
    perLine.push({__i:p.line-1,max:p.max,L:e.lvl,gelHr:e.outHr||0,vespHr:v,frac:e.frac});}));
  return perLine.length?{lines:perLine.length,outHr,vespHr,perLine}:null;
}
function minedUsageFromProjectPlan(plan){
  const by={};
  (plan||[]).forEach(p=>(p.entries||[]).forEach(e=>{const cfg=MINED_CRAFTS[e.item];if(!cfg)return;
    const ct=craftTime(e.item,e.lvl),craftsHr=ct>0?(effSpeed(p.sp,ct)/ct)*(e.frac||0)*3600:0;
    Object.entries(minedCost(e.item,e.lvl)).forEach(([resource,cost])=>{
      const inputHr=cost*craftsHr,key=e.item+"\u0000"+resource;
      if(!by[key])by[key]={item:e.item,resource,lines:0,outHr:0,inputHr:0,perLine:[],_lines:{}};
      const use=by[key];if(!use._lines[p.line]){use._lines[p.line]=1;use.lines++;}
      use.outHr+=e.outHr||0;use.inputHr+=inputHr;
      use.perLine.push({line:p.line,lvl:e.lvl,outHr:e.outHr||0,inputHr,frac:e.frac||0});
    });
  }));
  return Object.values(by).map(use=>{delete use._lines;return use;});
}
// Top of project mode: builds one combined phase, or a sequence of per-project phases
// (forced-"do first" projects ahead, then cheapest-makespan first), with inventory carried across.
function optimizeProjectTop(){
  const {gross,net,perProject}=projectDemand();
  const t0=performance.now();
  if(perProject.length===0)return {empty:true,mode:"project",plan:[],phases:[],gross,net,perProject};
  const seq=S.projectSeq!==false&&perProject.length>1;
  // Gel is forged natively by each phase's LP (vespium budget = a constrained resource), so there's
  // no line-reservation sweep — solve the phases directly.
  const phases=buildProjectPhases(seq,net,perProject);
  const waved=!seq&&phases.length>1;   // all-at-once split into unlock-ordered waves
  const single=!seq&&S.projectGate===false&&perProject.length>1;   // gating off — one combined phase
  const eta=phases.reduce((s,ph)=>s+ph.eta,0);
  const feasible=phases.length>0&&phases.every(ph=>ph.feasible);
  const unsat=[...new Set([].concat(...phases.map(ph=>ph.unsat||[])))];
  const blockedMined={};phases.forEach(ph=>Object.entries(ph.blockedMined||{}).forEach(([it,resources])=>{
    blockedMined[it]=[...new Set([...(blockedMined[it]||[]),...resources])];
  }));
  const partial=!feasible&&phases.some(ph=>ph.z>1e-15);
  const infeasItems=[...new Set([].concat(...phases.map(ph=>ph.infeasItems||[])))];
  const atRiskItems=[...new Set([].concat(...phases.map(ph=>ph.atRisk||[])))];
  const main=phases[0]||{plan:[],balance:[],rate:{},demandItems:[],bottleneck:null};
  return {empty:false,mode:"project",sequenced:seq,waved,single,phases,perProject,gross,net,
    plan:main.plan,balance:main.balance,
    demandItems:(seq||waved)?ALLITEMS.filter(it=>net[it]>1e-9):main.demandItems,
    rate:main.rate,bottleneck:main.bottleneck,eta,unsat,blockedMined,infeasItems,atRiskItems,partial,feasible,
    minedUsage:main.minedUsage||[],
    gelReserved:gelReservedFromPlan(main.plan),
    objective:feasible&&eta>0?1/eta:0,ms:performance.now()-t0};
}


function optimize(){
  if(S.mode==="project")return optimizeProjectTop();
  // Gel is a native resource inside solveCore now (vespium is its budgeted input), so items and
  // credits need no reservation sweep — the solver allocates Gel lines like any other product.
  return optimizeInner();
}

;
"use strict";
/* Web Worker: runs the optimizer off the main thread so a long solve (the user's max-solve-time
 * budget) never freezes the UI. Loads the same core + solver source the page uses; the page posts
 * a snapshot of the state and gets back the plain result object optimize() produces.
 *
 * The Worker imports the same field/schema boundary as the page; no unvalidated snapshot can
 * become the solver's global state. */


self.onmessage = function (e) {
  const { reqId, generation, mode, stateRevision, state, budget, stab } = e.data || {};
  try {
    if(!Number.isInteger(reqId)||reqId<0)throw new Error("Worker request id is invalid");
    if(generation!==reqId)throw new Error("Worker generation is invalid");
    if(!Number.isInteger(stateRevision)||stateRevision<0)throw new Error("Worker state revision is invalid");
    const checked=validateWorkerState(state);
    if(!checked.ok)throw new Error("Worker state rejected: "+checked.errors.join("; "));
    if(mode!==checked.state.mode)throw new Error("Worker mode does not match the validated state");
    if(budget!==undefined&&budget!==checked.state.solveBudget)throw new Error("Worker budget does not match the validated state");
    if(stab!==null&&stab!==undefined){
      const stabilityErrors=[];
      if(!_plainObject(stab))stabilityErrors.push("stability cache must be a plain object");
      else _scanStructure(stab,stabilityErrors);
      if(stabilityErrors.length)throw new Error("Worker stability cache rejected: "+stabilityErrors.join("; "));
    }
    commitState(checked.state);       // rebind the lexical S the solver closes over
    // Seed a reused Worker's line-stability cache from the main thread's latest copy, then return
    // the updated cache so the next solve can pin to it (issue #87).
    if (typeof setLineStability === "function") setLineStability(stab || {});
    const res = optimize();
    if (res && typeof getLineStability === "function") res.__stab = getLineStability();
    self.postMessage({ reqId, generation, mode, stateRevision, res });
  } catch (err) {
    self.postMessage({ reqId, generation, mode, stateRevision, error: (err && err.stack) || String(err) });
  }
};
