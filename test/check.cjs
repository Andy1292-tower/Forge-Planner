"use strict";
/* Compare a fresh parity run against the golden snapshot.
 *
 *   node test/parity.cjs > /tmp/cur.json
 *   node test/check.cjs test/golden.json /tmp/cur.json
 *
 * Rules:
 *  - non-Gel scenarios: must match golden exactly (the refactor must not change them).
 *  - Gel scenarios (name contains "gel"): feasibility must be preserved and the
 *    objective must not regress (>= golden - eps). The unified model co-optimizes
 *    Gel with the rest, so the plan/objective may legitimately IMPROVE; that's
 *    reported, not failed. Plan-shape differences are shown for review.
 */
const fs = require("fs");
const EPS = 1e-6;
const [, , goldPath, curPath] = process.argv;
const gold = JSON.parse(fs.readFileSync(goldPath, "utf8"));
const cur = JSON.parse(fs.readFileSync(curPath, "utf8"));

let fail = 0, improved = 0, ok = 0;
const keys = [...new Set([...Object.keys(gold), ...Object.keys(cur)])].sort();
for (const k of keys) {
  const g = gold[k], c = cur[k];
  const isGel = /\.gel\./i.test(k);
  if (!g || !c) { console.log(`FAIL  ${k}: missing in ${!g ? "golden" : "current"}`); fail++; continue; }
  if (c.error) { console.log(`FAIL  ${k}: threw ${c.error.split("\n")[0]}`); fail++; continue; }

  if (!isGel) {
    if (JSON.stringify(g) === JSON.stringify(c)) { ok++; continue; }
    console.log(`FAIL  ${k}: non-Gel result changed`);
    if (sig(g.objective) !== sig(c.objective)) console.log(`        objective ${g.objective} -> ${c.objective}`);
    if (g.feasible !== c.feasible) console.log(`        feasible ${g.feasible} -> ${c.feasible}`);
    diffPlan(g, c);
    fail++; continue;
  }

  // Gel scenario: no regression
  if (!!g.feasible !== !!c.feasible) {
    console.log(`FAIL  ${k}: feasibility changed ${g.feasible} -> ${c.feasible}`); fail++; continue;
  }
  const go = g.objective || 0, co = c.objective || 0;
  if (co < go - Math.abs(go) * 1e-6 - EPS) {
    console.log(`FAIL  ${k}: objective REGRESSED ${go} -> ${co}`); fail++; continue;
  }
  if (co > go + Math.abs(go) * 1e-6 + EPS) {
    console.log(`IMPROVED ${k}: objective ${go} -> ${co} (+${sig((co - go) / go * 100)}%)`); improved++; continue;
  }
  ok++; // matched within eps
}
console.log(`\n${ok} ok, ${improved} improved, ${fail} failed`);
process.exit(fail ? 1 : 0);

function sig(x){ return (x==null||!isFinite(x))?x:Math.round(x*1e6)/1e6; }
function diffPlan(g, c){
  const gp = JSON.stringify(g.plan), cp = JSON.stringify(c.plan);
  if (gp !== cp) { console.log(`        plan golden:  ${gp}`); console.log(`        plan current: ${cp}`); }
}
