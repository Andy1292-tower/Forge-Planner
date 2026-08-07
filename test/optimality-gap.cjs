"use strict";
/* Optimality gap reporting.
 *
 * The LP relaxation already proves a ceiling on the objective. Items results carry it as `bound`
 * so a bounded plan can say how far it could still be from that ceiling instead of reporting every
 * unproven solve with the same sentence.
 *
 *  - a strict solve reports a bound, and it never sits below the objective it bounds;
 *  - the bound is a real ceiling: a longer solve of the same factory never passes it;
 *  - the bound does not move with the time budget, so the gap measures the search, not the clock;
 *  - a margin solve reports no bound, because the relaxation encodes strict feasibility;
 *  - the reported gap stays inside [0, 1).
 *
 * Usage: node test/optimality-gap.cjs
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

globalThis.performance = performance;          // real clock: these assert on bounds, not timings
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const ROOT = path.join(__dirname, "..");
const src = ["js/core.js", "js/fields.js", "js/project-schedule.js", "js/solver.js"]
  .map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const round=n=>Math.round(n*1000)/1000;

  // Enough lines and enough job choices that the exact search cannot exhaust a short budget.
  const WIDE=[{max:64,spx:40,turbo:0},{max:64,spx:38,turbo:0},{max:32,spx:35,turbo:0},{max:32,spx:33,turbo:0},
              {max:16,spx:30,turbo:0},{max:16,spx:28,turbo:0},{max:8,spx:25,turbo:0},{max:8,spx:22,turbo:0}];
  const SMALL=[{max:8,spx:25,turbo:0},{max:4,spx:20,turbo:0}];

  function base(lines,budget){
    const s=defaults();
    s.mode="items";s.solveBudget=budget;s.dupe=0;s.margin=0;s.maxTurbo=0;
    s.lines=JSON.parse(JSON.stringify(lines));
    s.minedIncome.Vespium.rigPerMin=1e30;
    [...RAWS,...PRODUCTS].forEach(it=>s.targets[it]={on:false,w:1,share:50});
    return s;
  }
  function solve(cfg,lines,budget,mutate){
    const s=base(lines,budget);
    Object.keys(cfg).forEach(it=>{s.targets[it]={on:true,w:cfg[it],share:50};});
    if(mutate)mutate(s);
    normalize(s);syncManual(s);
    S=s;_soloMaxCache={key:"",values:{}};
    return optimize();
  }
  const MIX={Frames:1,Wire:1};

  /* ---- a strict solve carries the bound, and it is never below the objective ---- */
  const wide=solve(MIX,WIDE,1500);
  check("a strict items solve reports a numeric optimality bound",
    Number.isFinite(wide.bound),"bound="+round(wide.bound)+" objective="+round(wide.objective)+" capped="+wide.capped);
  check("the bound never sits below the objective it bounds",
    Number.isFinite(wide.bound)&&wide.bound>=wide.objective,
    "bound="+round(wide.bound)+" objective="+round(wide.objective));

  /* ---- the ceiling holds: more time never produces a plan above it ---- */
  // The safety property the notice rests on. A bound a longer search can pass is not a bound.
  const patient=solve(MIX,WIDE,12000);
  check("a longer solve of the same factory never produces an objective above the short solve's bound",
    patient.objective<=wide.bound*(1+1e-6),
    "patient objective="+round(patient.objective)+" short bound="+round(wide.bound));
  check("a longer solve is at least as good as the short one, and reports a bound of its own",
    patient.objective>=wide.objective-1e-9&&Number.isFinite(patient.bound),
    "short="+round(wide.objective)+" patient="+round(patient.objective)+" bound="+round(patient.bound));

  /* ---- the bound measures the factory, not the clock ---- */
  check("the same factory reports the same ceiling at both budgets",
    Math.abs(wide.bound-patient.bound)<=1e-6*Math.max(1,wide.bound),
    "short bound="+round(wide.bound)+" long bound="+round(patient.bound));

  /* ---- the reported gap is a usable fraction ---- */
  const gapOf=r=>Number.isFinite(r.bound)&&r.bound>0?(r.bound-r.objective)/r.bound:null;
  const gaps=[wide,patient].map(gapOf);
  check("every reported gap stays inside [0, 1)",
    gaps.every(g=>g!==null&&g>=0&&g<1),gaps.map(g=>g===null?"null":round(g)).join(", "));

  /* ---- a proven solve is still bounded above by its own ceiling ---- */
  const small=solve({Plates:1},SMALL,8000);
  check("a small factory proves its optimum and still reports a consistent ceiling",
    small.capped===false&&Number.isFinite(small.bound)&&small.bound>=small.objective,
    "capped="+small.capped+" bound="+round(small.bound)+" objective="+round(small.objective));

  /* ---- the result says why the search stopped ---- */
  // The notice's advice hangs on this: a budget the search never reached must not be reported as
  // exhausted, or the reader is told to raise a limit that was never the constraint.
  const roomy=solve(MIX,WIDE,20000);
  check("a search that converges well inside its budget does not report the deadline as reached",
    roomy.deadlineReached===false&&roomy.ms<20000*0.9,
    "ms="+Math.round(roomy.ms)+" of 20000, deadlineReached="+roomy.deadlineReached);
  check("a converged solve returns the same objective however much budget it is given",
    Math.abs(roomy.objective-patient.objective)<=1e-9*Math.max(1,patient.objective),
    "12s="+round(patient.objective)+" 20s="+round(roomy.objective));

  const HUGE=Array.from({length:12},(_,i)=>({max:[64,32,16,8][i%4],spx:40-i*1.5,turbo:0}));
  const starved=solve({Frames:1,Wire:1,Batteries:1},HUGE,250);
  check("a search cut off by its budget does report the deadline as reached",
    starved.deadlineReached===true,"ms="+Math.round(starved.ms)+" deadlineReached="+starved.deadlineReached);

  /* ---- no bound can be quoted for a margin pass ---- */
  // lpRelax's resource rows use baseArr with no tolerance, so its z cannot bound a may-work optimum.
  const margin=solve(MIX,WIDE,1500,s=>{s.margin=5;});
  check("a solve with a margin set reports no bound at all",
    margin.bound===null,"bound="+JSON.stringify(margin.bound)+" tol="+margin.tol);
  check("dropping the margin brings the bound back",
    Number.isFinite(solve(MIX,WIDE,1500,s=>{s.margin=0;}).bound),"margin=0 solve");

  return fail;
})()
`;

// The notice is a pure function of the result, so the bands and their copy are checked directly.
const noticeSrc = ["js/core.js", "js/fields.js", "js/results.js"]
  .map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const noticeRunner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const at=(gap,deadlineReached)=>optimalityNotice(
    {feasible:true,objective:100*(1-gap),bound:100,tol:0,capped:true,deadlineReached:!!deadlineReached});

  check("a near-proven plan rounds its gap up to 0.1% rather than down to zero",
    at(0.0004).includes("0.1%")&&!at(0.0004).includes("0.0%"),at(0.0004));
  check("the notice names how far the theoretical ceiling sits above the plan",
    at(0.09).includes("9%")&&at(0.09).includes("theoretical ceiling"),at(0.09));

  /* ---- a plan the search could not improve on is reported as the plan, not as a shortfall ---- */
  // A wide gap on a converged search is mostly the relaxation splitting lines, not a weak plan.
  // Leading with "up to X% below the ceiling" reads as a fault the reader cannot act on.
  [0.004,0.09,0.38].forEach(g=>{
    const conv=at(g,false);
    check("a converged solve at a "+(g*100).toFixed(1)+"% gap leads with the plan, not the shortfall",
      conv.includes("<b>Best plan found.</b>")&&!conv.includes("below the ceiling"),conv);
    check("a converged solve at a "+(g*100).toFixed(1)+"% gap never recommends a larger budget",
      !conv.includes("larger budget may")&&conv.includes("larger budget returns this same plan"),conv);
    check("a converged solve at a "+(g*100).toFixed(1)+"% gap stays informational, never a warning",
      conv.includes('class="notice info"'),conv);
    check("a deadline-bound solve at a "+(g*100).toFixed(1)+"% gap does offer the budget as a lever",
      at(g,true).includes("larger budget may find a better plan"),at(g,true));
  });
  check("a wide gap that the clock caused escalates to a warning",
    at(0.38,true).includes("notice warn"),at(0.38,true));
  check("every quoted gap explains that line-splitting puts part of it out of reach",
    [0.004,0.38].every(g=>[true,false].every(d=>at(g,d).includes("split its time across several jobs"))),
    "both bands, both stop reasons");
  check("a result predating the stop-reason field is not read as having hit the deadline",
    optimalityNotice({feasible:true,objective:81,bound:100,tol:0,capped:true}).includes("budget to spare"),
    "deadlineReached absent");

  const noBound=optimalityNotice({feasible:true,objective:100,bound:null,tol:0,capped:true});
  check("a result with no bound falls back to the unquantified notice",
    !noBound.includes("%")&&noBound.includes("did not finish an exhaustive proof"),noBound);
  const margin=optimalityNotice({feasible:true,objective:100,bound:null,tol:0.05,capped:true});
  check("a margin solve explains why no bound is available rather than going silent",
    margin.includes("margin is set"),margin);
  const infeasible=optimalityNotice({feasible:false,objective:0,bound:null,tol:0,capped:true});
  check("an infeasible result never divides by a ceiling",
    !infeasible.includes("%")&&!infeasible.includes("NaN"),infeasible);

  return fail;
})()
`;

const failures = eval(src + "\n" + runner) + eval(noticeSrc + "\n" + noticeRunner);
console.log("");
console.log(failures ? (failures + " optimality-gap test(s) failed") : "all optimality-gap tests passed");
process.exit(failures ? 1 : 0);
