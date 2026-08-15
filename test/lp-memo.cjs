"use strict";
/* The makespan LP's exact-tableau memo (Node).
 *
 * WHY THE KEY IS THE TABLEAU. projectSchedule and buildScheduleLP take a handful of arguments and
 * then read the global S for everything else: line count, speed, turbo and duplication through
 * sortedLines(); base craft times; S.prodCost twice per (item,input,level) — once as a validity gate
 * that DROPS the variable, so two calls with identical arguments can produce different column
 * counts; mined per-craft costs; which mined resources are active, which decides which ROWS exist;
 * and each row's bound from mined income or passive supply. A key built from the named inputs would
 * therefore be able to answer one factory's LP out of another's. The key here is the tableau itself,
 * so it cannot: a digest nominates a candidate and an element-wise compare decides the hit.
 *
 * WHAT IS PINNED
 *   1. The memo is exact — a hit returns element-wise what a fresh solve returns, and returns a COPY.
 *   2. A tableau that differs anywhere, by one ulp, misses. Signed zero is not a difference.
 *   3. The table is byte-capped and stops storing rather than growing without bound.
 *   4. On the real line-switching Project run: identical result, every distinct tableau solved
 *      exactly once, and strictly fewer solves than presentations.
 *
 * Usage: node test/lp-memo.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { materialize, fixtureById } = require("./perf/corpus.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCES = ["js/decimal.js", "js/catalog.js", "js/core.js", "js/fields.js", "js/state.js", "js/project-schedule.js", "js/solver.js"];

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? " [" + detail + "]" : ""));
  if (!ok) failures++;
}

function realm() {
  const context = vm.createContext({
    console, performance, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => ({ innerHTML: "", textContent: "" }) },
  });
  for (const file of SOURCES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  return context;
}

/* ---- 1-3: the table itself ---------------------------------------------------------------- */
{
  const context = realm();
  const run = source => vm.runInContext(source, context, { filename: "lp-memo-unit" });

  const exact = run(`
    (function(){
      var memo=makeLpMemo();
      var c=[1,1],A=[[1,0],[0,1],[1,1]],b=[4,5,6];
      var fresh=lpMaximize(c,A,b);
      memo.store(c,A,b,fresh);
      var hit=memo.lookup(c,A,b);
      var same=!!hit&&hit.x.length===fresh.x.length;
      for(var j=0;j<fresh.x.length&&same;j++)same=hit.x[j]===fresh.x[j];
      // The hit must be a copy: rewriting it must not reach the table.
      hit.x[0]=-12345;
      var second=memo.lookup(c,A,b);
      return {same:same,complete:hit.complete===fresh.complete,
        copied:second.x[0]===fresh.x[0],stats:memo.stats()};
    })()
  `);
  check("a memo hit returns element-wise what a fresh solve returns",
    exact.same && exact.complete, "sameVector=" + exact.same + " sameComplete=" + exact.complete);
  check("a memo hit hands out a copy, so a caller cannot rewrite the table through it",
    exact.copied, "second lookup unchanged=" + exact.copied);
  check("hits and misses are counted",
    exact.stats.hits === 2 && exact.stats.misses === 0 && exact.stats.entries === 1,
    JSON.stringify(exact.stats));

  const discrimination = run(`
    (function(){
      var memo=makeLpMemo();
      var c=[1,1],A=[[1,0],[0,1],[1,1]],b=[4,5,6];
      memo.store(c,A,b,lpMaximize(c,A,b));
      var oneUlp=A.map(function(r){return r.slice();});
      oneUlp[1][1]=1+Math.pow(2,-52);
      var widerRow=A.map(function(r){return r.slice();});widerRow[0]=[1,0,0];
      var otherB=b.slice();otherB[2]=6+Math.pow(2,-50);
      // Signed zero is not a difference: === cannot see it, so the digest must not either.
      var signedZero=A.map(function(r){return r.slice();});signedZero[0][1]=-0;
      return {ulp:memo.lookup(c,oneUlp,b),wider:memo.lookup(c,widerRow,b),rhs:memo.lookup(c,A,otherB),
        zero:!!memo.lookup(c,signedZero,b),digestsMatch:lpTableauDigest(c,A,b)===lpTableauDigest(c,signedZero,b)};
    })()
  `);
  check("a tableau differing by one ulp in a coefficient misses",
    discrimination.ulp === null, "lookup=" + discrimination.ulp);
  check("a tableau differing by one ulp in a bound misses",
    discrimination.rhs === null, "lookup=" + discrimination.rhs);
  check("a row of a different width misses rather than reading past the stored row",
    discrimination.wider === null, "lookup=" + discrimination.wider);
  check("negative zero is the same tableau as zero, in the digest and in the compare",
    discrimination.zero === true && discrimination.digestsMatch === true,
    "hit=" + discrimination.zero + " digestsMatch=" + discrimination.digestsMatch);

  const capped = run(`
    (function(){
      var memo=makeLpMemo(),width=600,rows=40,stored=0,tried=0;
      // Each entry is ~8*(rows*width) bytes, so a few hundred of these must run into the cap.
      for(var k=0;k<400;k++){
        var c=new Array(width).fill(0);c[k%width]=1;
        var A=[],b=[];
        for(var i=0;i<rows;i++){var row=new Array(width).fill(0);row[i%width]=1+k*1e-6;A.push(row);b.push(1+i);}
        tried++;memo.store(c,A,b,{x:new Float64Array(width),complete:true,unbounded:false});
        if(memo.stats().entries>stored)stored=memo.stats().entries;
        else break;
      }
      return {tried:tried,stored:stored,bytes:memo.stats().bytes,cap:LP_MEMO_MAX_BYTES};
    })()
  `);
  check("the table stops storing at its byte cap instead of growing without bound",
    capped.stored < capped.tried && capped.bytes <= capped.cap,
    "stored=" + capped.stored + " of " + capped.tried + " attempts, bytes=" + capped.bytes + " cap=" + capped.cap);
}

/* ---- 4: the real line-switching Project run ------------------------------------------------ */

/* Count what is PRESENTED to the memo (solveScheduleLP) against what is actually SOLVED
 * (lpMaximize), and digest every presentation so the distinct-tableau count is a fact about the run
 * rather than about the memo. Disabling the memo has to leave both counts and the plan alone
 * except for the solves the memo removed.
 *
 * `solved` counts only the lpMaximize calls reached THROUGH a presentation. A line-switching run
 * also solves the no-switch candidate when its own plan carries a warm-up (issue #150), and that
 * candidate's discrete search calls lpMaximize directly — never through solveScheduleLP, so the memo
 * neither sees nor could dedupe those. Counting them here would measure the search, not the memo. */
const INSTRUMENT = `
(function(){
  var rawSolve=solveScheduleLP,rawLp=lpMaximize,presenting=0;
  __probe={presented:0,solved:0,digests:[]};
  solveScheduleLP=function(part,control,memo){
    __probe.presented++;__probe.digests.push(lpTableauDigest(part.c,part.A,part.b));
    presenting++;try{return rawSolve(part,control,memo);}finally{presenting--;}
  };
  lpMaximize=function(c,A,b,control,opts){if(presenting>0)__probe.solved++;return rawLp(c,A,b,control,opts);};
  if(__disableMemo)makeLpMemo=function(){return null;};
})();
`;

function projectRun(disableMemo) {
  const context = realm();
  context.__stateJson = JSON.stringify(materialize(fixtureById("project-split-7line")));
  vm.runInContext(`
    (function(){
      var checked=validateWorkerState(JSON.parse(__stateJson));
      if(!checked.ok)throw new Error("fixture rejected: "+checked.errors.join("; "));
      commitState(checked.state);
    })()
  `, context, { filename: "lp-memo-load" });
  vm.runInContext("__disableMemo=" + (disableMemo ? "true" : "false") + ";", context, { filename: "lp-memo-flag" });
  vm.runInContext(INSTRUMENT, context, { filename: "lp-memo-instrument" });
  // Warm: the hidden prefer-current comparison only runs once the stability cache holds a record,
  // and that second complete run is where the repeated tableaux come from.
  vm.runInContext("optimize();", context, { filename: "lp-memo-seed" });
  vm.runInContext("__probe.presented=0;__probe.solved=0;__probe.digests=[];", context, { filename: "lp-memo-reset" });
  const result = vm.runInContext("JSON.stringify(optimize(),function(k,v){return k===\"ms\"?0:v;});", context, { filename: "lp-memo-solve" });
  const probe = vm.runInContext("JSON.stringify({presented:__probe.presented,solved:__probe.solved,distinct:new Set(__probe.digests).size});",
    context, { filename: "lp-memo-probe" });
  return { result, probe: JSON.parse(probe) };
}

{
  const memoized = projectRun(false);
  const plain = projectRun(true);
  check("the memo leaves the line-switching Project result byte-identical",
    memoized.result === plain.result,
    memoized.result === plain.result ? memoized.result.length + " bytes of result JSON"
      : "results differ at " + [...memoized.result].findIndex((ch, i) => ch !== plain.result[i]));
  check("the memo changes nothing about which tableaux the run builds",
    memoized.probe.presented === plain.probe.presented && memoized.probe.distinct === plain.probe.distinct,
    "presented " + memoized.probe.presented + " vs " + plain.probe.presented +
    ", distinct " + memoized.probe.distinct + " vs " + plain.probe.distinct);
  check("without the memo every presentation is solved",
    plain.probe.solved === plain.probe.presented,
    "solved=" + plain.probe.solved + " presented=" + plain.probe.presented);
  check("with the memo every distinct tableau is solved exactly once, and repeats are not",
    memoized.probe.solved === memoized.probe.distinct && memoized.probe.solved < plain.probe.solved,
    "solved=" + memoized.probe.solved + " distinct=" + memoized.probe.distinct +
    " (unmemoized " + plain.probe.solved + ")");
}

console.log(failures ? "\n" + failures + " LP memo check(s) failed" : "\nall LP memo checks passed");
process.exitCode = failures ? 1 : 0;
