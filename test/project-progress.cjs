"use strict";
// Issue #167: completing an unlock can merge the remaining work into a slower assignment.
// Exercise the actual executable schedules, including startup stock and pre-produced Bits.
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const Decimal = require("../js/decimal.js");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const source = ["core", "dom", "project-schedule", "solver"]
  .map(name => fs.readFileSync(path.join(__dirname, "..", "js", name + ".js"), "utf8"))
  .join("\n;\n");
const runner = `
(function(){
  const failures = [];
  function check(name, action) {
    try { action(); } catch (error) { failures.push(name + ": " + error.message); }
  }
  function project(id, costs, catId) {
    return { id, name: id, catId: catId || "", on: true, from: 1, to: 1, done: 0, prio: null,
      levels: [{ costs: costs.map(([item, qty]) => ({ item, qty })) }] };
  }
  function state(mode) {
    const s = defaults();
    Object.assign(s, { mode: "project", dupe: 0, margin: 0, projLineMode: mode,
      projectSeq: false, projectGate: true, projectStability: "reoptimize" });
    // One compression choice keeps the clock-frozen searches inexpensive and deterministic.
    s.lines = [5, 4.5, 4, 3.5, 3, 2.5].map(spx => ({ max: 1, spx, turbo: 0 }));
    s.minedIncome.Vespium.resourcesTradingPerSec = 5e21 / 60;
    s.projects = [project("Unlock Gel", [["Rods", 1]], "gel-refinery"),
      project("Glass project", [["Glass", 100]]), project("Wire project", [["Wire", 1]])];
    normalize(s); syncManual(s);
    return s;
  }
  function solve(s, label, options) {
    S = s;
    const before = JSON.stringify(S), result = optimize(options);
    check(label + " does not change saved state", () => assert.equal(JSON.stringify(S), before));
    check(label + " is executable", () => {
      assert.equal(result.feasible, true);
      assert.equal(result.scheduleValidation.ok, true);
      assert.ok(Number.isFinite(result.eta));
      // Independently replay from the actual saved inventory, never a candidate's carried stock.
      const replay = replayProjectSchedule(result.executionPhases, projectInitialInventory(), projectScheduleContext());
      assert.equal(replay.ok, true, JSON.stringify(replay.firstFailure));
    });
    return result;
  }
  function traceWork(onEvent) {
    const trace = { previous: 0, reset: false, candidateWork: null, stops: [] };
    trace.observe = event => {
      if (event.work < trace.previous) trace.reset = true;
      trace.previous = event.work;
      if (event.type === "checkpoint" && event.label === "project-progress-candidate" && trace.candidateWork === null)
        trace.candidateWork = event.work;
      if (event.type === "stopped") trace.stops.push(event);
      if (onEvent) onEvent(event);
    };
    return trace;
  }
  for (const mode of ["static", "split"]) {
    resetLineStability();
    const s = state(mode), before = solve(s, mode + " before progress");
    s.projects[0].done = 1;
    const completeTrace = traceWork();
    const after = solve(s, mode + " after progress", { onCheckpoint: completeTrace.observe });
    console.log(mode + " progress: " + before.eta + "h -> " + after.eta + "h");
    check(mode + " completing an unlock cannot increase remaining ETA", () => {
      assert.ok(after.eta <= before.eta + 1e-9,
        "before=" + before.eta + " after=" + after.eta);
    });
    check(mode + " completed costs are not charged again", () => {
      assert.deepEqual(after.perProject.map(p => p.id).sort(), ["Glass project", "Wire project"]);
      for (const item of ALLITEMS) {
        const expected = item === "Glass" ? 100 : item === "Wire" ? 1 : 0;
        const spent = after.executionPhases.reduce((sum, ph) => sum.add(toDec0(ph.demandSub && ph.demandSub[item])), DEC_ZERO);
        assert.ok(spent.eq(expected), item + " project demand=" + spent + ", expected=" + expected);
      }
    });
    check(mode + " candidate does not invent starting inventory", () => {
      assert.ok(Object.values(s.inventory).every(value => toDec0(value).eq(0)));
      for (const phase of after.executionPhases) {
        for (const [item, quantity] of Object.entries(phase.externalSupply || {})) {
          assert.ok(item === "Bits" || Number(quantity) === 0, "invented external " + item);
        }
      }
    });
    // A fresh worker/reload must find the same schedule without remembering the pre-progress run.
    resetLineStability();
    const coldState = JSON.parse(JSON.stringify(s));
    normalize(coldState); syncManual(coldState);
    const cold = solve(coldState, mode + " cold completed state");
    check(mode + " progress result survives a cold solve", () => {
      assert.ok(Math.abs(cold.eta - after.eta) <= 1e-9,
        "warm=" + after.eta + " cold=" + cold.eta);
      assert.deepEqual(cold.phases.map(ph => ph.name), after.phases.map(ph => ph.name));
    });

    // Disabling the unlock-order control still requests one combined assignment.
    const ungatedState = JSON.parse(JSON.stringify(s));
    ungatedState.projectGate = false;
    normalize(ungatedState); syncManual(ungatedState); resetLineStability();
    const ungatedTrace = traceWork();
    const ungated = solve(ungatedState, mode + " gates disabled", { onCheckpoint: ungatedTrace.observe });
    check(mode + " disabled gates keep one phase", () => {
      assert.equal(ungated.phases.length, 1);
      assert.equal(ungated.orderGateSetting, false);
      assert.equal(ungatedTrace.candidateWork, null);
    });

    // Stop after the normal assignment is complete and the optional grouping begins. The seam
    // measures the real solver's work; it neither supplies assignments nor replaces a solve.
    resetLineStability();
    const workLimit = completeTrace.candidateWork + 50, limitedTrace = traceWork();
    const limited = solve(s, mode + " optional grouping interrupted by work limit",
      { workLimit, onCheckpoint: limitedTrace.observe });
    check(mode + " candidates share work and retain the completed incumbent", () => {
      assert.ok(completeTrace.candidateWork > 0);
      assert.equal(completeTrace.reset, false);
      assert.equal(limitedTrace.reset, false);
      assert.ok(limitedTrace.stops.some(event => event.reason === "work" && event.work > completeTrace.candidateWork));
      assert.ok(limitedTrace.previous <= workLimit);
      assert.ok(Math.abs(limited.eta - ungated.eta) <= 1e-9);
      assert.equal(limited.phases.length, 1);
    });
    // Advancing one root clock beyond its absolute deadline at that same boundary must stop
    // the optional solve, even if it tries to create another search or idle-fill control.
    resetLineStability();
    let now = 0;
    const timedTrace = traceWork(event => {
      if (event.type === "checkpoint" && event.label === "project-progress-candidate") now = s.solveBudget + 1;
    });
    const timed = solve(s, mode + " optional grouping interrupted by deadline",
      { now: () => now, clockSampleEvery: 1, onCheckpoint: timedTrace.observe });
    check(mode + " candidates share the root deadline", () => {
      assert.equal(timedTrace.reset, false);
      assert.ok(timedTrace.stops.some(event => event.reason === "deadline" && event.elapsed === s.solveBudget + 1));
      assert.ok(Math.abs(timed.eta - ungated.eta) <= 1e-9);
      assert.equal(timed.phases.length, 1);
      assert.equal(timed.staticDeadlineReached, ungated.staticDeadlineReached,
        "a later candidate's expiry must not relabel the finished incumbent");
    });

    // Completing the workshop removes one old edge, while the unfinished Gel Refinery still
    // gates Wire. A historical grouping must preserve this current prerequisite as well.
    const chain = state(mode);
    chain.projects = [project("Finished workshop", [["Concrete", 1]], "vescas-workshop-mk2"),
      project("Pending Gel", [["Glass", 100]], "gel-refinery"),
      project("Independent", [["Concrete", 1]]), project("Consumer", [["Wire", 1]])];
    chain.projects[0].done = 1;
    chain.inventory.Bits = 4;
    normalize(chain); syncManual(chain); resetLineStability();
    const graphTrace = traceWork();
    const graph = solve(chain, mode + " pending unlock chain", { onCheckpoint: graphTrace.observe });
    const phaseFor = (result, item) => result.phases.findIndex(ph => toDec0(ph.demandSub && ph.demandSub[item]).gt(0));
    check(mode + " optional grouping keeps pending prerequisites before consumers", () => {
      assert.ok(graphTrace.candidateWork > 0);
      assert.ok(phaseFor(graph, "Glass") >= 0);
      assert.ok(phaseFor(graph, "Glass") < phaseFor(graph, "Wire"));
      assert.equal(graph.perProject.some(p => p.id === "Finished workshop"), false);
      assert.equal(Number(chain.inventory.Bits), 4);
    });
    chain.projectSeq = true;
    chain.projects[1].prio = 3; chain.projects[2].prio = 2; chain.projects[3].prio = 1;
    resetLineStability();
    const sequenceTrace = traceWork();
    const sequence = solve(chain, mode + " one project at a time", { onCheckpoint: sequenceTrace.observe });
    check(mode + " explicit sequencing remains one project per phase", () => {
      assert.equal(sequence.sequenced, true);
      assert.equal(sequence.orderSeqSetting, true);
      assert.equal(sequence.phases.length, 3);
      assert.equal(sequence.phases[0].name, "Independent");
      assert.ok(phaseFor(sequence, "Glass") < phaseFor(sequence, "Wire"));
      assert.equal(sequenceTrace.candidateWork, null);
    });
  }
  assert.equal(failures.length, 0, failures.join("\\n"));
  console.log("project progress: ok");
})();
`;

// Trusted local source uses browser globals; direct eval keeps its lexical bindings together.
eval(source + "\n;\n" + runner);
