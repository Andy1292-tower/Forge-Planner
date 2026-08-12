"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Line-assignment stability / hysteresis test (Node) — issue #87 item 5.
 *
 * The project-mode makespan LP is rebuilt from scratch each solve, and LP optima are frequently
 * near-tied at the margin, so an unrelated edit could flip which physical line runs which recipe for
 * negligible benefit. projectSchedule() now keeps the previous solve's per-line jobs unless a free
 * re-solve beats a pinned re-solve by more than HYST_FRAC of throughput (_lineStability cache).
 *
 * Verifies:
 *  - determinism: with the cache cleared, the same state always yields the same assignment;
 *  - churn suppression: a tiny line-speed edit that would flip two lines under a free solve is held
 *    stable, at effectively identical throughput (the reported symptom);
 *  - the guarantee: a held plan never sacrifices more than HYST_FRAC of throughput;
 *  - no lock-in: a large demand change still re-optimizes (doesn't get stuck on the old plan);
 *  - worker-safety: the cache still works after a JSON round-trip (it crosses to the solve worker
 *    and back as plain data every solve — see solver.worker.js / results.js);
 *  - multi-phase: a sequenced two-project plan stays feasible when re-solved under stability.
 *
 * Usage: node test/stability.cjs
 */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const projectSrc = fs.readFileSync(path.join(__dirname, "..", "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");

const runner = `
(function(){
  const LINES=[
    {max:512,spx:50.0,turbo:0},{max:512,spx:49.5,turbo:0},
    {max:256,spx:48.0,turbo:0},{max:256,spx:47.0,turbo:0},{max:128,spx:46.0,turbo:0}];
  function base(lines){ const s=defaults(); s.dupe=0; s.margin=0; s.mode="project"; s.projectSeq=false;
    s.projectGate=false; s.lines=JSON.parse(JSON.stringify(lines)); return s; }
  function proj(frames){ return [
    {id:"a",name:"P",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Frames",qty:frames||200},{item:"Bricks",qty:5000},{item:"Glass",qty:4000},{item:"Rods",qty:3000}]}]}]; }
  // dominant (item@lvl) per physical line for phase 0, keyed by line number
  function dom(r){ const ph=r.phases[0]; const m={};
    (ph.plan||[]).forEach(p=>{ const e=(p.entries||[])[0]; m[p.line]= e?(e.item+"@"+e.lvl):"idle"; }); return m; }
  function run(lines,frames){ let s=base(lines); s.projects=proj(frames); normalize(s); syncManual(s); S=s;
    const r=optimize(),p0=r.phases[0]; return {dom:dom(r), z:p0.z, eta:r.eta, stab:!!p0.stabilized,
      feasible:r.feasible, phases:r.phases.length, zFree:p0.zFree, zPin:p0.zPin,
      preConsistent:r.phases.every(p=>{const actual=(plannedPreProducedDemand(p).Bits||0),reserved=(p.preProducedDemand&&p.preProducedDemand.Bits)||0,
        solvedWith=(p.preProducedSolveDemand&&p.preProducedSolveDemand.Bits)||0,tol=1e-8+Number.EPSILON*32*Math.max(1,actual,reserved,solvedWith);
        return p.preProducedConverged===true&&Math.abs(actual-reserved)<=tol&&Math.abs(actual-solvedWith)<=tol;}),
      scheduleFailure:r.scheduleValidation&&r.scheduleValidation.firstFailure}; }

  const results=[]; const rec=(name,pass,detail)=>results.push({name,pass,detail});

  // 1) determinism with a cleared cache — free solves are reproducible
  resetLineStability(); const d1=run(LINES,200);
  resetLineStability(); const d2=run(LINES,200);
  rec("cleared cache -> deterministic free solve", JSON.stringify(d1.dom)===JSON.stringify(d2.dom),
    JSON.stringify(d1.dom));
  const baseStr=JSON.stringify(d1.dom);

  // 2 & 3) line-swap churn: bump line1 speed by +0.6 — free flips lines 1<->2, stability holds it.
  const bumped=JSON.parse(JSON.stringify(LINES)); bumped[1].spx+=0.6;
  resetLineStability(); const free=run(bumped,200);                       // fresh cache => free optimum
  resetLineStability(); run(LINES,200); const stable=run(bumped,200);     // seed baseline, then perturbed
  rec("free solve flips two lines on tiny speed edit", JSON.stringify(free.dom)!==baseStr,
    "free="+JSON.stringify(free.dom));
  rec("stability holds the prior assignment", JSON.stringify(stable.dom)===baseStr && stable.stab===true,
    "stable="+JSON.stringify(stable.dom)+" stabilized="+stable.stab);
  rec("stabilized plan reserves the exact Bits obligation it solved with",stable.preConsistent,
    "consistent="+stable.preConsistent);
  rec("held plan keeps throughput within HYST_FRAC", stable.z>=free.z*(1-HYST_FRAC)-1e-9,
    "stableZ="+stable.z.toFixed(6)+" freeZ="+free.z.toFixed(6)+" ratio="+(stable.z/free.z).toFixed(6));

  // 4) no lock-in: a 100x demand change must re-optimize AND actually release the pin (not just shift
  //    the dominant job within a stabilized set) — assert big.stab===false, not only that dom changed.
  resetLineStability(); run(LINES,200); const big=run(LINES,20000);
  rec("large change re-optimizes and releases the pin", JSON.stringify(big.dom)!==baseStr && big.stab===false && big.feasible && isFinite(big.eta) && big.eta>0,
    "changed="+(JSON.stringify(big.dom)!==baseStr)+" released="+(big.stab===false)+" feasible="+big.feasible+" failure="+JSON.stringify(big.scheduleFailure));

  // 4a) HYST_FRAC band — MUST HOLD: a Frames-demand bump whose pinned re-solve costs a *strict, sub-5%*
  //     amount of throughput is kept stable. This pins the band's lower edge: shrink HYST_FRAC below the
  //     gap and this flips to a release, failing the test (the ratio==1 swap case can't catch that).
  resetLineStability(); run(LINES,200); const hold=run(LINES,420);
  { const gap=hold.zFree>0?(1-hold.zPin/hold.zFree):0;
    rec("HYST band: sub-band cost is HELD", hold.stab===true && gap>0.001 && gap<HYST_FRAC,
      "held="+hold.stab+" pinGap="+(gap*100).toFixed(2)+"% (< "+(HYST_FRAC*100)+"%)"); }

  // 4b) HYST_FRAC band — MUST RELEASE: a bigger bump whose pinned re-solve costs *more* than the band is
  //     rejected in favour of the free optimum. This pins the upper edge: grow HYST_FRAC past the gap and
  //     this flips to a hold, failing the test.
  resetLineStability(); run(LINES,200); const rel=run(LINES,500);
  { const gap=rel.zFree>0?(1-rel.zPin/rel.zFree):0;
    rec("HYST band: past-band cost is RELEASED", rel.stab===false && rel.zPin!=null && gap>HYST_FRAC,
      "released="+(rel.stab===false)+" pinGap="+(gap*100).toFixed(2)+"% (> "+(HYST_FRAC*100)+"%)"); }

  // 5) worker-safety: cache still pins after a JSON round-trip (the real worker path serializes it).
  resetLineStability(); run(LINES,200);
  const roundTripped=JSON.parse(JSON.stringify(getLineStability()));
  resetLineStability(); setLineStability(roundTripped);
  const stableRT=run(bumped,200);
  rec("cache survives JSON round-trip (worker-safe)", JSON.stringify(stableRT.dom)===baseStr,
    "afterRoundTrip="+JSON.stringify(stableRT.dom));

  // 6) multi-phase sequenced plan stays feasible when re-solved under stability.
  function seqState(qA){ const s=defaults(); s.dupe=0; s.margin=0; s.mode="project"; s.projectSeq=true;
    s.lines=JSON.parse(JSON.stringify(LINES));
    s.projects=[
      {id:"x",name:"Alpha",catId:"",on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:"Bricks",qty:qA||3000},{item:"Glass",qty:1500}]}]},
      {id:"y",name:"Beta",catId:"",on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:"Rods",qty:2500},{item:"Plates",qty:2000}]}]}];
    normalize(s); syncManual(s); return s; }
  resetLineStability(); S=seqState(3000); const s1=optimize();
  S=seqState(3200); const s2=optimize();   // small perturbation, stability engaged for both phases
  rec("multi-phase: both phases present and feasible under stability",
    s1.phases.length===2 && s2.phases.length===2 && s2.phases.every(p=>p.feasible) && isFinite(s2.eta) && s2.eta>0,
    "phases="+s2.phases.length+" feasible="+s2.phases.map(p=>p.feasible).join(",")+" eta="+s2.eta.toFixed(4));

  // 7) cache eviction: seed the cache full (256 synthetic keys), do one real solve, and confirm it
  //    doesn't grow past the cap and drops the OLDEST key (k0) while keeping newer ones (k1).
  resetLineStability();
  const seed={}; for(let i=0;i<256;i++)seed["k"+i]={};
  setLineStability(seed);
  run(LINES,200);                                   // writes one fresh real key -> triggers eviction
  { const keys=Object.keys(getLineStability());
    rec("cache evicts the oldest key past the 256 cap",
      keys.length<=256 && !keys.includes("k0") && keys.includes("k1"),
      "size="+keys.length+" k0_evicted="+(!keys.includes("k0"))+" k1_kept="+keys.includes("k1")); }

  // 8) cache-key collision fix (issue #87 review): two sequenced projects with the SAME display name
  //    must key on their own project id, not the shared name — so phase B is NOT cross-pinned to A on
  //    its first solve. Pre-fix this produced ONE shared cache slot and phase B came back stabilized.
  function twoProj(){ const s=defaults(); s.dupe=0; s.margin=0; s.mode="project"; s.projectSeq=true;
    s.lines=JSON.parse(JSON.stringify(LINES));
    s.projects=[
      {id:"p1",name:"New project",catId:"",on:true,from:1,to:1,done:0,prio:1,levels:[{costs:[{item:"Frames",qty:100},{item:"Bricks",qty:4000}]}]},
      {id:"p2",name:"New project",catId:"",on:true,from:1,to:1,done:0,prio:2,levels:[{costs:[{item:"Frames",qty:4000},{item:"Bricks",qty:100}]}]}];
    normalize(s); syncManual(s); return s; }
  resetLineStability(); S=twoProj(); const col=optimize();
  rec("same-named projects don't share a cache slot (keyed by id)",
    Object.keys(getLineStability()).length===2 && col.phases[1] && col.phases[1].stabilized===false,
    "keys="+Object.keys(getLineStability()).length+" phaseB_firstSolveStabilized="+(col.phases[1]&&col.phases[1].stabilized));

  __emit(JSON.stringify(results));
})();
`;

globalThis.__emit = (str) => {
  const results = JSON.parse(str);
  let fail = 0;
  for (const r of results) {
    console.log((r.pass ? "ok   " : "FAIL ") + r.name + "  [" + r.detail + "]");
    if (!r.pass) fail++;
  }
  console.log("\n" + (results.length - fail) + " ok, " + fail + " failed");
  process.exit(fail ? 1 : 0);
};

// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
