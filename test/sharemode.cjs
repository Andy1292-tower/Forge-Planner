"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Share-of-maximum mix mode.
 *
 * Ratio weights are demands in raw item units, so the same number asks very different amounts of
 * items whose ceilings differ. Share mode states each wanted output as a percentage of what that
 * item alone could reach and converts to a ratio weight of share x ceiling.
 *
 *  - the measured ceiling matches a dedicated whole-factory solve for that item;
 *  - equal shares put every output at a comparable fraction of its own ceiling, which equal ratio
 *    weights do not;
 *  - raising one output's share moves the plan toward it;
 *  - the mode is a solve input: the same targets solve differently under each;
 *  - the result names which output is holding the shared floor down, and the slack on the rest;
 *  - an output nothing can make is named rather than silently zeroing every other output.
 *
 * Usage: node test/sharemode.cjs
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

globalThis.performance = performance;          // real clock: these assert on plans, not timings
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const ROOT = path.join(__dirname, "..");
const src = ["js/decimal.js", "js/core.js", "js/fields.js", "js/project-schedule.js", "js/solver.js"]
  .map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const round=n=>Math.round(n);

  // Ceilings deliberately far apart: Gel is the slow, mined-input craft, Plates the fast one.
  const LINES=[{max:64,spx:40,turbo:0},{max:32,spx:35,turbo:0},{max:16,spx:30,turbo:0},{max:8,spx:25,turbo:0}];
  function base(){
    const s=defaults();
    s.mode="items";s.solveBudget=4000;s.dupe=0;s.margin=0;s.maxTurbo=0;
    s.lines=JSON.parse(JSON.stringify(LINES));
    s.minedIncome.Vespium.rigPerMin=1e30;      // Gel limited by line time, not by Vespium
    [...RAWS,...PRODUCTS].forEach(it=>s.targets[it]={on:false,w:1,share:50});
    return s;
  }
  function solve(mode,cfg,mutate){
    const s=base();s.targetMode=mode;
    Object.keys(cfg).forEach(it=>{s.targets[it]={on:true,w:cfg[it].w||1,share:cfg[it].share||50};});
    if(mutate)mutate(s);
    normalize(s);syncManual(s);
    S=s;_soloMaxCache={key:"",values:{}};
    return optimize();
  }
  const ITEMS=["Plates","Gel"];

  /* ---- the ceiling is the dedicated whole-factory figure ---- */
  const shared=solve("share",{Plates:{share:50},Gel:{share:50}});
  const dedicated={};
  ITEMS.forEach(it=>{const r=solve("ratio",{[it]:{w:1}});dedicated[it]=r.out[it]||0;});
  const ceilingsMatch=ITEMS.every(it=>{
    const measured=shared.soloMax&&shared.soloMax[it];
    return measured>0&&Math.abs(measured-dedicated[it])<=1e-6*Math.max(1,dedicated[it]);
  });
  check("each reported ceiling matches a dedicated whole-factory solve for that item",
    ceilingsMatch,ITEMS.map(it=>it+" measured="+round((shared.soloMax||{})[it]||0)+" dedicated="+round(dedicated[it])).join(", "));

  // The premise of the mode: these two items are not interchangeable at the same number.
  check("the two outputs have materially different ceilings, so a shared number is not a shared ask",
    dedicated.Plates>dedicated.Gel*2,"Plates="+round(dedicated.Plates)+" Gel="+round(dedicated.Gel));

  /* ---- equal shares balance effort; equal ratio weights do not ---- */
  const fractionSpread=res=>{
    const f=ITEMS.map(it=>(res.out[it]||0)/((res.soloMax&&res.soloMax[it])||dedicated[it]));
    return {lo:Math.min(...f),hi:Math.max(...f),f};
  };
  const evenShare=fractionSpread(solve("share",{Plates:{share:50},Gel:{share:50}}));
  const evenRatio=fractionSpread(solve("ratio",{Plates:{w:1},Gel:{w:1}}));
  check("equal shares leave both outputs at a closer fraction of their own ceiling than equal ratios do",
    (evenShare.hi-evenShare.lo)<=(evenRatio.hi-evenRatio.lo)+1e-9,
    "share spread="+(evenShare.hi-evenShare.lo).toFixed(3)+" ratio spread="+(evenRatio.hi-evenRatio.lo).toFixed(3));

  /* ---- the control still steers ---- */
  const leanPlates=solve("share",{Plates:{share:100},Gel:{share:5}});
  const leanGel=solve("share",{Plates:{share:5},Gel:{share:100}});
  check("leaning the share toward an output produces more of it and less of the other",
    (leanPlates.out.Plates||0)>(leanGel.out.Plates||0)&&(leanGel.out.Gel||0)>(leanPlates.out.Gel||0),
    "Plates "+round(leanPlates.out.Plates)+" vs "+round(leanGel.out.Plates)+
    " / Gel "+round(leanPlates.out.Gel)+" vs "+round(leanGel.out.Gel));

  /* ---- the mode is a solve input, not a display toggle ---- */
  const asRatio=solve("ratio",{Plates:{w:9,share:50},Gel:{w:1,share:50}});
  const asShare=solve("share",{Plates:{w:9,share:50},Gel:{w:1,share:50}});
  check("the same targets solve differently under each mode",
    JSON.stringify(ITEMS.map(it=>round(asRatio.out[it]||0)))!==JSON.stringify(ITEMS.map(it=>round(asShare.out[it]||0))),
    "ratio="+ITEMS.map(it=>round(asRatio.out[it]||0)).join("/")+" share="+ITEMS.map(it=>round(asShare.out[it]||0)).join("/"));
  check("share mode reports the ceilings and ratio mode does not pay to measure them",
    !!asShare.soloMax&&!asRatio.soloMax,"share="+!!asShare.soloMax+" ratio="+!!asRatio.soloMax);

  /* ---- what is holding the shared floor down ---- */
  const shared2=solve("ratio",{Plates:{w:1},Gel:{w:1}});
  check("a multi-output solve reports a positive floor and names what sets it",
    shared2.feasible&&shared2.objective>0&&ITEMS.includes(shared2.binding),
    "objective="+shared2.objective.toFixed(4)+" binding="+shared2.binding);
  check("every non-binding output reports slack and the binding one reports none",
    shared2.slack&&Math.abs(shared2.slack[shared2.binding])<1e-9&&
    ITEMS.filter(it=>it!==shared2.binding).every(it=>shared2.slack[it]>=-1e-9),
    JSON.stringify(shared2.slack));

  /* ---- an unmakeable output is named, not silently fatal ---- */
  // Strip every recipe cost for Glass so no line can craft it at any level.
  const blocked=solve("share",{Plates:{share:50},Glass:{share:50}},s=>{
    LEVELS.forEach(L=>{s.prodCost.Glass.Bits[L]=null;});
  });
  check("an output nothing can make is named rather than silently zeroing the others",
    Array.isArray(blocked.blocked)&&blocked.blocked.includes("Glass"),
    JSON.stringify(blocked.blocked)+" feasible="+blocked.feasible);

  console.log("");
  console.log(fail?(fail+" share-mode test(s) failed"):"all share-mode tests passed");
  return fail;
})()
`;

const failures = eval(src + "\n" + runner);
process.exit(failures ? 1 : 0);
