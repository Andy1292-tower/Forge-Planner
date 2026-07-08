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
  if(li!==undefined){S.lines[+li].max=+e.target.value;markStale();}
});
document.getElementById("lines").addEventListener("input",e=>{
  const si=e.target.dataset.spx, ti=e.target.dataset.turbo;
  if(si!==undefined){S.lines[+si].spx=num(e.target.value)||1;refreshLineNotes();markStale();}
  if(ti!==undefined){S.lines[+ti].turbo=Math.max(0,num(e.target.value)||0);refreshLineNotes();markStale();}
});
document.getElementById("lines").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();resimulate();}
});
document.getElementById("lines").addEventListener("click",e=>{
  const d=e.target.dataset.del;
  if(d!==undefined){if(S.lines.length>1){S.lines.splice(+d,1);S.manual.splice(+d,1);syncManual(S);renderLines();markStale();}}
});
document.getElementById("btnAddLine").addEventListener("click",()=>{
  S.lines.push({max:512,spx:1,turbo:0});syncManual(S);renderLines();markStale();
});

document.getElementById("margin").addEventListener("input",e=>{
  S.margin=num(e.target.value)||0;
  document.getElementById("marginv").textContent=fmt(S.margin,1)+"%";
  scheduleSolve();
});

document.getElementById("maxTurbo").addEventListener("input",e=>{
  S.maxTurbo=Math.max(0,num(e.target.value)||0);
  refreshLineNotes();markStale();
});
document.getElementById("dupe").addEventListener("input",e=>{
  S.dupe=Math.max(0,num(e.target.value)||0);
  markStale();
});

document.getElementById("targets").addEventListener("change",e=>{
  const tg=e.target.dataset.tg;
  if(tg){S.targets[tg].on=e.target.checked;renderTargets();scheduleSolve();}
});
document.getElementById("targets").addEventListener("input",e=>{
  const w=e.target.dataset.w;
  if(w){S.targets[w].w=+e.target.value;e.target.parentElement.querySelector(".pv").textContent=e.target.value;scheduleSolve();}
});

document.getElementById("recipes").addEventListener("input",e=>{
  const d=e.target.dataset;if(!d.res)return;
  const v=num(e.target.value);
  if(d.fld==="baseT")S.baseTime[d.res]=(v==null||v<=0)?1:v;
  else if(d.fld==="cost")S.prodCost[d.res][d.in][+d.lv]=v;
  scheduleSolve();
});

/* export / import / reset */
document.getElementById("btnExport").addEventListener("click",()=>{
  const blob=new Blob([JSON.stringify(S,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download="forge-build.json";a.click();URL.revokeObjectURL(a.href);
});
document.getElementById("btnImport").addEventListener("click",()=>document.getElementById("fileImport").click());
document.getElementById("fileImport").addEventListener("change",e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{try{const d=JSON.parse(r.result);
    if(d.lines&&d.prodCost&&d.targets){S=normalize(d);renderAll();save();}
    else alert("That doesn't look like a Forge Planner build file.");
  }catch(err){alert("Could not read that file.");}};
  r.readAsText(f);e.target.value="";
});
document.getElementById("btnReset").addEventListener("click",()=>{
  if(confirm("Reset everything to defaults? This clears your entered stats."))
    {S=defaults();renderAll();save();}
});

/* ---------- mode switch ---------- */
function renderModeSwitch(){
  document.querySelectorAll("#modesw button").forEach(b=>b.classList.toggle("on",b.dataset.mode===(S.mode||"items")));
}
document.getElementById("modesw").addEventListener("click",e=>{
  const m=e.target.dataset.mode;if(!m||m===S.mode)return;
  S.mode=m;renderModeSwitch();save();renderResults();
});

/* ---------- sell prices ---------- */
function renderPrices(){
  const box=document.getElementById("priceRows");
  const tag=it=>KIND[it]==="raw"?'<span class="ty raw">raw</span>':KIND[it]==="fin"?'<span class="ty fin">assembly</span>':'<span class="ty pr">craft</span>';
  const rows=(items)=>items.map(it=>{
    const v=S.sellPrice[it];
    const txt=S.priceText[it]!=null?S.priceText[it]:(v!=null?formatGameNum(v,4):"");
    return `<div class="price-row">
      <div class="pnm">${tag(it)}${it}</div>
      <input type="text" data-price="${it}" placeholder="—" value="${txt}">
    </div>`;
  }).join("");
  box.innerHTML=`<div class="price-grp first">Finished &amp; crafted</div>${rows(PRODUCTS)}<div class="price-grp">Raw materials</div>${rows(RAWS)}`;
}
const priceModal=document.getElementById("priceModal");
function openPrices(){renderPrices();priceModal.hidden=false;}
function closePrices(){priceModal.hidden=true;}
document.getElementById("btnPrices").addEventListener("click",openPrices);
document.getElementById("priceClose").addEventListener("click",closePrices);
document.getElementById("priceDone").addEventListener("click",closePrices);
priceModal.addEventListener("click",e=>{if(e.target===priceModal)closePrices();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!priceModal.hidden)closePrices();});
document.getElementById("priceClear").addEventListener("click",()=>{
  if(!confirm("Clear all sell prices?"))return;
  [...RAWS,...PRODUCTS].forEach(it=>{S.sellPrice[it]=null;S.priceText[it]="";});
  renderPrices();scheduleSolve();
});
document.getElementById("priceRows").addEventListener("input",e=>{
  const it=e.target.dataset.price;if(!it)return;
  const raw=e.target.value;
  S.priceText[it]=raw;
  const v=parseGameNum(raw);
  S.sellPrice[it]=v;
  const prev=document.querySelector(`[data-prev="${it}"]`);
  if(prev)prev.textContent=v!=null?"= "+fmt(v):(raw.trim()?"unrecognized":"");
  scheduleSolve();
});

/* ---------- Lil' Forgie supply modal ---------- */
function renderForgie(){
  const box=document.getElementById("forgieRows");
  const tag=it=>KIND[it]==="raw"?'<span class="ty raw">raw</span>':KIND[it]==="fin"?'<span class="ty fin">assembly</span>':'<span class="ty pr">craft</span>';
  const rows=(items)=>items.map(it=>{
    const v=S.forgie[it];
    const txt=S.forgieText[it]!=null?S.forgieText[it]:(v!=null?formatGameNum(v,4):"");
    return `<div class="price-row">
      <div class="pnm">${tag(it)}${it}</div>
      <input type="text" inputmode="decimal" data-forgie="${it}" placeholder="—" value="${txt}">
    </div>`;
  }).join("");
  box.innerHTML=`<div class="price-grp first">Finished &amp; crafted</div>${rows(PRODUCTS)}<div class="price-grp">Raw materials</div>${rows(RAWS)}`;
}
const forgieModal=document.getElementById("forgieModal");
function openForgie(){renderForgie();forgieModal.hidden=false;}
function closeForgie(){forgieModal.hidden=true;}
document.getElementById("btnForgie").addEventListener("click",openForgie);
document.getElementById("forgieClose").addEventListener("click",closeForgie);
document.getElementById("forgieDone").addEventListener("click",closeForgie);
forgieModal.addEventListener("click",e=>{if(e.target===forgieModal)closeForgie();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!forgieModal.hidden)closeForgie();});
document.getElementById("forgieClear").addEventListener("click",()=>{
  if(!confirm("Clear all Lil' Forgie supply rates?"))return;
  [...RAWS,...PRODUCTS].forEach(it=>{S.forgie[it]=null;S.forgieText[it]="";});
  renderForgie();scheduleSolve();
});
document.getElementById("forgieRows").addEventListener("input",e=>{
  const it=e.target.dataset.forgie;if(!it)return;
  const raw=e.target.value;
  S.forgieText[it]=raw;
  S.forgie[it]=parseGameNum(raw);
  scheduleSolve();
});

/* ---------- Gel ore-cost reference modal ---------- */
// Gel's mined-ore inputs are a read-only reference here (GEL_*_BASE / gelOreCost live in core.js).
// Per-minute uses the fastest current line that reaches each compression level L.
// Display-only ore burn for a running Gel line (not part of any balance/calculation):
// crafts/sec = eff/ct, ore is per craft (dup doesn't change input cost).
function gelOreConsumesHr(L,eff){
  const ct=craftTime(GEL,L);if(!(ct>0)||!(eff>0))return "";
  const {rocks,vesp}=gelOreCost(L),cps=eff/ct;
  return `${disp(rocks*cps*3600)} rocks, ${disp(vesp*cps*3600)} vespium <span style="color:var(--ink3)">(free ore)</span>`;
}
function fastestGelSpeed(L){let best=null;S.lines.forEach(ln=>{if((ln.max||0)>=L){const sp=lineSpeed(ln);if(best==null||sp>best)best=sp;}});return best;}
function renderGelCost(){
  let h=`<table><thead><tr><th>Comp</th><th class="num">Rocks /craft</th><th class="num">Vespium /craft</th>
    <th class="num">~s/craft</th><th class="num">Rocks /min</th><th class="num">Vespium /min</th></tr></thead><tbody>`;
  LEVELS.forEach(L=>{
    const {rocks,vesp}=gelOreCost(L), ct=craftTime(GEL,L), sp=fastestGelSpeed(L);
    let sCraft="—",rMin="—",vMin="—";
    if(sp!=null&&ct>0){const secs=ct/effSpeed(sp,ct),cpm=60/secs;sCraft=fmt(secs,2);rMin=disp(rocks*cpm);vMin=disp(vesp*cpm);}
    h+=`<tr><td class="mono">${L}×</td><td class="num">${disp(rocks)}</td><td class="num">${disp(vesp)}</td>
      <td class="num mono" style="color:var(--ink2)">${sCraft}</td><td class="num">${rMin}</td><td class="num">${vMin}</td></tr>`;
  });
  h+=`</tbody></table>`;
  document.getElementById("gelCostRows").innerHTML=h;
}
const gelCostModal=document.getElementById("gelCostModal");
function openGelCost(){renderGelCost();gelCostModal.hidden=false;}
function closeGelCost(){gelCostModal.hidden=true;}
document.getElementById("btnGelCost").addEventListener("click",openGelCost);
document.getElementById("gelCostClose").addEventListener("click",closeGelCost);
document.getElementById("gelCostDone").addEventListener("click",closeGelCost);
gelCostModal.addEventListener("click",e=>{if(e.target===gelCostModal)closeGelCost();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!gelCostModal.hidden)closeGelCost();});

/* ---------- settings modal (max solve time) ---------- */
const settingsModal=document.getElementById("settingsModal");
const solveBudgetInput=document.getElementById("solveBudget");
const solveBudgetVal=document.getElementById("solveBudgetVal");
function fmtBudget(ms){return (ms/1000).toFixed(ms<1000?1:(ms%1000?1:0))+" s";}
function syncBudgetUI(){const ms=Math.max(200,Math.min(60000,num(S.solveBudget)||2000));
  if(solveBudgetInput)solveBudgetInput.value=(ms/1000);if(solveBudgetVal)solveBudgetVal.textContent=fmtBudget(ms);}
function openSettings(){syncBudgetUI();settingsModal.hidden=false;}
function closeSettings(){settingsModal.hidden=true;}
document.getElementById("btnSettings").addEventListener("click",openSettings);
document.getElementById("settingsClose").addEventListener("click",closeSettings);
document.getElementById("settingsDone").addEventListener("click",closeSettings);
settingsModal.addEventListener("click",e=>{if(e.target===settingsModal)closeSettings();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!settingsModal.hidden)closeSettings();});
if(solveBudgetInput)solveBudgetInput.addEventListener("input",()=>{
  S.solveBudget=Math.round(Math.max(0.2,Math.min(15,Number(solveBudgetInput.value)||2))*1000);
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
    LEVELS.forEach(L=>cp.add(new Option(L+"× (level "+Math.round(Math.log2(L))+")",L)));
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
        (Math.abs(predict-sec)/sec>0.15?` <span style="color:#e0a">— off by ${fmt(Math.abs(predict-sec)/sec*100,0)}%, worth setting</span>`:` <span style="color:#6c9">— matches, base looks right</span>`);
      apply.disabled=false;
    }else{
      computed=null;apply.disabled=true;
      out.innerHTML=spd>0?`current ${item} base (${fmt(cur,2)}s) predicts a <b>${fmt(predict,2)}s</b> craft at ${L}× / ×${fmt(spd,2)}. Enter the real craft seconds to compare.`:`Enter that unit's speed × and a craft time to compute or verify.`;
    }
  }
  ["cbItem","cbComp","cbSpeed","cbSec"].forEach(id=>document.getElementById(id).addEventListener("input",recalc));
  apply.addEventListener("click",()=>{
    if(computed==null)return;
    S.baseTime[it.value]=computed; save(); renderRecipes(); renderResults(); recalc();
  });
  recalc();
}
function renderAll(){
  renderModeSwitch();
  renderLines();renderTargets();renderGel();renderRecipes();renderResults();
  document.getElementById("margin").value=S.margin||0;
  document.getElementById("marginv").textContent=fmt(S.margin||0,1)+"%";
  document.getElementById("maxTurbo").value=S.maxTurbo||0;
  document.getElementById("dupe").value=S.dupe||0;
}
renderAll();
initCalib();
document.getElementById("saveind").textContent="auto-saves locally";
function costRow(pi,li,ci,c){
  const opts=ALLITEMS.map(it=>`<option value="${it}" ${it===c.item?"selected":""}>${it}</option>`).join("");
  const txt=(c.qty!=null&&isFinite(c.qty))?formatGameNum(c.qty,4):"";
  return `<div class="cost-row">
    <select data-citem="${pi}_${li}_${ci}">${opts}</select>
    <input type="text" placeholder="qty" value="${txt}" data-cqty="${pi}_${li}_${ci}">
    <button class="iconbtn" data-cdel="${pi}_${li}_${ci}" title="Remove item">×</button>
  </div>`;
}
// Read-only cost lines for one level of a catalog project (non-zero costs only).
function catLevelView(L){
  const parts=(L.costs||[]).filter(c=>c.qty).map(c=>`${escapeAttr(c.item)} <b class="mono">${formatGameNum(c.qty,2)}</b>`);
  return parts.length?parts.join(' <span style="color:var(--ink3)">·</span> '):'<span style="color:var(--ink3)">free</span>';
}
// Compact card for a catalog-sourced project: name is a fixed label, costs are
// read-only, user only controls on/off, level range, "1st", and remove. Reuses
// the same data-* hooks as the editable card so existing handlers apply.
function compactProjCard(p,pi){
  const lv=p.levels||[];
  const view=lv.map((L,li)=>`<div class="cat-lvl"><span class="cat-lvl-n">Lv ${li+1}</span><span>${catLevelView(L)}</span></div>`).join("");
  const desc=p.description?`<span class="cat-card-desc">${escapeAttr(p.description)}</span>`:"";
  const single=lv.length<=1;
  const range=single
    ? `<span class="proj-lvls one">1 level</span>`
    : `<span class="proj-lvls">lv <input type="number" min="1" max="${lv.length}" step="1" data-pfrom="${pi}" value="${p.from||1}"> → <input type="number" min="1" max="${lv.length}" step="1" data-pto="${pi}" value="${p.to||lv.length}"></span>`;
  return `<div class="proj cat-card ${p._open?"open":""}" data-pi="${pi}">
    <div class="proj-h">
      <span class="pchev" data-ptoggle="${pi}" title="Show level costs">▸</span>
      <input type="checkbox" data-pon="${pi}" ${p.on?"checked":""} title="Include in schedule">
      <span class="pname-static">${escapeAttr(p.name)}${desc}</span>
      <div class="proj-tools">
        <label class="proj-prio" title="Manual order — type 1, 2, 3… to set the sequence; blank lets the planner pick. Material unlocks are always ordered first."><input type="number" class="pprio" min="1" step="1" inputmode="numeric" data-pprio="${pi}" value="${p.prio!=null?p.prio:""}" placeholder="–">order</label>
        ${range}
        <button class="iconbtn" data-pdel="${pi}" title="Remove from list">×</button>
      </div>
    </div>
    <div class="proj-b"><div class="cat-lvls">${view}</div></div>
  </div>`;
}
function projCard(p,pi){
  if(p.catId)return compactProjCard(p,pi);
  const lv=p.levels||[];
  const lvlHtml=lv.map((L,li)=>{
    const rows=(L.costs||[]).map((c,ci)=>costRow(pi,li,ci,c)).join("");
    return `<div class="lvl-card">
      <div class="lvl-h"><span>Level ${li+1}</span><span class="lvl-del" data-pdellvl="${pi}" data-li="${li}" title="Delete level">✕ remove</span></div>
      ${rows||'<div class="proj-mini" style="margin-bottom:5px">No items — add one.</div>'}
      <button class="btn ghost proj-add-lvl" data-paddcost="${pi}" data-li="${li}">+ item</button>
    </div>`;
  }).join("");
  return `<div class="proj ${p._open?"open":""}" data-pi="${pi}">
    <div class="proj-h">
      <span class="pchev" data-ptoggle="${pi}">▸</span>
      <input type="checkbox" data-pon="${pi}" ${p.on?"checked":""} title="Include in schedule">
      <input class="pname" data-pname="${pi}" value="${escapeAttr(p.name)}" placeholder="Project name">
      <div class="proj-tools">
        <label class="proj-prio" title="Manual order — type 1, 2, 3… to set the sequence; blank lets the planner pick. Material unlocks are always ordered first."><input type="number" class="pprio" min="1" step="1" inputmode="numeric" data-pprio="${pi}" value="${p.prio!=null?p.prio:""}" placeholder="–">order</label>
        <span class="proj-lvls">lv <input type="number" min="1" step="1" data-pfrom="${pi}" value="${p.from||1}"> → <input type="number" min="1" step="1" data-pto="${pi}" value="${p.to||lv.length||1}"></span>
        <button class="iconbtn" data-pdup="${pi}" title="Duplicate" style="font-size:13px">⧉</button>
        <button class="iconbtn" data-pdel="${pi}" title="Delete project">×</button>
      </div>
    </div>
    <div class="proj-b">
      ${lvlHtml}
      <button class="btn ghost proj-add-lvl" data-paddlvl="${pi}" style="margin-top:2px">+ level</button>
    </div>
  </div>`;
}
function renderInv(){
  const box=document.getElementById("invRows");
  const tag=it=>KIND[it]==="raw"?'<span class="ty raw">raw</span>':KIND[it]==="fin"?'<span class="ty fin">assembly</span>':'<span class="ty pr">craft</span>';
  const rows=(items)=>items.map(it=>{
    const v=S.inventory[it];
    const txt=S.inventoryText[it]!=null?S.inventoryText[it]:(v!=null?formatGameNum(v,4):"");
    return `<div class="price-row"><div class="pnm">${tag(it)}${it}</div><input type="text" data-inv="${it}" placeholder="0" value="${txt}"></div>`;
  }).join("");
  box.innerHTML=`<div class="price-grp first">Finished &amp; crafted</div>${rows(PRODUCTS)}<div class="price-grp">Raw materials</div>${rows(RAWS)}`;
}
function renderProjects(){
  if(!S.projects)S.projects=[];
  const box=document.getElementById("projList");
  box.innerHTML=S.projects.length?S.projects.map((p,pi)=>projCard(p,pi)).join("")
    :`<div class="proj-mini" style="padding:6px 2px">No projects yet — add one to start building a schedule.</div>`;
  const st=document.getElementById("projSeqToggle");if(st)st.checked=S.projectSeq!==false;
  const gt=document.getElementById("projGateToggle");if(gt){gt.checked=S.projectGate===false;gt.disabled=S.projectSeq!==false;gt.closest(".seq-toggle").classList.toggle("disabled",gt.disabled);}
  renderInv();
  if(typeof renderCatalog==="function")renderCatalog();
}
document.getElementById("projSeqToggle").addEventListener("change",e=>{S.projectSeq=e.target.checked;renderProjects();save();scheduleSolve();});
document.getElementById("projGateToggle").addEventListener("change",e=>{S.projectGate=!e.target.checked;save();scheduleSolve();});

/* ---------- project catalog (static, read-only source list) ---------- */
const CATALOG=(typeof PROJECT_CATALOG!=="undefined"&&Array.isArray(PROJECT_CATALOG))?PROJECT_CATALOG:[];
let catQuery="";
const projectHasCat=catId=>(S.projects||[]).some(p=>p.catId===catId);
function addCatalogProject(catId){
  const src=CATALOG.find(c=>c.catId===catId);
  if(!src||projectHasCat(catId))return;
  S.projects.push({
    id:newId(),catId:src.catId,name:src.name,description:src.description||"",
    on:true,prio:null,from:1,to:src.levels.length||1,
    levels:JSON.parse(JSON.stringify(src.levels)),_open:false
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
    const meta=`${lvls} level${lvls===1?"":"s"}${c.description?" · "+escapeAttr(c.description):""}`;
    return `<div class="cat-row${has?" added":""}">
      <div class="cat-row-info"><span class="cat-row-name">${escapeAttr(c.name)}</span><span class="cat-row-meta">${meta}</span></div>
      <button class="btn ${has?"ghost":"primary"} cat-add" data-cat-add="${escapeAttr(c.catId)}" ${has?"disabled":""}>${has?"Added":"Add"}</button>
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

const projModal=document.getElementById("projModal");
function openProjects(){renderProjects();renderCatalog();projModal.hidden=false;}
function closeProjects(){projModal.hidden=true;}
document.getElementById("btnProjects").addEventListener("click",openProjects);
document.getElementById("projClose").addEventListener("click",closeProjects);
document.getElementById("projDone").addEventListener("click",closeProjects);
projModal.addEventListener("click",e=>{if(e.target===projModal)closeProjects();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!projModal.hidden)closeProjects();});
document.getElementById("projAdd").addEventListener("click",()=>{
  S.projects.push({id:newId(),name:"New project",on:true,from:1,to:1,levels:[{costs:[]}],_open:true});
  renderProjects();save();scheduleSolve();
});
document.getElementById("projClear").addEventListener("click",()=>{
  if(!(S.projects||[]).length)return;
  if(!confirm("Remove all projects from the shopping list? This clears every added catalog project and custom project."))return;
  S.projects=[];
  renderProjects();save();scheduleSolve();
});
document.getElementById("projInvClear").addEventListener("click",()=>{
  if(!confirm("Clear all inventory amounts?"))return;
  ALLITEMS.forEach(it=>{S.inventory[it]=null;S.inventoryText[it]="";});
  renderInv();scheduleSolve();
});
document.getElementById("projList").addEventListener("click",e=>{
  const t=e.target,g=a=>t.getAttribute(a);
  let v;
  if((v=g("data-ptoggle"))!=null){S.projects[+v]._open=!S.projects[+v]._open;renderProjects();return;}
  if((v=g("data-pdel"))!=null){if(confirm("Delete this project?")){S.projects.splice(+v,1);renderProjects();save();scheduleSolve();}return;}
  if((v=g("data-pdup"))!=null){const c=JSON.parse(JSON.stringify(S.projects[+v]));c.id=newId();c.name=(c.name||"Project")+" copy";c._open=true;S.projects.splice(+v+1,0,c);renderProjects();save();scheduleSolve();return;}
  if((v=g("data-paddlvl"))!=null){const p=S.projects[+v];p.levels.push({costs:[]});p.to=p.levels.length;renderProjects();save();scheduleSolve();return;}
  if((v=g("data-pdellvl"))!=null){const pi=+v,li=+g("data-li"),p=S.projects[pi];p.levels.splice(li,1);if(p.levels.length===0)p.levels.push({costs:[]});if(p.to>p.levels.length)p.to=p.levels.length;if(p.from>p.levels.length)p.from=p.levels.length;renderProjects();save();scheduleSolve();return;}
  if((v=g("data-paddcost"))!=null){const pi=+v,li=+g("data-li");S.projects[pi].levels[li].costs.push({item:PRODUCTS[0],qty:null});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-cdel"))!=null){const[pi,li,ci]=v.split("_").map(Number);S.projects[pi].levels[li].costs.splice(ci,1);renderProjects();save();scheduleSolve();return;}
});
document.getElementById("projList").addEventListener("input",e=>{
  const t=e.target,g=a=>t.getAttribute(a);let v;
  if((v=g("data-pname"))!=null){S.projects[+v].name=t.value;save();scheduleSolve();return;}
  if((v=g("data-pfrom"))!=null){S.projects[+v].from=Math.max(1,Math.floor(num(t.value)||1));save();scheduleSolve();return;}
  if((v=g("data-pto"))!=null){S.projects[+v].to=Math.max(1,Math.floor(num(t.value)||1));save();scheduleSolve();return;}
  if((v=g("data-pprio"))!=null){const n=Math.floor(num(t.value));S.projects[+v].prio=(n>=1)?n:null;save();scheduleSolve();return;}
  if((v=g("data-cqty"))!=null){const[pi,li,ci]=v.split("_").map(Number);S.projects[pi].levels[li].costs[ci].qty=parseGameNum(t.value);save();scheduleSolve();return;}
});
document.getElementById("projList").addEventListener("change",e=>{
  const t=e.target,g=a=>t.getAttribute(a);let v;
  if((v=g("data-pon"))!=null){S.projects[+v].on=t.checked;save();scheduleSolve();return;}
  if((v=g("data-citem"))!=null){const[pi,li,ci]=v.split("_").map(Number);S.projects[pi].levels[li].costs[ci].item=t.value;save();scheduleSolve();return;}
});
document.getElementById("invRows").addEventListener("input",e=>{
  const it=e.target.getAttribute("data-inv");if(!it)return;
  S.inventoryText[it]=e.target.value;S.inventory[it]=parseGameNum(e.target.value);save();scheduleSolve();
});

/* ---------- Progress tracker modal ---------- */
// Levels completed for a project, clamped to its from→to span (non-destructive).
function projSpan(p){const from=Math.max(1,Math.floor(num(p.from)||1));const to=Math.max(from,Math.min((p.levels||[]).length,Math.floor(num(p.to)||(p.levels||[]).length)));return {from,to,span:to-from+1};}
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
      chips.push(`<button class="prog-lvl${isDone?" done":""}${isNext?" next":""}" data-pid="${escapeAttr(p.id)}" data-lvl="${L}" title="${isDone?"Completed — click to undo":"Mark completed through level "+L}"><span class="pl-box"></span>Lv ${L}</button>`);
    }
    const desc=p.description?`<span class="prog-desc">${escapeAttr(p.description)}</span>`:"";
    return `<div class="prog-proj${complete?" complete":""}">
      <div class="prog-proj-h">
        <div class="prog-proj-name">${escapeAttr(p.name||"Project")}${complete?' <span class="pill craft" style="font-size:9px">done</span>':""}${desc}</div>
        <div class="prog-proj-meta"><span class="mono">${done}/${span}</span>${done>0?`<button class="prog-reset" data-preset="${escapeAttr(p.id)}" title="Reset this project's progress">reset</button>`:""}</div>
      </div>
      <div class="prog-lvls">${chips.join("")}</div>
    </div>`;
  }).join("");
}
function setProjDone(pid,newDone){
  const p=(S.projects||[]).find(x=>x.id===pid);if(!p)return;
  const {span}=projSpan(p);
  p.done=Math.max(0,Math.min(span,Math.floor(newDone)));
  save();renderProgress();scheduleSolve();
}
const progModal=document.getElementById("progModal");
function openProgress(){renderProgress();progModal.hidden=false;}
function closeProgress(){progModal.hidden=true;}
document.getElementById("progClose").addEventListener("click",closeProgress);
document.getElementById("progDone").addEventListener("click",closeProgress);
progModal.addEventListener("click",e=>{if(e.target===progModal)closeProgress();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!progModal.hidden)closeProgress();});
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
  (S.projects||[]).forEach(p=>{p.done=0;});
  save();renderProgress();scheduleSolve();
});

/* ---------- Step-by-step plan modal ---------- */
function itemTier(it){if(it===GEL||RAWS.includes(it))return 0;if(it==="Frames")return 2;if(it==="Wire")return 3;return 1;}
function renderSteps(){
  const res=_lastProjectRes, body=document.getElementById("stepsBody");
  if(!res||res.empty||!res.phases||!res.phases.length){body.innerHTML=`<div class="notice info">Build a project plan first — add a project in Shopping list and switch to Project plan mode.</div>`;return;}
  let h=`<p class="help" style="margin-bottom:12px">${res.sequenced
      ?"Do these phases <b>in order</b>. Within a phase, a line listing two jobs splits its time — do the input job first so you don't stall. Reset the lines when you start the next phase."
      :res.waved
      ?"Do these waves <b>in order</b> — finish a wave before starting the next so the unlocks land first. Within a wave, a line listing two jobs splits its time; do the input job first."
      :"Set every line as shown and let it run. A line listing two jobs splits its time across the run; do the input job first."} Total ≈ <b>${fmtDuration(res.eta)}</b>. <span style="color:var(--ink3)">Clock times assume you start now — <b>refresh the page and they'll no longer be accurate.</b></span></p>`;
  const now=new Date();
  const fmtClock=h=>{
    if(!isFinite(h)||h<0)return "";
    const d=new Date(now.getTime()+h*3600000);
    let t=d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
    const dayDiff=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
    if(dayDiff>0)t+=` (+${dayDiff}d)`;
    return t;
  };
  let phaseStart=0;
  res.phases.forEach((ph,i)=>{
    const pStart=phaseStart; phaseStart+=ph.eta||0;
    const lines=(ph.plan||[]).filter(p=>p.entries&&p.entries.length).map(p=>({
      line:p.line,max:p.max,reserved:p.reserved,
      segs:p.entries.slice().sort((a,b)=>itemTier(a.item)-itemTier(b.item)||b.frac-a.frac)
    }));
    h+=`<div class="step-phase">`;
    h+=res.sequenced
      ? `<div class="step-h"><span class="step-n">${i+1}</span> <b>${escapeAttr(ph.name)}</b> ${ph.prio!=null?'<span class="pill craft" style="font-size:9px">#'+ph.prio+'</span>':""} <span class="proj-mini">· ~${fmtDuration(ph.eta)} · done by ${fmtDuration(ph.doneAt)} </span><span class="step-clock">(~${fmtClock(pStart+(ph.eta||0))})</span></div>`
      : res.waved
      ? `<div class="step-h"><span class="step-n">${i+1}</span> <b>Wave ${i+1} — build together</b> ${ph.members&&ph.members.length?'<span class="proj-mini">'+escapeAttr(ph.members.join(" + "))+'</span>':""} <span class="proj-mini">· ~${fmtDuration(ph.eta)} · done by ${fmtDuration(ph.doneAt)} </span><span class="step-clock">(~${fmtClock(pStart+(ph.eta||0))})</span></div>`
      : `<div class="step-h"><b>Set all lines like this and run</b> <span class="proj-mini">· ~${fmtDuration(ph.eta)} · finish by </span><span class="step-clock">~${fmtClock(pStart+(ph.eta||0))}</span></div>`;
    if(!ph.feasible)h+=`<div class="notice warn" style="font-size:11px;margin:4px 0 6px">Can't fully produce this one with the current lines${ph.unsat&&ph.unsat.length?" — "+ph.unsat.join(", ")+" need Gel":""}.</div>`;
    if(!lines.length){h+=`<div class="proj-mini" style="padding:2px 0">No line activity.</div></div>`;return;}
    h+=`<ol class="step-list">`;
    lines.forEach(L=>{
      let cum=0;
      const parts=L.segs.map(s=>{
        cum+=s.frac;
        const at=fmtClock(pStart+Math.min(cum,1)*(ph.eta||0));
        const tag=at?` <span class="proj-mini">· until </span><span class="step-clock">~${at}</span>`:"";
        if(L.reserved)return `reserve for <b>Gel</b> @${s.lvl}× (whole phase)${tag}`;
        const verb=RAWS.includes(s.item)?"produce":"craft";
        return `${verb} <b>${s.item}</b> @${s.lvl}×${s.frac>=0.999?" (whole phase)":` for ~${fmtDuration(s.frac*ph.eta)}`}${tag}`;
      });
      const segHtml=parts.map((p,idx)=>`<div class="step-seg">${idx===0?'<span class="step-then">→</span>':'<span class="step-then">then</span>'} ${p}</div>`).join('');
      h+=`<li><span class="mono" style="color:var(--amber)">Line #${L.line}</span> <span class="proj-mini">(${L.max}× cap)</span>${segHtml}</li>`;
    });
    h+=`</ol></div>`;
  });
  body.innerHTML=h;
}
const stepsModal=document.getElementById("stepsModal");
function openSteps(){renderSteps();stepsModal.hidden=false;}
function closeSteps(){stepsModal.hidden=true;}
document.getElementById("stepsClose").addEventListener("click",closeSteps);
document.getElementById("stepsDone").addEventListener("click",closeSteps);
stepsModal.addEventListener("click",e=>{if(e.target===stepsModal)closeSteps();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!stepsModal.hidden)closeSteps();});
// the Step-by-step button lives inside #results, which is re-rendered each solve
document.getElementById("results").addEventListener("click",e=>{
  if(e.target.closest&&e.target.closest("#btnProgress")){openProgress();return;}
  if(e.target.closest&&e.target.closest("#btnSteps"))openSteps();
  if(e.target.closest&&e.target.closest("#manualUpdate")){if(S.manualActiveId)updateManualPreset(S.manualActiveId);return;}
  if(e.target.closest&&e.target.closest("#manualSaveNew")){const name=(prompt("Name this setup:","")||"").trim();if(name)saveManualPreset(name);return;}
  if(e.target.closest&&e.target.closest("#manualDelPreset")){const sel=document.getElementById("manualPreset");const id=(sel&&sel.value)||S.manualActiveId;if(id&&confirm("Delete this saved setup?"))deleteManualPreset(id);return;}
});
// Manual-mode dropdowns also live inside #results (re-rendered each change)
document.getElementById("results").addEventListener("change",e=>{
  const t=e.target;if(!t||!t.getAttribute)return;
  if(t.id==="manualPreset"){if(t.value)loadManualPreset(t.value);return;}
  const ri=t.getAttribute("data-mres");
  if(ri!=null){const i=+ri;if(S.manual[i]){S.manual[i].job=t.value;if(S.manual[i].lvl>S.lines[i].max)S.manual[i].lvl=S.lines[i].max;}save();renderResults();return;}
  const lv=t.getAttribute("data-mlvl");
  if(lv!=null){const i=+lv;if(S.manual[i])S.manual[i].lvl=+t.value;save();renderResults();return;}
  const sl=t.getAttribute("data-msell");
  if(sl!=null){const i=+sl;if(S.manual[i])S.manual[i].sell=t.checked;save();renderResults();return;}
});

