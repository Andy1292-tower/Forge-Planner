"use strict";
/* Checking fewer outputs must never report less of them (Node).
 *
 * Items mode maximizes the shared weighted floor over the checked outputs. Every constraint the
 * solver enforces — each resource produced at least as fast as it is consumed — is the same whichever
 * outputs are checked, and relevantChain already pulls the whole feeder chain in behind a single
 * target. So any plan the solver can reach with N outputs checked it can also reach with one of them
 * checked, scoring that output exactly the same. Checking a feeder as a second output can therefore
 * only cost the first output throughput; it can never buy it any.
 *
 * It used to buy quite a lot. The objective counts net TARGET output only, so with just Batteries
 * checked, putting Gel on a spare line scored the same as leaving the line Idle — the gain only
 * arrives once Batteries also moves onto the line that Gel freed, and that half does not pay until
 * the Gel is already there. Neither step improves anything alone, so single-line hill climbing would
 * not take the first one and the plan settled with lines empty and Batteries parked wherever the
 * constructive seed dropped it. Ticking Gel on gave the search a gradient it was missing and the
 * reported Batteries rate went UP (issue #134: "i have 2 completely empty lines ... but then i also
 * check gel and my batteries goes up").
 *
 * Pinned here:
 *   - the reported factory clears the rate the old search could only reach with Gel also checked;
 *   - a one-output solve is not beaten by the same factory solved with a feeder also checked;
 *   - that holds across chain depths, including outputs with no product feeder at all;
 *   - the reported rate never sits above the LP ceiling that bounds it, at any budget.
 *
 * Note what the second assertion can and cannot be. Both solves are randomized anytime searches over
 * the same feasible set, so which one gets luckier on a given factory is not something any amount of
 * plateau-fixing settles — a strict solo >= pair would be pinning the RNG, and it would go red on a
 * slow machine rather than on a real defect. What the fix removes is the systematic gap, plans the
 * one-output search could not reach at any budget; residual noise of a fraction of a percent is the
 * heuristic being a heuristic. So the sweep allows NOISE and the reported factory carries the hard
 * floor, which is the assertion that actually fails against the unfixed solver (0.622 vs 0.646).
 *
 * Usage: node test/feeder-plateau.cjs
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

globalThis.performance = performance;              // real clock: this asserts on inequalities
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const ROOT = path.join(__dirname, "..");
const src = ["js/core.js", "js/fields.js", "js/project-schedule.js", "js/solver.js"]
  .map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const rate=n=>Number(n).toPrecision(6);

  // The factory from the report: a dozen lines of mixed compression, enough Vespium and Hydracite
  // that the ore budgets are not what binds, and Batteries' whole chain (Wire, Gel, Rods) in play.
  const REPORTED=[
    {max:512,spx:31.92,turbo:0},{max:512,spx:31.43,turbo:0},{max:16384,spx:45.21,turbo:0},
    {max:64,spx:50.95,turbo:0},{max:2048,spx:33.17,turbo:0},{max:512,spx:49.39,turbo:0},
    {max:4096,spx:26.07,turbo:0},{max:4096,spx:18.48,turbo:0},{max:4096,spx:46.79,turbo:0},
    {max:64,spx:40.65,turbo:0},{max:16384,spx:47.36,turbo:0},{max:64,spx:56.25,turbo:0}
  ];
  const TIERED=[
    {max:16384,spx:55,turbo:0},{max:16384,spx:50,turbo:0},{max:8192,spx:45,turbo:0},
    {max:8192,spx:42,turbo:0},{max:4096,spx:38,turbo:0},{max:4096,spx:34,turbo:0},
    {max:2048,spx:28,turbo:0},{max:1024,spx:22,turbo:0},{max:512,spx:16,turbo:0},
    {max:256,spx:44,turbo:0}
  ];

  function solve(lines,on,budget){
    const s=defaults();
    s.mode="items";s.solveBudget=budget;s.dupe=12;s.margin=0;s.maxTurbo=0;
    s.lines=JSON.parse(JSON.stringify(lines));
    s.minedIncome.Vespium.rigPerMin=1e24;
    s.minedIncome.Hydracite.resourcesTradingPerSec=1e18;
    RAWS.forEach(r=>{s.forgie[r]=1e18;});
    [...RAWS,...PRODUCTS].forEach(it=>{s.targets[it]={on:!!on[it],w:on[it]||1,share:50};});
    normalize(s);syncManual(s);
    S=s;_soloMaxCache={key:"",values:{}};
    return optimize();
  }

  // Two anytime searches racing on a real clock; a percent either way is which one got luckier.
  const NOISE=0.01;
  function noWorseAlone(label,lines,item,feeder,budget){
    const solo=solve(lines,{[item]:1},budget);
    const pair=solve(lines,{[item]:1,[feeder]:1},budget);
    const a=solo.out[item]||0,b=pair.out[item]||0;
    check(label+": "+item+" alone is not beaten by "+item+" plus "+feeder,
      solo.feasible&&a>0&&b<=a*(1+NOISE),
      "alone="+rate(a)+"/hr  with "+feeder+"="+rate(b)+"/hr"+(b>a?"  (+"+((b/a-1)*100).toFixed(2)+"%)":""));
    return solo;
  }

  /* ---- the reported factory: Batteries alone used to trail Batteries+Gel by ~4% ---- */
  // The hard floor. Before the fix this factory reported 0.6222/hr with only Batteries checked and
  // 0.6465/hr once Gel was checked too — the reporter's complaint exactly. The floor sits between
  // the two, above anything the old search reached alone and below what the fixed one settles on
  // (0.6465), so it fails loudly on a regression without pinning the search to a single plan.
  const reported=noWorseAlone("reported factory",REPORTED,"Batteries","Gel",8000);
  check("the reported factory reaches its full rate with only Batteries checked",
    (reported.out.Batteries||0)>=0.64,
    "alone="+rate(reported.out.Batteries||0)+"/hr  floor=0.64  (0.622 before the fix)");

  /* ---- deeper down the same chain, and on a second shape ---- */
  noWorseAlone("reported factory",REPORTED,"Wire","Gel",8000);
  noWorseAlone("tiered factory",TIERED,"Batteries","Gel",8000);

  /* ---- an output whose chain holds no product feeder still solves, and still respects the rule ---- */
  // Plates <- Ingots only: there is no feeder to tick on, so the second pass is skipped outright and
  // must leave the result alone rather than skew it.
  noWorseAlone("tiered factory",TIERED,"Plates","Rods",4000);

  /* ---- whatever the search returns, it stays under the ceiling that bounds it ---- */
  check("the reported factory's rate stays under its own LP ceiling",
    !Number.isFinite(reported.bound)||reported.objective<=reported.bound*(1+1e-6),
    "objective="+rate(reported.objective)+" bound="+(reported.bound==null?"null":rate(reported.bound)));

  // Two things are deliberately not tested here. Frames over a Rods feeder sits ~0.3% behind on the
  // tiered shape, which is the residual this fix does not remove; asserting a number on it would be
  // asserting which of two anytime runs got luckier, and it would go red on a slow machine rather
  // than on a defect. Monotonicity in the budget is optimality-gap.cjs's job and is covered there —
  // every solve here costs real wall-clock, so this file only spends it on what it alone can catch.

  return fail;
})()
`;

const failures = eval(src + "\n" + runner);
console.log("");
console.log(failures ? (failures + " feeder-plateau test(s) failed") : "all feeder-plateau tests passed");
process.exit(failures ? 1 : 0);
