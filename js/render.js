"use strict";
/* ---------- RENDER: lines ---------- */
const TIPS={
  line:"Crafter unit slot. The solver auto-sorts lines by max compression — this number only identifies which row you're editing.",
  max:"Highest compression tier this crafter is upgraded to (1×–1024×). Each level doubles yield per craft but triples material cost per cycle — so the solver picks the most efficient level ≤ this cap.",
  spx:"The total speed × currently shown above the crafter unit in-game (e.g. ×49.38) — enter it exactly as displayed, with your current turbo stacks already baked in.",
  turbo:"How many turbo stacks this crafter has active right now (each stack = +1% speed). With the global max-turbo-stacks figure, the planner backs out your base speed and projects the speed you'll have at full turbo.",
  dup:"Duplication chance — average % of crafts that drop a free duplicate. Adds output without spending extra material. Leave 0 if you don't have dupe bonuses.",
  maxTurbo:"The most turbo stacks any crafter can reach — a global cap (each stack = +1% speed). The planner projects every line's current speed up to this many stacks, so the plan reflects your sustained speed at full turbo.",
  del:"Remove this crafter line"
};
function renderLines(){
  const box=document.getElementById("lines");box.innerHTML="";
  S.lines.forEach((ln,i)=>{
    const opts=LEVELS.map(L=>`<option value="${L}" ${L===ln.max?"selected":""}>${L}×</option>`).join("");
    const row=document.createElement("div");row.className="line-row";
    const finalSp=lineSpeed(ln), projected=(num(ln.turbo)||0)!==(num(S.maxTurbo)||0);
    const spNote=projected?`<div class="line-final mono">→ ×${fmt(finalSp,2)} at ${fmt(num(S.maxTurbo)||0,0)} turbo stacks</div>`:"";
    row.innerHTML=`<div class="tag mono">#${i+1}</div>
      <div><div class="lname">Line ${i+1}<i class="tip" tabindex="0" data-tip="${TIPS.line}">?</i></div>
        <div class="line-fields">
          <label class="fl"><span>max compression</span><select data-line="${i}" aria-label="Max compression">${opts}</select></label>
          <label class="fl"><span>speed × <i class="tip tip-right tip-ic" tabindex="0" style="--tip-img:url('/assets/speed.jpg')" data-tip="${TIPS.spx}">?</i></span><input type="number" min="0" step="any" placeholder="1" value="${ln.spx??1}" data-spx="${i}" aria-label="Currently displayed speed multiplier"></label>
          <label class="fl"><span>turbo stacks <i class="tip tip-right" tabindex="0" data-tip="${TIPS.turbo}">?</i></span><input type="number" min="0" step="any" placeholder="0" value="${ln.turbo??0}" data-turbo="${i}" aria-label="Current turbo stacks"></label>
          <label class="fl"><span>dupe % <i class="tip tip-right tip-ic" tabindex="0" style="--tip-img:url('/assets/dupe.jpg')" data-tip="${TIPS.dup}">?</i></span><input type="number" min="0" max="100" step="any" placeholder="0" value="${ln.dup??0}" data-dup="${i}" aria-label="Duplication chance percent"></label>
        </div>${spNote}</div>
      <button class="iconbtn" data-del="${i}" title="${TIPS.del}" aria-label="${TIPS.del}">×</button>`;
    box.appendChild(row);
  });
  document.getElementById("lineCount").textContent=S.lines.length+" line"+(S.lines.length>1?"s":"");
}
// Live-update the "→ ×NN at full turbo" readouts when speed/turbo/max-turbo change,
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
function renderTargets(){
  const box=document.getElementById("targets");box.innerHTML="";
  PRODUCTS.forEach(p=>{
    const t=S.targets[p];
    const row=document.createElement("div");row.className="tg-row"+(t.on?" on":"");
    row.innerHTML=`<label><input type="checkbox" data-tg="${p}" ${t.on?"checked":""}> ${p}</label>
      <div class="prio" style="${t.on?"":"visibility:hidden"}">
        <span>PRIORITY</span>
        <input type="range" min="1" max="9" step="1" value="${t.w}" data-w="${p}">
        <span class="pv mono">${t.w}</span></div>`;
    box.appendChild(row);
  });
}

/* ---------- RENDER: Gel panel ---------- */
function renderGel(){
  const sel=document.getElementById("gelComp");
  if(sel.options.length===0)LEVELS.forEach(L=>sel.add(new Option(L+"×",L)));
  sel.value=S.gelComp;
  document.getElementById("gelLines").value=S.gelLines||0;
  const n=Math.min(Math.max(0,Math.floor(num(S.gelLines)||0)),S.lines.length);
  document.getElementById("gelSummary").textContent=n>0?("up to "+n+" @ "+S.gelComp+"×"):"off";
}
document.getElementById("gelToggle").addEventListener("click",()=>{
  const b=document.getElementById("gelBody"),t=document.getElementById("gelToggle");
  b.hidden=!b.hidden;t.setAttribute("aria-expanded",b.hidden?"false":"true");
});
document.getElementById("gelBody").addEventListener("input",e=>{
  if(e.target.id==="gelLines"){S.gelLines=Math.max(0,Math.floor(num(e.target.value)||0));}
  else if(e.target.id==="gelComp"){S.gelComp=+e.target.value;}
  renderGel();scheduleSolve();
});
// custom stepper buttons for the Gel-lines field (native spin arrows don't render)
document.getElementById("gelBody").addEventListener("click",e=>{
  const btn=e.target.closest(".stepper-up,.stepper-down");if(!btn)return;
  const inp=document.getElementById("gelLines");
  const cur=Math.max(0,Math.floor(num(inp.value)||0));
  const next=Math.max(0,Math.min(S.lines.length,cur+(btn.classList.contains("stepper-up")?1:-1)));
  if(next===cur)return;
  inp.value=next;inp.dispatchEvent(new Event("input",{bubbles:true}));
});

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
    <input type="number" min="0" step="any" style="width:70px" value="${v}" data-res="${item}" data-fld="baseT"></div>`;
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
    let cells=`<td class="lv">${L}×</td>`;
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
    : `<div style="font-size:10.5px;color:var(--ink3);margin:0 2px">Forged from mined ore (free, not crafted). Produced only on lines you reserve in the <b>Gel lines</b> panel.</div>`;
  c.innerHTML=`<div class="rh"><span class="nm">${p}</span><span class="ty ${tyCls}">${tyLbl}</span></div>
    <div class="rb"><div style="font-size:10.5px;color:var(--ink3);margin:0 2px 6px">${subt}</div>
    ${baseTimeField(p)}
    ${body}</div>`;
  return c;
}

