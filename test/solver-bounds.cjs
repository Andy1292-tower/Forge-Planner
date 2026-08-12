"use strict";
/* The solver's upper bounds, checked against what it actually achieves (WS4.2/WS4.3 of
 * docs/SOLVER_PERF_DESIGN.md).
 *
 * A bound is the one number in a solve result that is a CLAIM rather than a measurement: the plan is
 * whatever the search found, but `bound` asserts that nothing better exists. A bound that sits below
 * an achieved objective is not a loose bound, it is a false statement, and it fails silently — the
 * interface clamps the two together (`Math.max(scaled, objective)` in optimizeInner) before a reader
 * ever sees them, so the only place the claim can be checked is on the raw solveCore result.
 *
 * Checked on the real corpus factories rather than on toy numbers, because the arithmetic is the
 * point: the reference save carries a Hydracite budget of 5.31e12/s beside a Vespium budget of
 * 1e99/min, and those rows are in the tableau.
 *
 *   (a) THE LP CEILING BOUNDS THE PLAN, at every margin. Asserted at zero tolerance: `bound` is
 *       either null or at least the score of the plan returned beside it.
 *
 *   (b) A MARGIN SOLVE QUOTES ONE. The relaxation rebuilt over needFrac is the may-work problem's
 *       own, so the tolerance the caller asked for no longer costs the result its ceiling.
 *
 *   (c) A MARGIN CEILING IS THE HIGHER ONE. The margin admits every strictly feasible plan and more,
 *       so its optimum cannot be lower — a margin bound below the strict bound of the same factory
 *       means the relaxation lost a constraint rather than relaxed one.
 *
 *   (d) THE CEILING SURVIVES A LONGER SEARCH. A bound a bigger budget walks past was never a bound.
 *
 *   (e) THE DFS BOUNDS DOMINATE THEIR PREFIX, over randomized complete assignments: for a feasible
 *       plan, no prefix of it may be given a ceiling below what the whole plan achieves. Both the
 *       standing suffix-production bound and the dual-priced one are held to it.
 *
 *   (f) THE DUAL-PRICED BOUND CHANGES NO ANSWER. Enabled and disabled, the same fixture returns the
 *       same optimum: a prune that removes a subtree containing the optimum is the failure mode, and
 *       it looks exactly like a search that got unlucky.
 *
 * Usage: node test/solver-bounds.cjs
 */

const vm = require("vm");
const { FIXTURES, materialize } = require("./perf/corpus.cjs");
const { createSolverContext } = require("./perf/harness.cjs");

// Margins to solve at. 0 is the strict problem, 5 the app's own suggested margin, 20 the top of the
// persisted range — the widest relaxation the schema can produce.
const TOLS = [0, 0.05, 0.2];
// Virtual milliseconds per solve. The bound is a property of the factory, not of the search, so the
// short budget costs the assertions nothing; (d) is what covers the budget dimension.
const SHORT_MS = 600, LONG_MS = 2000;
// Complete plans sampled per fixture, target set and margin in (e); each contributes N+1 prefixes.
const PREFIX_PLANS = 1500;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}
const round = value => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value);

/* Runs inside the solver realm: solveCore's raw result never leaves it through optimize(), and the
 * DFS bound machinery is closure state reachable only through the opts.onBoundProbe seam. */
const PROBE_SRC = `
(function(tols, shortMs, longMs, prefixPlans){
  const own=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
  const sets=[];
  if(own.length)sets.push(own);
  // One dedicated mined-craft run beside the fixture's own mix: Gel against a 1e99/min Vespium
  // budget is where a row's terms span eighty orders, and a bound built by summing them is where
  // that would show.
  Object.keys(MINED_CRAFTS).forEach(P=>{if(PRODUCTS.includes(P)&&sets.length<2)sets.push([P]);});
  if(!sets.length)sets.push([PRODUCTS[PRODUCTS.length-1]]);

  const run=(targets,tol,budget,extra)=>{
    const rc=relevantChain(targets);
    const opts={tolOverride:tol};
    if(extra)Object.keys(extra).forEach(k=>{opts[k]=extra[k];});
    const sr=solveCore(targets,targets.map(()=>1),rc.prods,rc.raws,budget,opts);
    return {tol,budget,score:sr.best.score,bound:sr.bound,feasible:sr.feasible,capped:sr.capped};
  };

  const out=[];
  sets.forEach(targets=>{
    const label=targets.join("+");
    const rows=tols.map(tol=>run(targets,tol,shortMs));
    const longer=tols.map(tol=>run(targets,tol,longMs));
    out.push({kind:"lp",targets:label,rows,longer});

    /* (e) Prefix bounds against a completed plan. Every prefix of a feasible assignment must be
     * given a ceiling at least the score that assignment reaches — the DFS prunes a prefix whose
     * ceiling is no better than the incumbent, so a ceiling that undercuts an achievable score is a
     * prune that discards the optimum. Both bounds are read at the same prefix through the seam. */
    tols.forEach(tol=>{
      const rc=relevantChain(targets);
      const report={kind:"prefix",targets:label,tol,plans:0,feasible:0,depths:0,
        suffixLow:0,dualLow:0,dualReady:false,worstSuffix:Infinity,worstDual:Infinity,error:null};
      const probe=api=>{
        const {N,lineJobs,evalChoice,feasibleNow,scoreNow,prefixBound,dualReady}=api;
        if(N===0)return;
        report.dualReady=!!dualReady();
        let seed=0x85ebca6b>>>0;
        const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;seed>>>=0;return seed/4294967296;};
        const ch=new Array(N);
        for(let t=0;t<prefixPlans;t++){
          for(let i=0;i<N;i++)ch[i]=(rnd()*lineJobs[i].length)|0;
          evalChoice(ch);
          report.plans++;
          if(!feasibleNow())continue;
          const sc=scoreNow();
          if(!(sc>0))continue;
          report.feasible++;
          for(let i=0;i<=N;i++){
            const at=prefixBound(ch,i);
            report.depths++;
            // A ceiling equal to the score is fine; the DFS prunes on <=, so only a ceiling BELOW
            // an achievable score can lose it. Slack is relative: these are per-second rates whose
            // rows sum through 1e12.
            const slack=1e-9*Math.max(1,Math.abs(sc));
            if(at.suffix<sc-slack)report.suffixLow++;
            if(at.suffix-sc<report.worstSuffix)report.worstSuffix=at.suffix-sc;
            if(at.dual!==null){
              if(at.dual<sc-slack)report.dualLow++;
              if(at.dual-sc<report.worstDual)report.worstDual=at.dual-sc;
            }
          }
        }
      };
      try{
        // The seam fires before the root LP, so a work limit a little above what pricing itself
        // charges (a handful of checkpoints) buys the prices and then stops the search in the LP's
        // coefficient loop — this pays for the bounds under test and for nothing else.
        solveCore(targets,targets.map(()=>1),rc.prods,rc.raws,shortMs,
          {tolOverride:tol,now:()=>0,workLimit:400,onBoundProbe:probe});
      }catch(error){report.error=String(error&&error.stack||error);}
      if(!Number.isFinite(report.worstSuffix))report.worstSuffix=null;
      if(!Number.isFinite(report.worstDual))report.worstDual=null;
      out.push(report);
    });

    /* (f) Equivalence. The dual prune may only remove subtrees that cannot beat the incumbent, so
     * the optimum it returns must be the optimum it returns without it. */
    tols.forEach(tol=>{
      const off=run(targets,tol,shortMs,{dfsDualBound:false});
      const on=run(targets,tol,shortMs,{dfsDualBound:true});
      out.push({kind:"equiv",targets:label,tol,off:off.score,on:on.score,
        offCapped:off.capped,onCapped:on.capped});
    });
  });
  return JSON.stringify(out);
})(__tols, __shortMs, __longMs, __prefixPlans)
`;

const started = Date.now();
for (const fixture of FIXTURES) {
  const realm = createSolverContext();
  // The virtual clock: a budget bought with work, so what this asserts is reproducible on any
  // machine rather than a function of how much search fitted into a real second.
  realm.resetRun({ virtual: true, watchCheckpoints: true });
  realm.loadState(materialize(fixture));
  realm.context.__tols = TOLS;
  realm.context.__shortMs = SHORT_MS;
  realm.context.__longMs = LONG_MS;
  realm.context.__prefixPlans = PREFIX_PLANS;
  const reports = JSON.parse(vm.runInContext(PROBE_SRC, realm.context, { filename: "bounds-probe" }));

  for (const report of reports) {
    const where = fixture.id + " (" + report.targets + ")";
    if (report.error) {
      check("the bound probe runs on " + where, false, report.error.split("\n")[0]);
      continue;
    }
    if (report.kind === "lp") {
      const below = report.rows.concat(report.longer)
        .filter(row => row.bound !== null && row.bound < row.score);
      check("no LP ceiling sits below the plan it bounds on " + where, below.length === 0,
        report.rows.map(row => "tol " + row.tol + ": " + round(row.score) + " <= " + round(row.bound)).join(", "));
      const quoted = report.rows.filter(row => row.tol > 0 && row.bound !== null).length;
      check("a margin solve quotes a ceiling of its own on " + where,
        quoted === report.rows.filter(row => row.tol > 0).length,
        quoted + " of " + report.rows.filter(row => row.tol > 0).length + " margin rows bounded");
      const strict = report.rows.find(row => row.tol === 0);
      const notAbove = report.rows.filter(row =>
        row.tol > 0 && row.bound !== null && strict && strict.bound !== null &&
        row.bound < strict.bound * (1 - 1e-9));
      check("every margin ceiling sits at or above the strict one on " + where, notAbove.length === 0,
        report.rows.map(row => row.tol + ":" + round(row.bound)).join(" "));
      const passed = report.longer.filter(row => {
        const short = report.rows.find(item => item.tol === row.tol);
        return short && short.bound !== null && row.score > short.bound * (1 + 1e-9);
      });
      check("a longer search never passes the short search's ceiling on " + where, passed.length === 0,
        report.longer.map(row => row.tol + ":" + round(row.score)).join(" "));
      continue;
    }
    if (report.kind === "prefix") {
      const at = where + " at tol " + report.tol;
      check("every prefix ceiling covers the plan that completes it on " + at,
        report.suffixLow === 0 && report.depths > 0,
        report.feasible + " feasible of " + report.plans + " plans, " + report.depths + " prefixes, " +
          report.suffixLow + " undercut" + (report.worstSuffix === null ? "" : ", tightest " + report.worstSuffix.toExponential(2)));
      check("every dual-priced prefix ceiling covers the plan that completes it on " + at,
        report.dualLow === 0,
        (report.dualReady ? "priced" : "no prices") + ", " + report.dualLow + " undercut" +
          (report.worstDual === null ? "" : ", tightest " + report.worstDual.toExponential(2)));
      continue;
    }
    check("the dual-priced prune returns the same optimum on " + where + " at tol " + report.tol,
      Math.abs(report.on - report.off) <= 1e-9 * Math.max(1, Math.abs(report.off)),
      "off=" + round(report.off) + " on=" + round(report.on) +
        " capped " + report.offCapped + "/" + report.onCapped);
  }
}

console.log("\n" + (failures ? failures + " solver-bound check(s) failed" : "every solver bound holds on every corpus fixture") +
  " (" + ((Date.now() - started) / 1000).toFixed(1) + "s)");
process.exitCode = failures ? 1 : 0;
