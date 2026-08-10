"use strict";
/* ---------- Manual configuration mode ---------- */
// No solver: every line's job is set by hand. Compute the resulting production,
// consumption and balance directly, so the user can try setups that aren't optimal
// but suit their purposes — and see at a glance whether each input keeps up.

/* ---- sustained rates when an input can't keep up ---- */
// A line only crafts while it is holding materials, so an input that runs short doesn't leave the
// factory permanently in the red — it idles the lines that input feeds. Every line therefore has a
// duty cycle: the fraction of the hour it actually runs. manualDutyCycles finds the largest set of
// duty cycles under which no resource is consumed faster than it is supplied, which turns a short
// input into a real per-hour output figure for everything downstream of it.
//
// A resource is supplied by Lil' Forgie's passive drip plus whatever the (already throttled) lines
// producing it make; a mined resource supplies its fixed hourly income budget instead. Where
// several lines draw on one short pool the split is max-min fair — every line's duty cycle rises
// together until it either has enough or is capped by a different input, and a line capped
// elsewhere hands the rest of its share back instead of hoarding it.
//
// RECIPE is acyclic, so re-solving from "everything runs flat out" only ever lowers supply and the
// duty cycles descend to the largest feasible set within a few passes.
const DUTY_PASSES=64,DUTY_TOL=1e-12,DUTY_SNAP=1e-9;
function manualDutyCycles(entries,supplyFor){
  let duty=entries.map(()=>1);
  for(let pass=0;pass<DUTY_PASSES;pass++){
    const next=fairShareDuties(entries,supplyFor(duty));
    let stable=true;
    next.forEach((v,i)=>{
      if(v>duty[i])next[i]=duty[i];   // supply only falls as duty falls; hold off float jitter
      if(Math.abs(next[i]-duty[i])>DUTY_TOL)stable=false;
    });
    duty=next;
    if(stable)break;
  }
  // A setup whose inputs balance exactly lands a hair under 1 on the last ulp of the ratio that
  // produced it. Snap that back so an exactly-fed line reads as running flat out.
  return duty.map(v=>v>1-DUTY_SNAP?1:v);
}
// Max-min fair shares by progressive filling: raise every unfrozen line's duty cycle together
// until some resource's supply runs out, freeze the lines that resource feeds, and carry on with
// what is left. At most one round per line.
function fairShareDuties(entries,supply){
  const duty=entries.map(()=>1);
  let active=entries.map((e,i)=>Object.keys(e.needs).length?i:-1).filter(i=>i>=0),level=0;
  for(let round=0;round<=entries.length&&active.length;round++){
    const open=new Set(active),fixed={},pending={};
    entries.forEach((e,i)=>Object.entries(e.needs).forEach(([r,hr])=>{
      if(open.has(i))pending[r]=(pending[r]||0)+hr;
      else fixed[r]=(fixed[r]||0)+duty[i]*hr;
    }));
    const ratio={};let t=1;
    Object.entries(pending).forEach(([r,need])=>{
      const room=supply(r)-(fixed[r]||0);
      ratio[r]=room>0?room/need:0;
      if(ratio[r]<t)t=ratio[r];
    });
    if(t<level)t=level;   // the level already reached is feasible whatever the new ratios say
    active.forEach(i=>duty[i]=t);
    if(t>=1)break;
    const binds=r=>r in ratio&&!(ratio[r]>t*(1+DUTY_TOL)+Number.MIN_VALUE);
    const held=active.filter(i=>!Object.keys(entries[i].needs).some(binds));
    if(held.length===active.length)break;   // nothing binds: the whole set sits at t
    active=held;level=t;
  }
  return duty;
}
// "40% of the time" — how much of the hour a starved line actually spends crafting.
function dutyLabel(duty){
  const pct=Math.max(0,duty)*100;
  if(pct<=0)return "0% of the time";
  if(pct<0.1)return "under 0.1% of the time";
  return fmt(pct,pct<10?1:0)+"% of the time";
}
function manualResult(){
  const resources=[...RAWS,...PRODUCTS];
  const resIndex={};resources.forEach((r,i)=>resIndex[r]=i);
  const produced=resources.map(()=>0), consumed=resources.map(()=>0);
  const forgie={};resources.forEach(r=>{forgie[r]=forgieHr(r);produced[resIndex[r]]+=forgie[r];});
  const plan=[]; const issueSet=new Set();
  const minedCons={};
  const entries=[];   // per-line flat-out output and input draw, for the duty-cycle solve below
  S.lines.forEach((ln,i)=>{
    const m=S.manual[i]||{job:"Idle",lvl:ln.max};
    const sp=lineSpeed(ln), dp=dupeMult();
    const entry={res:null,outHr:0,needs:{}};
    const draw=(r,hr)=>{if(hr>0)entry.needs[r]=(entry.needs[r]||0)+hr;};
    let job;
    if(m.job==="Idle"||!ALLITEMS.includes(m.job)){
      job={kind:"idle",res:null,lvl:null,ct:0,prod:[],cons:[]};
    }else{
      const item=m.job, L=Math.min(LEVELS.includes(m.lvl)?m.lvl:ln.max,ln.max), ct=craftTime(item,L);
      const eff=effSpeed(sp,ct), rate=ct>0?craftYield(item,L)/ct:0, cons=[];
      if(!RAWS.includes(item)){
        RECIPE[item].inputs.forEach(k=>{const c=S.prodCost[item][k][L];
          if(c==null||isNaN(c)){issueSet.add("No material cost entered for "+item+" @"+compressionLabel(L)+".");}
          else{const hr=(c/ct)*eff*3600;cons.push([resIndex[k],c/ct]);consumed[resIndex[k]]+=hr;draw(k,hr);}});
        const cfg=MINED_CRAFTS[item];
        if(cfg){const c=minedCost(item,L)[cfg.resource];
          if(c==null||isNaN(c)){issueSet.add("No mined cost entered for "+item+" @"+compressionLabel(L)+".");}
          else{const hr=(c/ct)*eff*3600;minedCons[cfg.resource]=(minedCons[cfg.resource]||0)+hr;draw(cfg.resource,hr);}}
      }
      const outHr=rate*eff*dp*3600;
      produced[resIndex[item]]+=outHr;
      entry.res=item;entry.outHr=outHr;
      job={kind:(RAWS.includes(item)||item===GEL)?"produce":"craft",res:item,lvl:L,ct,prod:[[resIndex[item],rate]],cons};
    }
    entries.push(entry);
    plan.push({line:i+1,max:ln.max,spx:sp,dup:dupeChance(),sp,dp,job});
  });
  // Everything above is the flat-out plan — every line crafting nonstop, which is what the balance
  // table reports so it can say what the setup would take to run at 100%. `duty` scales it to what
  // the setup actually holds up at once anything it can't feed starts idling.
  const producersOf={};entries.forEach((e,i)=>{if(e.res&&e.outHr>0)(producersOf[e.res]=producersOf[e.res]||[]).push(i);});
  const supplyFor=d=>r=>isMinedResource(r)?minedBudgetHr(r)
    :(forgie[r]||0)+(producersOf[r]||[]).reduce((sum,i)=>sum+d[i]*entries[i].outHr,0);
  const duty=manualDutyCycles(entries,supplyFor);
  plan.forEach((p,i)=>{p.duty=p.job.kind==="idle"?1:duty[i];});
  const sustained={produced:{},lineProd:{},cons:{},out:{},minedCons:{}};
  resources.forEach(r=>{sustained.lineProd[r]=0;sustained.cons[r]=0;});
  entries.forEach((e,i)=>{
    if(e.res)sustained.lineProd[e.res]+=duty[i]*e.outHr;
    Object.entries(e.needs).forEach(([r,hr])=>{
      const used=duty[i]*hr;
      if(isMinedResource(r))sustained.minedCons[r]=(sustained.minedCons[r]||0)+used;
      else sustained.cons[r]+=used;
    });
  });
  resources.forEach(r=>{
    sustained.produced[r]=sustained.lineProd[r]+forgie[r];
    // A resource the duty cycles are solved against comes out consumed exactly as fast as it is
    // supplied, so its sustained surplus is zero up to the solve's own rounding. Keep that reading
    // at zero rather than a stray last-ulp trickle.
    const net=sustained.produced[r]-sustained.cons[r],scale=Math.max(sustained.produced[r],sustained.cons[r]);
    sustained.out[r]=Math.abs(net)<=DUTY_TOL*scale?0:net;
  });
  const throttled=plan.some(p=>p.job.kind!=="idle"&&p.duty<1);
  const balance=resources.map(r=>{const i=resIndex[r];return {res:r,prod:Math.max(0,produced[i]-forgie[r]),forgie:forgie[r],cons:consumed[i],
    prodActual:sustained.lineProd[r],consActual:sustained.cons[r]};});
  const out={};resources.forEach(r=>{const i=resIndex[r];out[r]=produced[i]-consumed[i];});
  // line production per resource (excludes Lil' Forgie's passive supply)
  const lineProd={};resources.forEach(r=>{const i=resIndex[r];lineProd[r]=Math.max(0,produced[i]-forgie[r]);});
  // selling: an item is sold if any non-idle line producing it is flagged. Credits come off
  // its NET surplus (you can't sell what the chain consumes), valued at its sell price. The
  // surplus is the sustained one — a starved line can't sell what it never gets to craft.
  const sold=new Set();
  plan.forEach((p,i)=>{const m=S.manual[i];if(m&&m.sell&&p.job.kind!=="idle"&&p.job.res)sold.add(p.job.res);});
  const creditRows=[];let totalCredits=0,missingPrice=false;
  [...sold].forEach(it=>{const surplus=Math.max(0,sustained.out[it]),surplusFull=Math.max(0,out[it]),
    price=num(S.sellPrice&&S.sellPrice[it])||0,credits=surplus*price;
    if(price<=0&&surplus>1e-6)missingPrice=true;totalCredits+=credits;creditRows.push({item:it,surplus,surplusFull,price,credits});});
  creditRows.sort((a,b)=>b.credits-a.credits);
  const minedBalances=MINED_RESOURCES.map(resource=>({
    resource,incomeHr:minedBudgetHr(resource),consHr:minedCons[resource]||0,consActualHr:sustained.minedCons[resource]||0
  })).filter(row=>row.incomeHr>0||row.consHr>0);
  return {plan,balance,minedBalances,out,resIndex,issues:[...issueSet],lineProd,soldItems:[...sold],creditRows,totalCredits,missingPrice,
    duty,sustained,throttled};
}
// Copy a solved Max item/hr or Max credits/hr plan into Manual mode as an editable starting
// point (issue #85), instead of recreating it by hand. In credits mode the item the solver
// dedicated the factory to is flagged for sale; items mode has no such concept, so sell starts off.
function copyPlanToManual(res){
  const source=res&&Array.isArray(res.plan)?res.plan:null,lineCount=Array.isArray(S.lines)?S.lines.length:0;
  if(!source||!source.some((p,i)=>i<lineCount&&p&&p.job&&p.job.kind!=="idle"&&ALLITEMS.includes(p.job.res)))return;
  commitManualResultMutation(st=>{
    st.manual=(st.lines||[]).map((line,i)=>{
      const p=source[i],j=(p&&p.job)||{},cap=(line&&line.max)||1;
      if(j.kind==="idle"||!ALLITEMS.includes(j.res))return {job:"Idle",lvl:cap,sell:false};
      return {job:j.res,lvl:j.lvl||cap,sell:res.mode==="credits"&&j.res===res.bestItem};
    });
    syncManual(st);
    st.mode="manual";
  },()=>{if(typeof renderModeSwitch==="function")renderModeSwitch();});
}
/* ---- saved manual setups (named presets of the per-line job/level/sell) ---- */
function commitManualResultMutation(mutator,syncControls){
  if(typeof commitResultMutation==="function")return commitResultMutation(mutator,syncControls);
  // Lightweight harnesses can load Manual mode without the page event layer. Keep that isolated
  // fallback transactional too; the shipped page normally uses the shared event-layer helper.
  const previous=typeof solveStateSnapshot==="function"?solveStateSnapshot(S):JSON.parse(JSON.stringify(S));
  mutateState(mutator);
  if(save()===false){
    if(typeof commitState==="function")commitState(previous);else S=previous;
    if(typeof syncControls==="function")syncControls();
    return false;
  }
  if(typeof syncControls==="function")syncControls();
  renderResults();return true;
}
function saveManualPreset(name){
  commitManualResultMutation(st=>{
    syncManual(st);
    const config=st.manual.map(m=>({job:m.job,lvl:m.lvl,sell:!!m.sell}));
    const id=newId();
    if(!Array.isArray(st.manualSaved))st.manualSaved=[];
    st.manualSaved.push({id,name,config});
    st.manualActiveId=id;
  });
}
function loadManualPreset(id){
  const p=(S.manualSaved||[]).find(x=>x.id===id);if(!p)return;
  commitManualResultMutation(
    st=>{st.manual=p.config.map(c=>({job:c.job,lvl:c.lvl,sell:!!c.sell}));st.manualActiveId=id;syncManual(st);},
    ()=>{const select=document.getElementById("manualPreset");if(select)select.value=S.manualActiveId||"";}
  );
}
// Overwrite an existing saved setup with the current line config (keeps its id + name).
function updateManualPreset(id){
  if(!(S.manualSaved||[]).some(x=>x.id===id))return;
  commitManualResultMutation(st=>{const p=st.manualSaved.find(x=>x.id===id);syncManual(st);p.config=st.manual.map(m=>({job:m.job,lvl:m.lvl,sell:!!m.sell}));st.manualActiveId=id;});
}
function deleteManualPreset(id){
  commitManualResultMutation(st=>{st.manualSaved=(st.manualSaved||[]).filter(p=>p.id!==id);if(st.manualActiveId===id)st.manualActiveId=null;});
}
function renderManualPresetBar(container,saved,active){
  const select=domElement("select");
  select.id="manualPreset";
  select.setAttribute("aria-label","Load a saved setup");
  select.style.cssText="flex:1;min-width:150px";
  select.appendChild(domOption("",saved.length?"— load a saved setup —":"— no saved setups yet —",false));
  saved.forEach(p=>select.appendChild(domOption(p.id,p.name,p.id===S.manualActiveId)));
  const controls=[select];
  if(active){
    const update=domElement("button","btn ghost",`Update “${active.name}”`);
    update.id="manualUpdate";update.title=`Overwrite “${active.name}” with the current setup`;
    controls.push(update);
  }
  const saveNew=domElement("button","btn ghost","Save as new…");saveNew.id="manualSaveNew";controls.push(saveNew);
  if(saved.length){const del=domElement("button","btn ghost","Delete");del.id="manualDelPreset";del.title="Delete the selected saved setup";controls.push(del);}
  container.replaceChildren(...controls);
}
function renderManual(el,stat){
  const res=manualResult();
  let html=`<div class="notice info"><b>Manual mode.</b> Assign each line a resource and a compression level by hand. The <b>balance</b> table below shows whether every input is produced fast enough to sustain the setup — a negative surplus (<b>short</b>) means that input runs dry. Compression is capped at each line's max.</div>`;
  // saved-setup bar: name the current layout, then swap between presets at will
  const saved=S.manualSaved||[];
  const active=saved.find(p=>p.id===S.manualActiveId);
  html+=`<div id="manualPresetBar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px"></div>`;
  if(res.issues.length)html+=`<div class="notice warn"><b>Missing data:</b><br>${res.issues.join("<br>")}</div>`;
  if(res.throttled)html+=`<div class="notice warn"><b>Running short.</b> An input can't keep up, so the lines it feeds only craft part of the time. Every output figure below is the <b>sustained</b> rate — what the setup settles at once whatever stock you're sitting on runs out. The balance table stays the flat-out picture: what you'd have to supply for every line to run at 100%.</div>`;
  // headline cards: credits from sold surplus first, then net surplus of items actually
  // crafted/produced on a line (Lil' Forgie's passive-only items are excluded)
  const nets=[...PRODUCTS,...RAWS].filter(it=>res.lineProd[it]>1e-6&&res.sustained.out[it]>1e-6);
  let cards="";
  if(res.totalCredits>1e-6)cards+=`<div class="metric"><div class="l">Credits</div><div class="v">${disp(res.totalCredits)}</div><div class="u">per hour — sold surplus</div></div>`;
  nets.forEach(t=>{
    const unit=res.out[t]>res.sustained.out[t]?`sustained net /hr — ${disp(res.out[t])} at full speed`:"net surplus /hr";
    cards+=`<div class="metric"><div class="l">${t}</div><div class="v">${disp(res.sustained.out[t])}</div><div class="u">${unit}</div></div>`;});
  if(cards)html+=`<div class="metrics">${cards}</div>`;
  // editable per-line setup
  html+=`<div class="subhead">Manual line setup</div>
    <table><thead><tr><th>Line</th><th>Cap</th><th>Resource</th><th>Compression</th>
      <th class="num">Output /hr</th><th>Consumes /hr${res.throttled?" (flat out)":""}</th><th>Sell</th></tr></thead><tbody>`;
  res.plan.forEach((p,i)=>{
    const ln=S.lines[i], m=S.manual[i], j=p.job;
    const resOpts=`<option value="Idle"${m.job==="Idle"?" selected":""}>— idle —</option>`+
      `<optgroup label="Raw materials">`+RAWS.map(it=>`<option value="${it}"${it===m.job?" selected":""}>${it}</option>`).join("")+`</optgroup>`+
      `<optgroup label="Crafted">`+PRODUCTS.map(it=>`<option value="${it}"${it===m.job?" selected":""}>${it}</option>`).join("")+`</optgroup>`;
    const lvlOpts=LEVELS.filter(L=>L<=ln.max).map(L=>`<option value="${L}"${L===m.lvl?" selected":""}>${compressionLabel(L)}</option>`).join("");
    let outv="—",cons="";
    if(j.kind!=="idle"){const eff=effSpeed(p.sp,j.ct);
      const full=j.prod[0][1]*eff*p.dp*3600;
      // A starved line's headline number is what it sustains; keep the flat-out rate beside it so
      // the gap — and how much of the hour the line is standing idle — is legible.
      outv=p.duty<1
        ?`${disp(full*p.duty)}<div style="color:var(--ink3);font-size:10.5px">of ${disp(full)} — runs ${dutyLabel(p.duty)}</div>`
        :disp(full);
      const parts=j.cons.map(c=>disp(c[1]*eff*3600)+" "+invName(res.resIndex,c[0]));
      const cfg=MINED_CRAFTS[j.res];
      if(cfg)Object.entries(minedCost(j.res,j.lvl)).forEach(([resource,cost])=>{
        const note=resource===cfg.resource?" (mined income)":" (informational)";
        parts.push(disp((cost/j.ct)*eff*3600)+" "+resource+note);
      });
      cons=parts.length?parts.join(", "):'<span style="color:var(--ink3)">none</span>';}
    const tags=`<span style="color:var(--ink3);font-size:10.5px"> ×${fmt(p.sp,2)} spd</span>${p.dup>0?` <span style="color:var(--ink3);font-size:10.5px">+${fmt(p.dup,2)}% dup</span>`:""}`;
    const sellCell=j.kind==="idle"?'<span style="color:var(--ink3)">—</span>'
      :`<input type="checkbox" data-msell="${i}" ${m.sell?"checked":""} aria-label="Sell line ${p.line} surplus">`;
    html+=`<tr><td class="mono">#${p.line}</td><td class="mono">${compressionLabel(ln.max)}${tags}</td>
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
      const starved=c.surplusFull>c.surplus
        ?`<div style="color:var(--ink3);font-size:10.5px">of ${disp(c.surplusFull)} at full speed</div>`:"";
      html+=`<tr><td>${c.item}</td><td class="num">${disp(c.surplus)}${starved}</td>
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
  // Mined crafts keep independent income budgets; show each source and its own burn separately.
  (res.minedBalances||[]).forEach(row=>bal.push({res:row.resource,prod:0,forgie:0,minedIncome:row.incomeHr,cons:row.consHr,mined:true}));
  if(!bal.length){
    html+=`<div class="notice info" style="font-size:11.5px">All lines are idle — pick a resource for at least one line above to see a balance.</div>`;
  }else{
    const showForgie=bal.some(b=>(b.forgie||0)>1e-6),showMined=bal.some(b=>b.mined);
    html+=`<div class="subhead">Resource balance (per hour${res.throttled?", every line flat out":""})</div>
      <table><thead><tr><th>Resource</th><th class="num">Lines</th>${showForgie?'<th class="num">Passive</th>':''}${showMined?'<th class="num">Mined income</th>':''}<th class="num">Consumed</th>
        <th class="num">Surplus</th><th>Status</th></tr></thead><tbody>`;
    bal.forEach(b=>{
      const f=b.forgie||0,mine=b.minedIncome||0,surplus=b.prod+f+mine-b.cons,ratio=b.cons>0?surplus/b.cons:1;
      let cls="bal-ok",lbl="healthy";
      if(b.preProd){cls=surplus<-1e-6?"bal-tight":"bal-ok";lbl=surplus<-1e-6?"pre-produce":"covered";}
      else if(surplus<-1e-6){cls="bal-tight";lbl="short";}
      else if(b.cons>0&&ratio<0.05){cls="bal-tight";lbl="tight";}
      const fCell=showForgie?`<td class="num" style="color:${f>1e-6?'var(--teal)':'var(--ink3)'}">${f>1e-6?disp(f):"—"}</td>`:"";
      const minedCell=showMined?`<td class="num" style="color:${mine>1e-6?'var(--teal)':'var(--ink3)'}">${mine>1e-6?disp(mine):"—"}</td>`:"";
      const linesCell=(b.preProd&&b.prod<=1e-6)?'<span style="color:var(--ink3)">pre-prod</span>':b.mined?'—':disp(b.prod);
      html+=`<tr${b.preProd?' style="background:rgba(210,129,58,.05)"':b.mined?' style="background:rgba(63,182,160,.05)"':''}><td>${b.res}</td><td class="num">${linesCell}</td>${fCell}${minedCell}
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
  renderManualPresetBar(document.getElementById("manualPresetBar"),saved,active);
  stat.textContent="Manual setup ready.";
}
