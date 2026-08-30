"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Real-wall-clock scaling check (NOT frozen — measures actual solve time + cap behavior).
 *
 * Confirms that as line count grows past 7→8→10→12, solves stay bounded:
 *  - items/credits: anytime-capped (~600/650ms) — cap is a quality knob, never a freeze.
 *  - project: LP, fast and exact.
 * The old Gel reservation sweep (2^M subsets) is gone, so Gel scenarios no longer blow up.
 *
 *   node test/scale.cjs
 */
const fs = require("fs");
const path = require("path");

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };
// real clock: do NOT override performance — Node provides performance.now()

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const projectSrc = fs.readFileSync(path.join(__dirname, "..", "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");

globalThis.__emit = (s) => process.stdout.write(s + "\n");

const runner = `
(function(){
  // realistic line: vary speed a little so lines aren't all identical (worst case for symmetry pruning)
  const mkLines = n => Array.from({length:n}, (_,i) => ({
    max: [512,512,256,128,64,64,32,512,128,64,256,32][i%12],
    spx: 40 + (i*7 % 13), turbo: 0,
  }));
  function base(){ const s = defaults(); s.dupe = 12.4; s.margin = 0; return s; }
  function on(s, items){ PRODUCTS.forEach(p => s.targets[p] = {on: items.includes(p), w: 1}); }

  const VESP_BUDGET=5e23,HYDRA_BUDGET=5e20;
  const setMined=(s,vesp=VESP_BUDGET,hydra=HYDRA_BUDGET)=>{
    s.minedIncome.Vespium.resourcesTradingPerSec=vesp/60;
    s.minedIncome.Hydracite.resourcesTradingPerSec=hydra/60;
  };
  const prepBattery=(s,hydra=HYDRA_BUDGET)=>{
    setMined(s,VESP_BUDGET,hydra);
    s.forgie.Gel=13500;s.forgie.Wire=1e12;
  };
  const scen = {
    'items.Wire+Gel': s => { s.mode='items'; on(s,['Wire','Frames']); setMined(s,VESP_BUDGET,0); },
    'credits.Wire+Gel': s => { s.mode='credits'; ['Wire','Frames','Rods'].forEach(p=>s.sellPrice[p]= p==='Wire'?5000:10); setMined(s,VESP_BUDGET,0); },
    'project.Wire+Gel': s => { s.mode='project'; setMined(s,VESP_BUDGET,0);
      s.projects=[{id:'wire',name:'Wire scale',catId:'',on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:'Wire',qty:8000},{item:'Frames',qty:4000}]}]}]; },
    'items.Batteries': s => { s.mode='items'; on(s,['Batteries']); prepBattery(s); },
    'credits.Batteries': s => { s.mode='credits'; s.sellPrice.Batteries=5000; prepBattery(s); },
    'project.Batteries': s => { s.mode='project'; prepBattery(s);
      s.projects=[{id:'battery',name:'Battery scale',catId:'',on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:'Batteries',qty:250}]}]}]; },
    'items.Batteries.noHydracite': s => { s.mode='items'; on(s,['Batteries']); prepBattery(s,0); s.minedIncome.Vespium.resourcesTradingPerSec=1e40/60; },
  };
  function minedTelemetry(res){
    const rows=res&&Array.isArray(res.minedUsage)?res.minedUsage:
      res&&Array.isArray(res.phases)?res.phases.flatMap(p=>p.minedUsage||[]):[];
    const out={};rows.forEach(x=>out[x.resource]=(out[x.resource]||0)+x.inputHr);return out;
  }
  const stablePositiveSum=values=>values.filter(value=>value>0).slice()
    .sort((a,b)=>a-b).reduce((sum,value)=>sum+value,0);

  // Directly exercise the exact helper at every UI-owned factory size. These are realistic
  // high caps (up to 512x), mixed line speeds, and two nontrivial budget points; optimize()
  // deliberately uses gelSeedLoadout(), so optimizer timing alone would not cover this path.
  const exactOut=[];
  [5,7,8,10,12].forEach(N=>{
    const s=base();s.lines=mkLines(N);normalize(s);S=s;
    const rows=lineRows(),before=JSON.stringify(rows);
    const fullBudget=stablePositiveSum(rows.map(row=>gelVespHr(row,row.max)));
    const lowBudget=fullBudget*0.23,highBudget=fullBudget*0.41;
    let t0=performance.now();const high=gelLoadout(rows,highBudget),highMs=performance.now()-t0;
    t0=performance.now();const reversed=gelLoadout(rows.slice().reverse(),highBudget),reverseMs=performance.now()-t0;
    t0=performance.now();const low=gelLoadout(rows,lowBudget),lowMs=performance.now()-t0;
    const seed=gelSeedLoadout(rows,highBudget);
    exactOut.push({N,rows,before,lowBudget,highBudget,low,high,reversed,seed,
      highMs:Math.round(highMs),reverseMs:Math.round(reverseMs),lowMs:Math.round(lowMs)});
  });
  const symmetricState=base();symmetricState.lines=Array.from({length:12},()=>({max:512,spx:40,turbo:0}));
  normalize(symmetricState);S=symmetricState;
  const symmetricRows=lineRows();
  const symmetricBudget=stablePositiveSum(symmetricRows.map(row=>gelVespHr(row,row.max)))*0.41;
  let symmetricStart=performance.now();
  const symmetricExact=gelLoadout(symmetricRows,symmetricBudget);
  const symmetricMs=Math.round(performance.now()-symmetricStart);
  const symmetricSeed=gelSeedLoadout(symmetricRows,symmetricBudget);

  const out=[];
  [5,7,8,10,12].forEach(N=>{
    Object.keys(scen).forEach(name=>{
      const s=base(); s.lines=mkLines(N); scen[name](s); normalize(s); syncManual(s); S=s;
      const t0=performance.now(); let res,err=null;
      try{ res=optimize(); }catch(e){ err=(e&&e.stack||String(e)).split('\\n')[0]; }
      const ms=performance.now()-t0;
      const rankedBattery=res&&Array.isArray(res.ranking)?res.ranking.find(x=>x.item==='Batteries'):null;
      const batteryOut=res&&res.out?(res.out.Batteries||0):rankedBattery?(rankedBattery.out||0):res&&res.rate?(res.rate.Batteries||0):0;
      const mined=minedTelemetry(res);
      out.push({N, name, ms:Math.round(ms), feasible:res&&res.feasible, capped:res&&!!res.capped,
        obj: res&&res.objective!=null?Number(res.objective.toPrecision(5)):null,
        batteryOut, mined, bestItem:res&&res.bestItem,
        budgetVespHr:minedBudgetHr('Vespium',s).toNumber(), budgetHydraHr:minedBudgetHr('Hydracite',s).toNumber(), err});
    });
  });
  // table
  const pad=(s,w)=>(s+'').padEnd(w);
  const fmt=n=>Math.abs(n)>=1e6?Number(n).toExponential(4):Number(Number(n).toPrecision(5));
  __emit('TELEMETRY — informational scale samples; only explicit ok/FAIL checks below affect this test result.');
  __emit(pad('lines',6)+pad('scenario',30)+pad('ms',8)+pad('capped',8)+pad('feasible',10)+pad('objective',14)+pad('Batteries/hr',16)+pad('Vespium/hr',16)+'Hydracite/hr');
  out.forEach(r=> __emit('TELEMETRY '+pad(r.N,6)+pad(r.name,30)+pad(r.err?'ERR':r.ms,8)+pad(r.capped,8)+pad(r.feasible,10)+
    pad(r.err||r.obj,14)+pad(fmt(r.batteryOut),16)+pad(fmt(r.mined.Vespium||0),16)+fmt(r.mined.Hydracite||0)));
  exactOut.forEach(r=>__emit('TELEMETRY '+r.N+' lines exact Gel helper high/reverse/low '+
    r.highMs+'/'+r.reverseMs+'/'+r.lowMs+'ms, '+r.low.gelHr+' -> '+r.high.gelHr+' Gel/hr'));
  __emit('TELEMETRY 12 identical max512 lines exact Gel helper '+symmetricMs+'ms, '+symmetricExact.gelHr+' Gel/hr');

  let scaleFail=false;
  const close=(a,b)=>Math.abs(a-b)<=Number.EPSILON*64*Math.max(1,Math.abs(a),Math.abs(b));
  exactOut.forEach(x=>{
    const ids=x.high.perLine.map(line=>line.__i);
    const legal=x.high.perLine.every(line=>{
      const source=x.rows.find(row=>row.__i===line.__i);
      return source&&LEVELS.includes(line.L)&&line.L<=source.max&&line.frac===1&&
        close(line.gelHr,gelOutHr(source,line.L))&&close(line.vespHr,gelVespHr(source,line.L));
    });
    const summedGel=stablePositiveSum(x.high.perLine.map(line=>line.gelHr));
    const summedVesp=stablePositiveSum(x.high.perLine.map(line=>line.vespHr));
    const ok=x.high.gelHr>0&&x.low.gelHr>0&&x.high.vespHr<=x.highBudget&&x.low.vespHr<=x.lowBudget&&
      x.high.gelHr>=x.seed.gelHr-Number.EPSILON*64*Math.max(1,x.high.gelHr,x.seed.gelHr)&&
      x.high.gelHr>=x.low.gelHr-Number.EPSILON*64*Math.max(1,x.high.gelHr,x.low.gelHr)&&
      JSON.stringify(x.high)===JSON.stringify(x.reversed)&&JSON.stringify(x.rows)===x.before&&
      ids.length===new Set(ids).size&&legal&&close(x.high.gelHr,summedGel)&&close(x.high.vespHr,summedVesp)&&
      x.highMs<5000&&x.reverseMs<5000&&x.lowMs<5000;
    __emit((ok?'ok   ':'FAIL ')+x.N+' lines exact Gel helper is positive, seed-dominating, deterministic, monotone, strict-budget, and responsive ['+
      x.highMs+'/'+x.reverseMs+'/'+x.lowMs+'ms]');
    if(!ok)scaleFail=true;
  });
  const symmetricLevels=symmetricExact.perLine.map(line=>line.L);
  const symmetricOk=symmetricExact.gelHr>0&&symmetricExact.vespHr<=symmetricBudget&&
    symmetricExact.gelHr>=symmetricSeed.gelHr-Number.EPSILON*64*Math.max(1,symmetricExact.gelHr,symmetricSeed.gelHr)&&
    JSON.stringify(symmetricLevels)===JSON.stringify([64,128,128,128,256,256,256,256,256,256,256,256])&&
    symmetricMs<5000;
  __emit((symmetricOk?'ok   ':'FAIL ')+'12 identical max512 lines use the canonical exact loadout responsively ['+symmetricMs+'ms]');
  if(!symmetricOk)scaleFail=true;
  const capOk=(used,budget)=>used<=budget+1e-8*Math.max(1,budget);
  out.filter(x=>/Batteries$/.test(x.name)).forEach(x=>{
    const creditOk=!/^credits\./.test(x.name)||x.bestItem==='Batteries';
    const ok=!x.err&&x.feasible&&x.obj>0&&x.batteryOut>0&&creditOk&&
      x.mined.Vespium>0&&x.mined.Hydracite>0&&
      capOk(x.mined.Vespium,x.budgetVespHr)&&capOk(x.mined.Hydracite,x.budgetHydraHr);
    __emit((ok?'ok   ':'FAIL ')+x.N+' lines '+x.name+' is feasible and respects both mined caps');
    if(!ok)scaleFail=true;
  });
  out.filter(x=>x.name==='items.Batteries.noHydracite').forEach(x=>{
    const ok=!x.err&&x.batteryOut<=1e-9&&!(x.mined.Hydracite>0);
    __emit((ok?'ok   ':'FAIL ')+x.N+' lines cannot make Batteries without Hydracite');
    if(!ok)scaleFail=true;
  });
  out.filter(x=>/^(items|credits)\./.test(x.name)).forEach(x=>{
    const ok=!x.err&&x.ms<12000;
    __emit((ok?'ok   ':'FAIL ')+x.N+' lines '+x.name+' completes inside the loose 12s wall bound ['+x.ms+'ms]');
    if(!ok)scaleFail=true;
  });

  function batteryBudgetRun(mode,ms){
    const s=base();s.mode=mode;s.lines=mkLines(12);prepBattery(s);
    if(mode==='items')on(s,['Batteries']);
    else{PRODUCTS.forEach(product=>s.targets[product]={on:false,w:1});
      [...RAWS,...PRODUCTS].forEach(item=>s.sellPrice[item]=null);s.sellPrice.Batteries=5000;}
    s.solveBudget=ms;normalize(s);syncManual(s);S=s;return optimize();
  }
  ['items','credits'].forEach(mode=>{
    const shortBudget=batteryBudgetRun(mode,400),longBudget=batteryBudgetRun(mode,1600);
    const responsive=[shortBudget,longBudget].every(result=>result&&result.feasible&&(result.objective||0)>0)&&
      (mode!=='credits'||(shortBudget.bestItem==='Batteries'&&longBudget.bestItem==='Batteries'));
    __emit((responsive?'ok   ':'FAIL ')+mode+' Battery real-clock budgets return valid responsive plans ['+
      (shortBudget.objective||0)+' -> '+(longBudget.objective||0)+']');
    if(!responsive)scaleFail=true;
  });
  function frozenGelBudgetRun(mode,solveBudget){
    const s=base();s.mode=mode;s.dupe=0;s.maxTurbo=0;s.margin=0;
    s.lines=[{max:1,spx:6,turbo:0},{max:1,spx:4,turbo:0},{max:1,spx:4,turbo:0}];
    s.minedIncome.Vespium.resourcesTradingPerSec=4498594189315839/3600;s.solveBudget=solveBudget;
    PRODUCTS.forEach(product=>s.targets[product]={on:mode==='items'&&product==='Gel',w:1});
    [...RAWS,...PRODUCTS].forEach(item=>s.sellPrice[item]=null);if(mode==='credits')s.sellPrice.Gel=1;
    normalize(s);syncManual(s);S=s;
    const t0=performance.now(),result=optimize(),ms=performance.now()-t0;
    const outHr=mode==='items'?(result.out.Gel||0):
      (((result.ranking||[]).find(candidate=>candidate.item==='Gel')||{}).out||0);
    const vespHr=(result.minedUsage||[]).filter(use=>use.resource==='Vespium')
      .reduce((sum,use)=>sum+use.inputHr,0);
    return {mode,solveBudget,result,outHr,vespHr,ms:Math.round(ms)};
  }
  ['items','credits'].forEach(mode=>[200,400].forEach(solveBudget=>{
    const run=frozenGelBudgetRun(mode,solveBudget);
    const ok=run.result.feasible&&Math.abs(run.outHr-8.997188378631677)<=1e-12&&
      run.vespHr<=4498594189315839&&run.ms<3000;
    __emit((ok?'ok   ':'FAIL ')+mode+' real-clock '+solveBudget+'ms budget keeps the 6/4/4 correction ['+
      run.outHr+' Gel/hr in '+run.ms+'ms]');
    if(!ok)scaleFail=true;
  }));
  const allCreditsState=base();allCreditsState.mode='credits';allCreditsState.lines=mkLines(12);
  prepBattery(allCreditsState);allCreditsState.solveBudget=400;
  PRODUCTS.forEach(product=>allCreditsState.targets[product]={on:false,w:1});
  [...RAWS,...PRODUCTS].forEach((item,index)=>allCreditsState.sellPrice[item]=10+index);
  normalize(allCreditsState);syncManual(allCreditsState);S=allCreditsState;
  const allCreditsSeedOriginal=gelSeedLoadout;let allCreditsSeedCalls=0;
  gelSeedLoadout=function(){allCreditsSeedCalls++;return allCreditsSeedOriginal.apply(null,arguments);};
  const allCreditsStart=performance.now();let allCreditsResult,allCreditsError=null;
  try{allCreditsResult=optimize();}catch(error){allCreditsError=error;}
  const allCreditsMs=Math.round(performance.now()-allCreditsStart);
  gelSeedLoadout=allCreditsSeedOriginal;
  const allCreditsOk=!allCreditsError&&allCreditsResult&&allCreditsResult.feasible&&
    allCreditsResult.ranking.length===PRODUCTS.length+RAWS.length&&allCreditsSeedCalls>0&&allCreditsMs<8000;
  __emit((allCreditsOk?'ok   ':'FAIL ')+'12-line all-priced Credits exercises repeated bounded Gel seeds inside 8s ['+
    allCreditsSeedCalls+' seed calls, '+allCreditsMs+'ms]');
  if(!allCreditsOk)scaleFail=true;
  if(scaleFail)process.exitCode=1;
})();
`;

// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
