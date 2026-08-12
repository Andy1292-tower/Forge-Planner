"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* "Set & forget" line mode test (Node).
 *
 * Project mode can schedule a phase two ways (S.projLineMode):
 *   "split"  (default) — the makespan LP, where a line divides its time across jobs.
 *   "static" — one job per line for the WHOLE phase, never switched, chosen so the SLOWEST
 *              demanded item finishes as early as it can.
 *
 * What this pins down:
 *   a) static really is one-job-per-line: no line carries more than one entry, and every entry
 *      is a full-phase entry (frac === 1) — that's what the step plan renders as "(whole phase)".
 *   b) demand weighting works: per-item finish = net demand / rate, and with a 9:1 demand ratio the
 *      slowest and fastest item land within a discreteness tolerance of each other here. That is what
 *      weighting solveCore by net demand buys — it minimises the SLOWEST finish. It does NOT promise
 *      simultaneous finishes in general: the objective never penalises finishing early, so an item
 *      with spare line capacity can finish well ahead of the phase (see the M1 overshoot carry).
 *   c) the default is untouched: normalize() coerces a missing/garbage projLineMode to "split",
 *      and that path still runs the LP (which is free to split a line's time — frac < 1).
 *   d) solvePhaseFor still produces a usable eta in static mode (finite, > 0) — everything
 *      downstream of the schedule reads that.
 *   e) the newer catalog behaves: Batteries against two independent mined incomes, a missing
 *      Hydracite income producing an honest PARTIAL plan rather than a blocked one, the
 *      seven-job Reinforced Concrete chain, and compression levels 8192 / 16384.
 *
 * Determinism: performance.now() is frozen to 0 (as in parity.cjs) so the anytime solver runs to
 * exhaustion instead of racing a wall clock. Compression caps are kept small so that stays fast.
 *
 * Usage: node test/staticmode.cjs
 */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const projectScheduleSrc = fs.readFileSync(path.join(__dirname, "..", "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");
/* The deadline blocks drive clocks that cost a fixed number of milliseconds per clock READ, and one
 * builds a control directly to hand a phase an already-expired local deadline. The solver samples
 * its clock once per CLOCK_SAMPLE_EVERY checkpoints, which under such a clock stretches every
 * budget by that stride; sample every checkpoint here so those cutoffs land where the assertions
 * put them. */
const sampleEverySrc = `makeSolveControl = (function(raw){ return function(budget, options){
  const opts = Object.assign({}, options);
  if (opts.clockSampleEvery === undefined) opts.clockSampleEvery = 1;
  return raw(budget, opts);
}; })(makeSolveControl);`;

const runner = `
(function(){
  // Small caps keep the exhaustive (clock-frozen) search cheap; enough lines that the discrete
  // assignment has room to hit a 9:1 output ratio.
  const LINES = [
    {max:4, spx:5.0, turbo:0},
    {max:4, spx:4.5, turbo:0},
    {max:4, spx:4.0, turbo:0},
    {max:2, spx:3.5, turbo:0},
    {max:2, spx:3.0, turbo:0},
    {max:2, spx:2.5, turbo:0},
  ];
  // 9:1 demand. Absolute sizes don't matter to the schedule — only the ratio does.
  const DEMAND = { Plates: 90000, Glass: 10000 };
  function base(lineMode){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.lines = JSON.parse(JSON.stringify(LINES));
    s.projects = [{id:"a",name:"P",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Plates",qty:DEMAND.Plates},{item:"Glass",qty:DEMAND.Glass}]}]}];
    if (lineMode !== undefined) s.projLineMode = lineMode;
    normalize(s); syncManual(s);
    return s;
  }
  // Per-item finish time in hours: what the phase still needs / the rate the plan makes it at.
  function finishes(ph){
    const o = {};
    ALLITEMS.forEach(it => {
      if (((ph.net && ph.net[it]) || 0) > 1e-9 && ((ph.rate && ph.rate[it]) || 0) > 1e-9)
        o[it] = ph.net[it] / ph.rate[it];
    });
    return o;
  }
  const results = [];
  const record = (name, pass, detail) => results.push({name, pass, detail});

  // ---- static ----
  S = base("static");
  const stat = optimize();
  const sp = stat.phases[0];
  const rows = (sp.plan || []).filter(p => p.entries && p.entries.length);
  const maxEntries = Math.max(0, ...(sp.plan || []).map(p => (p.entries || []).length));
  const allWhole = rows.every(p => p.entries.every(e => e.frac === 1));

  record("static: at most one job per line", maxEntries <= 1,
    "maxEntriesOnALine=" + maxEntries + " busyLines=" + rows.length);
  record("static: every entry runs the whole phase (frac===1)", rows.length > 0 && allWhole,
    "entries=" + rows.map(p => "#"+p.line+" "+p.entries.map(e=>e.item+"@"+e.lvl+" frac="+e.frac).join("/")).join(", "));

  // The phase duration is the latest demanded-item finish. Weighted max-min does not promise that
  // faster outputs finish near the same time; static whole-line discreteness may create real surplus.
  const fin = finishes(sp);
  const fv = Object.keys(fin).map(k => fin[k]);
  const latest = fv.length ? Math.max.apply(null, fv) : Infinity;
  record("static: phase ETA equals the slowest demanded-item finish",
    fv.length >= 2 && Math.abs(sp.eta-latest) <= 1e-9*Math.max(1,latest),
    "eta=" + sp.eta.toFixed(3) + " " + Object.keys(fin).map(k => k+"="+fin[k].toFixed(3)+"h").join(" "));

  // (d) eta is what every downstream readout (phase header, total time, clock) is built from.
  record("static: eta is finite and positive", isFinite(sp.eta) && sp.eta > 0 && isFinite(stat.eta) && stat.eta > 0,
    "phaseEta=" + sp.eta + " totalEta=" + stat.eta + " feasible=" + stat.feasible);
  record("static: phase is feasible", stat.feasible === true && sp.feasible === true,
    "feasible=" + stat.feasible + " infeas=" + JSON.stringify(sp.infeasItems));

  // ---- default / split ----
  { const s = base(); delete s.projLineMode; normalize(s);
    record("normalize: missing projLineMode -> split", s.projLineMode === "split",
      "projLineMode=" + s.projLineMode); }
  { const s = base(); s.projLineMode = "nonsense"; normalize(s);
    record("normalize: garbage projLineMode -> split", s.projLineMode === "split",
      "projLineMode=" + s.projLineMode); }

  S = base(); delete S.projLineMode; normalize(S);
  const split = optimize();
  const xp = split.phases[0];
  const splitRows = (xp.plan || []).filter(p => p.entries && p.entries.length);
  const anyPartial = splitRows.some(p => p.entries.some(e => e.frac < 0.999));
  record("split (default): still solves feasibly", split.feasible === true && isFinite(split.eta) && split.eta > 0,
    "eta=" + split.eta + " feasible=" + split.feasible);
  record("split (default): LP is free to split a line's time (frac < 1)", anyPartial,
    "entries=" + splitRows.map(p => "#"+p.line+" "+p.entries.map(e=>e.item+"@"+e.lvl+":"+e.frac.toFixed(2)).join("/")).join(", "));
  // Set & forget trades speed for not having to babysit the lines, so it must never come out FASTER
  // than the LP that's allowed to split time — that would mean the LP left something on the table.
  record("static is never faster than split", stat.eta >= split.eta - 1e-9,
    "staticEta=" + stat.eta.toFixed(4) + " splitEta=" + split.eta.toFixed(4) +
    " (+" + (100*(stat.eta/split.eta - 1)).toFixed(1) + "%)");

  // ---- margin slider must NOT leak into a static project plan ----
  // solveCore honors S.margin ("may-work" paper shortfalls) for items/credits mode, but project
  // phases are strictly balanced — the splitting LP never reads the slider, so the mode switch must
  // not change that contract (staticSchedule passes tolOverride=0). If it leaked, the shortfall
  // would render as a bogus teal "from stock" row and consumeInv would charge phantom drawdown
  // against inventory carried to later phases.
  { S = base("static"); S.margin = 10; // 10% margin set — must be ignored by the project path
    const m = optimize(); const mp = m.phases[0];
    const worstShort = Math.max(0, ...(mp.balance || []).map(b => b.stock || 0));
    record("static: margin slider ignored (no paper shortfall / phantom stock draw)",
      m.feasible === true && worstShort <= 1e-6,
      "margin=10% worstStockDraw=" + worstShort + " feasible=" + m.feasible); }

  // ---- the structural limit of never switching a line ----
  // Frames has four timed jobs (Ingots, Plates, Rods, Frames). Its Bits are an external,
  // pre-produced prerequisite owned by the executable scheduler, not a fifth solver job. Three
  // lines therefore cannot run the chain statically; four lines can, provided the exact replay
  // inserts the zero-time Bits prerequisite and any ordinary warm-up it needs.
  function framesOn(nLines, lineMode){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project"; s.projLineMode = lineMode;
    s.lines = Array.from({length:nLines}, (_,i) => ({max:4, spx:5 - i*0.2, turbo:0}));
    s.projects = [{id:"f",name:"F",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Frames",qty:100}]}]}];
    normalize(s); syncManual(s); S = s;
    return optimize();
  }
  const thin = framesOn(3, "static");
  record("static: too few lines -> honest infeasible, no crash",
    thin.feasible === false && (thin.infeasItems || []).indexOf("Frames") >= 0,
    "feasible=" + thin.feasible + " infeas=" + JSON.stringify(thin.infeasItems));
  const thinSplit = framesOn(3, "split");
  record("split still builds Frames on the same 3 lines (limit is static's, not the factory's)",
    thinSplit.feasible === true, "feasible=" + thinSplit.feasible + " eta=" + thinSplit.eta.toFixed(3));
  const wide = framesOn(4, "static");
  const timedRows = (wide.executionPhases || []).filter(ph => ph.eta > 0)
    .flatMap(ph => (ph.plan || []).filter(p => p.entries && p.entries.length));
  const prerequisite = (wide.executionPhases || []).find(ph => ph.kind === "prerequisite");
  const plannedBits = wide.phases[0] && wide.phases[0].preProducedDemand && wide.phases[0].preProducedDemand.Bits;
  record("static: four timed jobs build Frames with an exact executable prerequisite",
    wide.feasible === true && wide.scheduleValidation && wide.scheduleValidation.ok === true &&
    plannedBits > 0 && prerequisite && prerequisite.externalSupply &&
    prerequisite.externalSupply.Bits === plannedBits &&
    prerequisite.prerequisiteDemand && prerequisite.prerequisiteDemand.Bits === plannedBits &&
    timedRows.every(p => p.entries.length === 1 && p.entries[0].frac === 1),
    "feasible=" + wide.feasible + " replay=" + !!(wide.scheduleValidation && wide.scheduleValidation.ok) +
    " prerequisiteBits=" + (prerequisite && prerequisite.externalSupply && prerequisite.externalSupply.Bits) +
    " timedJobs=" + timedRows.map(p => p.entries[0].item).join("/"));
  record("static: unrestricted phases do not report a synthetic 0x compression ceiling",
    wide.phases[0].compressionCeiling===null,
    "compressionCeiling="+wide.phases[0].compressionCeiling);
  const validCandidate=wide.phases[0],brokenCandidate=JSON.parse(JSON.stringify(validCandidate));
  const brokenEntry=(brokenCandidate.plan||[]).flatMap(line=>line.entries||[])[0];
  brokenEntry.cons=(brokenEntry.cons||[]).concat({item:"Ingots",hr:1e30});
  const replaySafe=retainReplaySafeFixedPointIncumbent(null,validCandidate,validCandidate.demandSub,
    validCandidate.invStart,validCandidate.preProducedSolveDemand,validCandidate.preProducedDemand);
  const retainedAfterInvalid=retainReplaySafeFixedPointIncumbent(replaySafe,brokenCandidate,brokenCandidate.demandSub,
    brokenCandidate.invStart,brokenCandidate.preProducedSolveDemand,brokenCandidate.preProducedDemand);
  record("static deadline incumbent: a later analytic-feasible replay failure cannot erase it",
    replaySafe&&retainedAfterInvalid===replaySafe,
    "firstCertified="+!!replaySafe+" laterRetained="+(retainedAfterInvalid===replaySafe));

  // Regression: a larger compression cap contains every lower-cap assignment. With 950 Bits held,
  // 100 Frames reserve 800 Bits and the project also spends 100 Bits directly. The static
  // pre-produced fixed point must not oscillate into a false convergence failure at 4x.
  function framesAndBitsAtCap(cap,testOptions){
    const s=defaults();s.dupe=0;s.margin=0;s.mode="project";s.projLineMode="static";
    s.lines=s.lines.map(line=>({max:cap,spx:line.spx,turbo:0}));
    s.inventory=Object.assign({},s.inventory,{Bits:950});
    s.projects=[{id:"fb",name:"Frames + Bits",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Frames",qty:100},{item:"Bits",qty:100}]}]}];
    normalize(s);syncManual(s);S=s;return optimize(testOptions);
  }
  const cap2=framesAndBitsAtCap(2),cap4=framesAndBitsAtCap(4);
  const highCapCandidates=staticCompressionFallbackCandidates(16384,[4]);
  record("static compression fallback: retries below the observed cycle, not the physical cap",
    JSON.stringify(highCapCandidates)==="[2,1]",
    "physical=16384 observed=[4] candidates="+JSON.stringify(highCapCandidates));
  record("static compression baseline: 2x Frames + direct Bits is executable",
    cap2.feasible===true&&cap2.scheduleValidation.ok===true,
    "2x="+cap2.feasible+"/"+cap2.scheduleValidation.ok+
    " assumed="+JSON.stringify(cap2.phases[0].preProducedSolveDemand||{})+
    " planned="+JSON.stringify(cap2.phases[0].preProducedDemand||{})+
    " jobs="+JSON.stringify((cap2.phases[0].plan||[]).flatMap(line=>(line.entries||[]).map(entry=>entry.item+"@"+entry.lvl)))+
    " "+JSON.stringify(cap2.scheduleValidation.firstFailure||null));
  record("static compression monotonicity: 4x retains a valid lower-cap assignment",
    cap4.feasible===true&&cap4.scheduleValidation.ok===true&&cap4.eta<=cap2.eta+1e-9*Math.max(1,cap2.eta)&&
    cap4.phases[0].compressionFallback===true&&cap4.phases[0].compressionCeiling===2&&
    cap4.phases[0].capped===true&&cap4.phases[0].searchExhaustive===false&&
    (cap4.phases[0].plan||[]).every(line=>(line.entries||[]).every(entry=>entry.lvl<=2)),
    "4x="+cap4.feasible+"/"+cap4.scheduleValidation.ok+" eta2="+cap2.eta+" eta4="+cap4.eta+
    " fallback="+cap4.phases[0].compressionFallback+" ceiling="+cap4.phases[0].compressionCeiling+
    " assumed="+JSON.stringify(cap4.phases[0].preProducedSolveDemand||{})+
    " planned="+JSON.stringify(cap4.phases[0].preProducedDemand||{})+
    " jobs="+JSON.stringify((cap4.phases[0].plan||[]).flatMap(line=>(line.entries||[]).map(entry=>entry.item+"@"+entry.lvl)))+
    " failure="+JSON.stringify(cap4.scheduleValidation.firstFailure||null));
  let fallbackClock=0,fallbackStages=0;const fallbackEvents=[];
  const interruptedFallback=framesAndBitsAtCap(4,{now:()=>fallbackClock,onCheckpoint:event=>{
    fallbackEvents.push(event);
    if(event.type==="checkpoint"&&event.label==="margin-stage"&&++fallbackStages===3)fallbackClock=10000;
  }});
  const fallbackStops=fallbackEvents.filter(event=>event.type==="stopped");
  record("static compression deadline: failed fallback cannot erase the certified primary-cycle plan",
    interruptedFallback.feasible===true&&interruptedFallback.scheduleValidation.ok===true&&
    interruptedFallback.staticDeadlineReached===true&&interruptedFallback.allPhasesEvaluated===true&&
    interruptedFallback.capped===true&&interruptedFallback.searchExhaustive===false&&
    interruptedFallback.phases[0].preProducedConverged===null&&
    interruptedFallback.phases[0].compressionFallback!==true&&fallbackStages===3&&
    fallbackStops.length===1&&fallbackStops[0].reason==="deadline",
    "feasible="+interruptedFallback.feasible+" replay="+interruptedFallback.scheduleValidation.ok+
    " deadline="+interruptedFallback.staticDeadlineReached+" stages="+fallbackStages+
    " stops="+fallbackStops.length+" failure="+JSON.stringify(interruptedFallback.scheduleValidation.firstFailure||null));

  /* ---- a spent per-phase slice is a clock, not a verdict --------------------------------------
   * Every phase gets a share of the run's budget so one cannot starve the rest. That share is
   * enforced by a LOCAL deadline, and only a ROOT stop sets solveCore's "interrupted" — the local
   * cutoff is reported on its own channel. A phase whose slice is gone therefore returns exactly
   * what an exhaustive search of an impossible factory returns: no assignment, every target at
   * zero rate. Read as a verdict, that publishes buildable items as "can't sustainably produce",
   * and hands the pre-produced Bits fixed point a timed-out zero to compare its real obligation
   * against — blocking the schedule over a Bits shortfall that never existed. */
  {
    const s=defaults();s.dupe=0;s.margin=0;s.mode="project";s.projLineMode="static";
    s.lines=Array.from({length:4},(_,i)=>({max:4,spx:5-i*0.2,turbo:0}));
    normalize(s);syncManual(s);S=s;
    const net={};ALLITEMS.forEach(it=>net[it]=0);net.Frames=100;
    const searched=solvePhaseFor(net,"F",{},null,"f",{static:true,control:makeSolveControl(10000)});
    const expired=solvePhaseFor(net,"F",{},null,"f",{static:true,control:makeSolveControl(10000),localDeadline:0});
    record("static: these lines really can build the phase (so an empty result is the clock, not the factory)",
      searched.feasible===true&&searched.evaluated===true&&searched.infeasItems.length===0,
      "feasible="+searched.feasible+" evaluated="+searched.evaluated+
      " jobs="+JSON.stringify((searched.plan||[]).flatMap(line=>(line.entries||[]).map(entry=>entry.item+"@"+entry.lvl))));
    record("static: a phase whose slice is spent reports no assignment, never an infeasible factory",
      expired.feasible===false&&expired.evaluated===false&&expired.interrupted===true&&
      expired.searchExhaustive===false&&expired.infeasItems.length===0,
      "feasible="+expired.feasible+" evaluated="+expired.evaluated+" interrupted="+expired.interrupted+
      " exhaustive="+expired.searchExhaustive+" infeas="+JSON.stringify(expired.infeasItems));
  }

  // End to end, on the shape that bites: the fixed point needs a second pass to confirm the Bits its
  // first plan committed to, and the first pass is entitled to spend the whole slice getting there.
  // The second pass then returns instantly with nothing. That must retain the certified first pass,
  // not read the empty result as a disagreeing obligation of zero.
  {
    let sliceClock=0,solves=0;
    const s=defaults();s.dupe=0;s.margin=0;s.mode="project";s.projLineMode="static";s.solveBudget=10000;
    s.lines=Array.from({length:4},(_,i)=>({max:4,spx:5-i*0.2,turbo:0}));
    s.projects=[{id:"a",name:"Frames",catId:"",on:true,from:1,to:1,done:0,prio:1,
        levels:[{costs:[{item:"Frames",qty:100}]}]},
      {id:"b",name:"Ingots",catId:"",on:true,from:1,to:1,done:0,prio:2,
        levels:[{costs:[{item:"Ingots",qty:100}]}]}];
    normalize(s);syncManual(s);S=s;
    // tolOverride:0 gives every static solve exactly one "margin-stage" checkpoint, so it counts
    // solves. Jump past the first phase's slice (10000/2) once its second pass has begun, staying
    // under the root deadline — the whole point is a LOCAL cutoff with the shared budget still live.
    const spent=optimize({now:()=>sliceClock,onCheckpoint:event=>{
      if(event.type==="checkpoint"&&event.label==="margin-stage"&&++solves===2)sliceClock=6000;
    }});
    const bitsBlocker=(spent.scheduleValidation&&spent.scheduleValidation.firstFailure)||null;
    record("static: a slice that runs out mid-fixed-point blames the clock, not the chain",
      solves>=2&&spent.infeasItems.length===0&&
      spent.phases[0].preProducedConverged!==false&&!spent.phases[0].preProducedFailure&&
      (bitsBlocker===null||bitsBlocker.kind!=="pre-produced-convergence"),
      "solves="+solves+" infeas="+JSON.stringify(spent.infeasItems)+
      " preConverged="+spent.phases[0].preProducedConverged+
      " blocker="+JSON.stringify(bitsBlocker));
    record("static: the retained first pass still carries a real plan and replays",
      spent.feasible===true&&spent.scheduleValidation.ok===true&&spent.phases[0].feasible===true&&
      (spent.phases[0].plan||[]).some(line=>(line.entries||[]).length>0),
      "feasible="+spent.feasible+" replay="+(spent.scheduleValidation||{}).ok+
      " jobs="+JSON.stringify((spent.phases[0].plan||[]).flatMap(line=>(line.entries||[]).map(entry=>entry.item+"@"+entry.lvl))));
  }

  /* ================= the newer catalog: mined Batteries, Reinforced Concrete, 16384x ==========
   * Everything above predates the second mined resource (Hydracite), the two long-chain products,
   * and compression levels 8192/16384. Those are exactly the cases where "one job per line" bites
   * hardest, so pin them here rather than assuming the Frames chain generalises. */
  // A one-level project over the given [item, qty] costs, on the given lines.
  function scene(costs, lines, opts){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.projLineMode = (opts && opts.lineMode) || "static";
    s.lines = lines.map(l => ({max:l.max, spx:l.spx, turbo:0}));
    const mined=(opts && opts.minedIncome) || {};
    if(Object.prototype.hasOwnProperty.call(mined,"Vespium"))s.minedIncome.Vespium.rigPerMin=mined.Vespium;
    if(Object.prototype.hasOwnProperty.call(mined,"Hydracite"))
      s.minedIncome.Hydracite.resourcesTradingPerSec=mined.Hydracite==null?mined.Hydracite:mined.Hydracite/60;
    Object.assign(s.forgie,(opts && opts.forgie) || {});
    s.projects = [{id:"x",name:"X",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:costs.map(c=>({item:c[0], qty:c[1]}))}]}];
    normalize(s); syncManual(s); S = s;
    return optimize();
  }
  const rowsOf = r => ((r.phases[0] && r.phases[0].plan) || []).filter(p => p.entries && p.entries.length);
  const jobsOf = r => rowsOf(r).map(p => p.entries[0].item);
  const oneJobPerLine = r => rowsOf(r).every(p => p.entries.length === 1 && p.entries[0].frac === 1);
  // A factory shaped the way these end-game chains actually have to be run in static mode: the final
  // assembly sits on ONE slow, low-compression line and everything else feeds it flat out. A static
  // line is all-or-nothing, so it can't take "12% of a line" the way the splitting LP can — the only
  // way to hit a ratio like Batteries' 100000 Gel per craft is to slow the consumer down.
  const BATTERY_LINES = [
    {max:1,  spx:0.4},    // Batteries — deliberately slow, so one Gel line can keep up with it
    {max:32, spx:50},
    {max:32, spx:50},
    {max:4,  spx:50},
    {max:4,  spx:50},
    {max:4,  spx:50},
  ];

  /* ---- Batteries: the second mined resource, budgeted independently ------------------------
   * Batteries burn Hydracite directly and Gel (which burns Vespium) through Wire, so a static plan
   * needs one line each for Batteries, Wire, Gel, Rods and Ingots — and both incomes present. */
  {
    const both = scene([["Batteries",1]], BATTERY_LINES,
                       {minedIncome:{Vespium:1e30, Hydracite:1e30}});
    const uses = (both.phases[0] && both.phases[0].minedUsage) || [];
    record("static Batteries: builds with both incomes, one job per line",
      both.feasible === true && both.eta > 0 && oneJobPerLine(both),
      "feasible=" + both.feasible + " eta=" + both.eta.toFixed(4) + " lines=" + jobsOf(both).join("/"));
    record("static Batteries: minedUsage survives the static path and names both ores",
      uses.some(u => u.item === "Batteries" && u.resource === "Hydracite") &&
      uses.some(u => u.item === "Gel" && u.resource === "Vespium"),
      "uses=" + JSON.stringify(uses.map(u => u.item + "/" + u.resource + " x" + u.lines)));
    record("static Batteries: every mined line reports a real burn against its own income",
      uses.filter(u => u.resource === "Hydracite" || u.resource === "Vespium")
          .every(u => u.lines > 0 && u.inputHr > 0 && u.outHr > 0),
      "burn=" + JSON.stringify(uses.map(u => u.resource + ":" + (u.inputHr > 0))));
  }

  {
    const oneCraft = scene([["Batteries",5]], [{max:1,spx:1}], {
      minedIncome:{Vespium:1e30,Hydracite:1e30},forgie:{Wire:1e30,Gel:1e30}
    });
    const ph=oneCraft.phases[0];
    const entry=rowsOf(oneCraft).flatMap(row=>row.entries).find(e=>e.item==="Batteries");
    const wire=(ph.balance||[]).find(row=>row.res==="Wire"),gel=(ph.balance||[]).find(row=>row.res==="Gel");
    const hydra=(ph.minedUsage||[]).find(use=>use.item==="Batteries"&&use.resource==="Hydracite");
    record("static Batteries: five units finish in one physical craft",
      oneCraft.feasible===true&&Math.abs(oneCraft.eta-287.2984888888889)<=1e-9,
      "eta="+oneCraft.eta+" feasible="+oneCraft.feasible);
    record("static Batteries: replay preserves corrected outHr",
      entry&&Math.abs(entry.outHr-0.01740350260572976)<=1e-15&&
        Math.abs((ph.rate.Batteries||0)-0.01740350260572976)<=1e-15,
      "entry="+(entry&&entry.outHr)+" rate="+(ph.rate.Batteries||0));
    record("static Batteries: inputs remain per physical craft",
      wire&&gel&&hydra&&Math.abs(wire.cons-1.7403502605729757)<=1e-12&&
        Math.abs(gel.cons-348.0700521145951)<=1e-9&&
        Math.abs(hydra.inputHr-17403502605.72976)<=1e-5,
      "wire="+(wire&&wire.cons)+" gel="+(gel&&gel.cons)+" hydra="+(hydra&&hydra.inputHr));
  }

  /* ---- missing Hydracite income: blocked, and honestly PARTIAL in static mode --------------
   * The blocker is computed before the schedule runs, so Batteries is dropped from the targets and
   * the rest of the project still gets a real static plan. That combination — a blocked item, a
   * plannable remainder, one job per line — is what the "Partial plan only" notice renders from,
   * and it has to carry the same shape the splitting LP produces (minedmodes.cjs reads it). */
  {
    const r = scene([["Batteries",1],["Glass",5000]], BATTERY_LINES,
                    {minedIncome:{Vespium:1e30, Hydracite:null}});
    const ph = r.phases[0];
    record("static: a missing mined income names the ore, not just the item",
      (r.blockedMined && r.blockedMined.Batteries || []).indexOf("Hydracite") >= 0 &&
      (ph.blockedMined && ph.blockedMined.Batteries || []).indexOf("Hydracite") >= 0,
      "blockedMined=" + JSON.stringify(r.blockedMined));
    record("static: the plannable remainder is a PARTIAL plan, not a blocked one",
      r.feasible === false && r.partial === true && ph.partial === true && ph.feasible === false,
      "feasible=" + r.feasible + " partial=" + r.partial + " phasePartial=" + ph.partial);
    record("static: the partial plan still delivers the unblocked items, one job per line",
      (ph.rate.Glass || 0) > 0 && ph.eta > 0 && oneJobPerLine(r) && jobsOf(r).indexOf("Batteries") < 0,
      "glassRate=" + (ph.rate.Glass||0).toFixed(2) + " eta=" + ph.eta.toFixed(4) +
      " lines=" + jobsOf(r).join("/"));
    // Both incomes missing and NOTHING else to craft: no targets at all, so no plan — and the phase
    // must still hand back the upstream-shaped fields rather than a bare object.
    const none = scene([["Batteries",1]], BATTERY_LINES, {});
    const nph = none.phases[0];
    record("static: a wholly blocked phase keeps the upstream result shape",
      none.feasible === false && nph.partial === false && Array.isArray(nph.minedUsage) &&
      nph.minedUsage.length === 0 && (nph.blockedMined.Batteries || []).length === 2,
      "partial=" + nph.partial + " blockedMined=" + JSON.stringify(nph.blockedMined));
  }

  /* ---- Reinforced Concrete: the longest chain in the catalog -------------------------------
   * Bricks + Concrete + Frames, and Frames drags in Plates, Rods and Ingots — seven distinct jobs.
   * A static plan therefore needs seven lines; six is genuinely unbuildable and must say so rather
   * than quietly dropping an input. It needs no mined income at all (minedmodes.cjs pins that too). */
  {
    const CHAIN = ["Reinforced Concrete","Bricks","Concrete","Frames","Plates","Rods","Ingots"];
    const RC_LINES = [
      {max:1, spx:0.05},   // Reinforced Concrete — slow, for the same all-or-nothing reason as above
      {max:4, spx:50}, {max:4, spx:50}, {max:4, spx:50}, {max:4, spx:50}, {max:4, spx:50},
      {max:8, spx:50},
    ];
    const thin = scene([["Reinforced Concrete",1]], RC_LINES.slice(0,6), {});
    record("static Reinforced Concrete: six lines is one short -> honest infeasible",
      thin.feasible === false && (thin.infeasItems || []).indexOf("Reinforced Concrete") >= 0 &&
      rowsOf(thin).length === 0,
      "feasible=" + thin.feasible + " infeas=" + JSON.stringify(thin.infeasItems));
    const wide = scene([["Reinforced Concrete",1]], RC_LINES, {});
    const jobs = jobsOf(wide);
    record("static Reinforced Concrete: seven lines builds it, one job per line",
      wide.feasible === true && wide.eta > 0 && oneJobPerLine(wide),
      "feasible=" + wide.feasible + " eta=" + wide.eta.toFixed(4) + " lines=" + jobs.join("/"));
    record("static Reinforced Concrete: the plan covers the whole chain, each job exactly once",
      CHAIN.every(it => jobs.indexOf(it) >= 0) && new Set(jobs).size === jobs.length,
      "jobs=" + jobs.slice().sort().join(",") );
    record("static Reinforced Concrete: needs no mined income",
      ((wide.phases[0] && wide.phases[0].minedUsage) || []).length === 0 &&
      Object.keys(wide.blockedMined || {}).length === 0,
      "minedUsage=" + JSON.stringify((wide.phases[0]||{}).minedUsage));
    // The splitting LP can time-share, so the same six lines are fine for it — the limit is the
    // mode's, not the factory's.
    const thinSplit = scene([["Reinforced Concrete",1]], RC_LINES.slice(0,6), {lineMode:"split"});
    record("split builds Reinforced Concrete on the same six lines",
      thinSplit.feasible === true, "feasible=" + thinSplit.feasible + " eta=" + thinSplit.eta.toFixed(4));
  }

  /* ---- the top of the compression table (8192 / 16384) -------------------------------------
   * LEVELS grew past 4096, and a static line runs ONE level for the whole phase, so picking the
   * wrong one is not recoverable mid-run. A line capped at the top must be free to use the top:
   * output per second is (L / cycle) x min(speed, cycle), which keeps climbing with L here. */
  {
    const top = scene([["Concrete",1e12]], [{max:16384, spx:50}], {});
    const e = rowsOf(top)[0].entries[0];
    record("static: a 16384x line may run at 16384x",
      top.feasible === true && e.item === "Concrete" && e.lvl === 16384 && e.frac === 1,
      "job=" + e.item + "@" + e.lvl + " label=" + compressionLabel(e.lvl) + " eta=" + top.eta.toFixed(4));
    record("static: the top level renders through compressionLabel, not raw arithmetic",
      compressionLabel(e.lvl) === "16.38k×" && compressionLabel(8192) === "8192×",
      "16384=" + compressionLabel(16384) + " 8192=" + compressionLabel(8192));
    const capped = scene([["Concrete",1e12]], [{max:8192, spx:50}], {});
    const ce = rowsOf(capped)[0].entries[0];
    record("static: a line never exceeds its own cap",
      ce.lvl === 8192 && ce.lvl <= 8192 && LEVELS.indexOf(ce.lvl) >= 0,
      "job=" + ce.item + "@" + ce.lvl + " (cap 8192)");
    record("static: the taller cap really is the faster plan (so the choice matters)",
      top.eta < capped.eta - 1e-12,
      "eta@16384=" + top.eta.toFixed(4) + "h eta@8192=" + capped.eta.toFixed(4) + "h");
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

// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + projectScheduleSrc + "\n;\n" + solverSrc + "\n;\n" + sampleEverySrc + "\n;\n" + runner);
