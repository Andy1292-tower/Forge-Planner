"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const root = path.resolve(__dirname, "..");
const coreSrc = fs.readFileSync(path.join(root, "js", "core.js"), "utf8");
const projectPath = path.join(root, "js", "project-schedule.js");
const projectSrc = fs.existsSync(projectPath) ? fs.readFileSync(projectPath, "utf8") : "";
const solverSrc = fs.readFileSync(path.join(root, "js", "solver.js"), "utf8");

const runner = `
(function(){
  const s=defaults();
  s.mode="project";s.dupe=0;s.margin=0;s.projectSeq=false;s.projectGate=false;
  s.lines=[
    {max:64,spx:20,turbo:0},{max:64,spx:18,turbo:0},{max:32,spx:16,turbo:0},
    {max:16,spx:14,turbo:0},{max:8,spx:12,turbo:0}
  ];
  s.projects=[{id:"legacy-frames",name:"10,000 Frames",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Frames",qty:10000}]}]}];
  ALLITEMS.forEach(it=>{s.inventory[it]=null;s.forgie[it]=null;});
  normalize(s);syncManual(s);S=s;
  const result=optimize();
  const ph=result.phases[0];
  const switches=[];
  (ph.plan||[]).forEach(line=>{let t=0;(line.entries||[]).slice()
    .sort((a,b)=>{const depth={Ingots:0,Bits:0,Concrete:0,Glass:1,Bricks:1,Plates:1,Rods:1,Frames:2,Gel:0,Wire:2,"Reinforced Concrete":3,Batteries:3};
      return (depth[a.item]||0)-(depth[b.item]||0)||b.frac-a.frac||a.item.localeCompare(b.item)||a.lvl-b.lvl;})
    .forEach(entry=>{t+=entry.frac*ph.eta;if(t>1e-12)switches.push(t);});});
  const first=Math.min.apply(null,switches);
  let ingots=0;
  (ph.plan||[]).forEach(line=>{let t=0;for(const entry of (line.entries||[]).slice().sort((a,b)=>{
    const depth={Ingots:0,Bits:0,Concrete:0,Glass:1,Bricks:1,Plates:1,Rods:1,Frames:2,Gel:0,Wire:2,"Reinforced Concrete":3,Batteries:3};
    return (depth[a.item]||0)-(depth[b.item]||0)||b.frac-a.frac||a.item.localeCompare(b.item)||a.lvl-b.lvl;})){
      const end=t+entry.frac*ph.eta;
      if(t<first-1e-12){
        const active=Math.min(first,end)-t;
        if(entry.item==="Ingots")ingots+=(entry.outHr/entry.frac)*active;
        (entry.cons||[]).forEach(c=>{if(c.item==="Ingots")ingots-=(c.hr/entry.frac)*active;});
      }
      t=end;
    }});
  assert.ok(Math.abs(first-5.171317)<1e-6,"first boundary="+first);
  assert.ok(Math.abs(ingots-(-2932.417170))<1e-6,"Ingot inventory="+ingots);
  assert.equal(result.lpFeasible,true,"the frozen LP remains average-feasible");
  assert.equal(result.scheduleValidation.ok,true,"an executable warm-up must repair the transient deficit");
  assert.ok(result.executionPhases.length>result.phases.length,"execution includes a prerequisite warm-up");
  assert.equal(result.executionPhases[0].kind,"prerequisite");
  assert.equal(result.executionPhases[0].externalSupply.Bits,80000,"external Bits shortfall is exact");
  assert.ok(result.executionPhases.some(p=>p.kind==="warmup"),"ordinary transient gets a timed warm-up");
  assert.ok(result.eta>result.workEta,"executable ETA includes warm-up time");
  assert.ok(result.scheduleValidation.boundaries.every(b=>Object.values(b.inventory||{}).every(v=>v>=-1e-6)),
    "every rendered replay boundary stays nonnegative");

  function ctx(extra){return Object.assign({
    ordinaryResources:["A","B","Bits","Frames","Wire","Glass"],
    minedResources:["Vespium","Hydracite"],informationalResources:["Rocks"],
    forgieRates:{},minedIncomeRates:{},recipeDependencies:{A:[],B:["A"],Bits:[],Frames:[],Wire:[],Glass:["Bits"]},
    recipeDepth:{A:0,B:1,Bits:0,Frames:1,Wire:1,Glass:1},preprodBits:{Frames:8,Wire:2},compressionInputScale:{1:1,2:1.5,4:2.25},
    assignmentEpsilon:1e-9,stockTolerance:{absolute:1e-8,relative:Number.EPSILON*32}
  },extra||{});}
  const clone=x=>JSON.parse(JSON.stringify(x));
  const boundaryShape=r=>(r.boundaries||[]).map(b=>({time:b.time,inventory:b.inventory,minedRates:b.minedRates}));

  const malformedCases=[
    ["top-level phases object",{}],
    ["null phase",[null]],
    ["plan object",[{kind:"project",eta:1,plan:{},demandSub:{}}]],
    ["entries object",[{kind:"project",eta:1,plan:[{line:1,entries:{}}],demandSub:{}}]],
    ["cons object",[{kind:"project",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:1,cons:{}}]}],demandSub:{}}]],
    ["demand array",[{kind:"project",eta:1,plan:[],demandSub:[]}]],
    ["pre-produced string",[{kind:"project",eta:1,plan:[],demandSub:{},preProducedDemand:"Bits"}]],
    ["external array",[{kind:"prerequisite",eta:0,plan:[],demandSub:{},externalSupply:[]}]],
    ["infinite demand",[{kind:"project",eta:1,plan:[],demandSub:{B:Infinity}}]],
    ["negative pre-produced",[{kind:"project",eta:1,plan:[],demandSub:{},preProducedDemand:{Bits:-1}}]],
    ["infinite external",[{kind:"prerequisite",eta:0,plan:[],demandSub:{},externalSupply:{Bits:Infinity}}]],
    ["external without matching total",[{kind:"prerequisite",eta:0,plan:[],demandSub:{},externalSupply:{Bits:1},prerequisiteDemand:{}}]],
    ["external exceeds total",[{kind:"prerequisite",eta:0,plan:[],demandSub:{},externalSupply:{Bits:2},prerequisiteDemand:{Bits:1}}]],
    ["external prerequisite has duration",[{kind:"prerequisite",eta:1,plan:[],demandSub:{},externalSupply:{Bits:1},prerequisiteDemand:{Bits:1}}]],
    ["external prerequisite has line work",[{kind:"prerequisite",eta:0,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:1,cons:[]}]}],demandSub:{},externalSupply:{Bits:1},prerequisiteDemand:{Bits:1}}]],
    ["negative output",[{kind:"project",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:-1,cons:[]}]}],demandSub:{}}]],
    ["infinite consumption",[{kind:"project",eta:1,plan:[{line:1,entries:[{item:"B",lvl:1,frac:1,outHr:1,cons:[{item:"A",hr:Infinity}]}]}],demandSub:{}}]],
    ["epsilon entry still validates nested data",[{kind:"project",eta:1,plan:[{line:1,entries:[{item:"GHOST",lvl:1,frac:0,outHr:Infinity,cons:{}}]}],demandSub:{}}]]
  ];
  const malformedFailures=[];
  malformedCases.forEach(([name,input])=>{let replay;
    try{replay=replayProjectSchedule(input,{},ctx());}
    catch(error){malformedFailures.push(name+" threw "+error.message);return;}
    if(replay.ok||!replay.firstFailure||replay.firstFailure.kind!=="malformed")malformedFailures.push(name+" failed open");
  });
  assert.deepEqual(malformedFailures,[],"malformed schedules return stable blocking diagnostics without throwing");
  const toleratedPrerequisite=replayProjectSchedule([{kind:"prerequisite",eta:0,plan:[],demandSub:{},
    externalSupply:{Bits:1+1e-9},prerequisiteDemand:{Bits:1}}],{},ctx());
  assert.equal(toleratedPrerequisite.ok,true,"ULP/absolute-tolerance carry does not invalidate a scheduler-owned prerequisite");

  const ordered={kind:"project",name:"pipeline",eta:1,demandSub:{B:5},plan:[
    {line:2,entries:[{item:"B",lvl:1,frac:.5,outHr:5,cons:[{item:"A",hr:5}]}]},
    {line:1,entries:[{item:"A",lvl:1,frac:.5,outHr:5,cons:[]}]}
  ]};
  const permuted=clone(ordered);permuted.plan.reverse();permuted.plan.forEach(p=>p.entries.reverse());
  const ro=replayProjectSchedule([ordered],{},ctx());
  const rp=replayProjectSchedule([permuted],{},ctx());
  assert.equal(ro.ok,true);assert.deepEqual(boundaryShape(rp),boundaryShape(ro),"line/entry permutation invariant");
  assert.deepEqual(rp.phases.map(p=>p.plan.map(l=>l.line)),[[1,2]],"canonical line order returned once");

  const handCtx=ctx({ordinaryResources:["X","A","B"],recipeDependencies:{X:[],A:["X"],B:["A"]},recipeDepth:{X:0,A:1,B:2}});
  const hand=replayProjectSchedule([{kind:"warmup",eta:10,plan:[
    {line:1,entries:[{item:"B",lvl:1,frac:.75,outHr:6,cons:[]},{item:"A",lvl:1,frac:.25,outHr:20,cons:[{item:"X",hr:8}]}]},
    {line:2,entries:[{item:"X",lvl:1,frac:.5,outHr:4,cons:[]}]}
  ]}],{},handCtx);
  assert.equal(hand.ok,false);assert.equal(hand.firstFailure.resource,"X");
  assert.ok(Math.abs(hand.firstFailure.deficitAtBoundary-60)<1e-9);assert.ok(Math.abs(hand.requiredBuffers.X-60)<1e-9);
  const at25=hand.boundaries.find(b=>b.kind==="switch"&&Math.abs(b.phaseTime-2.5)<1e-9);
  assert.ok(at25&&Math.abs(at25.inventory.A-200)<1e-9,"instant output * active duration equals weighted outHr * ETA");

  const tieCtx=ctx({ordinaryResources:["C","D","E","F","G"],recipeDepth:{C:0,D:1,E:2,F:0,G:1},recipeDependencies:{C:[],D:["C"],E:["D"],F:[],G:["F"]}});
  const ties=replayProjectSchedule([{kind:"warmup",eta:10,plan:[
    {line:1,entries:[{item:"C",lvl:1,frac:.1,outHr:1,cons:[]},{item:"D",lvl:1,frac:.2,outHr:1,cons:[]},{item:"E",lvl:1,frac:.7,outHr:1,cons:[]}]},
    {line:2,entries:[{item:"F",lvl:1,frac:.3,outHr:1,cons:[]},{item:"G",lvl:1,frac:.7,outHr:1,cons:[]}]}
  ]}],{},tieCtx);
  assert.deepEqual([...new Set(ties.boundaries.filter(b=>b.kind==="switch").map(b=>b.phaseTime))],[1,3,10],"switch ties union once without zero intervals");
  const ignored=replayProjectSchedule([{kind:"warmup",eta:2,plan:[{line:1,entries:[
    {item:"A",lvl:1,frac:1e-12,outHr:999,cons:[]},{item:"B",lvl:1,frac:1,outHr:1,cons:[]}
  ]}]}],{},ctx());
  assert.equal(ignored.ok,true);assert.equal(ignored.phases[0].plan[0].entries.length,1,"LP assignment epsilon only filters assignment fractions");
  assert.equal(replayProjectSchedule([{kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:.6,outHr:1,cons:[]},{item:"B",lvl:1,frac:.5,outHr:1,cons:[]}]}]}],{},ctx()).firstFailure.kind,"malformed");

  const crossing=replayProjectSchedule([{kind:"warmup",eta:2,plan:[{line:1,entries:[{item:"B",lvl:1,frac:1,outHr:0,cons:[{item:"A",hr:20}]}]}]}],{A:30},ctx());
  assert.ok(Math.abs(crossing.firstFailure.time-1.5)<1e-9);assert.ok(Math.abs(crossing.firstFailure.deficitAtBoundary-10)<1e-9);
  const idleForgie=replayProjectSchedule([{kind:"warmup",eta:10,plan:[{line:1,entries:[{item:"B",lvl:1,frac:.1,outHr:1,cons:[]}]}]}],{},ctx({forgieRates:{A:1}}));
  assert.ok(Math.abs(idleForgie.finalInventory.A-10)<1e-9,"Forgie continues through idle tails");

  const draw={kind:"project",eta:1,demandSub:{B:10},plan:[{line:1,entries:[
    {item:"B",lvl:1,frac:1,outHr:10,cons:[{item:"A",hr:10}]}
  ]}]};
  assert.equal(replayProjectSchedule([draw],{A:10},ctx()).ok,true,"enough inventory executes");
  const partial=replayProjectSchedule([draw],{A:4},ctx());
  assert.equal(partial.ok,false,"partial inventory reports a transient deficit");
  assert.equal(partial.firstFailure.resource,"A");assert.ok(Math.abs(partial.firstFailure.deficit-6)<1e-9);
  assert.ok(Math.abs(partial.requiredBuffers.A-6)<1e-9);
  const gameScale=replayProjectSchedule([{kind:"warmup",eta:1,plan:[{line:1,entries:[
    {item:"B",lvl:1,frac:1,outHr:0,cons:[{item:"A",hr:1e18+1e6}]}
  ]}]}],{A:1e18},ctx());
  assert.equal(gameScale.ok,false,"a material deficit remains blocking at game-scale inventory");
  assert.equal(gameScale.firstFailure.resource,"A");
  assert.ok(gameScale.firstFailure.deficit>999000&&gameScale.firstFailure.deficit<1001000,
    "raw million-unit deficit is preserved instead of absorbed by relative tolerance");
  assert.ok(gameScale.finalInventory.A<0,"validation preserves the raw negative inventory");

  const carry=replayProjectSchedule([
    {kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:10,cons:[]}]}]},
    {kind:"project",eta:1,demandSub:{B:5},plan:[{line:1,entries:[{item:"B",lvl:1,frac:1,outHr:6,cons:[{item:"A",hr:6}]}]}]}
  ],{},ctx());
  assert.equal(carry.ok,true);assert.ok(Math.abs(carry.finalInventory.A-4)<1e-9);assert.ok(Math.abs(carry.finalInventory.B-1)<1e-9);

  assert.equal(replayProjectSchedule([draw],{},ctx({forgieRates:{A:10}})).ok,true,"Forgie accrues continuously");
  const dup=replayProjectSchedule([{kind:"warmup",eta:1,plan:[{line:1,dp:2,entries:[{item:"A",lvl:1,frac:.5,outHr:5,cons:[]}]}]}],{},ctx());
  assert.ok(Math.abs(dup.finalInventory.A-5)<1e-9,"entry outHr already owns duplication");

  const frames={kind:"project",eta:1,demandSub:{Frames:1},preProducedDemand:{Bits:8},plan:[{line:1,entries:[{item:"Frames",lvl:1,frac:1,outHr:1,cons:[]}]}]};
  const bitsOk=replayProjectSchedule([frames],{Bits:8},ctx());
  assert.equal(bitsOk.ok,true);assert.equal(bitsOk.finalInventory.Bits,0);
  const bitsShort=replayProjectSchedule([frames],{Bits:4},ctx());
  assert.equal(bitsShort.ok,false);assert.equal(bitsShort.firstFailure.kind,"prerequisite");assert.equal(bitsShort.firstFailure.deficit,4);
  const samePhaseBits=clone(frames);samePhaseBits.plan.push({line:2,entries:[{item:"Bits",lvl:1,frac:1,outHr:8,cons:[]}]});
  assert.equal(replayProjectSchedule([samePhaseBits],{},ctx()).firstFailure.kind,"prerequisite","same-phase Bits cannot satisfy external obligation");
  const compressedFrames={kind:"project",eta:1,demandSub:{Frames:4},plan:[{line:1,dp:1,entries:[{item:"Frames",lvl:4,frac:1,outHr:4,cons:[]}]}]};
  const compressedShort=replayProjectSchedule([compressedFrames],{Bits:71},ctx());
  assert.equal(compressedShort.firstFailure.kind,"prerequisite");assert.ok(Math.abs(compressedShort.firstFailure.deficit-1)<1e-9,
    "compressed Frames use the established 8 * 3^log2(level) Bits-per-craft convention");
  const directBits={kind:"project",eta:1,demandSub:{Bits:4},plan:[{line:1,entries:[{item:"Bits",lvl:1,frac:1,outHr:4,cons:[]}]}]};
  assert.equal(replayProjectSchedule([directBits],{},ctx()).ok,true,"direct Bits remain craftable");
  const feedBits={kind:"project",eta:1,demandSub:{Glass:1},plan:[
    {line:1,entries:[{item:"Bits",lvl:1,frac:.5,outHr:2,cons:[]}]},
    {line:2,entries:[{item:"Glass",lvl:1,frac:.5,outHr:1,cons:[{item:"Bits",hr:2}]}]}
  ]};
  assert.equal(replayProjectSchedule([feedBits],{},ctx()).ok,true,"recipe-feed Bits remain ordinary/craftable");

  const mined={kind:"project",eta:1,demandSub:{B:1},plan:[{line:1,entries:[{item:"B",lvl:1,frac:.5,outHr:1,cons:[{item:"Vespium",hr:5}]}]}]};
  const minedBlocked=replayProjectSchedule([mined],{},ctx({minedIncomeRates:{Vespium:6}}));
  assert.equal(minedBlocked.ok,false);assert.equal(minedBlocked.firstFailure.kind,"mined-rate");
  assert.ok(Math.abs(minedBlocked.firstFailure.excess-4)<1e-9,"active mined rate, not phase average, is capped");
  const bothMined={kind:"warmup",eta:1,plan:[
    {line:1,entries:[{item:"A",lvl:1,frac:1,outHr:1,cons:[{item:"Vespium",hr:9}]}]},
    {line:2,entries:[{item:"B",lvl:1,frac:1,outHr:1,cons:[{item:"Hydracite",hr:8}]}]}
  ]};
  const bothCaps=replayProjectSchedule([bothMined],{},ctx({minedIncomeRates:{Vespium:5,Hydracite:4}}));
  assert.equal(bothCaps.ok,false);assert.equal(bothCaps.firstFailure.kind,"mined-rate");
  const bothBoundary=bothCaps.boundaries.find(b=>b.kind==="switch");
  assert.equal(bothBoundary.minedRates.Vespium,9);assert.equal(bothBoundary.minedRates.Hydracite,8,
    "simultaneous mined-resource rates are both preserved and checked");

  let calls=0;
  const warm=buildExecutableProjectSchedule([draw],{},ctx(),deficit=>{calls++;return {
    kind:"warmup",name:"A warm-up",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[]}]}]
  };});
  assert.equal(warm.validation.ok,true);assert.equal(warm.phases[0].kind,"warmup");assert.ok(warm.eta>1);assert.ok(calls>0);
  const noProgress=buildExecutableProjectSchedule([draw],{},ctx(),()=>({kind:"warmup",eta:1,plan:[]}));
  assert.equal(noProgress.validation.ok,false);assert.match(noProgress.validation.firstFailure.message,/progress|deficit/i);assert.ok(noProgress.phases.length<10);
  let maliciousCalls=0;
  const unrelated=buildExecutableProjectSchedule([draw],{},ctx({ordinaryResources:["A","B","C"],
    recipeDependencies:{A:[],B:["A"],C:[]},recipeDepth:{A:0,B:1,C:0}}),deficit=>{
    maliciousCalls++;
    if(deficit.A)return {kind:"warmup",name:"malicious A warm-up",eta:1,plan:[{line:1,entries:[
      {item:"A",lvl:1,frac:1,outHr:deficit.A,cons:[{item:"C",hr:1}]}
    ]}]};
    return {kind:"warmup",name:"unrelated C manufacture",eta:1,plan:[{line:1,entries:[
      {item:"C",lvl:1,frac:1,outHr:deficit.C||0,cons:[]}
    ]}]};
  });
  assert.equal(unrelated.validation.ok,false,"a callback cannot widen warm-up recursion to an unrelated recipe branch");
  assert.match(unrelated.validation.firstFailure.message,/unrelated|dependency|ancestor/i);
  assert.equal(maliciousCalls,1,"unrelated recursive stock is rejected before invoking the callback again");
  const callbackContext=ctx({ordinaryResources:["A","B","C"],recipeDependencies:{A:[],B:["A"],C:[]},recipeDepth:{A:0,B:1,C:0}});
  const externalCheat=buildExecutableProjectSchedule([draw],{},callbackContext,()=>({kind:"warmup",eta:0,plan:[],externalSupply:{A:10}}));
  assert.equal(externalCheat.validation.ok,false,"solveBuffer cannot inject scheduler-owned external supply");
  assert.equal(externalCheat.validation.firstFailure.kind,"malformed");
  const callbackMapCheat=buildExecutableProjectSchedule([draw],{},callbackContext,deficit=>({kind:"warmup",eta:1,demandSub:{B:Infinity},plan:[{line:1,entries:[
    {item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[]}
  ]}]}));
  assert.equal(callbackMapCheat.validation.ok,false,"explicit callback maps are validated before scheduler fields are imposed");
  assert.equal(callbackMapCheat.validation.firstFailure.kind,"malformed");
  const ghostCheat=buildExecutableProjectSchedule([draw],{GHOST:999},callbackContext,deficit=>({kind:"warmup",eta:1,plan:[{line:1,entries:[
    {item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[{item:"GHOST",hr:999}]}
  ]}]}));
  assert.equal(ghostCheat.validation.ok,false,"unknown callback consumption cannot disappear from replay");
  assert.equal(ghostCheat.validation.firstFailure.kind,"malformed");
  const stockedUnrelated=buildExecutableProjectSchedule([draw],{C:100},callbackContext,deficit=>({kind:"warmup",eta:1,plan:[{line:1,entries:[
    {item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[{item:"C",hr:1}]}
  ]}]}));
  assert.equal(stockedUnrelated.validation.ok,false,"unrelated consumption is rejected even when enough stock hides the deficit");
  assert.match(stockedUnrelated.validation.firstFailure.message,/unrelated|dependency|ancestor/i);
  const legitimateMinedWarmup=buildExecutableProjectSchedule([draw],{},ctx({minedIncomeRates:{Vespium:2}}),deficit=>({kind:"warmup",eta:1,plan:[{line:1,entries:[
    {item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[{item:"Vespium",hr:1}]}
  ]}]}));
  assert.equal(legitimateMinedWarmup.validation.ok,true,"known mined consumption is replay-capped but not treated as ordinary ancestry");
  const unrelatedOutput=buildExecutableProjectSchedule([draw],{},callbackContext,deficit=>({kind:"warmup",eta:1,plan:[
    {line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[]}]},
    {line:2,entries:[{item:"C",lvl:1,frac:1,outHr:1,cons:[]}]}
  ]}));
  assert.equal(unrelatedOutput.validation.ok,false,"callback output stays inside target ancestry");
  assert.match(unrelatedOutput.validation.firstFailure.message,/unrelated|dependency|ancestor/i);
  const excessivePhases=buildExecutableProjectSchedule([draw],{},callbackContext,deficit=>Array.from({length:1001},()=>({kind:"warmup",eta:.001,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[]}]}]})));
  assert.equal(excessivePhases.validation.ok,false);assert.match(excessivePhases.validation.firstFailure.message,/too many|limit/i);
  const excessiveLines=buildExecutableProjectSchedule([draw],{},callbackContext,deficit=>({kind:"warmup",eta:1,plan:Array.from({length:1001},(_,i)=>({line:i+1,entries:[{item:"A",lvl:1,frac:1,outHr:(deficit.A||0)/1001,cons:[]}]}))}));
  assert.equal(excessiveLines.validation.ok,false);assert.match(excessiveLines.validation.firstFailure.message,/too many|limit/i);
  const excessiveEntries=buildExecutableProjectSchedule([draw],{},callbackContext,deficit=>({kind:"warmup",eta:1,plan:[{line:1,entries:Array.from({length:1001},()=>({item:"A",lvl:1,frac:1/1001,outHr:(deficit.A||0)/1001,cons:[]}))}]}));
  assert.equal(excessiveEntries.validation.ok,false);assert.match(excessiveEntries.validation.firstFailure.message,/too many|limit/i);

  let combinedCalls=0;
  const combinedProject={kind:"project",eta:1,demandSub:{B:2},plan:[{line:1,entries:[{item:"B",lvl:1,frac:1,outHr:1,cons:[{item:"A",hr:1}]}]}]};
  const combinedRoots=buildExecutableProjectSchedule([combinedProject],{},ctx(),(deficit)=>{combinedCalls++;
    if(deficit.A&&deficit.B)return [
      {kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"B",lvl:1,frac:1,outHr:deficit.B,cons:[{item:"A",hr:deficit.B}]}]}]},
      {kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A,cons:[]}]}]}
    ];
    return {kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[]}]}]};
  });
  assert.equal(combinedRoots.validation.ok,true,"A remains a legal recursive ancestor when A and dependent B are combined roots");
  assert.ok(combinedCalls>=2);
  const cyclic=buildExecutableProjectSchedule([draw],{},ctx({recipeDependencies:{A:["B"],B:["A"]},recipeDepth:{A:0,B:1}}),deficit=>({kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[{item:"B",hr:1}]}]}]}));
  assert.equal(cyclic.validation.ok,false,"cyclic callback ancestry is rejected");assert.match(cyclic.validation.firstFailure.message,/cycle|acyclic/i);
  const semantic=[
    {kind:"project",semanticIndex:0,eta:5,demandSub:{B:1},plan:[{line:1,entries:[{item:"B",lvl:1,frac:1,outHr:.2,cons:[{item:"A",hr:.4}]}]}]},
    {kind:"project",semanticIndex:1,eta:7,demandSub:{B:1},plan:[{line:1,entries:[{item:"B",lvl:1,frac:1,outHr:1/7,cons:[{item:"A",hr:1/7}]}]}]}
  ];
  const timed=buildExecutableProjectSchedule(semantic,{},ctx(),(deficit,_inv,info)=>{const eta=info.sourcePhase.semanticIndex===0?2:1;
    return {kind:"warmup",eta,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:(deficit.A||0)/eta,cons:[]}]}]};});
  assert.equal(timed.validation.ok,true);assert.equal(timed.phases.length,4);assert.ok(Math.abs(timed.eta-15)<1e-9,"warm-up durations add to semantic LP work ETA");
  let repeatedCalls=0;
  const repeated=buildExecutableProjectSchedule([clone(draw),clone(draw)],{},ctx(),deficit=>{repeatedCalls++;return {
    kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[]}]}]
  };});
  assert.equal(repeated.validation.ok,true,"identical deficits in distinct semantic phases do not trip a cross-phase signature guard");
  assert.equal(repeatedCalls,2);

  const mutationPhases=[clone(draw)],mutationInventory={A:4},mutationContext=ctx();
  const mutationBefore=clone({phases:mutationPhases,inventory:mutationInventory,context:mutationContext});
  replayProjectSchedule(mutationPhases,mutationInventory,mutationContext);
  buildExecutableProjectSchedule(mutationPhases,mutationInventory,mutationContext,deficit=>({kind:"warmup",eta:1,plan:[{line:1,entries:[{item:"A",lvl:1,frac:1,outHr:deficit.A||0,cons:[]}]}]}));
  assert.deepEqual({phases:mutationPhases,inventory:mutationInventory,context:mutationContext},mutationBefore,
    "replay and builder do not mutate nested caller inputs");

  let seed=0x51f15e;const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  for(let i=0;i<40;i++){
    const qty=1+Math.floor(rnd()*100),frac=.1+rnd()*.8;
    const p={kind:"project",eta:2,demandSub:{B:qty},plan:[
      {line:2,entries:[{item:"B",lvl:1,frac,outHr:qty/2,cons:[{item:"A",hr:qty/2}]}]},
      {line:1,entries:[{item:"A",lvl:1,frac,outHr:qty/2,cons:[]}]}
    ]};
    const q=clone(p);q.plan.reverse();
    assert.deepEqual(boundaryShape(replayProjectSchedule([q],{},ctx())),boundaryShape(replayProjectSchedule([p],{},ctx())),"seeded order property "+i);
  }
  console.log("project transients: ok");
})();
`;

eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);

const eventsSrc = fs.readFileSync(path.join(root, "js", "events.js"), "utf8");
const stepStart = eventsSrc.indexOf("function stepPlanHtml(res){");
const stepEnd = eventsSrc.indexOf("// ── Plan-start", stepStart);
assert.ok(stepStart >= 0 && stepEnd > stepStart, "step-plan renderer remains extractable for its safety contract");
const testDisp = value => value===40000?"40k":value===80000?"80k":String(value);
const stepPlanHtml = Function("S","fmtDuration","htmlText","disp","RAWS","MINED_CRAFTS","compressionLabel","minedUsageNote",
  eventsSrc.slice(stepStart, stepEnd) + "\nreturn stepPlanHtml;")(
    {planStart:1},value=>String(value)+"h",String,testDisp,[],{},String,()=>"");
const partialCopy = stepPlanHtml({empty:false,phases:[{}],executionPhases:[{kind:"project",eta:1,plan:[]}],
  feasible:false,lpFeasible:false,partial:true,eta:1,scheduleValidation:{ok:true,boundaries:[]}});
assert.match(partialCopy,/No executable run instructions/);
assert.doesNotMatch(partialCopy,/Follow the|Set all|Run this|Do these/,
  "average-infeasible partial plans must never emit imperative execution copy");
const partialBitsPhase={kind:"prerequisite",eta:0,plan:[],externalSupply:{Bits:40000},
  prerequisiteDemand:{Bits:80000},invStart:{Bits:40000}};
const partialBitsCopy=stepPlanHtml({empty:false,phases:[{}],executionPhases:[partialBitsPhase],
  feasible:true,lpFeasible:true,partial:false,eta:0,scheduleValidation:{ok:true,boundaries:[]}});
assert.match(partialBitsCopy,/Pre-produce <b>40k more Bits<\/b>/);
assert.match(partialBitsCopy,/<b>80k total<\/b>/);
assert.match(partialBitsCopy,/<b>40k currently on hand<\/b>/);
assert.doesNotMatch(partialBitsCopy,/Have <b>40k Bits<\/b>/,
  "step-plan copy must not present the additional shortfall as the total requirement");

const resultsSrc = fs.readFileSync(path.join(root, "js", "results.js"), "utf8");
const renderStart = resultsSrc.indexOf("function renderProjectResults(res,el,stat){");
const renderEnd = resultsSrc.indexOf("\n\n\nfunction renderResults", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, "Project result renderer remains extractable for blocked-copy coverage");
const renderProjectResults = Function("S","mutateState","save","projectForgieNote","projPlanAnchorHtml","htmlText","disp","fmtDuration",
  "stepsProjControls","stepPlanHtml","ALLITEMS","num","resultMinedUsage","minedUsageNote","lineAssignTableHtml","idleLinesNote","projectStabilityHtml","projOrderHeader","projLineModeHtml","staticHeldFeederItems",
  `let _lastProjectRes=null,_breakdownOpen=false,_projAdjustOpen=false;${resultsSrc.slice(renderStart,renderEnd)};return renderProjectResults;`)(
    {planStart:1,projects:[],inventory:{Bits:40000}},()=>{},()=>{},()=>"",()=>"",String,testDisp,()=>"1h",()=>"",()=>partialCopy,[],Number,()=>[],()=>"",()=>"",()=>"",()=>"",()=>"Order",()=>"",()=>[]);
const bitsEl={innerHTML:""},bitsStat={textContent:""};
renderProjectResults({empty:false,sequenced:false,waved:false,single:true,feasible:true,lpFeasible:true,partial:false,
  eta:3,workEta:2,ms:1,perProject:[],phases:[{name:"Frames",eta:2,demandSub:{}}],executionPhases:[partialBitsPhase],
  scheduleValidation:{ok:true,boundaries:[]},blockedMined:{},infeasItems:[],atRiskItems:[],demandItems:[],rate:{},net:{},balance:[],plan:[]},bitsEl,bitsStat);
assert.match(bitsEl.innerHTML,/Pre-produce <b>40k more Bits<\/b>/);
assert.match(bitsEl.innerHTML,/<b>80k total<\/b>/);
assert.match(bitsEl.innerHTML,/<b>40k currently on hand<\/b>/);
assert.doesNotMatch(bitsEl.innerHTML,/Have <b>40k Bits<\/b>/,
  "result summary distinguishes additional Bits from the total prerequisite");
const blockedEl={innerHTML:""},blockedStat={textContent:""};
renderProjectResults({empty:false,sequenced:false,waved:false,single:false,feasible:true,lpFeasible:true,partial:false,
  eta:3,workEta:2,ms:1,bottleneck:"A",perProject:[],phases:[{name:"Blocked",eta:2,demandSub:{}}],executionPhases:[{kind:"prerequisite",externalSupply:{Bits:8}}],
  scheduleValidation:{ok:false,firstFailure:{kind:"mined-rate",resource:"Vespium",time:1,excess:4,message:"over cap"}},
  blockedMined:{},infeasItems:[],atRiskItems:[],demandItems:[],rate:{},net:{},balance:[],plan:[]},blockedEl,blockedStat);
assert.match(blockedEl.innerHTML,/Executable schedule blocked/);
assert.doesNotMatch(blockedEl.innerHTML,/External pre-produced prerequisite|Startup warm-up included|Have <b>/,
  "blocked results keep prerequisite data diagnostic rather than imperative");
assert.doesNotMatch(blockedEl.innerHTML,/sets the finish time/i,"blocked bottleneck copy stays analytical");
assert.match(blockedStat.textContent,/Schedule blocked/);
const blockedWaveEl={innerHTML:""},blockedWaveStat={textContent:""};
renderProjectResults({empty:false,sequenced:false,waved:true,single:false,feasible:false,lpFeasible:true,partial:false,
  eta:3,workEta:2,ms:1,perProject:[],phases:[{name:"Blocked wave",members:["One"],eta:2,demandSub:{},feasible:true}],executionPhases:[],
  scheduleValidation:{ok:false,firstFailure:{kind:"stock",resource:"A",time:1,deficit:2,message:"short"}},
  blockedMined:{},infeasItems:[],atRiskItems:[],demandItems:[],rate:{},net:{},balance:[],plan:[]},blockedWaveEl,blockedWaveStat);
assert.doesNotMatch(blockedWaveEl.innerHTML,/Order:|finish each wave|Build order|Completion order|Done by/i,
  "blocked waved results suppress every imperative ordering instruction");
