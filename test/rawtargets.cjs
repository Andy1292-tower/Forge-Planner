"use strict";
/* Raw-material output targets in items mode (issue #78).
 *
 * Verifies that raws (Ingots / Bits / Concrete) can be selected as "Max items/hr"
 * outputs and that the reported output/hr matches the dedicate-every-line figure
 * the credits-mode raw solver (solveRaw) already computes.
 *
 *  - a single raw target -> feasible, out/hr == solveRaw(raw).out (all lines on it).
 *  - Lil' Forgie's passive supply for the raw is included in the reported output.
 *  - a raw + a product target both come back positive (shared-line max-min).
 *
 * Usage: node test/rawtargets.cjs
 */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };          // freeze clock -> exhaustive/deterministic
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const projectSrc = fs.readFileSync(path.join(__dirname, "..", "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");

const runner = `
(function(){
  const LINES = [
    {max:4, spx:5.0, turbo:0},
    {max:4, spx:4.5, turbo:0},
    {max:2, spx:4.0, turbo:0},
    {max:2, spx:3.5, turbo:0},
    {max:1, spx:3.0, turbo:0},
  ];
  function base(sel){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "items";
    s.lines = JSON.parse(JSON.stringify(LINES));
    [...RAWS, ...PRODUCTS].forEach(it => s.targets[it] = {on: sel.includes(it), w: 1});
    normalize(s); syncManual(s);
    return s;
  }
  const results = [];
  RAWS.forEach(raw => {
    S = base([raw]);
    const dedicated = solveRaw(raw).out;   // credits-mode reference: whole factory on this raw
    const res = optimize();
    const got = res.out[raw] || 0;
    const okFeas = !!res.feasible && got > 1e-9;
    const okMatch = Math.abs(got - dedicated) <= 1e-6 * Math.max(1, dedicated);
    results.push(["single "+raw, okFeas && okMatch,
      "out="+got.toFixed(4)+" dedicated="+dedicated.toFixed(4)+" feasible="+res.feasible]);
  });
  // Forgie passive supply must ride along in the reported output.
  {
    S = base(["Bits"]); S.forgie.Bits = 1000;
    const res = optimize();
    const withF = res.out.Bits || 0;
    S = base(["Bits"]);
    const noF = optimize().out.Bits || 0;
    const okF = Math.abs(withF - (noF + 1000)) <= 1e-3 * Math.max(1, withF);
    results.push(["Bits + 1000/hr Forgie", okF, "withForgie="+withF.toFixed(2)+" noForgie="+noF.toFixed(2)]);
  }
  // Raw + product together: both positive, shared max-min.
  {
    S = base(["Bits","Glass"]);
    const res = optimize();
    const ok = !!res.feasible && (res.out.Bits||0) > 1e-9 && (res.out.Glass||0) > 1e-9;
    results.push(["Bits + Glass mix", ok, "Bits="+(res.out.Bits||0).toFixed(2)+" Glass="+(res.out.Glass||0).toFixed(2)]);
  }
  __emit(JSON.stringify(results));
})();
`;

globalThis.__emit = (str) => {
  const rows = JSON.parse(str);
  let fail = 0;
  rows.forEach(([name, ok, detail]) => {
    console.log((ok ? "ok   " : "FAIL ") + name + "  [" + detail + "]");
    if (!ok) fail++;
  });
  console.log("\n" + (rows.length - fail) + " ok, " + fail + " failed");
  if (fail) process.exitCode = 1;
};

eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
