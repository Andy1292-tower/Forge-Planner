"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Saved output sets: named presets of the Max items/hr output checkboxes and their priorities,
 * plus the Uncheck all control that clears them in one step.
 *
 *  - the recorded set is exactly the checked items and their weights, and applying one clears
 *    every checkbox first, so an item the set does not name ends up off;
 *  - the picker never marks a saved set as selected, because a marked option cannot be re-picked
 *    and the set you just left has to be loadable again;
 *  - normalization and the import boundary both refuse junk sets rather than trusting them;
 *  - naming or deleting a set leaves the solve key alone: S.targets is the solved input.
 *
 * Usage: node test/target-presets.cjs
 */
const fs=require("fs"),path=require("path");

class El{
  constructor(tag){this.tagName=String(tag||"div").toUpperCase();this.innerHTML="";this.textContent="";this.value="";
    this.hidden=false;this.disabled=false;this.selected=false;this.title="";this.type="";this.id="";
    this.dataset={};this.children=[];this.className="";this.style={};this.attributes={};
    this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
  addEventListener(){}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return Object.prototype.hasOwnProperty.call(this.attributes,name)?this.attributes[name]:null;}
  appendChild(x){this.children.push(x);return x;}
  append(...xs){this.children.push(...xs);}
  replaceChildren(...xs){this.children=xs;}
  querySelector(){return null;}
  focus(){globalThis.document.activeElement=this;}
}
const els={};
globalThis.document={
  activeElement:null,
  getElementById:id=>(els[id]||(els[id]=new El())),
  createElement:tag=>new El(tag),
  querySelectorAll:()=>[]
};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.performance={now:()=>0};

const src=["decimal.js", "catalog.js","core.js","fields.js","state.js","dom.js","render.js","solve-service.js"]
  .map(f=>fs.readFileSync(path.join(__dirname,"..","js",f),"utf8")).join("\n;\n");

const runner=`
(function(){
  let fail=0;const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const checked=st=>ALLITEMS.filter(it=>st.targets[it].on).map(it=>it+"@"+st.targets[it].w).join(",")||"(none)";
  const bar=()=>document.getElementById("targetPresetBar").children;
  const barIds=()=>bar().map(c=>c.id).join(" ");

  /* ---- what a set records, and what applying one does ---- */
  S=defaults();
  S.targets.Frames={on:true,w:9};S.targets.Plates={on:true,w:4};S.targets.Bits={on:true,w:2};S.targets.Glass={on:false,w:7};
  const captured=targetPresetConfig(S);
  check("a set records only the checked outputs, with both mix numbers",
    JSON.stringify(captured)===JSON.stringify([{item:"Bits",w:2,share:50},{item:"Plates",w:4,share:50},{item:"Frames",w:9,share:50}]),
    JSON.stringify(captured));

  S.targets.Glass={on:true,w:3};S.targets.Frames={on:false,w:1};
  applyTargetPresetConfig(S,captured);
  check("applying a set clears every checkbox first, so an unnamed item ends up off",
    checked(S)==="Bits@2,Plates@4,Frames@9",checked(S));
  applyTargetPresetConfig(S,[]);
  check("an empty set is Uncheck all",checked(S)==="(none)",checked(S));

  /* ---- the picker is a loader, not a mirror of the current checkboxes ---- */
  S=defaults();
  S.targetSaved=[{id:"pset1",name:"Frames rush",config:[{item:"Frames",w:9}]},
                 {id:"pset2",name:"Raws only",config:[{item:"Ingots",w:1}]}];
  S.targetActiveId="pset2";
  renderTargets();
  const picker=bar()[0],options=picker.children;
  check("every saved set is offered under a standing prompt",
    options.length===3&&options[0].textContent==="— load a saved output set —"&&
    options[1].textContent==="Frames rush"&&options[2].textContent==="Raws only",
    options.map(o=>o.textContent).join(" | "));
  check("no saved set is marked selected, so the loaded set can always be re-picked",
    options[0].selected===true&&!options.slice(1).some(o=>o.selected),
    options.map(o=>o.textContent+"="+o.selected).join(" | "));
  check("the buttons name the active set rather than leaving it to the picker",
    barIds()==="targetPreset targetUpdate targetDelPreset targetSaveNew targetUncheckAll"&&
    bar()[1].textContent.includes("Raws only")&&bar()[2].title.includes("Raws only"),
    barIds()+" / "+bar()[1].textContent+" / "+bar()[2].title);

  S.targetActiveId=null;renderTargets();
  check("with no active set there is nothing to update or delete",
    barIds()==="targetPreset targetSaveNew targetUncheckAll",barIds());

  S.targetSaved=[{id:"pset1",name:"Frames and every raw material at once",config:[]}];
  S.targetActiveId="pset1";renderTargets();
  check("a long set name is shortened on the button but kept whole in its tooltip",
    bar()[1].textContent==="Update “Frames and every raw…”"&&bar()[1].title.includes("Frames and every raw material at once")&&
    bar()[2].title==="Delete “Frames and every raw material at once”",
    bar()[1].textContent+" / "+bar()[1].title);

  S=defaults();renderTargets();
  check("the empty picker says so instead of offering a prompt with no sets",
    bar()[0].children.length===1&&bar()[0].children[0].textContent==="— no saved output sets yet —",
    bar()[0].children.map(o=>o.textContent).join(" | "));

  /* ---- Uncheck all reflects whether there is anything to clear ---- */
  S=defaults();S.targets.Frames.on=true;renderTargets();
  const clearable=bar()[bar().length-1];
  S.targets.Frames.on=false;renderTargets();
  const spent=bar()[bar().length-1];
  check("Uncheck all is live only while something is checked",
    clearable.id==="targetUncheckAll"&&clearable.disabled===false&&spent.disabled===true,
    "checked="+clearable.disabled+" empty="+spent.disabled);

  /* ---- normalization refuses junk rather than trusting it ---- */
  const dirty=defaults();
  dirty.targetSaved=[
    {id:"good",name:"Keep",config:[{item:"Frames",w:5},{item:"Frames",w:1},{item:"Nonsense",w:2},{item:"Rods",w:99},{item:"Glass",w:0},{item:"Bits",w:"x"}]},
    {id:"nameless",config:[]},
    {name:"no config"},
    null
  ];
  dirty.targetActiveId=7;
  normalize(dirty);
  check("a repeated, unknown, or out-of-range entry cannot survive normalization",
    JSON.stringify(dirty.targetSaved[0].config)===JSON.stringify([{item:"Frames",w:5,share:50},{item:"Rods",w:9,share:50},{item:"Glass",w:1,share:50},{item:"Bits",w:1,share:50}]),
    JSON.stringify(dirty.targetSaved[0].config));
  check("a set with no recorded mix mode normalizes to the ratio it was written in",
    dirty.targetSaved[0].mode==="ratio",String(dirty.targetSaved[0].mode));
  check("a set without a usable config is dropped and a missing name is filled",
    dirty.targetSaved.length===2&&dirty.targetSaved[1].name==="Outputs"&&typeof dirty.targetSaved[1].id==="string",
    JSON.stringify(dirty.targetSaved.map(p=>({id:p.id,name:p.name}))));
  check("a non-string active id becomes none",dirty.targetActiveId===null,String(dirty.targetActiveId));

  /* ---- the import boundary ---- */
  const build=()=>{const st=normalize(defaults())||defaults();st.schemaVersion=CURRENT_SCHEMA_VERSION;st.baseTimeRev=2;return JSON.parse(JSON.stringify(st));};
  const carrier=build();
  carrier.targetSaved=[{id:"pset1",name:"Frames rush",mode:"share",
    config:[{item:"Frames",w:9,share:80},{item:"Rods",w:2,share:25}]}];
  carrier.targetActiveId="pset1";
  const round=validateAndMigrate(carrier);
  check("a saved set survives export and import unchanged",
    round.ok&&JSON.stringify(round.state.targetSaved)===JSON.stringify(carrier.targetSaved)&&round.state.targetActiveId==="pset1",
    round.ok?JSON.stringify(round.state.targetSaved)+" active="+round.state.targetActiveId:round.errors.join("; "));

  // The mix mode and share percentage are additive: a build written before they existed must import
  // as the ratio set its numbers were always meant as, rather than being rejected or re-read as
  // percentages. Loading such a set must also put the app back into ratio mode.
  const legacySet=build();
  legacySet.targetSaved=[{id:"pset1",name:"Frames rush",config:[{item:"Frames",w:9},{item:"Rods",w:2}]}];
  legacySet.targetActiveId="pset1";
  const legacyRound=validateAndMigrate(legacySet);
  check("a set written before share mode imports as a ratio set with default shares",
    legacyRound.ok&&legacyRound.state.targetSaved[0].mode==="ratio"&&
    JSON.stringify(legacyRound.state.targetSaved[0].config)===JSON.stringify([{item:"Frames",w:9,share:50},{item:"Rods",w:2,share:50}]),
    legacyRound.ok?JSON.stringify(legacyRound.state.targetSaved[0]):legacyRound.errors.join("; "));

  // Applying a set must carry its mode across, or a share set silently re-reads its percentages as
  // ratio weights and solves a different question than the one that was saved.
  S=defaults();S.targetMode="ratio";
  applyTargetPresetConfig(S,[{item:"Frames",w:9,share:80}],"share");
  check("applying a share set switches the mix mode with it",
    S.targetMode==="share"&&S.targets.Frames.share===80,
    S.targetMode+" Frames.share="+S.targets.Frames.share);
  applyTargetPresetConfig(S,[{item:"Frames",w:9,share:80}],"ratio");
  check("applying a ratio set switches back",S.targetMode==="ratio",S.targetMode);

  const older=build();
  delete older.targetSaved;delete older.targetActiveId;
  const olderResult=validateAndMigrate(older);
  check("a build written before saved sets existed still imports, with none",
    olderResult.ok&&Array.isArray(olderResult.state.targetSaved)&&olderResult.state.targetSaved.length===0&&
    olderResult.state.targetActiveId===null,
    olderResult.ok?JSON.stringify(olderResult.state.targetSaved):olderResult.errors.join("; "));

  const rejects=[
    ["an unsafe id",st=>{st.targetSaved=[{id:"x\\"><img",name:"N",config:[]}];},/targetSaved\\[0\\]\\.id.*safe ID format/i],
    ["an unknown item",st=>{st.targetSaved=[{id:"pset1",name:"N",config:[{item:"Unobtainium",w:1}]}];},/targetSaved\\[0\\]\\.config\\[0\\]\\.item/i],
    ["an out-of-range priority",st=>{st.targetSaved=[{id:"pset1",name:"N",config:[{item:"Frames",w:12}]}];},/targetSaved\\[0\\]\\.config\\[0\\]\\.w/i],
    ["a repeated item",st=>{st.targetSaved=[{id:"pset1",name:"N",config:[{item:"Frames",w:1},{item:"Frames",w:2}]}];},/listed more than once/i],
    ["a missing name",st=>{st.targetSaved=[{id:"pset1",config:[]}];},/targetSaved\\[0\\]\\.name.*required/i],
    ["an unsafe active id",st=>{st.targetActiveId="9bad";},/targetActiveId.*safe ID format/i]
  ];
  rejects.forEach(([label,corrupt,pattern])=>{
    const candidate=build();corrupt(candidate);
    const result=validateAndMigrate(candidate);
    check("import rejects "+label,!result.ok&&pattern.test(result.errors.join(" ")),
      result.ok?"accepted":result.errors.join("; "));
  });

  const overflowing=build();
  overflowing.targetSaved=Array.from({length:STATE_LIMITS.maxPresets+1},(_,i)=>({id:"p"+i,name:"N",config:[]}));
  const overflowResult=validateAndMigrate(overflowing);
  check("import holds the shared preset ceiling",
    !overflowResult.ok&&/targetSaved.*limit/i.test(overflowResult.errors.join(" ")),
    overflowResult.ok?"accepted":overflowResult.errors.join("; "));

  /* ---- saved sets are not a solve input ---- */
  const solving=build();
  solving.targetSaved=[{id:"pset1",name:"Frames rush",config:[{item:"Frames",w:9}]}];
  solving.targetActiveId="pset1";
  const before=solveStateKey(solving);
  const renamed=JSON.parse(JSON.stringify(solving));
  renamed.targetSaved[0].name="Renamed";renamed.targetSaved.push({id:"pset2",name:"Another",config:[]});
  renamed.targetActiveId="pset2";
  check("naming, adding, or switching a set never invalidates a running solve",
    solveStateKey(renamed)===before,"changed="+(solveStateKey(renamed)!==before));
  const retargeted=JSON.parse(JSON.stringify(solving));
  retargeted.targets.Frames={on:true,w:9};
  check("the checked outputs themselves still key the solve",
    solveStateKey(retargeted)!==before,"changed="+(solveStateKey(retargeted)!==before));

  if(fail)process.exitCode=1;
  console.log("\\n"+(fail?fail+" saved-output-set test(s) failed":"all saved-output-set tests passed"));
})();`;

eval(src+"\n"+runner);
