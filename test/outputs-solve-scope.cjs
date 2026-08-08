"use strict";
/* Which modes the Outputs card is allowed to re-solve (Node).
 *
 * The Outputs card — checked outputs, their weights/shares, the mix mode, saved sets, and the
 * May-work margin — is not mode-gated in the markup, so it is on screen and clickable in every
 * mode. Its handlers used to call scheduleSolve() unconditionally, which meant ticking a checkbox
 * in Project mode spent the whole solve budget re-deriving a plan that cannot read the tick:
 * S.targets / S.targetMode are read only inside optimizeInner's items branch, Project builds its
 * demand from the shopping list, and Project pins the margin at zero via tolOverride.
 *
 * Pinned here, per control and per mode:
 *   checked outputs, weights, shares, mix mode, saved sets -> Max items alone
 *   May-work margin                                        -> Max items and Credits
 *   every mode                                             -> the edit is still saved
 *
 * events.js wires the live DOM at import time, so — as test/minedfocus.cjs does for the mined
 * modal — only the Outputs block is sliced out and evaluated against a small stub DOM. Everything
 * shares one eval scope, the way parity.cjs and staticmode.cjs do it.
 *
 * Usage: node test/outputs-solve-scope.cjs
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

// --- stub DOM: just enough for addEventListener/dispatch and the value readbacks ---
class Node {
  constructor(id){ this.id=id; this.dataset={}; this.value=""; this.textContent=""; this.checked=false;
    this.disabled=false; this._listeners={}; this.validity={badInput:false}; this.parentElement=null; }
  addEventListener(type,fn){ (this._listeners[type]||(this._listeners[type]=[])).push(fn); }
  dispatch(type,event){ const e=Object.assign({type,target:this,preventDefault(){}},event||{});
    (this._listeners[type]||[]).forEach(fn=>fn(e)); return e; }
  querySelector(){ return this._pv||(this._pv=new Node("pv")); }
  closest(){ return this; }
  focus(){ }
}
const nodes={};
globalThis.__node=id=>nodes[id]||(nodes[id]=new Node(id));
globalThis.__Node=Node;
globalThis.document={ getElementById:globalThis.__node, querySelector:()=>globalThis.__node("targetModeButton"),
  querySelectorAll:()=>[] };

// --- spies for the three things a handler may do ---
globalThis.__spy={solves:0,saves:0,persists:0};
globalThis.scheduleSolve=()=>{globalThis.__spy.solves++;};
globalThis.save=()=>{globalThis.__spy.saves++;return true;};
globalThis.schedulePersist=()=>{globalThis.__spy.persists++;};
globalThis.renderTargets=()=>{};
globalThis.refreshLineNotes=()=>{};
globalThis.markStale=()=>{};
globalThis.fmt=value=>String(value);

// --- slice out only the Outputs block, so importing events.js cannot wire the whole page ---
const eventsSrc=read("js","events.js");
const from=eventsSrc.indexOf("function solveForOutputMix()");
const to=eventsSrc.indexOf("function saveTargetPreset(");
if(from<0||to<0||to<=from)throw new Error("Outputs event block not found in js/events.js");

const runner=`
(function(){
  globalThis.mutateState=mutator=>{mutator(S);};
  // The real commitFieldDraft lives above the sliced block and has its own suite in
  // field-validation.cjs; here it only has to accept a value, so mode routing is what is tested.
  globalThis.commitFieldDraft=(input,rule,previous,mutator)=>{
    const value=Number(input.value);
    if(!Number.isFinite(value))return {committed:false,value:previous};
    mutator(S,value);return {committed:true,value};
  };

  ${eventsSrc.slice(from,to)}

  let failed=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+"  ["+detail+"]");if(!ok)failed++;};
  const spy=globalThis.__spy,Node=globalThis.__Node;
  const targets=globalThis.__node("targets"),margin=globalThis.__node("margin"),modeSwitch=globalThis.__node("targetModeSw");
  const reset=mode=>{S=defaults();S.mode=mode;spy.solves=0;spy.saves=0;spy.persists=0;};
  const tickOutput=(item,on)=>{const box=new Node("box");box.dataset.tg=item;box.checked=on;targets.dispatch("change",{target:box});};
  const dragSlider=(key,item,value)=>{const slider=new Node(key);slider.dataset[key]=item;slider.value=String(value);
    slider.parentElement=new Node("row");targets.dispatch("input",{target:slider});};
  const dragMargin=value=>{margin.value=String(value);margin.dispatch("input",{target:margin});};
  const switchMix=mode=>{const button=new Node("btn");button.dataset.targetmode=mode;modeSwitch.dispatch("click",{target:button});};
  const applyPreset=()=>{commitTargetPresetEdit(state=>{state.targets.Glass.w=4;},"targetPreset",true);};

  // Each control is a solve input in exactly these modes, and a saved edit in all four.
  const MIX_SOLVES_IN=["items"],MARGIN_SOLVES_IN=["items","credits"];
  ["items","credits","project","manual"].forEach(mode=>{
    const mix=MIX_SOLVES_IN.indexOf(mode)>=0?1:0,marg=MARGIN_SOLVES_IN.indexOf(mode)>=0?1:0;
    const verb=count=>count?"re-solves":"does not re-solve";

    reset(mode);tickOutput("Glass",true);
    check(mode+": ticking an output "+verb(mix),
      spy.solves===mix&&S.targets.Glass.on===true&&spy.saves===1,
      "solves="+spy.solves+" saves="+spy.saves+" on="+S.targets.Glass.on);

    reset(mode);dragSlider("w","Glass",7);
    check(mode+": an output weight "+verb(mix),
      spy.solves===mix&&S.targets.Glass.w===7&&spy.saves===1,
      "solves="+spy.solves+" saves="+spy.saves+" w="+S.targets.Glass.w);

    reset(mode);dragSlider("share","Glass",80);
    check(mode+": an output share "+verb(mix),
      spy.solves===mix&&targetShareOf(S.targets.Glass)===80&&spy.saves===1,
      "solves="+spy.solves+" saves="+spy.saves+" share="+targetShareOf(S.targets.Glass));

    reset(mode);switchMix(S.targetMode==="share"?"ratio":"share");
    check(mode+": switching the mix mode "+verb(mix),
      spy.solves===mix&&spy.saves===1,
      "solves="+spy.solves+" saves="+spy.saves+" mixMode="+S.targetMode);

    reset(mode);applyPreset();
    check(mode+": applying a saved output set "+verb(mix),
      spy.solves===mix&&spy.saves===1&&S.targets.Glass.w===4,
      "solves="+spy.solves+" saves="+spy.saves+" w="+S.targets.Glass.w);

    reset(mode);dragMargin(5);
    check(mode+": the May-work margin "+verb(marg),
      spy.solves===marg&&S.margin===5,
      "solves="+spy.solves+" margin="+S.margin);
  });

  // Renaming or reordering a saved set changes no output, and was never a solve input anywhere.
  reset("items");commitTargetPresetEdit(()=>{},"targetPreset",false);
  check("a saved-set edit that changes no output never re-solves, even in Max items",
    spy.solves===0&&spy.persists===1,"solves="+spy.solves+" persists="+spy.persists);

  console.log("\\n"+(failed?failed+" failed":"all "+"Outputs solve-scope tests passed"));
  if(failed)process.exit(1);
})();
`;

eval(read("js","core.js")+"\n"+read("js","fields.js")+"\n"+runner);
