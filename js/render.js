"use strict";
/* ---------- RENDER: lines ---------- */
const TIPS={
  line:"Crafter unit slot. The solver auto-sorts lines by max compression — this number only identifies which row you're editing.",
  max:"Highest compression tier this crafter is upgraded to (1×–16.38k×). The list tags each tier with its in-game level (lv12) and the caption spells out the one you have picked: level 0 is 1× and every level doubles it, so 16.38k× is level 14. Each level doubles yield per craft but triples material cost per cycle — so the solver picks the most efficient level ≤ this cap.",
  spx:"The total speed × currently shown above the crafter unit in-game (e.g. ×49.38) — enter it exactly as displayed, with your current turbo stacks already baked in.",
  turbo:"How many turbo stacks this crafter has active right now (each stack = +1% speed). With the global max-turbo-stacks figure, the planner backs out your base speed and projects the speed you'll have at full turbo.",
  maxTurbo:"The most turbo stacks any crafter can reach — a global cap (each stack = +1% speed). The planner projects every line's current speed up to this many stacks, so the plan reflects your sustained speed at full turbo.",
  dup:"Duplication chance — average % of crafts that drop a free duplicate. Adds output without spending extra material. Global to every crafter; leave 0 if you don't have dupe bonuses.",
  del:"Remove this crafter line"
};
function tipHtml(id,label,text,className="",style=""){
  return `<button type="button" class="tip${className?" "+className:""}"${style?` style="${style}"`:""} aria-label="Help for ${label}" aria-describedby="${id}">?<span class="tip-text" id="${id}" role="tooltip">${text}</span></button>`;
}
function lineLevelText(L){return "level "+compressionLevel(L);}
// A line is being projected whenever its stacks differ from the global maximum — the condition the
// per-row note is drawn under, and the only one under which "Apply max turbo" has anything to
// write. Once every line is at the cap the projection is the reading, so the button goes dead
// rather than offering a press that cannot change a field.
function syncMaxTurboButton(){
  const button=document.getElementById("btnMaxTurbo");if(!button)return;
  const mx=num(S.maxTurbo)||0;
  button.disabled=!S.lines.some(ln=>(num(ln.turbo)||0)!==mx);
}
// Levels belong in the open list, but a closed <select> mirrors its selected option's text
// and this picker is far too narrow for one. So the selected option — and only it — stays
// bare, which makes it structurally impossible for a level to reach the table; the caption
// underneath carries that one. The rest get the abbreviated "lv12", which the caption anchors:
// an option's text still feeds the column's intrinsic width, and 12 characters ("16.38k× lv14")
// is the most this column absorbs without taking pixels off speed and turbo.
function capOptionLabel(L,isSelected){return isSelected?compressionLabel(L):compressionLabel(L)+" lv"+compressionLevel(L);}
function syncCapOptions(select,max){
  [...select.options].forEach(o=>{
    const text=capOptionLabel(+o.value,+o.value===max);
    if(o.textContent!==text)o.textContent=text;
  });
}
// Lines render as a table: the three field labels and their help buttons belong to
// the columns, not to each row, so seven lines cost seven rows instead of seven
// label sets. The projected-speed readout is a column rather than a per-row note,
// so every row stays the same height and the values line up for comparison.
function renderLines(){
  const box=document.getElementById("lines");box.innerHTML="";
  const mx=num(S.maxTurbo)||0;
  const isProjected=ln=>(num(ln.turbo)||0)!==mx;
  const rows=S.lines.map((ln,i)=>{
    const opts=LEVELS.map(L=>`<option value="${L}" ${L===ln.max?"selected":""}>${capOptionLabel(L,L===ln.max)}</option>`).join("");
    const speedError=`field-line-${i}-speed-error`,turboError=`field-line-${i}-turbo-error`;
    const levelNote=`field-line-${i}-level`;
    return `<tr class="line-row">
      <td class="col-n"><span class="tag mono">#${i+1}</span></td>
      <td class="col-cap" data-label="Max compression"><select data-line="${i}" aria-label="Line ${i+1} max compression" aria-describedby="linesCapHelp ${levelNote}">${opts}</select><div class="line-lvl mono" id="${levelNote}">${lineLevelText(ln.max)}</div></td>
      <td class="col-spx" data-label="Speed \u00d7"><input type="number" ${htmlFieldInputAttributes(FIELD_SCHEMA.lineSpeed)} placeholder="1" value="${ln.spx??1}" data-spx="${i}" aria-describedby="linesSpeedHelp" data-field-error="${speedError}" aria-label="Line ${i+1} currently displayed speed multiplier">${isProjected(ln)?`<div class="line-proj mono" title="Projected speed at ${fmt(mx,0)} turbo stacks">\u2192 \u00d7${fmt(displayedLineSpeed(ln),2)}</div>`:""}</td>
      <td class="col-turbo" data-label="Turbo stacks"><input type="number" ${htmlFieldInputAttributes(FIELD_SCHEMA.turbo)} placeholder="0" value="${ln.turbo??0}" data-turbo="${i}" aria-describedby="linesTurboHelp" data-field-error="${turboError}" aria-label="Line ${i+1} current turbo stacks"></td>
      <td class="col-x"><button class="iconbtn" data-del="${i}" title="${TIPS.del}" aria-label="Remove crafter line ${i+1}">\u00d7</button></td>
    </tr>
    <tr class="line-errs"><td colspan="5"><div class="field-error" id="${speedError}" aria-live="polite" aria-atomic="true"></div><div class="field-error" id="${turboError}" aria-live="polite" aria-atomic="true"></div></td></tr>`;
  }).join("");
  const table=document.createElement("table");
  table.className="ltable";
  table.innerHTML=`<thead><tr>
      <th class="col-n"><span class="lines-th">#${tipHtml("linesSlotHelp","the line number",TIPS.line)}</span></th>
      <th class="col-cap"><span class="lines-th">max compression ${tipHtml("linesCapHelp","max compression",TIPS.max)}</span></th>
      <th class="col-spx"><span class="lines-th">speed \u00d7 ${tipHtml("linesSpeedHelp","speed multiplier",TIPS.spx,"tip-ic","--tip-img:url('../assets/speed.jpg')")}</span></th>
      <th class="col-turbo"><span class="lines-th">turbo ${tipHtml("linesTurboHelp","turbo stacks",TIPS.turbo)}</span></th>
      <th class="col-x"><span class="lines-th-sr">Remove line</span></th>
    </tr></thead><tbody>${rows}</tbody>`;
  box.appendChild(table);
  document.getElementById("lineCount").textContent=S.lines.length+" line"+(S.lines.length>1?"s":"");
  syncMaxTurboButton();
}
// Live-update the per-row notes (projected speed, compression level) when the fields
// they read change, without rebuilding the line inputs \u2014 a rebuild would steal focus
// from the field being typed into or from the select that was just picked.
function refreshLineNotes(){
  const mx=num(S.maxTurbo)||0;
  syncMaxTurboButton();
  const table=document.querySelector("#lines .ltable");if(!table)return;
  table.querySelectorAll("tbody tr.line-row").forEach((row,i)=>{
    const ln=S.lines[i];if(!ln)return;
    const lvl=row.querySelector(".col-cap .line-lvl");
    if(lvl)lvl.textContent=lineLevelText(ln.max);
    const cap=row.querySelector(".col-cap select");
    if(cap)syncCapOptions(cap,ln.max);
    const cell=row.querySelector(".col-spx");if(!cell)return;
    let note=cell.querySelector(".line-proj");
    if((num(ln.turbo)||0)!==mx){
      const txt=`\u2192 \u00d7${fmt(displayedLineSpeed(ln),2)}`;
      if(!note){note=document.createElement("div");note.className="line-proj mono";cell.appendChild(note);}
      note.textContent=txt;
      note.title=`Projected speed at ${fmt(mx,0)} turbo stacks`;
    }else if(note)note.remove();
  });
}

/* ---------- RENDER: targets ---------- */
// Ratio mode asks for an output ratio in raw item units; share mode asks for a percentage of what
// that item alone could make. The two controls therefore carry different numbers and each keeps its
// own, so switching modes never overwrites the other's settings.
function targetRow(it){
  const t=S.targets[it];
  const share=S.targetMode==="share";
  const row=document.createElement("div");row.className="tg-row"+(t.on?" on":"");
  const control=share
    ?`<span>SHARE</span>
      <input type="range" ${htmlFieldInputAttributes(FIELD_SCHEMA.targetShare)} value="${targetShareOf(t)}" data-share="${it}"
        aria-label="${it} share of its maximum">
      <span class="pv mono wide">${targetShareOf(t)}%</span>`
    :`<span>RATIO</span>
      <input type="range" ${htmlFieldInputAttributes(FIELD_SCHEMA.targetWeight)} value="${t.w}" data-w="${it}" aria-label="${it} output ratio">
      <span class="pv mono">${t.w}</span>`;
  row.innerHTML=`<label><input type="checkbox" data-tg="${it}" ${t.on?"checked":""}> ${it}</label>
    <div class="prio" style="${t.on?"":"visibility:hidden"}">${control}</div>`;
  // In share mode the percentage is meaningless without the number it is a percentage OF, so the
  // measured ceiling goes under the slider. It depends only on the factory, not on which outputs
  // are checked, so toggling a checkbox does not invalidate it; editing a line does, and the
  // existing out-of-date results bar already covers that.
  if(share&&t.on)applyTargetCeiling(row,it);
  return row;
}
function applyTargetCeiling(row,it){
  const ceiling=lastItemsCalibration()[it];
  let note=row.querySelector(".tg-ceiling");
  if(!(ceiling>0)){if(note)note.remove();return;}
  if(!note){note=domElement("div","tg-ceiling");row.appendChild(note);}
  note.textContent=`asking for ${fmt(ceiling*targetShareOf(S.targets[it])/100,0)} /hr of a possible ${fmt(ceiling,0)}`;
}
// The ceilings only exist once a share solve has returned them, which is after the rows were built.
// Patch the notes in place rather than rebuilding the list: these rows carry the slider the user may
// still be dragging, and a rebuild would destroy it mid-interaction.
function refreshTargetCeilings(){
  if(S.targetMode!=="share")return;
  document.querySelectorAll("#targets .tg-row").forEach(row=>{
    const box=row.querySelector("input[data-share]");if(!box)return;
    const it=box.dataset.share;
    if(S.targets[it]&&S.targets[it].on)applyTargetCeiling(row,it);
  });
}
// Two buttons rather than a checkbox: the modes are peers, and naming both makes it legible which
// one the numbers on screen belong to.
function renderTargetModeSwitch(){
  const box=document.getElementById("targetModeSw");if(!box)return;
  const share=S.targetMode==="share";
  box.innerHTML="";
  [["ratio","Ratio","Ask for an output ratio in item units — higher makes more of that item"],
   ["share","Share of max","Ask for a percentage of what each item could make on its own"]].forEach(([mode,label,title])=>{
    const button=domElement("button","btn"+(S.targetMode===mode?" on":""),label);
    button.type="button";button.dataset.targetmode=mode;button.title=title;
    button.setAttribute("aria-pressed",String(S.targetMode===mode));
    box.appendChild(button);
  });
  const help=document.getElementById("targetModeHelp");
  if(help)help.textContent=share
    ?"Each output asks for a share of what it could make alone, so items with very different ceilings stay comparable."
    :"Each output asks for a share of a shared ratio, counted in item units — an item that is harder to make costs more to demand.";
}
function renderTargets(){
  renderTargetModeSwitch();
  const box=document.getElementById("targets");box.innerHTML="";
  PRODUCTS.forEach(p=>box.appendChild(targetRow(p)));
  // Raw materials (Ingots / Bits / Concrete) are selectable too, so you can read their
  // max output/hr without spinning up a throwaway project plan (issue #78).
  const sub=document.createElement("div");sub.className="tg-sub";
  sub.textContent="Raw materials";
  box.appendChild(sub);
  RAWS.forEach(r=>box.appendChild(targetRow(r)));
  renderTargetPresetBar();
}
// The picker is a loader, not a mirror of the current checkboxes: it always sits on its own
// prompt and never marks a set as selected. Marking one would be a claim the checkboxes still
// match it — untrue the moment anything is toggled by hand — and it would make re-picking the
// same set fire no change event, so the set you just left could not be loaded back.
// S.targetActiveId is the set most recently loaded or saved, and the buttons name it.
// Set names are user-chosen and unbounded, but these buttons sit in the narrow input column.
// Shorten what the label shows; the button's tooltip still carries the whole name.
const TARGET_PRESET_LABEL_MAX=22;
function targetPresetLabelName(name){
  return name.length>TARGET_PRESET_LABEL_MAX?name.slice(0,TARGET_PRESET_LABEL_MAX-1).trimEnd()+"…":name;
}
function renderTargetPresetBar(){
  const box=document.getElementById("targetPresetBar");if(!box)return;
  const saved=S.targetSaved||[],active=saved.find(p=>p.id===S.targetActiveId);
  const checked=ALLITEMS.filter(it=>S.targets[it]&&S.targets[it].on).length;
  const select=domElement("select");
  select.id="targetPreset";
  select.setAttribute("aria-label","Load a saved output set");
  select.appendChild(domOption("",saved.length?"— load a saved output set —":"— no saved output sets yet —",true));
  saved.forEach(p=>select.appendChild(domOption(p.id,p.name,false)));
  const controls=[select];
  if(active){
    const update=domElement("button","btn ghost",`Update “${targetPresetLabelName(active.name)}”`);
    update.id="targetUpdate";update.type="button";
    update.title=`Overwrite “${active.name}” with the currently checked outputs`;
    controls.push(update);
    const del=domElement("button","btn ghost","Delete");
    del.id="targetDelPreset";del.type="button";del.title=`Delete “${active.name}”`;
    controls.push(del);
  }
  const saveNew=domElement("button","btn ghost","Save as new…");
  saveNew.id="targetSaveNew";saveNew.type="button";
  saveNew.title="Save the currently checked outputs and their priorities as a named set";
  controls.push(saveNew);
  const clear=domElement("button","btn ghost","Uncheck all");
  clear.id="targetUncheckAll";clear.type="button";
  clear.title="Uncheck every output";
  clear.disabled=checked===0;
  controls.push(clear);
  box.replaceChildren(...controls);
}

/* ---------- RENDER: mined resources ---------- */
const GEL_EXACT_UI_MAX_LINES=12;
const MINED_INCOME_INPUT_IDS=Object.freeze({
  Vespium:Object.freeze({rigPerMin:"minedVespiumRig",resourcesTradingPerSec:"minedVespiumTrading"}),
  Hydracite:Object.freeze({resourcesTradingPerSec:"minedHydraciteTrading"})
});
function renderMinedResources(){
  MINED_RESOURCES.forEach(resource=>{
    Object.keys(MINED_INCOME_SOURCES[resource]||{}).forEach(source=>{
      const inp=document.getElementById(MINED_INCOME_INPUT_IDS[resource]&&MINED_INCOME_INPUT_IDS[resource][source]);
      if(!inp)return;
      applyFieldInputAttributes(inp,FIELD_SCHEMA.minedIncome);
      if(document.activeElement!==inp)inp.value=(S.minedIncomeText[resource]&&S.minedIncomeText[resource][source])||"";
    });
  });
  const vespHr=supplyRate(minedBudgetHr("Vespium"));
  const vespRig=toDec0(S.minedIncome.Vespium.rigPerMin);
  const vespTrading=toDec0(S.minedIncome.Vespium.resourcesTradingPerSec);
  const vespRigHr=decScale(decClampLow(vespRig),60),vespTradingHr=decScale(decClampLow(vespTrading),3600);
  const vespBreakdown=document.getElementById("minedVespiumBreakdown");
  if(vespBreakdown)vespBreakdown.textContent=`Rig: ${disp(vespRig)}/min → ${disp(vespRigHr)}/hr + Mined: ${disp(vespTrading)}/sec → ${disp(vespTradingHr)}/hr = ${disp(vespHr)} Vespium/hr total`;
  const hydraTrading=toDec0(S.minedIncome.Hydracite.resourcesTradingPerSec);
  const hydraHr=supplyRate(minedBudgetHr("Hydracite"));
  const hydraSummary=document.getElementById("minedHydraciteSummary");
  if(hydraSummary)hydraSummary.textContent=`Mined: ${disp(hydraTrading)}/sec → ${disp(hydraHr)} Hydracite/hr total`;
  const rows=lineRows(),exact=rows.length<=GEL_EXACT_UI_MAX_LINES;
  // Exact multiple-choice capacity is responsive through the gameplay-scale 12-line boundary.
  // Larger compatible saves use the bounded solver seed with explicitly estimated copy.
  const lo=exact?gelLoadout(rows,vespHr):gelSeedLoadout(rows,vespHr);
  const summary=document.getElementById("minedVespiumSummary");
  if(summary)summary.textContent=exact
    ?(vespHr>0?`Gel/hr capacity: ${disp(lo.gelHr)}`:"Gel/hr capacity: off")
    :(vespHr>0?`Estimated capacity: ${disp(lo.gelHr)} Gel/hr`:"Estimated capacity: off");
  renderMinedGelLoadout(lo,vespHr,exact);
  renderMinedCostRows("Gel","minedVespiumCosts");
  renderMinedCostRows("Batteries","minedHydraciteCosts");
}
function renderMinedGelLoadout(lo,vespHr,exact=true){
  const box=document.getElementById("minedGelLoadout");if(!box)return;
  if(vespHr<=0){box.innerHTML=`<p class="help mined-help">No Vespium income set — Gel is off, so Gel-consuming items (Wire and Batteries) can't be planned until you enter your income.</p>`;return;}
  if(!lo.perLine.length){box.innerHTML=`<div class="notice warn mined-summary">Your Vespium income is too low to run Gel on any current line. Raise your income (or add a lower-cap line) to make Gel.</div>`;return;}
  const head=exact
    ?(lo.vespHr<vespHr-1e-6
      ? `Each line runs one compression full-time; this loadout burns <b>${disp(lo.vespHr)}</b> of your <b>${disp(vespHr)}</b> Vespium/hr (the rest is profit — raise a line's cap to spend it).`
      : `Each line runs one compression full-time, burning <b>${disp(lo.vespHr)}</b> of your <b>${disp(vespHr)}</b> Vespium/hr.`)
    : `Each selected line runs one compression full-time. This bounded estimate burns <b>${disp(lo.vespHr)}</b> of your <b>${disp(vespHr)}</b> Vespium/hr; unused income may reflect the heuristic rather than a capacity limit.`;
  const claim=exact
    ?`With <b>${disp(vespHr)}</b> total Vespium/hr you can sustain up to <b>${disp(lo.gelHr)}</b> Gel/hr. ${head} Best loadout if you put everything you can on Gel:`
    :`<b>Estimated capacity.</b> With <b>${disp(vespHr)}</b> total Vespium/hr, the bounded search found <b>${disp(lo.gelHr)}</b> Gel/hr. ${head} Best found loadout if you put everything you can on Gel:`;
  let h=`<div class="notice info mined-summary">${claim}</div>
    <div class="mined-table-wrap"><table><thead><tr><th>Line</th><th>Compression</th><th class="num">Gel /hr</th><th class="num">Vespium /hr</th></tr></thead><tbody>`;
  lo.perLine.slice().sort((a,b)=>a.__i-b.__i).forEach(p=>{
    h+=`<tr><td class="mono">#${p.__i+1}</td><td class="mono">${compressionLabel(p.L)}</td>
      <td class="num">${disp(p.gelHr)}</td><td class="num" style="color:var(--ink2)">${disp(p.vespHr)}</td></tr>`;
  });
  h+=`</tbody></table></div>`;
  box.innerHTML=h;
  if(typeof markTableScroller==="function")markTableScroller(box.querySelector(".mined-table-wrap"),"Gel production by crafter line table");
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
  if(typeof markTableScroller==="function")markTableScroller(box,`${item} mined-resource costs by compression table`);
}

/* ---------- RENDER: recipe data ---------- */
function renderRecipes(){
  const box=document.getElementById("recipes");box.innerHTML="";
  RAWS.forEach(r=>box.appendChild(rawCard(r)));
  PRODUCTS.forEach(p=>box.appendChild(prodCard(p)));
}
function baseTimeField(item){
  const v=S.baseTime[item]??12.85;
  const errorId=`field-base-time-${fieldDomToken(item)}-error`;
  return `<div class="base-time-field" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 8px">
    <span style="font-size:10.5px;color:var(--ink3)">base time @1× (s)</span>
    <span class="field-stack"><input type="number" ${htmlFieldInputAttributes(FIELD_SCHEMA.baseTime)} class="base-time-input" value="${v}" data-res="${item}" data-fld="baseT" data-field-error="${errorId}" aria-label="${item} base time at 1x in seconds"><span class="field-error" id="${errorId}" aria-live="polite" aria-atomic="true"></span></span></div>`;
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
      const errorId=`field-recipe-${fieldDomToken(p)}-${fieldDomToken(k)}-${L}-error`;
      cells+=`<td><span class="field-stack"><input type="number" ${htmlFieldInputAttributes(FIELD_SCHEMA.recipeCost)} placeholder="–" value="${v??""}"
        data-res="${p}" data-fld="cost" data-in="${k}" data-lv="${L}" data-field-error="${errorId}" aria-label="${p} recipe ${k} cost at compression ${L}x"><span class="field-error" id="${errorId}" aria-live="polite" aria-atomic="true"></span></span></td>`;
    });
    rows+=`<tr>${cells}</tr>`;
  });
  const subt=ins.length?ins.join(" + ")+" → "+p:"Vespium + Rocks → "+p;
  const batchYield=RECIPE[p].baseOutput||1;
  const batchNote=batchYield>1
    ? `<div class="notice info" style="font-size:10.5px;margin:0 2px 8px"><b>Batch output:</b> ${disp(batchYield)} × compression units per craft. Costs below remain per craft; duplication increases output only.</div>`
    : "";
  const body=ins.length
    ? `<table class="rtab"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
    : `<div style="font-size:10.5px;color:var(--ink3);margin:0 2px">Gel is crafted on a crafter line. Each craft consumes <b>Vespium</b> from your mined-income budget and also has an informational <b>Rocks</b> cost. Review both in <b>Mined resources</b>.</div>`;
  c.innerHTML=`<div class="rh"><span class="nm">${p}</span><span class="ty ${tyCls}">${tyLbl}</span></div>
    <div class="rb"><div style="font-size:10.5px;color:var(--ink3);margin:0 2px 6px">${subt}</div>
    ${baseTimeField(p)}
    ${batchNote}
    ${body}</div>`;
  const recipeTable=c.querySelector("table");
  if(recipeTable&&typeof markTableScroller==="function")markTableScroller(recipeTable.parentElement,`${p} recipe costs by compression table`);
  return c;
}
