"use strict";
/* Credits result ownership and player-facing confidence contract. */
const fs=require("fs"),path=require("path"),nativeNow=require("perf_hooks").performance.now.bind(require("perf_hooks").performance);

class El{constructor(){this.innerHTML="";this.textContent="";}}
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={getElementById:()=>new El()};
globalThis.performance={now:()=>0};globalThis.__nativeNow=nativeNow;

const src=["core.js","project-schedule.js","solver.js","results.js","manual.js"]
  .map(file=>fs.readFileSync(path.join(__dirname,"..","js",file),"utf8")).join("\n;\n");
const indexHtml=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");

const runner=`
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  check("persistent planner labels make no unqualified optimality promise",
    indexHtml.includes("<p>Crafting production-line planner · enter your stats, compare crafter setups</p>")&&
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

  function stateFor(items,lines){
    const state=defaults();state.mode="credits";state.margin=0;
    if(lines)state.lines=lines;
    ALLITEMS.forEach(item=>state.sellPrice[item]=null);items.forEach(item=>state.sellPrice[item]=1);
    state.minedIncome.Vespium=1e30;state.minedIncome.Hydracite=1e30;
    state.forgie.Gel=0;state.forgie.Wire=0;
    normalize(state);syncManual(state);return state;
  }
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
  globalThis.mutateState=fn=>{mutations++;fn(S);};globalThis.save=()=>{saves++;};globalThis.renderModeSwitch=()=>{};renderResults=()=>{renders++;};
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

eval(src+"\n"+runner);
