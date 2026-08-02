"use strict";
/* ---------- EVENTS ---------- */
let renderT;
function doSolve(){renderT=null;save();renderResults();}
// Debounce the (potentially heavy) re-solve: while typing, wait until the user pauses;
// leaving a field, pressing Enter, or making a selection flushes it immediately. State is
// still captured on every keystroke (handlers update S synchronously), so nothing is lost.
function scheduleSolve(){clearTimeout(renderT);renderT=setTimeout(doSolve,500);}
function flushSolve(){if(renderT){clearTimeout(renderT);doSolve();}}
document.addEventListener("change",e=>{if(e.target&&e.target.matches&&e.target.matches("input,select"))flushSolve();});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target&&e.target.matches&&e.target.matches("input"))flushSolve();});

// Crafter-line edits can drive a heavy re-solve (credits mode runs ~1s+), and people
// typically batch many speed/turbo changes before checking output. So rather than
// auto-solving on every keystroke, those edits just persist (save) and mark the shown
// results stale; the user clicks Resimulate — or presses Enter in a line field — to
// recompute once. Any actual repaint (resimulate, mode switch, …) clears the stale UI.
function showStale(on){
  const bar=document.getElementById("staleBar");if(bar)bar.hidden=!on;
  const res=document.getElementById("results");if(res)res.classList.toggle("stale",on);
}
function clearStaleUI(){showStale(false);}
function markStale(){clearTimeout(renderT);renderT=null;save();showStale(true);}
function resimulate(){doSolve();}   // doSolve→renderResults repaints and clears the stale UI
document.getElementById("btnResim").addEventListener("click",resimulate);

document.getElementById("lines").addEventListener("change",e=>{
  const li=e.target.dataset.line;
  if(li!==undefined){mutateState(st=>{st.lines[+li].max=+e.target.value;});markStale();}
});
document.getElementById("lines").addEventListener("input",e=>{
  const si=e.target.dataset.spx, ti=e.target.dataset.turbo;
  if(si!==undefined){mutateState(st=>{st.lines[+si].spx=num(e.target.value)||1;});refreshLineNotes();markStale();}
  if(ti!==undefined){mutateState(st=>{st.lines[+ti].turbo=Math.max(0,num(e.target.value)||0);});refreshLineNotes();markStale();}
});
document.getElementById("lines").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();resimulate();}
});
document.getElementById("lines").addEventListener("click",e=>{
  const d=e.target.dataset.del;
  if(d!==undefined&&S.lines.length>1){mutateState(st=>{st.lines.splice(+d,1);st.manual.splice(+d,1);syncManual(st);});renderLines();markStale();}
});
document.getElementById("btnAddLine").addEventListener("click",()=>{
  mutateState(st=>{st.lines.push({max:512,spx:1,turbo:0});syncManual(st);});renderLines();markStale();
});

document.getElementById("margin").addEventListener("input",e=>{
  mutateState(st=>{st.margin=num(e.target.value)||0;});
  document.getElementById("marginv").textContent=fmt(S.margin,1)+"%";
  scheduleSolve();
});

document.getElementById("maxTurbo").addEventListener("input",e=>{
  mutateState(st=>{st.maxTurbo=Math.max(0,num(e.target.value)||0);});
  refreshLineNotes();markStale();
});
document.getElementById("dupe").addEventListener("input",e=>{
  mutateState(st=>{st.dupe=Math.max(0,num(e.target.value)||0);});
  markStale();
});

document.getElementById("targets").addEventListener("change",e=>{
  const tg=e.target.dataset.tg;
  if(tg){mutateState(st=>{st.targets[tg].on=e.target.checked;});renderTargets();scheduleSolve();}
});
document.getElementById("targets").addEventListener("input",e=>{
  const w=e.target.dataset.w;
  if(w){mutateState(st=>{st.targets[w].w=+e.target.value;});e.target.parentElement.querySelector(".pv").textContent=e.target.value;scheduleSolve();}
});

document.getElementById("recipes").addEventListener("input",e=>{
  const d=e.target.dataset;if(!d.res)return;
  const v=num(e.target.value);
  mutateState(st=>{
    if(d.fld==="baseT")st.baseTime[d.res]=(v==null||v<=0)?1:v;
    else if(d.fld==="cost")st.prodCost[d.res][d.in][+d.lv]=v;
  });
  scheduleSolve();
});

/* export / import / reset */
const stateRecovery=document.getElementById("stateRecovery");
const stateRecoveryReason=document.getElementById("stateRecoveryReason");
const stateRecoveryDownload=document.getElementById("stateRecoveryDownload");
let _recoveryDownload=null;
function showStateRecovery(raw,reason,file){
  if(typeof raw==="string")quarantineRejectedState(raw,reason);
  _recoveryDownload=file||((typeof raw==="string")?new Blob([raw],{type:"application/json"}):null);
  if(stateRecoveryDownload)stateRecoveryDownload.disabled=!_recoveryDownload;
  if(stateRecoveryReason)stateRecoveryReason.textContent=String(reason||"The planner started with safe defaults. Your rejected save was kept unchanged.");
  if(stateRecovery){stateRecovery.hidden=false;stateRecovery.focus();}
}
function dismissStateRecovery(restoreFocus=true){
  if(stateRecovery)stateRecovery.hidden=true;
  if(restoreFocus){const button=document.getElementById("btnImport");if(button)button.focus();}
}
stateRecoveryDownload.addEventListener("click",()=>{
  if(!_recoveryDownload)return;
  const url=URL.createObjectURL(_recoveryDownload),a=document.createElement("a");
  a.href=url;a.download="forge-planner-rejected-save.json";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
});
document.getElementById("stateRecoveryImport").addEventListener("click",()=>document.getElementById("fileImport").click());
document.getElementById("stateRecoveryDismiss").addEventListener("click",()=>dismissStateRecovery(true));

document.getElementById("btnExport").addEventListener("click",()=>{
  const result=validateAndMigrate(S);
  if(!result.ok){showStateRecovery(null,"The current build contains a value that cannot be exported safely: "+result.errors.join("; "));return;}
  const blob=new Blob([JSON.stringify(result.state,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download="forge-build.json";a.click();URL.revokeObjectURL(a.href);
});
document.getElementById("btnImport").addEventListener("click",()=>document.getElementById("fileImport").click());
document.getElementById("fileImport").addEventListener("change",e=>{
  const f=e.target.files[0];if(!f)return;
  e.target.value="";
  if(f.size>STATE_LIMITS.maxBytes){
    showStateRecovery(null,"That import is too large to open safely. Your current build was not changed.",f);
    return;
  }
  const r=new FileReader();
  r.onload=()=>{
    const raw=String(r.result==null?"":r.result);let candidate;
    try{candidate=JSON.parse(raw);}catch(error){showStateRecovery(raw,"Could not read that file because it is not valid JSON.",f);return;}
    solveService.cancel("Import is replacing accepted state");
    const result=applyImportedState(candidate,renderAll,()=>solveService.cancel("Import rollback is restoring accepted state"));
    if(!result.ok){showStateRecovery(raw,result.errors.join("; "),f);return;}
    dismissStateRecovery(false);flashSaved();
  };
  r.onerror=()=>showStateRecovery(null,"Could not read that file. Your current build was not changed.",f);
  r.readAsText(f);
});
document.getElementById("btnReset").addEventListener("click",()=>{
  if(confirm("Reset everything to defaults? This clears your entered stats."))
    {solveService.cancel("Reset is replacing accepted state");commitState(defaults());renderAll();save();dismissStateRecovery(false);}
});

/* ---------- mode switch ---------- */
function renderModeSwitch(){
  document.querySelectorAll("#modesw button").forEach(b=>{
    const selected=b.dataset.mode===(S.mode||"items");
    b.classList.toggle("on",selected);
    b.setAttribute("aria-pressed",selected?"true":"false");
  });
}
document.getElementById("modesw").addEventListener("click",e=>{
  const m=e.target.dataset.mode;if(!m||m===S.mode)return;
  mutateState(st=>{st.mode=m;});renderModeSwitch();save();renderResults();
});

/* ---------- sell prices ---------- */
function itemTypeTag(it){
  const kind=KIND[it]==="raw"?["raw","raw"]:KIND[it]==="fin"?["fin","assembly"]:["pr","craft"];
  return domElement("span","ty "+kind[0],kind[1]);
}
function renderItemValueRows(box,textMap,numberMap,dataName,placeholder,inputMode){
  const nodes=[];
  const addGroup=(label,items,first)=>{
    nodes.push(domElement("div","price-grp"+(first?" first":""),label));
    items.forEach(it=>{
      const row=domElement("div","price-row");
      const name=domElement("div","pnm");
      name.append(itemTypeTag(it),document.createTextNode(it));
      const value=numberMap[it];
      const text=textMap[it]!=null?textMap[it]:(value!=null?formatGameNum(value,4):"");
      const accessibleName=dataName==="price"?`${it} sell price per unit`
        :dataName==="forgie"?`${it} Lil' Forgie production per hour`
        :`${it} current inventory`;
      row.append(name,domTextInput(dataName,it,text,{placeholder,inputMode,accessibleName}));
      nodes.push(row);
    });
  };
  addGroup("Finished & crafted",PRODUCTS,true);
  addGroup("Raw materials",RAWS,false);
  box.replaceChildren(...nodes);
}
function renderPrices(){
  const box=document.getElementById("priceRows");
  renderItemValueRows(box,S.priceText,S.sellPrice,"price","—","");
}
const priceDialog=dialogController.register({root:document.getElementById("priceModal"),panel:document.querySelector("#priceModal .modal"),opener:document.getElementById("btnPrices"),initialFocus:()=>document.querySelector("#priceRows input"),onOpen:renderPrices});
function openPrices(invoker){priceDialog.open(invoker);}
function closePrices(){priceDialog.close();}
document.getElementById("priceClear").addEventListener("click",()=>{
  if(!confirm("Clear all sell prices?"))return;
  mutateState(st=>{[...RAWS,...PRODUCTS].forEach(it=>{st.sellPrice[it]=null;st.priceText[it]="";});});
  renderPrices();scheduleSolve();
});
document.getElementById("priceRows").addEventListener("input",e=>{
  const it=e.target.dataset.price;if(!it)return;
  const raw=e.target.value;
  const v=parseGameNum(raw);
  mutateState(st=>{st.priceText[it]=raw;st.sellPrice[it]=v;});
  const prev=document.querySelector(`[data-prev="${it}"]`);
  if(prev)prev.textContent=v!=null?"= "+fmt(v):(raw.trim()?"unrecognized":"");
  scheduleSolve();
});

/* ---------- Lil' Forgie supply modal ---------- */
function renderForgie(){
  const box=document.getElementById("forgieRows");
  renderItemValueRows(box,S.forgieText,S.forgie,"forgie","—","decimal");
}
const forgieDialog=dialogController.register({root:document.getElementById("forgieModal"),panel:document.querySelector("#forgieModal .modal"),opener:document.getElementById("btnForgie"),initialFocus:()=>document.querySelector("#forgieRows input"),onOpen:renderForgie});
function openForgie(invoker){forgieDialog.open(invoker);}
function closeForgie(){forgieDialog.close();}
document.getElementById("forgieClear").addEventListener("click",()=>{
  if(!confirm("Clear all Lil' Forgie supply rates?"))return;
  mutateState(st=>{[...RAWS,...PRODUCTS].forEach(it=>{st.forgie[it]=null;st.forgieText[it]="";});});
  renderForgie();scheduleSolve();
});
document.getElementById("forgieRows").addEventListener("input",e=>{
  const it=e.target.dataset.forgie;if(!it)return;
  const raw=e.target.value;
  mutateState(st=>{st.forgieText[it]=raw;st.forgie[it]=parseGameNum(raw);});
  scheduleSolve();
});

/* ---------- mined resources modal ---------- */
const btnMined=document.getElementById("btnMined");
const minedDialog=dialogController.register({root:document.getElementById("minedModal"),panel:document.querySelector("#minedModal .modal"),opener:btnMined,initialFocus:()=>document.getElementById("minedVespium"),onOpen:renderMinedResources});
function openMined(invoker){minedDialog.open(invoker);}
function closeMined(){minedDialog.close();}
document.getElementById("minedModal").addEventListener("input",e=>{
  const resource=e.target.dataset.minedIncome;if(!resource)return;
  mutateState(()=>{setMinedIncome(resource,e.target.value);});
  renderMinedResources();scheduleSolve();
});

/* ---------- settings modal (max solve time) ---------- */
const solveBudgetInput=document.getElementById("solveBudget");
const solveBudgetVal=document.getElementById("solveBudgetVal");
function fmtBudget(ms){return (ms/1000).toFixed(ms<1000?1:(ms%1000?1:0))+" s";}
function syncBudgetUI(){const ms=Math.max(200,Math.min(60000,num(S.solveBudget)||2000));
  if(solveBudgetInput)solveBudgetInput.value=(ms/1000);if(solveBudgetVal)solveBudgetVal.textContent=fmtBudget(ms);}
const settingsDialog=dialogController.register({root:document.getElementById("settingsModal"),panel:document.querySelector("#settingsModal .modal"),opener:document.getElementById("btnSettings"),initialFocus:solveBudgetInput,onOpen:syncBudgetUI});
function openSettings(invoker){settingsDialog.open(invoker);}
function closeSettings(){settingsDialog.close();}
if(solveBudgetInput)solveBudgetInput.addEventListener("input",()=>{
  mutateState(st=>{st.solveBudget=Math.round(Math.max(0.2,Math.min(15,Number(solveBudgetInput.value)||2))*1000);});
  if(solveBudgetVal)solveBudgetVal.textContent=fmtBudget(S.solveBudget);save();});

/* ---------- collapsible crafting-data panel ---------- */
function setRecipesOpen(open){
  document.getElementById("recipeBody").hidden=!open;
  document.getElementById("recipeToggle").setAttribute("aria-expanded",open?"true":"false");
}
document.getElementById("recipeToggle").addEventListener("click",()=>setRecipesOpen(document.getElementById("recipeBody").hidden));
document.getElementById("btnRecipes").addEventListener("click",()=>{setRecipesOpen(true);document.querySelector(".rsec").scrollIntoView({behavior:"smooth",block:"start"});});

/* ---------- "add sell prices" attention nudge ---------- */
const pricePoke=document.createElement("div");
pricePoke.className="poke";pricePoke.hidden=true;pricePoke.textContent="↑ Enter your sell prices";
document.querySelector(".tools").appendChild(pricePoke);
function positionPoke(){
  const b=document.getElementById("btnPrices");
  pricePoke.style.left=(b.offsetLeft+b.offsetWidth/2)+"px";
  pricePoke.style.top=(b.offsetTop+b.offsetHeight+9)+"px";
}
function setPricePoke(on){
  document.getElementById("btnPrices").classList.toggle("poke-on",on);
  if(on){positionPoke();pricePoke.hidden=false;}else pricePoke.hidden=true;
}
window.addEventListener("resize",()=>{if(!pricePoke.hidden)positionPoke();});

function initCalib(){
  const it=document.getElementById("cbItem"), cp=document.getElementById("cbComp");
  if(it.options.length===0){
    [...RAWS,...PRODUCTS].forEach(n=>it.add(new Option(n,n)));
    LEVELS.forEach(L=>cp.add(new Option(compressionLabel(L)+" (level "+Math.round(Math.log2(L))+")",L)));
    it.value="Ingots"; cp.value="512";
  }
  const out=document.getElementById("cbOut"), apply=document.getElementById("cbApply");
  let computed=null;
  function recalc(){
    const item=it.value, L=+cp.value, spd=num(document.getElementById("cbSpeed").value), sec=num(document.getElementById("cbSec").value);
    const cur=num(S.baseTime[item])||1, mult=Math.pow(1.5,Math.log2(L));
    const predict=cur*mult/(spd||1);
    if(spd>0&&sec>0){
      computed=sec*spd/mult;
      out.innerHTML=`base time = ${fmt(sec,2)} × ${fmt(spd,2)} ÷ ${fmt(mult,2)} = <b style="color:var(--amber)">${fmt(computed,2)}s</b><br>`+
        `currently set for ${item}: ${fmt(cur,2)}s &nbsp;·&nbsp; which predicts a ${fmt(predict,2)}s craft at these settings`+
        (Math.abs(predict-sec)/sec>0.15?` <span class="calib-warning">— off by ${fmt(Math.abs(predict-sec)/sec*100,0)}%, worth setting</span>`:` <span style="color:#6c9">— matches, base looks right</span>`);
      apply.disabled=false;
    }else{
      computed=null;apply.disabled=true;
      out.innerHTML=spd>0?`current ${item} base (${fmt(cur,2)}s) predicts a <b>${fmt(predict,2)}s</b> craft at ${compressionLabel(L)} / ×${fmt(spd,2)}. Enter the real craft seconds to compare.`:`Enter that unit's speed × and a craft time to compute or verify.`;
    }
  }
  ["cbItem","cbComp","cbSpeed","cbSec"].forEach(id=>document.getElementById(id).addEventListener("input",recalc));
  apply.addEventListener("click",()=>{
    if(computed==null)return;
    mutateState(st=>{st.baseTime[it.value]=computed;}); save(); renderRecipes(); renderResults(); recalc();
  });
  recalc();
}
function renderAll(){
  renderModeSwitch();
  renderLines();renderTargets();renderMinedResources();renderRecipes();renderResults();
  document.getElementById("margin").value=S.margin||0;
  document.getElementById("marginv").textContent=fmt(S.margin||0,1)+"%";
  document.getElementById("maxTurbo").value=S.maxTurbo||0;
  document.getElementById("dupe").value=S.dupe||0;
}
const initialState=initializeState(renderAll);
initCalib();
document.getElementById("saveind").textContent="auto-saves locally";
if(initialState.recovery)showStateRecovery(initialState.recovery.raw,initialState.recovery.reason);
function costRow(pi,li,ci,c){
  const projectName=(S.projects[pi]&&S.projects[pi].name)||`Project ${pi+1}`;
  const opts=ALLITEMS.map(it=>`<option value="${it}" ${it===c.item?"selected":""}>${it}</option>`).join("");
  const txt=(c.qty!=null&&isFinite(c.qty))?formatGameNum(c.qty,4):"";
  return `<div class="cost-row">
    <select data-citem="${pi}_${li}_${ci}" aria-label="${htmlAttribute(projectName)} level ${li+1} item ${ci+1}">${opts}</select>
    <input type="text" placeholder="qty" value="${txt}" data-cqty="${pi}_${li}_${ci}" aria-label="${htmlAttribute(projectName)} level ${li+1} ${htmlAttribute(c.item)} quantity">
    <button class="iconbtn" data-cdel="${pi}_${li}_${ci}" title="Remove item" aria-label="Remove ${htmlAttribute(c.item)} from ${htmlAttribute(projectName)} level ${li+1}">×</button>
  </div>`;
}
// Read-only cost lines for one level of a catalog project (non-zero costs only).
function catLevelView(L){
  const parts=(L.costs||[]).filter(c=>c.qty).map(c=>`${htmlText(c.item)} <b class="mono">${formatGameNum(c.qty,2)}</b>`);
  return parts.length?parts.join(' <span style="color:var(--ink3)">·</span> '):'<span style="color:var(--ink3)">free</span>';
}
// Compact +1/−1 level-completion stepper for a shopping-list card (issue #87 item 3). Uses the same
// projSpan/projDone clamps as the tracker and step modal, so completion stays consistent everywhere.
function projStepper(p,pi){
  const {span}=projSpan(p),done=projDone(p);
  return `<span class="lvl-step" title="Levels completed — increment as you finish them">
    <button class="iconbtn" data-psdec="${pi}" ${done<=0?"disabled":""} title="Mark one fewer level done" aria-label="Mark one fewer ${htmlAttribute(p.name)} level complete">−</button>
    <span class="mono proj-mini" title="levels completed">${done}/${span}</span>
    <button class="iconbtn" data-psinc="${pi}" ${done>=span?"disabled":""} title="Mark one more level done" aria-label="Mark one more ${htmlAttribute(p.name)} level complete">+</button>
  </span>`;
}
// Compact card for a catalog-sourced project: name is a fixed label, costs are
// read-only, user only controls on/off, level range, "1st", and remove. Reuses
// the same data-* hooks as the editable card so existing handlers apply.
function compactProjCard(p,pi){
  const lv=p.levels||[];
  const view=lv.map((L,li)=>`<div class="cat-lvl"><span class="cat-lvl-n">Lv ${li+1}</span><span>${catLevelView(L)}</span></div>`).join("");
  const desc=p.description?`<span class="cat-card-desc">${htmlText(p.description)}</span>`:"";
  const single=lv.length<=1;
  const range=single
    ? `<span class="proj-lvls one">1 level</span>`
    : `<span class="proj-lvls">lv <input type="number" min="1" max="${lv.length}" step="1" data-pfrom="${pi}" value="${p.from||1}" aria-label="${htmlAttribute(p.name)} starting level"> → <input type="number" min="1" max="${lv.length}" step="1" data-pto="${pi}" value="${p.to||lv.length}" aria-label="${htmlAttribute(p.name)} ending level"></span>`;
  const bodyId=`projectBody${pi}`;
  const disclosureLabel=`${p._open?"Hide":"Show"} level costs for ${htmlAttribute(p.name)}`;
  return `<div class="proj cat-card ${p._open?"open":""}" data-pi="${pi}">
    <div class="proj-h">
      <button type="button" class="pchev" data-ptoggle="${pi}" title="${disclosureLabel}" aria-label="${disclosureLabel}" aria-expanded="${p._open?"true":"false"}" aria-controls="${bodyId}">▸</button>
      <input type="checkbox" data-pon="${pi}" ${p.on?"checked":""} title="Include in schedule" aria-label="Include ${htmlAttribute(p.name)} in schedule">
      <span class="pname-static">${htmlText(p.name)}${desc}</span>
      <div class="proj-tools">
        <label class="proj-prio" title="Manual order — type 1, 2, 3… to set the sequence; blank lets the planner pick. Material unlocks are always ordered first."><input type="number" class="pprio" min="1" step="1" inputmode="numeric" data-pprio="${pi}" value="${p.prio!=null?p.prio:""}" placeholder="–" aria-label="${htmlAttribute(p.name)} schedule order">order</label>
        ${range}
        ${projStepper(p,pi)}
        <button class="iconbtn" data-pdel="${pi}" title="Remove from list" aria-label="Remove ${htmlAttribute(p.name)} from shopping list">×</button>
      </div>
    </div>
    <div class="proj-b" id="${bodyId}"><div class="cat-lvls">${view}</div></div>
  </div>`;
}
function projCard(p,pi){
  if(p.catId)return compactProjCard(p,pi);
  const lv=p.levels||[];
  const lvlHtml=lv.map((L,li)=>{
    const rows=(L.costs||[]).map((c,ci)=>costRow(pi,li,ci,c)).join("");
    return `<div class="lvl-card">
      <div class="lvl-h"><span>Level ${li+1}</span><button type="button" class="lvl-del" data-pdellvl="${pi}" data-li="${li}" title="Delete level" aria-label="Delete ${htmlAttribute(p.name)} level ${li+1}">✕ remove</button></div>
      ${rows||'<div class="proj-mini" style="margin-bottom:5px">No items — add one.</div>'}
      <button class="btn ghost proj-add-lvl" data-paddcost="${pi}" data-li="${li}">+ item</button>
    </div>`;
  }).join("");
  const bodyId=`projectBody${pi}`;
  const disclosureLabel=`${p._open?"Hide":"Show"} level costs for ${htmlAttribute(p.name)}`;
  return `<div class="proj ${p._open?"open":""}" data-pi="${pi}">
    <div class="proj-h">
      <button type="button" class="pchev" data-ptoggle="${pi}" aria-label="${disclosureLabel}" aria-expanded="${p._open?"true":"false"}" aria-controls="${bodyId}">▸</button>
      <input type="checkbox" data-pon="${pi}" ${p.on?"checked":""} title="Include in schedule" aria-label="Include ${htmlAttribute(p.name)} in schedule">
      <input type="text" class="pname" data-pname="${pi}" value="${htmlAttribute(p.name)}" placeholder="Project name" aria-label="Project name">
      <div class="proj-tools">
        <label class="proj-prio" title="Manual order — type 1, 2, 3… to set the sequence; blank lets the planner pick. Material unlocks are always ordered first."><input type="number" class="pprio" min="1" step="1" inputmode="numeric" data-pprio="${pi}" value="${p.prio!=null?p.prio:""}" placeholder="–" aria-label="${htmlAttribute(p.name)} schedule order">order</label>
        <span class="proj-lvls">lv <input type="number" min="1" step="1" data-pfrom="${pi}" value="${p.from||1}" aria-label="${htmlAttribute(p.name)} starting level"> → <input type="number" min="1" step="1" data-pto="${pi}" value="${p.to||lv.length||1}" aria-label="${htmlAttribute(p.name)} ending level"></span>
        ${projStepper(p,pi)}
        <button class="iconbtn" data-pdup="${pi}" title="Duplicate" aria-label="Duplicate ${htmlAttribute(p.name)}" style="font-size:13px">⧉</button>
        <button class="iconbtn" data-pdel="${pi}" title="Delete project" aria-label="Delete ${htmlAttribute(p.name)}">×</button>
      </div>
    </div>
    <div class="proj-b" id="${bodyId}">
      ${lvlHtml}
      <button class="btn ghost proj-add-lvl" data-paddlvl="${pi}" style="margin-top:2px" aria-label="Add level to ${htmlAttribute(p.name)}">+ level</button>
    </div>
  </div>`;
}
function renderInv(){
  const box=document.getElementById("invRows");
  renderItemValueRows(box,S.inventoryText,S.inventory,"inv","0","");
}
function renderProjects(){
  const box=document.getElementById("projList");
  box.innerHTML=S.projects.length?S.projects.map((p,pi)=>projCard(p,pi)).join("")
    :`<div class="proj-mini" style="padding:6px 2px">No projects yet — add one to start building a schedule.</div>`;
  const st=document.getElementById("projSeqToggle");if(st)st.checked=S.projectSeq!==false;
  const gt=document.getElementById("projGateToggle");if(gt){gt.checked=S.projectGate===false;gt.disabled=S.projectSeq!==false;gt.closest(".seq-toggle").classList.toggle("disabled",gt.disabled);}
  renderInv();
  if(typeof renderCatalog==="function")renderCatalog();
}
document.getElementById("projSeqToggle").addEventListener("change",e=>{mutateState(st=>{st.projectSeq=e.target.checked;});renderProjects();save();scheduleSolve();});
document.getElementById("projGateToggle").addEventListener("change",e=>{mutateState(st=>{st.projectGate=!e.target.checked;});save();scheduleSolve();});

/* ---------- project catalog (static, read-only source list) ---------- */
const CATALOG=(typeof PROJECT_CATALOG!=="undefined"&&Array.isArray(PROJECT_CATALOG))?PROJECT_CATALOG:[];
let catQuery="";
const projectHasCat=catId=>(S.projects||[]).some(p=>p.catId===catId);
function addCatalogProject(catId){
  const src=CATALOG.find(c=>c.catId===catId);
  if(!src||projectHasCat(catId))return;
  mutateState(st=>{st.projects.push({
      id:newId(),catId:src.catId,name:src.name,description:src.description||"",
      on:true,prio:null,from:1,to:src.levels.length||1,done:0,
      levels:JSON.parse(JSON.stringify(src.levels)),_open:false
    });
  });
  renderProjects();renderCatalog();save();scheduleSolve();
}
function renderCatalog(){
  const list=document.getElementById("catList");if(!list)return;
  const q=catQuery.trim().toLowerCase();
  const items=CATALOG.filter(c=>!q||c.name.toLowerCase().includes(q)||(c.description||"").toLowerCase().includes(q));
  const added=CATALOG.filter(c=>projectHasCat(c.catId)).length;
  const cc=document.getElementById("catCount");if(cc)cc.textContent=`${added}/${CATALOG.length} added`;
  list.innerHTML=items.length?items.map(c=>{
    const has=projectHasCat(c.catId);
    const lvls=c.levels.length;
    const meta=`${lvls} level${lvls===1?"":"s"}${c.description?" · "+htmlText(c.description):""}`;
    return `<div class="cat-row${has?" added":""}">
      <div class="cat-row-info"><span class="cat-row-name">${htmlText(c.name)}</span><span class="cat-row-meta">${meta}</span></div>
      <button class="btn ${has?"ghost":"primary"} cat-add" data-cat-add="${htmlAttribute(c.catId)}" aria-label="${has?"Added":"Add"} ${htmlAttribute(c.name)}${has?"":" to shopping list"}" ${has?"disabled":""}>${has?"Added":"Add"}</button>
    </div>`;
  }).join(""):`<div class="proj-mini" style="padding:6px 2px">No matching projects.</div>`;
}
const catListEl=document.getElementById("catList");
if(catListEl)catListEl.addEventListener("click",e=>{
  const btn=e.target.closest("[data-cat-add]");if(!btn||btn.disabled)return;
  addCatalogProject(btn.getAttribute("data-cat-add"));
});
const catSearchEl=document.getElementById("catSearch");
if(catSearchEl)catSearchEl.addEventListener("input",e=>{catQuery=e.target.value;renderCatalog();});

const projectsDialog=dialogController.register({root:document.getElementById("projModal"),panel:document.querySelector("#projModal .modal"),opener:document.getElementById("btnProjects"),initialFocus:()=>document.getElementById("projSeqToggle"),onOpen:()=>{renderProjects();renderCatalog();}});
function openProjects(invoker){projectsDialog.open(invoker);}
function closeProjects(){projectsDialog.close();}
document.getElementById("projAdd").addEventListener("click",()=>{
  mutateState(st=>{st.projects.push({id:newId(),name:"New project",on:true,prio:null,from:1,to:1,done:0,levels:[{costs:[]}],_open:true});});
  renderProjects();save();scheduleSolve();
});
document.getElementById("projClear").addEventListener("click",()=>{
  if(!(S.projects||[]).length)return;
  if(!confirm("Remove all projects from the shopping list? This clears every added catalog project and custom project."))return;
  mutateState(st=>{st.projects=[];});
  renderProjects();save();scheduleSolve();
});
document.getElementById("projInvClear").addEventListener("click",()=>{
  if(!confirm("Clear all inventory amounts?"))return;
  mutateState(st=>{ALLITEMS.forEach(it=>{st.inventory[it]=null;st.inventoryText[it]="";});});
  renderInv();scheduleSolve();
});
document.getElementById("projList").addEventListener("click",e=>{
  const t=e.target,g=a=>t.getAttribute(a);
  let v;
  if((v=g("data-ptoggle"))!=null){mutateState(st=>{st.projects[+v]._open=!st.projects[+v]._open;});renderProjects();const disclosure=document.querySelector(`[data-ptoggle="${v}"]`);if(disclosure)disclosure.focus();return;}
  if((v=g("data-pdel"))!=null){if(confirm("Delete this project?")){mutateState(st=>{st.projects.splice(+v,1);});renderProjects();save();scheduleSolve();}return;}
  if((v=g("data-pdup"))!=null){mutateState(st=>{const c=JSON.parse(JSON.stringify(st.projects[+v]));c.id=newId();c.name=(c.name||"Project")+" copy";c._open=true;st.projects.splice(+v+1,0,c);});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-paddlvl"))!=null){mutateState(st=>{const p=st.projects[+v];p.levels.push({costs:[]});p.to=p.levels.length;});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-pdellvl"))!=null){const pi=+v,li=+g("data-li");mutateState(st=>{const p=st.projects[pi];p.levels.splice(li,1);if(p.levels.length===0)p.levels.push({costs:[]});if(p.to>p.levels.length)p.to=p.levels.length;if(p.from>p.levels.length)p.from=p.levels.length;});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-paddcost"))!=null){const pi=+v,li=+g("data-li");mutateState(st=>{st.projects[pi].levels[li].costs.push({item:PRODUCTS[0],qty:null});});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-cdel"))!=null){const[pi,li,ci]=v.split("_").map(Number);mutateState(st=>{st.projects[pi].levels[li].costs.splice(ci,1);});renderProjects();save();scheduleSolve();return;}
  // +1/−1 level completion on a shopping-list card (issue #87 item 3) — clamped to the from→to span.
  if((v=g("data-psinc"))!=null||(v=g("data-psdec"))!=null){const inc=g("data-psinc")!=null,p=S.projects[+v];if(!p)return;mutateState(()=>{const {span}=projSpan(p);p.done=Math.max(0,Math.min(span,projDone(p)+(inc?1:-1)));});renderProjects();save();scheduleSolve();return;}
});
document.getElementById("projList").addEventListener("input",e=>{
  const t=e.target,g=a=>t.getAttribute(a);let v;
  if((v=g("data-pname"))!=null){
    mutateState(st=>{st.projects[+v].name=t.value;});
    const disclosure=t.closest(".proj").querySelector("[data-ptoggle]");
    if(disclosure){const label=`${S.projects[+v]._open?"Hide":"Show"} level costs for ${t.value.trim()||"untitled project"}`;disclosure.setAttribute("aria-label",label);disclosure.title=label;}
    save();scheduleSolve();return;
  }
  if((v=g("data-pfrom"))!=null){mutateState(st=>{st.projects[+v].from=Math.max(1,Math.floor(num(t.value)||1));});save();scheduleSolve();return;}
  if((v=g("data-pto"))!=null){mutateState(st=>{st.projects[+v].to=Math.max(1,Math.floor(num(t.value)||1));});save();scheduleSolve();return;}
  if((v=g("data-pprio"))!=null){const n=Math.floor(num(t.value));mutateState(st=>{st.projects[+v].prio=(n>=1)?n:null;});save();scheduleSolve();return;}
  if((v=g("data-cqty"))!=null){const[pi,li,ci]=v.split("_").map(Number);mutateState(st=>{st.projects[pi].levels[li].costs[ci].qty=parseGameNum(t.value);});save();scheduleSolve();return;}
});
document.getElementById("projList").addEventListener("change",e=>{
  const t=e.target,g=a=>t.getAttribute(a);let v;
  if((v=g("data-pon"))!=null){mutateState(st=>{st.projects[+v].on=t.checked;});save();scheduleSolve();return;}
  if((v=g("data-citem"))!=null){const[pi,li,ci]=v.split("_").map(Number);mutateState(st=>{st.projects[pi].levels[li].costs[ci].item=t.value;});save();scheduleSolve();return;}
});
document.getElementById("invRows").addEventListener("input",e=>{
  const it=e.target.getAttribute("data-inv");if(!it)return;
  mutateState(st=>{st.inventoryText[it]=e.target.value;st.inventory[it]=parseGameNum(e.target.value);});save();scheduleSolve();
});

/* ---------- Progress tracker modal ---------- */
// Levels completed for a project, clamped to its from→to span (non-destructive).
function projSpan(p){const n=(p.levels||[]).length;const from=Math.max(1,Math.min(n||1,Math.floor(num(p.from)||1)));const to=Math.max(from,Math.min(n,Math.floor(num(p.to)||n)));return {from,to,span:to-from+1};}
function projDone(p){const {span}=projSpan(p);return Math.max(0,Math.min(span,Math.floor(num(p.done)||0)));}
function renderProgress(){
  const list=document.getElementById("progList");
  const sum=document.getElementById("progSummary");
  if(!list||!sum)return;
  const active=(S.projects||[]).filter(p=>p.on&&(p.levels||[]).length);
  if(!active.length){
    sum.innerHTML="";
    list.innerHTML=`<div class="notice info">No active projects. Open <b>Shopping list</b>, add or tick on a project, then track its level progress here.</div>`;
    return;
  }
  let totalLv=0,doneLv=0;
  active.forEach(p=>{const {span}=projSpan(p);totalLv+=span;doneLv+=projDone(p);});
  const res=optimizeProjectTop();
  const remLv=totalLv-doneLv;
  const pct=totalLv?Math.round(doneLv/totalLv*100):0;
  const etaTxt=(res&&!res.empty&&remLv>0)?fmtDuration(res.eta):(remLv>0?"—":"all done 🎉");
  sum.innerHTML=`
    <div class="prog-bar-wrap"><div class="prog-bar" style="width:${pct}%"></div></div>
    <div class="prog-metrics">
      <div class="prog-metric"><div class="pm-v">${doneLv}/${totalLv}</div><div class="pm-l">levels done</div></div>
      <div class="prog-metric"><div class="pm-v">${remLv}</div><div class="pm-l">levels left</div></div>
      <div class="prog-metric"><div class="pm-v">${etaTxt}</div><div class="pm-l">time remaining</div></div>
    </div>${res&&!res.empty&&!res.feasible&&remLv>0?`<div class="notice warn" style="margin:10px 0 0;font-size:11.5px">Plan isn't fully sustainable with current lines — see the main panel for blocked items.</div>`:""}`;
  list.innerHTML=active.map(p=>{
    const {from,to,span}=projSpan(p);
    const done=projDone(p);
    const complete=done>=span;
    const chips=[];
    for(let L=from;L<=to;L++){
      const idx=L-from, isDone=idx<done, isNext=idx===done;
      const projectName=p.name||"Project";
      const chipLabel=isDone?`Undo ${projectName} level ${L} completion`:`Mark ${projectName} completed through level ${L}`;
      chips.push(`<button class="prog-lvl${isDone?" done":""}${isNext?" next":""}" data-pid="${htmlAttribute(p.id)}" data-lvl="${L}" aria-label="${htmlAttribute(chipLabel)}" title="${htmlAttribute(chipLabel)}"><span class="pl-box"></span>Lv ${L}</button>`);
    }
    const desc=p.description?`<span class="prog-desc">${htmlText(p.description)}</span>`:"";
    return `<div class="prog-proj${complete?" complete":""}">
      <div class="prog-proj-h">
        <div class="prog-proj-name">${htmlText(p.name||"Project")}${complete?' <span class="pill craft" style="font-size:9px">done</span>':""}${desc}</div>
        <div class="prog-proj-meta"><span class="mono">${done}/${span}</span>${done>0?`<button class="prog-reset" data-preset="${htmlAttribute(p.id)}" aria-label="Reset ${htmlAttribute(p.name||"Project")} progress" title="Reset ${htmlAttribute(p.name||"Project")} progress">reset</button>`:""}</div>
      </div>
      <div class="prog-lvls">${chips.join("")}</div>
    </div>`;
  }).join("");
}
function setProjDone(pid,newDone){
  const p=(S.projects||[]).find(x=>x.id===pid);if(!p)return;
  const {span}=projSpan(p);
  mutateState(()=>{p.done=Math.max(0,Math.min(span,Math.floor(newDone)));});
  save();renderProgress();scheduleSolve();
}
const progressDialog=dialogController.register({root:document.getElementById("progModal"),panel:document.querySelector("#progModal .modal"),opener:null,initialFocus:()=>document.getElementById("progDone"),onOpen:renderProgress});
function openProgress(invoker){progressDialog.open(invoker);}
function closeProgress(){progressDialog.close();}
document.getElementById("progList").addEventListener("click",e=>{
  const reset=e.target.closest("[data-preset]");
  if(reset){setProjDone(reset.getAttribute("data-preset"),0);return;}
  const chip=e.target.closest(".prog-lvl");
  if(chip){
    const pid=chip.getAttribute("data-pid"),L=+chip.getAttribute("data-lvl");
    const p=(S.projects||[]).find(x=>x.id===pid);if(!p)return;
    const {from}=projSpan(p),idx=L-from,done=projDone(p);
    setProjDone(pid,done===idx+1?idx:idx+1);   // click the last-done level to undo it, any other to complete through it
  }
});
document.getElementById("progResetAll").addEventListener("click",()=>{
  if(!(S.projects||[]).some(p=>projDone(p)>0))return;
  if(!confirm("Reset completed-level progress on all projects?"))return;
  mutateState(st=>{(st.projects||[]).forEach(p=>{p.done=0;});});
  save();renderProgress();scheduleSolve();
});

/* ---------- Step-by-step plan modal ---------- */
function itemTier(it,seen){
  if(RAWS.includes(it)||it===GEL)return 0;
  seen=seen||new Set();if(seen.has(it))return 0;seen.add(it);
  const deps=(RECIPE[it]&&RECIPE[it].inputs||[]).filter(k=>RAWS.includes(k)||PRODUCTS.includes(k));
  return deps.length?1+Math.max(...deps.map(k=>itemTier(k,new Set(seen)))):1;
}
// Issue #69: let the user set a project complete or change its levels without leaving this page.
// Reuses the same fields the Shopping list & Progress tracker edit (on / from / to / done), so all
// three views stay in sync. Completion = every level in the from→to span checked off (done=span).
function stepsProjControls(){
  const active=(S.projects||[]).filter(p=>(p.levels||[]).length);
  if(!active.length)return "";
  const rows=active.map(p=>{
    const {from,to,span}=projSpan(p),done=projDone(p),complete=done>=span;
    const name=p.name||"Project";
    const badge=complete?' <span class="pill craft" style="font-size:9px">done</span>':"";
    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line)">
      <input type="checkbox" data-spon="${htmlAttribute(p.id)}" ${p.on?"checked":""} aria-label="Include ${htmlAttribute(name)} in the plan" title="Include ${htmlAttribute(name)} in the plan">
      <span style="flex:1 1 130px;min-width:110px;${complete?"color:var(--ink3)":""}">${htmlText(name)}${badge}</span>
      <span class="proj-mini" style="white-space:nowrap">lv <input type="number" min="1" step="1" data-spfrom="${htmlAttribute(p.id)}" value="${from}" aria-label="${htmlAttribute(name)} starting level" style="width:46px"> → <input type="number" min="1" step="1" data-spto="${htmlAttribute(p.id)}" value="${to}" aria-label="${htmlAttribute(name)} ending level" style="width:46px"></span>
      <span class="lvl-step" title="Mark levels done one at a time">
        <button class="iconbtn" data-spdec="${htmlAttribute(p.id)}" ${done<=0?"disabled":""} aria-label="Mark one fewer ${htmlAttribute(name)} level done" title="Mark one fewer ${htmlAttribute(name)} level done">−</button>
        <span class="mono proj-mini" title="levels completed">${done}/${span}</span>
        <button class="iconbtn" data-spinc="${htmlAttribute(p.id)}" ${done>=span?"disabled":""} aria-label="Mark one more ${htmlAttribute(name)} level done" title="Mark one more ${htmlAttribute(name)} level done">+</button>
      </span>
      <button class="btn ghost" style="padding:2px 9px;font-size:11px" data-spcomplete="${htmlAttribute(p.id)}" aria-label="${complete?"Reopen":"Mark"} ${htmlAttribute(name)} ${complete?"project":"complete"}">${complete?"Reopen":"Mark complete"}</button>
    </div>`;
  }).join("");
  // Rows only — the caller (renderProjectResults) wraps these in a collapsible <details> panel.
  return rows;
}
// Build the step-by-step plan HTML — the main Project-mode panel (was a modal body). Pure: returns the
// intro + phase cards for a solved project result and lets renderProjectResults own the DOM and the
// surrounding controls. Returns "" when there's no plan yet.
function stepPlanHtml(res){
  if(!res||res.empty||!res.phases||!res.phases.length)return "";
  let h=`<p class="help" style="margin:0 0 12px">${res.sequenced
      ?"Do these phases <b>in order</b>. Within a phase, a line listing two jobs splits its time — do the input job first so you don't stall. Reset the lines when you start the next phase."
      :res.waved
      ?"Do these waves <b>in order</b> — finish a wave before starting the next so the unlocks land first. Within a wave, a line listing two jobs splits its time; do the input job first."
      :"Set every line as shown and let it run. A line listing two jobs splits its time across the run; do the input job first."} ${res.partial?"Currently plannable work":res.feasible?"Total":"No finish time"} ${res.feasible||res.partial?`≈ <b>${fmtDuration(res.eta)}</b>.`:"— this plan is blocked."} ${res.partial?'<span style="color:var(--danger)">Blocked items are excluded; this does not finish every ticked project.</span> ':""}<span style="color:var(--ink3)">Clock times count from the <b>plan start</b> above — edit it or tap “Now” to re-anchor.</span></p>`;
  const _ps=(S.planStart!=null&&isFinite(S.planStart))?new Date(S.planStart):null;
  const now=(_ps&&!isNaN(_ps.getTime()))?_ps:new Date();
  const fmtClock=h=>{
    if(!isFinite(h)||h<0)return "";
    const d=new Date(now.getTime()+h*3600000);
    let t=d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
    const dayDiff=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
    if(dayDiff>0)t+=` (${d.toLocaleDateString([],{month:"short",day:"numeric"})})`;   // show the actual date when it lands on a later day, not "+Nd"
    return t;
  };
  let phaseStart=0;
  res.phases.forEach((ph,i)=>{
    const pStart=phaseStart; phaseStart+=ph.eta||0;
    const lines=(ph.plan||[]).filter(p=>p.entries&&p.entries.length).map(p=>({
      line:p.line,max:p.max,
      segs:p.entries.slice().sort((a,b)=>itemTier(a.item)-itemTier(b.item)||b.frac-a.frac)
    }));
    h+=`<div class="step-phase">`;
    const blocked=Object.entries(ph.blockedMined||{}),phaseTime=ph.partial?"partial plan":ph.feasible?"phase":"blocked";
    h+=res.sequenced
      ? `<div class="step-h"><span class="step-n">${i+1}</span> <b>${htmlText(ph.name)}</b> ${ph.prio!=null?'<span class="pill craft" style="font-size:9px">#'+ph.prio+'</span>':""} <span class="proj-mini">· ${phaseTime}${ph.eta>0?" ~"+fmtDuration(ph.eta):""}${ph.feasible?" · done by "+fmtDuration(ph.doneAt):ph.partial?" · plannable work by "+fmtDuration(ph.doneAt):""} </span>${ph.eta>0?'<span class="step-clock">(~'+fmtClock(pStart+(ph.eta||0))+')</span>':""}</div>`
      : res.waved
      ? `<div class="step-h"><span class="step-n">${i+1}</span> <b>Wave ${i+1} — build together</b> ${ph.members&&ph.members.length?'<span class="proj-mini">'+htmlText(ph.members.join(" + "))+'</span>':""} <span class="proj-mini">· ${phaseTime}${ph.eta>0?" ~"+fmtDuration(ph.eta):""}${ph.feasible?" · done by "+fmtDuration(ph.doneAt):ph.partial?" · plannable work by "+fmtDuration(ph.doneAt):""} </span>${ph.eta>0?'<span class="step-clock">(~'+fmtClock(pStart+(ph.eta||0))+')</span>':""}</div>`
      : `<div class="step-h"><b>${ph.partial?"Run this partial line plan":ph.feasible?"Set all lines like this and run":"This phase is blocked"}</b> <span class="proj-mini">· ${ph.partial?"currently plannable work ~"+fmtDuration(ph.eta)+" · plannable work by ":ph.feasible?"finish time ~"+fmtDuration(ph.eta)+" · finish by ":"no finish time"}</span>${ph.eta>0?'<span class="step-clock">~'+fmtClock(pStart+(ph.eta||0))+'</span>':""}</div>`;
    if(!ph.feasible){const why=blocked.length?" — "+blocked.map(([item,resources])=>item+" needs "+resources.join(" + ")).join("; "):"";
      h+=`<div class="notice warn" style="font-size:11px;margin:4px 0 6px">Can't fully produce this phase with the current lines and incomes${why}. ${ph.partial?"The line work below is only the currently plannable portion.":""}</div>`;}
    if(ph.atRisk&&ph.atRisk.length)h+=`<div class="notice warn" style="font-size:11px;margin:4px 0 6px">No line here is crafting ${ph.atRisk.join(", ")} — this plan is spending down your current stock of ${ph.atRisk.length>1?"them":"it"} instead. Once that stock is gone, this schedule stops working.</div>`;
    if(!lines.length){h+=`<div class="proj-mini" style="padding:2px 0">No line activity.</div></div>`;return;}
    // Projected on-hand stock of each item at a given point in the phase (issue #87 follow-up):
    // stock when the phase began + net (produced + Lil' Forgie − consumed by other lines) so far. Uses
    // the phase-average rates from the LP's balance table, so a just-in-time intermediate reads ~0 (it's
    // eaten as fast as it's made) while a finished product climbs toward the amount the project needs.
    const bal={};(ph.balance||[]).forEach(b=>{bal[b.res]=b;});
    const inv0=ph.invStart||{};
    const onHandAt=(item,elapsed)=>{
      const b=bal[item];const netRate=b?((b.prod||0)+(b.forgie||0)-(b.cons||0)):0;
      const v=(num(inv0[item])||0)+netRate*elapsed;
      return isFinite(v)?Math.max(0,v):0;
    };
    h+=`<ol class="step-list">`;
    lines.forEach(L=>{
      let cum=0;
      const parts=L.segs.map(s=>{
        cum+=s.frac;
        const elapsed=Math.min(cum,1)*(ph.eta||0);
        const at=fmtClock(pStart+elapsed);
        const tag=at?` <span class="proj-mini">· until </span><span class="step-clock">~${at}</span>`:"";
        const stock=at?` <span class="proj-mini">· ~<b>${disp(onHandAt(s.item,elapsed))}</b> on hand</span>`:"";
        const verb=RAWS.includes(s.item)?"produce":"craft";
        const cfg=MINED_CRAFTS[s.item],mined=cfg?` <span class="proj-mini">· uses ${cfg.resource} income</span>`:"";
        return `${verb} <b>${s.item}</b> @${compressionLabel(s.lvl)}${s.frac>=0.999?" (whole phase)":` for ~${fmtDuration(s.frac*ph.eta)}`}${mined}${tag}${stock}`;
      });
      const segHtml=parts.map((p,idx)=>`<div class="step-seg">${idx===0?'<span class="step-then">→</span>':'<span class="step-then">then</span>'} ${p}</div>`).join('');
      h+=`<li><span class="mono" style="color:var(--amber)">Line #${L.line}</span> <span class="proj-mini">(${compressionLabel(L.max)} cap)</span>${segHtml}</li>`;
    });
    h+=`</ol>${minedUsageNote(ph.minedUsage||[])}</div>`;
  });
  return h;
}
// ── Plan-start + inline project controls, now living in the Project-mode panel (#results) ──
// The step plan and its controls used to be a modal; promoting them into #results means every edit
// re-renders the plan in place. #results is rebuilt on each solve, so all of this is delegated.
// S.planStart (issue #87 item 1) is epoch ms, or null for a live "now" — a display anchor only; the
// schedule's durations are elapsed-hours from the solver and don't depend on it. It's seeded once, the
// first time a real plan exists, in renderProjectResults (results.js).
const stepsProj=pid=>(S.projects||[]).find(x=>x.id===pid);
// Repaint the project panel from the cached result WITHOUT re-solving — for changes that only move the
// display anchor (plan start / "Now"), not the plan itself.
function repaintProject(){
  if(S.mode!=="project")return;
  const el=document.getElementById("results"),stat=document.getElementById("solveStat");
  if(el&&_lastProjectRes)renderProjectResults(_lastProjectRes,el,stat);
}
document.getElementById("results").addEventListener("input",e=>{
  const t=e.target;if(!t||!t.getAttribute)return;let v;
  // Level-range typing: update state only (no re-render) so the caret is kept; the plan rebuilds on
  // commit (change). Editing `from` must never touch `to` mid-keystroke (issue #87 item 4) —
  // reconciliation happens on read via projSpan()/projectDemand(). Skip the write while transiently
  // empty so backspacing doesn't coerce to 1; the commit re-render restores it.
  if((v=t.getAttribute("data-spfrom"))!=null){const p=stepsProj(v);if(p&&t.value.trim()!==""){mutateState(()=>{p.from=Math.max(1,Math.floor(num(t.value)||1));});save();}return;}
  if((v=t.getAttribute("data-spto"))!=null){const p=stepsProj(v);if(p&&t.value.trim()!==""){mutateState(()=>{p.to=Math.max(1,Math.floor(num(t.value)||1));});save();}return;}
});
document.getElementById("results").addEventListener("change",e=>{
  const t=e.target;if(!t||!t.getAttribute)return;let v;
  // Plan-start anchor: display-only, so repaint from cache (no solve).
  if(t.id==="spStart"){const val=t.value,ms=val?new Date(val).getTime():null;if(!val||!isNaN(ms))mutateState(st=>{st.planStart=ms;});save();repaintProject();return;}
  // Inline project controls — same fields as Shopping list / Track progress, kept in sync. These change
  // demand, so re-solve; doSolve() rebuilds #results (and thus the plan) right away.
  if((v=t.getAttribute("data-spon"))!=null){const p=stepsProj(v);if(p){mutateState(()=>{p.on=t.checked;});save();doSolve();}return;}
  if(t.getAttribute("data-spfrom")!=null||t.getAttribute("data-spto")!=null){doSolve();return;}   // commit level edit
  // Manual-mode dropdowns also live inside #results (re-rendered each change)
  if(t.id==="manualPreset"){if(t.value)loadManualPreset(t.value);return;}
  const ri=t.getAttribute("data-mres");
  if(ri!=null){const i=+ri;if(S.manual[i])mutateState(st=>{st.manual[i].job=t.value;if(st.manual[i].lvl>st.lines[i].max)st.manual[i].lvl=st.lines[i].max;});save();renderResults();return;}
  const lv=t.getAttribute("data-mlvl");
  if(lv!=null){const i=+lv;if(S.manual[i])mutateState(st=>{st.manual[i].lvl=+t.value;});save();renderResults();return;}
  const sl=t.getAttribute("data-msell");
  if(sl!=null){const i=+sl;if(S.manual[i])mutateState(st=>{st.manual[i].sell=t.checked;});save();renderResults();return;}
});
document.getElementById("results").addEventListener("click",e=>{
  const cl=sel=>e.target.closest&&e.target.closest(sel);
  if(cl("#btnProgress")){openProgress(cl("#btnProgress"));return;}
  // Plan-start "Now" — re-anchor the clock to the current moment (display only).
  if(cl("#spNow")){mutateState(st=>{st.planStart=Date.now();});save();repaintProject();return;}
  // Persist a disclosure's open state across the next re-render. The native <details> toggle still
  // fires; at click time .open is the pre-toggle state, so the new state is its inverse.
  const sm=cl("summary[data-paneltoggle]");
  if(sm){const k=sm.getAttribute("data-paneltoggle"),willOpen=!(sm.parentElement&&sm.parentElement.open);
    if(k==="adjust")_projAdjustOpen=willOpen;else if(k==="breakdown")_breakdownOpen=willOpen;return;}
  // Granular +1/−1 level completion (issue #87 item 3) — clamped to the from→to span, reusing the
  // projSpan/projDone helpers the tracker and solver read, so every view stays in sync.
  const inc=cl("[data-spinc]"),dec=cl("[data-spdec]");
  if(inc||dec){const p=stepsProj((inc||dec).getAttribute(inc?"data-spinc":"data-spdec"));if(!p)return;
    mutateState(()=>{const {span}=projSpan(p);p.done=Math.max(0,Math.min(span,projDone(p)+(inc?1:-1)));});save();doSolve();return;}
  const cbtn=cl("[data-spcomplete]");
  if(cbtn){const p=stepsProj(cbtn.getAttribute("data-spcomplete"));if(!p)return;
    mutateState(()=>{const {span}=projSpan(p);p.done=projDone(p)>=span?0:span;});save();doSolve();return;}   // toggle done/reopen
  if(cl("#btnCopyManual")){copyPlanToManual(_lastItemsCreditsRes);return;}
  if(cl("#manualUpdate")){if(S.manualActiveId)updateManualPreset(S.manualActiveId);return;}
  if(cl("#manualSaveNew")){const name=(prompt("Name this setup:","")||"").trim();if(name)saveManualPreset(name);return;}
  if(cl("#manualDelPreset")){const sel=document.getElementById("manualPreset");const id=(sel&&sel.value)||S.manualActiveId;if(id&&confirm("Delete this saved setup?"))deleteManualPreset(id);return;}
});

window.addEventListener("pagehide",()=>solveService.cancel("Page teardown"));
