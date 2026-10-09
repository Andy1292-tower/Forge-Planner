"use strict";
/* ---------- Game loadout codes ----------
   The game's crafter screen saves a loadout — a name, an icon and a job per crafter — and exports it
   as one line of text:

     name-icon-c1-c2-c3-c4-c5-c6-c7-c8     ingots-7-adaj-adaj-adah-adag-adaf-adae-aaaa-aaaa

   The name is at most 16 characters and the icon a plain decimal id. Each crafter is four characters:
   a two-character recipe id, then a two-character compression level. A pair holds
   Alphabet[n / Base] + Alphabet[n % Base]; only the alphabet's opening a–z is known, and every value
   the planner holds is below 26, so a pair the planner writes is always "a" and one letter. A pair
   opening with anything else is past every recipe and level the planner models.

   Crafter k is planner line k. Nothing here touches the page, so the tests load it without a DOM. */
const LOADOUT_SLOTS=8;
const LOADOUT_NAME_MAX=16;
const LOADOUT_CODE_MAX_LENGTH=256;
const LOADOUT_ALPHABET="abcdefghijklmnopqrstuvwxyz";
const LOADOUT_EMPTY_SLOT="aaaa";
/* The game's recipe enum, spelled out: no planner list runs in this order, and an id must not move
   because PRODUCTS gained an entry. 0 is an empty crafter. */
const LOADOUT_RECIPE_IDS=Object.freeze({Bits:1,Concrete:2,Ingots:3,Plates:4,Rods:5,Glass:6,Bricks:7,Gel:8,
  Batteries:9,"Reinforced Concrete":10,Wire:11,Frames:12});
// Game recipes the planner does not model, named so an import can say what it left idle.
const LOADOUT_UNMODELLED_RECIPES=Object.freeze({13:"Pipes"});
const LOADOUT_ITEM_BY_RECIPE=Object.freeze(Object.fromEntries(Object.entries(LOADOUT_RECIPE_IDS).map(([item,id])=>[id,item])));
/* The loadout icons in the game's order. Close to the Silicate-then-Vespium tab order, but Gel comes
   before Reinforced Concrete here, so this is spelled out too. */
const LOADOUT_ICONS=Object.freeze(["Bits","Concrete","Glass","Bricks","Gel","Reinforced Concrete","Batteries",
  "Ingots","Plates","Rods","Frames","Wire"]);

function loadoutPair(n){
  if(!Number.isInteger(n)||n<0||n>=LOADOUT_ALPHABET.length)throw new RangeError("No loadout pair for "+n);
  return LOADOUT_ALPHABET[0]+LOADOUT_ALPHABET[n];
}
// The value a pair holds, or null when it is past the known alphabet — and so past anything modelled.
function loadoutPairValue(pair){
  if(typeof pair!=="string"||pair.length!==2||pair[0]!==LOADOUT_ALPHABET[0])return null;
  const n=LOADOUT_ALPHABET.indexOf(pair[1]);
  return n<0?null:n;
}
/* The game splits a code on "-", so a name cannot carry one. Control characters go, whitespace
   collapses, and the name is cut to the game's 16 without splitting a two-unit character. */
function loadoutName(text){
  const clean=String(text==null?"":text).replace(/[\u0000-\u001f\u007f]/g,"").replace(/-/g," ").replace(/\s+/g," ").trim();
  const chars=Array.from(clean).slice(0,LOADOUT_NAME_MAX);
  while(chars.join("").length>LOADOUT_NAME_MAX)chars.pop();
  return chars.join("").trim();
}
function loadoutSlotCode(slot){
  const recipe=slot&&LOADOUT_RECIPE_IDS[slot.item],level=slot?LEVELS.indexOf(slot.lvl):-1;
  return recipe&&level>=0?loadoutPair(recipe)+loadoutPair(level):LOADOUT_EMPTY_SLOT;
}
function encodeLoadoutCode({name,icon,slots}){
  const iconId=Number.isInteger(icon)&&icon>=0&&icon<LOADOUT_ICONS.length?icon:0;
  const crafters=[];
  for(let k=0;k<LOADOUT_SLOTS;k++)crafters.push(loadoutSlotCode(slots&&slots[k]));
  return [loadoutName(name)||"Loadout",String(iconId),...crafters].join("-");
}
/* Read from the right: the last eight groups are crafters and the one before them the icon, so a
   name holding a "-" still parses — everything left of the icon is the name. */
function parseLoadoutCode(text){
  const raw=String(text==null?"":text).trim();
  if(!raw)return {ok:false,error:"Paste a loadout code from the game."};
  if(raw.length>LOADOUT_CODE_MAX_LENGTH)return {ok:false,error:"That is too long to be a loadout code."};
  const parts=raw.split("-");
  if(parts.length<LOADOUT_SLOTS+2)
    return {ok:false,error:`A loadout code is a name, an icon number and ${LOADOUT_SLOTS} crafters, joined by "-". This has ${parts.length} part${parts.length===1?"":"s"}.`};
  const iconPart=parts[parts.length-LOADOUT_SLOTS-1].trim();
  if(!/^\d{1,4}$/.test(iconPart))return {ok:false,error:`The icon should be a number, but it reads "${iconPart}".`};
  // A game name is 16 characters, so one holding a whole code is two codes pasted together.
  const name=parts.slice(0,-LOADOUT_SLOTS-1).join("-");
  if(/\d(\s*-\s*[A-Za-z0-9]{4}){8}/.test(name))return {ok:false,error:"That looks like more than one loadout code. Paste one at a time."};
  const slots=[],unmodelled=[];
  const crafterParts=parts.slice(-LOADOUT_SLOTS).map(part=>part.trim());
  for(let k=0;k<LOADOUT_SLOTS;k++){
    const part=crafterParts[k];
    if(!/^[A-Za-z0-9]{4}$/.test(part))return {ok:false,error:`Crafter ${k+1} should be 4 letters, but it reads "${part}".`};
    const recipe=loadoutPairValue(part.slice(0,2)),level=loadoutPairValue(part.slice(2));
    if(recipe===0){slots.push(null);continue;}
    const item=recipe===null?null:LOADOUT_ITEM_BY_RECIPE[recipe]||null;
    if(!item){
      unmodelled.push({crafter:k+1,kind:"recipe",recipe,label:recipe===null?null:LOADOUT_UNMODELLED_RECIPES[recipe]||null,level:null});
      slots.push(null);continue;
    }
    if(level===null||level>=LEVELS.length){
      unmodelled.push({crafter:k+1,kind:"level",recipe,label:null,level});
      slots.push(null);continue;
    }
    slots.push({item,lvl:LEVELS[level]});
  }
  return {ok:true,name,icon:Number(iconPart),slots,unmodelled};
}

/* ---- builds → crafter slots ----
   A slot is {item,lvl} — lvl the planner's multiplier — or null for an empty crafter. Every source
   gives one slot per planner line; a code takes the first eight. */
function loadoutSlot(item,lvl){return ALLITEMS.includes(item)&&LEVELS.includes(lvl)?{item,lvl}:null;}
function sameLoadoutSlots(a,b){
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const x=a[i]||null,y=b[i]||null;
    if(!x!==!y||(x&&(x.item!==y.item||x.lvl!==y.lvl)))return false;
  }
  return true;
}
// Manual mode's setup, read the way manualResult reads it: an unknown job is idle and a level is
// held to its line's cap.
function manualLoadoutSlots(st){
  return (st.lines||[]).map((line,i)=>{
    const entry=st.manual&&st.manual[i];
    if(!entry||entry.job==="Idle")return null;
    return loadoutSlot(entry.job,Math.min(LEVELS.includes(entry.lvl)?entry.lvl:line.max,line.max));
  });
}
// A Max items / Max credits plan, over the current lines the way the Line assignment table draws it.
function planLoadoutSlots(plan,lines){
  return (lines||[]).map((line,i)=>{
    const job=Array.isArray(plan)&&plan[i]&&plan[i].job;
    return job&&job.kind!=="idle"?loadoutSlot(job.res,job.lvl):null;
  });
}
/* One loadout per stretch of a Project step in which no crafter changes job. The executable replay
   already cut the step at every job's start and end; consecutive stretches whose eight crafters come
   out the same are one loadout, since a line past the eighth has no crafter to load. A stretch shorter than the shortest craft runs nothing — it is the replay's rounding,
   a line finishing a hair before the step does — so it joins the stretch before it (or after it, at
   the very start) instead of getting a code. Only a plan the replay accepted has run instructions, so
   a blocked plan has no codes, and neither has a prerequisite step or a stretch where every line is
   idle. start and end are hours into the step. */
function projectStepLoadouts(res,phaseIndex){
  const validation=res&&res.scheduleValidation;
  if(!res||!res.feasible||!res.lpFeasible||!validation||!validation.ok)return [];
  const phase=(res.executionPhases||[])[phaseIndex];
  if(!phase||phase.kind==="prerequisite"||!(phase.eta>0))return [];
  const lineCount=(phase.plan||[]).reduce((n,row)=>Math.max(n,Number(row&&row.line)||0),0);
  const stretches=[];let start=0;
  (validation.boundaries||[]).forEach(boundary=>{
    if(!boundary||boundary.kind!=="switch"||boundary.phaseIndex!==phaseIndex)return;
    const slots=Array.from({length:lineCount},()=>null);
    (boundary.active||[]).forEach(job=>{if(job&&job.line>=1&&job.line<=lineCount)slots[job.line-1]=loadoutSlot(job.item,job.lvl);});
    const end=Number(boundary.phaseTime)||0;
    stretches.push({start,end,slots});
    start=end;
  });
  const shortest=MIN_CRAFT_S/3600,kept=[];
  stretches.forEach(stretch=>{
    if(stretch.end-stretch.start>=shortest)kept.push({...stretch});
    else if(kept.length)kept[kept.length-1].end=stretch.end;
  });
  if(kept.length)kept[0].start=stretches[0].start;
  const crafters=slots=>slots.slice(0,LOADOUT_SLOTS),loadouts=[];
  (kept.length?kept:stretches).forEach(stretch=>{
    const last=loadouts[loadouts.length-1];
    if(!last||!sameLoadoutSlots(crafters(last.slots),crafters(stretch.slots))){loadouts.push({...stretch,slots:stretch.slots.slice()});return;}
    last.end=stretch.end;
    // Every line past the eighth that worked in the loadout stays on it, for the export to name.
    stretch.slots.forEach((slot,i)=>{if(i>=LOADOUT_SLOTS&&slot&&!last.slots[i])last.slots[i]=slot;});
  });
  return loadouts.filter(loadout=>crafters(loadout.slots).some(Boolean));
}

/* ---- export defaults ---- */
// The icon a loadout opens on: the item the build is for when it names one, else the item the most
// crafters run, ties going to the one on the lowest line.
function loadoutDefaultIcon(slots,preferredItem){
  const preferred=LOADOUT_ICONS.indexOf(preferredItem);
  if(preferred>=0)return preferred;
  const busy=(slots||[]).filter(Boolean),counts={};
  busy.forEach(slot=>{counts[slot.item]=(counts[slot.item]||0)+1;});
  const most=Math.max(0,...Object.values(counts)),first=busy.find(slot=>counts[slot.item]===most);
  return first?Math.max(0,LOADOUT_ICONS.indexOf(first.item)):0;
}
// What an export window shows: the first eight lines, and every busy line past them the game has no
// crafter for.
function loadoutExport(slots,name,preferredItem){
  const all=slots||[],crafters=all.slice(0,LOADOUT_SLOTS);
  return {slots:crafters,name:loadoutName(name)||"Loadout",icon:loadoutDefaultIcon(crafters,preferredItem),
    omittedLines:all.map((slot,i)=>slot&&i>=LOADOUT_SLOTS?i+1:0).filter(Boolean)};
}
function planLoadoutExport(res,lines){
  const credits=!!res&&res.mode==="credits",targets=Array.isArray(res&&res.targets)?res.targets:[];
  const name=credits?"Max credits":targets.length===1?"Max "+targets[0]:"Max items";
  return loadoutExport(planLoadoutSlots(res&&res.plan,lines),name,credits?res.bestItem:targets[0]);
}
function manualLoadoutExport(st){
  const active=(st.manualSaved||[]).find(preset=>preset&&preset.id===st.manualActiveId);
  return loadoutExport(manualLoadoutSlots(st),(active&&loadoutName(active.name))||"Manual");
}
function projectLoadoutExport(res,phaseIndex,codeIndex){
  const loadouts=projectStepLoadouts(res,phaseIndex),loadout=loadouts[codeIndex];
  if(!loadout)return null;
  const name="Step "+(phaseIndex+1)+(loadouts.length>1?"."+(codeIndex+1):"");
  return Object.assign(loadoutExport(loadout.slots,name),{start:loadout.start,end:loadout.end});
}
