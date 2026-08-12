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
  Batteries:{inputs:["Wire","Gel"],baseOutput:5}
};
const MINED_CRAFTS={
  Gel:{resource:"Vespium",baseCosts:{Vespium:5e14},informationalCosts:{Rocks:1e23}},
  Batteries:{resource:"Hydracite",baseCosts:{Hydracite:5e12},informationalCosts:{}}
};
const MINED_RESOURCES=["Vespium","Hydracite"];
const MINED_INCOME_SOURCES=Object.freeze({
  Vespium:Object.freeze({
    rigPerMin:Object.freeze({perHourMultiplier:60}),
    resourcesTradingPerSec:Object.freeze({perHourMultiplier:3600})
  }),
  Hydracite:Object.freeze({
    resourcesTradingPerSec:Object.freeze({perHourMultiplier:3600})
  })
});
function compressionLabel(L){return Number(L)===16384?"16.38k×":String(L)+"×";}
// The in-game upgrade level behind a multiplier: level 0 is 1× and each level doubles it,
// so the top tier (16384×) is level 14.
function compressionLevel(L){return Math.round(Math.log2(Number(L)||1));}
function craftYield(item,L){return (RECIPE[item]&&RECIPE[item].baseOutput||1)*L;}
/* Floats, like gelOreCost and for the same reason: MINED_CRAFTS holds hardcoded game constants
   scaled by compression, topping out at 4.8e29 Rocks at 16384x, and nothing a player types reaches
   them. Keeping them float keeps this arithmetic bit-for-bit what it was — a Decimal normalises its
   mantissa, which moved the 16384x Hydracite cost by one ULP. */
function minedCost(item,L){
  const cfg=MINED_CRAFTS[item],out={};if(!cfg)return out;
  const mult=Math.pow(3,Math.log2(L));
  Object.entries({...cfg.informationalCosts,...cfg.baseCosts}).forEach(([r,v])=>out[r]=v*mult);
  return out;
}
function isMinedResource(r){return MINED_RESOURCES.includes(r);}
/* Catalog levels are authored as plain numbers, and every quantity that reaches S has to be a
   Decimal. This is that conversion, and it is shared with normalize()'s catalog rehydration so the
   two cannot disagree: a raw number left in S would change the solve-equivalence key the moment
   persistence validated the state into Decimals, discarding an in-flight solve for nothing. */
function catalogLevelsToState(levels){
  return JSON.parse(JSON.stringify(levels||[])).map(level=>Object.assign({},level,{
    costs:(level.costs||[]).map(cost=>Object.assign({},cost,{qty:toDec(cost.qty)}))
  }));
}
// Free supply of a mined resource, per hour. A Decimal: a late-game Vespium rig income is already
// around 1e99/min, and it is the single largest number the solver has to carry.
function minedBudgetHr(resource,state=S){
  const sources=MINED_INCOME_SOURCES[resource];if(!sources)return DEC_ZERO;
  const income=state&&state.minedIncome&&state.minedIncome[resource];if(!income||typeof income!=="object")return DEC_ZERO;
  return Object.entries(sources).reduce((total,[source,descriptor])=>{
    const value=toDec(income[source]);
    return value!==null&&value.gt(DEC_ZERO)?total.add(decScale(value,descriptor.perHourMultiplier)):total;
  },DEC_ZERO);
}
function setMinedIncome(resource,source,text){
  if(!MINED_INCOME_SOURCES[resource]||!MINED_INCOME_SOURCES[resource][source])return;
  if(!S.minedIncome||typeof S.minedIncome!=="object"||Array.isArray(S.minedIncome))S.minedIncome={};
  if(!S.minedIncomeText||typeof S.minedIncomeText!=="object"||Array.isArray(S.minedIncomeText))S.minedIncomeText={};
  if(!S.minedIncome[resource]||typeof S.minedIncome[resource]!=="object"||Array.isArray(S.minedIncome[resource]))S.minedIncome[resource]={};
  if(!S.minedIncomeText[resource]||typeof S.minedIncomeText[resource]!=="object"||Array.isArray(S.minedIncomeText[resource]))S.minedIncomeText[resource]={};
  S.minedIncomeText[resource][source]=String(text==null?"":text);
  const value=parseGameNum(text);S.minedIncome[resource][source]=value!==null&&value.gte(DEC_ZERO)?value:null;
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
const UNLOCKS={"frame-factory":"Frames","gel-refinery":"Gel","wire-tower":"Wire",
  "the-concrete-corner":"Reinforced Concrete","battery-factory":"Batteries"};
const UNLOCK_MATERIALS=Object.keys(UNLOCKS).map(k=>UNLOCKS[k]);   // ["Frames","Gel","Wire","Reinforced Concrete","Batteries"]
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
  const c=(coef)=>{const o={};LEVELS.forEach(L=>{o[L]=new Decimal(coef).times(Math.pow(3,Math.log2(L)));});return o;};
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
  const tg={};PRODUCTS.forEach(p=>tg[p]={on:p==="Frames",w:1,share:50});RAWS.forEach(r=>tg[r]={on:false,w:1,share:50});
  return {
    lines:[
      {max:512,spx:49.38,turbo:0},
      {max:512,spx:45.02,turbo:0},
      {max:128,spx:43.85,turbo:0},
      {max:64,spx:45.20,turbo:0},
      {max:32,spx:42.87,turbo:0}
    ],
    maxTurbo:0,dupe:12.40,
    prodCost,baseTime,margin:0,mode:"items",solveBudget:10000,
    sellPrice:nulls(),priceText:{},
    forgie:nulls(),forgieText:{},
    minedIncome:{
      Vespium:{rigPerMin:null,resourcesTradingPerSec:null},
      Hydracite:{resourcesTradingPerSec:null}
    },
    minedIncomeText:{
      Vespium:{rigPerMin:"",resourcesTradingPerSec:""},
      Hydracite:{resourcesTradingPerSec:""}
    },
    targets:tg,targetMode:"ratio",targetSaved:[],targetActiveId:null,
    projects:[],inventory:nulls(),inventoryText:{},projectSeq:true,projectGate:true,projectStability:"prefer-current",projLineMode:"split",
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

// Saved output sets: the checked outputs are the question a Max items/hr solve answers, and
// people ask several different ones of the same factory. A set records only the checked items
// and their priorities, so applying one clears every checkbox first — an item the set does not
// name is off, whatever it was before.
const TARGET_SHARE_DEFAULT=50;
function targetPresetConfig(st){
  return ALLITEMS.filter(it=>st.targets[it]&&st.targets[it].on)
    .map(it=>({item:it,w:st.targets[it].w,share:targetShareOf(st.targets[it])}));
}
// A set records both numbers and the mode it was saved in, because the same figure means different
// things in each: w is a demanded ratio in raw item units, share is a percentage of that item's own
// ceiling. Restoring a set without its mode would silently read one as the other, so a set saved as
// "Gel at 30% of its max" would come back as "3 Gel per 1 of everything else".
function applyTargetPresetConfig(st,config,mode){
  ALLITEMS.forEach(it=>{if(st.targets[it])st.targets[it].on=false;});
  (config||[]).forEach(c=>{
    if(st.targets[c.item])st.targets[c.item]={on:true,w:c.w,share:targetShareOf(c)};
  });
  if(mode==="ratio"||mode==="share")st.targetMode=mode;
}
// Share is additive: sets and saves written before it existed carry no percentage, and default
// rather than being rejected.
function targetShareOf(source){
  const value=Math.floor(Number(source&&source.share));
  return Number.isFinite(value)?Math.max(5,Math.min(100,value)):TARGET_SHARE_DEFAULT;
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
  const _budgetRule=typeof FIELD_SCHEMA!=="undefined"?FIELD_SCHEMA.solveBudget:{min:200,max:60000,defaultValue:10000};
  const _budgetValue=Number(st.solveBudget);
  if(!Number.isInteger(_budgetValue)||_budgetValue<_budgetRule.min||_budgetValue>_budgetRule.max)st.solveBudget=_budgetRule.defaultValue;
  else st.solveBudget=_budgetValue;
  if(!st.baseTime)st.baseTime={};
  const _DB=defaults().baseTime,_PB={Ingots:9.63,Bits:9.63,Concrete:9.63,Glass:87.3,Bricks:114.3,Plates:29.23,Rods:44.46,Frames:311.38};
  const _migrate=!st.baseTimeRev||st.baseTimeRev<2;
  [...RAWS,...PRODUCTS].forEach(it=>{const v=st.baseTime[it];if(v==null||isNaN(v)||v<=0)st.baseTime[it]=_DB[it];else if(_migrate&&(Math.abs(v-(_PB[it]||-1))<1e-4||Math.abs(v-12.85)<1e-4))st.baseTime[it]=_DB[it];});
  st.baseTimeRev=2;
  const _DP=defaults().prodCost;
  if(!st.prodCost)st.prodCost={};
  PRODUCTS.forEach(P=>{if(!st.prodCost[P])st.prodCost[P]={};RECIPE[P].inputs.forEach(k=>{if(!st.prodCost[P][k]||Object.keys(st.prodCost[P][k]).length===0)st.prodCost[P][k]=_DP[P][k];else LEVELS.forEach(L=>{
    // A MISSING level takes the default; a level that is present and blank stays blank. Clearing a
    // recipe cost is how a player says "I have not entered this", and the solver reports it as such.
    if(!(L in st.prodCost[P][k]))st.prodCost[P][k][L]=_DP[P][k][L];
    else st.prodCost[P][k][L]=toDec(st.prodCost[P][k][L]);
  });});});
  /* Quantity revival. normalize() runs on every load and on the Worker's state commit, so this is
     the one place a persisted string / legacy float becomes the Decimal the rest of the app holds.
     A value that will not parse becomes null ("not entered"), never a silent zero. */
  if(!st.sellPrice)st.sellPrice={};
  [...RAWS,...PRODUCTS].forEach(it=>{st.sellPrice[it]=toDec(st.sellPrice[it]);});
  if(!st.priceText)st.priceText={};
  if(!st.forgie)st.forgie={};
  [...RAWS,...PRODUCTS].forEach(it=>{st.forgie[it]=toDec(st.forgie[it]);});
  if(!st.forgieText)st.forgieText={};
  if(!st.targets)st.targets={};
  PRODUCTS.forEach(p=>{if(!st.targets[p])st.targets[p]={on:false,w:1};});
  RAWS.forEach(r=>{if(!st.targets[r])st.targets[r]={on:false,w:1};});
  ALLITEMS.forEach(it=>{st.targets[it].share=targetShareOf(st.targets[it]);});
  if(st.targetMode!=="ratio"&&st.targetMode!=="share")st.targetMode="ratio";
  // Saved output sets record only the checked items and their priorities, so loading one is
  // "clear every checkbox, then apply these" — an item missing from a set is simply off.
  if(!Array.isArray(st.targetSaved))st.targetSaved=[];
  const _wRule=typeof FIELD_SCHEMA!=="undefined"?FIELD_SCHEMA.targetWeight:{min:1,max:9,defaultValue:1};
  st.targetSaved=st.targetSaved.filter(p=>p&&typeof p==="object"&&Array.isArray(p.config)).map(p=>{
    const seen=new Set();
    return {
      id:typeof p.id==="string"?p.id:newId(),
      name:typeof p.name==="string"?p.name:"Outputs",
      mode:p.mode==="share"?"share":"ratio",
      config:p.config.filter(c=>{
        if(!c||!ALLITEMS.includes(c.item)||seen.has(c.item))return false;
        seen.add(c.item);return true;
      }).map(c=>{
        const w=Math.floor(Number(c.w));
        return {item:c.item,
          w:Number.isFinite(w)?Math.max(_wRule.min,Math.min(_wRule.max,w)):_wRule.defaultValue,
          share:targetShareOf(c)};
      })
    };
  });
  if(typeof st.targetActiveId!=="string")st.targetActiveId=null;
  if(!st.minedIncome||typeof st.minedIncome!=="object"||Array.isArray(st.minedIncome))st.minedIncome={};
  if(!st.minedIncomeText||typeof st.minedIncomeText!=="object"||Array.isArray(st.minedIncomeText))st.minedIncomeText={};
  const legacyVesp=Object.prototype.hasOwnProperty.call(st.minedIncome,"Vespium")?st.minedIncome.Vespium:st.gelVesp;
  const legacyVespText=Object.prototype.hasOwnProperty.call(st.minedIncomeText,"Vespium")?st.minedIncomeText.Vespium:st.gelVespText;
  MINED_RESOURCES.forEach(resource=>{
    const sources=MINED_INCOME_SOURCES[resource],rawResource=st.minedIncome[resource],textResource=st.minedIncomeText[resource];
    const rawMap=rawResource&&typeof rawResource==="object"&&!Array.isArray(rawResource)?rawResource:{};
    const textMap=textResource&&typeof textResource==="object"&&!Array.isArray(textResource)?textResource:{};
    const legacyRaw=resource==="Vespium"?legacyVesp:rawResource;
    const legacyText=resource==="Vespium"?legacyVespText:textResource;
    const legacySource=resource==="Vespium"?"rigPerMin":"resourcesTradingPerSec";
    const normalized={},normalizedText={};
    Object.keys(sources).forEach(source=>{
      let raw=Object.prototype.hasOwnProperty.call(rawMap,source)?rawMap[source]:undefined;
      if(raw===undefined&&source===legacySource&&(!rawResource||typeof rawResource!=="object")){
        const legacy=toDec(legacyRaw);
        raw=resource==="Hydracite"&&legacy!==null?legacy.div(60):legacyRaw;
      }
      const value=toDec(raw);
      normalized[source]=value!==null&&value.gte(DEC_ZERO)?value:null;
      let text=Object.prototype.hasOwnProperty.call(textMap,source)?textMap[source]:undefined;
      if(text===undefined&&source===legacySource&&resource==="Vespium"&&typeof legacyText==="string")text=legacyText;
      normalizedText[source]=typeof text==="string"?text:(normalized[source]!==null?normalized[source].toString():"");
    });
    st.minedIncome[resource]=normalized;st.minedIncomeText[resource]=normalizedText;
  });
  delete st.gelVesp;delete st.gelVespText;
  delete st.gelLines;delete st.gelComp;
  if(st.mode!=="credits"&&st.mode!=="items"&&st.mode!=="project"&&st.mode!=="manual")st.mode="items";
  if(!Array.isArray(st.projects))st.projects=[];
  st.projects.forEach(p=>{if(!p.id)p.id="p"+Math.random().toString(36).slice(2,9);if(typeof p.name!=="string")p.name="Project";p.on=p.on!==false;if(p.prio!=null){const _pr=Math.floor(Number(p.prio));p.prio=_pr>=1?_pr:null;}else p.prio=p.first?1:null;delete p.first;if(p.catId&&typeof PROJECT_CATALOG!=="undefined"&&Array.isArray(PROJECT_CATALOG)){const _src=PROJECT_CATALOG.find(c=>c.catId===p.catId);if(_src){p.levels=catalogLevelsToState(_src.levels);p.name=_src.name;p.description=_src.description||"";}}if(!Array.isArray(p.levels)||p.levels.length===0)p.levels=[{costs:[]}];p.levels.forEach(L=>{if(!Array.isArray(L.costs))L.costs=[];L.costs.forEach(c=>{if(!RAWS.includes(c.item)&&!PRODUCTS.includes(c.item))c.item=PRODUCTS[0];const _q=toDec(c.qty);c.qty=_q!==null&&_q.gte(DEC_ZERO)?_q:null;});});p.from=Math.max(1,Math.min(p.levels.length,Math.floor(Number(p.from)||1)));p.to=Math.max(p.from,Math.min(p.levels.length,Math.floor(Number(p.to)||p.levels.length)));p.done=Math.max(0,Math.min(p.to-p.from+1,Math.floor(Number(p.done)||0)));});
  if(!st.inventory)st.inventory={};
  ALLITEMS.forEach(it=>{st.inventory[it]=toDec(st.inventory[it]);});
  if(!st.inventoryText)st.inventoryText={};
  if(typeof st.projectSeq!=="boolean")st.projectSeq=true;
  if(typeof st.projectGate!=="boolean")st.projectGate=true;
  if(st.projectStability!=="reoptimize"&&st.projectStability!=="prefer-current")st.projectStability="prefer-current";
  if(st.projLineMode!=="static")st.projLineMode="split";
  if(!Array.isArray(st.manualSaved))st.manualSaved=[];
  st.manualSaved=st.manualSaved.filter(p=>p&&typeof p==="object"&&Array.isArray(p.config)).map(p=>({id:typeof p.id==="string"?p.id:("m"+Math.random().toString(36).slice(2,9)),name:typeof p.name==="string"?p.name:"Setup",config:p.config.map(c=>({job:(c&&ALLITEMS.includes(c.job))?c.job:"Idle",lvl:(c&&LEVELS.includes(c.lvl))?c.lvl:1,sell:!!(c&&c.sell)}))}));
  if(typeof st.manualActiveId!=="string")st.manualActiveId=null;
  if(typeof st.planStart!=="number"||!isFinite(st.planStart))st.planStart=null;
  syncManual(st);
  return st;
}
let S=defaults();
let stateRevision=0;

/* num() is for CONFIGURATION only — line speed, turbo, duplication %, margin, base craft time,
 * priorities, budgets. Everything with a fixed physical ceiling that a float64 will always hold.
 *
 * It REFUSES a Decimal rather than coercing one. Decimal#valueOf returns its string form, so
 * Number(aDecimal) silently succeeds for small values and silently yields Infinity past 1.797e308 —
 * a quantity that slipped into a float path would produce a plausible wrong plan instead of an
 * error. Throwing turns every missed conversion into an immediate, located failure. Quantities go
 * through dnum() (Decimal) instead. */
const num=v=>{
  if(v===""||v===null||v===undefined)return null;
  if(v instanceof Decimal)throw new TypeError("num() received a Decimal quantity; use dnum() and keep it a Decimal");
  const n=Number(v);return isFinite(n)?n:null;
};
// The quantity counterpart of num(): Decimal or null, never a float.
const dnum=v=>toDec(v);
// ...and the one that treats "not entered" as zero, which is what most quantity readers want.
const dnum0=v=>toDec0(v);
const fmt=(n,d=0)=>n.toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:0});
function boundedPersistedField(name,value,fallback,min,max,integer=false){
  if(typeof FIELD_SCHEMA!=="undefined"&&typeof clampFieldValue==="function"&&FIELD_SCHEMA[name]){
    return clampFieldValue(FIELD_SCHEMA[name],value,fallback);
  }
  const number=Number(value);
  return Number.isFinite(number)&&(!integer||Number.isInteger(number))&&number>=min&&number<=max?number:fallback;
}

/* ---------- game number notation (k m b t qa qu sx sp o n d → exponent) ----------
   Quantities are Decimals (js/decimal.js), not floats. This is an incremental game: sell prices,
   mined incomes, Forgie rates, inventories and project costs all grow without bound, and a float64
   stops at 1.797e308. A Decimal carries the same ~17 significant digits with effectively unlimited
   exponent range, which is the trade this needs — range, not precision.

   Only quantities are Decimal. Line speed, turbo, duplication %, margin, base craft time and the
   solve budget are configuration with a fixed physical ceiling; they stay floats (see num vs dnum),
   and so does the solver's LP kernel (see lpEquilibrate in solver.js). */
const DEC_ZERO=new Decimal(0);
/* The only construction path from untrusted text. new Decimal("abc") THROWS, so every caller must
   arrive here through a regex that has already proved the string is a number. */
const DEC_SYNTAX=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/;
function decIsFinite(value){return value.isFinite()&&!value.isNaN();}
function decFromSyntax(text){
  if(!DEC_SYNTAX.test(text))return null;
  const value=new Decimal(text);
  return decIsFinite(value)?value:null;
}
/* Coerce anything the app might hold — Decimal, number, canonical string, blank — to a Decimal.
   Returns null for blank/unparseable rather than throwing, so it is safe on raw persisted state. */
function toDec(value){
  if(value===null||value===undefined||value==="")return null;
  if(value instanceof Decimal)return decIsFinite(value)?value:null;
  if(typeof value==="number")return isFinite(value)?new Decimal(value):null;
  if(typeof value==="string")return decFromSyntax(value.trim());
  return null;
}
/* Quantities cross three boundaries that would otherwise destroy them: the save file, the Worker
   message, and the daily solve cache's JSON round trip. All three are JSON, and decimal.js already
   serialises to its canonical string through toJSON — which is exactly the form toDec reads back.
   A Decimal must never be posted to a Worker unserialised: decimal.js instances carry an own
   `constructor`, so structuredClone throws on them rather than flattening them. */
const toDec0=value=>toDec(value)||DEC_ZERO;
const DEC_ONE=new Decimal(1);
// Decimal's Math.max(0, x): a quantity that has been netted below zero is "none left", not a debt.
const decClampLow=(value,floor=DEC_ZERO)=>value.lt(floor)?floor:value;
// A Decimal reduced to the float64 the search and the tableau work in, or null when it will not fit.
function decToNum(value){const flat=toDec0(value).toNumber();return Number.isFinite(flat)?flat:null;}
/* Scale a quantity by a plain factor, in float whenever the operands and the result all fit one.
 *
 * A Decimal normalises its mantissa into [1,10), and that rounds differently from a float64
 * multiply: (1e9/60) x 3600 is exactly 60000000000 in float and 59999999999.99999 through Decimal.
 * Both carry the same ~17 significant digits — neither is more accurate — but the float answer is
 * the one every existing budget, plan and pinned test was computed against, so it is the one to
 * keep wherever it is still available. Decimal takes over precisely where float64 runs out. */
function decScale(value,factor){
  const flat=value.toNumber();
  if(Number.isFinite(flat)){const scaled=flat*factor;if(Number.isFinite(scaled))return new Decimal(scaled);}
  return value.times(factor);
}
function decUnscale(value,divisor){
  const flat=value.toNumber();
  if(Number.isFinite(flat)){const scaled=flat/divisor;if(Number.isFinite(scaled))return new Decimal(scaled);}
  return value.div(divisor);
}
const SUFFIX={k:1e3,m:1e6,b:1e9,t:1e12,qa:1e15,qu:1e18,sx:1e21,sp:1e24,o:1e27,n:1e30,d:1e33};
const SUFFIX_DESC=[["d",1e33],["n",1e30],["o",1e27],["sp",1e24],["sx",1e21],["qu",1e18],["qa",1e15],["t",1e12],["b",1e9],["m",1e6],["k",1e3]];
/* Above this the suffix table runs out and the readout switches to e-notation. Also the guard that
   keeps toFixed away from huge values: Decimal#toFixed(1e400) would build a 400-digit string. */
const SUFFIX_CEILING=new Decimal(1e36);
function parseGameNum(str){
  if(str==null)return null;
  if(str instanceof Decimal)return str.isFinite()?str:null;
  if(typeof str==="number")return isFinite(str)?new Decimal(str):null;
  let s=String(str).trim().toLowerCase().replace(/,/g,"").replace(/\s+/g,"");
  if(s===""||s==="-"||s==="+")return null;
  const m=s.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)([a-z]*)$/);
  if(!m)return null;
  let val=decFromSyntax(m[1]);
  if(val===null)return null;
  const suf=m[2];
  if(suf){if(SUFFIX[suf]==null)return null;val=val.times(SUFFIX[suf]);}
  return decIsFinite(val)?val:null;
}
function trimNum(v,dec){let s=(v instanceof Decimal?v:new Decimal(v)).toFixed(dec);if(s.indexOf(".")>=0)s=s.replace(/\.?0+$/,"");return s;}
function formatGameNum(n,dec=2){
  const v=toDec(n);
  if(v===null)return "—";
  if(v.eq(DEC_ZERO))return "0";
  const neg=v.lt(DEC_ZERO),a=v.abs();
  let out;
  if(a.gte(SUFFIX_CEILING)){let[mant,exp]=a.toExponential(2).split("e");mant=mant.replace(/\.?0+$/,"");exp=exp.replace("+","");out=mant+"e"+exp;}
  else{
    let hit=null;
    for(const[suf,mult]of SUFFIX_DESC){if(a.gte(mult)){hit=[suf,mult];break;}}
    out=hit?trimNum(a.div(hit[1]),dec)+hit[0]:trimNum(a,dec);
  }
  return (neg?"-":"")+out;
}
const disp=n=>formatGameNum(n,2);
/* The canonical persisted / transported form of a quantity. Quantities cross three boundaries that
   all destroy a Decimal's prototype — localStorage JSON, Worker postMessage, and the daily solve
   cache's JSON round trip — so they travel as this string and are revived with toDec on arrival. */
function decToStore(value){const d=toDec(value);return d===null?null:d.toString();}

/* ---------- Gel mined-ore cost (shared by the solver, the panel readout, and the modal) ----------
   Gel is forged from mined ore, not crafter inputs. One craft @1× costs 100sx rocks + 500t vespium;
   each compression level triples the cost (same scaling as every craft). Vespium is the scarce input
   the planner budgets against — rocks stay informational (see the ore-cost modal). */
/* Floats, deliberately. Every other cost in the planner is a Decimal because a player can edit it
   and the game can grow it; these two are hardcoded constants scaled by compression, topping out at
   2.4e21 Vespium and 4.8e29 Rocks at 16384×. Nothing user-entered reaches them, so they cannot
   outgrow a float64 — and keeping them float keeps the Gel capacity helper's arithmetic bit-for-bit
   what it was. Routing them through Decimal moved gelVespHr by one ULP, which was enough to change
   which compression step last fit inside a Vespium budget. */
const GEL_ROCKS_BASE=parseGameNum("100sx").toNumber(), GEL_VESP_BASE=parseGameNum("500t").toNumber();
function gelOreCost(L){const s=Math.pow(3,Math.log2(L));return {rocks:GEL_ROCKS_BASE*s,vesp:GEL_VESP_BASE*s};}
