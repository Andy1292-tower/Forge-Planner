"use strict";
/* Property test for solveCore's delta evaluation (WS1.3 of docs/SOLVER_PERF_DESIGN.md).
 *
 * The local search used to measure every candidate by rebuilding produced/consumed from the base
 * supply over all N lines. It now applies one line's job change in place and undoes it, which is the
 * whole speedup and also the whole risk: a probe that does not undo itself exactly corrupts the
 * incumbent that every later probe is compared against, and it does so silently — the plan stays
 * plausible, the objective just quietly stops being the best one found.
 *
 * The three properties, on the real corpus factories rather than on toy numbers, because the numbers
 * are the point: the reference save runs a Hydracite budget of 5.31e12/s beside a Vespium budget of
 * 1e99/min, so one ulp on those rows is ~1e-3 and ~1e83 against a -1e-7 absolute feasibility
 * epsilon. Any check written as an absolute difference passes there by accident.
 *
 *   (a) REVERT IS EXACT. After revertMove the two vectors are bit-identical to their pre-move state,
 *       asserted with Object.is per element — no tolerance, because restoring saved doubles either
 *       lands on the same double or the implementation is doing inverse arithmetic.
 *
 *   (b) APPLY AGREES WITH A FULL RE-EVALUATION, per resource and RELATIVELY. A delta and a re-sum
 *       are different summation orders of the same terms, so they differ in the last bits; what must
 *       not happen is a term going missing or landing on the wrong row.
 *
 *   (c) THE VERDICTS AGREE. feasibleNow, totalDeficit and scoreNow decide the search through four
 *       comparisons (feasibility, the repair break, the deficit tie-break and the climb's strict
 *       improvement). Over a million randomized probes per fixture, the answer the delta state gives
 *       must equal the answer the re-summed state gives, and the maintained infeasible-resource
 *       count must equal a full scan after every apply and every revert.
 *
 * Usage: node test/delta-eval.cjs
 */

const vm = require("vm");
const { FIXTURES, materialize } = require("./perf/corpus.cjs");
const { createSolverContext } = require("./perf/harness.cjs");

// Probes per fixture, split evenly across that fixture's target sets. A million each is what makes a
// one-in-a-hundred-thousand disagreement — the rate a rounding bug on one resource row would
// actually show up at — something this test sees rather than something it happens to miss.
const PROBES = 1_000_000;

/* Agreement budget for one resource row, as a fraction of the magnitude that row's terms sum
 * THROUGH — not of what they sum to. A delta and a re-sum are different orderings of the same
 * additions, so they differ by a few units in the last place of the largest term; on the mined rows
 * that largest term is 5.31e12 beside craft rates of 1e-3, so the two orderings genuinely disagree
 * at ~1e-4 absolute there and both answers are equally right. 1e-13 of the row's term magnitude is
 * two orders above that floating-point floor and twelve below any term that could go missing or
 * land on the wrong row, which is the failure this is looking for. */
const REL_TOL = 1e-13;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}

/* Runs inside the solver realm. Everything below has to happen there: the arrays under test are
 * closure state of one solveCore call, reachable only through the opts.onDeltaProbe seam, and the
 * comparison has to see the same doubles the solver sees rather than a marshalled copy. */
const PROBE_SRC = `
(function(probes, relTol){
  // The fixture's own outputs where it has them, and then one dedicated run per mined craft. The
  // mined rows are where the arithmetic is hostile — an independent budget with no margin allowed,
  // at magnitudes where a full re-sum is itself only accurate to ~1e-3 — so the multi-output chain
  // alone would not exercise the case this test exists for.
  const sets=[];
  const own=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
  if(own.length)sets.push(own);
  Object.keys(MINED_CRAFTS).forEach(P=>{if(PRODUCTS.includes(P))sets.push([P]);});
  if(!sets.length)sets.push([PRODUCTS[PRODUCTS.length-1]]);
  const perSet=Math.ceil(probes/sets.length);
  // Both sides of needFrac: mined rows never take the margin, craftable rows do, and the strict
  // pass the margin search runs first sets it to zero.
  const TOLS=[0,0.05,0.2];

  const runSet=targets=>{
  const rc=relevantChain(targets);
  const report={targets:targets.join("+"),N:0,R:0,probes:0,
    revertDrift:0,applyMismatch:0,worstRel:0,verdictMismatch:0,countMismatch:0,moved:0,error:null};

  // xorshift32, seeded like the solver's own: the probe stream has to be reproducible so a failure
  // is reproducible, and it must not consume the solver's rng.
  let seed=0x9e3779b9>>>0;
  const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;seed>>>=0;return seed/4294967296;};

  const probe=api=>{
    const {N,R,produced,consumed,lineJobs,evalChoice,beginMove,applyMove,revertMove,
      feasibleNow,totalDeficit,scoreNow,infeasibleCountNow,maintainedInfeasibleCount,setCurTol,flat}=api;
    report.N=N;report.R=R;
    if(N===0||R===0)return;
    const beforeP=new Float64Array(R),beforeC=new Float64Array(R);
    const afterP=new Float64Array(R),afterC=new Float64Array(R);
    const absP=new Float64Array(R),absC=new Float64Array(R);
    const ch=new Array(N);
    for(let i=0;i<N;i++)ch[i]=(rnd()*lineJobs[i].length)|0;
    evalChoice(ch);

    /* The magnitude a row's sum passes THROUGH, which is what its floating-point accuracy is
     * actually bounded by — taken over both plans, because the delta reaches the new plan by way of
     * the old one's total and inherits its size. Two cases make that total dwarf the result: a
     * mined row where one budget is 5.31e12/s beside craft rates of 1e-3, and any row where one
     * line at a high compression consumes thousands of a material the rest of the factory consumes
     * tens of. Neither row holds information below eps times that total however it is summed, so a
     * delta and a re-sum may legitimately differ there. A term that went MISSING, or landed on the
     * wrong row, is orders larger than this and is caught. */
    const magnitudes=(a,b)=>{
      for(let r=0;r<R;r++){absP[r]=Math.abs(flat.baseArr[r]);absC[r]=0;}
      const add=plan=>{
        for(let i=0;i<N;i++){const slot=flat.jobBase[i]+plan[i];
          for(let p=flat.prodOff[slot],e=flat.prodOff[slot+1];p<e;p++)absP[flat.prodR[p]]+=Math.abs(flat.prodC[p]);
          for(let c=flat.consOff[slot],e=flat.consOff[slot+1];c<e;c++)absC[flat.consR[c]]+=Math.abs(flat.consC[c]);}
      };
      add(a);add(b);
    };

    const sameBits=(a,b,n)=>{for(let r=0;r<n;r++)if(!Object.is(a[r],b[r]))return r;return -1;};
    const agrees=(a,b)=>{
      if(Object.is(a,b))return 0;
      const scale=Math.max(Math.abs(a),Math.abs(b));
      if(!(scale>0))return Infinity;
      return Math.abs(a-b)/scale;
    };
    const countOk=()=>maintainedInfeasibleCount===undefined
      ?true:maintainedInfeasibleCount()===infeasibleCountNow();

    const tolStep=Math.max(1,Math.floor(perSet/TOLS.length));
    for(let t=0;t<perSet;t++){
      if(t%tolStep===0&&t/tolStep<TOLS.length)setCurTol(TOLS[t/tolStep]);
      const i=(rnd()*N)|0,oldK=ch[i],newK=(rnd()*lineJobs[i].length)|0;
      // The pre-move state, and the four decisions the search makes off it.
      beforeP.set(produced);beforeC.set(consumed);
      const wasFeasible=feasibleNow(),wasD=totalDeficit(),wasScore=scoreNow();
      if(!countOk())report.countMismatch++;

      beginMove();applyMove(i,oldK,newK);
      report.probes++;
      const gotFeasible=feasibleNow(),gotD=totalDeficit(),gotScore=scoreNow();
      if(!countOk())report.countMismatch++;
      afterP.set(produced);afterC.set(consumed);
      revertMove();

      // (a) revert restores the exact doubles, or the vectors have drifted under a rejected probe.
      if(sameBits(beforeP,produced,R)>=0||sameBits(beforeC,consumed,R)>=0)report.revertDrift++;
      if(!countOk())report.countMismatch++;

      if(oldK===newK)continue;
      report.moved++;

      // (b)/(c) the same plan, re-summed from the base supply over every line.
      const ref=ch.slice();ref[i]=newK;
      evalChoice(ref);
      // The relative screen is cheap and clears the overwhelming majority of probes; only the ones
      // that disagree by more than a couple of ulps of their own value pay for the magnitude walk.
      let suspect=false;
      for(let r=0;r<R;r++){
        const dp=agrees(afterP[r],produced[r]),dc=agrees(afterC[r],consumed[r]);
        const worst=dp>dc?dp:dc;
        if(worst>report.worstRel)report.worstRel=worst;
        if(worst>1e-14)suspect=true;
      }
      if(suspect){
        magnitudes(ch,ref);
        for(let r=0;r<R;r++){
          if(Math.abs(afterP[r]-produced[r])>relTol*absP[r])report.applyMismatch++;
          else if(Math.abs(afterC[r]-consumed[r])>relTol*absC[r])report.applyMismatch++;
        }
      }
      const refFeasible=feasibleNow(),refD=totalDeficit(),refScore=scoreNow();
      if(gotFeasible!==refFeasible)report.verdictMismatch++;
      if((gotD<=1e-7)!==(refD<=1e-7))report.verdictMismatch++;
      if((gotD<wasD-1e-9)!==(refD<wasD-1e-9))report.verdictMismatch++;
      if((gotScore>wasScore+1e-9)!==(refScore>wasScore+1e-9))report.verdictMismatch++;
      if(!countOk())report.countMismatch++;

      // Walk on from the probed plan half the time, so the vectors are exercised deep into an
      // incremental chain and not only one move away from a fresh full evaluation.
      if(rnd()<0.5){ch[i]=newK;}
      evalChoice(ch);
    }
  };

  try{
    // workLimit 0 stops the search at its first checkpoint; the seam fires before any of them, so
    // this pays for the solve's setup and nothing else.
    solveCore(targets,targets.map(()=>1),rc.prods,rc.raws,1000,
      {now:()=>0,workLimit:0,onDeltaProbe:probe});
  }catch(error){report.error=String(error&&error.stack||error);}
  return report;
  };

  return JSON.stringify(sets.map(runSet));
})(__deltaProbes, __deltaRelTol)
`;

const started = Date.now();
for (const fixture of FIXTURES) {
  const realm = createSolverContext();
  realm.resetRun({ virtual: false, watchCheckpoints: false });
  realm.loadState(materialize(fixture));
  realm.context.__deltaProbes = PROBES;
  realm.context.__deltaRelTol = REL_TOL;
  const reports = JSON.parse(vm.runInContext(PROBE_SRC, realm.context, { filename: "delta-eval-probe" }));
  for (const report of reports) {
    const where = fixture.id + " (" + report.targets + ", N=" + report.N + " R=" + report.R + ")";
    if (report.error) {
      check("delta evaluation runs on " + where, false, report.error.split("\n")[0]);
      continue;
    }
    check("revert restores the exact pre-move doubles on " + where,
      report.revertDrift === 0 && report.probes > 0,
      report.probes + " probes, " + report.revertDrift + " drifted");
    check("apply agrees with a full re-evaluation per resource on " + where,
      report.applyMismatch === 0,
      report.moved + " moves, " + report.applyMismatch + " over " + REL_TOL +
        ", worst relative " + report.worstRel.toExponential(2));
    check("feasibility, deficit and score verdicts agree on " + where,
      report.verdictMismatch === 0,
      report.moved + " moves compared, " + report.verdictMismatch + " disagreed");
    check("the maintained infeasible count matches a full scan on " + where,
      report.countMismatch === 0,
      report.countMismatch + " mismatches");
  }
}

console.log("\n" + (failures ? failures + " delta-eval check(s) failed" : "delta evaluation holds on every corpus fixture") +
  " (" + ((Date.now() - started) / 1000).toFixed(1) + "s)");
process.exitCode = failures ? 1 : 0;
