"use strict";
/* ---------- RENDER: results ---------- */
let _lastProjectRes=null;
let _lastItemsCreditsRes=null;   // items/credits solve result, cached so "Copy to Manual" has something to read
// The step-by-step plan is now the main Project-mode panel (was a modal). These two flags persist the
// state of its collapsible sections across the frequent #results re-renders (every solve rebuilds the
// panel's innerHTML), so an expanded "Full breakdown" doesn't slam shut when you tweak a level. Flipped
// by the delegated #results click handler in events.js.
let _projAdjustOpen=false;   // "Adjust project levels & completion" disclosure
let _breakdownOpen=false;    // "Full breakdown — demand, line assignment, resource balance" disclosure
function resultsTableName(table){
  const headings=Array.from(table.querySelectorAll("th")).map(th=>th.textContent.trim()).join(" ");
  if(/Line/.test(headings)&&/Job/.test(headings))return "Line assignment table";
  if(/Resource/.test(headings)&&/Surplus|Consumed/.test(headings))return "Resource balance table";
  if(/Credits \/hr/.test(headings))return "Credits comparison table";
  if(/Project/.test(headings)&&/Needs/.test(headings))return "Project schedule table";
  return "Planner results table";
}
function enhanceResultTables(){
  const container=document.getElementById("results");if(!container)return;
  Array.from(container.querySelectorAll("table")).forEach(table=>{
    if(table.parentElement&&table.parentElement.classList.contains("table-scroll"))return;
    const wrapper=document.createElement("div");
    table.before(wrapper);wrapper.appendChild(table);
    markTableScroller(wrapper,resultsTableName(table));
  });
}
if(typeof MutationObserver!=="undefined"){
  const resultTableObserver=new MutationObserver(enhanceResultTables);
  const observedResults=document.getElementById("results");
  if(observedResults)resultTableObserver.observe(observedResults,{childList:true,subtree:true});
}
// Plan start → a datetime-local value (or "" for live "now"). Shared with the inline anchor renderer.
function fmtDatetimeLocal(ms){
  const d=new Date(ms);if(isNaN(d.getTime()))return "";
  const pad=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
}
// The plan-start anchor, promoted out of the old modal header. Clock times in the step plan count from
// here; it's a display anchor only (durations are elapsed-hours from the solver). Edited via delegated
// #results handlers in events.js. Kept compact so the step plan stays the hero.
function projPlanAnchorHtml(){
  const v=(S.planStart!=null&&isFinite(S.planStart))?fmtDatetimeLocal(S.planStart):"";
  return `<div class="plan-anchor">
    <label for="spStart">Plan start</label>
    <input type="datetime-local" id="spStart" value="${v}">
    <button class="btn ghost" id="spNow" title="Anchor the schedule to right now">Now</button>
    <span class="proj-mini">clock times count from here</span>
  </div>`;
}

function solveError(msg){
  const el=document.getElementById("results"),stat=document.getElementById("solveStat");
  if(el){
    const notice=domElement("div","notice warn");
    notice.append(domElement("b","","Solver error."),document.createTextNode(" "+String(msg).split("\n")[0]));
    el.replaceChildren(notice);
  }
  if(stat)stat.textContent="Solve failed. Check the message below and try again.";
}
function resultMinedUsage(res){
  if(res&&Array.isArray(res.minedUsage))return res.minedUsage;
  // Adapter for cached/legacy results that predate the generic minedUsage shape.
  const gr=res&&res.gelReserved;
  return gr&&gr.lines?[{item:GEL,resource:VESP,lines:gr.lines,outHr:gr.outHr,inputHr:gr.vespHr}]:[];
}
// Summary of every mined craft in a plan and the exact independent income it consumes.
function minedUsageNote(usages){
  if(!Array.isArray(usages)||!usages.length)return "";
  const rows=usages.map(use=>{const inc=minedBudgetHr(use.resource),lines=use.lines||0,budgeted=isMinedResource(use.resource);
    return `<b>${lines}</b> line${lines===1?"":"s"} on <b>${use.item}</b> → <b>${disp(use.outHr||0)}</b>/hr, consuming <b>${disp(use.inputHr||0)}</b>${budgeted&&inc>0?" of your <b>"+disp(inc)+"</b>":""} ${use.resource}/hr${budgeted?"":" (informational)"}`;
  });
  return `<div class="notice info" style="font-size:11.5px">${rows.join("<br>")}</div>`;
}
function informationalMinedParts(item,lvl,craftsHr){
  const cfg=MINED_CRAFTS[item];if(!cfg)return [];
  const costs=minedCost(item,lvl);
  return Object.keys(cfg.informationalCosts||{}).map(resource=>disp((costs[resource]||0)*craftsHr)+" "+resource+" (informational)");
}
// Explains any lines the plan left idle. A line goes idle when throughput is capped by a
// bottleneck elsewhere — an ordinary input or a craft's mined-income budget — so the
// spare capacity can't make anything that finishes the plan sooner. It's still free to bank a
// surplus on Bits or Concrete, whose only real input is abundant "Worthless Rocks". Works on both
// plan shapes: project rows carry `entries`, items/credits rows carry a single `job`.
function idleLinesNote(plan,minedUsage){
  const idle=(plan||[]).filter(p=>p.entries?!p.entries.length:(p.job&&p.job.kind==="idle"));
  if(!idle.length)return "";
  const s=idle.length>1, which=idle.map(p=>"#"+p.line).join(", ");
  const mined=[...new Set((minedUsage||[]).filter(use=>isMinedResource(use.resource)).map(use=>use.item+" / "+use.resource))];
  const bottleneck=mined.length?`a material input or the <b>${mined.join("; ")}</b> mined-income budget`:`a material input`;
  return `<div class="notice info" style="font-size:11.5px"><b>${s?"Lines "+which+" are":"Line "+which+" is"} idle.</b> The plan is capped by ${bottleneck}, so spare capacity here wouldn't finish anything sooner. If you like, run ${s?"them":"it"} on <b>Bits</b> or <b>Concrete</b> to bank a surplus: those cost only abundant <b>Worthless Rocks</b>, so it's effectively free.</div>`;
}
function lineAssignTableHtml(plan){
  let h=`<table><thead><tr><th>Line</th><th>Cap</th><th>Job</th><th>Lvl</th>
      <th class="num">Time share</th><th class="num">Output /hr</th><th>Consumes /hr</th></tr></thead><tbody>`;
  plan.forEach(p=>{
    if(!p.entries||!p.entries.length){h+=`<tr><td class="mono">#${p.line}</td><td class="mono">${compressionLabel(p.max)}</td><td><span class="pill idle">idle</span></td><td></td><td class="num"></td><td class="num"></td><td></td></tr>`;return;}
    p.entries.forEach((e,ei)=>{
      const mined=MINED_CRAFTS[e.item],isRaw=RAWS.includes(e.item);
      const pill=mined?'<span class="pill" style="background:rgba(63,182,160,.14);color:var(--teal);border:1px solid var(--teal-d)">mined craft</span>':isRaw?'<span class="pill prod">produce</span>':'<span class="pill craft">craft</span>';
      const ct=craftTime(e.item,e.lvl),craftsHr=ct>0?(effSpeed(p.sp,ct)/ct)*(e.frac||0)*3600:0;
      const consParts=e.cons.map(c=>disp(c.hr)+" "+c.item+(isMinedResource(c.item)?" (mined income)":""));
      consParts.push(...informationalMinedParts(e.item,e.lvl,craftsHr));
      const cons=consParts.length?consParts.join(", "):'<span style="color:var(--ink3)">—</span>';
      h+=`<tr${mined?' style="background:rgba(63,182,160,.05)"':''}>
        <td class="mono">${ei===0?"#"+p.line:""}</td><td class="mono">${ei===0?compressionLabel(p.max):""}</td>
        <td>${pill} ${e.item}</td><td class="mono">${compressionLabel(e.lvl)}</td>
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
function projectStabilityHtml(res){
  const policy=res&&res.projectStability==="reoptimize"?"reoptimize":"prefer-current";
  if(policy==="reoptimize")return `<section class="notice info project-stability-summary" aria-label="Line-job policy">
    <b>Re-optimized line jobs are active.</b> Project phases will choose fresh line jobs on each edit and remember the selected setup.
    <div style="margin-top:9px"><button type="button" class="btn ghost" data-project-stability="prefer-current">Prefer current line jobs on future edits</button></div>
  </section>`;
  const comparison=res&&res.stabilityComparison;if(!comparison)return "";
  const phaseRows=Array.isArray(comparison.phases)?comparison.phases:[];
  const names=phaseRows.map(phase=>htmlText(phase&&phase.name||"Project phase")).join(", ");
  if(!comparison.comparable){
    const state=comparison.selectedExecutable?"The retained schedule is executable.":"The retained schedule is not fully executable.";
    const alternative=comparison.alternativeExecutable?"The re-optimized schedule is executable.":"The re-optimized schedule is not fully executable.";
    return `<section class="notice warn project-stability-summary" aria-label="Line-job policy comparison">
      <b>Current line jobs retained.</b> A safe full comparison is unavailable, so no speed or throughput switch is recommended here. ${state} ${alternative}
      ${names?`<div style="margin-top:7px"><b>Affected phase${phaseRows.length===1?"":"s"}:</b> ${names}</div>`:""}
      <div style="margin-top:7px">Use the always-available <b>Line-job policy</b> selector in Shopping list only if you deliberately want to override this.</div>
    </section>`;
  }
  const fmtPct=value=>Number.isFinite(value)?Number(value).toFixed(2)+"%":"—";
  const rows=phaseRows.map(phase=>`<tr>
    <td>${htmlText(phase.name||"Project phase")}</td>
    <td class="num">${disp(phase.selectedThroughput)}</td><td class="num">${disp(phase.alternativeThroughput)}</td>
    <td class="num">${fmtPct(phase.selectedThroughputLossPct)}</td>
    <td class="num">${fmtDuration(phase.selectedEta)}</td><td class="num">${fmtDuration(phase.alternativeEta)}</td>
    <td class="num">${fmtPct(phase.selectedEtaPenaltyPct)}</td>
  </tr>`).join("");
  const allAlternativeAtLeast=phaseRows.length>0&&phaseRows.every(phase=>{
    const a=phase.alternativeThroughput,b=phase.selectedThroughput;
    const eps=throughputCompareEpsilon(a,b);
    return Number.isFinite(a)&&Number.isFinite(b)&&a>=b-eps;
  });
  const someAlternativeHigher=phaseRows.some(phase=>{
    const a=phase.alternativeThroughput,b=phase.selectedThroughput;
    const eps=throughputCompareEpsilon(a,b);
    return Number.isFinite(a)&&Number.isFinite(b)&&a>b+eps;
  });
  const action=comparison.alternativeIsShorter?"Use shorter re-optimized plan":
    allAlternativeAtLeast&&someAlternativeHigher?"Use higher-throughput line jobs anyway":"Use re-optimized line jobs anyway";
  const totalDiff=comparison.alternativeMinusSelectedTotalEta;
  const totalNote=Number.isFinite(totalDiff)&&Math.abs(totalDiff)>etaCompareEpsilon(comparison.selectedTotalEta,comparison.alternativeTotalEta)
    ?`The re-optimized complete run is <b>${fmtDuration(Math.abs(totalDiff))} ${totalDiff<0?"shorter":"longer"}</b>.`
    :"The complete-run ETAs are effectively equal.";
  const warmupDiff=comparison.alternativeMinusSelectedWarmupEta;
  const warmupNote=Number.isFinite(warmupDiff)&&Math.abs(warmupDiff)>etaCompareEpsilon(comparison.selectedWarmupEta,comparison.alternativeWarmupEta)
    ?`Re-optimized warm-ups are <b>${fmtDuration(Math.abs(warmupDiff))} ${warmupDiff<0?"shorter":"longer"}</b>.`
    :"Warm-up time is effectively unchanged.";
  const retainedReason=comparison.alternativeIsShorter
    ?"The current jobs were retained because their phase throughput stayed within the 5% stability band; the complete re-optimized run is nevertheless shorter."
    :"The current jobs were retained because they stayed within the 5% stability band and re-optimization does not shorten the complete schedule after warm-ups and ordering.";
  return `<section class="notice info project-stability-summary" aria-label="Line-job policy comparison">
    <div><b>Current line jobs retained.</b> Both complete schedules are executable and safely comparable. ${retainedReason}</div>
    <div style="margin-top:7px"><b>Selected complete ETA:</b> ${fmtDuration(comparison.selectedTotalEta)} · <b>Re-optimized complete ETA:</b> ${fmtDuration(comparison.alternativeTotalEta)}. ${totalNote}</div>
    <div style="margin-top:5px">${warmupNote} <b>Phase order:</b> ${comparison.orderChanged?"changes under re-optimization":"unchanged"}.</div>
    <div class="table-scroll" role="region" aria-label="Affected Project phase comparison" aria-describedby="tableScrollHelp" tabindex="0" style="margin-top:9px"><table>
      <thead><tr><th>Held phase</th><th class="num">Current throughput</th><th class="num">Re-optimized throughput</th><th class="num">Current loss</th><th class="num">Current ETA</th><th class="num">Re-optimized ETA</th><th class="num">Current ETA penalty</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="margin-top:9px"><button type="button" class="btn ghost" data-project-stability="reoptimize">${action}</button></div>
  </section>`;
}
function renderProjectResults(res,el,stat){
  _lastProjectRes=res;
  const scheduleExecutable=!!(res&&res.feasible&&res.lpFeasible&&res.scheduleValidation&&res.scheduleValidation.ok);
  // Seed the plan-start anchor once, the first time a real plan exists (issue #87 item 1) — moved here
  // from the old modal's open handler now that the step plan is always on screen. Display anchor only.
  if(S.planStart==null&&scheduleExecutable&&res.phases&&res.phases.length){mutateState(st=>{st.planStart=Date.now();});save();}
  if(res.empty){
    // Distinguish "everything's done" from "nothing configured" (issue #87 item 2). When active
    // projects exist but are fully checked off, keep the Track-progress opener so the user can still
    // review or reopen them — the button re-wires via the delegated #results handler.
    const hasActive=(S.projects||[]).some(p=>p.on&&(p.levels||[]).length);
    if(hasActive){
      el.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div class="proj-mini" style="font-size:11.5px">Every ticked project is complete.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" id="btnProgress">Track progress</button>
        </div></div>
        <div class="notice info"><b>All projects complete 🎉</b> Nothing left to craft. Open <b>Track progress</b> to review or reopen a level, or add a new project in the <b>Shopping list</b>.</div>`;
      stat.textContent="Plan updated. All selected projects are complete.";return;
    }
    el.innerHTML=`<div class="notice info">No project demand yet. Open <b>Shopping list</b>, add a project with item costs, tick it <b>on</b>, then come back. Enter your current <b>inventory</b> there too — it's subtracted from what you need to craft.</div>`;
    stat.textContent="Plan updated. No project demand selected.";return;
  }
  let html="";
  // Header: ordering note + Track-progress opener. The step plan below is the main event, so there's
  // no longer a "Step-by-step" button — this panel *is* it.
  html+=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
    <div class="proj-mini" style="font-size:11.5px">${scheduleExecutable?(res.sequenced?'Order: <b style="color:var(--ink2)">one project at a time</b> — unlocks first, then your order, then cheapest. Change in Shopping list.':res.waved?'Order: <b style="color:var(--ink2)">all together, in unlock waves</b> — material unlocks first, then the rest. Change in Shopping list.':res.single?'Order: <b style="color:var(--ink2)">all projects in one phase</b> — unlock ordering off. Change in Shopping list.':'Order: <b style="color:var(--ink2)">all projects together</b> in one shared schedule. Change in Shopping list.'):'Exact replay is blocked. Review the diagnostic and analytical breakdown below.'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" id="btnProgress">Track progress</button>
    </div></div>`;
  // Plan-start anchor (promoted from the old modal header)
  if(scheduleExecutable)html+=projPlanAnchorHtml();
  // Key notices — the ones that change what you actually do. The old verbose "Project plan." explainer
  // is dropped; the step-plan intro below already tells you how to run it.
  html+=projectForgieNote(res);
  html+=projectStabilityHtml(res);
  const prerequisites=(res.executionPhases||[]).filter(ph=>ph.kind==="prerequisite");
  const warmups=(res.executionPhases||[]).filter(ph=>ph.kind==="warmup");
  if(scheduleExecutable&&prerequisites.length){
    const needs=prerequisites.flatMap(ph=>Object.entries(ph.externalSupply||{}).map(([resource,amount])=>{const current=(ph.invStart&&ph.invStart[resource])||0;
      const total=(ph.prerequisiteDemand&&ph.prerequisiteDemand[resource])||current+amount;
      return `Pre-produce <b>${disp(amount)} more ${htmlText(resource)}</b> (<b>${disp(total)} total</b>; <b>${disp(current)} currently on hand</b>)`;})).join(" and ");
    html+=`<div class="notice info"><b>External pre-produced prerequisite:</b> ${needs} before the timed work begins. This is an explicit zero-time execution step and cannot be supplied by the same phase.</div>`;
  }
  if(scheduleExecutable&&warmups.length){const warmEta=warmups.reduce((sum,ph)=>sum+(ph.eta||0),0);
    html+=`<div class="notice info"><b>Startup warm-up included:</b> ${fmtDuration(warmEta)} builds the ordinary input stock needed to avoid a material shortage beyond replay tolerance. The total and finish clocks include this time.</div>`;}
  if(res.scheduleValidation&&!res.scheduleValidation.ok){
    const f=res.scheduleValidation.firstFailure||{},when=isFinite(f.time)?` at ${fmtDuration(f.time)}`:"";
    const detail=f.kind==="mined-rate"
      ?`${htmlText(f.resource||"Mined resource")} exceeds its instantaneous income by <b>${disp(f.excess||0)}/hr</b>${when}.`
      :`${htmlText(f.resource||"A required resource")} is short by <b>${disp(f.deficit||0)}</b>${when}.`;
    html+=`<div class="notice warn"><b>Executable schedule blocked:</b> ${detail} ${htmlText(f.message||"")}</div>`;
  }
  if(scheduleExecutable&&res.waved)html+=`<div class="notice info" style="font-size:11.5px"><b>Unlock-aware order.</b> Some projects unlock materials others need (Frames, Gel, Wire), so this is split into <b>${res.phases.length} waves</b> — finish each wave before starting the next. Everything within a wave is crafted together.</div>`;
  if(res.blockedMined&&Object.keys(res.blockedMined).length){
    const blocked=Object.entries(res.blockedMined).map(([item,resources])=>`<b>${item}</b> needs ${resources.map(r=>`<b>${r}</b>`).join(" and ")}`).join("; ");
    html+=`<div class="notice warn"><b>Missing mined income:</b> ${blocked}. Enter those incomes in <b>Mined resources</b> to include the blocked items; they remain excluded from the plan time below.</div>`;
  }
  if(res.infeasItems&&res.infeasItems.length)html+=`<div class="notice warn"><b>Can't sustainably produce:</b> ${res.infeasItems.join(", ")}. Raise a line's max compression, add a line, or check recipe costs — the time below excludes these.</div>`;
  if(res.atRiskItems&&res.atRiskItems.length)html+=`<div class="notice warn"><b>Relies entirely on stock:</b> ${res.atRiskItems.join(", ")}. No line is crafting ${res.atRiskItems.length>1?"these":"this"} — the plan is spending down your current inventory to cover them. Once it runs out you'll need dedicated crafters.</div>`;
  if(res.partial)html+=`<div class="notice warn"><b>Partial plan only.</b> The blocked items remain excluded, so the ticked projects are <b>not fully finishable</b> with the current mined incomes. The time shown is for currently plannable work only.</div>`;
  // Summary metrics
  html+=`<div class="metrics">
    <div class="metric"><div class="l">${res.partial?"Partial plan time":scheduleExecutable?"Executable total time":"Analytical LP time"}</div><div class="v">${fmtDuration(scheduleExecutable?res.eta:res.workEta)}</div><div class="u">${res.partial?"currently plannable work only":scheduleExecutable?(res.sequenced?"includes warm-ups; finishes every project":"includes warm-ups and prerequisites"):"not executable — see blocking diagnostic"}</div></div>
    <div class="metric"><div class="l">Projects</div><div class="v">${res.perProject.length}</div><div class="u">${scheduleExecutable?(res.sequenced?"one at a time":res.waved?res.phases.length+" unlock waves":res.single?"all in one phase":"scheduled together"):res.phases.length+" analytical phase"+(res.phases.length===1?"":"s")}</div></div>
    ${!res.sequenced&&!res.waved&&res.bottleneck?`<div class="metric"><div class="l">Bottleneck</div><div class="v" style="font-size:17px">${res.bottleneck}</div><div class="u">${scheduleExecutable?`sets the ${res.partial?"partial plan":"finish"} time`:"analytical LP bottleneck only"}</div></div>`:""}
  </div>`;
  // Quick project controls (on/off, level range, mark done) — collapsed so the plan stays the hero.
  // Same fields as Shopping list / Track progress, kept in sync; wired via delegated #results handlers.
  const adj=stepsProjControls();
  if(adj)html+=`<details class="cat-panel" ${_projAdjustOpen?"open":""}><summary data-paneltoggle="adjust"><span class="cat-sum-lbl">Adjust project levels &amp; completion</span><span class="cat-sum-meta">on/off · levels · mark done</span></summary><div class="panel-pad">${adj}</div></details>`;
  // ── The step-by-step plan: the main event ──
  html+=`<div class="step-main">${stepPlanHtml(res)}</div>`;
  // Everything analytical folds into one collapsed breakdown so it's a click away, not in the way.
  let bd="";
  if(res.sequenced||res.waved){
    bd+=`<div class="subhead" style="margin-top:0">${scheduleExecutable?(res.waved?"Build order — waves, each crafted together":"Completion order — done one project at a time"):"Analytical phase breakdown"}</div>
      <table><thead><tr><th>#</th><th>${scheduleExecutable?(res.waved?"Wave":"Project"):"Phase"}</th><th>Needs</th><th class="num">${res.partial?"Plan time":"Phase"}</th><th class="num">${scheduleExecutable?(res.partial?"Plannable by":"Done by"):"LP endpoint"}</th></tr></thead><tbody>`;
    res.phases.forEach((ph,i)=>{
      const sub=ph.demandSub||{};
      const items=ALLITEMS.filter(it=>(sub[it]||0)>0);
      const needs=items.slice(0,5).map(it=>disp(sub[it])+" "+it).join(", ")+(items.length>5?" …":"");
      const badge=(ph.prio!=null)?` <span class="pill craft" style="font-size:9px">#${ph.prio}</span>`:"";
      const warn=!ph.feasible?' <span style="color:var(--danger);font-size:10.5px">(blocked — see notes)</span>':"";
      const nm=htmlText(ph.members&&ph.members.length>1?ph.members.join(" + "):ph.name);
      bd+=`<tr><td class="mono">${i+1}</td><td>${nm}${badge}${warn}</td>
        <td style="color:var(--ink2);font-size:11.5px">${needs||"—"}</td>
        <td class="num mono">${ph.eta>0?fmtDuration(ph.eta):"—"}</td><td class="num mono" style="color:${ph.feasible?'var(--amber)':'var(--danger)'}">${ph.feasible?fmtDuration(ph.doneAt):ph.partial?fmtDuration(ph.doneAt)+" partial":"blocked"}</td></tr>`;
    });
    bd+=`</tbody></table>`;
  } else {
    bd+=`<div class="subhead" style="margin-top:0">Combined demand</div>
      <table><thead><tr><th>Item</th><th class="num">Have</th><th class="num">Net needed</th><th class="num">Made /hr</th><th class="num">Done in</th></tr></thead><tbody>`;
    res.demandItems.forEach(it=>{
      const inv=num(S.inventory&&S.inventory[it])||0;
      const blockers=res.blockedMined&&res.blockedMined[it],isUnsat=!!(blockers&&blockers.length);
      const r=res.rate[it]||0,done=r>1e-12?res.net[it]/r:Infinity;
      const blockedText=blockers?"needs "+blockers.join(" + "):"";
      const rateCell=isUnsat?`<span style="color:var(--ink3)">${blockedText}</span>`:(r>1e-9?disp(r):'<span style="color:var(--danger)">0</span>');
      const doneCell=isUnsat?`<span style="color:var(--ink3)">${blockedText}</span>`:(isFinite(done)?fmtDuration(done):"—");
      bd+=`<tr><td>${it}</td><td class="num mono" style="color:var(--ink2)">${inv>0?disp(inv):"—"}</td>
        <td class="num">${disp(res.net[it])}</td><td class="num">${rateCell}</td>
        <td class="num mono" style="color:${isUnsat||!isFinite(done)?'var(--ink3)':'var(--ink2)'}">${doneCell}</td></tr>`;
    });
    bd+=`</tbody></table>`;
    bd+=`<div class="subhead">Projects (≈ done in = when its items finish in the shared pipeline)</div>
      <table><thead><tr><th>Project</th><th>Levels</th><th>Needs</th><th class="num">≈ Done in</th></tr></thead><tbody>`;
    res.perProject.forEach(p=>{
      const items=ALLITEMS.filter(it=>(p.sub[it]||0)>0);
      let pdone=0;items.forEach(it=>{const r=res.rate[it]||0;if(r>1e-12){const d=(res.net[it]||0)/r;if(d>pdone)pdone=d;}});
      const blocked=items.some(it=>res.blockedMined&&res.blockedMined[it]);
      const needs=items.slice(0,6).map(it=>disp(p.sub[it])+" "+it).join(", ")+(items.length>6?" …":"");
      bd+=`<tr><td>${htmlText(p.name||"Project")}</td><td class="mono" style="color:var(--ink2)">${p.from}–${p.to} / ${p.levels}</td>
        <td style="color:var(--ink2);font-size:11.5px">${needs||"—"}</td>
        <td class="num mono">${blocked?'<span style="color:var(--danger)">not fully finishable</span>':items.length?fmtDuration(pdone):"—"}</td></tr>`;
    });
    bd+=`</tbody></table>`;
    bd+=`<div class="subhead">Line assignment — % is the share of this line's time on that job</div>${lineAssignTableHtml(res.plan)}`;
    bd+=idleLinesNote(res.plan,resultMinedUsage(res));
    if(res.balance&&res.balance.length){
      // Break out Lil' Forgie's passive supply into its own column (issue #77), mirroring the
      // items/credits balance table — shown only when he's contributing something here.
      const showForgie=res.balance.some(b=>(b.forgie||0)>1e-6);
      bd+=`<div class="subhead">Resource balance (per hour)</div>
        <table><thead><tr><th>Resource</th><th class="num">Lines</th>${showForgie?'<th class="num">Passive</th>':''}<th class="num">Consumed</th><th class="num">Surplus</th></tr></thead><tbody>`;
      res.balance.forEach(b=>{const f=b.forgie||0,surplus=b.prod+f-b.cons,stock=b.stock||0;
        const fCell=showForgie?`<td class="num" style="color:${f>1e-6?'var(--teal)':'var(--ink3)'}">${f>1e-6?disp(f):"—"}</td>`:"";
        // A shortfall in project mode is inventory being drawn down (issue #73), not a paper margin —
        // unless no line is crafting it at all, which means the plan depends on exhausting stock
        // with nothing behind it (issue #80), so that gets flagged red instead of reassuring teal.
        const atRisk=res.atRiskItems&&res.atRiskItems.indexOf(b.res)>=0;
        const surCell=stock>1e-6
          ?`<span style="color:${atRisk?'var(--danger)':'var(--teal)'}">${disp(stock)}/hr from stock${atRisk?" (no crafters!)":""}</span>`
          :`<span class="${surplus<-1e-6?'bal-tight':''}">${disp(surplus)}</span>`;
        bd+=`<tr><td>${b.res}</td><td class="num">${disp(b.prod)}</td>${fCell}<td class="num">${disp(b.cons)}</td>
          <td class="num">${surCell}</td></tr>`;});
      bd+=`</tbody></table>`;
    }
  }
  const minedNote=minedUsageNote(resultMinedUsage(res));
  if(minedNote)bd+=minedNote;
  html+=`<details class="cat-panel breakdown-panel" ${_breakdownOpen?"open":""}><summary data-paneltoggle="breakdown"><span class="cat-sum-lbl">${res.scheduleValidation&&res.scheduleValidation.ok?"Full breakdown":"Analytical LP breakdown"} — demand, line assignment, resource balance</span><span class="cat-sum-meta">the numbers</span></summary><div class="panel-pad">${bd}</div></details>`;
  el.innerHTML=html;
  stat.textContent=scheduleExecutable
    ?"Plan updated. Executable schedule solved in "+(res.ms||0).toFixed(1)+" ms"
    :"Schedule blocked. Analytical LP retained for diagnosis.";
}


function renderResults(){
  if(typeof clearStaleUI==="function")clearStaleUI();   // results are about to reflect current inputs
  if(typeof setPricePoke==="function")setPricePoke(false); // Credits owns this nudge; clear it before every synchronous mode path.
  const el=document.getElementById("results");
  const stat=document.getElementById("solveStat");
  if(S.mode==="manual"){solveService.cancel("Manual mode renders synchronously");renderManual(el,stat);return;}
  // Off the main thread: a long solve (the user's max-solve-time budget) shows a spinner instead
  // of freezing. The service owns cancellation and only delivers the accepted mode/revision.
  const snapshot=JSON.parse(JSON.stringify(S));
  const budget=boundedPersistedField("solveBudget",snapshot.solveBudget,2000,200,60000,true);
  solveService.request({mode:snapshot.mode,stateRevision,budget,stateSnapshot:snapshot},(res,error)=>{
    if(error){solveError(error);return;}
    if(res)renderSolveResult(res,el,stat);
  });
}
function renderSolveResult(res,el,stat){
  if(res.mode==="project"){renderProjectResults(res,el,stat);return;}
  _lastItemsCreditsRes=res;
  // nudge toward Sell prices when credits mode is selected but no prices exist yet
  if(typeof setPricePoke==="function")setPricePoke(res.mode==="credits"&&![...RAWS,...PRODUCTS].some(it=>(num(S.sellPrice[it])||0)>0));
  if(res.empty){el.innerHTML=`<div class="notice info">Select one or more outputs on the left to optimize — or switch to <b>Max credits/hr</b> mode to find the best dedicated sell plan.</div>`;stat.textContent="Plan updated. No outputs selected.";return;}
  let html="";
  if(res.mode==="credits"){
    html+=`<div class="notice info"><b>Credits mode.</b> Ignores the output checkboxes &amp; priorities. It compares one dedicated whole-factory plan for each item with a <b>Sell price</b>, then shows the highest-earning plan found.</div>`;
  }
  if(res.issues.length){
    html+=`<div class="notice warn"><b>Missing data:</b><br>${res.issues.join("<br>")}</div>`;
  }
  const anyOut=res.mode==="credits"?res.credits>1e-6:Object.values(res.out).some(v=>v>1e-6);
  if(!anyOut&&!res.issues.length&&(res.mode!=="credits"||res.searchExhaustive===true)){
    html+=`<div class="notice warn">No sustainable plan found with the current lines and data. Try raising a line's max compression, adding a line, entering duplication %, or check your input costs${res.mode==="credits"?" and sell prices":""}.</div>`;
  }
  if(res.mode==="credits"&&res.allCandidatesEvaluated===false){
    const skipped=(res.ranking||[]).filter(candidate=>!candidate.evaluated).map(candidate=>candidate.item);
    html+=`<div class="notice warn" style="font-size:11.5px"><b>Comparison incomplete.</b> The time limit was reached before a baseline could be completed for <b>${skipped.join(", ")||"one or more priced items"}</b>. Any winner shown is only the best among evaluated items.</div>`;
  }else if(res.mode==="credits"&&res.searchExhaustive===false){
    html+=`<div class="notice info" style="font-size:11.5px"><b>Best found, not proven best.</b> Every priced item received a bounded baseline, but deeper search reached its limit for at least one candidate.</div>`;
  }else if(res.mode!=="credits"&&res.capped){
    html+=`<div class="notice info" style="font-size:11.5px">Large search space — this is the best plan found within the time budget, but the search did not finish an exhaustive proof.</div>`;
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
      <table><thead><tr><th>Item</th><th class="num">Output /hr</th><th class="num">Sell price</th><th class="num">Credits /hr</th></tr></thead><tbody>`;
    res.ranking.forEach((c,i)=>{
      const win=i===0&&c.evaluated!==false&&c.credits>1e-9;
      const note=c.evaluated===false?'<span style="color:var(--ink3);font-size:10.5px"> — not evaluated</span>':
        (c.feasible?(c.usesMargin?'<span style="color:var(--amber);font-size:10.5px"> — may-work</span>':""):
          `<span style="color:var(--ink3);font-size:10.5px"> — ${c.capped?"no plan found in bounded search":"no sustainable plan"}</span>`);
      const outCell=c.evaluated===false?"—":disp(c.out),creditsCell=c.evaluated===false?"—":disp(c.credits);
      html+=`<tr${win?' style="background:rgba(210,129,58,.10)"':''}>
        <td>${win?'★ ':''}${c.item}${note}</td>
        <td class="num">${outCell}</td>
        <td class="num mono" style="color:var(--ink2)">${c.price>0?disp(c.price):"—"}</td>
        <td class="num" style="color:${win?'var(--amber)':'var(--ink)'};font-weight:${win?'700':'400'}">${creditsCell}</td></tr>`;
    });
    html+=`</tbody></table>`;
  }
  // plan table
  const sourcePlan=Array.isArray(res.plan)?res.plan:[],physicalLines=Array.isArray(S.lines)?S.lines:[];
  const visiblePlan=physicalLines.map((line,index)=>{const row=sourcePlan[index];if(row&&row.job)return row;
    const sp=lineSpeed(line),dp=dupeMult();return {line:index+1,max:line.max,spx:line.spx,dup:(dp-1)*100,sp,dp,
      job:{kind:"idle",res:null,lvl:null,prod:[],cons:[]}};});
  const canCopy=visiblePlan.some(row=>row.job.kind!=="idle"&&ALLITEMS.includes(row.job.res));
  html+=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:16px 0 8px">
    <div class="subhead" style="margin:0">Line assignment</div>${canCopy?`
    <button class="btn ghost" id="btnCopyManual" title="Copy this plan into Manual mode so you can fine-tune it by hand">Copy to Manual</button>`:""}
  </div>
    <table><thead><tr><th>Line</th><th>Cap</th><th>Job</th><th>Lvl</th>
      <th class="num">~s/craft</th><th class="num">Output /hr</th><th>Consumes /hr</th></tr></thead><tbody>`;
  visiblePlan.forEach(p=>{
    const j=p.job;const rawSp=p.sp||1,dp=p.dp||1;
    // effective speed is capped at the craft cycle time (1s real-time floor)
    const sp=(j.ct>0&&rawSp>j.ct)?j.ct:rawSp;
    let pill,job,lvl="",outv="",cons="",ct="";
    if(j.kind==="idle"){pill='<span class="pill idle">idle</span>';job="";}
    else if(j.kind==="produce"){pill='<span class="pill prod">produce</span>';job=j.res;lvl=compressionLabel(j.lvl);
      outv=disp(j.prod[0][1]*sp*dp*3600);ct=fmt(craftTime(j.res,j.lvl)/sp,2);}
    else{pill='<span class="pill craft">craft</span>';job=j.res;lvl=compressionLabel(j.lvl);
      outv=disp(j.prod[0][1]*sp*dp*3600);ct=fmt(craftTime(j.res,j.lvl)/sp,2);
      const consParts=j.cons.map(c=>{const resource=invName(res.resIndex,c[0]);return disp(c[1]*sp*3600)+" "+resource+(isMinedResource(resource)?" (mined income)":"");});
      consParts.push(...informationalMinedParts(j.res,j.lvl,j.ct>0?(sp/j.ct)*3600:0));
      cons=consParts.join(", ");}
    const mined=MINED_CRAFTS[j.res],resv=mined?' <span class="pill" style="background:rgba(63,182,160,.14);color:var(--teal);border:1px solid var(--teal-d)">mined craft</span>':"";
    const tags=`${p.spx?` <span style="color:var(--ink3);font-size:10.5px">×${fmt(p.spx,2)} spd</span>`:""}${p.dup>0?` <span style="color:var(--ink3);font-size:10.5px">+${fmt(p.dup,2)}% dup</span>`:""}`;
    html+=`<tr${mined?' style="background:rgba(63,182,160,.05)"':''}><td class="mono">#${p.line}</td><td class="mono">${compressionLabel(p.max)}${tags}</td>
      <td>${pill} ${job}${resv}</td><td class="mono">${lvl}</td>
      <td class="num mono" style="color:var(--ink2)">${ct}</td>
      <td class="num">${outv}</td><td style="color:var(--ink2);font-size:11.5px">${cons}</td></tr>`;
  });
  html+=`</tbody></table>`;
  html+=idleLinesNote(visiblePlan,resultMinedUsage(res));
  // balance table — Frames' & Wire's pre-produced Bits ride along as a display-only row (never in the solver)
  const ppBits=preprodBitsHr(visiblePlan);
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
    const bd=preprodBitsBreakdown(visiblePlan), who=Object.keys(bd).filter(k=>bd[k]>1e-6);
    const verb=(who.length===1&&!/s$/.test(who[0]))?"consumes":"consume";
    html+=`<div class="subhead">Bits to pre-produce (${who.join(" & ")})</div>
      <div class="notice info" style="font-size:12px">${who.join(" &amp; ")} ${verb} <b>${disp(ppBits)}</b> Bits/hr (${preprodBitsNote(who)}, not part of the line plan above).`+
      (fBits>0?` Lil' Forgie supplies <b>${disp(fBits)}</b>/hr, so `:` So `)+
      (net>1e-6?`pre-produce about <b style="color:var(--amber)">${disp(net)}</b> Bits/hr to keep up.`
              :`Forgie already covers it — a <b style="color:var(--teal)">${disp(-net)}</b>/hr surplus.`)+`</div>`;
  }
  const minedUses=resultMinedUsage(res);
  if(minedUses.length)html+=minedUsageNote(minedUses);
  MINED_RESOURCES.forEach(resource=>{if(minedBudgetHr(resource)<=0||minedUses.some(use=>use.resource===resource))return;
    const crafts=Object.keys(MINED_CRAFTS).filter(item=>MINED_CRAFTS[item].resource===resource).join(" / ");
    html+=`<div class="notice info" style="font-size:11.5px">${resource} income is set, but this plan puts <b>0</b> lines on <b>${crafts}</b>, so it uses none of that mined income.</div>`;
  });
  el.innerHTML=html;
  stat.textContent=res.mode==="credits"&&res.allCandidatesEvaluated===false
    ?"Comparison stopped at the time limit; some priced items were not evaluated."
    :"Plan updated. Solved in "+res.ms.toFixed(1)+" ms";
}
function invName(resIndex,idx){for(const k in resIndex)if(resIndex[k]===idx)return k;return "";}
