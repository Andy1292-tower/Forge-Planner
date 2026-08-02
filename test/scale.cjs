"use strict";
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
    s.minedIncome.Vespium=vesp;s.minedIncome.Hydracite=hydra;
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
    'items.Batteries.noHydracite': s => { s.mode='items'; on(s,['Batteries']); prepBattery(s,0); s.minedIncome.Vespium=1e40; },
  };
  function minedTelemetry(res){
    const rows=res&&Array.isArray(res.minedUsage)?res.minedUsage:
      res&&Array.isArray(res.phases)?res.phases.flatMap(p=>p.minedUsage||[]):[];
    const out={};rows.forEach(x=>out[x.resource]=(out[x.resource]||0)+x.inputHr);return out;
  }

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
        budgetVespHr:s.minedIncome.Vespium*60, budgetHydraHr:s.minedIncome.Hydracite*60, err});
    });
  });
  // table
  const pad=(s,w)=>(s+'').padEnd(w);
  const fmt=n=>Math.abs(n)>=1e6?Number(n).toExponential(4):Number(Number(n).toPrecision(5));
  __emit('TELEMETRY — informational scale samples; only explicit ok/FAIL checks below affect this test result.');
  __emit(pad('lines',6)+pad('scenario',30)+pad('ms',8)+pad('capped',8)+pad('feasible',10)+pad('objective',14)+pad('Batteries/hr',16)+pad('Vespium/hr',16)+'Hydracite/hr');
  out.forEach(r=> __emit('TELEMETRY '+pad(r.N,6)+pad(r.name,30)+pad(r.err?'ERR':r.ms,8)+pad(r.capped,8)+pad(r.feasible,10)+
    pad(r.err||r.obj,14)+pad(fmt(r.batteryOut),16)+pad(fmt(r.mined.Vespium||0),16)+fmt(r.mined.Hydracite||0)));

  let scaleFail=false;
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

  function batteryBudgetRun(ms){
    const s=base();s.mode='items';s.lines=mkLines(12);on(s,['Batteries']);prepBattery(s);
    s.solveBudget=ms;normalize(s);syncManual(s);S=s;return optimize();
  }
  const shortBudget=batteryBudgetRun(400),longBudget=batteryBudgetRun(1600);
  const budgetFloor=(shortBudget.objective||0)-1e-8*Math.max(1,shortBudget.objective||0);
  const budgetMonotone=(longBudget.objective||0)>=budgetFloor;
  __emit((budgetMonotone?'ok   ':'FAIL ')+'Battery objective is non-worsening with more solve time ['+
    (shortBudget.objective||0)+' -> '+(longBudget.objective||0)+']');
  if(!budgetMonotone)process.exitCode=1;
  if(scaleFail)process.exitCode=1;
})();
`;

// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
