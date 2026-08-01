"use strict";
/* ---------- RENDER: lines ---------- */
const TIPS={
  line:"Crafter unit slot. The solver auto-sorts lines by max compression — this number only identifies which row you're editing.",
  max:"Highest compression tier this crafter is upgraded to (1×–16.4k×). Each level doubles yield per craft but triples material cost per cycle — so the solver picks the most efficient level ≤ this cap.",
  spx:"The total speed × currently shown above the crafter unit in-game (e.g. ×49.38) — enter it exactly as displayed, with your current turbo stacks already baked in.",
  turbo:"How many turbo stacks this crafter has active right now (each stack = +1% speed). With the global max-turbo-stacks figure, the planner backs out your base speed and projects the speed you'll have at full turbo.",
  maxTurbo:"The most turbo stacks any crafter can reach — a global cap (each stack = +1% speed). The planner projects every line's current speed up to this many stacks, so the plan reflects your sustained speed at full turbo.",
  dup:"Duplication chance — average % of crafts that drop a free duplicate. Adds output without spending extra material. Global to every crafter; leave 0 if you don't have dupe bonuses.",
  del:"Remove this crafter line"
};
function renderLines(){
  const box=document.getElementById("lines");box.innerHTML="";
  S.lines.forEach((ln,i)=>{
    const opts=LEVELS.map(L=>`<option value="${L}" ${L===ln.max?"selected":""}>${compressionLabel(L)}</option>`).join("");
    const row=document.createElement("div");row.className="line-row";
    const projected=(num(ln.turbo)||0)!==(num(S.maxTurbo)||0);
    const spNote=projected?`<div class="line-final mono">→ ×${fmt(lineSpeed(ln),2)} at ${fmt(num(S.maxTurbo)||0,0)} turbo stacks</div>`:"";
    row.innerHTML=`<div class="tag mono">#${i+1}</div>
      <div><div class="lname">Line ${i+1}<i class="tip" tabindex="0" data-tip="${TIPS.line}">?</i></div>
        <div class="line-fields">
          <label class="fl"><span>max compression</span><select data-line="${i}" aria-label="Max compression">${opts}</select></label>
          <label class="fl"><span>speed × <i class="tip tip-right tip-ic" tabindex="0" style="--tip-img:url('/assets/speed.jpg')" data-tip="${TIPS.spx}">?</i></span><input type="number" min="0" step="any" placeholder="1" value="${ln.spx??1}" data-spx="${i}" aria-label="Currently displayed speed multiplier"></label>
          <label class="fl"><span>turbo stacks <i class="tip tip-right" tabindex="0" data-tip="${TIPS.turbo}">?</i></span><input type="number" min="0" step="any" placeholder="0" value="${ln.turbo??0}" data-turbo="${i}" aria-label="Current turbo stacks"></label>
        </div>${spNote}</div>
      <button class="iconbtn" data-del="${i}" title="${TIPS.del}" aria-label="${TIPS.del}">×</button>`;
    box.appendChild(row);
  });
  document.getElementById("lineCount").textContent=S.lines.length+" line"+(S.lines.length>1?"s":"");
}
// Live-update the projected-speed readouts when speed/turbo/max-turbo change,
// without rebuilding the line inputs (which would steal focus while typing).
function refreshLineNotes(){
  const mx=num(S.maxTurbo)||0;
  document.querySelectorAll("#lines .line-row").forEach((row,i)=>{
    const ln=S.lines[i];if(!ln)return;
    let note=row.querySelector(".line-final");
    if((num(ln.turbo)||0)!==mx){
      const txt=`→ ×${fmt(lineSpeed(ln),2)} at ${fmt(mx,0)} turbo stacks`;
      if(note)note.textContent=txt;
      else{note=document.createElement("div");note.className="line-final mono";note.textContent=txt;row.querySelector(".line-fields").parentNode.appendChild(note);}
    }else if(note)note.remove();
  });
}

/* ---------- RENDER: targets ---------- */
function targetRow(it){
  const t=S.targets[it];
  const row=document.createElement("div");row.className="tg-row"+(t.on?" on":"");
  row.innerHTML=`<label><input type="checkbox" data-tg="${it}" ${t.on?"checked":""}> ${it}</label>
    <div class="prio" style="${t.on?"":"visibility:hidden"}">
      <span>PRIORITY</span>
      <input type="range" min="1" max="9" step="1" value="${t.w}" data-w="${it}">
      <span class="pv mono">${t.w}</span></div>`;
  return row;
}
function renderTargets(){
  const box=document.getElementById("targets");box.innerHTML="";
  PRODUCTS.forEach(p=>box.appendChild(targetRow(p)));
  // Raw materials (Ingots / Bits / Concrete) are selectable too, so you can read their
  // max output/hr without spinning up a throwaway project plan (issue #78).
  const sub=document.createElement("div");sub.className="tg-sub";
  sub.textContent="Raw materials";
  box.appendChild(sub);
  RAWS.forEach(r=>box.appendChild(targetRow(r)));
}

/* ---------- RENDER: mined resources ---------- */
function renderMinedResources(){
  MINED_RESOURCES.forEach(resource=>{
    const inp=document.getElementById("mined"+resource);
    if(inp&&document.activeElement!==inp)inp.value=S.minedIncomeText[resource]||"";
  });
  const vespHr=minedBudgetHr("Vespium");
  // Preserve the established Gel capacity/loadout calculation across all current lines.
  const lo=gelLoadout(lineRows(),vespHr);
  const summary=document.getElementById("minedVespiumSummary");
  if(summary)summary.textContent=vespHr>0?`Gel/hr capacity: ${disp(lo.gelHr)}`:"Gel/hr capacity: off";
  renderMinedGelLoadout(lo,vespHr);
  renderMinedCostRows("Gel","minedVespiumCosts");
  renderMinedCostRows("Batteries","minedHydraciteCosts");
}
function renderMinedGelLoadout(lo,vespHr){
  const box=document.getElementById("minedGelLoadout");if(!box)return;
  if(vespHr<=0){box.innerHTML=`<p class="help mined-help">No Vespium income set — Gel is off, so Gel-consuming items (Wire and Batteries) can't be planned until you enter your income.</p>`;return;}
  if(!lo.perLine.length){box.innerHTML=`<div class="notice warn mined-summary">Your Vespium income is too low to run Gel on any current line. Raise your income (or add a lower-cap line) to make Gel.</div>`;return;}
  const head=lo.vespHr<vespHr-1e-6
    ? `Each line runs one compression full-time; this loadout burns <b>${disp(lo.vespHr)}</b> of your <b>${disp(vespHr)}</b> Vespium/hr (the rest is profit — raise a line's cap to spend it).`
    : `Each line runs one compression full-time, burning <b>${disp(lo.vespHr)}</b> of your <b>${disp(vespHr)}</b> Vespium/hr.`;
  let h=`<div class="notice info mined-summary">With <b>${disp(num(S.minedIncome.Vespium)||0)}</b> Vespium/min you can sustain up to <b>${disp(lo.gelHr)}</b> Gel/hr. ${head} Best loadout if you put everything you can on Gel:</div>
    <div class="mined-table-wrap"><table><thead><tr><th>Line</th><th>Compression</th><th class="num">Gel /hr</th><th class="num">Vespium /hr</th></tr></thead><tbody>`;
  lo.perLine.slice().sort((a,b)=>a.__i-b.__i).forEach(p=>{
    h+=`<tr><td class="mono">#${p.__i+1}</td><td class="mono">${compressionLabel(p.L)}</td>
      <td class="num">${disp(p.gelHr)}</td><td class="num" style="color:var(--ink2)">${disp(p.vespHr)}</td></tr>`;
  });
  h+=`</tbody></table></div>`;
  box.innerHTML=h;
}
function renderMinedCostRows(item,targetId){
  const box=document.getElementById(targetId),cfg=MINED_CRAFTS[item];if(!box||!cfg)return;
  const resources=Object.keys({...cfg.informationalCosts,...cfg.baseCosts});
  let h=`<table><thead><tr><th>Compression</th>${resources.map(r=>`<th class="num">${r} /craft</th>`).join("")}
    <th class="num">Real s/craft</th>${resources.map(r=>`<th class="num">${r} /min</th>`).join("")}</tr></thead><tbody>`;
  LEVELS.forEach(L=>{
    const costs=minedCost(item,L),ct=craftTime(item,L);
    let best=null;
    S.lines.forEach(ln=>{if((ln.max||0)>=L){const sp=lineSpeed(ln);if(best==null||sp>best)best=sp;}});
    let seconds=null,cpm=null;
    if(best!=null&&ct>0){seconds=ct/effSpeed(best,ct);cpm=60/seconds;}
    h+=`<tr><td class="mono">${compressionLabel(L)}</td>${resources.map(r=>`<td class="num">${disp(costs[r])}</td>`).join("")}
      <td class="num mono mined-line-dependent">${seconds==null?"—":fmt(seconds,2)}</td>${resources.map(r=>`<td class="num mined-line-dependent">${cpm==null?"—":disp(costs[r]*cpm)}</td>`).join("")}</tr>`;
  });
  box.innerHTML=h+`</tbody></table>`;
}

/* ---------- RENDER: recipe data ---------- */
function renderRecipes(){
  const box=document.getElementById("recipes");box.innerHTML="";
  RAWS.forEach(r=>box.appendChild(rawCard(r)));
  PRODUCTS.forEach(p=>box.appendChild(prodCard(p)));
}
function baseTimeField(item){
  const v=S.baseTime[item]??12.85;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 8px">
    <span style="font-size:10.5px;color:var(--ink3)">base time @1× (s)</span>
    <input type="number" min="0" step="any" class="base-time-input" value="${v}" data-res="${item}" data-fld="baseT"></div>`;
}
function rawCard(r){
  const c=document.createElement("div");c.className="rcard";
  c.innerHTML=`<div class="rh"><span class="nm">${r}</span><span class="ty raw">raw</span></div>
    <div class="rb">${baseTimeField(r)}
    <div style="font-size:10.5px;color:var(--ink3);margin:0 2px">No material input. Rate = compression yield ÷ (base time × 1.5^level ÷ line total-speed).</div></div>`;
  return c;
}
function prodCard(p){
  const c=document.createElement("div");c.className="rcard";
  const ins=RECIPE[p].inputs;
  const tyCls=KIND[p]==="fin"?"fin":"pr";
  const tyLbl=KIND[p]==="fin"?"assembly":"craft";
  let head=`<th>Lvl</th>`+ins.map(k=>`<th style="text-align:right">${k} cost</th>`).join("");
  let rows="";
  [...LEVELS].reverse().forEach(L=>{
    let cells=`<td class="lv">${compressionLabel(L)}</td>`;
    ins.forEach(k=>{
      const v=S.prodCost[p][k][L];
      cells+=`<td><input type="number" min="0" step="any" placeholder="–" value="${v??""}"
        data-res="${p}" data-fld="cost" data-in="${k}" data-lv="${L}"></td>`;
    });
    rows+=`<tr>${cells}</tr>`;
  });
  const subt=ins.length?ins.join(" + ")+" → "+p:"mined ore → "+p;
  const body=ins.length
    ? `<table class="rtab"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
    : `<div style="font-size:10.5px;color:var(--ink3);margin:0 2px">Forged from mined ore (free, not crafted). Set Vespium income and review eligible lines in <b>Mined resources</b>.</div>`;
  c.innerHTML=`<div class="rh"><span class="nm">${p}</span><span class="ty ${tyCls}">${tyLbl}</span></div>
    <div class="rb"><div style="font-size:10.5px;color:var(--ink3);margin:0 2px 6px">${subt}</div>
    ${baseTimeField(p)}
    ${body}</div>`;
  return c;
}
