"use strict";
/* ---------- Manual configuration mode ---------- */
// No solver: every line's job is set by hand. Compute the resulting production,
// consumption and balance directly, so the user can try setups that aren't optimal
// but suit their purposes — and see at a glance whether each input keeps up.
function manualResult(){
  const resources=[...RAWS,...PRODUCTS];
  const resIndex={};resources.forEach((r,i)=>resIndex[r]=i);
  const produced=resources.map(()=>0), consumed=resources.map(()=>0);
  const forgie={};resources.forEach(r=>{forgie[r]=forgieHr(r);produced[resIndex[r]]+=forgie[r];});
  const plan=[]; const issueSet=new Set();
  let vespCons=0;   // vespium/hr burned by hand-assigned Gel lines (budgeted against the income)
  S.lines.forEach((ln,i)=>{
    const m=S.manual[i]||{job:"Idle",lvl:ln.max};
    const sp=lineSpeed(ln), dp=dupeMult();
    let job;
    if(m.job==="Idle"||!ALLITEMS.includes(m.job)){
      job={kind:"idle",res:null,lvl:null,ct:0,prod:[],cons:[]};
    }else{
      const item=m.job, L=Math.min(LEVELS.includes(m.lvl)?m.lvl:ln.max,ln.max), ct=craftTime(item,L);
      const eff=effSpeed(sp,ct), rate=ct>0?L/ct:0, cons=[];
      if(item===GEL){vespCons+=gelVespHr(ln,L);}
      else if(!RAWS.includes(item)){
        RECIPE[item].inputs.forEach(k=>{const c=S.prodCost[item][k][L];
          if(c==null||isNaN(c)){issueSet.add("No material cost entered for "+item+" @"+L+"×.");}
          else{cons.push([resIndex[k],c/ct]);consumed[resIndex[k]]+=(c/ct)*eff*3600;}});
      }
      produced[resIndex[item]]+=rate*eff*dp*3600;
      job={kind:(RAWS.includes(item)||item===GEL)?"produce":"craft",res:item,lvl:L,ct,prod:[[resIndex[item],rate]],cons};
    }
    plan.push({line:i+1,max:ln.max,spx:sp,dup:dupeChance(),sp,dp,job});
  });
  const balance=resources.map(r=>{const i=resIndex[r];return {res:r,prod:Math.max(0,produced[i]-forgie[r]),forgie:forgie[r],cons:consumed[i]};});
  const out={};resources.forEach(r=>{const i=resIndex[r];out[r]=produced[i]-consumed[i];});
  // line production per resource (excludes Lil' Forgie's passive supply)
  const lineProd={};resources.forEach(r=>{const i=resIndex[r];lineProd[r]=Math.max(0,produced[i]-forgie[r]);});
  // selling: an item is sold if any non-idle line producing it is flagged. Credits come off
  // its NET surplus (you can't sell what the chain consumes), valued at its sell price.
  const sold=new Set();
  plan.forEach((p,i)=>{const m=S.manual[i];if(m&&m.sell&&p.job.kind!=="idle"&&p.job.res)sold.add(p.job.res);});
  const creditRows=[];let totalCredits=0,missingPrice=false;
  [...sold].forEach(it=>{const surplus=Math.max(0,out[it]),price=num(S.sellPrice&&S.sellPrice[it])||0,credits=surplus*price;
    if(price<=0&&surplus>1e-6)missingPrice=true;totalCredits+=credits;creditRows.push({item:it,surplus,price,credits});});
  creditRows.sort((a,b)=>b.credits-a.credits);
  const vespIncomeHr=Math.max(0,num(S.gelVesp)||0)*60;
  return {plan,balance,out,resIndex,issues:[...issueSet],lineProd,soldItems:[...sold],creditRows,totalCredits,missingPrice,vespCons,vespIncomeHr};
}
/* ---- saved manual setups (named presets of the per-line job/level/sell) ---- */
function saveManualPreset(name){
  syncManual(S);
  const config=S.manual.map(m=>({job:m.job,lvl:m.lvl,sell:!!m.sell}));
  const id=newId();
  if(!Array.isArray(S.manualSaved))S.manualSaved=[];
  S.manualSaved.push({id,name,config});
  S.manualActiveId=id;save();renderResults();
}
function loadManualPreset(id){
  const p=(S.manualSaved||[]).find(x=>x.id===id);if(!p)return;
  S.manual=p.config.map(c=>({job:c.job,lvl:c.lvl,sell:!!c.sell}));
  S.manualActiveId=id;syncManual(S);save();renderResults();
}
// Overwrite an existing saved setup with the current line config (keeps its id + name).
function updateManualPreset(id){
  const p=(S.manualSaved||[]).find(x=>x.id===id);if(!p)return;
  syncManual(S);
  p.config=S.manual.map(m=>({job:m.job,lvl:m.lvl,sell:!!m.sell}));
  S.manualActiveId=id;save();renderResults();
}
function deleteManualPreset(id){
  S.manualSaved=(S.manualSaved||[]).filter(p=>p.id!==id);
  if(S.manualActiveId===id)S.manualActiveId=null;
  save();renderResults();
}
function renderManual(el,stat){
  syncManual(S);
  const res=manualResult();
  let html=`<div class="notice info"><b>Manual mode.</b> Assign each line a resource and a compression level by hand. The <b>balance</b> table below shows whether every input is produced fast enough to sustain the setup — a negative surplus (<b>short</b>) means that input runs dry. Compression is capped at each line's max.</div>`;
  // saved-setup bar: name the current layout, then swap between presets at will
  const saved=S.manualSaved||[];
  const active=saved.find(p=>p.id===S.manualActiveId);
  const presetOpts=`<option value="">${saved.length?"— load a saved setup —":"— no saved setups yet —"}</option>`+
    saved.map(p=>`<option value="${p.id}"${p.id===S.manualActiveId?" selected":""}>${escapeAttr(p.name)}</option>`).join("");
  html+=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
    <select id="manualPreset" aria-label="Load a saved setup" style="flex:1;min-width:150px">${presetOpts}</select>
    ${active?`<button class="btn ghost" id="manualUpdate" title="Overwrite “${escapeAttr(active.name)}” with the current setup">Update “${escapeAttr(active.name)}”</button>`:""}
    <button class="btn ghost" id="manualSaveNew">Save as new…</button>
    ${saved.length?'<button class="btn ghost" id="manualDelPreset" title="Delete the selected saved setup">Delete</button>':""}
  </div>`;
  if(res.issues.length)html+=`<div class="notice warn"><b>Missing data:</b><br>${res.issues.join("<br>")}</div>`;
  // headline cards: credits from sold surplus first, then net surplus of items actually
  // crafted/produced on a line (Lil' Forgie's passive-only items are excluded)
  const nets=[...PRODUCTS,...RAWS].filter(it=>res.lineProd[it]>1e-6&&res.out[it]>1e-6);
  let cards="";
  if(res.totalCredits>1e-6)cards+=`<div class="metric"><div class="l">Credits</div><div class="v">${disp(res.totalCredits)}</div><div class="u">per hour — sold surplus</div></div>`;
  nets.forEach(t=>{cards+=`<div class="metric"><div class="l">${t}</div><div class="v">${disp(res.out[t])}</div><div class="u">net surplus /hr</div></div>`;});
  if(cards)html+=`<div class="metrics">${cards}</div>`;
  // editable per-line setup
  html+=`<div class="subhead">Manual line setup</div>
    <table><thead><tr><th>Line</th><th>Cap</th><th>Resource</th><th>Compression</th>
      <th class="num">Output /hr</th><th>Consumes /hr</th><th>Sell</th></tr></thead><tbody>`;
  res.plan.forEach((p,i)=>{
    const ln=S.lines[i], m=S.manual[i], j=p.job;
    const resOpts=`<option value="Idle"${m.job==="Idle"?" selected":""}>— idle —</option>`+
      `<optgroup label="Raw materials">`+RAWS.map(it=>`<option value="${it}"${it===m.job?" selected":""}>${it}</option>`).join("")+`</optgroup>`+
      `<optgroup label="Crafted">`+PRODUCTS.map(it=>`<option value="${it}"${it===m.job?" selected":""}>${it}</option>`).join("")+`</optgroup>`;
    const lvlOpts=LEVELS.filter(L=>L<=ln.max).map(L=>`<option value="${L}"${L===m.lvl?" selected":""}>${L}×</option>`).join("");
    let outv="—",cons="";
    if(j.kind!=="idle"){const eff=effSpeed(p.sp,j.ct);
      outv=disp(j.prod[0][1]*eff*p.dp*3600);
      cons=j.res===GEL?gelOreConsumesHr(j.lvl,eff)
          :j.cons.length?j.cons.map(c=>disp(c[1]*eff*3600)+" "+invName(res.resIndex,c[0])).join(", ")
                        :'<span style="color:var(--ink3)">none</span>';}
    const tags=`<span style="color:var(--ink3);font-size:10.5px"> ×${fmt(p.sp,2)} spd</span>${p.dup>0?` <span style="color:var(--ink3);font-size:10.5px">+${fmt(p.dup,2)}% dup</span>`:""}`;
    const sellCell=j.kind==="idle"?'<span style="color:var(--ink3)">—</span>'
      :`<input type="checkbox" data-msell="${i}" ${m.sell?"checked":""} aria-label="Sell line ${p.line} surplus">`;
    html+=`<tr><td class="mono">#${p.line}</td><td class="mono">${ln.max}×${tags}</td>
      <td><select data-mres="${i}" aria-label="Line ${p.line} resource">${resOpts}</select></td>
      <td><select data-mlvl="${i}" aria-label="Line ${p.line} compression"${j.kind==="idle"?" disabled":""}>${lvlOpts}</select></td>
      <td class="num">${outv}</td><td style="color:var(--ink2);font-size:11.5px">${cons}</td>
      <td style="text-align:center">${sellCell}</td></tr>`;
  });
  html+=`</tbody></table>`;
  // selling — credits from the net surplus of flagged items
  if(res.soldItems.length){
    html+=`<div class="subhead">Selling — credits from surplus</div>`;
    if(res.missingPrice)html+=`<div class="notice info" style="font-size:11.5px">Some flagged items have no sell price yet — open <b>Sell prices</b> at the top of the page to set them. Credits use each item's <b>net surplus</b>, so anything the chain consumes isn't counted.</div>`;
    html+=`<table><thead><tr><th>Item</th><th class="num">Net surplus /hr</th><th class="num">Sell price</th><th class="num">Credits /hr</th></tr></thead><tbody>`;
    res.creditRows.forEach(c=>{
      html+=`<tr><td>${c.item}</td><td class="num">${disp(c.surplus)}</td>
        <td class="num mono" style="color:var(--ink2)">${c.price>0?disp(c.price):'<span style="color:var(--ink3)">— no price</span>'}</td>
        <td class="num" style="color:${c.credits>1e-6?'var(--amber)':'var(--ink3)'};font-weight:${c.credits>1e-6?'600':'400'}">${c.credits>1e-6?disp(c.credits):"—"}</td></tr>`;
    });
    html+=`<tr style="border-top:1px solid var(--line2)"><td><b>Total</b></td><td></td><td></td>
      <td class="num" style="color:var(--amber);font-weight:700">${disp(res.totalCredits)}</td></tr>`;
    html+=`</tbody></table>`;
  }
  // resource balance — only resources actually in play, plus Frames' & Wire's pre-produced Bits (display only)
  const ppBits=preprodBitsHr(res.plan);
  const bal=res.balance.filter(b=>b.prod>1e-6||b.cons>1e-6||(b.forgie||0)>1e-6).map(b=>({...b}));
  if(ppBits>1e-6){   // fold the pre-produced Bits in, or add a row if Bits isn't already in play
    const ex=bal.find(b=>b.res==="Bits");
    if(ex){ex.cons=(ex.cons||0)+ppBits;ex.preProd=true;}
    else bal.push({res:"Bits",prod:0,forgie:num(S.forgie&&S.forgie.Bits)||0,cons:ppBits,preProd:true});
  }
  // Gel runs on vespium: show its burn against the income, flagging a deficit ("short") when over budget.
  if(res.vespCons>1e-6)bal.push({res:"Vespium",prod:0,forgie:res.vespIncomeHr,cons:res.vespCons,vesp:true});
  if(!bal.length){
    html+=`<div class="notice info" style="font-size:11.5px">All lines are idle — pick a resource for at least one line above to see a balance.</div>`;
  }else{
    const showForgie=bal.some(b=>(b.forgie||0)>1e-6);
    html+=`<div class="subhead">Resource balance (per hour)</div>
      <table><thead><tr><th>Resource</th><th class="num">Lines</th>${showForgie?'<th class="num">Passive</th>':''}<th class="num">Consumed</th>
        <th class="num">Surplus</th><th>Status</th></tr></thead><tbody>`;
    bal.forEach(b=>{
      const f=b.forgie||0, surplus=b.prod+f-b.cons, ratio=b.cons>0?surplus/b.cons:1;
      let cls="bal-ok",lbl="healthy";
      if(b.preProd){cls=surplus<-1e-6?"bal-tight":"bal-ok";lbl=surplus<-1e-6?"pre-produce":"covered";}
      else if(surplus<-1e-6){cls="bal-tight";lbl="short";}
      else if(b.cons>0&&ratio<0.05){cls="bal-tight";lbl="tight";}
      const fCell=showForgie?`<td class="num" style="color:${f>1e-6?'var(--teal)':'var(--ink3)'}">${f>1e-6?disp(f):"—"}</td>`:"";
      const linesCell=b.vesp?'<span style="color:var(--ink3)">income →</span>':(b.preProd&&b.prod<=1e-6)?'<span style="color:var(--ink3)">pre-prod</span>':disp(b.prod);
      html+=`<tr${b.preProd?' style="background:rgba(210,129,58,.05)"':b.vesp?' style="background:rgba(63,182,160,.05)"':''}><td>${b.res}</td><td class="num">${linesCell}</td>${fCell}
        <td class="num">${disp(b.cons)}</td>
        <td class="num ${surplus<-1e-6?'bal-tight':''}">${disp(surplus)}</td>
        <td class="${cls}" style="font-weight:600;font-size:11.5px">${lbl}</td></tr>`;
    });
    html+=`</tbody></table>`;
  }
  // Frames & Wire pre-produce Bits (same convention as the solver readout: kept out of the line math)
  if(ppBits>1e-6){
    const fBits=num(S.forgie&&S.forgie.Bits)||0, net=ppBits-fBits;
    const bd=preprodBitsBreakdown(res.plan), who=Object.keys(bd).filter(k=>bd[k]>1e-6);
    const verb=(who.length===1&&!/s$/.test(who[0]))?"consumes":"consume";
    html+=`<div class="subhead">Bits to pre-produce (${who.join(" & ")})</div>
      <div class="notice info" style="font-size:12px">${who.join(" &amp; ")} ${verb} <b>${disp(ppBits)}</b> Bits/hr (${preprodBitsNote(who)}, not part of the line setup above).`+
      (fBits>0?` Lil' Forgie supplies <b>${disp(fBits)}</b>/hr, so `:` So `)+
      (net>1e-6?`pre-produce about <b style="color:var(--amber)">${disp(net)}</b> Bits/hr to keep up.`
              :`Forgie already covers it — a <b style="color:var(--teal)">${disp(-net)}</b>/hr surplus.`)+`</div>`;
  }
  el.innerHTML=html;
  stat.textContent="manual setup";
}

