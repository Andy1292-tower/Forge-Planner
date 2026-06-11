"use strict";
/* ---------- RENDER: results ---------- */
let _lastProjectRes=null;
function lineAssignTableHtml(plan){
  let h=`<table><thead><tr><th>Line</th><th>Cap</th><th>Job</th><th>Lvl</th>
      <th class="num">Time share</th><th class="num">Output /hr</th><th>Consumes /hr</th></tr></thead><tbody>`;
  plan.forEach(p=>{
    if(!p.entries||!p.entries.length){h+=`<tr><td class="mono">#${p.line}</td><td class="mono">${p.max}×</td><td><span class="pill idle">idle</span></td><td></td><td class="num"></td><td class="num"></td><td></td></tr>`;return;}
    p.entries.forEach((e,ei)=>{
      const reserved=p.reserved, isRaw=RAWS.includes(e.item);
      const pill=reserved?'<span class="pill" style="background:rgba(63,182,160,.14);color:var(--teal);border:1px solid var(--teal-d)">gel</span>':isRaw?'<span class="pill prod">produce</span>':'<span class="pill craft">craft</span>';
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
function renderProjectResults(res,el,stat){
  _lastProjectRes=res;
  if(res.empty){
    el.innerHTML=`<div class="notice info">No project demand yet. Open <b>Shopping list</b>, add a project with item costs, tick it <b>on</b>, then come back. Enter your current <b>inventory</b> there too — it's subtracted from what you need to craft.</div>`;
    stat.textContent="";return;
  }
  let html="";
  html+=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
    <div class="proj-mini" style="font-size:11.5px">${res.sequenced?'Order: <b style="color:var(--ink2)">one project at a time</b> — cheapest first, “do first” pinned ahead. Change in Shopping list.':'Order: <b style="color:var(--ink2)">all projects together</b> (fastest total). Change in Shopping list.'}</div>
    <button class="btn primary" id="btnSteps">Step-by-step ▸</button></div>`;
  html+=`<div class="notice info"><b>Project plan.</b> ${res.sequenced?"Completes projects one at a time so you unlock bonuses sooner; within each project, lines split their time in a pipelined plan.":"Sums all ticked projects and crafts everything together with a pipelined line setup, inputs &amp; outputs flowing together."} Overshoot from compression is ignored.</div>`;
  if(res.unsat&&res.unsat.length)html+=`<div class="notice warn"><b>Needs Gel:</b> ${res.unsat.join(", ")} require Gel, which is only made on reserved lines. Set <b>lines on gel</b> in the Gel panel to include them — they're excluded from the time below for now.</div>`;
  if(res.infeasItems&&res.infeasItems.length)html+=`<div class="notice warn"><b>Can't sustainably produce:</b> ${res.infeasItems.join(", ")}. Raise a line's max compression, add a line, or check recipe costs — the time below excludes these.</div>`;
  html+=`<div class="metrics">
    <div class="metric"><div class="l">Total time</div><div class="v">${fmtDuration(res.eta)}</div><div class="u">${res.sequenced?"to finish every project":"to finish all ticked projects"}</div></div>
    <div class="metric"><div class="l">Projects</div><div class="v">${res.perProject.length}</div><div class="u">${res.sequenced?"one at a time":"scheduled together"}</div></div>
    ${!res.sequenced&&res.bottleneck?`<div class="metric"><div class="l">Bottleneck</div><div class="v" style="font-size:17px">${res.bottleneck}</div><div class="u">sets the finish time</div></div>`:""}
  </div>`;
  if(res.sequenced){
    html+=`<div class="subhead">Completion order — done one project at a time</div>
      <table><thead><tr><th>#</th><th>Project</th><th>Needs</th><th class="num">Phase</th><th class="num">Done by</th></tr></thead><tbody>`;
    res.phases.forEach((ph,i)=>{
      const pj=res.perProject.find(p=>p.name===ph.name)||{sub:{}};
      const items=ALLITEMS.filter(it=>(pj.sub[it]||0)>0);
      const needs=items.slice(0,5).map(it=>disp(pj.sub[it])+" "+it).join(", ")+(items.length>5?" …":"");
      const badge=ph.first?' <span class="pill craft" style="font-size:9px">do first</span>':"";
      const warn=!ph.feasible?' <span style="color:var(--danger);font-size:10.5px">(blocked — see notes)</span>':"";
      html+=`<tr><td class="mono">${i+1}</td><td>${ph.name}${badge}${warn}</td>
        <td style="color:var(--ink2);font-size:11.5px">${needs||"—"}</td>
        <td class="num mono">${fmtDuration(ph.eta)}</td><td class="num mono" style="color:var(--amber)">${fmtDuration(ph.doneAt)}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="notice info" style="font-size:11.5px">Tap <b>Step-by-step</b> for the exact line setup in each phase and when to switch lines over.</div>`;
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
    if(res.balance&&res.balance.length){
      html+=`<div class="subhead">Resource balance (per hour)</div>
        <table><thead><tr><th>Resource</th><th class="num">Produced</th><th class="num">Consumed</th><th class="num">Surplus</th></tr></thead><tbody>`;
      res.balance.forEach(b=>{const f=b.forgie||0,surplus=b.prod+f-b.cons;
        html+=`<tr><td>${b.res}</td><td class="num">${disp(b.prod+f)}</td><td class="num">${disp(b.cons)}</td>
          <td class="num ${surplus<-1e-6?'bal-tight':''}">${disp(surplus)}</td></tr>`;});
      html+=`</tbody></table>`;
    }
  }
  if(res.gelReserved&&res.gelReserved.lines>0)html+=`<div class="notice info" style="font-size:11.5px"><b>${res.gelReserved.lines}</b> line${res.gelReserved.lines>1?"s":""} reserved for Gel @ up to ${res.gelReserved.comp}× (capped to each line's own max) → <b>${disp(res.gelReserved.outHr)}</b> Gel/hr, fed into the plan.</div>`;
  el.innerHTML=html;
  stat.textContent="solved in "+(res.ms||0).toFixed(1)+" ms";
}


function renderResults(){
  const el=document.getElementById("results");
  const stat=document.getElementById("solveStat");
  if(S.mode==="manual"){renderManual(el,stat);return;}
  const res=optimize();
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
      cons=p.reserved?gelOreConsumesHr(j.lvl,sp):j.cons.map(c=>disp(c[1]*sp*3600)+" "+invName(res.resIndex,c[0])).join(", ");}
    const resv=p.reserved?' <span class="pill" style="background:rgba(63,182,160,.14);color:var(--teal);border:1px solid var(--teal-d)">reserved</span>':"";
    const tags=`${p.spx?` <span style="color:var(--ink3);font-size:10.5px">×${fmt(p.spx,2)} spd</span>`:""}${p.dup>0?` <span style="color:var(--ink3);font-size:10.5px">+${fmt(p.dup,2)}% dup</span>`:""}`;
    html+=`<tr${p.reserved?' style="background:rgba(63,182,160,.05)"':''}><td class="mono">#${p.line}</td><td class="mono">${p.max}×${tags}</td>
      <td>${pill} ${job}${resv}</td><td class="mono">${lvl}</td>
      <td class="num mono" style="color:var(--ink2)">${ct}</td>
      <td class="num">${outv}</td><td style="color:var(--ink2);font-size:11.5px">${cons}</td></tr>`;
  });
  html+=`</tbody></table>`;
  // balance table
  if(res.balance&&res.balance.length){
    const showForgie=res.balance.some(b=>(b.forgie||0)>1e-6);
    html+=`<div class="subhead">Resource balance (per hour)</div>
      <table><thead><tr><th>Resource</th><th class="num">Lines</th>${showForgie?'<th class="num">Lil\' Forgie</th>':''}<th class="num">Consumed</th>
        <th class="num">Surplus</th><th>Status</th></tr></thead><tbody>`;
    res.balance.forEach(b=>{
      const f=b.forgie||0, surplus=b.prod+f-b.cons;
      const ratio=b.cons>0?surplus/b.cons:1;
      let cls="bal-ok",lbl="healthy";
      if(surplus<-1e-6){cls="bal-tight";lbl="margin";}
      else if(b.cons>0&&ratio<0.05){cls="bal-tight";lbl="tight";}
      else if(b.cons===0&&b.prod===0&&f===0){cls="";lbl="—";}
      const fCell=showForgie?`<td class="num" style="color:${f>1e-6?'var(--teal)':'var(--ink3)'}">${f>1e-6?disp(f):"—"}</td>`:"";
      html+=`<tr><td>${b.res}</td><td class="num">${disp(b.prod)}</td>${fCell}
        <td class="num">${disp(b.cons)}</td>
        <td class="num ${surplus<-1e-6?'bal-tight':''}">${disp(surplus)}</td>
        <td class="${cls}" style="font-weight:600;font-size:11.5px">${lbl}</td></tr>`;
    });
    html+=`</tbody></table>`;
  }
  // Bits-to-preproduce planner for Frames (Bits are assumed pre-produced, kept out of the line math)
  let framesBits=0;
  res.plan.forEach(p=>{const j=p.job;if(j&&j.kind==="craft"&&j.res==="Frames"){const L=j.lvl,ct=craftTime("Frames",L),sp=(p.sp>ct?ct:p.sp)||1;if(ct>0)framesBits+=(FRAME_BITS*Math.pow(3,Math.log2(L))/ct)*sp*3600;}});
  if(framesBits>1e-6){
    const fBits=num(S.forgie&&S.forgie.Bits)||0, net=framesBits-fBits;
    html+=`<div class="subhead">Bits to pre-produce (Frames)</div>
      <div class="notice info" style="font-size:12px">Frames consume <b>${disp(framesBits)}</b> Bits/hr (8 per uncompressed frame, not part of the line plan above).`+
      (fBits>0?` Lil' Forgie supplies <b>${disp(fBits)}</b>/hr, so `:` So `)+
      (net>1e-6?`pre-produce about <b style="color:var(--amber)">${disp(net)}</b> Bits/hr to keep up.`
              :`Forgie already covers it — a <b style="color:var(--teal)">${disp(-net)}</b>/hr surplus.`)+`</div>`;
  }
  if(res.gelReserved){
    const maxN=Math.min(Math.max(0,Math.floor(num(S.gelLines)||0)),S.lines.length), K=res.gelReserved.lines;
    if(maxN>0&&K>0)
      html+=`<div class="notice info" style="font-size:11.5px"><b>${K}</b> of up to ${maxN} line${maxN>1?"s":""} put on Gel @${res.gelReserved.comp}× → <b>${disp(res.gelReserved.outHr)}</b> Gel/hr (from free mined ore), fed into the plan above.</div>`;
    else if(maxN>0)
      html+=`<div class="notice info" style="font-size:11.5px">Gel available (up to ${maxN} line${maxN>1?"s":""}), but the planner makes more of your target by using <b>0</b> on Gel here.</div>`;
  }
  el.innerHTML=html;
  stat.textContent="solved in "+res.ms.toFixed(1)+" ms";
}
function invName(resIndex,idx){for(const k in resIndex)if(resIndex[k]===idx)return k;return "";}

