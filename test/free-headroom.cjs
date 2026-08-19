"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Free line capacity is spent, not reported as a smaller craft (Node).
 *
 * Items mode maximizes the shared weighted floor: the SMALLEST output-to-weight ratio across the
 * checked outputs. Only the weakest output moves that number, so as soon as a second output sits
 * above the floor, every further unit of it is worth exactly zero to the score. Every acceptance
 * test in the search is a strict improvement, so nothing ever reaches for those units, and the line
 * carrying that output keeps whatever level the last random kick happened to leave it at.
 *
 * That is what the reporter saw: on the factory in this fixture, Batteries holds the floor at
 * 270.31/hr while Gel runs an order of magnitude above it, and line 3 — an 8192 line — came back
 * set to 2048 while every other line ran at its own cap. Raising it costs nothing and no ore budget
 * binds, so the extra 251,825 Gel/hr was there for free the whole time (issue #153: "Line 3 still
 * suggests 2048x ... In this case, Line 3 should suggest 8192x").
 *
 * Turning the Gel ratio up cannot work around it. Making Gel the floor needs a weight above 11.4,
 * and FIELD_SCHEMA.targetWeight stops at 9, so on this factory every allowed setting of the slider
 * leaves Batteries binding — which is why the reporter's step 4 changed nothing.
 *
 * Pinned here:
 *   - the reported factory spends the headroom: line 3 comes back at its cap, not at 2048;
 *   - spending it costs the binding output nothing, and stays under the LP ceiling;
 *   - the returned plan is locally maximal — no single-line switch buys more target output while
 *     holding feasibility, the objective and the balance, which is the post-condition the pass
 *     exists to establish and the assertion that does not depend on this one factory.
 *
 * The plateau this covers is the sibling of the one in feeder-plateau.cjs: same max-min objective,
 * same "worth zero so nothing reaches for it" shape, but on a CHECKED output sitting above the
 * floor rather than on an unchecked feeder behind it.
 *
 * Usage: node test/free-headroom.cjs
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

globalThis.performance = performance;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const ROOT = path.join(__dirname, "..");
const src = ["js/decimal.js", "js/core.js", "js/fields.js", "js/project-schedule.js", "js/solver.js"]
  .map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const FIXTURE = JSON.stringify(
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "state", "plateau-free-headroom.json"), "utf8")));

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const rate=n=>Number(n).toPrecision(6);

  // The reporter's save, trimmed to what Items mode reads: 7 lines from a 16384 down to a 512, and
  // Batteries + Gel both checked at ratio 1.
  const fixture=JSON.parse(${JSON.stringify(FIXTURE)});
  S=JSON.parse(JSON.stringify(fixture));normalize(S);syncManual(S);
  _soloMaxCache={key:"",values:{}};
  const res=optimize();

  const targets=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
  const byLine={};(res.plan||[]).forEach(p=>{byLine[p.line]=p;});
  const spare=(res.plan||[]).find(p=>p.job&&p.job.kind==="craft"&&p.max===8192);

  /* ---- the symptom: the 8192 line comes back at 8192 ---- */
  // Before the fix this line reported 2048 and the plan made 3078 Gel/hr. The floor sits far above
  // anything the old search reached and far below what the fixed one settles on (254,903/hr), so it
  // fails loudly on a regression without pinning the search to one plan.
  check("the spare capacity on line 3 is spent",
    !!spare&&spare.job.lvl===8192,
    "line 3 = "+(spare?spare.job.res+"@"+spare.job.lvl:"absent")+"  (Gel@2048 before the fix)");
  check("the surplus output clears the rate the old plateau was stuck at",
    (res.out.Gel||0)>=1e5,
    "Gel="+rate(res.out.Gel||0)+"/hr  floor=1e5  (3078 before the fix)");

  /* ---- and it costs the output that actually holds the floor nothing ---- */
  check("the binding output is not traded away for the surplus",
    res.binding==="Batteries"&&res.objective>=270.3,
    "objective="+rate(res.objective)+"/hr  binding="+res.binding+"  floor=270.3");
  check("the reported rate stays under its own LP ceiling",
    !Number.isFinite(res.bound)||res.objective<=res.bound*(1+1e-6),
    "objective="+rate(res.objective)+" bound="+(res.bound==null?"null":rate(res.bound)));

  /* ---- the post-condition itself, on the solver's own arrays ---- */
  // Re-solve through solveCore with the delta seam open, then walk every single-line switch off the
  // plan it returned. Any switch that holds feasibility, the objective and the balance while making
  // MORE target output is headroom the pass was supposed to have spent. This is the assertion that
  // is not about this factory: it is the property, checked on whatever plan the search lands on.
  const w=targets.map(it=>S.targets[it].w);
  const rc=relevantChain(targets);
  let H=null;
  const sr=solveCore(targets,w,rc.prods,rc.raws,S.solveBudget,
    {spendFreeHeadroom:true,onDeltaProbe:h=>{H=h;}});
  if(!H||!sr.feasible){
    check("the delta seam hands back a solved plan to probe",false,"probe="+!!H+" feasible="+sr.feasible);
  }else{
    const ch=sr.best.choice.slice();
    const totalOut=()=>{let t=0;for(let k=0;k<H.targets.length;k++)t+=(H.produced[sr.tIdx[k]]-H.consumed[sr.tIdx[k]])/w[k];return t;};
    H.evalChoice(ch);
    const baseScore=H.scoreNow(),baseD=H.totalDeficit(),baseT=totalOut();
    let best=null,moves=0;
    for(let i=0;i<H.N;i++){
      const old=ch[i],js=H.lineJobs[i];
      for(let k=0;k<js.length;k++){
        if(k===old)continue;
        moves++;
        H.beginMove();H.applyMove(i,old,k);
        if(H.feasibleNow()&&H.scoreNow()>=baseScore-1e-9&&H.totalDeficit()<=baseD+1e-9){
          const t=totalOut();
          if(t>baseT*(1+1e-9)&&(!best||t>best.t))best={i:i+1,k,t};
        }
        H.revertMove();
      }
    }
    check("no single-line switch buys free target output the plan left on the table",
      best===null,
      "moves="+moves+" total="+rate(baseT)+(best?"  line "+best.i+" -> "+rate(best.t):"  none improve"));
  }

  return fail;
})()
`;

const failures = eval(src + "\n" + runner);
console.log("");
console.log(failures ? (failures + " free-headroom test(s) failed") : "all free-headroom tests passed");
process.exit(failures ? 1 : 0);
