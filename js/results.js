"use strict";
/* ---------- RENDER: results ---------- */
let _lastProjectRes=null;
let _lastProjectKey=null;
let _lastItemsCreditsRes=null;   // items/credits solve result, cached so "Copy to Manual" has something to read
let _lastItemsSoloMax=null;      // per-item dedicated-factory ceilings from the last share-mode solve
function lastItemsCalibration(){return _lastItemsSoloMax||{};}
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
  // Re-queue on every batch, not just when a table is newly wrapped: the last mutation
  // to land is often one that changes width without adding a table, and the already-
  // wrapped early return above would otherwise leave the hints measured against stale
  // widths.
  if(typeof queueTableScrollSync==="function")queueTableScrollSync();
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

function solveErrorMessage(error){
  if(error&&typeof error==="object"&&typeof error.message==="string"&&error.message.trim())return error.message.trim();
  const lines=String(error==null?"":error).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const useful=lines.find(line=>!/^at\s+/i.test(line)&&!/(?:^|@)blob:/i.test(line))||"Unknown solver failure";
  return useful.replace(/^(?:Error|TypeError|RangeError):\s*/i,"");
}
function solveError(msg){
  const el=document.getElementById("results"),stat=document.getElementById("solveStat");
  if(el){
    const notice=domElement("div","notice warn");
    notice.append(domElement("b","","Solver error."),document.createTextNode(" "+solveErrorMessage(msg)));
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
  const rows=usages.map(use=>{const inc=supplyRate(minedBudgetHr(use.resource)),lines=use.lines||0,budgeted=isMinedResource(use.resource);
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
  const made=ALLITEMS.filter(it=>relevant.has(it)&&forgieHr(it).gt(1e-9));
  if(!made.length)return "";
  const parts=made.map(it=>`<b>${disp(forgieHr(it))}</b>/hr ${it}`).join(", ");
  return `<div class="notice info" style="font-size:11.5px"><b>Lil' Forgie</b> is passively supplying ${parts} — already credited toward these projects, so it's crafting you don't have to do.</div>`;
}
function projOrderMode(res){
  const seq=res.orderSeqSetting!=null?!!res.orderSeqSetting:!!res.sequenced;
  if(seq)return "seq";
  const gateOff=res.orderGateSetting!=null?!res.orderGateSetting:!!res.single;
  if(gateOff)return "single";
  return res.phases&&res.phases.length>1?"waves":"together";
}
function projOrderHeader(res){
  if(res.progressWaves)return 'Order: <b style="color:var(--ink2)">projects grouped into faster stages</b> — keeping useful stages after progress is marked complete. Finish each stage before starting the next.';
  switch(projOrderMode(res)){
    case "seq":return 'Order: <b style="color:var(--ink2)">one project at a time</b> — unlocks first, then order numbers'+(res.orderBatchSetting?' (projects sharing a number together)':'')+', then estimated completion time. Change this in the <b>Projects</b> tab of <b>Projects+Prices</b>.';
    case "single":return 'Order: <b style="color:var(--ink2)">all projects in one phase</b> — unlock ordering off. Change this in the <b>Projects</b> tab of <b>Projects+Prices</b>.';
    case "waves":return 'Order: <b style="color:var(--ink2)">all together, in unlock waves</b> — material unlocks first, then the rest. Change this in the <b>Projects</b> tab of <b>Projects+Prices</b>.';
    default:return 'Order: <b style="color:var(--ink2)">all projects together</b> in one shared '+(res.projLineMode==="static"?'set &amp; forget':'line-switching')+' schedule. Change this in the <b>Projects</b> tab of <b>Projects+Prices</b>.';
  }
}
function projLineModeHtml(res){
  const isStatic=res&&res.projLineMode==="static";
  return `<div class="line-mode">
    <span class="line-mode-l">Line plan</span>
    <div class="modesw" role="group" aria-label="Project line plan">
      <button type="button" data-linemode="split" class="${isStatic?"":"on"}" aria-pressed="${isStatic?"false":"true"}" title="Lines may switch jobs at replayed boundaries to shorten the complete schedule.">Line switching</button>
      <button type="button" data-linemode="static" class="${isStatic?"on":""}" aria-pressed="${isStatic?"true":"false"}" title="Each line runs one job for a whole phase; reset lines only between listed phases.">Set &amp; forget</button>
    </div>
  </div>`;
}
function staticHeldFeederItems(res){
  if(!res||res.projLineMode!=="static")return [];
  const held=new Set();
  (res.executionPhases||[]).filter(phase=>phase&&phase.kind==="project"&&phase.eta>0).forEach(phase=>{
    const direct=phase.demandSub||{},inventory=phase.invStart||{},consumed={},assigned=new Set();
    (phase.plan||[]).forEach(line=>(line.entries||[]).forEach(entry=>{
      assigned.add(entry.item);
      (entry.cons||[]).forEach(input=>{consumed[input.item]=(consumed[input.item]||0)+(input.hr||0)*phase.eta;});
    }));
    assigned.forEach(item=>{
      const reserved=Number(phase.preProducedDemand&&phase.preProducedDemand[item])||0;
      const have=Math.max(0,(Number(inventory[item])||0)-reserved),need=Number(consumed[item])||0;
      const tolerance=1e-8+Number.EPSILON*64*Math.max(1,Math.abs(have),Math.abs(need));
      if((direct[item]||0)<=tolerance&&need>tolerance&&have>=need-tolerance)held.add(item);
    });
  });
  return ALLITEMS.filter(item=>held.has(item));
}
function projectStabilityHtml(res){
  if(res&&res.projLineMode==="static")return "";
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
      <div style="margin-top:7px">Use the always-available <b>Line-job policy</b> selector in <b>Projects+Prices</b> only if you deliberately want to override this.</div>
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
// Clock time `hours` into the plan, counted from the plan-start anchor (or now when none is set). A
// time on a later day carries its date. Shared by the step plan and the sell-again card.
function fmtPlanClock(hours,anchor){
  if(!isFinite(hours)||hours<0)return "";
  const start=anchor||((S.planStart!=null&&isFinite(S.planStart))?new Date(S.planStart):new Date());
  const now=isNaN(start.getTime())?new Date():start;
  const d=new Date(now.getTime()+hours*3600000);
  let t=d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  const dayDiff=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
  if(dayDiff>0)t+=` (${d.toLocaleDateString([],{month:"short",day:"numeric"})})`;
  return t;
}
/* ---------- selling again (Project plan) ----------
 * Which item Max credits/hr would sell on this factory, when the plan stops using it, how much of
 * the stock on hand the plan still needs, and what selling it earns once the lines are free. The
 * ranking is the Credits comparison itself: read from today's Credits cache when this factory has
 * one, otherwise solved in the background once the plan is on screen — and cached for Credits mode
 * in turn. The chosen item lasts for the page session. */
let _sellRanking=null,_sellRankingRequest=null,_sellItemChoice=null;
function creditsSnapshotOf(state){const snapshot=solveStateSnapshot(state);snapshot.mode="credits";return snapshot;}
function projectSellRanking(){
  if(!PRICEABLE_ITEMS.some(it=>toDec0(S.sellPrice&&S.sellPrice[it]).gt(DEC_ZERO)))return {status:"no-prices"};
  const key=dailySolveConditionKey(creditsSnapshotOf(S));
  if(_sellRanking&&_sellRanking.key===key)return _sellRanking.error?{status:"failed",key}:{status:"ready",key,result:_sellRanking.result};
  const cached=readDailySolveCache(key,"credits");
  if(cached){_sellRanking={key,result:cached.result};return {status:"ready",key,result:cached.result};}
  return {status:"missing",key};
}
// Asked only while nothing else is solving: a request supersedes whatever is in flight, and the plan
// being repainted may be a stale one with its replacement still solving.
function requestSellRanking(key){
  const status=solveService.status();
  if(status.active||S.mode!=="project")return;
  const snapshot=creditsSnapshotOf(S);
  if(dailySolveConditionKey(snapshot)!==key)return;
  const budget=boundedPersistedField("solveBudget",snapshot.solveBudget,10000,200,60000,true);
  const generation=solveService.request({mode:"credits",stateRevision,budget,stateSnapshot:snapshot,
    follow:{mode:"project",key:solveStateKey(S)}},(res,error)=>{
    _sellRankingRequest=null;
    _sellRanking=error||!res?{key,error:true}:{key,result:res};
    if(typeof repaintProject==="function")repaintProject();
  });
  _sellRankingRequest={key,generation};
}
// A search started while the ranking was solving superseded it; pick the ranking back up after.
function resumeSellRanking(){
  if(S.mode!=="project"||!_lastProjectRes)return;
  const ranking=projectSellRanking();
  if(ranking.status==="missing"&&!sellRankingPending(ranking.key))setTimeout(()=>requestSellRanking(ranking.key),0);
}
function sellRankingPending(key){
  const status=solveService.status();
  return !!(_sellRankingRequest&&_sellRankingRequest.key===key&&status.active&&status.generation===_sellRankingRequest.generation);
}
/* What the replayed schedule asks of `item`, and when it stops asking.
 *
 * `required` is everything the plan spends of it: project costs, pre-produced reserves, and what its
 * own crafts consume — what you have to keep on hand until the plan spends it. The plan counts your
 * stock toward that first (`counted`), and makes the rest on its lines and from Lil' Forgie;
 * `freeAt` is the hour that making is done. Until then none of the item is spare, and from then on
 * anything above what is still owed is. Stock and what is
 * still owed fall together as the plan spends, so only production closes that gap, and it is
 * closed for good the first time it is closed. A line set to one job for the whole phase can keep
 * making the item after that; those are the spare ones.
 *
 * A mined resource is not held as stock in the replay: its `counted` is null, and it is free once the
 * last phase drawing on it ends. */
function sellAgainTiming(res,item){
  const validation=res.scheduleValidation||{},phases=validation.phases||[],boundaries=validation.boundaries||[];
  const end=Number(res.eta)||0,runs=[],drops=[];
  let elapsed=0,required=0,lastDraw=null;
  phases.forEach(ph=>{
    const phaseStart=elapsed,eta=Number(ph.eta)||0;elapsed+=eta;
    if((ph.kind||"project")==="project")required+=Math.max(0,Number((ph.demandSub||{})[item])||0);
    required+=Math.max(0,Number((ph.preProducedDemand||{})[item])||0);
    const supplied=Math.max(0,Number((ph.externalSupply||{})[item])||0);
    if(supplied>0)drops.push({at:phaseStart,amount:supplied});
    (ph.plan||[]).forEach(line=>(line.entries||[]).forEach(entry=>{
      const frac=Number(entry.frac)||0,from=phaseStart+(Number(entry.start)||0),to=phaseStart+(Number(entry.end)||0);
      if(entry.item===item&&frac>0&&to>from)runs.push({from,to,rate:(Number(entry.outHr)||0)/frac});
      (entry.cons||[]).forEach(c=>{if(c.item===item&&c.hr>0){required+=c.hr*eta;lastDraw=phaseStart+eta;}});
    }));
  });
  const tracked=boundaries.length>0&&Object.prototype.hasOwnProperty.call(boundaries[0].inventory||{},item);
  const tolerance=Math.max(1e-8,required*1e-12);
  if(!tracked)return {used:required>tolerance,required,counted:null,freeAt:required>tolerance?lastDraw:null,end};
  if(!(required>tolerance))return {used:false,required:0,counted:0,freeAt:null,end};
  const stock=Math.max(0,Number(boundaries[0].inventory[item])||0),counted=Math.min(stock,required);
  const toMake=required-counted;
  if(!(toMake>tolerance))return {used:true,required,counted,freeAt:0,end};
  const forgie=typeof forgieHr==="function"&&typeof supplyRate==="function"?Math.max(0,Number(supplyRate(forgieHr(item)))||0):0;
  const times=[...new Set([0,end,...runs.flatMap(run=>[run.from,run.to]),...drops.map(drop=>drop.at)])].filter(t=>t>=0&&t<=end).sort((a,b)=>a-b);
  let made=0,freeAt=end;
  for(let i=0;i<times.length;i++){
    const t=times[i];
    made+=drops.filter(drop=>drop.at===t).reduce((sum,drop)=>sum+drop.amount,0);
    if(made>=toMake-tolerance){freeAt=t;break;}
    if(i+1>=times.length)break;
    const next=times[i+1],rate=forgie+runs.filter(run=>run.from<=t&&run.to>=next).reduce((sum,run)=>sum+run.rate,0);
    if(rate>0&&made+rate*(next-t)>=toMake-tolerance){freeAt=t+(toMake-made)/rate;break;}
    made+=rate*(next-t);
  }
  return {used:true,required,counted,freeAt,end};
}
function sellAgainHtml(res){
  const ranking=projectSellRanking();
  if(ranking.status==="no-prices")return {html:""};
  const head='<div class="subhead" style="margin-top:0">Selling again</div>';
  if(ranking.status==="missing"){
    return {html:`<div class="sell-again">${head}<div class="proj-mini">Ranking your sell items for this factory…</div></div>`,
      request:sellRankingPending(ranking.key)?null:ranking.key};
  }
  if(ranking.status==="failed")return {html:`<div class="sell-again">${head}<div class="proj-mini">Sell items could not be ranked here. Open <b>Max credits/hr</b> to rank them, then come back.</div></div>`};
  const choices=(ranking.result.ranking||[]).filter(c=>c.evaluated!==false&&toDec0(c.credits).gt(1e-9));
  if(!choices.length)return {html:`<div class="sell-again">${head}<div class="proj-mini">None of your priced items can be sold at a profit with these lines.</div></div>`};
  const chosen=choices.find(c=>c.item===_sellItemChoice)||choices[0];
  const name=htmlText(minedDisplayName(chosen.item)),timing=sellAgainTiming(res,chosen.item);
  const options=choices.map((c,i)=>`<option value="${htmlAttribute(c.item)}"${c===chosen?" selected":""}>${htmlText(minedDisplayName(c.item))}${i===0?" (best)":""}</option>`).join("");
  const rows=[],need=`<b>${disp(timing.required)} ${name}</b>`;
  if(!timing.used)rows.push(`<li><b>Now</b> — this plan never uses ${name}.</li>`);
  else if(timing.counted===null)rows.push(`<li>From <b>${fmtPlanClock(timing.freeAt)}</b>, when the plan stops drawing on ${name}.</li>`);
  else if(timing.freeAt===0)rows.push(`<li><b>Now</b>, above ${need}: your stock already covers what the plan needs. Keep ${need} on hand until the plan spends them, and sell the rest.</li>`);
  else{
    rows.push(`<li>From <b>${fmtPlanClock(timing.freeAt)}</b> — by then you hold all ${need} the plan needs, and any made after that are spare.</li>`);
    rows.push(`<li>Keep ${need} on hand until the plan spends them. Until <b>${fmtPlanClock(timing.freeAt)}</b> that means selling none: the plan needs ${timing.counted>0?`the <b>${disp(timing.counted)}</b> you hold now and `:""}every one it makes.</li>`);
  }
  rows.push(`<li><b>${disp(chosen.credits)} credits/hr</b> selling ${name} once your lines are free${timing.end>0?` at <b>${fmtPlanClock(timing.end)}</b>`:""} — the Max credits/hr plan for it.</li>`);
  return {html:`<div class="sell-again">${head}
    <label class="sell-again-pick"><span class="proj-mini">Item</span><select id="sellAgainItem" aria-label="Item to sell again">${options}</select></label>
    <ul>${rows.join("")}</ul></div>`};
}
/* ---------- fit in time (Project plan) ----------
 * The search itself is optimizeFit (js/solver.js); this is its box in the Project plan panel. It
 * runs only from its button, in the background, and its answer stays on screen until the projects
 * or factory change, when it is marked out of date. The search time and hours are saved settings. */
const FIT_BUDGET_CHOICES=Object.freeze([[30000,"30 s"],[60000,"1 min"],[120000,"2 min"],[300000,"5 min"]]);
let _fitRun=null,_fitResult=null,_fitOpen=false,_fitExcludeOpen=false;
// The service is absent from the Node realms that render this panel without solving.
function solveServiceStatus(){return typeof solveService!=="undefined"?solveService.status():{active:false};}
function fitRunning(){const status=solveServiceStatus();return !!(_fitRun&&status.active&&status.generation===_fitRun.generation);}
// Anything but the background sell ranking still solving would be superseded by a search.
function fitBlockedBySolve(){const status=solveServiceStatus();return status.active&&!status.follow&&!fitRunning();}
// The must-finish list and past-the-limit settings an answer was searched with. Not part of the
// solve key, which is about plans, so an answer also goes out of date when any of them changes.
function fitForcedKey(){
  return [S.fitScope,S.fitSelectedOnly===true,S.fitLedgerMax==null?"":S.fitLedgerMax,[...(S.fitExcluded||[])].sort().join(","),[...(S.fitForced||[])].sort().join(","),S.fitNext===true,S.fitExtra===true,S.fitExtra===true?S.fitExtraHours:""].join("|");
}
// What the search can pick from: ledger cards, and projects too once the switch says so.
function fitInScope(p){return S.fitScope==="all"||!!p.ledgerId;}
// What the search would pick from before the exclude list: Search only my selected ledgers drops
// the ledger cards that aren't ticked.
function fitPickable(p){return fitInScope(p)&&!(S.fitSelectedOnly&&p.ledgerId&&!p.on);}
function fitExcluded(p){return (S.fitExcluded||[]).includes(p.id);}
function fitResultCurrent(entry){return !!entry&&entry.key===solveStateKey(S)&&entry.forced===fitForcedKey();}
function startFit(){
  if(fitRunning()||fitBlockedBySolve())return;
  const snapshot=solveStateSnapshot(S),key=solveStateKey(snapshot),forced=fitForcedKey();
  const budget=boundedPersistedField("fitBudget",snapshot.fitBudget,60000,10000,300000,true);
  let generation=null;
  generation=solveService.request({mode:"project",task:"fit",quiet:true,stateRevision,budget,stateSnapshot:snapshot,solveKey:key,
    onDrop:()=>{if(_fitRun&&_fitRun.generation===generation){_fitRun=null;repaintFit();resumeSellRanking();}}},(res,error)=>{
    _fitRun=null;
    _fitResult=error||!res?{key,forced,error:solveErrorMessage(error)}:{key,forced,res};
    repaintFit();
    resumeSellRanking();
  });
  _fitRun={generation,key};_fitOpen=true;
  repaintFit();
}
function stopFit(){if(fitRunning())solveService.cancel("Fit-in-time search stopped");}
// Tick what the answer takes and untick the rest, and end each taken project where the answer stops
// — for a ledger card, include as many following ledgers as it reaches. The list is then exactly the
// answer's, so the answer stays current over it.
function fitRowEnd(p){return p.ledgerId?Number(p.ledgerAhead)+1:Number(p.to);}
function applyFitSelection(){
  const entry=_fitResult;if(!entry||!entry.res||!fitResultCurrent(entry))return;
  const rows=entry.res.selection||[],listed=r=>(S.projects||[]).find(x=>x.id===r.id);
  const on=rows.filter(r=>r.taken>0&&listed(r)&&!listed(r).on).length;
  const off=rows.filter(r=>r.taken===0&&listed(r)&&listed(r).on).length;
  const moved=rows.filter(r=>r.taken>0&&listed(r)&&fitRowEnd(listed(r))!==r.toLevel).length;
  const parts=[];
  if(on)parts.push(`tick ${on} project${on===1?"":"s"} it takes`);
  if(off)parts.push(`untick ${off} that ${off===1?"doesn't":"don't"} fit`);
  if(moved)parts.push(`change where ${moved} project${moved===1?" ends":"s end"} to match it`);
  if(!parts.length)return;
  if(!confirm(`Use this selection? This will ${parts.join(", ")}.`))return;
  mutateState(st=>{rows.forEach(r=>{
    const p=(st.projects||[]).find(x=>x.id===r.id);if(!p)return;
    if(r.taken===0){p.on=false;return;}
    p.on=true;
    if(p.ledgerId)p.ledgerAhead=r.toLevel-1;else p.to=r.toLevel;
  });});
  if(typeof markInputEdited==="function")markInputEdited("projects",["project"]);
  entry.key=solveStateKey(S);
  repaintFit();
}
// True once every project the answer takes is ticked and ends where it stops, and the rest are unticked.
function fitSelectionApplied(res){
  return (res.selection||[]).every(r=>{
    const p=(S.projects||[]).find(x=>x.id===r.id);if(!p)return true;
    if(r.taken===0)return !p.on;
    return p.on&&fitRowEnd(p)===r.toLevel;
  });
}
// A ledger row is named by the ledgers it takes; a row the list has unticked says so.
function fitRowName(r){
  const name=htmlText(r.name);
  const label=!r.ledger||r.firstNumber==null?name
    :r.taken>1&&r.lastNumber!=null?`${name} ledgers #${r.firstNumber}–#${r.lastNumber}`:`${name} ledger #${r.firstNumber}`;
  return r.ticked===false?`${label} <span class="proj-mini">· not ticked</span>`:label;
}
function fitSelectionRowHtml(r){
  const levels=r.ledger
    ?`${r.taken} ledger${r.taken===1?"":"s"}`
    :r.remaining===1?`lv ${r.fromLevel}`
    :`lv ${r.fromLevel}${r.toLevel>r.fromLevel?` → ${r.toLevel}`:""} <span class="proj-mini">· ${r.taken} of ${r.remaining}</span>`;
  const why=r.required==="chosen"?' <span class="pill craft" style="font-size:9px">must finish</span>'
    :r.required==="unlock"?' <span class="pill" style="font-size:9px">needed to unlock</span>':"";
  return `<tr><td>${fitRowName(r)}${why}</td><td>${levels}</td><td class="num mono">${r.finish!=null?fmtPlanClock(r.finish):"—"}</td></tr>`;
}
// What one past-the-limit step adds: the ledger, or the project level, it takes the answer to.
function fitPastLabel(item){
  const name=htmlText(item.name);
  const label=item.ledger?(item.number!=null?`${name} ledger #${item.number}`:name):`${name} lv ${item.toLevel}`;
  return item.ticked===false?`${label} <span class="proj-mini">· not ticked</span>`:label;
}
const FIT_PAST_NOTHING_LEFT="every project and ledger in your list is already in the answer, to its last level.";
const FIT_PAST_NOTHING_LEFT_SEARCHED="everything the search can pick from is already in the answer.";
const FIT_PAST_NO_TIME="the search time ran out before anything past the limit could be checked. Give it more search time.";
// True when part of the list was outside the search, so "your list" would claim too much.
function fitSearchLimited(res){
  const left=res&&res.leftOut;
  return !!left&&(left.projects>0||left.blocked.length>0||left.capped>0||(left.excluded||[]).length>0||left.unselected>0);
}
function fitPastHtml(res){
  let html="";
  const limited=fitSearchLimited(res),nothingLeft=limited?FIT_PAST_NOTHING_LEFT_SEARCHED:FIT_PAST_NOTHING_LEFT;
  // Each past-the-limit plan holds the one before it, so a run of them reads as one growing list.
  const inside=Array.isArray(res.inside)?res.inside:[];
  if(inside.length)html+=`<div class="fit-next"><b>Also fits inside your limit:</b> ${inside.map(fitPastLabel).join(", ")} — with ${inside.length===1?"it":"them"} the plan takes <b>${fmtDuration(inside[inside.length-1].eta)}</b>.</div>`;
  const next=res.next;
  if(next){
    const body=next.status==="found"
      ?`${fitPastLabel(next)} — with it the plan takes <b>${fmtDuration(next.eta)}</b>, done by <b>${fmtPlanClock(next.eta)}</b>, <b>${fmtDuration(next.over)}</b> past your limit.`
      :next.status==="time"?FIT_PAST_NO_TIME
      :next.status==="all"?nothingLeft
      :`nothing else finishes within ${FIT_NEXT_WINDOW_HOURS} hours of your limit.`;
    html+=`<div class="fit-next"><b>Next past the limit:</b> ${body}</div>`;
  }
  const extra=res.extra;
  if(extra){
    html+=`<div class="subhead">With up to ${fmtDuration(extra.hours)} more</div>`;
    const sentence=text=>`<div class="proj-mini">${text.charAt(0).toUpperCase()+text.slice(1)}</div>`;
    html+=extra.status==="all"?sentence(nothingLeft)
      :extra.status==="time"?sentence(FIT_PAST_NO_TIME)
      :extra.items.length
      ?`<div class="proj-mini" style="margin-bottom:4px">Each row adds one more to the plan above it, starting from the answer.</div>
        <table class="fit-table"><thead><tr><th>Adds</th><th class="num">Finishes</th><th class="num">Plan takes</th><th class="num">Past the limit</th></tr></thead><tbody>${extra.items.map(item=>
        `<tr><td>${fitPastLabel(item)}</td><td class="num mono">${item.count}</td><td class="num mono">${item.checked?fmtDuration(item.eta):`at least ${fmtDuration(item.eta)}`}</td><td class="num mono">${item.checked?"+"+fmtDuration(item.over):"not checked"}</td></tr>`).join("")}</tbody></table>
        ${extra.items.some(item=>!item.checked)?'<div class="proj-mini" style="margin-top:4px">Unchecked rows ran out of search time; their time is a lower bound.</div>':""}
        ${extra.cut?`<div class="proj-mini" style="margin-top:4px">The search time ran out before the list reached ${fmtDuration(extra.hours)} more. Give it more search time to see further.</div>`:""}`
      :extra.cut?sentence(FIT_PAST_NO_TIME)
      :`<div class="proj-mini">Nothing else ${limited?"the search can pick from":"in your list"} finishes within ${fmtDuration(extra.hours)} more.</div>`;
  }
  return html;
}
// "a", "a and b", "a, b and c".
function fitListText(parts){return parts.length>1?`${parts.slice(0,-1).join(", ")} and ${parts[parts.length-1]}`:parts.join("");}
// Why part of the list was not searched: what was excluded, the ledger limit, any Must finish card it
// cuts short, and each chain that stops early because a card it waits on is outside the search.
function fitLeftOutHtml(res){
  const left=res.leftOut;if(!left)return "";
  const lines=[],parts=(left.excluded||[]).map(htmlText);
  if(left.unselected>0)parts.push("ledgers you haven't selected");
  if(left.capped>0&&left.ledgerMax!=null)parts.push(`ledgers past #${left.ledgerMax}`);
  if(parts.length)lines.push(`Left out of the search: ${fitListText(parts)}.`);
  (left.forcedCut||[]).forEach(c=>lines.push(c.lastNumber!=null
    ?`Must finish holds ${htmlText(c.name)} only as far as ledger #${c.lastNumber}, your ledger limit.`
    :`Must finish asks for ${htmlText(c.name)}, which is past your ledger limit.`));
  left.blocked.forEach(b=>{
    const where=b.ledger&&b.number!=null?`ledger #${b.number}`:`lv ${b.level}`;
    const why=b.material?`it needs ${htmlText(b.material)}, which ${htmlText(b.by)} unlocks`:`${htmlText(b.by)} has to be finished first`;
    const excludedBy=b.why==="excluded"?b.material?`, and ${htmlText(b.by)} is excluded from the search`:", and it is excluded from the search":"";
    lines.push(`${htmlText(b.name)} stops before ${where}: ${why}${excludedBy}.${b.why==="scope"?" Switch to <b>Ledgers and projects</b> to let the search build it.":""}`);
  });
  return lines.map(line=>`<div class="proj-mini" style="margin-top:6px">${line}</div>`).join("");
}
function fitEmptyHtml(res){
  const left=res.leftOut,ledgersOnly=!!left&&left.scope==="ledgers";
  const head=ledgersOnly&&left.projects>0&&!left.blocked.length
    ?"There are no ledgers left to craft in your list. Switch to <b>Ledgers and projects</b> to search your projects too."
    :fitSearchLimited(res)?"Nothing the search can pick from is left to craft."
    :ledgersOnly?"There are no ledgers left to craft in your list.":"Nothing in your project list is left to craft.";
  return `<div class="proj-mini">${head}</div>${fitLeftOutHtml(res)}`;
}
function fitResultHtml(entry,current){
  if(entry.error)return `<div class="notice warn" style="font-size:11.5px"><b>The search stopped.</b> ${htmlText(entry.error)}</div>`;
  const res=entry.res;
  if(res.empty)return fitEmptyHtml(res);
  const stale=current?"":`<div class="notice info" style="font-size:11.5px">Your projects, factory or search settings changed since this search ran. Run it again for an up-to-date answer.</div>`;
  const finished=r=>r.finished!=null?r.finished:r.taken;
  const ledgers=res.selection.filter(r=>r.ledger).reduce((sum,r)=>sum+finished(r),0),levels=res.count-ledgers;
  const named=[levels?`${levels} project level${levels===1?"":"s"}`:"",ledgers?`${ledgers} ledger${ledgers===1?"":"s"}`:""].filter(Boolean).join(" and ");
  let head;
  const mustCount=res.selection.filter(r=>r.required==="chosen").length;
  if(res.forcedOver){
    const real=res.forcedOver.real,own=mustCount===1?"Your must-finish project doesn't":"Your must-finish projects don't";
    head=`${own} fit in <b>${fmtDuration(res.hours)}</b> on ${mustCount===1?"its":"their"} own: ${real!=null
      ?`crafted together ${mustCount===1?"it takes":"they take"} <b>${fmtDuration(real)}</b>`
      :`${mustCount===1?"it needs":"they need"} at least <b>${fmtDuration(res.forcedOver.estimate)}</b>`}. Remove one from Must finish, or give it more hours.`;
  }
  else if(!res.count)head=`Nothing on your list finishes within <b>${fmtDuration(res.hours)}</b>.`;
  else if(res.verified&&Number.isFinite(res.eta))head=`<b>${named}</b> finish within <b>${fmtDuration(res.hours)}</b>. Crafted together they take <b>${fmtDuration(res.eta)}</b>, done by <b>${fmtPlanClock(res.eta)}</b>${res.hours-res.eta>1/60?`, with <b>${fmtDuration(res.hours-res.eta)}</b> to spare`:""}.`;
  else head=`<b>${named}</b> look likely to finish within <b>${fmtDuration(res.hours)}</b> (about <b>${fmtDuration(res.estimateEta)}</b>). The search time ran out before this was checked as a full plan, so treat it as a guide, or give it more search time.`;
  // Doesn't fit names only what was ticked: the levels a ticked card asks for that the answer leaves out.
  const taken=res.selection.filter(r=>r.taken>0),missed=res.selection.filter(r=>r.ticked!==false&&r.taken<r.chosen);
  const table=taken.length?`<table class="fit-table"><thead><tr><th>Finishes</th><th>Levels</th><th class="num">Done by</th></tr></thead><tbody>${taken.map(fitSelectionRowHtml).join("")}</tbody></table>`:"";
  const missedName=r=>r.ledger&&r.firstNumber!=null?`${htmlText(r.name)} ledger #${r.firstNumber}`:htmlText(r.name);
  const missedText=missed.length?`<div class="proj-mini" style="margin-top:6px">Doesn't fit: ${missed.map(r=>missedName(r)+(r.taken>0?(r.ledger?` (the last ${r.chosen-r.taken})`:` (lv ${r.toLevel+1} on)`):"")).join(", ")}.</div>`:"";
  const how=`<div class="proj-mini" style="margin-top:6px">${res.exhaustive?"Every combination was tried":`Tried ${res.tried} combinations${res.shards>1?` across ${res.shards} workers`:""}`}.</div>`;
  const apply=!(current&&res.verified&&res.count>0)?""
    :fitSelectionApplied(res)?`<div class="proj-mini" style="margin-top:6px">Your project list matches this selection${fitSearchLimited(res)?", apart from what the search left out":""}.</div>`
    :`<button class="btn ghost" type="button" id="btnFitApply" style="margin-top:8px">Use this selection</button>`;
  return `${stale}<p style="margin:0 0 8px;font-size:12px;color:var(--ink2);line-height:1.5">${head}</p>${table}${missedText}${fitLeftOutHtml(res)}${fitPastHtml(res)}${how}${apply}`;
}
// The projects the answer has to include, as removable chips, and a picker for the rest of what the
// search can pick from.
function fitForcedHtml(running){
  const listed=(S.projects||[]).filter(p=>fitPickable(p)&&!fitExcluded(p));
  if(!listed.length)return "";
  const forced=new Set(S.fitForced||[]),off=running?" disabled":"";
  const chips=listed.filter(p=>forced.has(p.id)).map(p=>`<span class="fit-chip">${htmlText(p.name)}<button type="button" class="fit-chip-x" data-fit-unforce="${htmlAttribute(p.id)}" title="Remove from Must finish" aria-label="Remove ${htmlAttribute(p.name)} from Must finish"${off}>×</button></span>`).join("");
  const rest=listed.filter(p=>!forced.has(p.id));
  const add=rest.length?`<select id="fitForcedAdd" aria-label="Add a project or ledger that must finish"${off}><option value="" selected>+ Add…</option>${rest.map(p=>`<option value="${htmlAttribute(p.id)}">${htmlText(p.name)}</option>`).join("")}</select>`:"";
  return `<div class="fit-forced"><span class="fit-forced-l">Must finish</span>${chips||'<span class="proj-mini">nothing yet</span>'}${add}</div>`;
}
// Mirrors FIT_NEXT_WINDOW in js/solver.js, which this realm may not load.
const FIT_NEXT_WINDOW_HOURS=12;
// What the search picks from: just the ledger cards, or the projects as well.
function fitScopeHtml(running){
  const all=S.fitScope==="all",off=running?" disabled":"";
  return `<div class="line-mode fit-scope">
    <span class="line-mode-l">Pick from</span>
    <div class="modesw" role="group" aria-label="What the search picks from">
      <button type="button" id="fitScopeLedgers" data-fit-scope="ledgers" class="${all?"":"on"}" aria-pressed="${all?"false":"true"}"${off}>Just ledgers</button>
      <button type="button" id="fitScopeAll" data-fit-scope="all" class="${all?"on":""}" aria-pressed="${all?"true":"false"}"${off}>Ledgers and projects</button>
    </div>
  </div>`;
}
// Whether a ledger card runs on into the character's following ledgers or keeps to its own.
function fitSelectedHtml(running){
  return `<div class="fit-selected"><label class="fit-check"><input type="checkbox" id="fitSelectedOnly"${S.fitSelectedOnly?" checked":""}${running?" disabled":""}> Search only my selected ledgers <span class="proj-mini">· the ticked ledger cards, with no ledgers after them</span></label></div>`;
}
// What the search leaves out of the list: every ledger past a number, and the cards ticked in a
// dropdown of what the switch would otherwise search. The dropdown stays open across a repaint.
function fitLeaveOutHtml(running){
  const off=running?" disabled":"",errorId="field-fit-ledger-max-error";
  const value=S.fitLedgerMax==null?"":String(S.fitLedgerMax);
  const listed=(S.projects||[]).filter(fitPickable),count=listed.filter(fitExcluded).length;
  const menu=listed.length?`<details class="fit-exclude" id="fitExcludeMenu"${_fitExcludeOpen?" open":""}>
      <summary data-fit-exclude-toggle>Exclude from the search: <b>${count?`${count} excluded`:"none"}</b></summary>
      <div class="fit-exclude-list" role="group" aria-label="Exclude from the search">${listed.map(p=>
        `<label class="fit-check"><input type="checkbox" id="fitExclude-${htmlAttribute(p.id)}" data-fit-exclude="${htmlAttribute(p.id)}"${fitExcluded(p)?" checked":""}${off}> ${htmlText(p.name)}</label>`).join("")}</div>
    </details>`:"";
  return `<div class="fit-leave">
    <label class="fit-field">Exclude ledgers beyond # <span class="field-stack"><input type="text" id="fitLedgerMax" ${htmlFieldInputAttributes(FIELD_SCHEMA.fitLedgerMax)} value="${htmlAttribute(value)}" placeholder="none" data-field-error="${errorId}" aria-label="Exclude ledgers numbered beyond"${off}><span class="field-error" id="${errorId}" aria-live="polite" aria-atomic="true"></span></span></label>
    ${menu}
  </div>`;
}
// What to look at past the limit: the next step alone, and everything within extra hours.
function fitPastControlsHtml(running){
  const off=running?" disabled":"",errorId="field-fit-extra-hours-error";
  return `<div class="fit-past">
    <label class="fit-check"><input type="checkbox" id="fitNext"${S.fitNext?" checked":""}${off}> Show the next thing past the limit, if it finishes within ${FIT_NEXT_WINDOW_HOURS} hours of it</label>
    <label class="fit-check"><input type="checkbox" id="fitExtra"${S.fitExtra?" checked":""}${off}> List what else finishes with up to
      <span class="field-stack"><input type="text" id="fitExtraHours" ${htmlFieldInputAttributes(FIELD_SCHEMA.fitExtraHours)} value="${htmlAttribute(String(S.fitExtraHours))}" data-field-error="${errorId}" aria-label="Extra hours to look past the limit"${off}><span class="field-error" id="${errorId}" aria-live="polite" aria-atomic="true"></span></span> more hours</label>
  </div>`;
}
function fitBoxHtml(){
  const running=fitRunning(),blocked=fitBlockedBySolve();
  const hoursRule=FIELD_SCHEMA.fitHours,errorId="field-fit-hours-error";
  const budgetOptions=FIT_BUDGET_CHOICES.map(([ms,label])=>`<option value="${ms}"${S.fitBudget===ms?" selected":""}>${label}</option>`).join("");
  const budgetLabel=(FIT_BUDGET_CHOICES.find(([ms])=>ms===S.fitBudget)||[0,fmtDuration(S.fitBudget/3600000)])[1];
  const cores=solveServiceStatus().fitParallel||1;
  const action=running
    ?`<button class="btn ghost" type="button" id="btnFitStop">Stop</button>`
    :`<button class="btn primary" type="button" id="btnFitRun"${blocked?" disabled":""}>Find what fits</button>`;
  let body="";
  if(running)body=`<div class="proj-mini"><span class="spinner" aria-hidden="true"></span> Searching — up to ${budgetLabel}.</div>`;
  else if(blocked)body=`<div class="proj-mini">Waiting for the plan to finish solving.</div>`;
  else if(_fitResult)body=fitResultHtml(_fitResult,fitResultCurrent(_fitResult));
  return `<details class="cat-panel fit-panel" id="fitBox" ${(_fitOpen||running||_fitResult)?"open":""}>
    <summary data-paneltoggle="fit"><span class="cat-sum-lbl">What fits in a time limit</span><span class="cat-sum-meta">heavy solve</span></summary>
    <div class="panel-pad">
      ${fitScopeHtml(running)}
      <div class="fit-controls">
        <label class="fit-field">Finish within <span class="field-stack"><input type="text" id="fitHours" ${htmlFieldInputAttributes(hoursRule)} value="${htmlAttribute(String(S.fitHours))}" data-field-error="${errorId}" aria-label="Hours to finish within"><span class="field-error" id="${errorId}" aria-live="polite" aria-atomic="true"></span></span> hours</label>
        <label class="fit-field">Search for <select id="fitBudget" aria-label="Fit-in-time search time"${running?" disabled":""}>${budgetOptions}</select></label>
        ${action}
      </div>
      ${fitSelectedHtml(running)}
      ${fitLeaveOutHtml(running)}
      ${fitForcedHtml(running)}
      ${fitPastControlsHtml(running)}
      <p class="help" style="margin:8px 0 10px">A heavy solve: it tries many combinations of the ${S.fitScope==="all"?"projects and ledgers":"ledgers"} in your list, ${S.fitSelectedOnly?"ticked ledger cards only, each kept to its own ledger and the ones Include next adds":"ticked or not, with each ledger running on into the character's following ledgers"}, then checks the best as a full plan. Ledgers numbered past the one under <b>Exclude ledgers beyond #</b>, and anything ticked under <b>Exclude from the search</b>, are left out. Anything under <b>Must finish</b> is always in the answer, as far as its card asks, and the rest is fitted around it. It runs for up to the search time you pick on up to ${cores} CPU core${cores===1?"":"s"}, and only when you press <b>Find what fits</b>.</p>
      <div id="fitBody">${body}</div>
    </div>
  </details>`;
}
// Repaint the box alone: the search starts, stops and lands while the reader may be anywhere else
// in the plan, so nothing outside it moves.
function repaintFit(){
  const box=document.getElementById("fitBox");if(!box)return;
  const focused=document.activeElement&&box.contains(document.activeElement)?document.activeElement.id:"";
  box.outerHTML=fitBoxHtml();
  const target=focused&&document.getElementById(focused)||(focused?document.getElementById(fitRunning()?"btnFitStop":"btnFitRun"):null);
  if(target&&!target.disabled)target.focus();
}
// Quick project controls (on/off, level range, mark done) — collapsed so the plan stays the hero,
// and rendered on every Project-mode path including the empty ones, so the tick that emptied the
// plan can always be undone where it was made. Same fields as Projects+Prices / Track progress, kept
// in sync; wired via delegated #results handlers. .proj-adjust keeps the panel out of the stale
// dimming: an on/off tick is what marks the plan stale, so the ticks stay readable while the plan
// they invalidated fades. Returns "" when no project carries levels to adjust.
function projAdjustPanelHtml(forceOpen){
  const adj=stepsProjControls();
  if(!adj)return "";
  return `<details class="cat-panel proj-adjust" ${(forceOpen||_projAdjustOpen)?"open":""}><summary data-paneltoggle="adjust"><span class="cat-sum-lbl">Adjust project levels &amp; completion</span><span class="cat-sum-meta">on/off · levels · mark done</span></summary><div class="panel-pad">${adj}</div></details>`;
}
function renderProjectResults(res,el,stat){
  _lastProjectRes=res;
  if(typeof refreshProgressIfOpen==="function")refreshProgressIfOpen();
  const scheduleExecutable=!!(res&&res.feasible&&res.lpFeasible&&res.scheduleValidation&&res.scheduleValidation.ok);
  // Seed the plan-start anchor once, the first time a real plan exists (issue #87 item 1) — moved here
  // from the old modal's open handler now that the step plan is always on screen. Display anchor only.
  if(S.planStart==null&&scheduleExecutable&&res.phases&&res.phases.length){mutateState(st=>{st.planStart=Date.now();});save();}
  if(res.empty){
    // Distinguish "everything's done" from "nothing configured" (issue #87 item 2). When active
    // projects exist but are fully checked off, keep the Track-progress opener so the user can still
    // review or reopen them — the button re-wires via the delegated #results handler.
    const hasActive=(S.projects||[]).some(p=>p.on&&(p.levels||[]).length);
    // Unticking the last project is the ordinary way to reach an empty plan, so the ticks come with
    // it — dropping them here would strand the screen, with the dialog the only way to undo the tick
    // that emptied it. Forced open: there is no plan to be the hero, and a collapsed panel would hide
    // the one control that recovers the page.
    const ticks=projAdjustPanelHtml(true);
    if(hasActive){
      el.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div class="proj-mini" style="font-size:11.5px">Every ticked project is complete.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" id="btnProgress">Track progress</button>
          <button class="btn ghost" type="button" data-open-projects>Edit projects</button>
        </div></div>
        <div class="notice info"><b>All projects complete 🎉</b> Nothing left to craft. Open <b>Track progress</b> to review or reopen a level, or use <b>Edit projects</b> to add another project in <b>Projects+Prices</b>.</div>${ticks}`;
      stat.textContent="Plan updated. All selected projects are complete.";return;
    }
    el.innerHTML=(ticks
      ?`<div class="notice info"><b>No projects ticked on.</b> Tick one back on below and press <b>Resimulate</b> to plan it, or use <b>Edit projects</b> to add another in <b>Projects+Prices</b>.
        <div style="margin-top:10px"><button class="btn ghost" type="button" data-open-projects>Edit projects</button></div></div>`
      :`<div class="notice info">No project demand yet. Add a project with item costs in <b>Projects+Prices</b>, tick it <b>on</b>, then come back. Enter your current <b>inventory</b> there too — it's subtracted from what you need to craft.
        <div style="margin-top:10px"><button class="btn primary" type="button" data-open-projects>Edit projects</button></div></div>`)+ticks;
    stat.textContent="Plan updated. No project demand selected.";return;
  }
  let html="";
  // Header: ordering note + Track-progress opener. The step plan below is the main event, so there's
  // no longer a "Step-by-step" button — this panel *is* it.
  html+=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
    <div class="proj-mini" style="font-size:11.5px">${scheduleExecutable?projOrderHeader(res):'Exact replay is blocked. Review the diagnostic and analytical breakdown below.'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" id="btnProgress">Track progress</button>
    </div></div>`;
  html+=projLineModeHtml(res);
  // Plan-start anchor (promoted from the old modal header)
  if(scheduleExecutable)html+=projPlanAnchorHtml();
  // Key notices — the ones that change what you actually do. The old verbose "Project plan." explainer
  // is dropped; the step-plan intro below already tells you how to run it.
  html+=projectForgieNote(res);
  html+=projectStabilityHtml(res);
  if(scheduleExecutable&&res.noSwitchFallback===true)
    html+=`<div class="notice info" style="font-size:11.5px"><b>This plan never switches a line.</b> Every schedule found that did switch needed a longer startup warm-up than it saved, so <b>Line switching</b> returned the one-job-per-line assignment — the best plan it found is one you can set and leave alone.</div>`;
  if(scheduleExecutable&&(res.projLineMode==="static"||res.noSwitchFallback===true)&&
    (res.capped===true||res.searchExhaustive===false||res.staticDeadlineReached===true))
    html+=`<div class="notice info" style="font-size:11.5px"><b>Executable plan found.</b> The listed instructions passed exact replay, but the Set &amp; forget assignment search was bounded and may not be the shortest plan.</div>`;
  const heldFeeders=scheduleExecutable?staticHeldFeederItems(res):[];
  if(heldFeeders.length)html+=`<div class="notice info" style="font-size:11.5px"><b>Held stock does not remove Set &amp; forget feeder jobs.</b> ${heldFeeders.map(htmlText).join(", ")} ${heldFeeders.length===1?"is":"are"} on hand in enough quantity for the phase, but this mode still keeps a sustainable feeder assignment. Exact replay still accounts for and carries that inventory; <b>Line switching</b> can use held intermediates to reduce feeder time.</div>`;
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
    const detail=f.kind==="solve-budget"
      ?"The time limit was reached before every static phase received a usable assignment."
      :f.kind==="mined-rate"
      ?`This phase draws more ${htmlText(f.resource||"mined resource")} than it earns back — <b>${disp(f.excess||0)}/hr</b> over your income${when}, which no stockpile replenishes.`
      :`${htmlText(f.resource||"A required resource")} is short by <b>${disp(f.deficit||0)}</b>${when}.`;
    html+=`<div class="notice warn"><b>Executable schedule blocked:</b> ${detail} ${htmlText(f.message||"")}</div>`;
  }
  if(scheduleExecutable&&res.waved)html+=res.progressWaves
    ?`<div class="notice info" style="font-size:11.5px"><b>Faster in stages.</b> This plan keeps <b>${res.phases.length} stages</b> from earlier unlock groups because they finish the remaining work sooner. Completed projects stay complete. Finish each stage before starting the next; projects within a stage are crafted together.</div>`
    :`<div class="notice info" style="font-size:11.5px"><b>Unlock-aware order.</b> Some projects unlock materials others need (Frames, Gel, Wire), so this is split into <b>${res.phases.length} waves</b> — finish each wave before starting the next. Everything within a wave is crafted together.</div>`;
  if(res.blockedMined&&Object.keys(res.blockedMined).length){
    const blocked=Object.entries(res.blockedMined).map(([item,resources])=>`<b>${item}</b> needs ${resources.map(r=>`<b>${r}</b>`).join(" and ")}`).join("; ");
    html+=`<div class="notice warn"><b>Missing mined income:</b> ${blocked}. Enter those incomes in <b>Mined resources</b> to include the blocked items; they remain excluded from the plan time below.</div>`;
  }
  if(res.infeasItems&&res.infeasItems.length)html+=`<div class="notice warn"><b>Can't sustainably produce:</b> ${res.infeasItems.join(", ")}. Raise a line's max compression, add a line, or check recipe costs — the time below excludes these.${res.projLineMode==="static"?" Set &amp; forget assigns at most one job to each line for a phase, so a deeper recipe chain may need more lines even when Line switching can build it.":""}</div>`;
  if(res.atRiskItems&&res.atRiskItems.length)html+=`<div class="notice warn"><b>Relies entirely on stock:</b> ${res.atRiskItems.join(", ")}. No line is crafting ${res.atRiskItems.length>1?"these":"this"} — the plan is spending down your current inventory to cover them. Once it runs out you'll need dedicated crafters.</div>`;
  if(res.partial)html+=`<div class="notice warn"><b>Partial plan only.</b> The blocked items remain excluded, so the ticked projects are <b>not fully finishable</b> with the current mined incomes. The time shown is for currently plannable work only.</div>`;
  // Summary metrics
  html+=`<div class="metrics">
    <div class="metric"><div class="l">${res.partial?"Partial plan time":scheduleExecutable?"Executable total time":"Analytical LP time"}</div><div class="v">${fmtDuration(scheduleExecutable?res.eta:res.workEta)}</div><div class="u">${res.partial?"currently plannable work only":scheduleExecutable?(res.sequenced?"includes warm-ups; finishes every project":"includes warm-ups and prerequisites"):"not executable — see blocking diagnostic"}</div></div>
    <div class="metric"><div class="l">Projects</div><div class="v">${res.perProject.length}</div><div class="u">${scheduleExecutable?(res.sequenced?"one at a time":res.waved?res.phases.length+(res.progressWaves?" stages":" unlock waves"):res.single?"all in one phase":"scheduled together"):res.phases.length+" analytical phase"+(res.phases.length===1?"":"s")}</div></div>
    ${!res.sequenced&&!res.waved&&res.bottleneck?`<div class="metric"><div class="l">Bottleneck</div><div class="v" style="font-size:17px">${res.bottleneck}</div><div class="u">${scheduleExecutable?`sets the ${res.partial?"partial plan":"finish"} time`:"analytical LP bottleneck only"}</div></div>`:""}
  </div>`;
  const sellAgain=scheduleExecutable?sellAgainHtml(res):{html:""};
  html+=sellAgain.html;
  html+=fitBoxHtml();
  html+=projAdjustPanelHtml(false);
  // ── The step-by-step plan: the main event ──
  html+=`<div class="step-main">${stepPlanHtml(res)}</div>`;
  // Everything analytical folds into one collapsed breakdown so it's a click away, not in the way.
  let bd="";
  if(res.sequenced||res.waved){
    bd+=`<div class="subhead" style="margin-top:0">${scheduleExecutable?(res.waved?(res.progressWaves?"Build order — stages, each crafted together":"Build order — waves, each crafted together"):"Completion order — done one project at a time"):"Analytical phase breakdown"}</div>
      <table><thead><tr><th>#</th><th>${scheduleExecutable?(res.waved?(res.progressWaves?"Stage":"Wave"):"Project"):"Phase"}</th><th>Needs</th><th class="num">${res.partial?"Plan time":"Phase"}</th><th class="num">${scheduleExecutable?(res.partial?"Plannable by":"Done by"):"LP endpoint"}</th></tr></thead><tbody>`;
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
      const inv=toDec0(S.inventory&&S.inventory[it]);
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
  const minedNote=(res.sequenced||res.waved)?"":minedUsageNote(resultMinedUsage(res));
  if(minedNote)bd+=minedNote;
  html+=`<details class="cat-panel breakdown-panel" ${_breakdownOpen?"open":""}><summary data-paneltoggle="breakdown"><span class="cat-sum-lbl">${res.scheduleValidation&&res.scheduleValidation.ok?"Full breakdown":"Analytical LP breakdown"} — demand, line assignment, resource balance</span><span class="cat-sum-meta">the numbers</span></summary><div class="panel-pad">${bd}</div></details>`;
  el.innerHTML=html;
  stat.textContent=scheduleExecutable
    ?"Plan updated. Executable schedule solved in "+(res.ms||0).toFixed(1)+" ms"
    :"Schedule blocked. Analytical LP retained for diagnosis.";
  if(sellAgain.request)setTimeout(()=>requestSellRanking(sellAgain.request),0);
}


function renderResults(options){
  options=options||{};
  if(typeof clearStaleUI==="function")clearStaleUI();   // results are about to reflect current inputs
  if(typeof setPriceNeeded==="function")setPriceNeeded(false); // Credits owns this flag; clear it before every synchronous mode path.
  const el=document.getElementById("results");
  const stat=document.getElementById("solveStat");
  if(S.mode==="manual"){solveService.cancel("Manual mode renders synchronously");renderManual(el,stat);return;}
  // Off the main thread: a long solve (the user's max-solve-time budget) shows a spinner instead
  // of freezing. The service owns cancellation and only delivers the accepted mode/revision.
  const snapshot=solveStateSnapshot(S);
  const solveKey=solveStateKey(snapshot);
  const budget=boundedPersistedField("solveBudget",snapshot.solveBudget,10000,200,60000,true);
  solveService.request({mode:snapshot.mode,stateRevision,budget,stateSnapshot:snapshot,solveKey,forceFresh:options.forceFresh===true},(res,error,metadata)=>{
    if(error){solveError(error);return;}
    if(res)renderSolveResult(res,el,stat,solveKey,metadata);
  });
}
// Only a solve the clock cut short has anything to say. Seeds, the ILS stagnation cutoff and the
// convergence window are all budget-independent by design, so a search that settles returns that
// same plan however long it is given — there is no action behind a caveat on it, and the distance
// to the relaxation's ceiling is not one either: the relaxation lets a line divide its time across
// several jobs, so a plan that cannot be improved still sits well under a ceiling no real factory
// reaches. Reaching the deadline is the one case the reader can act on, by budget or by hardware.
function optimalityNotice(res){
  if(res.deadlineReached!==true)return "";
  const bounded=Number.isFinite(res.bound)&&res.bound>0&&res.feasible&&res.objective>0;
  let headroom="";
  if(bounded){
    const gap=Math.max(0,(res.bound-res.objective)/res.bound);
    // Rounded up, never down: a quoted ceiling has to stay true at the precision it is stated to.
    const pct=gap<0.001?"0.1%":fmt(gap*100,1)+"%";
    headroom=` Its theoretical ceiling is ${pct} higher, though that ceiling lets one line split its time across several jobs, so not all of that is reachable.`;
  }
  return `<div class="notice warn" style="font-size:11.5px"><b>The solve ran out of time.</b> This is the best plan found before the budget ended the search, not the plan it would have settled on. Raise the max solve time to give it room.${headroom}</div>`;
}
function renderSolveResult(res,el,stat,solveKey,metadata){
  if(res.mode==="project"){
    if(typeof solveKey==="string")_lastProjectKey=solveKey;
    renderProjectResults(res,el,stat);return;
  }
  _lastItemsCreditsRes=res;
  // The share sliders need the measured ceilings to say what a percentage is a percentage of.
  // Keyed on nothing because a ceiling depends only on the factory: checking or unchecking an
  // output leaves every other item's ceiling correct, and a line edit raises the stale-results bar.
  if(res.mode==="items"&&res.soloMax){_lastItemsSoloMax=res.soloMax;if(typeof refreshTargetCeilings==="function")refreshTargetCeilings();}
  // flag the rail's Projects+Prices segment when credits mode is selected but no prices exist yet
  if(typeof setPriceNeeded==="function")setPriceNeeded(res.mode==="credits"&&![...RAWS,...PRODUCTS].some(it=>toDec0(S.sellPrice[it]).gt(DEC_ZERO)));
  if(res.empty){el.innerHTML=`<div class="notice info">Select one or more outputs on the left to optimize — or switch to <b>Max credits/hr</b> mode to find the best dedicated sell plan.</div>`;stat.textContent="Plan updated. No outputs selected.";return;}
  let html="";
  if(res.mode==="credits"){
    html+=`<div class="notice info"><b>Credits mode.</b> Ignores the output checkboxes &amp; priorities. It compares one dedicated whole-factory plan for each item with a <b>Sell price</b>, then shows the highest-earning plan found.</div>`;
  }
  if(res.issues.length){
    html+=`<div class="notice warn"><b>Missing data:</b><br>${res.issues.join("<br>")}</div>`;
  }
  // All the outputs share one floor, so a single unmakeable one drags every other to zero. Without
  // this the result is an all-zero plan and a generic "try adding a line", with no hint that one
  // checkbox caused it. Only share mode measures each item's ceiling, so only it can name the item.
  if(Array.isArray(res.blocked)&&res.blocked.length){
    html+=`<div class="notice warn"><b>${res.blocked.join(" and ")} cannot be made at all</b> with the current lines and data —
      no compression level any line can reach produces ${res.blocked.length>1?"them":"it"}. Every output shares one floor, so
      leaving ${res.blocked.length>1?"them":"it"} checked holds all the others at zero. Uncheck ${res.blocked.length>1?"them":"it"}, or fix the missing costs.</div>`;
  }
  const anyOut=res.mode==="credits"?toDec0(res.credits).gt(1e-6):Object.values(res.out).some(v=>v>1e-6);
  if(!anyOut&&!res.issues.length&&(res.mode!=="credits"||res.searchExhaustive===true)){
    html+=`<div class="notice warn">No sustainable plan found with the current lines and data. Try raising a line's max compression, adding a line, entering duplication %, or check your input costs${res.mode==="credits"?" and sell prices":""}.</div>`;
  }
  if(res.mode==="credits"&&res.allCandidatesEvaluated===false){
    const skipped=(res.ranking||[]).filter(candidate=>!candidate.evaluated).map(candidate=>candidate.item);
    html+=`<div class="notice warn" style="font-size:11.5px"><b>Comparison incomplete.</b> The time limit was reached before a baseline could be completed for <b>${skipped.join(", ")||"one or more priced items"}</b>. Any winner shown is only the best among evaluated items.</div>`;
  }else if(res.mode==="credits"&&res.searchExhaustive===false){
    html+=`<div class="notice info" style="font-size:11.5px"><b>Best found, not proven best.</b> Every priced item received a bounded baseline, but deeper search reached its limit for at least one candidate.</div>`;
  }else if(res.mode!=="credits"&&res.capped){
    html+=optimalityNotice(res);
  }else if(res.mode!=="credits"&&res.feasible){
    // An exhausted search is optimal on its own terms; a loose LP ceiling above it says nothing.
    html+=`<div class="notice good" style="font-size:11.5px"><b>Proven optimal.</b> The search finished — no better plan exists for these lines and costs.</div>`;
  }
  if(res.usesMargin){
    html+=`<div class="notice info"><b>May-work plan.</b> This uses your ${fmt(res.tol*100,1)}% margin — one or more inputs runs a small paper shortfall (see balance below). Likely fine if it's inside your game's rounding/duplication slack, but not strictly guaranteed.</div>`;
  }
  // metric cards
  html+=`<div class="metrics">`;
  if(res.mode==="credits"){
    html+=`<div class="metric"><div class="l">Best — sell ${res.bestItem?minedDisplayName(res.bestItem):"—"}</div>
      <div class="v">${disp(res.credits||0)}</div><div class="u">credits per hour</div></div>`;
  }else{
    // Every output shares one weighted floor, so exactly one of them is holding the rest down.
    // Naming it turns "everything came out low" into a decision: that is the item worth spending
    // the next line or compression upgrade on. The others report how much room they have above it.
    res.targets.forEach(t=>{
      const isBinding=res.binding===t;
      const slack=res.slack&&res.slack[t];
      const share=res.shareOfMax&&res.shareOfMax[t];
      let tag="";
      if(isBinding)tag=`<div class="binding-tag">setting the pace</div>`;
      else if(slack>0.005)tag=`<div class="slack-tag">${fmt(slack*100,0)}% spare</div>`;
      if(share>0)tag+=`<div class="slack-tag">${fmt(share*100,0)}% of its max</div>`;
      html+=`<div class="metric${isBinding?" binding":""}"><div class="l">${t}</div>
        <div class="v">${disp(res.out[t]||0)}</div><div class="u">per hour</div>${tag}</div>`;
    });
  }
  html+=`</div>`;
  // credits ranking — every sellable item compared head to head
  if(res.mode==="credits"&&res.ranking&&res.ranking.length){
    html+=`<div class="subhead">If you dedicate the factory to…</div>
      <table><thead><tr><th>Item</th><th class="num">Output /hr</th><th class="num">Sell price</th><th class="num">Credits /hr</th></tr></thead><tbody>`;
    res.ranking.forEach((c,i)=>{
      const win=i===0&&c.evaluated!==false&&toDec0(c.credits).gt(1e-9);
      const note=c.evaluated===false?'<span style="color:var(--ink3);font-size:10.5px"> — not evaluated</span>':
        (c.feasible?(c.usesMargin?'<span style="color:var(--amber);font-size:10.5px"> — may-work</span>':""):
          `<span style="color:var(--ink3);font-size:10.5px"> — ${c.capped?"no plan found in bounded search":"no sustainable plan"}</span>`);
      const outCell=c.evaluated===false?"—":disp(c.out),creditsCell=c.evaluated===false?"—":disp(c.credits);
      html+=`<tr${win?' style="background:rgba(210,129,58,.10)"':''}>
        <td>${win?'★ ':''}${minedDisplayName(c.item)}${note}</td>
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
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ghost" id="btnExportCode" title="Get the game loadout code for this line assignment">Game code</button>
      <button class="btn ghost" id="btnCopyManual" title="Copy this plan into Manual mode so you can fine-tune it by hand">Copy to Manual</button></div>`:""}
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
    // Speed and dupe are line settings the Crafter lines card already shows (including
    // the projected speed at max turbo), so the Cap cell carries the compression only.
    html+=`<tr${mined?' style="background:rgba(63,182,160,.05)"':''}><td class="mono">#${p.line}</td><td class="mono">${compressionLabel(p.max)}</td>
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
      else rows.push({res:"Bits",prod:0,forgie:supplyRate(forgieHr("Bits")),cons:ppBits,preProd:true});
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
    const fBits=supplyRate(forgieHr("Bits")), net=ppBits-fBits;
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
  MINED_RESOURCES.forEach(resource=>{if(!minedBudgetHr(resource).gt(DEC_ZERO)||minedUses.some(use=>use.resource===resource))return;
    const crafts=Object.keys(MINED_CRAFTS).filter(item=>MINED_CRAFTS[item].resource===resource).join(" / ");
    html+=`<div class="notice info" style="font-size:11.5px">${resource} income is set, but this plan puts <b>0</b> lines on <b>${crafts}</b>, so it uses none of that mined income.</div>`;
  });
  el.innerHTML=html;
  stat.textContent=metadata&&metadata.cached
    ?`Plan updated instantly from a ${res.mode==="credits"?"Max Credits":"Max Items"} solve cached less than 24 hours ago.`
    :res.mode==="credits"&&res.allCandidatesEvaluated===false
    ?"Comparison stopped at the time limit; some priced items were not evaluated."
    :"Plan updated. Solved in "+res.ms.toFixed(1)+" ms";
}
function invName(resIndex,idx){for(const k in resIndex)if(resIndex[k]===idx)return k;return "";}
