"use strict";
/* Dead lines, and what a sequenced "Set & forget" run does with them (Node).
 *
 * Two behaviours are pinned here, in order:
 *
 *   1. NO DEAD LINE SURVIVES A SOLVE. solveCore's objective counts net TARGET output only, so a
 *      line producing something no other job consumes and no target asks for scores exactly the
 *      same as Idle. Nothing in the search ever preferred Idle, so such a job — typically parked
 *      there by an intermediate repair step whose consumers were later dropped — rode all the way
 *      into the plan ("no crafters set to Ingots, yet the plan makes them"). The invariant tested
 *      is the general one, not one fixture's symptom: for EVERY busy line, idling it must break
 *      feasibility or strictly lower the objective.
 *
 *   2. THOSE FREED LINES BANK FOR THE NEXT PROJECT. With one project per phase, a line this phase
 *      cannot use can spend it on a later project's direct costs; cross-phase carry then nets the
 *      bank off that project's demand. The contract is that this is free: the filled phase keeps
 *      its own ETA exactly, the whole schedule still replays, and only direct project costs are
 *      ever banked (held stock does not remove a Set & forget feeder job, so banking an
 *      intermediate would buy nothing — and Frames/Wire carry a pre-produced Bits obligation whose
 *      fixed point is already closed by the time a fill runs).
 *
 * Determinism: performance.now() is frozen to 0 (as in parity.cjs) so the anytime solver runs to
 * exhaustion rather than racing a clock. Compression caps stay small so that remains fast.
 *
 * Usage: node test/lookahead.cjs
 */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const read = name => fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8");

const runner = `
(function(){
  const results = [];
  const record = (name, pass, detail) => results.push({name, pass, detail});

  /* ---------------------------------------------------------------- 1. no dead lines ---- */
  // Call the discrete core directly so its own choice vector, not a rendered plan, is inspected.
  function core(targets, weights, lines, setup){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.lines = lines.map(l => ({max:l.max, spx:l.spx, turbo:0}));
    if (setup) setup(s);
    normalize(s); syncManual(s); S = s;
    const chain = relevantChain(targets);
    return solveCore(targets, weights, chain.prods, chain.raws, 10000, {tolOverride:0});
  }
  // Re-derive the objective and feasibility of a solved plan with one line's job removed.
  function withoutLine(solved, index){
    const produced = Float64Array.from(solved.best.produced), consumed = Float64Array.from(solved.best.consumed);
    const job = solved.lineJobs[index][solved.best.choice[index]];
    if (!job || job.kind === "idle") return null;
    const line = solved.sorted[index], sp = effSpeed(line.sp, job.ct);
    for (const [r,a] of job.prod) produced[r] -= a * sp * line.dp;
    for (const [r,a] of job.cons) consumed[r] -= a * sp;
    let feasible = true;
    for (let r = 0; r < solved.R; r++){
      const need = MINED_RESOURCES.includes(solved.resources[r]) ? 1 : 1 - solved.tol;
      if (produced[r] < consumed[r] * need - 1e-7) { feasible = false; break; }
    }
    return {feasible, produced, consumed, job};
  }
  function noDeadLines(label, targets, weights, lines, setup){
    const solved = core(targets, weights, lines, setup);
    if (!solved.feasible){ record(label + ": scenario is feasible", false, "solver found no plan"); return; }
    const score = (produced, consumed) => {
      let value = Infinity;
      for (let k = 0; k < solved.tIdx.length; k++)
        value = Math.min(value, (produced[solved.tIdx[k]] - consumed[solved.tIdx[k]]) / weights[k]);
      return value;
    };
    const busy = [], dead = [];
    solved.sorted.forEach((line, index) => {
      const off = withoutLine(solved, index);
      if (!off) return;
      busy.push("#" + (line.orig+1) + " " + off.job.res + "@" + off.job.lvl);
      // Dead == removing it costs the plan nothing at all.
      if (off.feasible && score(off.produced, off.consumed) >= solved.best.score - 1e-9)
        dead.push("#" + (line.orig+1) + " " + off.job.res + "@" + off.job.lvl);
    });
    record(label + ": every busy line earns its place", dead.length === 0,
      "busy=[" + busy.join(", ") + "] dead=[" + dead.join(", ") + "]");
  }

  // Reinforced Concrete off an abundant Forgie Frames supply — the shape that produced the report.
  // Frames cap the plan, and no single spare line can start the Ingots -> Plates/Rods -> Frames
  // chain on its own, so any line the search parks on Ingots is pure waste.
  noDeadLines("RC on Forgie Frames", ["Reinforced Concrete"], [1],
    [{max:4,spx:60},{max:4,spx:55},{max:4,spx:50},{max:2,spx:45},{max:2,spx:40}],
    s => Object.assign(s.forgie, {Frames:9000, Bricks:4e6, Concrete:6e7, Ingots:1e9}));
  // A two-target mix over a shared raw, where one target is far cheaper than the other.
  noDeadLines("Glass + Bricks", ["Glass","Bricks"], [1, 9],
    [{max:4,spx:20},{max:4,spx:18},{max:2,spx:16},{max:2,spx:14}],
    s => Object.assign(s.forgie, {Bits:5e5, Concrete:5e5}));
  // Gel against a Vespium income small enough that one line exhausts it: every other line is dead
  // on arrival, and Idle is the only honest thing to report.
  noDeadLines("Gel against a small Vespium income", ["Gel"], [1],
    [{max:4,spx:5},{max:4,spx:4.5},{max:2,spx:4},{max:2,spx:3.5}],
    s => { s.minedIncome.Vespium.rigPerMin = 5e13; });

  /* ------------------------------------------------------- 2. sequenced look-ahead fill ---- */
  // Project A is Gel, hard-capped by a small Vespium income, so exactly one line can work on it and
  // the rest have nothing to do. Project B is Bricks, which those spare lines CAN make.
  const LINES = [{max:4,spx:5},{max:4,spx:4.5},{max:2,spx:4},{max:2,spx:3.5}];
  const project = (id, name, costs, prio) => ({id, name, catId:"", on:true, from:1, to:1, done:0, prio,
    levels:[{costs: costs.map(c => ({item:c[0], qty:c[1]}))}]});
  function build(projects, opts){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.projLineMode = (opts && opts.lineMode) || "static";
    s.projectSeq = !(opts && opts.seq === false);
    s.projectGate = false;
    s.lines = LINES.map(l => ({max:l.max, spx:l.spx, turbo:0}));
    s.minedIncome.Vespium.rigPerMin = 5e13;
    Object.assign(s.forgie, {Concrete:5e8, Ingots:5e8, Bits:5e8});
    s.projects = projects;
    normalize(s); syncManual(s); S = s;
    return s;
  }
  const A = () => project("a", "Gel run", [["Gel", 10]], 1);
  const B = () => project("b", "Brick run", [["Bricks", 900]], 2);
  const phaseNamed = (res, name) => (res.phases || []).find(p => p.name === name);
  const jobsOn = ph => ((ph && ph.plan) || []).filter(p => p.entries && p.entries.length)
    .map(p => "#" + p.line + " " + p.entries.map(e => e.item + "@" + e.lvl).join("+"));

  build([A(), B()]);
  const filled = optimize();
  const gel = phaseNamed(filled, "Gel run"), brick = phaseNamed(filled, "Brick run");

  record("sequenced static: the idle lines bank the NEXT project's material",
    !!(gel && gel.lookAhead && gel.lookAhead.name === "Brick run" && gel.lookAhead.items.join() === "Bricks"),
    "lookAhead=" + JSON.stringify(gel && gel.lookAhead || null) + " jobs=" + jobsOn(gel).join(" "));
  record("sequenced static: the last phase banks for nobody",
    !!brick && !brick.lookAhead, "lookAhead=" + JSON.stringify(brick && brick.lookAhead || null));
  record("sequenced static: the filled schedule still replays",
    filled.feasible === true && filled.scheduleValidation.ok === true,
    "feasible=" + filled.feasible + " replay=" + filled.scheduleValidation.ok +
    " failure=" + JSON.stringify(filled.scheduleValidation.firstFailure || null));

  // The whole contract: filling is free. Solve the same first project entirely on its own and the
  // phase must come out to the identical duration.
  build([A()]);
  const aloneEta = optimize().eta;
  // ...and with the fill suppressed, the phase it banks for must be strictly longer.
  const realFill = fillIdleLinesAhead;
  fillIdleLinesAhead = function(){};
  build([A(), B()]);
  const unfilled = optimize();
  fillIdleLinesAhead = realFill;
  const unfilledGel = phaseNamed(unfilled, "Gel run"), unfilledBrick = phaseNamed(unfilled, "Brick run");

  record("sequenced static: banking costs the phase doing it nothing",
    Math.abs(gel.eta - aloneEta) <= 1e-9 * Math.max(1, aloneEta) &&
    Math.abs(gel.eta - unfilledGel.eta) <= 1e-9 * Math.max(1, gel.eta),
    "filled=" + gel.eta.toFixed(6) + "h alone=" + aloneEta.toFixed(6) + "h unfilled=" + unfilledGel.eta.toFixed(6) + "h");
  record("sequenced static: the project banked for finishes sooner",
    brick.eta < unfilledBrick.eta - 1e-9 && filled.eta < unfilled.eta - 1e-9,
    "brick " + unfilledBrick.eta.toFixed(4) + "h -> " + brick.eta.toFixed(4) + "h, total " +
    unfilled.eta.toFixed(4) + "h -> " + filled.eta.toFixed(4) + "h");
  record("sequenced static: no line the phase itself needed was taken",
    jobsOn(unfilledGel).every(job => jobsOn(gel).indexOf(job) >= 0),
    "unfilled=" + jobsOn(unfilledGel).join(" ") + " | filled=" + jobsOn(gel).join(" "));

  // Trim: bank what is still needed and no more. Every filler runs at the SMALLEST compression that
  // still covers what the lines before it left, so one step down would undershoot.
  {
    const byOrig = {}; sortedLines().forEach(l => { byOrig[l.orig] = l; });
    const fillers = ((gel.plan) || []).filter(p => (gel.lookAhead.lines || []).indexOf(p.line) >= 0)
      .map(p => ({line: byOrig[p.line - 1], entry: p.entries[0]}));
    const banked = fillers.reduce((sum, f) => sum + f.entry.outHr * gel.eta, 0);
    const need = 900;
    const stepDown = fillers.map(f => {
      const lower = LEVELS.filter(L => L < f.entry.lvl).pop();
      const alt = lower ? fillerEntry(f.line, f.entry.item, lower) : null;
      return alt ? alt.outHr * gel.eta : 0;
    });
    const trimmedBanked = stepDown.reduce((a, b) => a + b, 0);
    record("sequenced static: the bank covers the demand without overshooting a whole level",
      banked >= need - 1e-6 && trimmedBanked < need,
      "need=" + need + " banked=" + banked.toFixed(1) + " one level lower=" + trimmedBanked.toFixed(1) +
      " levels=" + fillers.map(f => f.entry.item + "@" + f.entry.lvl).join(","));
  }

  /* ------------------------------------------------------------------------- guards ---- */
  build([A(), B()], {lineMode: "split"});
  const split = optimize();
  record("line switching never banks ahead",
    (split.phases || []).every(p => !p.lookAhead),
    "phases=" + (split.phases || []).map(p => p.name + ":" + (p.lookAhead ? "filled" : "-")).join(" "));

  build([A(), B()], {seq: false});
  const together = optimize();
  record("all-projects-at-once never banks ahead (there is no next phase to bank for)",
    (together.phases || []).every(p => !p.lookAhead),
    "phases=" + (together.phases || []).map(p => p.name + ":" + (p.lookAhead ? "filled" : "-")).join(" "));

  // Frames and Wire carry an external pre-produced Bits obligation whose fixed point the phase has
  // already closed, so they are never banked however idle the lines are.
  build([A(), project("f", "Frame run", [["Frames", 40]], 2)]);
  const frames = optimize();
  const frameGel = phaseNamed(frames, "Gel run");
  record("a pre-produced-Bits material (Frames) is never banked ahead",
    !frameGel || !frameGel.lookAhead || frameGel.lookAhead.items.indexOf("Frames") < 0,
    "lookAhead=" + JSON.stringify(frameGel && frameGel.lookAhead || null));

  // A project already covered by stock leaves nothing to bank.
  build([A(), B()]);
  S.inventory.Bricks = 1e9; normalize(S);
  const covered = optimize();
  const coveredGel = phaseNamed(covered, "Gel run");
  record("a next project already covered by inventory is not banked for",
    !coveredGel || !coveredGel.lookAhead,
    "lookAhead=" + JSON.stringify(coveredGel && coveredGel.lookAhead || null));

  let failed = 0;
  results.forEach(r => { if (!r.pass) failed++;
    console.log((r.pass ? "PASS " : "FAIL ") + r.name + "  [" + r.detail + "]"); });
  console.log("\\n" + results.length + " look-ahead tests, " + failed + " failed");
  if (failed) process.exit(1);
})();
`;

eval(read("core.js") + "\n" + read("project-schedule.js") + "\n" + read("solver.js") + "\n" + runner);
