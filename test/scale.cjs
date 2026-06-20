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

  const GEL = 'Gel', BUDGET = 5e23;
  const scen = {
    'items.Wire+Gel': s => { s.mode='items'; on(s,['Wire','Frames']); s.gelVesp=BUDGET; },
    'credits.Wire+Gel': s => { s.mode='credits'; ['Wire','Frames','Rods'].forEach(p=>s.sellPrice[p]= p==='Wire'?5000:10); s.gelVesp=BUDGET; },
    'project.Wire+Gel': s => { s.mode='project'; s.gelVesp=BUDGET;
      s.projects=[{id:'a',name:'P',catId:'',on:true,from:1,to:1,done:0,prio:null,levels:[{costs:[{item:'Wire',qty:8000},{item:'Frames',qty:4000}]}]}]; },
  };

  const out=[];
  [5,7,8,10,12].forEach(N=>{
    Object.keys(scen).forEach(name=>{
      const s=base(); s.lines=mkLines(N); scen[name](s); normalize(s); syncManual(s); S=s;
      const t0=performance.now(); let res,err=null;
      try{ res=optimize(); }catch(e){ err=(e&&e.stack||String(e)).split('\\n')[0]; }
      const ms=performance.now()-t0;
      out.push({N, name, ms:Math.round(ms), feasible:res&&res.feasible, capped:res&&!!res.capped,
        obj: res&&res.objective!=null?Number(res.objective.toPrecision(5)):null, err});
    });
  });
  // table
  const pad=(s,w)=>(s+'').padEnd(w);
  __emit(pad('lines',6)+pad('scenario',20)+pad('ms',8)+pad('capped',8)+pad('feasible',10)+'objective');
  out.forEach(r=> __emit(pad(r.N,6)+pad(r.name,20)+pad(r.err?'ERR':r.ms,8)+pad(r.capped,8)+pad(r.feasible,10)+(r.err||r.obj)));
})();
`;

// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
