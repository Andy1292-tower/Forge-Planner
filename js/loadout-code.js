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
