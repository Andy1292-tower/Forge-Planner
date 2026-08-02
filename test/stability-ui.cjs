"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const root = path.resolve(__dirname, "..");
const coreSrc = fs.readFileSync(path.join(root, "js", "core.js"), "utf8");
const scheduleSrc = fs.readFileSync(path.join(root, "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(root, "js", "solver.js"), "utf8");

const runner = `
(function(){
  const checks=[];
  function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error&&error.message||String(error)});}}
  const LINES=[
    {max:512,spx:50.0,turbo:0},{max:512,spx:49.5,turbo:0},
    {max:256,spx:48.0,turbo:0},{max:256,spx:47.0,turbo:0},{max:128,spx:46.0,turbo:0}
  ];
  function state(frames,policy,projectId){const s=defaults();s.dupe=0;s.margin=0;s.mode="project";s.projectSeq=false;s.projectGate=false;
    s.projectStability=policy||"prefer-current";s.lines=JSON.parse(JSON.stringify(LINES));
    s.projects=[{id:projectId||"frames-project",name:"Frames plan",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Frames",qty:frames},{item:"Bricks",qty:5000},{item:"Glass",qty:4000},{item:"Rods",qty:3000}]}]}];
    normalize(s);syncManual(s);return s;}
  function solve(frames,policy,projectId){S=state(frames,policy,projectId);return optimizeProjectTop();}
  function close(actual,expected,tolerance,label){assert.ok(Math.abs(actual-expected)<=tolerance,label+" actual="+actual+" expected="+expected);}

  check("projectSchedule is pure and proposes rather than commits a record",()=>{
    resetLineStability();const sentinel={sentinel:{0:["Bits@1"]}};setLineStability(JSON.parse(JSON.stringify(sentinel)));
    S=state(200,"prefer-current");const demand=projectDemand();const targets=ALLITEMS.filter(item=>demand.net[item]>1e-9);
    const incoming=JSON.parse(JSON.stringify(sentinel)),before=JSON.stringify(incoming);
    const scheduled=projectSchedule(demand.net,targets,{},
      {phaseKey:"direct-phase",readStability:true,rememberStability:true,stabilityCache:incoming});
    assert.equal(JSON.stringify(incoming),before,"incoming cache mutated");
    assert.deepEqual(getLineStability(),sentinel,"global cache mutated before controller commit");
    assert.ok(scheduled.stabilityKey&&scheduled.stabilityUpdate,"missing proposed record");
  });

  resetLineStability();setLineStability({sentinel:{0:["Bits@1"]}});
  const baseline=solve(200,"prefer-current");
  const baselineCache=JSON.parse(JSON.stringify(getLineStability()));
  const held=solve(420,"prefer-current");

  check("successful visible solve commits only selected records while preserving unrelated cache",()=>{
    assert.deepEqual(getLineStability().sentinel,{0:["Bits@1"]});
    assert.equal(Object.keys(baselineCache).length,2,"baseline should add one semantic phase record");
    assert.equal(Object.keys(getLineStability()).length,2,"hidden comparison leaked an extra key");
    const phase=held.phases[0],update=makeLineStabilityUpdate(phase.stabilityKey,phase.plan);
    assert.deepEqual(getLineStability()[update.key],update.record,"hidden/free work overwrote the held selected record");
  });

  check("420 Frames exposes the complete executable held-versus-reoptimized tradeoff",()=>{
    assert.equal(baseline.projectStability,"prefer-current");
    assert.equal(held.projectStability,"prefer-current");
    assert.equal(held.phases[0].phaseKey,"frames-project");
    assert.equal(held.phases[0].stabilized,true);
    const comparison=held.stabilityComparison;
    assert.ok(comparison,"held phase must receive a hidden full-run comparison");
    assert.equal(comparison.comparable,true);
    assert.equal(comparison.selectedExecutable,true);
    assert.equal(comparison.alternativeExecutable,true);
    assert.deepEqual(comparison.selectedPhaseOrder,["frames-project"]);
    assert.deepEqual(comparison.alternativePhaseOrder,["frames-project"]);
    assert.equal(comparison.orderChanged,false);
    assert.equal(comparison.alternativeIsShorter,false);
    assert.equal(Object.hasOwn(comparison,"alternativePlan"),false,"hidden plan escaped the summary boundary");
    assert.equal(comparison.phases.length,1);
    const phase=comparison.phases[0];
    assert.equal(phase.phaseKey,"frames-project");
    close(phase.selectedThroughputLossPct,2.6304,0.001,"throughput loss %");
    close(phase.selectedEtaPenaltyPct,2.7015,0.001,"phase ETA penalty %");
    close(comparison.selectedTotalEta,0.6659750249,5e-8,"held total ETA");
    close(comparison.alternativeTotalEta,0.6846583163,5e-8,"reoptimized total ETA");
    close(comparison.alternativeMinusSelectedTotalEta*3600,67.26,0.05,"total ETA difference seconds");
    close(comparison.alternativeMinusSelectedWarmupEta*3600,129.94,0.05,"warm-up difference seconds");
    assert.equal(held.scheduleValidation.ok,true);
    assert.equal(held.scheduleValidation.firstFailure,null);
    held.scheduleValidation.boundaries.forEach(boundary=>{const values=Object.values(boundary.inventory||{}),scale=Math.max(1,...values.map(Math.abs));
      const tolerance=1e-8+Number.EPSILON*32*scale;
      values.forEach(value=>assert.ok(value>=-tolerance,"inventory below replay tolerance: "+value+" < "+(-tolerance)));});
  });

  check("prototype-like Project IDs keep the 200-to-420 held comparison exact and executable",()=>{
    for(const projectId of ["constructor","toString"]){
      resetLineStability();solve(200,"prefer-current",projectId);
      const prototypeHeld=solve(420,"prefer-current",projectId),comparison=prototypeHeld.stabilityComparison;
      assert.equal(prototypeHeld.phases[0].stabilized,true,projectId+" did not hold its selected jobs");
      assert.ok(comparison,projectId+" did not receive a hidden comparison");
      assert.equal(comparison.comparable,true,projectId+" comparison was not comparable");
      assert.equal(comparison.selectedExecutable,true,projectId+" selected run was not executable");
      assert.equal(comparison.alternativeExecutable,true,projectId+" alternative run was not executable");
      assert.deepEqual(comparison.selectedPhaseOrder,[projectId]);
      assert.deepEqual(comparison.alternativePhaseOrder,[projectId]);
      assert.deepEqual(comparison.phases.map(phase=>phase.phaseKey),[projectId]);
    }
  });

  check("reoptimize ignores pins, skips a hidden comparison, and remembers its selected jobs",()=>{
    setLineStability(JSON.parse(JSON.stringify(baselineCache)));
    const free=solve(420,"reoptimize");
    assert.equal(free.projectStability,"reoptimize");
    assert.equal(free.phases[0].stabilized,false);
    assert.equal(free.stabilityComparison,null);
    const update=makeLineStabilityUpdate(free.phases[0].stabilityKey,free.phases[0].plan);
    assert.deepEqual(getLineStability()[update.key],update.record);
  });

  check("past-band demand still releases a prefer-current pin",()=>{
    resetLineStability();solve(200,"prefer-current");const released=solve(500,"prefer-current");
    assert.equal(released.phases[0].stabilized,false);
    assert.equal(released.stabilityComparison,null);
  });

  check("repeated held runs remain held without hidden, fixed-point, ordering, or warm-up cache writes",()=>{
    resetLineStability();setLineStability({sentinel:{0:["Bits@1"]}});solve(200,"prefer-current");
    const first=solve(420,"prefer-current"),firstCache=JSON.parse(JSON.stringify(getLineStability()));
    const second=solve(420,"prefer-current");
    assert.equal(first.phases[0].stabilized,true);assert.equal(second.phases[0].stabilized,true);
    assert.equal(Object.keys(getLineStability()).length,2,"non-semantic work created cache records");
    assert.deepEqual(getLineStability(),firstCache,"a repeated selected held plan did not stay stable");
  });

  check("an LP-partial selected run cannot replace the previous-good cache",()=>{
    resetLineStability();const sentinel={previous:{0:["Glass@1"]}};setLineStability(JSON.parse(JSON.stringify(sentinel)));
    const s=defaults();s.mode="project";s.projectSeq=false;s.projectGate=false;s.projectStability="prefer-current";
    s.projects=[{id:"partial-project",name:"Partial",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Glass",qty:100},{item:"Batteries",qty:1}]}]}];
    normalize(s);syncManual(s);S=s;const partial=optimizeProjectTop();
    assert.equal(partial.lpFeasible,false);assert.equal(partial.partial,true);
    assert.equal(projectRunExecutable(partial),false);
    assert.deepEqual(getLineStability(),sentinel);
  });

  check("sequenced and wave phase keys use project IDs rather than duplicate display names or indexes",()=>{
    resetLineStability();let s=defaults();s.mode="project";s.projectSeq=true;s.projectStability="reoptimize";
    s.projects=[
      {id:"project-x",name:"Duplicate",catId:"",on:true,from:1,to:1,done:0,prio:1,levels:[{costs:[{item:"Glass",qty:100}]}]},
      {id:"project-y",name:"Duplicate",catId:"",on:true,from:1,to:1,done:0,prio:2,levels:[{costs:[{item:"Bricks",qty:100}]}]}
    ];normalize(s);syncManual(s);S=s;const sequenced=optimizeProjectTop();
    assert.deepEqual(sequenced.phases.map(phase=>phase.phaseKey),["project-x","project-y"]);

    resetLineStability();s=defaults();s.mode="project";s.projectSeq=false;s.projectGate=true;s.projectStability="reoptimize";
    s.projects=[
      {id:"z-unlocker",name:"Duplicate",catId:"frame-factory",on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:"Glass",qty:100}]}]},
      {id:"a-peer",name:"Duplicate",catId:"",on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:"Bricks",qty:100}]}]},
      {id:"b-consumer",name:"Duplicate",catId:"",on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:"Frames",qty:100}]}]}
    ];normalize(s);syncManual(s);S=s;const waved=optimizeProjectTop();
    assert.equal(waved.waved,true);assert.deepEqual(waved.phases.map(phase=>phase.phaseKey),["a-peer+z-unlocker","b-consumer"]);
  });

  const failed=checks.filter(result=>!result.ok);
  checks.forEach(result=>console.log((result.ok?"ok   ":"FAIL ")+result.name+(result.ok?"":"  ["+result.error+"]")));
  if(failed.length)throw new Error(failed.length+"/"+checks.length+" stability contract checks failed");
})();
`;

eval(coreSrc + "\n;\n" + scheduleSrc + "\n;\n" + solverSrc + "\n;\n" + runner);

const resultsSrc = fs.readFileSync(path.join(root, "js", "results.js"), "utf8");
const stabilityRenderStart = resultsSrc.indexOf("function projectStabilityHtml(res){");
const stabilityRenderEnd = resultsSrc.indexOf("function renderProjectResults(res,el,stat){", stabilityRenderStart);
assert.ok(stabilityRenderStart >= 0 && stabilityRenderEnd > stabilityRenderStart,
  "Project stability summary renderer must remain independently testable");
const escapeHtml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
const projectStabilityHtml = Function("htmlText", "disp", "fmtDuration", "throughputCompareEpsilon", "etaCompareEpsilon", "Number",
  resultsSrc.slice(stabilityRenderStart, stabilityRenderEnd) + "\nreturn projectStabilityHtml;")(
    escapeHtml, value => String(Number(value).toFixed(4)), value => `${Number(value * 3600).toFixed(2)}s`,
    (a,b) => Math.max(1e-9,Number.EPSILON*64*Math.max(1,Math.abs(a||0),Math.abs(b||0))),
    (a,b) => Math.max(1e-9,Number.EPSILON*64*Math.max(1,Math.abs(a||0),Math.abs(b||0))), Number);

const comparison = overrides => ({
  comparable: true, selectedExecutable: true, alternativeExecutable: true,
  selectedPhaseOrder: ["phase-a", "phase-b"], alternativePhaseOrder: ["phase-a", "phase-b"], orderChanged: false,
  selectedTotalEta: 1, alternativeTotalEta: 1.1, alternativeMinusSelectedTotalEta: 0.1,
  selectedWorkEta: 0.8, alternativeWorkEta: 0.7, alternativeMinusSelectedWorkEta: -0.1,
  selectedWarmupEta: 0.2, alternativeWarmupEta: 0.4, alternativeMinusSelectedWarmupEta: 0.2,
  alternativeIsShorter: false,
  phases: [
    { phaseKey: "phase-a", name: "Alpha", selectedThroughput: 90, alternativeThroughput: 100,
      selectedEta: 0.5, alternativeEta: 0.45, selectedThroughputLossPct: 10, selectedEtaPenaltyPct: 11.111 },
    { phaseKey: "phase-b", name: "Beta", selectedThroughput: 95, alternativeThroughput: 100,
      selectedEta: 0.3, alternativeEta: 0.285, selectedThroughputLossPct: 5, selectedEtaPenaltyPct: 5.263 },
  ],
  ...overrides,
});

{
  const html = projectStabilityHtml({ projectStability: "prefer-current", stabilityComparison: comparison() });
  assert.match(html, /Current line jobs retained/);
  assert.match(html, /Alpha/);assert.match(html, /Beta/);
  assert.match(html, /selected complete ETA/i);assert.match(html, /re-optimized complete ETA/i);
  assert.match(html, /warm-up/i);assert.match(html, /phase order/i);
  assert.match(html, /Use higher-throughput line jobs anyway/);
  assert.doesNotMatch(html, /<button[^>]*>\s*Current line jobs retained/i,
    "selected state is text rather than a no-op button");
}

{
  const shorter = comparison({ alternativeTotalEta: 0.9, alternativeMinusSelectedTotalEta: -0.1, alternativeIsShorter: true });
  assert.match(projectStabilityHtml({ projectStability: "prefer-current", stabilityComparison: shorter }),
    /Use shorter re-optimized plan/);
}

{
  const equal = comparison({ phases: comparison().phases.map(phase => ({ ...phase,
    selectedThroughput: 100, alternativeThroughput: 100, selectedThroughputLossPct: 0 })) });
  const equalHtml = projectStabilityHtml({ projectStability: "prefer-current", stabilityComparison: equal });
  assert.match(equalHtml, /Use re-optimized line jobs anyway/);
  assert.doesNotMatch(equalHtml, /higher-throughput/i);

  const mixed = comparison({ phases: [comparison().phases[0], { ...comparison().phases[1],
    selectedThroughput: 105, alternativeThroughput: 100, selectedThroughputLossPct: -5 }] });
  const mixedHtml = projectStabilityHtml({ projectStability: "prefer-current", stabilityComparison: mixed });
  assert.match(mixedHtml, /Use re-optimized line jobs anyway/);
  assert.match(mixedHtml, /Alpha/);assert.match(mixedHtml, /Beta/);
}

{
  const unsafe = comparison({ comparable: false, alternativeExecutable: false,
    phases: [{ ...comparison().phases[0], name: '<img src=x onerror="boom">' }] });
  const html = projectStabilityHtml({ projectStability: "prefer-current", stabilityComparison: unsafe });
  assert.match(html, /safe full comparison is unavailable/i);
  assert.doesNotMatch(html, /data-project-stability="reoptimize"/);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img/);
}

assert.match(projectStabilityHtml({ projectStability: "reoptimize", stabilityComparison: null }),
  /Prefer current line jobs on future edits/);

const eventsSrc = fs.readFileSync(path.join(root, "js", "events.js"), "utf8");
const policyStart = eventsSrc.indexOf("function setProjectStabilityPolicy(value){");
const policyEnd = eventsSrc.indexOf("function renderProjects(){", policyStart);
assert.ok(policyStart >= 0 && policyEnd > policyStart, "shared Project stability event helper must remain testable");
let policyState = { projectStability: "prefer-current" }, mutations = 0, saves = 0, solves = 0;
const setProjectStabilityPolicy = Function("S", "mutateState", "save", "doSolve",
  eventsSrc.slice(policyStart, policyEnd) + "\nreturn setProjectStabilityPolicy;")(
    policyState, mutator => { mutations++;mutator(policyState); }, () => { saves++; }, () => { solves++; });
assert.equal(setProjectStabilityPolicy("fastest"), false);
assert.deepEqual({ mutations, saves, solves }, { mutations: 0, saves: 0, solves: 0 });
assert.equal(setProjectStabilityPolicy("reoptimize"), true);
assert.equal(policyState.projectStability, "reoptimize");
assert.deepEqual({ mutations, saves, solves }, { mutations: 1, saves: 1, solves: 1 });

const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const projectModal = indexHtml.slice(indexHtml.indexOf('id="projModal"'), indexHtml.indexOf('id="progModal"'));
assert.match(projectModal, /<label for="projectStability">Line-job policy<\/label>/);
assert.match(projectModal, /<select id="projectStability" aria-describedby="projectStabilityHelp">/);
assert.match(projectModal, /id="projectStabilityHelp"/);
assert.match(projectModal, /5%/);assert.match(projectModal, /warm-up|warm-ups/i);
assert.doesNotMatch(projectModal, /\b(?:fastest|optimal)\b/i);
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const projectReadmeLine = readme.split("\n").find(line => line.includes("Project plan + shopping list")) || "";
assert.doesNotMatch(projectReadmeLine, /\b(?:fastest|optimal)\b/i);

console.log("stability UI contracts: ok");
