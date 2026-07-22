"use strict";
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
    const r=optimize(); return {dom:dom(r), z:r.phases[0].z, eta:r.eta, stab:!!r.phases[0].stabilized,
      feasible:r.feasible, phases:r.phases.length}; }

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
  rec("held plan keeps throughput within HYST_FRAC", stable.z>=free.z*(1-HYST_FRAC)-1e-9,
    "stableZ="+stable.z.toFixed(6)+" freeZ="+free.z.toFixed(6)+" ratio="+(stable.z/free.z).toFixed(6));

  // 4) no lock-in: a 100x demand change must re-optimize, not stay pinned to the old plan.
  resetLineStability(); run(LINES,200); const big=run(LINES,20000);
  rec("large change re-optimizes (not stuck)", JSON.stringify(big.dom)!==baseStr && big.feasible && isFinite(big.eta) && big.eta>0,
    "changed="+(JSON.stringify(big.dom)!==baseStr)+" feasible="+big.feasible);

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
eval(coreSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
