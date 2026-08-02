"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const source = ["core.js", "project-schedule.js", "solver.js"]
  .map(file => fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"))
  .join("\n;\n");

const runner = `
(function(){
  // Independently restate the production ULP-scale objective policy. A broad absolute
  // epsilon here would let the oracle bless a real sub-1e-9 Gel regression.
  const ABS_EPS=Number.EPSILON*8,REL_EPS=Number.EPSILON*32;
  const tolerance=(a,b)=>ABS_EPS+REL_EPS*Math.max(1,Math.abs(a),Math.abs(b));
  const close=(a,b)=>Math.abs(a-b)<=tolerance(a,b);
  const stablePositiveSum=values=>values.filter(value=>value>0).slice()
    .sort((a,b)=>a-b).reduce((sum,value)=>sum+value,0);
  const activePairs=choices=>choices.filter(choice=>choice.L>0)
    .map(choice=>[choice.row.__i,choice.L]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const comparePairs=(a,b)=>{
    const aa=activePairs(a),bb=activePairs(b),n=Math.min(aa.length,bb.length);
    for(let i=0;i<n;i++){
      if(aa[i][0]!==bb[i][0])return aa[i][0]-bb[i][0];
      if(aa[i][1]!==bb[i][1])return aa[i][1]-bb[i][1];
    }
    return aa.length-bb.length;
  };
  // Independent staged objective: pairwise fuzzy reducers are order-dependent because the
  // tolerance grows with magnitude. Establish each raw anchor first, then form its tie band.
  const stagedSelection=states=>{
    const gelMax=Math.max(...states.map(state=>state.gelHr));
    const gelBand=states.filter(state=>close(state.gelHr,gelMax));
    const vespMin=Math.min(...gelBand.map(state=>state.vespHr));
    const finalBand=gelBand.filter(state=>close(state.vespHr,vespMin));
    const best=finalBand.reduce((winner,candidate)=>
      !winner||comparePairs(candidate.choices,winner.choices)<0?candidate:winner,null);
    return {best,gelMax,gelBand,vespMin,finalBand};
  };
  function exhaustive(rows,budget){
    const feasible=[];
    const choices=[];
    const ordered=rows.slice().sort((a,b)=>a.__i-b.__i);
    const visit=index=>{
      if(index===ordered.length){
        const active=choices.filter(choice=>choice.L>0);
        const gelHr=stablePositiveSum(active.map(choice=>gelOutHr(choice.row,choice.L)));
        const vespHr=stablePositiveSum(active.map(choice=>gelVespHr(choice.row,choice.L)));
        if(vespHr<=budget){
          const candidate={gelHr,vespHr,choices:choices.map(choice=>({row:choice.row,L:choice.L}))};
          feasible.push(candidate);
        }
        return;
      }
      const row=ordered[index];
      [0,...LEVELS.filter(level=>level<=row.max)].forEach(L=>{
        choices.push({row,L});visit(index+1);choices.pop();
      });
    };
    visit(0);
    const selection=stagedSelection(feasible);
    return {best:selection.best,feasible,selection};
  }
  function assertLoadout(name,rows,budget,before,result,oracleResult){
    const oracle=oracleResult.best;
    const selected=result.perLine.map(line=>[line.__i,line.L]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const expected=activePairs(oracle.choices);
    assert.deepEqual(selected,expected,name+": physical line/compression choices differ from exhaustive optimum");
    assert.ok(close(result.gelHr,oracle.gelHr),name+": Gel total differs from exhaustive optimum");
    assert.ok(close(result.vespHr,oracle.vespHr),name+": Vespium total differs from exhaustive optimum");
    assert.ok(result.vespHr<=budget,name+": Vespium budget was overspent");
    assert.equal(new Set(result.perLine.map(line=>line.__i)).size,result.perLine.length,
      name+": a physical line was selected more than once");
    assert.deepEqual(result.perLine.map(line=>line.__i),result.perLine.map(line=>line.__i).slice().sort((a,b)=>a-b),
      name+": output rows must be ordered by physical line ID");
    result.perLine.forEach(line=>{
      const row=rows.find(candidate=>candidate.__i===line.__i);
      assert.ok(row&&LEVELS.includes(line.L)&&line.L<=row.max,name+": selected an illegal compression");
      assert.equal(line.max,row.max,name+": selected line must preserve its source cap");
      assert.equal(line.frac,1,name+": every selected line must run full-time");
      assert.ok(close(line.gelHr,gelOutHr(row,line.L)),name+": selected Gel rate must be recomputed from its source row");
      assert.ok(close(line.vespHr,gelVespHr(row,line.L)),name+": selected Vespium rate must be recomputed from its source row");
    });
    const summedGel=stablePositiveSum(result.perLine.map(line=>line.gelHr));
    const summedVesp=stablePositiveSum(result.perLine.map(line=>line.vespHr));
    assert.ok(close(result.gelHr,summedGel),name+": Gel total is not the per-line sum");
    assert.ok(close(result.vespHr,summedVesp),name+": Vespium total is not the per-line sum");
    assert.equal(JSON.stringify(rows),before,name+": input rows were mutated");
    const actualCandidate={gelHr:result.gelHr,vespHr:result.vespHr,
      choices:result.perLine.map(line=>({row:rows.find(row=>row.__i===line.__i),L:line.L}))};
    assert.ok(close(actualCandidate.gelHr,oracleResult.selection.gelMax),
      name+": result is outside the raw maximum Gel tie band");
    assert.ok(close(actualCandidate.vespHr,oracleResult.selection.vespMin),
      name+": result is outside the raw minimum Vespium tie band");
    oracleResult.feasible.forEach((candidate,index)=>{
      assert.ok(candidate.gelHr<=oracleResult.selection.gelMax,
        name+": feasible state "+index+" exceeds the raw Gel anchor");
      if(!close(candidate.gelHr,oracleResult.selection.gelMax))return;
      assert.ok(candidate.vespHr>=oracleResult.selection.vespMin,
        name+": Gel-band state "+index+" undercuts the raw Vespium anchor");
      if(!close(candidate.vespHr,oracleResult.selection.vespMin))return;
      assert.ok(comparePairs(candidate.choices,actualCandidate.choices)>=0,
        name+": final-band state "+index+" is lexicographically better than the result");
    });
  }

  S=defaults();S.dupe=0;S.maxTurbo=0;
  assert.ok(gelLoadoutClose(1,1+Number.EPSILON*16),"ULP-scale neighbors must compare equal");
  assert.ok(!gelLoadoutClose(1,1+Number.EPSILON*256),"values beyond the ULP equality window must remain distinct");
  assert.ok(!gelLoadoutClose(0,1e-12),"the absolute equality floor must not erase real Gel output");
  assert.ok(gelLoadoutChoiceCompare(
    {choices:[{row:{__i:4},L:1}]},{choices:[{row:{__i:4},L:2}]})<0,
    "the final lexicographic tie-break must prefer lower compression on the same physical ID");
  console.log("PASS equality is tight and ULP-scale");

  const pruneState=(id,gelHr,vespHr)=>({gelHr,vespHr,choices:[{row:{__i:id},L:1}]});
  const unitGelBounds={decisiveGap:1,farGelAdvantage:0};
  const wideGelBounds={decisiveGap:100,farGelAdvantage:1};
  const unitVespBounds={decisiveGap:5,farGelAdvantage:0};
  const wideVespBounds={decisiveGap:100,farGelAdvantage:0};
  assert.equal(gelLoadoutPruneCandidates(
    [pruneState(0,11,0),pruneState(1,10,0)],unitGelBounds,wideVespBounds).length,2,
    "a Gel gap exactly at the prune envelope must be retained");
  assert.equal(gelLoadoutPruneCandidates([
    pruneState(0,11+Number.EPSILON*8,0),pruneState(1,10,0)
  ],unitGelBounds,wideVespBounds).length,1,
  "a Gel gap strictly outside the prune envelope must be discarded");
  assert.equal(gelLoadoutPruneCandidates(
    [pruneState(0,11,0),pruneState(1,10,5)],wideGelBounds,unitVespBounds).length,2,
    "a Vespium gap exactly at the prune envelope must be retained");
  assert.equal(gelLoadoutPruneCandidates([
    pruneState(0,11-Number.EPSILON*8,0),pruneState(1,10,5+Number.EPSILON*8)
  ],wideGelBounds,unitVespBounds).length,2,
  "a far-cost state just below the safe Gel-advantage margin must be retained");
  assert.equal(gelLoadoutPruneCandidates([
    pruneState(0,11,0),pruneState(1,10,5+Number.EPSILON*8)
  ],wideGelBounds,unitVespBounds).length,1,
  "a far-cost state exactly at the safe Gel-advantage margin may be discarded");

  const bounds64=gelLoadoutPruneBounds(1e16,64);
  assert.ok(bounds64.exactMagnitude>bounds64.publicMagnitude,
    "the pruning proof must inflate a potentially rounded-down stored upper bound");
  assert.ok(bounds64.roundDrift>=4*bounds64.gamma*bounds64.exactMagnitude,
    "the pruning interval must cover all four independent prefix/final sum-error paths");
  assert.ok(bounds64.decisiveGap>=bounds64.finalTie+bounds64.roundDrift,
    "decisive dominance must include both the public final tie and recomputation drift");
  assert.ok(bounds64.roundDrift>bounds64.finalTie,
    "64 recomputed additions must expose round drift wider than the final public tie band");
  assert.ok(bounds64.farGelAdvantage>=bounds64.roundDrift,
    "far-cost pruning must require enough Gel advantage to prevent worst-case order reversal");
  assert.equal(gelLoadoutPruneCandidates([
    pruneState(0,1e16,0),pruneState(1,1e16,1)
  ],bounds64,{decisiveGap:0,farGelAdvantage:0}).length,2,
  "far-cost pruning must retain equal stored Gel when 64-addition recomputation can reverse its order");
  console.log("PASS prune intervals retain strict boundaries and 64-addition Gel-order uncertainty");

  S.lines=[{max:1,spx:6,turbo:0},{max:1,spx:4,turbo:0},{max:1,spx:4,turbo:0}];
  const budget=4498594189315839;
  const result=gelLoadout(lineRows(),budget);
  assert.deepEqual(result.perLine.map(line=>line.__i),[1,2],
    "the exact loadout must choose both medium lines rather than the speed-6 line");
  assert.ok(Math.abs(result.gelHr-8.997188378631677)<=1e-12,
    "the exact loadout must produce 8.997188378631677 Gel/hr");
  assert.ok(result.vespHr<=budget,"the exact loadout must not overspend Vespium");
  console.log("PASS cap-1 speeds 6/4/4 choose the two medium lines");

  const unitBudget=budget/8;
  const ladder=[0,3,4,6,8,10,14].map(units=>({units,budget:unitBudget*units}));
  let previous=0;
  ladder.forEach(entry=>{
    const loadout=gelLoadout(lineRows(),entry.budget);
    assert.ok(loadout.gelHr>=previous-tolerance(loadout.gelHr,previous),
      "Gel capacity must be nondecreasing as Vespium budget rises");
    previous=loadout.gelHr;
  });
  assert.deepEqual(gelLoadout(lineRows(),unitBudget*4).perLine.map(line=>line.__i),[1],
    "an equal medium-line tie must select the lower physical ID");
  assert.deepEqual(gelLoadout(lineRows(),unitBudget*10).perLine.map(line=>line.__i),[0,1],
    "the speed-10 budget must select the speed-6 line and lower-ID medium line");
  console.log("PASS cap-1 budget ladder is monotone and deterministic");

  const tied=[{__i:7,max:1,spx:5,turbo:0},{__i:3,max:1,spx:5,turbo:0}];
  const tiedBudget=gelVespHr(tied[0],1);
  assert.deepEqual(gelLoadout(tied,tiedBudget).perLine.map(line=>line.__i),[3],
    "equal totals must prefer the lexicographically smaller physical line");
  assert.deepEqual(gelLoadout(tied.slice().reverse(),tiedBudget).perLine.map(line=>line.__i),[3],
    "input order must not change the tie-break");
  console.log("PASS equal totals use the physical-line lexicographic tie-break");

  const efficientTie=[{__i:8,max:1,spx:4,turbo:0},{__i:2,max:2,spx:3,turbo:0}];
  const expensiveEqualGel=gelVespHr(efficientTie[1],2);
  let tieResult=gelLoadout(efficientTie,expensiveEqualGel);
  assert.deepEqual(tieResult.perLine.map(line=>[line.__i,line.L]),[[8,1]],
    "equal Gel must prefer lower Vespium before the physical-ID tie-break");
  tieResult=gelLoadout(efficientTie.slice().reverse(),expensiveEqualGel);
  assert.deepEqual(tieResult.perLine.map(line=>[line.__i,line.L]),[[8,1]],
    "the lower-Vespium secondary tie-break must ignore input order");
  console.log("PASS equal Gel prefers lower Vespium before lexicographic IDs/compressions");

  const extensionRows=[
    {__i:0,max:2,spx:1.333749999999986,turbo:0},
    {__i:1,max:2,spx:1.33375000000002,turbo:0},
    {__i:2,max:1,spx:1.7783333333333289,turbo:0},
  ];
  const extensionBudget=3250000000000012;
  const extensionBefore=JSON.stringify(extensionRows);
  const extensionOracle=exhaustive(extensionRows,extensionBudget);
  const extensionResult=gelLoadout(extensionRows,extensionBudget);
  assertLoadout("future-extension tolerance regression",extensionRows,extensionBudget,extensionBefore,
    extensionResult,extensionOracle);
  assert.deepEqual(extensionResult.perLine.map(line=>[line.__i,line.L]),[[0,1],[1,2],[2,1]],
    "partial-state pruning must not erase the final-policy lexicographic winner");
  console.log("PASS partial-state pruning remains safe after a common future extension");

  const dominatedRows=[
    {__i:0,max:1,spx:1.3337499999999736,turbo:0},
    {__i:1,max:2,spx:0.5001562499999819,turbo:0},
    {__i:2,max:2,spx:0.5001562499999825,turbo:0},
  ];
  const dominatedBudget=1593749999999955.2;
  const dominatedOracle=exhaustive(dominatedRows,dominatedBudget);
  const dominatedResult=gelLoadout(dominatedRows,dominatedBudget);
  assertLoadout("raw-dominated fuzzy lex regression",dominatedRows,dominatedBudget,
    JSON.stringify(dominatedRows),dominatedResult,dominatedOracle);
  assert.deepEqual(dominatedResult.perLine.map(line=>[line.__i,line.L]),[[0,1],[1,1],[2,2]],
    "a raw-dominated state inside both final tie bands must remain eligible for lexicographic selection");
  console.log("PASS raw-dominated states inside both final tie bands remain eligible");

  const stagedRows=[
    {__i:0,max:2,spx:1.7783333333333102,turbo:0},
    {__i:1,max:2,spx:1.7783333333333269,turbo:0},
    {__i:2,max:8,spx:1.778333333333369,turbo:0},
  ];
  const stagedBudget=4000000000000081;
  const stagedOracle=exhaustive(stagedRows,stagedBudget);
  const stagedResult=gelLoadout(stagedRows,stagedBudget);
  assertLoadout("staged-selector order regression",stagedRows,stagedBudget,
    JSON.stringify(stagedRows),stagedResult,stagedOracle);
  assert.deepEqual(stagedResult.perLine.map(line=>[line.__i,line.L]),[[0,1],[1,2],[2,1]],
    "the staged final selector must not inherit streaming pairwise-reducer order");
  console.log("PASS staged final selection is anchored before applying fuzzy tie bands");

  const assignmentRows=[
    {__i:0,max:8,spx:1615.1587544721074,turbo:0},
    {__i:1,max:4,spx:0.0011185102264998333,turbo:0},
    {__i:2,max:8,spx:1615.1587544721074,turbo:0},
    {__i:3,max:4,spx:0.0011185102264998333,turbo:0},
    {__i:4,max:8,spx:1615.1587544721074,turbo:0},
  ];
  const assignmentBudget=908244231392255100;
  const assignmentOracle=exhaustive(assignmentRows,assignmentBudget);
  const assignmentResult=gelLoadout(assignmentRows,assignmentBudget);
  assertLoadout("assignment-order strict-budget regression",assignmentRows,assignmentBudget,
    JSON.stringify(assignmentRows),assignmentResult,assignmentOracle);
  assert.ok(close(assignmentResult.gelHr,1816.4884627845104),
    "identical-profile symmetry must not discard the higher-Gel strict-budget-feasible multiset");
  assert.deepEqual(assignmentResult.perLine.map(line=>[line.__i,line.L]),[[0,1],[1,1],[3,1]],
    "stable multiset totals must reconstruct the lexicographically canonical physical assignment");
  assert.deepEqual(gelLoadout(assignmentRows.slice().reverse(),assignmentBudget),assignmentResult,
    "strict feasibility and stable totals must ignore input order");
  console.log("PASS strict feasibility and totals are independent of symmetric physical assignment order");

  const minimizedAssignmentRows=[
    {__i:0,max:8,spx:1615.1587544721074,turbo:0},
    {__i:1,max:4,spx:0.0011185102264998333,turbo:0},
    {__i:2,max:4,spx:0.0011185102264998333,turbo:0},
    {__i:3,max:8,spx:1615.1587544721074,turbo:0},
  ];
  const minimizedOracle=exhaustive(minimizedAssignmentRows,assignmentBudget);
  const minimizedResult=gelLoadout(minimizedAssignmentRows,assignmentBudget);
  assertLoadout("minimized assignment-order regression",minimizedAssignmentRows,assignmentBudget,
    JSON.stringify(minimizedAssignmentRows),minimizedResult,minimizedOracle);
  assert.deepEqual(minimizedResult.perLine.map(line=>[line.__i,line.L]),[[0,1],[1,1],[2,1]],
    "the minimized stable-sum fixture must use its canonical higher-output multiset assignment");
  assert.ok(close(minimizedResult.gelHr,1816.4884627845104),
    "the minimized stable-sum fixture must retain 1816.4884627845104 Gel/hr");
  assert.equal(minimizedResult.vespHr,assignmentBudget,
    "the minimized canonical multiset must fit exactly at its stable-sum budget");
  const minimizedBelow=gelLoadout(minimizedAssignmentRows,assignmentBudget-128);
  assert.ok(minimizedBelow.vespHr<=assignmentBudget-128&&
    minimizedBelow.gelHr<minimizedResult.gelHr-tolerance(minimizedBelow.gelHr,minimizedResult.gelHr),
    "one Vespium ULP below the stable-sum boundary must reject the higher-output multiset");
  assert.deepEqual(gelLoadout(minimizedAssignmentRows.slice().reverse(),assignmentBudget),minimizedResult,
    "the minimized strict-budget fixture must ignore input order");
  console.log("PASS minimized symmetric strict-budget fixture keeps the canonical higher-output multiset");

  const signatureA=pruneState(0,12,4),signatureB=pruneState(1,10,5);
  signatureA.rankSignature="2";signatureB.rankSignature="0";
  const zeroPruneBounds={decisiveGap:0,farGelAdvantage:0};
  assert.equal(gelLoadoutPruneCandidates(
    [signatureA,signatureB],zeroPruneBounds,zeroPruneBounds,state=>state.rankSignature).length,2,
    "numeric dominance must not cross different remaining-profile rank signatures");
  signatureA.rankSignature="0";
  assert.equal(gelLoadoutPruneCandidates(
    [signatureA,signatureB],zeroPruneBounds,zeroPruneBounds,state=>state.rankSignature).length,1,
    "compatible remaining-profile rank signatures should retain numeric pruning");
  const pruneOriginal=gelLoadoutPruneCandidates;let sawProductionSignaturePartition=false;
  gelLoadoutPruneCandidates=function(candidates,gelBounds,vespBounds,signatureOf){
    if(typeof signatureOf==="function"&&new Set(candidates.map(signatureOf)).size>1)
      sawProductionSignaturePartition=true;
    return pruneOriginal.apply(null,arguments);
  };
  gelLoadout([
    {__i:20,max:2,spx:1,turbo:0},
    {__i:21,max:2,spx:1,turbo:0},
    {__i:22,max:2,spx:1,turbo:0},
  ],1e30);
  gelLoadoutPruneCandidates=pruneOriginal;
  assert.ok(sawProductionSignaturePartition,
    "production DP must pass distinct future-rank signatures into the pruning partition");
  console.log("PASS dominance pruning is partitioned by future symmetric-profile availability");

  const nearRows=[{__i:0,max:1,spx:0.000001,turbo:0},{__i:1,max:1,spx:0.0000010005,turbo:0}];
  const nearBudget=gelVespHr(nearRows[1],1);
  assert.deepEqual(gelLoadout(nearRows,nearBudget).perLine.map(line=>line.__i),[1],
    "a sub-1e-9 but real Gel improvement must not be pruned as equality");
  const strictCost=gelVespHr(nearRows[1],1);
  assert.deepEqual(gelLoadout([nearRows[1]],strictCost-1).perLine,[],
    "a budget immediately below the selected cost must reject it");
  assert.deepEqual(gelLoadout([nearRows[1]],strictCost).perLine.map(line=>line.__i),[1],
    "a budget exactly at the selected cost must accept it");
  assert.deepEqual(gelLoadout([nearRows[1]],strictCost+1).perLine.map(line=>line.__i),[1],
    "a budget immediately above the selected cost must accept it");
  console.log("PASS strict budget boundaries preserve tiny real output differences");

  S=defaults();S.dupe=50;S.maxTurbo=100;
  const calibrated={__i:11,max:2,spx:10,turbo:25,meta:{nested:["preserve"]}};
  const calibratedBudget=gelVespHr(calibrated,2),calibratedResult=gelLoadout([calibrated],calibratedBudget);
  assert.deepEqual(calibratedResult.perLine.map(line=>line.L),[2],"the compression anchor must select 2x");
  assert.ok(close(calibratedResult.gelHr,35.98875351452671),"turbo + duplication + 2x compression Gel anchor changed");
  assert.ok(close(calibratedResult.vespHr,17994376757263356),"turbo + 2x compression Vespium anchor changed");
  S.dupe=0;S.maxTurbo=0;
  const floored={__i:12,max:1,spx:1e9,turbo:0},floorBudget=1800000000000000000;
  const floorResult=gelLoadout([floored],floorBudget);
  assert.equal(floorResult.gelHr,3600,"the one-second craft floor must cap Gel at 3,600/hr");
  assert.equal(floorResult.vespHr,floorBudget,"the one-second craft floor must retain exact mined burn");
  console.log("PASS turbo, duplication, compression, and one-second craft-floor anchors");

  const pool=[
    {__i:4,max:1,spx:3.25,turbo:0,meta:{nested:[4]}},
    {__i:1,max:2,spx:5.5,turbo:0},
    {__i:3,max:4,spx:4.25,turbo:0},
    {__i:0,max:8,spx:6.75,turbo:0},
    {__i:2,max:4,spx:2.5,turbo:0},
  ];
  let oracleCases=0;
  [0,37.5].forEach(dupe=>{
    S.dupe=dupe;
    for(let count=1;count<=5;count++){
      const baseRows=pool.slice(0,count),orders=[baseRows,baseRows.slice().reverse()];
      orders.forEach((rows,orderIndex)=>{
        const fullBudget=rows.reduce((sum,row)=>sum+gelVespHr(row,row.max),0);
        const boundaryBudget=rows.reduce((sum,row,index)=>sum+(index%2===0?gelVespHr(row,1):0),0);
        const budgets=[0,fullBudget*0.17,fullBudget*0.39,boundaryBudget,fullBudget*0.73,fullBudget];
        budgets.forEach((candidateBudget,budgetIndex)=>{
          const oracle=exhaustive(rows,candidateBudget);
          const before=JSON.stringify(rows);
          const actual=gelLoadout(rows,candidateBudget);
          assertLoadout("oracle d"+dupe+" n"+count+" o"+orderIndex+" b"+budgetIndex,
            rows,candidateBudget,before,actual,oracle);
          oracleCases++;
        });
      });
    }
  });
  console.log("PASS "+oracleCases+" exhaustive 1-5 line cap/budget/dupe/permutation cases");

  S=defaults();S.dupe=0;S.maxTurbo=0;
  const subsetRows=Array.from({length:12},(_,index)=>({__i:index,max:1,spx:Math.pow(2,index),turbo:0}));
  const subsetUnit=gelVespHr(subsetRows[0],1);
  const reachable=subsetRows.filter((row,index)=>(1365&(1<<index))!==0)
    .reduce((sum,row)=>sum+gelVespHr(row,1),0);
  const subsetCases=[
    {name:"below",budget:reachable-subsetUnit/4,want:1364},
    {name:"at",budget:reachable,want:1365},
    {name:"above",budget:reachable+subsetUnit/4,want:1365},
  ];
  subsetCases.forEach(entry=>{
    const first=gelLoadout(subsetRows,entry.budget),second=gelLoadout(subsetRows.slice().reverse(),entry.budget);
    const speedSum=result=>result.perLine.reduce((sum,line)=>sum+subsetRows[line.__i].spx,0);
    assert.equal(speedSum(first),entry.want,"12-line 4096-subset "+entry.name+" boundary selected the wrong sum");
    assert.deepEqual(second,first,"12-line 4096-subset "+entry.name+" boundary must be deterministic under permutation");
    assert.ok(first.vespHr<=entry.budget,"12-line 4096-subset "+entry.name+" boundary overspent");
  });
  console.log("PASS 12-line cap-1 4096-subset boundaries are exact and deterministic");

  S.lines=[{max:1,spx:6,turbo:0},{max:1,spx:4,turbo:0},{max:1,spx:4,turbo:0}];
  const seed=gelSeedLoadout(lineRows(),budget);
  assert.deepEqual(seed.perLine.map(line=>line.__i),[0],"the bounded seed must preserve its representative old choice");
  assert.ok(close(seed.gelHr,6.747891283973758),"the bounded seed representative output changed");
  const exactOriginal=gelLoadout,seedOriginal=gelSeedLoadout;
  let exactCalls=0,seedCalls=0;
  gelLoadout=function(){exactCalls++;throw new Error("solve paths must not invoke exact Gel loadout");};
  gelSeedLoadout=function(){seedCalls++;return seedOriginal.apply(null,arguments);};
  PRODUCTS.forEach(product=>S.targets[product]={on:product==="Gel",w:1});
  S.mode="items";S.minedIncome.Vespium=budget/60;
  let solved=optimize();
  assert.ok(solved.feasible&&seedCalls>0&&exactCalls===0,"Items must use only the bounded Gel seed helper");
  seedCalls=0;S.mode="credits";PRODUCTS.forEach(product=>S.targets[product].on=false);
  [...RAWS,...PRODUCTS].forEach(item=>S.sellPrice[item]=null);S.sellPrice.Gel=1;
  solved=optimize();
  assert.ok(solved.feasible&&seedCalls>0&&exactCalls===0,"Credits must use only the bounded Gel seed helper");
  gelLoadout=exactOriginal;gelSeedLoadout=seedOriginal;
  console.log("PASS Items and Credits invoke only the bounded Gel seed helper");

  assert.deepEqual(gelLoadout([],budget),{gelHr:0,vespHr:0,perLine:[]});
  assert.deepEqual(gelLoadout(pool,0),{gelHr:0,vespHr:0,perLine:[]});
  assert.deepEqual(gelLoadout(pool,-1),{gelHr:0,vespHr:0,perLine:[]});
  assert.deepEqual(gelLoadout(pool,NaN),{gelHr:0,vespHr:0,perLine:[]});
  console.log("PASS empty and nonpositive-budget inputs preserve the empty result shape");
})();
`;

globalThis.assert = assert;
eval(source + "\n;\n" + runner);
