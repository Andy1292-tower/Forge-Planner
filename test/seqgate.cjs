"use strict";
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
const solverSrc = read("js", "solver.js");
const resultsSrc = read("js", "results.js");
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
    s.minedIncome = Object.assign({}, defaults().minedIncome, mined || {});
    normalize(s); syncManual(s); S = s;
    return s;
  }
  const run = (projects, opt) => { build(projects, opt); return optimize(); };

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
    const perPhase = seqRes.phases.map(ph => (ph.net.Bits||0));
    const combined = run([P("a","F1",[["Frames",1000]]), P("b","F2",[["Frames",1000]])],
                         {inventory:{Bits:4000}, projectSeq:false, projectGate:false});
    const want = combined.phases[0].net.Bits || 0;
    record("H1: sequenced per-phase Bits demand sums to the combined-phase demand",
      seqRes.phases.length === 2 && Math.abs(sum(perPhase) - want) <= 1e-6 * Math.max(1, want),
      "perPhase=[" + perPhase.map(v=>v.toFixed(1)).join(", ") + "] sum=" + sum(perPhase).toFixed(1) +
      " combined=" + want.toFixed(1));
    record("H1: phase 2 cannot re-spend the Bits phase 1 already consumed",
      perPhase.length === 2 && perPhase[1] > perPhase[0] + 1e-6,
      "phase1=" + perPhase[0].toFixed(1) + " phase2=" + perPhase[1].toFixed(1) +
      " (the bug made them equal)");
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

  /* ---- L1: max-solve-time bounds the WHOLE static solve, not each phase --------------------
   * Gel Refinery -> Wire Tower (needs Gel) -> a Wire consumer is three unlock layers, so the waves
   * path runs three full solveCore calls. Budgeting per phase meant the user's setting bounded ONE
   * wave and the plan took three times as long as they asked for. Each phase now gets a share of
   * what REMAINS when it starts, so an early phase that proves out fast hands its time forward.
   * (performance.now() is frozen here, so no time can elapse between grants — the wall-clock cap
   * itself is measured for real outside the suite; what this pins is the division and the reset.) */
  {
    const waves = run([P("g","GelRef",[["Concrete",10]],null,"gel-refinery"),
                       P("w","WireTower",[["Gel",10]],null,"wire-tower"),
                       P("c","Consumer",[["Wire",10]])],
                      {projLineMode:"static", projectSeq:false, projectGate:true,
                       minedIncome:{Vespium:VESP_BUDGET}, solveBudget:3000});
    const grants = getStaticPhaseBudgets();
    record("L1: static + unlock waves splits the budget across the waves",
      waves.phases.length === 3 && grants.length === 3 && Math.abs(grants[0] - 1000) < 1e-9,
      "phases=" + waves.phases.length + " grants=" + JSON.stringify(grants) +
      " (bug left the first at the full 3000)");
    record("L1: no single phase is ever granted more than the whole budget",
      grants.every(g => g <= 3000 + 1e-9), "grants=" + JSON.stringify(grants));
    // Sequencing is unchanged: one phase per project.
    run([P("a","A",[["Glass",100]]), P("b","B",[["Bricks",100]])],
        {projLineMode:"static", solveBudget:3000});
    const seqGrants = getStaticPhaseBudgets();
    record("L1: sequencing still divides by the project count",
      seqGrants.length === 2 && Math.abs(seqGrants[0] - 1500) < 1e-9, "grants=" + JSON.stringify(seqGrants));
    // Split mode never pays the per-phase solveCore cost, so budgeting must stay off — and the
    // previous solve's state must not leak into it (the solve worker is reused across solves).
    run([P("a","A",[["Glass",100]]), P("b","B",[["Bricks",100]])], {solveBudget:3000});
    record("L1: split mode leaves the per-phase budget unset and clears the previous solve's state",
      getStaticPhaseBudget() === 0 && getStaticPhaseBudgets().length === 0,
      "next=" + getStaticPhaseBudget() + " grants=" + JSON.stringify(getStaticPhaseBudgets()));
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
    const ph = r.phases[0];
    const surplus = it => Math.max(0, ((ph.rate&&ph.rate[it])||0)*ph.eta - ((ph.net&&ph.net[it])||0));
    const expected = Math.max(0, INV_BITS
      - ((ph.demandSub&&ph.demandSub.Bits)||0)                                   // direct Bits cost (none here)
      - preprodBitsOf(ph.net)                                                    // Bits for the demanded Frames
      + surplus("Bits")                                                          // real spare Bits the lines crafted
      - preprodBitsOf({Frames:surplus("Frames"), Wire:surplus("Wire")}));        // Bits the SURPLUS Frames burned
    const got = (r.phases[1].invStart&&r.phases[1].invStart.Bits)||0;
    record("R1: phase 2's Bits on hand charges the surplus Frames' pre-produced Bits",
      Math.abs(got - expected) <= 1e-6*Math.max(1,expected) && surplus("Frames") > 1,
      "got=" + got.toFixed(2) + " expected=" + expected.toFixed(2) +
      " surplusFrames=" + surplus("Frames").toFixed(2));
  }

  /* ---- M4: the mined-usage note belongs to the phase that forges the mined craft ------------
   * res.minedUsage is built from phases[0] only. Put the Gel-consuming project second and the
   * top-level note goes silent even though the plan forges plenty of Gel. The per-phase note the
   * step plan carries is built from each phase's own minedUsage — the honest version. */
  {
    const r = run([P("a","GlassProj",[["Glass",100]],1), P("b","WireProj",[["Wire",100]],2)],
                  {minedIncome:{Vespium:VESP_BUDGET}});
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
eval(coreSrc + "\n;\n" + domSrc + "\n;\n" + solverSrc + "\n;\n" + resultsSrc + "\n;\n" + stateShim + "\n;\n" + runner);
