"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
// Project demands, stocks and pre-produced obligations are Decimals: compare them by value.
const qtyEq = (got, want) => got !== null && got !== undefined && new Decimal(String(got)).eq(want);
/* Sequenced / gated project-plan regression tests (Node).
 *
 * Covers the bugs that only show up once a project plan has MORE THAN ONE phase, which is why the
 * single-phase parity matrix never caught them:
 *
 *   H1  consumeInv ignored the Bits that Frames/Wire burn pre-produced, so phase 2 re-netted
 *       against Bits stock phase 1 had already spent.
 *   H2  a project fully covered by inventory reported "blocked" and, costing Infinity, sorted LAST.
 *   M1  a "set & forget" phase's overshoot was thrown away instead of carried to the next phase.
 *   M2  static ranking used an LP that models stock drawdown the static phases never perform.
 *   M3  a phase blocked on a missing mined income reported feasible and ranked by its leftovers.
 *   L1  a static multi-phase plan budgeted max-solve-time PER PHASE, so the whole solve ran N times
 *       longer than the user asked for.
 *   M4  the mined-usage note was derived from phase 1's plan only — silent when a later phase
 *       forges the mined craft, and phase-1-scoped when it doesn't.
 *   M5  the order header claimed "all projects together" whenever only one project was left,
 *       regardless of what the Shopping-list toggle actually said.
 *   L2  unlockLayers tested unlock materials against direct costs only, missing Gel -> Wire.
 *   L4  static mode gave no signal that it ignores intermediate stock the user is holding.
 *
 * Single-phase "set & forget" behaviour has its own suite in test/staticmode.cjs; what lives here is
 * the multi-phase side of it — the overshoot carry, the ranking world, and the budget division. The
 * split-mode counterparts are asserted alongside, because the overshoot credit must be a no-op for
 * the makespan LP: that is what keeps the parity golden byte-identical.
 *
 * Bootstrap mirrors parity.cjs / staticmode.cjs: browser globals shimmed, performance.now() frozen
 * to 0 so the anytime solver runs to exhaustion (deterministic), small compression caps to keep that
 * cheap, and core/dom/solver/results eval'd into one scope so the runner sees their top-level
 * bindings. results.js is included because several of these are render-layer fixes; it has no
 * top-level DOM access, so loading it is safe. events.js is NOT loadable (it wires the live DOM at
 * import time), so the per-phase mined note in stepPlanHtml is asserted here at the data level and
 * verified in a real browser instead.
 *
 * Usage: node test/seqgate.cjs
 */
const fs = require("fs");
const path = require("path");

// Frozen by default (so the anytime solver runs to exhaustion and every assertion is deterministic).
// One block at the end swaps in an advancing clock on purpose, to exercise budget exhaustion.
globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
// Element registry, so a test can read back what a renderer wrote into #results.
const _els = {};
globalThis.document = { getElementById: (id) => (_els[id] || (_els[id] = { id, innerHTML: "", textContent: "", hidden: true })) };
// renderProjectResults delegates the phase cards and the inline project controls to events.js.
// Stub them: these tests are about what results.js decides to render AROUND them.
globalThis.stepPlanHtml = () => "<!--steps-->";
globalThis.stepsProjControls = () => "";

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const coreSrc = read("js", "core.js");
const domSrc = read("js", "dom.js");
const projectScheduleSrc = read("js", "project-schedule.js");
const solverSrc = read("js", "solver.js");
const resultsSrc = read("js", "results.js");
/* The budget-exhaustion blocks drive clocks that cost a fixed number of milliseconds per clock
 * READ. The solver samples its clock once per CLOCK_SAMPLE_EVERY checkpoints, which under such a
 * clock stretches every budget by that stride; sample every checkpoint here so those deadlines land
 * where the assertions put them. */
const sampleEverySrc = `makeSolveControl = (function(raw){ return function(budget, options){
  const opts = Object.assign({}, options);
  if (opts.clockSampleEvery === undefined) opts.clockSampleEvery = 1;
  return raw(budget, opts);
}; })(makeSolveControl);`;
// state.js owns the real mutateState/save and pulls in localStorage persistence we don't want here;
// renderProjectResults only needs them to seed the plan-start anchor, so shim the pair in-scope.
const stateShim = `
function mutateState(mutator){return mutator(S);}
function save(){return true;}
`;

const runner = `
(function(){
  // Six modest lines: enough parallelism for a Frames chain (5 distinct jobs) without making the
  // clock-frozen exhaustive search expensive.
  const LINES = [
    {max:4, spx:5.0, turbo:0},
    {max:4, spx:4.5, turbo:0},
    {max:4, spx:4.0, turbo:0},
    {max:2, spx:3.5, turbo:0},
    {max:2, spx:3.0, turbo:0},
    {max:2, spx:2.5, turbo:0},
  ];
  const VESP_BUDGET = 5e21;   // vespium/min — same figure parity.cjs uses

  // One-level project from a list of [item, qty] pairs.
  function P(id, name, costs, prio, catId){
    return {id, name, catId:catId||"", on:true, from:1, to:1, done:0, prio:(prio==null?null:prio),
      levels:[{costs:costs.map(c=>({item:c[0], qty:c[1]}))}]};
  }
  function build(projects, opt){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.lines = JSON.parse(JSON.stringify(LINES));
    s.projects = projects;
    const inv = (opt && opt.inventory) || null, mined = (opt && opt.minedIncome) || null;
    Object.assign(s, opt || {});
    if (inv) s.inventory = Object.assign({}, defaults().inventory, inv);
    s.minedIncome = defaults().minedIncome;
    MINED_RESOURCES.forEach(resource=>{
      if(mined&&mined[resource]&&typeof mined[resource]==="object")
        Object.assign(s.minedIncome[resource],mined[resource]);
    });
    normalize(s); syncManual(s); S = s;
    return s;
  }
  const run = (projects, opt, testOptions) => { build(projects, opt); return optimize(testOptions); };

  const results = [];
  const record = (name, pass, detail) => results.push({name, pass, detail});
  const sum = (a) => a.reduce((x,y)=>x+y, 0);

  /* ---- H1: pre-produced Bits must be charged against carried inventory ----------------------
   * Two 1000-Frames projects, 4000 Bits on hand. Frames burn 8 Bits each outside the recipe graph,
   * so the pair needs 16000 Bits and the stock covers 4000 of them — ONCE. Phase 1 nets 4000, and
   * phase 2 must net the full 8000 because that stock is gone. The bug let phase 2 net 4000 again,
   * so the sequenced plan under-counted Bits by the entire inventory. The combined single phase
   * (which never calls consumeInv) is the ground truth to compare against. */
  {
    const seqRes = run([P("a","F1",[["Frames",1000]],1), P("b","F2",[["Frames",1000]],2)],
                       {inventory:{Bits:4000}});
    const obligations = seqRes.phases.map(ph => (ph.preProducedDemand&&ph.preProducedDemand.Bits)||0);
    const seqSupply = seqRes.executionPhases.filter(ph=>ph.kind==="prerequisite")
      .map(ph=>(ph.externalSupply&&ph.externalSupply.Bits)||0);
    const combined = run([P("a","F1",[["Frames",1000]]), P("b","F2",[["Frames",1000]])],
                         {inventory:{Bits:4000}, projectSeq:false, projectGate:false});
    const combinedSupply = combined.executionPhases.filter(ph=>ph.kind==="prerequisite")
      .reduce((total,ph)=>total+((ph.externalSupply&&ph.externalSupply.Bits)||0),0);
    record("H1: sequenced replay reserves the same total pre-produced Bits as the combined run",
      seqRes.phases.length === 2 && obligations[0] === 8000 && obligations[1] === 8000 &&
      sum(seqSupply) === combinedSupply && combinedSupply === 12000,
      "obligations=" + JSON.stringify(obligations) + " supply=" + JSON.stringify(seqSupply) +
      " combinedSupply=" + combinedSupply);
    const phase2Bits=(seqRes.phases[1].invStart&&seqRes.phases[1].invStart.Bits)||0;
    record("H1: phase 2 cannot re-spend the Bits phase 1 already consumed",
      seqSupply.length === 2 && seqSupply[0] === 4000 && seqSupply[1] === 8000 && phase2Bits === 0 &&
      seqRes.scheduleValidation.ok === true && Math.abs(seqRes.scheduleValidation.finalInventory.Bits||0) <= 1e-8,
      "supply=" + JSON.stringify(seqSupply) + " phase2Start=" + phase2Bits +
      " final=" + (seqRes.scheduleValidation.finalInventory.Bits||0));
  }

  /* ---- H3: a tolerated negative balance is not stock to carry into the next phase ----------
   * A replay accepts a balance dipping below zero while it stays inside stockTol, whose relative
   * term scales with the phase's CUMULATIVE gross throughput rather than with the balance itself —
   * so at late-game quantities the residue it tolerates reaches ~1e-7. A sequenced run hands one
   * phase's final inventory to the next as its starting stock, and there that residue arrives as a
   * real debt: the next phase's prerequisite deficit comes out LARGER than the demand it is
   * measured against, canonicalizePhase refuses the synthesized supply phase (its own tolerance
   * carries no flow term, so it will not accept what the replay just did), the builder is left with
   * no phase to push, and the eta sum read undefined — "Cannot read properties of undefined
   * (reading 'eta')" (issue #154).
   * All three of the reporter's conditions are needed. Line switching balances every resource to LP
   * equality, so the end balance lands on zero and floating error tips it under; Set & forget
   * assigns whole-phase jobs that overshoot and end positive, which is why that mode worked. And
   * only a sequenced multi-phase run carries inventory between builds at all — one combined phase
   * starts from S.inventory, which is never negative.
   * What this pins is the crash, not a particular plan: this factory is blocked in every mode, and
   * being told so is the correct outcome. */
  {
    const H3_LINES = [{max:16,spx:8.7,turbo:0},{max:2,spx:6.8,turbo:0},{max:16,spx:6.9,turbo:0},{max:8,spx:6.1,turbo:0}];
    const H3_PROJECTS = () => [P("p0","P0",[["Glass",645843937]],1),
                               P("p1","P1",[["Frames",1646]],2),
                               P("p2","P2",[["Wire",391359]],3)];
    let split = null, threw = null;
    try {
      split = run(H3_PROJECTS(), {lines:H3_LINES, projLineMode:"split", projectSeq:true,
        projectGate:true, solveBudget:20000, inventory:{Rods:"687155743", Gel:"126907"}});
    } catch (err) { threw = err; }
    record("H3: a sequenced Line-switching plan survives a balance that lands on zero",
      threw === null && !!split,
      threw ? ("threw " + threw.message) : ("eta=" + (split.eta||0).toFixed(3) + "h phases=" + split.phases.length));

    const exec = (split && split.executionPhases) || [];
    record("H3: every phase the builder emitted is a real phase with a finite eta",
      !!split && exec.length > 0 && exec.every(ph => ph && Number.isFinite(Number(ph.eta||0))) &&
      Number.isFinite(Number(split.eta)),
      "exec=" + exec.length + " eta=" + (split ? split.eta : "n/a") +
      " undefinedAt=" + JSON.stringify(exec.map((ph,i)=>ph?null:i).filter(i=>i!==null)));

    const negStarts = exec.map((ph,i) => Object.entries((ph&&ph.invStart)||{})
      .filter(([,v]) => Number(v) < 0).map(([r,v]) => "#"+i+" "+r+"="+v)).reduce((a,b)=>a.concat(b), []);
    record("H3: no phase is handed a negative balance as starting stock",
      !!split && negStarts.length === 0,
      negStarts.length ? negStarts.join(", ") : "all " + exec.length + " phases start at or above zero");
  }

  /* ---- H4: a tolerated negative balance must not MANUFACTURE demand ------------------------
   * The other half of H3. Flooring stock on the way INTO the schedule module does not stop the
   * residue leaving through finalInventory, and the sequenced solver reads that map directly:
   * projNetVec computes sub - inv, so a debt does not merely fail to help, it becomes demand.
   * A -7.45e-9 Concrete balance made the net +7.45e-9 for a project whose Concrete cost is zero,
   * which cleared solvePhaseFor's flat 1e-9 demand floor and made Concrete a phase target. The LP
   * had no net rate left to give a target it was already balancing to equality, so the plan
   * published "Can't sustainably produce: Concrete" against a factory producing 9,076,608/hr of
   * it — and the verdict flipped on a single completed project level, because moving the
   * subtraction by one float ULP is all it takes. */
  {
    const debt = projNetVec({Concrete:0}, {Concrete:-7.450580596923828e-9}, {Bits:0});
    const held = projNetVec({Concrete:100}, {Concrete:40}, {Bits:0});
    record("H4: a negative carried balance is not demand",
      Number(debt.Concrete) === 0 && Number(held.Concrete) === 60,
      "debt=" + String(debt.Concrete) + " (want 0), covered=" + String(held.Concrete) + " (want 60)");
  }

  /* ---- H2: a project inventory already covers is DONE, not blocked -------------------------
   * 100 Bricks wanted against 100k Bricks held: nothing left to craft. That has to read as a free,
   * instant, feasible phase that sorts FIRST — not a red "(blocked — see notes)" costing Infinity
   * and dragging the whole plan's feasible flag down with it. */
  {
    const r = run([P("a","BigGlass",[["Glass",500000]]), P("b","FreeBricks",[["Bricks",100]])],
                  {inventory:{Bricks:100000}});
    const free = r.phases.find(ph => ph.name === "FreeBricks");
    record("H2: an inventory-covered project sorts first, costs nothing, and is feasible",
      r.phases[0].name === "FreeBricks" && free.eta === 0 && free.feasible === true,
      "order=" + r.phases.map(p=>p.name).join(" -> ") + " eta=" + free.eta + " feasible=" + free.feasible);
    record("H2: it does not poison the plan-wide feasibility or the blocked-items list",
      r.feasible === true && (r.infeasItems||[]).length === 0 &&
      Object.keys(r.blockedMined||{}).length === 0 && r.partial !== true,
      "planFeasible=" + r.feasible + " infeas=" + JSON.stringify(r.infeasItems) +
      " blockedMined=" + JSON.stringify(r.blockedMined));
  }

  /* ---- M3: a phase blocked on a missing mined income is blocked ----------------------------
   * No vespium income, so Wire (Gel in its chain) can't be made at all. The phase delivers nothing
   * for Wire, so it must report infeasible and sink to the back of its layer rather than ranking
   * cheap on whatever leftovers it could still craft. */
  {
    const r = run([P("a","WireProj",[["Wire",100]]), P("b","GlassProj",[["Glass",100]])], {});
    const wire = r.phases.find(ph => ph.name === "WireProj");
    const blockers = (wire.blockedMined && wire.blockedMined.Wire) || [];
    record("M3: a phase with items blocked on a missing mined income is not feasible",
      wire.feasible === false && blockers.indexOf("Vespium") >= 0 && (wire.unsat||[]).indexOf("Wire") >= 0,
      "feasible=" + wire.feasible + " blockedMined=" + JSON.stringify(wire.blockedMined));
    record("M3: it sorts last, and the plan as a whole reports blocked",
      r.phases[r.phases.length-1].name === "WireProj" && r.feasible === false,
      "order=" + r.phases.map(p=>p.name).join(" -> ") + " planFeasible=" + r.feasible);
  }

  /* ---- M1: "set & forget" overshoot is carried to the next phase ---------------------------
   * A static phase runs until its slowest item is done, so the 50 Bricks it also owed finish long
   * before the 2000 Glass and that line keeps making Bricks to the end. Those spare Bricks are real
   * — the next project must start with them on hand and need correspondingly fewer. */
  {
    const r = run([P("a","P1",[["Glass",2000],["Bricks",50]],1), P("b","P2",[["Bricks",2000]],2)],
                  {projLineMode:"static"});
    const p2 = r.phases[1];
    const carried = (p2.invStart && p2.invStart.Bricks) || 0;
    record("M1: static surplus is credited into the next phase's starting stock",
      r.phases[0].name === "P1" && carried > 1e-6,
      "carriedBricks=" + carried.toFixed(1) + " p2NetBricks=" + (p2.net.Bricks||0).toFixed(1));
    record("M1: the carried surplus reduces what the next phase has to craft",
      Math.abs((p2.net.Bricks||0) - Math.max(0, 2000 - carried)) <= 1e-6 * 2000,
      "netBricks=" + (p2.net.Bricks||0).toFixed(1) + " expected=" + Math.max(0,2000-carried).toFixed(1));
    // Split mode lands every item on the makespan, so there is no overshoot to carry — the credit
    // must be a no-op there (this is what keeps the parity golden byte-identical).
    const sp = run([P("a","P1",[["Glass",2000],["Bricks",50]],1), P("b","P2",[["Bricks",2000]],2)], {});
    const spCarried = (sp.phases[1].invStart && sp.phases[1].invStart.Bricks) || 0;
    record("M1: split mode has ~no overshoot, so the credit changes nothing there",
      sp.phases.length === 2 && spCarried <= 1e-6 * 2000,
      "splitCarriedBricks=" + spCarried);
  }

  /* ---- M2: static ranking must model the no-stock world the static phases solve -------------
   * 20k Plates against 400k Ingots held vs 7.5k Glass with no stock. The ranking LP is allowed to
   * drain that Ingot stock, which makes Plates look nearly free and jumps it ahead — but a static
   * phase never draws stock down, so it crafts every Ingot from scratch and is genuinely the more
   * expensive of the two. Ranking with the stock omitted puts them back in the true order. */
  {
    const r = run([P("a","Plates",[["Plates",20000]]), P("b","Glass",[["Glass",7500]])],
                  {projLineMode:"static", inventory:{Ingots:400000}});
    record("M2: static ranks by the no-drawdown makespan (cheapest project really goes first)",
      r.phases[0].name === "Glass",
      "order=" + r.phases.map(p=>p.name+"("+p.eta.toFixed(2)+"h)").join(" -> "));
    // Ground truth: solved on its own in static mode, Glass really is the shorter of the two.
    const solo = (proj) => run([proj], {projLineMode:"static", inventory:{Ingots:400000}}).eta;
    const gEta = solo(P("b","Glass",[["Glass",7500]])), pEta = solo(P("a","Plates",[["Plates",20000]]));
    record("M2: ...and that order matches the projects' actual standalone static makespans",
      gEta < pEta, "glassSolo=" + gEta.toFixed(2) + "h platesSolo=" + pEta.toFixed(2) + "h");
  }

  /* ---- L4: Set & forget deliberately keeps sustainable feeders despite held intermediates --
   * Give the phase vastly more Ingots than its Plates recipe can consume. Exact replay is valid,
   * but the one-job assignment still includes an Ingots feeder because staticSchedule does not
   * draw inventory down while choosing jobs. The UI must disclose this only when the solved plan
   * itself proves the held stock could cover that feeder's phase consumption. */
  {
    const HELD=1e9;
    const r=run([P("p","Plates",[["Plates",1000]])],
      {projLineMode:"static",inventory:{Ingots:HELD}});
    const phase=r.phases[0],ingotConsumption=(phase.plan||[]).reduce((total,line)=>total+
      (line.entries||[]).reduce((lineTotal,entry)=>lineTotal+(entry.cons||[])
        .filter(input=>input.item==="Ingots").reduce((sum,input)=>sum+(input.hr||0)*(phase.eta||0),0),0),0);
    const ingotFeeder=(phase.plan||[]).some(line=>(line.entries||[]).some(entry=>entry.item==="Ingots"));
    record("L4: authoritative static plan keeps a feeder even when held intermediate covers its use",
      r.scheduleValidation.ok===true && qtyEq(phase.invStart.Ingots,HELD) && ingotFeeder===true &&
      ingotConsumption>0 && ingotConsumption<HELD,
      "replay="+r.scheduleValidation.ok+" held="+phase.invStart.Ingots+
      " consumed="+ingotConsumption+" feeder="+ingotFeeder);
    const el=document.getElementById("results"),stat=document.getElementById("solveStat");
    renderProjectResults(r,el,stat);
    record("L4: rendered static plan discloses the held-feeder limitation from solved data",
      el.innerHTML.indexOf("Held stock does not remove Set &amp; forget feeder jobs")>=0 &&
      el.innerHTML.indexOf("Ingots")>=0 && el.innerHTML.indexOf("Exact replay still accounts for")>=0,
      "hasNotice="+(el.innerHTML.indexOf("Held stock does not remove Set &amp; forget feeder jobs")>=0));
    const split=run([P("p","Plates",[["Plates",1000]])],{projLineMode:"split",inventory:{Ingots:HELD}});
    renderProjectResults(split,el,stat);
    record("L4: held-feeder notice is scoped to Set & forget",
      el.innerHTML.indexOf("Held stock does not remove Set &amp; forget feeder jobs")<0,
      "splitHasNotice="+(el.innerHTML.indexOf("Held stock does not remove Set &amp; forget feeder jobs")>=0));

    // External pre-produced Bits are injected immediately before replay and then reserved by that
    // same phase. They are not held inventory available to replace a real Bits feeder for Glass.
    const folded=run([P("fg","Frames + Glass",[["Frames",100],["Glass",100]])],
      {projLineMode:"static"});
    const foldedPhase=(folded.executionPhases||[]).find(phase=>phase.kind==="project");
    const foldedHeld=staticHeldFeederItems(folded);
    record("L4: externally injected pre-produced Bits never masquerade as held feeder stock",
      folded.scheduleValidation.ok===true && foldedPhase &&
      ((foldedPhase.preProducedDemand&&foldedPhase.preProducedDemand.Bits)||0)>0 &&
      foldedHeld.indexOf("Bits")<0,
      "replay="+folded.scheduleValidation.ok+" pre="+
      ((foldedPhase&&foldedPhase.preProducedDemand&&foldedPhase.preProducedDemand.Bits)||0)+
      " heldFeeders="+JSON.stringify(foldedHeld));
  }

  /* ---- L1: max-solve-time bounds the WHOLE static solve, not each phase --------------------
   * Static phases share one absolute solve control. A deterministic work limit must stop the whole
   * run once, leave later phases explicitly unevaluated, and never restart a fresh allowance. */
  {
    const waves = run([P("g","GelRef",[["Concrete",10]],null,"gel-refinery"),
                       P("w","WireTower",[["Gel",10]],null,"wire-tower"),
                       P("c","Consumer",[["Wire",10]])],
                      {projLineMode:"static", projectSeq:false, projectGate:true,
                       minedIncome:{Vespium:{resourcesTradingPerSec:VESP_BUDGET/60}}, solveBudget:3000});
    record("L1: normal static waves finish under one root budget",
      waves.phases.length === 3 && waves.staticDeadlineReached === false &&
      waves.allPhasesEvaluated === true && waves.searchExhaustive === true,
      "phases=" + waves.phases.length + " deadline=" + waves.staticDeadlineReached +
      " evaluated=" + waves.allPhasesEvaluated + " exhaustive=" + waves.searchExhaustive);

    const events=[];let clock=0;
    const starved=run(Array.from({length:12},(_,i)=>P("q"+i,"Q"+i,[["Glass",200+i]],i+1)),
      {projLineMode:"static",solveBudget:2000},
      {now:()=>clock+=40,onCheckpoint:event=>events.push(event)});
    const stops=events.filter(event=>event.type==="stopped");
    const elapsed=events.map(event=>event.elapsed||0);
    record("L1: one shared control stops the whole static run without restarting",
      starved.phases.length===12 && starved.staticDeadlineReached === true &&
      starved.allPhasesEvaluated === false && starved.searchExhaustive === false &&
      stops.length === 1 && stops[0].reason === "deadline" &&
      elapsed.every((value,index)=>index===0||value>=elapsed[index-1]) &&
      starved.scheduleValidation.firstFailure && starved.scheduleValidation.firstFailure.kind==="solve-budget" &&
      clock<=2080,
      "deadline=" + starved.staticDeadlineReached + " evaluated=" + starved.allPhasesEvaluated +
      " stops=" + stops.length + " clock=" + clock +
      " failure=" + (starved.scheduleValidation.firstFailure&&starved.scheduleValidation.firstFailure.kind));
  }

  /* ---- L1c: no phase may spend the budget its successors need -----------------------------
   * The static search is anytime: it refines until its clock runs out. Sharing one deadline first
   * come, first served therefore let the FIRST phase soak up the whole allowance, and every phase
   * behind it came back with no assignment at all — a blocked plan rather than a rougher one. The
   * same save then solved or didn't purely on how busy the machine was ("solves about half the
   * time"). Each phase now gets an equal share of what is LEFT, so the run degrades in quality
   * instead of falling over, and a phase that converges early still hands its surplus forward.
   *
   * The clock advances per checkpoint, so the first phase would burn every tick if it could. */
  {
    const BUDGET=6000;
    const projects=[P("a","A",[["Glass",4000]],1),P("b","B",[["Bricks",4000]],2),P("c","C",[["Plates",4000]],3)];
    // Every clock READING costs 8ms, so an unbounded first phase drains the whole allowance: this
    // is the same shape as a real run where phase 1 simply out-searches the clock.
    let clock=0;const spend=[];
    const realSolve=solveExecutableProjectPhase;
    solveExecutableProjectPhase=function(sub,name,inv,policy,key,runOptions){
      const startedAt=clock,phase=realSolve(sub,name,inv,policy,key,runOptions);
      spend.push({name,startedAt,ms:clock-startedAt,deadline:runOptions&&runOptions.staticPhaseDeadline});
      return phase;
    };
    const paced=run(projects,{projLineMode:"static",solveBudget:BUDGET},{now:()=>clock+=8});
    solveExecutableProjectPhase=realSolve;

    record("L1c: every sequenced phase gets a usable assignment out of one shared budget",
      paced.phases.length===3 && paced.allPhasesEvaluated===true &&
      paced.scheduleValidation.ok===true && paced.eta>0,
      "phases=" + paced.phases.length + " evaluated=" + paced.allPhasesEvaluated +
      " replay=" + paced.scheduleValidation.ok + " eta=" + (paced.eta||0).toFixed(3) +
      " failure=" + JSON.stringify(paced.scheduleValidation.firstFailure||null));
    // The fix itself: without slicing the first phase spent all 6000ms and the other two started
    // at the deadline with nothing left, so the whole plan came back blocked.
    record("L1c: no phase spends the budget its successors need",
      spend.length===3 && spend.every(s=>Number.isFinite(s.deadline)) &&
      spend[0].ms<=BUDGET*0.45 && spend.every(s=>s.startedAt<BUDGET),
      "spend=" + spend.map(s=>s.name+":"+s.ms+"ms from "+s.startedAt+" (slice ends "+Math.round(s.deadline)+")").join(", "));
    // The searches still get one budget between them, not one each. Putting the last phase's idle
    // lines to work is allowed to run past it — a stopped control refuses every checkpoint, so a pass
    // funded from the leftovers would never run on the plans that need it — but only on the run's one
    // shared fill allowance, whatever the phase count. Per-phase budgets would show as ~3x here.
    const FILL_ALLOWANCE=Math.max(BUDGET*0.25,1200);
    record("L1c: slicing still hands out only the single budget the user set",
      paced.staticDeadlineReached===true && clock<=BUDGET+FILL_ALLOWANCE+8*40,
      "deadline=" + paced.staticDeadlineReached + " clock=" + clock + " budget=" + BUDGET +
      " fillAllowance=" + FILL_ALLOWANCE);
    // Only the static path reads a phase deadline, so line switching is untouched.
    let splitClock=0;
    const split=run(projects,{projLineMode:"split",solveBudget:BUDGET},{now:()=>splitClock+=8});
    record("L1c: line switching is unaffected by static phase slicing",
      split.phases.length===3 && split.scheduleValidation.ok===true,
      "phases=" + split.phases.length + " replay=" + split.scheduleValidation.ok);
  }

  /* ---- L1b: a deadline during fixed-point refinement keeps the executable incumbent --------
   * Four lines are just enough for the Frames chain once its Bits are treated as an external
   * prerequisite. The first fixed-point pass therefore owns a replayable one-job-per-line plan.
   * Expire the shared deadline at the start of pass two: losing pass one's incumbent used to turn
   * a usable capped answer into a solve-budget failure with no instructions. */
  {
    const events=[];let clock=0,stages=0;
    const r=run([P("f","Frames",[["Frames",100]])],
      {projLineMode:"static",solveBudget:2000,
       lines:Array.from({length:4},()=>({max:4,spx:5,turbo:0}))},
      {now:()=>clock,onCheckpoint:event=>{
        events.push(event);
        if(event.type==="checkpoint"&&event.label==="margin-stage"&&++stages===2)clock=2000;
      }});
    const stops=events.filter(event=>event.type==="stopped");
    const phase=r.phases[0]||{},bits=(phase.preProducedDemand&&phase.preProducedDemand.Bits)||0;
    const supply=(r.executionPhases||[]).filter(ph=>ph.kind==="prerequisite")
      .reduce((total,ph)=>total+((ph.externalSupply&&ph.externalSupply.Bits)||0),0);
    record("L1b: deadline refinement preserves the last replay-valid static incumbent",
      r.feasible===true && r.scheduleValidation.ok===true && r.allPhasesEvaluated===true &&
      phase.evaluated===true && phase.preProducedConverged===null &&
      qtyEq(phase.preProducedSolveDemand&&phase.preProducedSolveDemand.Bits,800) &&
      qtyEq(plannedPreProducedDemand(phase).Bits,1200) && qtyEq(bits,1200) && supply===1200,
      "feasible=" + r.feasible + " replay=" + r.scheduleValidation.ok +
      " evaluated=" + r.allPhasesEvaluated + " converged=" + phase.preProducedConverged +
      " solveBits=" + (phase.preProducedSolveDemand&&phase.preProducedSolveDemand.Bits) +
      " bits=" + bits + " supply=" + supply + " stages=" + stages +
      " failure=" + (r.scheduleValidation.firstFailure&&r.scheduleValidation.firstFailure.kind));
    record("L1b: retained incumbent remains truthfully capped and non-exhaustive",
      r.staticDeadlineReached===true && r.capped===true && r.searchExhaustive===false &&
      phase.capped===true && phase.interrupted===true && phase.searchExhaustive===false &&
      stages===2 && stops.length===1 && stops[0].reason==="deadline",
      "deadline=" + r.staticDeadlineReached + " capped=" + r.capped +
      " exhaustive=" + r.searchExhaustive + " phaseInterrupted=" + phase.interrupted +
      " stops=" + stops.length);
    const el=document.getElementById("results"),stat=document.getElementById("solveStat");
    renderProjectResults(r,el,stat);
    record("L1b: executable bounded result tells the user it may not be the shortest",
      el.innerHTML.indexOf("Executable plan found")>=0 &&
      el.innerHTML.indexOf("passed exact replay")>=0 &&
      el.innerHTML.indexOf("may not be the shortest")>=0,
      "hasBoundedSuccess="+(el.innerHTML.indexOf("Executable plan found")>=0));
    const finalizeOnly=Object.assign({},r,{capped:false,searchExhaustive:true,staticDeadlineReached:true});
    renderProjectResults(finalizeOnly,el,stat);
    record("L1b: a deadline first observed at finalization gets the same honest success notice",
      el.innerHTML.indexOf("Executable plan found")>=0 && el.innerHTML.indexOf("may not be the shortest")>=0,
      "hasFinalizeNotice="+(el.innerHTML.indexOf("Executable plan found")>=0));
  }

  /* ---- R1 (review follow-up): surplus Frames must be charged their pre-produced Bits --------
   * The M1 overshoot credit hands the next phase spare Frames a static line kept crafting after the
   * quota was met — but every one of those Frames burned 8 pre-produced Bits, and the draw only
   * charged the Bits for the DEMANDED units. Without the surplus debit, phase 2's invStart.Bits is
   * overstated by 8 × (surplus Frames) and phase 2 under-crafts Bits — H1 reintroduced sideways. */
  {
    const INV_BITS = 1e6;
    const r = run([P("f","Frames",[["Frames",60],["Concrete",50000]],1),
                   P("g","Glass",[["Glass",200]],2)],
                  {projLineMode:"static", inventory:{Bits:INV_BITS}});
    const ph = r.phases[0],planned=plannedPreProducedDemand(ph).Bits||0;
    const expected = INV_BITS-planned;
    const got = (r.phases[1].invStart&&r.phases[1].invStart.Bits)||0;
    record("R1: exact replay charges the final static plan's whole pre-produced Bits obligation",
      planned>PREPROD_BITS.Frames*60 && ph.preProducedDemand.Bits===planned &&
      ph.preProducedSolveDemand.Bits===planned && Math.abs(got-expected)<=1e-6*Math.max(1,expected) &&
      r.scheduleValidation.ok===true,
      "got=" + got.toFixed(2) + " expected=" + expected.toFixed(2) +
      " plannedBits=" + planned.toFixed(2));
  }

  /* ---- M4: the mined-usage note belongs to the phase that forges the mined craft ------------
   * res.minedUsage is built from phases[0] only. Put the Gel-consuming project second and the
   * top-level note goes silent even though the plan forges plenty of Gel. The per-phase note the
   * step plan carries is built from each phase's own minedUsage — the honest version. */
  {
    const r = run([P("a","GlassProj",[["Glass",100]],1), P("b","WireProj",[["Wire",100]],2)],
                  {minedIncome:{Vespium:{resourcesTradingPerSec:VESP_BUDGET/60}}});
    const u0 = r.phases[0].minedUsage || [], u1 = r.phases[1].minedUsage || [];
    const gel1 = u1.filter(u => u.item === "Gel" && u.resource === "Vespium");
    record("M4: only the mined-forging phase reports mined usage",
      r.phases[0].name === "GlassProj" && u0.length === 0 && gel1.length === 1 && gel1[0].lines > 0,
      "phase1=" + u0.length + " uses, phase2=" + JSON.stringify(u1.map(u=>u.item+"/"+u.resource)));
    record("M4: the top-level (phase-1) note is empty here — which is why it moved per-phase",
      minedUsageNote(resultMinedUsage(r)) === "" && minedUsageNote(u1).length > 0,
      "topLevelUses=" + JSON.stringify(resultMinedUsage(r)) + " phase2NoteLen=" + minedUsageNote(u1).length);
    // ...and results.js must not print the misleading top-level note in a sequenced plan.
    const el = document.getElementById("results"), stat = document.getElementById("solveStat");
    renderProjectResults(r, el, stat);
    record("M4: sequenced render suppresses the phase-1-only mined note",
      el.innerHTML.indexOf("on <b>Gel</b>") < 0 && minedUsageNote(u1).indexOf("on <b>Gel</b>") >= 0,
      "htmlLen=" + el.innerHTML.length);
    record("M4: the solve status still reads as a sentence",
      /^Plan updated\\./.test(stat.textContent), "stat=" + JSON.stringify(stat.textContent));
  }

  /* ---- M5: the order header must describe the user's SETTING ------------------------------
   * One project left means there is nothing to sequence, so res.sequenced goes false — correct for
   * every phase-shaped readout, but the header used to then claim "all projects together" while the
   * Shopping-list toggle still said one at a time. */
  {
    const r = run([P("a","Solo",[["Glass",100]])], {projectSeq:true});
    record("M5: settings survive onto the result even when only one project remains",
      r.sequenced === false && r.orderSeqSetting === true && projOrderMode(r) === "seq",
      "sequenced=" + r.sequenced + " orderSeqSetting=" + r.orderSeqSetting +
      " orderMode=" + projOrderMode(r));
    const el = document.getElementById("results"), stat = document.getElementById("solveStat");
    renderProjectResults(r, el, stat);
    record("M5: the rendered header says one project at a time",
      el.innerHTML.indexOf("one project at a time") >= 0 &&
      el.innerHTML.indexOf("all projects together") < 0,
      "headerSaysOneAtATime=" + (el.innerHTML.indexOf("one project at a time") >= 0));
    // The other three modes still word themselves correctly.
    const gateOff = run([P("a","A",[["Glass",100]]), P("b","B",[["Bricks",100]])],
                        {projectSeq:false, projectGate:false});
    record("M5: gating off still reads as one combined phase",
      projOrderMode(gateOff) === "single", "orderMode=" + projOrderMode(gateOff));
    const together = run([P("a","A",[["Glass",100]]), P("b","B",[["Bricks",100]])],
                         {projectSeq:false, projectGate:true});
    record("M5: unlock-free all-together plan reads as together",
      projOrderMode(together) === "together",
      "orderMode=" + projOrderMode(together) + " phases=" + together.phases.length);
  }

  /* ---- L2: unlock dependence is transitive through the recipe graph ------------------------
   * Wire Tower's costs list Wire, not Gel — but Wire is crafted FROM Gel, so it still can't start
   * before the Gel Refinery. Testing the cost list alone left both on layer 0. */
  {
    build([P("g","GelRef",[["Concrete",10]],null,"gel-refinery"), P("w","WireUser",[["Wire",10]])], {});
    const layers = unlockLayers(projectDemand().perProject);
    record("L2: a project costing Wire lands AFTER the Gel Refinery that unlocks its Gel",
      layers.length === 2 && layers[0] === 0 && layers[1] === 1,
      "layers=" + JSON.stringify(layers) + " (the bug gave [0,0])");
    // A project with no path to the unlocked material stays independent.
    build([P("g","GelRef",[["Concrete",10]],null,"gel-refinery"), P("b","Bricks",[["Bricks",10]])], {});
    const flat = unlockLayers(projectDemand().perProject);
    record("L2: an unrelated project is not dragged behind the unlock",
      JSON.stringify(flat) === "[0,0]", "layers=" + JSON.stringify(flat));
  }

  /* ---- the late-material unlocks: Reinforced Concrete and Batteries ------------------------
   * The Concrete Corner unlocks Reinforced Concrete and the Battery Factory unlocks Batteries,
   * so every project costing either material has to wait for its unlock. The Battery Factory
   * itself costs Reinforced Concrete, which makes the three a chain rather than two pairs.
   * Input order is deliberately scrambled: the layer, not the list position, does the ordering. */
  {
    build([P("w","RCUser",[["Reinforced Concrete",1]]),
           P("c","ConcreteCorner",[["Concrete",10]],null,"the-concrete-corner")], {});
    const rc = unlockLayers(projectDemand().perProject);
    record("a project costing Reinforced Concrete lands AFTER The Concrete Corner",
      JSON.stringify(rc) === "[1,0]", "layers=" + JSON.stringify(rc));

    build([P("v","BatteryUser",[["Batteries",1]]),
           P("f","BatteryFactory",[["Bits",10]],null,"battery-factory")], {});
    const bat = unlockLayers(projectDemand().perProject);
    record("a project costing Batteries lands AFTER the Battery Factory",
      JSON.stringify(bat) === "[1,0]", "layers=" + JSON.stringify(bat));

    build([P("l","BiochemLab",[["Batteries",1],["Reinforced Concrete",1]]),
           P("f","BatteryFactory",[["Bits",10],["Reinforced Concrete",1]],null,"battery-factory"),
           P("c","ConcreteCorner",[["Concrete",10]],null,"the-concrete-corner")], {});
    const chain = unlockLayers(projectDemand().perProject);
    record("Concrete Corner -> Battery Factory -> a project needing both is three layers",
      JSON.stringify(chain) === "[2,1,0]", "layers=" + JSON.stringify(chain));

    // The unlock only bites while its project is in the list; a lone consumer stays on layer 0.
    build([P("w","RCUser",[["Reinforced Concrete",1]]), P("v","BatteryUser",[["Batteries",1]])], {});
    const unlisted = unlockLayers(projectDemand().perProject);
    record("without the unlock projects in the list, their consumers are not held back",
      JSON.stringify(unlisted) === "[0,0]", "layers=" + JSON.stringify(unlisted));
  }

  /* ---- static infeasibility guidance: structural line scarcity is only a possibility --------
   * Frames on three static lines is impossible here, but the message must describe the general
   * one-job-per-line constraint without hard-coding a chain length or claiming line count is the
   * only possible cause. */
  {
    const r=run([P("f","Frames",[["Frames",100]])],
      {projLineMode:"static",lines:Array.from({length:3},()=>({max:4,spx:5,turbo:0}))});
    const el=document.getElementById("results"),stat=document.getElementById("solveStat");
    renderProjectResults(r,el,stat);
    record("static diagnostic cautiously explains that one-job phases may need more lines",
      el.innerHTML.indexOf("at most one job to each line")>=0 &&
      el.innerHTML.indexOf("may need more lines")>=0 &&
      el.innerHTML.toLowerCase().indexOf("five jobs")<0,
      "hasConstraint="+(el.innerHTML.indexOf("at most one job to each line")>=0)+
      " hasCaution="+(el.innerHTML.indexOf("may need more lines")>=0));
  }

  /* ---- review follow-up: the line-plan toggle carries aria-pressed on BOTH buttons, and the
   * order caption names the active mode without making an optimization claim. */
  {
    const el = document.getElementById("results"), stat = document.getElementById("solveStat");
    const together = run([P("a","A",[["Glass",100]]), P("b","B",[["Bricks",100]])],
                         {projectSeq:false, projectGate:true});
    renderProjectResults(together, el, stat);
    record("toggle: split active marks split pressed and static not",
      el.innerHTML.indexOf('data-linemode="split" class="on" aria-pressed="true"') >= 0 &&
      el.innerHTML.indexOf('data-linemode="static" class="" aria-pressed="false"') >= 0,
      "splitPressed=" + (el.innerHTML.indexOf('aria-pressed="true"') >= 0));
    record("toggle: compact accessible labels identify both line modes",
      el.innerHTML.indexOf('role="group" aria-label="Project line plan"') >= 0 &&
      el.innerHTML.indexOf(">Line switching</button>") >= 0 &&
      el.innerHTML.indexOf(">Set &amp; forget</button>") >= 0,
      "hasGroup=" + (el.innerHTML.indexOf('aria-label="Project line plan"') >= 0));
    const statRes = run([P("a","A",[["Glass",100]]), P("b","B",[["Bricks",100]])],
                        {projLineMode:"static", projectSeq:false, projectGate:true});
    renderProjectResults(statRes, el, stat);
    record("toggle: static active flips both aria-pressed values",
      el.innerHTML.indexOf('data-linemode="static" class="on" aria-pressed="true"') >= 0 &&
      el.innerHTML.indexOf('data-linemode="split" class="" aria-pressed="false"') >= 0,
      "staticPressed=" + (el.innerHTML.indexOf('data-linemode="static" class="on"') >= 0));
    record("caption: static mode is named without a fastest-total claim",
      el.innerHTML.indexOf("(fastest total)") < 0 && el.innerHTML.indexOf("set &amp; forget") >= 0,
      "hasMode=" + (el.innerHTML.indexOf("set &amp; forget") >= 0));
  }

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

// Direct eval keeps core/solver/results' top-level const/let (S, optimize, ...) visible to the
// appended runner — the same trusted-local-source bootstrap parity.cjs and staticmode.cjs use.
// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + domSrc + "\n;\n" + projectScheduleSrc + "\n;\n" + solverSrc + "\n;\n" + sampleEverySrc + "\n;\n" + resultsSrc + "\n;\n" + stateShim + "\n;\n" + runner);
