"use strict";
/* Credits result ownership and player-facing confidence contract. */
const fs=require("fs"),path=require("path"),nativeNow=require("perf_hooks").performance.now.bind(require("perf_hooks").performance);

class El{constructor(){this.innerHTML="";this.textContent="";}}
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={getElementById:()=>new El()};
globalThis.performance={now:()=>0};globalThis.__nativeNow=nativeNow;

const src=["core.js","fields.js","state.js","project-schedule.js","solver.js","results.js","manual.js"]
  .map(file=>fs.readFileSync(path.join(__dirname,"..","js",file),"utf8")).join("\n;\n");
const indexHtml=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");

/* Every synthetic clock below prices time per clock READ — a now() that advances a fixed amount
 * per call, or one armed by a checkpoint count. The solver samples its clock once per
 * CLOCK_SAMPLE_EVERY checkpoints, which under such a clock stretches every budget by that stride
 * instead of leaving these deadlines where the assertions put them. Sample every checkpoint here,
 * so what each test asserts about budgets and cutoffs keeps meaning what it meant. */
const sampleEverySrc=`makeSolveControl=(function(raw){return function(budget,options){
  const opts=Object.assign({},options);
  if(opts.clockSampleEvery===undefined)opts.clockSampleEvery=1;
  return raw(budget,opts);};})(makeSolveControl);`;

const runner=`
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const setVespRig=(state,value)=>{state.minedIncome.Vespium.rigPerMin=value;};
  const setHydraPerMin=(state,value)=>{state.minedIncome.Hydracite.resourcesTradingPerSec=value/60;};
  check("persistent planner labels make no unqualified optimality promise",
    indexHtml.includes("Crafting production-line planner · enter your stats, compare crafter setups")&&
      indexHtml.includes('<div class="head results-head"><h2>Planner results</h2>')&&
      !indexHtml.includes("get the optimal crafter setup")&&!indexHtml.includes("<h2>Optimal setup</h2>"),
    "oldTagline="+indexHtml.includes("get the optimal crafter setup")+", oldHeading="+indexHtml.includes("<h2>Optimal setup</h2>"));
  check("Project modal qualifies schedule guidance when replay can be blocked",
    indexHtml.includes("Executable results are replay-checked")&&
      !indexHtml.includes("lays out a complete pipelined craft schedule"),
    "qualified="+indexHtml.includes("Executable results are replay-checked")+
      ", absolute="+indexHtml.includes("lays out a complete pipelined craft schedule"));

  S=defaults();S.mode="credits";S.margin=20;
  [...RAWS,...PRODUCTS].forEach(item=>S.sellPrice[item]=null);
  S.sellPrice.Bits=1;S.sellPrice.Glass=1;
  normalize(S);syncManual(S);
  const result=optimizeInner(2000,{now:()=>0,workLimit:1000000000});
  const bits=result.ranking.find(candidate=>candidate.item==="Bits");
  const glass=result.ranking.find(candidate=>candidate.item==="Glass");
  check("strict Bits candidate wins over margin Glass",result.bestItem==="Bits"&&bits&&!bits.usesMargin&&glass&&glass.usesMargin,
    "best="+result.bestItem+", bitsMargin="+(bits&&bits.usesMargin)+", glassMargin="+(glass&&glass.usesMargin));
  check("every Credits candidate owns confidence metadata",result.ranking.every(candidate=>
    typeof candidate.usesMargin==="boolean"&&typeof candidate.capped==="boolean"&&
    typeof candidate.evaluated==="boolean"&&typeof candidate.ms==="number"),"candidates="+result.ranking.length);
  check("top-level warning flags belong to the winner",result.usesMargin===false&&result.capped===bits.capped,
    "usesMargin="+result.usesMargin+", capped="+result.capped);
  check("ranking confidence is separate from winner confidence",
    typeof result.allCandidatesEvaluated==="boolean"&&typeof result.deadlineReached==="boolean"&&
      typeof result.searchExhaustive==="boolean","all="+result.allCandidatesEvaluated+", deadline="+result.deadlineReached+", exhaustive="+result.searchExhaustive);

  const el=new El(),stat=new El();renderSolveResult(result,el,stat);
  check("a strict winner does not inherit a losing May-work warning",!el.innerHTML.includes("<b>May-work plan.</b>"),"notice="+el.innerHTML.includes("<b>May-work plan.</b>"));
  const emptyItemsEl=new El(),emptyItemsStat=new El();renderSolveResult({empty:true,mode:"items"},emptyItemsEl,emptyItemsStat);
  check("empty Items guidance describes the dedicated Credits comparison",
    emptyItemsEl.innerHTML.includes("best dedicated sell plan")&&!emptyItemsEl.innerHTML.includes("profitable mix"),emptyItemsEl.innerHTML);

  S=defaults();S.mode="credits";S.margin=20;ALLITEMS.forEach(item=>S.sellPrice[item]=null);S.sellPrice.Bits=1;S.sellPrice.Glass=1;
  normalize(S);syncManual(S);const limited=optimizeInner(2000,{now:()=>0,workLimit:250000});
  const limitedBits=limited.ranking.find(candidate=>candidate.item==="Bits"),limitedGlass=limited.ranking.find(candidate=>candidate.item==="Glass");
  check("a losing capped candidate affects ranking confidence, not winner capped",
    limited.bestItem==="Bits"&&!limited.capped&&!limitedBits.capped&&limitedGlass.capped&&!limited.searchExhaustive,
    "top="+limited.capped+", bits="+limitedBits.capped+", glass="+limitedGlass.capped+", exhaustive="+limited.searchExhaustive);
  S.sellPrice.Bits=null;const cappedWinner=optimizeInner(2000,{now:()=>0,workLimit:250000});
  check("winner capped is exposed when the selected plan itself is capped",cappedWinner.bestItem==="Glass"&&cappedWinner.capped,
    "best="+cappedWinner.bestItem+", capped="+cappedWinner.capped);
  check("refinement acceptance never permits a numerical objective decrease",
    creditsRefinementIsNondecreasing({credits:1_000_000},{credits:1_000_000})&&
      creditsRefinementIsNondecreasing({credits:1_000_000},{credits:1_000_000.000001})&&
      !creditsRefinementIsNondecreasing({credits:1_000_000},{credits:999_999.999999}),
    "equal/increase accepted; any decrease rejected");

  {
    const samples=[0,94,101,101],events=[];let sampleIndex=0,localHits=0;
    const root=makeSolveControl(100,{now:()=>samples[Math.min(sampleIndex++,samples.length-1)],
      onCheckpoint:event=>events.push(event)});
    const local=makeLocalDeadlineControl(root,95,()=>{localHits++;});
    const prior={credits:10},safeRefinement={credits:20};
    local.readNow();
    const checkpointAccepted=local.checkpoint("after-safe-refinement");
    const winnerBeforeFinalization=local.isStopped()?prior:safeRefinement;
    const rootStoppedBeforeFinalization=root.isStopped();
    const finalDeadlineReached=root.deadlineReached();
    check("a shared clock sample crossing local and root keeps the safe refinement until finalization",
      !checkpointAccepted&&localHits===1&&!rootStoppedBeforeFinalization&&
        winnerBeforeFinalization===safeRefinement&&finalDeadlineReached&&root.isStopped()&&root.reason()==="deadline",
      "localHits="+localHits+", rootBefore="+rootStoppedBeforeFinalization+
        ", winner="+winnerBeforeFinalization.credits+", final="+finalDeadlineReached+
        ", events="+events.map(event=>event.type+":"+(event.reason||event.label)).join(","));
  }

  {
    const samples=[0,99,101,101],events=[];let sampleIndex=0,firstLocalHits=0,secondLocalHits=0;
    const root=makeSolveControl(1000,{now:()=>samples[Math.min(sampleIndex++,samples.length-1)],
      onCheckpoint:event=>events.push(event)});
    const first=makeLocalDeadlineControl(root,100,()=>{firstLocalHits++;});
    first.readNow();
    const firstAccepted=first.checkpoint("first-local-cutoff");
    const second=makeLocalDeadlineControl(root,200,()=>{secondLocalHits++;});
    const secondAccepted=second.checkpoint("next-candidate");
    check("a local-only cutoff leaves the root available for the next candidate",
      !firstAccepted&&firstLocalHits===1&&secondAccepted&&secondLocalHits===0&&!root.isStopped(),
      "first="+firstAccepted+"/"+firstLocalHits+", second="+secondAccepted+"/"+secondLocalHits+
        ", root="+root.isStopped()+", events="+events.map(event=>event.type+":"+(event.reason||event.label)).join(","));
  }

  {
    let clockCalls=0,localHits=0;
    const root=makeSolveControl(1000,{now:()=>{clockCalls++;return 0;},workLimit:1});
    const local=makeLocalDeadlineControl(root,100,()=>{localHits++;});
    const accepted=local.checkpoint("root-work-limit",2);
    check("root work-limit exhaustion takes precedence over a local deadline",
      !accepted&&root.isStopped()&&root.reason()==="work"&&localHits===0&&clockCalls===1,
      "accepted="+accepted+", reason="+root.reason()+", localHits="+localHits+", clockCalls="+clockCalls);
  }

  function stateFor(items,lines){
    const state=defaults();state.mode="credits";state.margin=0;
    if(lines)state.lines=lines;
    ALLITEMS.forEach(item=>state.sellPrice[item]=null);items.forEach(item=>state.sellPrice[item]=1);
    setVespRig(state,1e30);setHydraPerMin(state,1e30);
    state.forgie.Gel=0;state.forgie.Wire=0;
    normalize(state);syncManual(state);return state;
  }
  {
    S=stateFor(["Glass"]);S.margin=20;
    let baselineComplete=false;
    const baselineAtBoundary=optimizeInner(200,{now:()=>baselineComplete?201:0,workLimit:100000000,
      onCheckpoint:event=>{if(event.type==="baseline-complete")baselineComplete=true;}});

    S=stateFor(["Glass"]);S.margin=20;
    let refinementActive=false,crossNextSample=false,crossed=false;
    const boundaryEvents=[];
    const refinedAtBoundary=optimizeInner(200,{now:()=>crossNextSample?201:0,workLimit:100000000,
      onCheckpoint:event=>{
        boundaryEvents.push(event);
        if(event.type==="refinement-start")refinementActive=true;
        if(refinementActive&&!crossed&&event.type==="checkpoint"&&event.label==="deficit-pass"){
          crossed=true;crossNextSample=true;
        }
      }});
    const localBoundary=boundaryEvents.find(event=>event.type==="local-time-limit");
    check("a completed better optimizeInner refinement survives a same-sample local and root deadline crossing",
      baselineComplete&&crossed&&localBoundary&&refinedAtBoundary.deadlineReached&&
        refinedAtBoundary.objective>baselineAtBoundary.objective&&refinedAtBoundary.bestItem==="Glass",
      "baseline="+baselineAtBoundary.objective+", refined="+refinedAtBoundary.objective+
        ", crossed="+crossed+", local="+(localBoundary&&localBoundary.label)+
        ", deadline="+refinedAtBoundary.deadlineReached);
  }
  function creditsSaveRegressionState(){
    const state=defaults();state.schemaVersion=CURRENT_SCHEMA_VERSION;state.mode="credits";state.solveBudget=2000;
    state.lines=[
      {max:4096,spx:1477.94,turbo:19},{max:4096,spx:956.02,turbo:13},
      {max:2048,spx:986.62,turbo:14},{max:1024,spx:1207.59,turbo:30},
      {max:1024,spx:1266.24,turbo:30},{max:256,spx:731.34,turbo:30},
      {max:128,spx:682.47,turbo:30}
    ];
    state.maxTurbo=30;state.dupe=28.39;state.margin=0;
    Object.assign(state.baseTime,{Ingots:10.008152415790276,Bits:6.178815895950821,Concrete:9.273471564294061,
      Glass:92.68223843926229,Bricks:108.28296141848294,Plates:30.8940794797541,Rods:46.34486759132246,
      Frames:308.940794797541,Gel:3201,Wire:5400.8,"Reinforced Concrete":355531.88,Batteries:1034274.56});
    Object.assign(state.sellPrice,{Ingots:8.87e56,Bits:1.82e56,Concrete:2.18e56,Glass:3.79e58,Bricks:8.23e58,
      Plates:4.79e57,Rods:6.39e57,Frames:8.36e59,Gel:2.22e60,Wire:3.53e68});
    Object.assign(state.forgie,{Ingots:44840000,Bits:51150000,Concrete:47680000,Glass:87943.76,Bricks:76157.11,
      Plates:251430,Rods:194740,Frames:19318.22,Gel:50914.82,Wire:4054.05});
    setVespRig(state,5.0000000000000005e28);setHydraPerMin(state,300000000000);
    normalize(state);syncManual(state);return state;
  }
  function creditsSchemaV1State(){
    const state=creditsSaveRegressionState();state.schemaVersion=1;state.solveBudget=2000;
    state.minedIncome={Vespium:5.0000000000000005e28,Hydracite:300000000000};
    state.minedIncomeText={Vespium:"5e28",Hydracite:"300000000000"};
    delete state.projectStability;
    return JSON.parse(JSON.stringify(state));
  }
  const migratedCredits=validateAndMigrate(creditsSchemaV1State());
  check("save-derived schema-v1 state migrates once to schema v4 and 10 seconds",
    migratedCredits.ok&&migratedCredits.sourceVersion===1&&CURRENT_SCHEMA_VERSION===4&&
      migratedCredits.state.schemaVersion===4&&migratedCredits.state.solveBudget===10000,
    "ok="+migratedCredits.ok+", source="+migratedCredits.sourceVersion+
      ", schema="+(migratedCredits.state&&migratedCredits.state.schemaVersion)+
      ", budget="+(migratedCredits.state&&migratedCredits.state.solveBudget)+
      ", errors="+JSON.stringify(migratedCredits.errors||[]));
  const migratedCreditsState=migratedCredits.state;
  S=JSON.parse(JSON.stringify(migratedCreditsState));
  let completedBaselines=0,expireAfterBaselines=false;
  const baselineOnly=optimizeInner(S.solveBudget,{now:()=>expireAfterBaselines?10001:0,workLimit:1_000_000_000,
    onCheckpoint:event=>{if(event.type==="baseline-complete"&&++completedBaselines===10)expireAfterBaselines=true;}});
  const highestBaseline=baselineOnly.ranking.find(candidate=>candidate.evaluated);
  S=migratedCreditsState;
  let savedFirstRefinement=null,firstRefinementActive=false,firstRefinementComplete=false,refinementNow=0;
  const savedCreditsRun=optimizeInner(S.solveBudget,{now:()=>firstRefinementComplete?10001:(firstRefinementActive?(refinementNow+=0.001):0),workLimit:1_000_000_000,
    onCheckpoint:event=>{
      if(event.type==="refinement-start"&&savedFirstRefinement===null){savedFirstRefinement=event.item;firstRefinementActive=true;}
      if(event.type==="refinement-complete"&&event.item===savedFirstRefinement)firstRefinementComplete=true;
    }});
  const savedWire=savedCreditsRun.ranking.find(candidate=>candidate.item==="Wire");
  const expectedSavedWire=18423.900967529135;
  const savedWireRelativeError=savedWire?Math.abs(savedWire.out-expectedSavedWire)/expectedSavedWire:Infinity;
  check("save-derived Credits refines the highest demonstrated baseline first",
    highestBaseline&&highestBaseline.item==="Wire"&&savedFirstRefinement==="Wire",
    "baseline="+(highestBaseline&&highestBaseline.item)+", first="+savedFirstRefinement);
  check("migrated save-derived 10-second Credits solve reproduces the exact Wire result",
    firstRefinementComplete&&savedCreditsRun.bestItem==="Wire"&&savedWire&&savedWireRelativeError<=1e-12,
    "complete="+firstRefinementComplete+", best="+savedCreditsRun.bestItem+
      ", wire="+(savedWire&&savedWire.out)+", relativeError="+savedWireRelativeError);
  // Fixed references were produced by separate one-priced-item solves from this same immutable-save
  // factory. The combined comparison must find their true winner without letting an earlier chain
  // consume the shared deadline before every product gets a meaningful refinement.
  const adversarialPrices={
    Ingots:0.0000022882408714146587,Bits:0.0000020871215409567806,Concrete:0.0000021792266410571516,
    Glass:0.000089698395235427984,Bricks:0.00010412181071723304,Plates:0.000063752899301578622,
    Rods:0.000068795833566571448,Frames:0.0016603062582106654,Gel:0.00074709183844945122,
    Wire:0.013197689890849474,"Reinforced Concrete":3.6325464461141621,Batteries:13.771075770292128
  };
  const independentReferenceCredits={
    Ingots:230,Bits:229,Concrete:228,Glass:231.39153103304082,Bricks:202.1831749948749,
    Plates:204.61719991163173,Rods:208.17071181343945,Frames:246.9462158190911,Gel:220,
    Wire:243.15293154917111,"Reinforced Concrete":248.08412092636604,Batteries:225.03758406962947
  };
  const referenceWinner=Object.entries(independentReferenceCredits)
    .sort((a,b)=>b[1]-a[1]||ALLITEMS.indexOf(a[0])-ALLITEMS.indexOf(b[0]))[0];
  S=creditsSaveRegressionState();Object.assign(S.sellPrice,adversarialPrices);
  let comparisonNow=-0.0018;const refinementEvents=[];
  const deepWinnerComparison=optimizeInner(10000,{now:()=>comparisonNow+=0.0018,workLimit:1_000_000_000,
    onCheckpoint:event=>{if(event.type==="refinement-start"||event.type==="refinement-complete")refinementEvents.push(event);}});
  const deepWinnerRc=deepWinnerComparison.ranking.find(candidate=>candidate.item==="Reinforced Concrete");
  const boundedComplete=PRODUCTS.map(item=>refinementEvents.findIndex(event=>
    event.type==="refinement-complete"&&event.round==="bounded"&&event.item===item));
  const firstDeep=refinementEvents.findIndex(event=>event.type==="refinement-start"&&event.round==="deep");
  check("independent per-product references make Reinforced Concrete the deep winner",
    referenceWinner[0]==="Reinforced Concrete"&&referenceWinner[1]===248.08412092636604,
    referenceWinner[0]+":"+referenceWinner[1]);
  check("10-second all-priced comparison matches the independent deep winner",
    deepWinnerComparison.bestItem===referenceWinner[0]&&deepWinnerRc&&
      deepWinnerRc.credits>=referenceWinner[1]-1e-9*Math.max(1,referenceWinner[1]),
    "all="+deepWinnerComparison.bestItem+":"+(deepWinnerRc&&deepWinnerRc.credits)+", ref="+referenceWinner[0]+":"+referenceWinner[1]);
  check("every product finishes its first refinement before any adaptive deep work",
    boundedComplete.every(index=>index>=0)&&(firstDeep<0||firstDeep>Math.max(...boundedComplete)),
    "bounded="+boundedComplete.join(",")+", firstDeep="+firstDeep);
  S=creditsSaveRegressionState();Object.assign(S.sellPrice,adversarialPrices);
  let lowBudgetNow=-0.0018;const lowBudgetEvents=[];
  const lowBudgetComparison=optimizeInner(2000,{now:()=>lowBudgetNow+=0.0018,workLimit:1_000_000_000,
    onCheckpoint:event=>{if(event.type==="refinement-start"||event.type==="refinement-complete")lowBudgetEvents.push(event);}});
  const lowBounded=PRODUCTS.map(item=>lowBudgetEvents.findIndex(event=>
    event.type==="refinement-complete"&&event.round==="bounded"&&event.item===item));
  const lowDeep=lowBudgetEvents.findIndex(event=>event.type==="refinement-start"&&event.round==="deep");
  check("a lower user budget remains safe and never starts deep work ahead of the fair pass",
    lowBudgetComparison.allCandidatesEvaluated&&lowBudgetComparison.objective>=230&&
      (lowDeep<0||(lowBounded.every(index=>index>=0)&&lowDeep>Math.max(...lowBounded))),
    "best="+lowBudgetComparison.bestItem+":"+lowBudgetComparison.objective+
      ", bounded="+lowBounded.join(",")+", firstDeep="+lowDeep);
  // A second all-catalog fixture selects a different deep-chain winner. This is a guard against
  // accidentally encoding the RC counterexample itself as item priority.
  const batteriesWinnerPrices={
    Ingots:1.0346828288135849e-6,Bits:9.3874899003732933e-7,Concrete:9.7491718152556779e-7,
    Glass:4.1399259339428304e-5,Bricks:5.4837486977742735e-5,Plates:3.3293180746379948e-5,
    Rods:3.5162314934025405e-5,Frames:7.0686306042632287e-4,Gel:3.5656655925996538e-4,
    Wire:0.005738126039499772,"Reinforced Concrete":1.5256695073679483,Batteries:6.557655128710538
  };
  S=creditsSaveRegressionState();Object.assign(S.sellPrice,batteriesWinnerPrices);
  let batteriesNow=-0.0018;
  const batteriesComparison=optimizeInner(10000,{now:()=>batteriesNow+=0.0018,workLimit:1_000_000_000});
  const batteriesCandidate=batteriesComparison.ranking.find(candidate=>candidate.item==="Batteries");
  check("fair refinement remains catalog-generic when Batteries is the true winner",
    batteriesComparison.bestItem==="Batteries"&&batteriesCandidate&&
      batteriesCandidate.credits>=107.16075431887117-1e-9*107.16075431887117,
    "best="+batteriesComparison.bestItem+", credits="+(batteriesCandidate&&batteriesCandidate.credits));
  let baselineFinished=false;
  S=stateFor(["Bits"]);
  const boundaryResult=optimizeInner(200,{now:()=>baselineFinished?201:0,workLimit:1_000_000,
    onCheckpoint:event=>{if(event.type==="baseline-complete")baselineFinished=true;}});
  check("final result refreshes deadline telemetry without revoking an exact raw proof",
    boundaryResult.ms>=200&&boundaryResult.deadlineReached&&boundaryResult.searchExhaustive,
    "ms="+boundaryResult.ms+", deadline="+boundaryResult.deadlineReached+", exhaustive="+boundaryResult.searchExhaustive);
  let productBaselineFinished=false;
  S=stateFor(["Glass","Bricks"]);
  const lateProduct=optimizeInner(200,{now:()=>productBaselineFinished?201:0,workLimit:10_000_000,
    onCheckpoint:event=>{if(event.type==="checkpoint"&&event.label==="baseline-product-complete")productBaselineFinished=true;}});
  const lateGlass=lateProduct.ranking.find(candidate=>candidate.item==="Glass"),lateBricks=lateProduct.ranking.find(candidate=>candidate.item==="Bricks");
  check("a completed product baseline survives finalization expiry while later products remain unevaluated",
    lateProduct.deadlineReached&&!lateProduct.allCandidatesEvaluated&&!lateProduct.searchExhaustive&&lateGlass.evaluated&&lateGlass.capped&&!lateBricks.evaluated,
    "deadline="+lateProduct.deadlineReached+", Glass="+lateGlass.evaluated+"/"+lateGlass.capped+", Bricks="+lateBricks.evaluated);
  const compact=res=>({bestItem:res.bestItem,objective:res.objective,allCandidatesEvaluated:res.allCandidatesEvaluated,
    deadlineReached:res.deadlineReached,searchExhaustive:res.searchExhaustive,
    ranking:ALLITEMS.filter(item=>res.ranking.some(candidate=>candidate.item===item)).map(item=>{const c=res.ranking.find(candidate=>candidate.item===item);
      return [item,c.evaluated,c.capped,c.usesMargin,c.credits];})});
  function injectedRun(budget){
    S=stateFor(["Bits","Glass"]);S.margin=20;S.sellPrice.Bits=0.01;
    const before=JSON.stringify(S),events=[],labels=new Set();let now=0,calls=0;
    const res=optimizeInner(budget,{now:()=>{calls++;now+=0.000001;return now;},workLimit:budget*1000,
      onCheckpoint:event=>{if(event.type==="checkpoint")labels.add(event.label);else events.push(event);}});
    return {res,events,labels,calls,before,after:JSON.stringify(S)};
  }
  const injected=[200,400,800,1600].map(budget=>{
    const first=injectedRun(budget),second=injectedRun(budget);
    check("injected "+budget+"ms run is deterministic",JSON.stringify(compact(first.res))===JSON.stringify(compact(second.res)),
      JSON.stringify(compact(first.res)));
    check("injected "+budget+"ms run leaves state immutable",first.before===first.after,"same="+(first.before===first.after));
    return first;
  });
  for(let i=1;i<injected.length;i++){
    const prior=injected[i-1].res,current=injected[i].res;
    const objectives=ALLITEMS.every(item=>{const a=prior.ranking.find(c=>c.item===item),b=current.ranking.find(c=>c.item===item);
      return !a||!b||((!a.evaluated||b.evaluated)&&b.credits+1e-9*Math.max(1,a.credits)>=a.credits);});
    check("injected objectives/evaluated set are nondecreasing through "+[200,400,800,1600][i]+"ms",
      objectives&&current.objective+1e-9*Math.max(1,prior.objective)>=prior.objective,
      prior.objective+" -> "+current.objective);
  }
  check("larger deterministic work budgets make measurable progress",injected[3].res.objective>injected[0].res.objective,
    injected[0].res.objective+" -> "+injected[3].res.objective);
  const longest=injected[injected.length-1],lastBaseline=Math.max(...longest.events.map((event,index)=>event.type==="baseline-complete"?index:-1));
  const firstRefinement=longest.events.findIndex(event=>event.type==="refinement-start");
  check("every baseline completes before refinement",longest.res.allCandidatesEvaluated&&firstRefinement>lastBaseline,
    "lastBaseline="+lastBaseline+", firstRefinement="+firstRefinement);
  check("deadline checkpoints reach inner baseline/search loops",
    ["raw-level","repair-job","climb-job","lp-pivot","role-enumeration","dfs-node","deficit-job"].every(label=>longest.labels.has(label)),[...longest.labels].join(","));
  S=stateFor(["Gel"]);S.forgie.Gel=0;const gelLabels=new Set();
  optimizeInner(2000,{now:()=>0,workLimit:5000000,onCheckpoint:event=>{if(event.type==="checkpoint")gelLabels.add(event.label);}});
  check("Gel refinement checks prefix and bounded seed loops",gelLabels.has("gel-prefix")&&gelLabels.has("gel-seed-line"),[...gelLabels].join(","));
  function interruptAt(item,label){
    S=stateFor([item]);if(item==="Glass")S.margin=20;if(item==="Gel")S.forgie.Gel=0;
    const before=JSON.stringify(S);let armed=false,seen=false;
    const res=optimizeInner(100,{now:()=>armed?1000:0,workLimit:1000000000,onCheckpoint:event=>{
      if(!seen&&event.type==="checkpoint"&&event.label===label){seen=true;armed=true;}
    }});
    const candidate=res.ranking.find(row=>row.item===item),validPlan=(res.plan||[]).every(row=>row&&row.job&&
      (row.job.kind==="idle"||!!row.job.res));
    return {res,candidate,seen,stateSame:before===JSON.stringify(S),validPlan};
  }
  [["Glass","repair-job"],["Glass","climb-job"],["Glass","lp-pivot"],["Glass","role-enumeration"],
    ["Glass","dfs-node"],["Glass","deficit-job"],["Gel","gel-seed-line"],["Gel","gel-prefix"]].forEach(([item,label])=>{
    const stoppedAt=interruptAt(item,label);
    check("interruption at "+label+" rolls back without promoting partial work",stoppedAt.seen&&stoppedAt.res.deadlineReached&&
      stoppedAt.stateSame&&stoppedAt.validPlan&&!stoppedAt.res.searchExhaustive&&
      (!stoppedAt.candidate.evaluated||stoppedAt.candidate.capped),
      "seen="+stoppedAt.seen+", deadline="+stoppedAt.res.deadlineReached+", evaluated="+stoppedAt.candidate.evaluated+
        ", capped="+stoppedAt.candidate.capped+", stateSame="+stoppedAt.stateSame+", validPlan="+stoppedAt.validPlan);
  });

  S=stateFor(["Ingots","Bits","Glass"]);
  let stopTick=0;const stopped=optimizeInner(200,{now:()=>stopTick,workLimit:2});
  check("expiry during a baseline discards it and all later baselines",stopped.deadlineReached&&!stopped.allCandidatesEvaluated&&
    stopped.ranking.every(candidate=>!candidate.evaluated)&&stopped.ranking.every(candidate=>candidate.ms===0),
    stopped.ranking.map(candidate=>candidate.item+":"+candidate.evaluated).join(","));
  const stoppedEl=new El(),stoppedStat=new El();renderSolveResult(stopped,stoppedEl,stoppedStat);
  check("incomplete UI names unevaluated items and renders dashes",stoppedEl.innerHTML.includes("Comparison incomplete")&&
    stoppedEl.innerHTML.includes("not evaluated")&&stoppedEl.innerHTML.includes("—")&&!stoppedEl.innerHTML.includes("No sustainable plan found"),
    stoppedStat.textContent);
  check("all-idle result hides Copy to Manual",!stoppedEl.innerHTML.includes('id="btnCopyManual"'),"copy="+stoppedEl.innerHTML.includes('id="btnCopyManual"'));

  S=stateFor([]);const noPrices=optimizeInner(200,{now:()=>0,workLimit:100});
  const emptyEl=new El(),emptyStat=new El();renderSolveResult(noPrices,emptyEl,emptyStat);
  check("no-price Credits result hides Copy to Manual",!emptyEl.innerHTML.includes('id="btnCopyManual"'),"copy="+emptyEl.innerHTML.includes('id="btnCopyManual"'));
  const boundedNoPlan={...noPrices,issues:[],ranking:[{item:"Batteries",kind:"product",out:0,price:1,credits:0,plan:null,balance:null,
    minedUsage:[],resIndex:{},feasible:false,usesMargin:false,capped:true,evaluated:true,ms:1}],allCandidatesEvaluated:true,
    deadlineReached:true,searchExhaustive:false,capped:false,ms:1};
  const boundedEl=new El(),boundedStat=new El();renderSolveResult(boundedNoPlan,boundedEl,boundedStat);
  check("capped zero baseline does not claim no sustainable plan",boundedEl.innerHTML.includes("no plan found in bounded search")&&
    !boundedEl.innerHTML.includes("No sustainable plan found"),"boundedCopy="+boundedEl.innerHTML.includes("no plan found in bounded search"));
  S=stateFor(["Glass"]);S.forgie.Glass=1000;
  RECIPE.Glass.inputs.forEach(input=>LEVELS.forEach(level=>{S.prodCost.Glass[input][level]=null;}));
  const passiveOnly=optimizeInner(200,{now:()=>0,workLimit:100000});
  const passiveGlass=passiveOnly.ranking.find(candidate=>candidate.item==="Glass");
  check("missing craft costs retain the executable passive-output baseline",
    passiveOnly.bestItem==="Glass"&&passiveOnly.credits===1000&&passiveGlass.out===1000&&passiveGlass.feasible&&
      passiveGlass.plan.every(row=>row.job.kind==="idle")&&!passiveGlass.capped&&passiveOnly.searchExhaustive,
    "best="+passiveOnly.bestItem+", credits="+passiveOnly.credits+", capped="+(passiveGlass&&passiveGlass.capped));
  S=stateFor(["Frames"]);S.forgie.Plates=0;S.forgie.Frames=0;
  RECIPE.Plates.inputs.forEach(input=>LEVELS.forEach(level=>{S.prodCost.Plates[input][level]=null;}));
  const transitiveMissing=optimizeInner(2000,{now:()=>0,workLimit:10_000_000});
  const transitiveEl=new El(),transitiveStat=new El();renderSolveResult(transitiveMissing,transitiveEl,transitiveStat);
  check("Credits surfaces missing transitive recipe data instead of a definitive no-plan claim",
    transitiveMissing.issues.includes("No material cost entered for Plates.")&&transitiveEl.innerHTML.includes("Missing data:")&&
      !transitiveEl.innerHTML.includes("No sustainable plan found"),
    "issues="+JSON.stringify(transitiveMissing.issues)+", noPlan="+transitiveEl.innerHTML.includes("No sustainable plan found"));
  S=stateFor([],[{max:1,spx:1,turbo:0}]);
  const beyondCurrentPlan=[null,{line:2,max:1,sp:1,dp:1,spx:1,dup:0,
    job:{kind:"produce",res:"Bits",lvl:1,ct:1,prod:[[0,1]],cons:[]}}];
  const beyondCurrentRes={...noPrices,issues:[],ranking:[],resIndex:{Bits:0},plan:beyondCurrentPlan,ms:1};
  const beyondEl=new El(),beyondStat=new El();let beyondRenderError=null;
  try{renderSolveResult(beyondCurrentRes,beyondEl,beyondStat);}catch(error){beyondRenderError=error;}
  check("render ignores executable rows beyond the current physical line count",
    !beyondRenderError&&!beyondEl.innerHTML.includes('id="btnCopyManual"')&&!beyondEl.innerHTML.includes('<td class="mono">#2</td>'),
    "error="+(beyondRenderError&&beyondRenderError.message)+", copy="+beyondEl.innerHTML.includes('id="btnCopyManual"'));
  let mutations=0,saves=0,renders=0;
  mutateState=fn=>{mutations++;fn(S);};save=()=>{saves++;};globalThis.renderModeSwitch=()=>{};renderResults=()=>{renders++;};
  const beforeMode=S.mode;let beyondCopyError=null;
  try{copyPlanToManual({mode:"credits",bestItem:"Bits",plan:beyondCurrentPlan});}catch(error){beyondCopyError=error;}
  check("direct copy ignores executable rows beyond the current physical line count",
    !beyondCopyError&&S.mode===beforeMode&&mutations===0&&saves===0&&renders===0,
    "error="+(beyondCopyError&&beyondCopyError.message)+", mode="+S.mode+", mutations="+mutations);
  mutations=saves=renders=0;
  copyPlanToManual({mode:"credits",bestItem:null,plan:idlePlan()});
  copyPlanToManual({mode:"credits",bestItem:null,plan:[{job:{kind:"craft",res:null,lvl:1}}]});
  copyPlanToManual({mode:"credits",bestItem:"OldItem",plan:[{job:{kind:"craft",res:"OldItem",lvl:1}}]});
  check("direct all-idle/malformed/stale copy is a side-effect-free no-op",S.mode===beforeMode&&mutations===0&&saves===0&&renders===0,
    "mode="+S.mode+", mutations="+mutations+", saves="+saves+", renders="+renders);
  const staleRender={...noPrices,issues:[],ranking:[],resIndex:{},plan:[{line:1,max:1,sp:1,dp:1,spx:1,dup:0,
    job:{kind:"craft",res:"OldItem",lvl:1,ct:1,prod:[[0,0]],cons:[]}}],ms:1};
  const staleEl=new El(),staleStat=new El();renderSolveResult(staleRender,staleEl,staleStat);
  check("unknown-resource result hides Copy to Manual",!staleEl.innerHTML.includes('id="btnCopyManual"'),"copy="+staleEl.innerHTML.includes('id="btnCopyManual"'));
  S=stateFor([]);
  const validPlan=S.lines.map((line,index)=>index===0?null:{job:index===1?{kind:"produce",res:"Bits",lvl:1}:{kind:"craft",res:"OldItem",lvl:1}});
  copyPlanToManual({mode:"credits",bestItem:"Bits",plan:validPlan});
  check("valid copy switches modes, idles null/stale rows, and sells only the winning item",S.mode==="manual"&&S.manual[0].job==="Idle"&&
    S.manual[1].job==="Bits"&&S.manual[1].sell&&S.manual[2].job==="Idle"&&mutations===1&&saves===1&&renders===1,
    JSON.stringify(S.manual.slice(0,3)));

  S=stateFor(["Ingots","Bits","Concrete"],[{max:1,spx:1,turbo:0}]);
  S.forgie.Ingots=0;S.forgie.Bits=0;S.forgie.Concrete=0;
  const ingotsOut=solveRaw("Ingots").out,bitsOut=solveRaw("Bits").out,concreteOut=solveRaw("Concrete").out;
  S.forgie.Ingots=1024-ingotsOut;S.forgie.Bits=1024-bitsOut;S.forgie.Concrete=1024-concreteOut;
  S.sellPrice.Ingots=1;S.sellPrice.Bits=1;S.sellPrice.Concrete=1;
  const tied=optimizeInner(200,{now:()=>0,workLimit:100000});
  check("bit-exact equal-credit ties follow explicit catalog order",tied.ranking.slice(0,3).every(candidate=>candidate.credits===1024)&&
    tied.ranking[0].item==="Ingots"&&tied.ranking[1].item==="Bits"&&tied.ranking[2].item==="Concrete",
    tied.ranking.map(candidate=>candidate.item+":"+candidate.credits).join(","));
  S.sellPrice.Bits=1+0.75e-12;S.sellPrice.Concrete=1+1.5e-12;
  const ordered=optimizeInner(200,{now:()=>0,workLimit:100000});
  check("nearby unequal credits sort by raw value without chained fuzzy ties",
    ordered.ranking[0].item==="Concrete"&&ordered.ranking[1].item==="Bits"&&ordered.ranking[2].item==="Ingots",
    ordered.ranking.map(candidate=>candidate.item+":"+candidate.credits).join(","));

  const wallLines=Array.from({length:12},(_,index)=>({max:[512,512,256,128,64,64,32,512,128,64,256,32][index],spx:40+(index*7%13),turbo:0}));
  [200,400,800,1600].forEach(budget=>{
    S=stateFor(ALLITEMS,wallLines);const start=__nativeNow();const wall=optimizeInner(budget,{now:__nativeNow});const elapsed=__nativeNow()-start;
    check("12-line all-priced Credits honors loose "+budget+"ms wall guard",elapsed<budget+500&&wall.ranking.length===ALLITEMS.length,
      elapsed.toFixed(1)+"ms, evaluated="+wall.ranking.filter(candidate=>candidate.evaluated).length);
  });

  if(fail)process.exitCode=1;
})();`;

eval(src+"\n;\n"+sampleEverySrc+"\n"+runner);
