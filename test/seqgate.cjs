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
 *   M3  a phase blocked on a missing mined income reported feasible and ranked by its leftovers.
 *   M4  the mined-usage note was derived from phase 1's plan only — silent when a later phase
 *       forges the mined craft, and phase-1-scoped when it doesn't.
 *   M5  the order header claimed "all projects together" whenever only one project was left,
 *       regardless of what the Shopping-list toggle actually said.
 *   L2  unlockLayers tested unlock materials against direct costs only, missing Gel -> Wire.
 *
 * Static ("set & forget") line mode has its own suite in test/staticmode.cjs; the blocks here that
 * need it are the overshoot carry (M1) and the ranking/notice behaviour that only exists in that
 * mode. What is asserted here is the split-mode side of those: the overshoot credit must be a no-op
 * for the makespan LP, which is what keeps the parity golden byte-identical.
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

  /* ---- M1 (split half): the overshoot credit must be a no-op for the splitting LP ----------
   * The makespan LP lands every item on the makespan, so there is nothing left over to carry — the
   * credit added to consumeInv must not invent stock here. This is what keeps the parity golden
   * byte-identical; the static side of M1 lives in staticmode.cjs. */
  {
    const sp = run([P("a","P1",[["Glass",2000],["Bricks",50]],1), P("b","P2",[["Bricks",2000]],2)], {});
    const spCarried = (sp.phases[1].invStart && sp.phases[1].invStart.Bricks) || 0;
    record("M1: split mode has ~no overshoot, so the credit changes nothing there",
      sp.phases.length === 2 && spCarried <= 1e-6 * 2000,
      "splitCarriedBricks=" + spCarried);
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
