"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Checking fewer outputs must not report less of them (Node).
 *
 * A checked output that the factory already covers for free takes no line and moves no constraint,
 * so every plan available to the larger output set was available to the smaller one. The smaller
 * solve may therefore never come back with LESS of a shared output than the larger one does. That
 * is a property of the objective — the shared weighted floor min_k out_k/w_k — and not of any
 * particular factory, which is why it is the assertion this file leads with.
 *
 * On the reporter's save it failed by 6.5%. Frames alone at ratio 9 reported 43,798/hr; Frames at
 * ratio 9 plus Bits at ratio 1 reported 46,644/hr on the same seven lines, with Bits covered
 * entirely by a 2.36m/hr Lil' Forgie supply and holding no line in either plan (issue #164). The
 * two plans spend the lines very differently — the better one runs Ingots on two lines and puts
 * Plates on the 64x — and feeding the better plan back through the Frames-only solve scores it at
 * 46,644, so the search reached a plan its own evaluator ranked above the one it returned.
 *
 * What separated them was the basin the first descent fell into. The ILS kick rewrites at most
 * three lines, so a plan whose only improvement is a wider joint move is a fixed point of the loop:
 * the Frames-only search settled after 1,263 iterations and stayed at 43,798 through 100,000. The
 * restart schedule in solveCore is what carries it out, and this fixture is the factory that pins it.
 *
 * Pinned here:
 *   - the property: Frames alone is not below Frames alongside a free second output;
 *   - the reported factory clears the rate the better plan proved reachable;
 *   - the answer stays under its own LP ceiling.
 *
 * Sibling of feeder-plateau.cjs (issue #134) and free-headroom.cjs (issue #153): same max-min
 * objective, same "the search cannot reach it" shape, on a single checked output.
 *
 * Usage: node test/single-output-restart.cjs
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

globalThis.performance = performance;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const ROOT = path.join(__dirname, "..");
const src = ["js/decimal.js", "js/core.js", "js/fields.js", "js/project-schedule.js", "js/solver.js"]
  .map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const FIXTURE = JSON.stringify(
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "state", "single-output-restart.json"), "utf8")));

// The rate the Frames+Bits plan proved reachable on these seven lines. The Frames-only answer sat
// 2,846/hr under it before the restart schedule; the floor is that plan's own rate, less a rounding
// allowance, so the test fails on a regression without pinning the search to one line assignment.
const REACHABLE_FRAMES_HR = 46644;

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const rate=n=>Number(n).toPrecision(6);

  // The reporter's save, trimmed to what Items mode reads: seven lines from a 2048 down to a 64,
  // turbo 25 throughout, and a Lil' Forgie supply covering Bits, Concrete and Ingots.
  const fixture=JSON.parse(${JSON.stringify(FIXTURE)});
  const solve=extra=>{
    S=JSON.parse(JSON.stringify(fixture));
    if(extra)S.targets[extra]={on:true,share:50,w:1};
    normalize(S);syncManual(S);
    _soloMaxCache={key:"",values:{}};
    return optimize();
  };

  const alone=solve(null);
  const withBits=solve("Bits");

  /* ---- the property: a free second output cannot raise the first ---- */
  check("Frames alone is not below Frames alongside a free second output",
    (alone.out.Frames||0)>=(withBits.out.Frames||0)-1e-6,
    "alone="+rate(alone.out.Frames||0)+"/hr  with Bits="+rate(withBits.out.Frames||0)+"/hr");
  check("the free second output still takes no line",
    !(withBits.plan||[]).some(p=>p.job&&p.job.res==="Bits"),
    "lines on Bits="+(withBits.plan||[]).filter(p=>p.job&&p.job.res==="Bits").length);

  /* ---- the symptom: the reported factory reaches the plan it was missing ---- */
  check("the single-output solve reaches the rate the two-output plan proved",
    (alone.out.Frames||0)>=${REACHABLE_FRAMES_HR},
    "Frames="+rate(alone.out.Frames||0)+"/hr  floor=${REACHABLE_FRAMES_HR}  (43798 before the restart schedule)");

  /* ---- and it is still a legal answer ---- */
  check("the reported rate stays under its own LP ceiling",
    !Number.isFinite(alone.bound)||alone.objective<=alone.bound*(1+1e-6),
    "objective="+rate(alone.objective)+" bound="+(alone.bound==null?"null":rate(alone.bound)));

  return fail;
})()
`;

const failures = eval(src + "\n" + runner);
console.log("");
console.log(failures ? (failures + " single-output restart test(s) failed") : "all single-output restart tests passed");
process.exit(failures ? 1 : 0);
