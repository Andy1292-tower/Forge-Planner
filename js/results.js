"use strict";
/* ---------- RENDER: results ---------- */
let _lastProjectRes=null;

/* ---------- async solve via Web Worker ----------
   The solve runs off the main thread so a long budget shows a spinner instead of freezing. Each
   request gets an id; results from superseded requests are dropped. A new request terminates the
   in-flight worker (true cancellation) rather than queuing behind it. Falls back to a synchronous
   solve if Workers are unavailable (e.g. opened over file://) or the worker fails to start. */
let _solveWorker=null,_solveReq=0,_solvePending=null,_workerBroken=false;
function _spawnSolveWorker(){
  const w=new Worker("js/solver.worker.js");
  w.onmessage=ev=>{const d=ev.data||{};
    if(d.reqId!==_solveReq)return;            // a newer solve superseded this one
    hideSolveSpinner();const cb=_solvePending;_solvePending=null;
    if(d.error){solveError(d.error);return;}
    if(cb)cb(d.res);};
  w.onerror=()=>{_workerBroken=true;try{w.terminate();}catch(e){}_solveWorker=null;
    if(_solvePending){const cb=_solvePending;_solveSync(cb,_solveReq);}};
  return w;
}
function solveAsync(cb){
  const reqId=++_solveReq;_solvePending=cb;
  showSolveSpinner();
  if(_workerBroken||typeof Worker==="undefined"){_solveSync(cb,reqId);return;}
  try{
    if(_solveWorker)_solveWorker.terminate();   // cancel any in-flight solve
    _solveWorker=_spawnSolveWorker();
    _solveWorker.postMessage({reqId,state:JSON.parse(JSON.stringify(S)),budget:Math.max(200,Math.min(60000,num(S.solveBudget)||2000))});
  }catch(e){_workerBroken=true;_solveSync(cb,reqId);}
}
// Synchronous fallback. The 0ms defer lets the spinner paint before the (briefly blocking) solve.
function _solveSync(cb,reqId){
  setTimeout(()=>{
    if(reqId!==_solveReq)return;               // superseded while waiting
    let res=null;try{res=optimize();}catch(e){solveError((e&&e.stack)||String(e));return;}
    hideSolveSpinner();_solvePending=null;if(cb)cb(res);
  },0);
}
function solveError(msg){
  hideSolveSpinner();
  const el=document.getElementById("results"),stat=document.getElementById("solveStat");
  if(el)el.innerHTML=`<div class="notice warn"><b>Solver error.</b> ${String(msg).split("\n")[0]}</div>`;
  if(stat)stat.textContent="";
}
function showSolveSpinner(){const o=document.getElementById("solveOverlay");if(o)o.hidden=false;}
function hideSolveSpinner(){const o=document.getElementById("solveOverlay");if(o)o.hidden=true;}
// One-line summary of the Gel the planner reserved (compression auto-picked per line), and how
// much of the vespium income it spends — shown under the plan in every mode.
function gelReservedNote(gr){
  if(!gr||!gr.lines)return "";
  const inc=Math.max(0,num(S.gelVesp)||0)*60;
  const vesp=gr.vespHr!=null?` — burning <b>${disp(gr.vespHr)}</b>${inc>0?" of your <b>"+disp(inc)+"</b>":""} vespium/hr`:"";
  return `<div class="notice info" style="font-size:11.5px"><b>${gr.lines}</b> line${gr.lines>1?"s":""} on Gel (compression auto-picked) → <b>${disp(gr.outHr)}</b> Gel/hr${vesp}, fed into the plan.</div>`;
}
// Explains any lines the plan left idle. A line goes idle when throughput is capped by a
// bottleneck elsewhere — a material input, or (in project mode) the Gel/vespium budget — so the
// spare capacity can't make anything that finishes the plan sooner. It's still free to bank a
// surplus on Bits or Concrete, whose only real input is abundant "Worthless Rocks". Works on both
// plan shapes: project rows carry `entries`, items/credits rows carry a single `job`.
function idleLinesNote(plan){
  const idle=(plan||[]).filter(p=>p.entries?!p.entries.length:(p.job&&p.job.kind==="idle"));
  if(!idle.length)return "";
  const s=idle.length>1, which=idle.map(p=>"#"+p.line).join(", ");
  return `<div class="notice info" style="font-size:11.5px"><b>${s?"Lines "+which+" are":"Line "+which+" is"} idle.</b> The plan is capped by a bottleneck elsewhere — a material input, or your Gel/vespium budget — so spare capacity here wouldn't finish anything sooner. If you like, run ${s?"them":"it"} on <b>Bits</b> or <b>Concrete</b> to bank a surplus: those cost only abundant <b>Worthless Rocks</b>, so it's effectively free.</div>`;
}
function lineAssignTableHtml(plan){
  let h=`<table><thead><tr><th>Line</th><th>Cap</th><th>Job</th><th>Lvl</th>
      <th class="num">Time share</th><th class="num">Output /hr</th><th>Consumes /hr</th></tr></thead><tbody>`;
  plan.forEach(p=>{
    if(!p.entries||!p.entries.length){h+=`<tr><td class="mono">#${p.line}</td><td class="mono">${p.max}×</td><td><span class="pill idle">idle</span></td><td></td><td class="num"></td><td class="num"></td><td></td></tr>`;return;}
    p.entries.forEach((e,ei)=>{
      const isGel=e.item===GEL, reserved=p.reserved||isGel, isRaw=RAWS.includes(e.item);
      const pill=reserved?'<span class="pill" style="background:rgba(63,182,160,.14);color:var(--teal);border:1px solid var(--teal-d)">gel</span>':isRaw?'<span class="pill prod">produce</span>':'<span class="pill craft">craft</span>';
      // Gel is forged from mined ore against the vespium budget (shown in the Gel note), not from a craftable input.
      const cons=reserved?'<span style="color:var(--ink3)">mined ore (free)</span>':(e.cons.length?e.cons.map(c=>disp(c.hr)+" "+c.item).join(", "):'<span style="color:var(--ink3)">—</span>');
      h+=`<tr${reserved?' style="background:rgba(63,182,160,.05)"':''}>
        <td class="mono">${ei===0?"#"+p.line:""}</td><td class="mono">${ei===0?p.max+"×":""}</td>
        <td>${pill} ${e.item}</td><td class="mono">${e.lvl}×</td>
        <td class="num mono" style="color:var(--ink2)">${fmt(e.frac*100,0)}%</td>
        <td class="num">${disp(e.outHr)}</td>
        <td style="color:var(--ink2);font-size:11.5px">${cons}</td></tr>`;
    });
  });
  return h+`</tbody></table>`;
}
// Lil' Forgie's passive supply of the items these projects actually use (issue #77). Works in
// every project sub-mode (sequenced/waved have no balance table), so his contribution is always
// visible: it's already credited into the plan below, so it's crafting the player doesn't do.
function projectForgieNote(res){
  if(!S.forgie)return "";
  const demanded=new Set();
  (res.perProject||[]).forEach(p=>ALLITEMS.forEach(it=>{if((p.sub&&p.sub[it]||0)>0)demanded.add(it);}));
  (res.demandItems||[]).forEach(it=>demanded.add(it));
  (res.phases||[]).forEach(ph=>{const s=ph.demandSub||{};ALLITEMS.forEach(it=>{if((s[it]||0)>0)demanded.add(it);});});
  // Expand product demand to its full input chain so Forgie's raws (e.g. Ingots feeding Plates→Frames) count.
  const relevant=new Set(demanded);
  const prods=[...demanded].filter(it=>PRODUCTS.includes(it));
  if(prods.length&&typeof relevantChain==="function"){
    const rc=relevantChain(prods);
    rc.prods.forEach(it=>relevant.add(it));rc.raws.forEach(it=>relevant.add(it));
  }
  if(demanded.has("Frames")||demanded.has("Wire"))relevant.add("Bits");   // pre-produced Bits
  const made=ALLITEMS.filter(it=>relevant.has(it)&&(num(S.forgie[it])||0)>1e-9);
  if(!made.length)return "";
  const parts=made.map(it=>`<b>${disp(num(S.forgie[it])||0)}</b>/hr ${it}`).join(", ");
  return `<div class="notice info" style="font-size:11.5px"><b>Lil' Forgie</b> is passively supplying ${parts} — already credited toward these projects, so it's crafting you don't have to do.</div>`;
}
function renderProjectResults(res,el,stat){
  _lastProjectRes=res;
  if(res.empty){
    el.innerHTML=`<div class="notice info">No project demand yet. Open <b>Shopping list</b>, add a project with item costs, tick it <b>on</b>, then come back. Enter your current <b>inventory</b> there too — it's subtracted from what you need to craft.</div>`;
    stat.textContent="";return;
  }
  let html="";
  html+=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
    <div class="proj-mini" style="font-size:11.5px">${res.sequenced?'Order: <b style="color:var(--ink2)">one project at a time</b> — unlocks first, then your order, then cheapest. Change in Shopping list.':res.waved?'Order: <b style="color:var(--ink2)">all together, in unlock waves</b> — material unlocks first, then the rest. Change in Shopping list.':res.single?'Order: <b style="color:var(--ink2)">all projects in one phase</b> — unlock ordering off. Change in Shopping list.':'Order: <b style="color:var(--ink2)">all projects together</b> (fastest total). Change in Shopping list.'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" id="btnProgress">Track progress</button>
      <button class="btn primary" id="btnSteps">Step-by-step ▸</button>
    </div></div>`;
  html+=`<div class="notice info"><b>Project plan.</b> ${res.sequenced?"Completes projects one at a time so you unlock bonuses sooner; within each project, lines split their time in a pipelined plan.":"Sums all ticked projects and crafts everything together with a pipelined line setup, inputs &amp; outputs flowing together."} Overshoot from compression is ignored.</div>`;
  html+=projectForgieNote(res);
  if(res.waved)html+=`<div class="notice info" style="font-size:11.5px"><b>Unlock-aware order.</b> Some projects unlock materials others need (Frames, Gel, Wire), so this is split into <b>${res.phases.length} waves</b> — finish each wave before starting the next. Everything within a wave is crafted together.</div>`;
  if(res.unsat&&res.unsat.length){
    const gelInc=Math.max(0,num(S.gelVesp)||0)>0;
    html+=`<div class="notice warn"><b>Needs Gel:</b> ${res.unsat.join(", ")} require Gel, which the planner forges from your <b>vespium income</b>. ${gelInc?"Your current income is too low to forge any — raise <b>vespium / minute income</b> in the Gel panel":"Enter your <b>vespium / minute income</b> in the Gel panel"} to include them — they're excluded from the time below for now.</div>`;
  }
  if(res.infeasItems&&res.infeasItems.length)html+=`<div class="notice warn"><b>Can't sustainably produce:</b> ${res.infeasItems.join(", ")}. Raise a line's max compression, add a line, or check recipe costs — the time below excludes these.</div>`;
  html+=`<div class="metrics">
    <div class="metric"><div class="l">Total time</div><div class="v">${fmtDuration(res.eta)}</div><div class="u">${res.sequenced?"to finish every project":"to finish all ticked projects"}</div></div>
    <div class="metric"><div class="l">Projects</div><div class="v">${res.perProject.length}</div><div class="u">${res.sequenced?"one at a time":res.waved?res.phases.length+" unlock waves":res.single?"all in one phase":"scheduled together"}</div></div>
    ${!res.sequenced&&!res.waved&&res.bottleneck?`<div class="metric"><div class="l">Bottleneck</div><div class="v" style="font-size:17px">${res.bottleneck}</div><div class="u">sets the finish time</div></div>`:""}
  </div>`;
  if(res.sequenced||res.waved){
    html+=`<div class="subhead">${res.waved?"Build order — waves, each crafted together":"Completion order — done one project at a time"}</div>
      <table><thead><tr><th>#</th><th>${res.waved?"Wave":"Project"}</th><th>Needs</th><th class="num">Phase</th><th class="num">Done by</th></tr></thead><tbody>`;
    res.phases.forEach((ph,i)=>{
      const sub=ph.demandSub||{};
      const items=ALLITEMS.filter(it=>(sub[it]||0)>0);
      const needs=items.slice(0,5).map(it=>disp(sub[it])+" "+it).join(", ")+(items.length>5?" …":"");
      const badge=(ph.prio!=null)?` <span class="pill craft" style="font-size:9px">#${ph.prio}</span>`:"";
      const warn=!ph.feasible?' <span style="color:var(--danger);font-size:10.5px">(blocked — see notes)</span>':"";
      const nm=escapeAttr(ph.members&&ph.members.length>1?ph.members.join(" + "):ph.name);
      html+=`<tr><td class="mono">${i+1}</td><td>${nm}${badge}${warn}</td>
        <td style="color:var(--ink2);font-size:11.5px">${needs||"—"}</td>
        <td class="num mono">${fmtDuration(ph.eta)}</td><td class="num mono" style="color:var(--amber)">${fmtDuration(ph.doneAt)}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="notice info" style="font-size:11.5px">Tap <b>Step-by-step</b> for the exact line setup in each ${res.waved?"wave":"phase"} and when to switch lines over.</div>`;
  } else {
    html+=`<div class="subhead">Combined demand</div>
      <table><thead><tr><th>Item</th><th class="num">Have</th><th class="num">Net needed</th><th class="num">Made /hr</th><th class="num">Done in</th></tr></thead><tbody>`;
    res.demandItems.forEach(it=>{
      const inv=num(S.inventory&&S.inventory[it])||0;
      const isUnsat=res.unsat&&res.unsat.indexOf(it)>=0;
      const r=res.rate[it]||0,done=r>1e-12?res.net[it]/r:Infinity;
      const rateCell=isUnsat?'<span style="color:var(--ink3)">needs Gel</span>':(r>1e-9?disp(r):'<span style="color:var(--danger)">0</span>');
      const doneCell=isUnsat?'<span style="color:var(--ink3)">needs Gel</span>':(isFinite(done)?fmtDuration(done):"—");
      html+=`<tr><td>${it}</td><td class="num mono" style="color:var(--ink2)">${inv>0?disp(inv):"—"}</td>
        <td class="num">${disp(res.net[it])}</td><td class="num">${rateCell}</td>
        <td class="num mono" style="color:${isUnsat||!isFinite(done)?'var(--ink3)':'var(--ink2)'}">${doneCell}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="subhead">Projects (≈ done in = when its items finish in the shared pipeline)</div>
      <table><thead><tr><th>Project</th><th>Levels</th><th>Needs</th><th class="num">≈ Done in</th></tr></thead><tbody>`;
    res.perProject.forEach(p=>{
      const items=ALLITEMS.filter(it=>(p.sub[it]||0)>0);
      let pdone=0;items.forEach(it=>{const r=res.rate[it]||0;if(r>1e-12){const d=(res.net[it]||0)/r;if(d>pdone)pdone=d;}});
      const needs=items.slice(0,6).map(it=>disp(p.sub[it])+" "+it).join(", ")+(items.length>6?" …":"");
      html+=`<tr><td>${p.name||"Project"}</td><td class="mono" style="color:var(--ink2)">${p.from}–${p.to} / ${p.levels}</td>
        <td style="color:var(--ink2);font-size:11.5px">${needs||"—"}</td>
        <td class="num mono">${items.length?fmtDuration(pdone):"—"}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="subhead">Line assignment — % is the share of this line's time on that job</div>${lineAssignTableHtml(res.plan)}`;
    html+=idleLinesNote(res.plan);
    if(res.balance&&res.balance.length){
      // Break out Lil' Forgie's passive supply into its own column (issue #77), mirroring the
      // items/credits balance table — shown only when he's contributing something here.
      const showForgie=res.balance.some(b=>(b.forgie||0)>1e-6);
      html+=`<div class="subhead">Resource balance (per hour)</div>
        <table><thead><tr><th>Resource</th><th class="num">Lines</th>${showForgie?'<th class="num">Passive</th>':''}<th class="num">Consumed</th><th class="num">Surplus</th></tr></thead><tbody>`;
      res.balance.forEach(b=>{const f=b.forgie||0,surplus=b.prod+f-b.cons,stock=b.stock||0;
        const fCell=showForgie?`<td class="num" style="color:${f>1e-6?'var(--teal)':'var(--ink3)'}">${f>1e-6?disp(f):"—"}</td>`:"";
        // A shortfall in project mode is inventory being drawn down (issue #73), not a paper margin.
        const surCell=stock>1e-6
          ?`<span style="color:var(--teal)">${disp(stock)}/hr from stock</span>`
          :`<span class="${surplus<-1e-6?'bal-tight':''}">${disp(surplus)}</span>`;
        html+=`<tr><td>${b.res}</td><td class="num">${disp(b.prod)}</td>${fCell}<td class="num">${disp(b.cons)}</td>
          <td class="num">${surCell}</td></tr>`;});
      html+=`</tbody></table>`;
    }
  }
  html+=gelReservedNote(res.gelReserved);
  el.innerHTML=html;
  stat.textContent="solved in "+(res.ms||0).toFixed(1)+" ms";
}


function renderResults(){
  if(typeof clearStaleUI==="function")clearStaleUI();   // results are about to reflect current inputs
  const el=document.getElementById("results");
  const stat=document.getElementById("solveStat");
  if(S.mode==="manual"){renderManual(el,stat);return;}
  // Off the main thread: a long solve (the user's max-solve-time budget) shows a spinner instead
  // of freezing. solveAsync ignores superseded solves, so only the latest request paints.
  solveAsync(res=>{if(res)renderSolveResult(res,el,stat);});
}
function renderSolveResult(res,el,stat){
  if(res.mode==="project"){renderProjectResults(res,el,stat);return;}
  // nudge toward Sell prices when credits mode is selected but no prices exist yet
  if(typeof setPricePoke==="function")setPricePoke(res.mode==="credits"&&![...RAWS,...PRODUCTS].some(it=>(num(S.sellPrice[it])||0)>0));
  if(res.empty){el.innerHTML=`<div class="notice info">Select one or more outputs on the left to optimize — or switch to <b>Max credits/hr</b> mode to auto-search the most profitable mix.</div>`;stat.textContent="";return;}
  let html="";
  if(res.mode==="credits"){
    html+=`<div class="notice info"><b>Credits mode.</b> Ignores the output checkboxes &amp; priorities. For each item with a <b>Sell price</b>, it works out the most your lines can produce per hour if the whole factory is dedicated to it, then picks the single highest-earning item.</div>`;
  }
  if(res.issues.length){
    html+=`<div class="notice warn"><b>Missing data:</b><br>${res.issues.join("<br>")}</div>`;
  }
  const anyOut=res.mode==="credits"?res.credits>1e-6:Object.values(res.out).some(v=>v>1e-6);
  if(!anyOut&&!res.issues.length){
    html+=`<div class="notice warn">No sustainable plan found with the current lines and data. Try raising a line's max compression, adding a line, entering duplication %, or check your input costs${res.mode==="credits"?" and sell prices":""}.</div>`;
  }
  if(res.capped){
    html+=`<div class="notice info" style="font-size:11.5px">Large search space — this is the best plan found within the time budget. It's almost certainly optimal (the heuristic and exact search agree in testing), just not exhaustively proven.</div>`;
  }
  if(res.usesMargin){
    html+=`<div class="notice info"><b>May-work plan.</b> This uses your ${fmt(res.tol*100,1)}% margin — one or more inputs runs a small paper shortfall (see balance below). Likely fine if it's inside your game's rounding/duplication slack, but not strictly guaranteed.</div>`;
  }
  // metric cards
  html+=`<div class="metrics">`;
  if(res.mode==="credits"){
    html+=`<div class="metric"><div class="l">Best — sell ${res.bestItem||"—"}</div>
      <div class="v">${disp(res.credits||0)}</div><div class="u">credits per hour</div></div>`;
  }else{
    res.targets.forEach(t=>{
      html+=`<div class="metric"><div class="l">${t}</div>
        <div class="v">${disp(res.out[t]||0)}</div><div class="u">per hour</div></div>`;
    });
  }
  html+=`</div>`;
  // credits ranking — every sellable item compared head to head
  if(res.mode==="credits"&&res.ranking&&res.ranking.length){
    html+=`<div class="subhead">If you dedicate the factory to…</div>
      <table><thead><tr><th>Item</th><th class="num">Max output /hr</th><th class="num">Sell price</th><th class="num">Credits /hr</th></tr></thead><tbody>`;
    res.ranking.forEach((c,i)=>{
      const win=i===0&&c.credits>1e-9;
      const note=c.feasible?"":'<span style="color:var(--ink3);font-size:10.5px"> — no sustainable plan</span>';
      html+=`<tr${win?' style="background:rgba(210,129,58,.10)"':''}>
        <td>${win?'★ ':''}${c.item}${note}</td>
        <td class="num">${disp(c.out)}</td>
        <td class="num mono" style="color:var(--ink2)">${c.price>0?disp(c.price):"—"}</td>
        <td class="num" style="color:${win?'var(--amber)':'var(--ink)'};font-weight:${win?'700':'400'}">${disp(c.credits)}</td></tr>`;
    });
    html+=`</tbody></table>`;
  }
  // plan table
  html+=`<div class="subhead">Line assignment</div>
    <table><thead><tr><th>Line</th><th>Cap</th><th>Job</th><th>Lvl</th>
      <th class="num">~s/craft</th><th class="num">Output /hr</th><th>Consumes /hr</th></tr></thead><tbody>`;
  res.plan.forEach(p=>{
    const j=p.job;const rawSp=p.sp||1,dp=p.dp||1;
    // effective speed is capped at the craft cycle time (1s real-time floor)
    const sp=(j.ct>0&&rawSp>j.ct)?j.ct:rawSp;
    let pill,job,lvl="",outv="",cons="",ct="";
    if(j.kind==="idle"){pill='<span class="pill idle">idle</span>';job="";}
    else if(j.kind==="produce"){pill='<span class="pill prod">produce</span>';job=j.res;lvl=j.lvl+"×";
      outv=disp(j.prod[0][1]*sp*dp*3600);ct=fmt(craftTime(j.res,j.lvl)/sp,2);}
    else{pill='<span class="pill craft">craft</span>';job=j.res;lvl=j.lvl+"×";
      outv=disp(j.prod[0][1]*sp*dp*3600);ct=fmt(craftTime(j.res,j.lvl)/sp,2);
      if(p.reserved){   // full-time Gel line: show its output + actual ore burn
        outv=disp(p.gelHr||0);
        const craftsHr=j.lvl>0?(p.gelHr||0)/(j.lvl*dp):0,oc=gelOreCost(j.lvl);
        cons=`${disp(oc.rocks*craftsHr)} rocks, ${disp(p.vespHr||0)} vespium <span style="color:var(--ink3)">(free ore)</span>`;
      }else cons=j.cons.map(c=>disp(c[1]*sp*3600)+" "+invName(res.resIndex,c[0])).join(", ");}
    const resv=p.reserved?' <span class="pill" style="background:rgba(63,182,160,.14);color:var(--teal);border:1px solid var(--teal-d)">reserved</span>':"";
    const tags=`${p.spx?` <span style="color:var(--ink3);font-size:10.5px">×${fmt(p.spx,2)} spd</span>`:""}${p.dup>0?` <span style="color:var(--ink3);font-size:10.5px">+${fmt(p.dup,2)}% dup</span>`:""}`;
    html+=`<tr${p.reserved?' style="background:rgba(63,182,160,.05)"':''}><td class="mono">#${p.line}</td><td class="mono">${p.max}×${tags}</td>
      <td>${pill} ${job}${resv}</td><td class="mono">${lvl}</td>
      <td class="num mono" style="color:var(--ink2)">${ct}</td>
      <td class="num">${outv}</td><td style="color:var(--ink2);font-size:11.5px">${cons}</td></tr>`;
  });
  html+=`</tbody></table>`;
  html+=idleLinesNote(res.plan);
  // balance table — Frames' & Wire's pre-produced Bits ride along as a display-only row (never in the solver)
  const ppBits=preprodBitsHr(res.plan);
  if(res.balance&&res.balance.length){
    const rows=res.balance.map(b=>({...b}));
    if(ppBits>1e-6){   // fold the pre-produced Bits in, or add a row if Bits isn't already in play
      const ex=rows.find(b=>b.res==="Bits");
      if(ex){ex.cons=(ex.cons||0)+ppBits;ex.preProd=true;}
      else rows.push({res:"Bits",prod:0,forgie:num(S.forgie&&S.forgie.Bits)||0,cons:ppBits,preProd:true});
    }
    const showForgie=rows.some(b=>(b.forgie||0)>1e-6);
    html+=`<div class="subhead">Resource balance (per hour)</div>
      <table><thead><tr><th>Resource</th><th class="num">Lines</th>${showForgie?'<th class="num">Passive</th>':''}<th class="num">Consumed</th>
        <th class="num">Surplus</th><th>Status</th></tr></thead><tbody>`;
    rows.forEach(b=>{
      const f=b.forgie||0, surplus=b.prod+f-b.cons;
      const ratio=b.cons>0?surplus/b.cons:1;
      let cls="bal-ok",lbl="healthy";
      if(b.preProd){cls=surplus<-1e-6?"bal-tight":"bal-ok";lbl=surplus<-1e-6?"pre-produce":"covered";}
      else if(surplus<-1e-6){cls="bal-tight";lbl="margin";}
      else if(b.cons>0&&ratio<0.05){cls="bal-tight";lbl="tight";}
      else if(b.cons===0&&b.prod===0&&f===0){cls="";lbl="—";}
      const fCell=showForgie?`<td class="num" style="color:${f>1e-6?'var(--teal)':'var(--ink3)'}">${f>1e-6?disp(f):"—"}</td>`:"";
      const linesCell=(b.preProd&&b.prod<=1e-6)?'<span style="color:var(--ink3)">pre-prod</span>':disp(b.prod);
      html+=`<tr${b.preProd?' style="background:rgba(210,129,58,.05)"':''}><td>${b.res}</td><td class="num">${linesCell}</td>${fCell}
        <td class="num">${disp(b.cons)}</td>
        <td class="num ${surplus<-1e-6?'bal-tight':''}">${disp(surplus)}</td>
        <td class="${cls}" style="font-weight:600;font-size:11.5px">${lbl}</td></tr>`;
    });
    html+=`</tbody></table>`;
  }
  // Bits-to-preproduce planner for Frames & Wire (Bits are assumed pre-produced, kept out of the line math)
  if(ppBits>1e-6){
    const fBits=num(S.forgie&&S.forgie.Bits)||0, net=ppBits-fBits;
    const bd=preprodBitsBreakdown(res.plan), who=Object.keys(bd).filter(k=>bd[k]>1e-6);
    const verb=(who.length===1&&!/s$/.test(who[0]))?"consumes":"consume";
    html+=`<div class="subhead">Bits to pre-produce (${who.join(" & ")})</div>
      <div class="notice info" style="font-size:12px">${who.join(" &amp; ")} ${verb} <b>${disp(ppBits)}</b> Bits/hr (${preprodBitsNote(who)}, not part of the line plan above).`+
      (fBits>0?` Lil' Forgie supplies <b>${disp(fBits)}</b>/hr, so `:` So `)+
      (net>1e-6?`pre-produce about <b style="color:var(--amber)">${disp(net)}</b> Bits/hr to keep up.`
              :`Forgie already covers it — a <b style="color:var(--teal)">${disp(-net)}</b>/hr surplus.`)+`</div>`;
  }
  if(res.gelReserved&&res.gelReserved.lines>0)html+=gelReservedNote(res.gelReserved);
  else if((Math.max(0,num(S.gelVesp)||0)*60)>0)
    html+=`<div class="notice info" style="font-size:11.5px">Vespium income set, but the planner makes more of your target by putting <b>0</b> lines on Gel here.</div>`;
  el.innerHTML=html;
  stat.textContent="solved in "+res.ms.toFixed(1)+" ms";
}
function invName(resIndex,idx){for(const k in resIndex)if(resIndex[k]===idx)return k;return "";}

