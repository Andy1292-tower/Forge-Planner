"use strict";
/* Max Items keeps the plan on screen when a re-solve gains nothing (issue #196).
 *
 * The fixture is the reporter's save trimmed to what Max Items reads: seven lines, Batteries as the
 * only output, Line 7 at 512x. Raising Line 7 to 1024x adds nothing, since Gel is only a feeder and
 * its lines already cover the Batteries line with room to spare, but the search reaches a different
 * tie of the same 996.71 Batteries/hr and moved three lines.
 *
 * Verifies, in the solver:
 *  - both layouts from the issue score the same on the upgraded factory, and the one on screen is
 *    returned with the new cap shown and its numbers rebuilt;
 *  - the full search: after the upgrade the shown lines are the ones shown before it, and a search
 *    cut short below that plan's output does not replace it;
 *  - any output above float rounding replaces the kept plan, and a productive upgrade is adopted;
 *  - an assignment a line can no longer run, an infeasible one, or one for other outputs is refused;
 *  - a raw feeder at a level the search no longer offers on its line is still scored;
 * and in the solve service:
 *  - upgrade, Resimulate twice and a daily-cache hit all show the same lines;
 *  - the cache holds the kept plan without the "kept" flag;
 *  - another input change, cancel() (import, reset, Manual) and a mode switch all stop the keep;
 *  - the service's own drop of an out-of-date solve does not;
 *  - a result without weights (cached before they were recorded) is shown as it came.
 *
 * Usage: node test/items-keep-plan.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SOURCES = [
  "js/decimal.js", "js/catalog.js", "js/ledgers.js", "js/core.js", "js/fields.js",
  "js/state.js", "js/project-schedule.js", "js/solver.js",
];
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/state/upgrade-keeps-plan.json"), "utf8"));
/* Frozen clock plus a work cap, so the searches below are reproducible (see TESTING.md). On this
 * fixture 4M and 8M return byte-identical plans for both caps; 2M stops the 1024x solve at
 * 969.66/hr, below the 996.71 the 512x plan makes, which is the cut-short case. */
const FULL_WORK = 4000000;
const SHORT_WORK = 2000000;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}

class FakeElement { constructor() { this.hidden = true; this.textContent = ""; this.innerHTML = ""; } }

function realm(withService) {
  const workers = [];
  const timers = [];
  const storage = new Map();
  class FakeWorker {
    constructor(url) { this.url = url; this.messages = []; this.terminated = false; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(res) {
      const sent = this.messages[this.messages.length - 1];
      this.onmessage({ data: { reqId: sent.reqId, generation: sent.generation, mode: sent.mode,
        stateRevision: sent.stateRevision, res: JSON.parse(JSON.stringify(res)) } });
    }
  }
  const elements = { solveOverlay: new FakeElement(), solveFallback: new FakeElement() };
  const context = vm.createContext({
    console, Worker: FakeWorker,
    performance: { now: () => 0 },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    document: { getElementById(id) { return elements[id] || null; } },
  });
  const files = withService ? SOURCES.concat("js/solve-service.js") : SOURCES;
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  return { context, workers, storage, run: code => vm.runInContext(code, context) };
}

const assignmentText = plan => plan.map(row => row.job.kind === "idle" ? "idle" : row.job.res + "@" + row.job.lvl).join(" ");
// The two layouts in the issue, line by line.
const LAYOUT_512 = ["Batteries@1", "Gel@16384", "Gel@16384", "Gel@8192", "Gel@4096", "idle", "Gel@512"];
const LAYOUT_1024 = ["Batteries@1", "Gel@16384", "Gel@16384", "Gel@8192", "Gel@2048", "Gel@2048", "idle"];
const asAssignment = layout => layout.map(job => {
  if (job === "idle") return null;
  const [res, lvl] = job.split("@");
  return { kind: "craft", res, lvl: Number(lvl) };
});

/* ---- 1. the solver on the issue's own layouts, no search ------------------------------------ */
{
  const { context, run } = realm(false);
  context.__FIXTURE = FIXTURE;
  context.__A = asAssignment(LAYOUT_512);
  context.__B = asAssignment(LAYOUT_1024);
  const r = JSON.parse(run(`(function(){
    S=JSON.parse(JSON.stringify(__FIXTURE));normalize(S);
    const at512=itemsAssignmentResult(__A,[1]);
    S=JSON.parse(JSON.stringify(__FIXTURE));S.lines[6].max=1024;normalize(S);
    const a=itemsAssignmentResult(__A,[1]),b=itemsAssignmentResult(__B,[1]);
    const kept=keptItemsResult(b,itemsAssignmentOf(a.plan));
    const same=keptItemsResult(a,itemsAssignmentOf(a.plan));
    // Any rise in output above float rounding replaces the kept plan; a few ulps do not.
    const nudge=factor=>Object.assign({},b,{out:{Batteries:b.out.Batteries*factor}});
    const real=keptItemsResult(nudge(1+1e-12),itemsAssignmentOf(a.plan));
    const ulps=keptItemsResult(nudge(1+4*Number.EPSILON),itemsAssignmentOf(a.plan));
    // An assignment the factory cannot run, or cannot sustain, or for other outputs.
    const overCap=__A.slice();overCap[6]={kind:"craft",res:"Gel",lvl:2048};
    const starved=__A.map((job,i)=>i===0?job:null);
    const otherOutputs=Object.assign({},b,{targets:["Gel"],weights:[1]});
    return JSON.stringify({a,b,at512,kept,same,real:real===null,ulps:ulps!==null,
      overCap:itemsAssignmentResult(overCap,[1]),overCapKept:keptItemsResult(b,overCap),
      starvedKept:keptItemsResult(b,starved),starved:itemsAssignmentResult(starved,[1]),
      shortAssignment:keptItemsResult(b,__A.slice(0,6)),otherOutputs:keptItemsResult(otherOutputs,__A)});
  })()`));
  check("both issue layouts run on the 1024x factory", r.a.feasible && r.b.feasible,
    r.a.out.Batteries + " / " + r.b.out.Batteries);
  check("both issue layouts make the same Batteries/hr", r.a.out.Batteries === r.b.out.Batteries,
    r.a.out.Batteries + " vs " + r.b.out.Batteries);
  check("the plan on screen is kept over a different layout of the same output",
    r.kept && assignmentText(r.kept.plan) === LAYOUT_512.join(" "), r.kept ? assignmentText(r.kept.plan) : "null");
  check("the kept plan is flagged as kept", r.kept && r.kept.keptAssignment === true);
  check("the kept plan shows Line 7's new 1024x cap", r.kept && r.kept.plan[6].max === 1024, r.kept && r.kept.plan[6].max);
  check("the kept plan's output, balance and mined use are rebuilt, unchanged by the cap",
    r.kept && r.kept.out.Batteries === r.at512.out.Batteries &&
    JSON.stringify(r.kept.balance) === JSON.stringify(r.at512.balance) &&
    JSON.stringify(r.kept.minedUsage) === JSON.stringify(r.at512.minedUsage));
  check("nothing is kept when the new result already has the same lines", r.same === null);
  check("a rise of one part in 1e12 replaces the kept plan", r.real);
  check("a few ulps of rounding do not", r.ulps);
  check("a job above its line's cap is refused", r.overCap === null && r.overCapKept === null);
  check("an assignment that leaves the Batteries line without Gel is not kept",
    r.starvedKept === null && r.starved && r.starved.feasible === false);
  check("an assignment for a different line count is not kept", r.shortAssignment === null);
  check("an assignment is not kept against a result for other outputs", r.otherOutputs === null);
}

/* ---- 2. the solver with its search, as the Worker runs it ------------------------------------ */
{
  const { context, run } = realm(false);
  context.__FIXTURE = FIXTURE;
  const r = JSON.parse(run(`(function(){
    const solve=(max,work)=>{S=JSON.parse(JSON.stringify(__FIXTURE));S.lines[6].max=max;normalize(S);
      return JSON.parse(JSON.stringify(optimize({now:()=>0,workLimit:work})));};
    const before=solve(512,${FULL_WORK}),after=solve(1024,${FULL_WORK}),short=solve(1024,${SHORT_WORK});
    // keptItemsResult reads the live factory, which is the 1024x one the last solve left behind.
    const keptAfter=keptItemsResult(after,itemsAssignmentOf(before.plan));
    const keptShort=keptItemsResult(short,itemsAssignmentOf(before.plan));
    return JSON.stringify({before,after,short,keptAfter,keptShort});
  })()`));
  const shownAfter = r.keptAfter || r.after;
  check("after the upgrade the search's lines are shown as they were before it",
    assignmentText(shownAfter.plan) === assignmentText(r.before.plan),
    assignmentText(r.before.plan) + " -> " + assignmentText(shownAfter.plan) + " (search: " + assignmentText(r.after.plan) + ")");
  check("and at the same Batteries/hr", shownAfter.out.Batteries === r.before.out.Batteries,
    r.before.out.Batteries + " -> " + shownAfter.out.Batteries);
  check("the result carries the weights it scored against", Array.isArray(r.after.weights) && r.after.weights[0] === 1);
  const shownShort = r.keptShort || r.short;
  check("a search cut short below the plan on screen does not replace it",
    assignmentText(shownShort.plan) === assignmentText(r.before.plan) && shownShort.out.Batteries >= r.short.out.Batteries,
    "search " + r.short.out.Batteries + ", shown " + shownShort.out.Batteries);
  check("the kept plan reports the search's own completion state", !r.keptShort || r.keptShort.capped === r.short.capped);
}

/* ---- 3. a productive upgrade, and a raw feeder ----------------------------------------------- */
{
  const { run } = realm(false);
  const r = JSON.parse(run(`(function(){
    // Two lines: one producing Ingots, one crafting Plates from them, with no passive supply.
    const solve=maxes=>{S=defaults();S.mode="items";S.dupe=0;S.lines=maxes.map(max=>({max,spx:1,turbo:0}));
      Object.keys(S.targets).forEach(item=>{S.targets[item].on=false;});S.targets.Plates={on:true,w:1,share:100};
      Object.keys(S.forgie).forEach(item=>{S.forgie[item]=0;});normalize(S);
      return JSON.parse(JSON.stringify(optimize({now:()=>0,workLimit:${SHORT_WORK}})));};
    const base=solve([4,4]);
    const ingotsLineUp=solve([8,4]);
    const rawKept=keptItemsResult(ingotsLineUp,itemsAssignmentOf(base.plan));
    // At 16x the Ingots line feeds Plates@4: 213.33/hr against 160.
    const bigUpgrade=solve([16,4]);
    const productive=keptItemsResult(bigUpgrade,itemsAssignmentOf(base.plan));
    return JSON.stringify({base,ingotsLineUp,rawKept,bigUpgrade,productive});
  })()`));
  const ingotsJob = plan => plan.map(row => row.job).find(job => job.kind === "produce" && job.res === "Ingots");
  check("the fixture's feeder line produces Ingots at its 4x cap", ingotsJob(r.base.plan) && ingotsJob(r.base.plan).lvl === 4,
    assignmentText(r.base.plan));
  check("raising that line to 8x moves the search to Ingots@8", ingotsJob(r.ingotsLineUp.plan) && ingotsJob(r.ingotsLineUp.plan).lvl === 8,
    assignmentText(r.ingotsLineUp.plan));
  check("Ingots@4 is still scored on the 8x line, though the search offers 8x only, and kept",
    r.rawKept && assignmentText(r.rawKept.plan) === assignmentText(r.base.plan) && r.rawKept.out.Plates === r.ingotsLineUp.out.Plates,
    r.rawKept ? assignmentText(r.rawKept.plan) + " " + r.rawKept.out.Plates : "null");
  check("an upgrade that raises output is adopted", r.bigUpgrade.out.Plates > r.base.out.Plates && r.productive === null,
    r.base.out.Plates + " -> " + r.bigUpgrade.out.Plates + " " + assignmentText(r.bigUpgrade.plan));
}

/* ---- 4. the solve service ---------------------------------------------------------------------- */
{
  const page = realm(true);
  const { context, workers, storage, run } = page;
  context.__FIXTURE = FIXTURE;
  // Fresh results for each factory, solved once in this realm exactly as the Worker would.
  const fresh = JSON.parse(run(`(function(){
    const solve=mutate=>{S=JSON.parse(JSON.stringify(__FIXTURE));mutate(S);normalize(S);
      return JSON.parse(JSON.stringify(optimize({now:()=>0,workLimit:${FULL_WORK}})));};
    return JSON.stringify({at512:solve(()=>{}),at1024:solve(s=>{s.lines[6].max=1024;})});
  })()`));
  const delivered = [];
  context.__delivered = delivered;
  let revision = 0;
  const setFactory = mutate => {
    context.__mutate = mutate;
    run(`S=JSON.parse(JSON.stringify(__FIXTURE));__mutate(S);normalize(S);`);
  };
  const request = (forceFresh, mode = "items") => {
    revision += 1;
    context.__options = { mode, stateRevision: revision, forceFresh };
    run(`(function(){const snapshot=solveStateSnapshot(S);
      solveService.request(Object.assign({},__options,{budget:snapshot.solveBudget,stateSnapshot:snapshot}),
        (res,error,metadata)=>__delivered.push({res,error,cached:!!(metadata&&metadata.cached)}));})()`);
  };
  const lastWorker = () => workers.find(worker => !worker.terminated) || workers[workers.length - 1];
  const reply = res => lastWorker().reply(res);
  const last = () => delivered[delivered.length - 1];
  const cachedPlans = () => {
    const raw = storage.get("forgePlannerMaxItemsCache_v1");
    return raw ? JSON.parse(raw).entries.map(entry => entry.result) : [];
  };
  const shows = (label, expectedLayout, kept) => {
    const shown = last().res;
    check(label, shown && assignmentText(shown.plan) === assignmentText(expectedLayout) && (shown.keptAssignment === true) === kept,
      shown ? assignmentText(shown.plan) + (shown.keptAssignment ? " (kept)" : "") : "nothing delivered");
  };
  const up = s => { s.lines[6].max = 1024; };
  const A = fresh.at512.plan, B = fresh.at1024.plan;
  check("the fresh searches pick different layouts, so the keep is exercised", assignmentText(A) !== assignmentText(B),
    assignmentText(A) + " | " + assignmentText(B));

  setFactory(() => {}); request(true); reply(fresh.at512);
  shows("the 512x solve is shown as solved", A, false);

  setFactory(up); request(true); reply(fresh.at1024);
  shows("after the upgrade, the 512x lines are shown", A, true);
  check("with Line 7 at its new cap", last().res.plan[6].max === 1024);
  const stored = cachedPlans().find(result => result.plan[6].max === 1024);
  check("the daily cache holds the kept lines, without the kept flag",
    stored && assignmentText(stored.plan) === assignmentText(A) && !("keptAssignment" in stored));

  request(true); reply(fresh.at1024);
  shows("Resimulate shows the same lines", A, true);
  request(true); reply(fresh.at1024);
  shows("Resimulate again shows the same lines", A, true);

  request(false);
  check("a daily-cache hit is delivered without a Worker", last().cached === true);
  shows("and shows the same lines, with nothing to keep", A, false);

  // The service dropping a solve whose inputs moved on does not forget the plan on screen. The
  // sell price is outside what Max Items reads, so the next solve is still for the same factory.
  request(true);
  run(`S.sellPrice.Ingots=new Decimal(7);`);
  const before = delivered.length;
  reply(fresh.at1024);
  check("an out-of-date solve is dropped", delivered.length === before);
  request(true); reply(fresh.at1024);
  shows("and the next solve still keeps the lines on screen", A, true);

  // Any other input change: the plan on screen is not offered back.
  setFactory(s => { up(s); s.lines[5].spx = 14000; }); request(true); reply(fresh.at1024);
  shows("a line speed change shows the new search's lines", B, false);

  // cancel() forgets the plan: import, reset and Manual all cancel. Each setup below cancels first,
  // so the 512x lines go on screen as delivered rather than being measured against what was there.
  const aOn1024 = Object.assign({}, fresh.at1024, { plan: A.map(row => Object.assign({}, row, { max: row.line === 7 ? 1024 : row.max })) });
  const showA = label => { run(`solveService.cancel("Reset is replacing accepted state");`); request(true); reply(aOn1024); shows(label, A, false); };
  setFactory(up);
  showA("setup: the 512x lines are on screen for the 1024x factory");
  run(`solveService.cancel("Import is replacing accepted state");`);
  request(true); reply(fresh.at1024);
  shows("after cancel(), the new search's lines are shown", B, false);

  // A mode switch forgets it too.
  showA("setup: the 512x lines are on screen again");
  run(`S.mode="credits";`); request(true, "credits");
  run(`S.mode="items";`); request(true); reply(fresh.at1024);
  shows("after a mode switch, the new search's lines are shown", B, false);

  // A cached result from before weights were recorded is shown as it came.
  showA("setup: the 512x lines are on screen once more");
  const noWeights = Object.assign({}, fresh.at1024); delete noWeights.weights;
  request(true); reply(noWeights);
  shows("a result without weights is shown as it came", B, false);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
