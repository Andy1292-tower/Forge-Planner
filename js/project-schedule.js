"use strict";

/* Pure Project execution scheduling. This file intentionally knows nothing about S, the DOM,
 * persistence, clocks, or solver internals. Every rate in an entry is already the real rate owned
 * by that LP assignment (including duplication); context is copied data only. */
(function(root){
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  const finite=n=>typeof n==="number"&&Number.isFinite(n);
  const copyMap=o=>Object.assign({},o||{});
  const copyContext=input=>{
    const c=input||{};
    return {
      ordinaryResources:Array.from(new Set(c.ordinaryResources||[])),
      minedResources:Array.from(new Set(c.minedResources||[])),
      informationalResources:Array.from(new Set(c.informationalResources||[])),
      forgieRates:copyMap(c.forgieRates),minedIncomeRates:copyMap(c.minedIncomeRates),
      recipeDependencies:Object.fromEntries(Object.entries(c.recipeDependencies||{}).map(([k,v])=>[k,[...(v||[])]])),
      recipeDepth:copyMap(c.recipeDepth),preprodBits:copyMap(c.preprodBits),
      compressionInputScale:copyMap(c.compressionInputScale),
      assignmentEpsilon:finite(c.assignmentEpsilon)&&c.assignmentEpsilon>=0?c.assignmentEpsilon:1e-9,
      stockTolerance:Object.assign({absolute:1e-8,relative:Number.EPSILON*32},c.stockTolerance||{})
    };
  };
  const stockTol=(c,...values)=>{
    const abs=finite(c.stockTolerance.absolute)?Math.max(0,c.stockTolerance.absolute):1e-8;
    const rel=finite(c.stockTolerance.relative)?Math.max(0,c.stockTolerance.relative):Number.EPSILON*32;
    return abs+rel*Math.max(1,...values.filter(finite).map(Math.abs));
  };
  const entryCompare=c=>(a,b)=>{
    const da=finite(c.recipeDepth[a.item])?c.recipeDepth[a.item]:Number.MAX_SAFE_INTEGER;
    const db=finite(c.recipeDepth[b.item])?c.recipeDepth[b.item]:Number.MAX_SAFE_INTEGER;
    return da-db||b.frac-a.frac||String(a.item).localeCompare(String(b.item))||Number(a.lvl||0)-Number(b.lvl||0)||a._stable-b._stable;
  };
  function canonicalizePhase(phase,c,index){
    const eta=Number(phase&&phase.eta);
    if(!finite(eta)||eta<0)return {error:{kind:"malformed",phaseIndex:index,message:"Phase ETA must be a finite nonnegative number"}};
    let serial=0;
    const plans=[];
    for(const rawLine of (phase&&phase.plan)||[]){
      const line=Number(rawLine&&rawLine.line);
      if(!finite(line))return {error:{kind:"malformed",phaseIndex:index,message:"Every schedule line needs a finite line number"}};
      const entries=[];
      for(const raw of (rawLine.entries||[])){
        const frac=Number(raw&&raw.frac);
        if(!finite(frac)||frac<0)return {error:{kind:"malformed",phaseIndex:index,line,message:"Entry fractions must be finite and nonnegative"}};
        if(frac<=c.assignmentEpsilon)continue;
        const outHr=Number(raw.outHr);
        if(!finite(outHr)||outHr<0)return {error:{kind:"malformed",phaseIndex:index,line,message:"Entry output rates must be finite and nonnegative"}};
        const cons=[];
        for(const rawCons of raw.cons||[]){
          const hr=Number(rawCons&&rawCons.hr);
          if(!finite(hr)||hr<0)return {error:{kind:"malformed",phaseIndex:index,line,message:"Entry input rates must be finite and nonnegative"}};
          cons.push({item:String(rawCons.item),hr});
        }
        entries.push({item:String(raw.item),lvl:raw.lvl,frac,outHr,cons,_stable:serial++});
      }
      entries.sort(entryCompare(c));
      let cursor=0;
      for(const entry of entries){
        entry.start=cursor;cursor+=entry.frac*eta;entry.end=cursor;
      }
      const timeTol=Number.EPSILON*32*Math.max(1,Math.abs(eta),Math.abs(cursor));
      const assignmentTimeTol=Math.max(timeTol,c.assignmentEpsilon*Math.max(1,eta));
      if(cursor>eta+assignmentTimeTol)return {error:{kind:"malformed",phaseIndex:index,line,message:`Line ${line} assignment fractions exceed 1`}};
      entries.forEach(entry=>{delete entry._stable;});
      plans.push({line,max:rawLine.max,sp:rawLine.sp,dp:rawLine.dp,entries});
    }
    plans.sort((a,b)=>a.line-b.line);
    const derivedPreProduced={};
    plans.forEach(line=>line.entries.forEach(entry=>{const perUnit=Number(c.preprodBits[entry.item])||0;if(!(perUnit>0))return;
      const duplication=finite(Number(line.dp))&&Number(line.dp)>0?Number(line.dp):1;
      const scale=finite(Number(c.compressionInputScale[entry.lvl]))?Number(c.compressionInputScale[entry.lvl]):1;
      derivedPreProduced.Bits=(derivedPreProduced.Bits||0)+perUnit*scale*entry.outHr*eta/duplication;
    }));
    if(own(derivedPreProduced,"Bits")){
      const rounded=Math.round(derivedPreProduced.Bits);
      if(Math.abs(derivedPreProduced.Bits-rounded)<=stockTol(c,derivedPreProduced.Bits,rounded))derivedPreProduced.Bits=rounded;
    }
    return {phase:Object.assign({},phase,{kind:phase.kind||"project",eta,plan:plans,
      demandSub:copyMap(phase.demandSub),preProducedDemand:Object.keys(phase.preProducedDemand||{}).length?copyMap(phase.preProducedDemand):derivedPreProduced})};
  }
  function canonicalizePhases(phases,c){
    const out=[];
    for(let i=0;i<(phases||[]).length;i++){
      const one=canonicalizePhase(phases[i],c,i);
      if(one.error)return {error:one.error,phases:out};
      out.push(one.phase);
    }
    return {phases:out};
  }
  const inventoryCopy=(initial,c)=>{
    const out={};
    c.ordinaryResources.forEach(r=>{const v=Number(initial&&initial[r]);out[r]=finite(v)?v:0;});
    Object.entries(initial||{}).forEach(([r,v])=>{if(!own(out,r)&&finite(Number(v)))out[r]=Number(v);});
    return out;
  };
  const timeTol=(...values)=>Number.EPSILON*32*Math.max(1,...values.filter(finite).map(Math.abs));
  const failureEarlier=(a,b)=>{
    if(!a)return b;
    const at=finite(a.time)?a.time:Number.POSITIVE_INFINITY,bt=finite(b.time)?b.time:Number.POSITIVE_INFINITY;
    const tol=timeTol(at,bt);
    return bt<at-tol||(Math.abs(bt-at)<=tol&&String(b.resource||"").localeCompare(String(a.resource||""))<0)?b:a;
  };

  function replayProjectSchedule(phases,initialInventory,context){
    const c=copyContext(context),canon=canonicalizePhases(phases,c);
    const inv=inventoryCopy(initialInventory,c),requiredBuffers={},boundaries=[];
    let firstFailure=canon.error||null,globalTime=0;
    if(canon.error)return {ok:false,phases:canon.phases,boundaries,requiredBuffers,firstFailure,finalInventory:inv,eta:0};
    boundaries.push({time:0,phaseTime:0,phaseIndex:0,kind:"start",inventory:copyMap(inv),minedRates:{}});
    canon.phases.forEach((phase,phaseIndex)=>{
      const phaseStart=globalTime,reserved={};
      for(const [resource,rawSupply] of Object.entries(phase.externalSupply||{})){
        const supply=Math.max(0,Number(rawSupply)||0);if(supply>0)inv[resource]=(inv[resource]||0)+supply;
      }
      for(const [resource,rawNeed] of Object.entries(phase.preProducedDemand||{})){
        const need=Math.max(0,Number(rawNeed)||0);if(!(need>0))continue;
        const before=inv[resource]||0;reserved[resource]=need;inv[resource]=before-need;
        if(inv[resource]<0){
          const deficit=-inv[resource];requiredBuffers[resource]=Math.max(requiredBuffers[resource]||0,deficit);
          firstFailure=failureEarlier(firstFailure,{kind:"prerequisite",phaseIndex,resource,time:phaseStart,boundaryTime:phaseStart,deficit,
            message:`Need ${deficit} more ${resource} before this phase can start`});
        }
      }
      boundaries.push({time:phaseStart,phaseTime:0,phaseIndex,kind:Object.keys(reserved).length?"prerequisite":"phase-start",
        inventory:copyMap(inv),minedRates:{},reserved});
      const times=[0,phase.eta];
      phase.plan.forEach(line=>line.entries.forEach(entry=>{times.push(entry.start,entry.end);}));
      times.sort((a,b)=>a-b);
      const unique=[];
      for(const t of times){const clamped=Math.max(0,Math.min(phase.eta,t)),timeTol=Number.EPSILON*32*Math.max(1,Math.abs(phase.eta),Math.abs(clamped));if(!unique.length||Math.abs(clamped-unique[unique.length-1])>timeTol)unique.push(clamped);}
      for(let ti=0;ti+1<unique.length;ti++){
        const from=unique[ti],to=unique[ti+1],dt=to-from;
        const timeTol=Number.EPSILON*32*Math.max(1,Math.abs(phase.eta),Math.abs(from),Math.abs(to));
        if(!(dt>timeTol))continue;
        const ordinaryRates={},minedRates={},active=[];
        c.ordinaryResources.forEach(r=>ordinaryRates[r]=Number(c.forgieRates[r])||0);
        phase.plan.forEach(line=>{
          const entry=line.entries.find(e=>e.start<=from+timeTol&&e.end>from+timeTol);
          if(!entry)return;
          active.push({line:line.line,item:entry.item,lvl:entry.lvl,start:entry.start,end:entry.end});
          const outRate=entry.outHr/entry.frac;
          if(c.ordinaryResources.includes(entry.item))ordinaryRates[entry.item]=(ordinaryRates[entry.item]||0)+outRate;
          for(const cons of entry.cons){
            const rate=cons.hr/entry.frac;
            if(c.minedResources.includes(cons.item))minedRates[cons.item]=(minedRates[cons.item]||0)+rate;
            else if(!c.informationalResources.includes(cons.item))ordinaryRates[cons.item]=(ordinaryRates[cons.item]||0)-rate;
          }
        });
        for(const resource of c.minedResources){
          const use=minedRates[resource]||0,cap=Math.max(0,Number(c.minedIncomeRates[resource])||0),excess=use-cap;
          if(excess>stockTol(c,use,cap))firstFailure=failureEarlier(firstFailure,{kind:"mined-rate",phaseIndex,resource,
            time:phaseStart+from,boundaryTime:phaseStart+to,rate:use,cap,excess,message:`${resource} use exceeds income by ${excess}/hr`});
        }
        for(const resource of c.ordinaryResources){
          const before=inv[resource]||0,rate=ordinaryRates[resource]||0,after=before+rate*dt;
          inv[resource]=after;
          if(after<0){
            const deficit=-after;requiredBuffers[resource]=Math.max(requiredBuffers[resource]||0,deficit);
            if(after<-stockTol(c,before,after,rate*dt)){
              const crossing=rate<0&&before>0?from+before/(-rate):from;
              firstFailure=failureEarlier(firstFailure,{kind:"stock",phaseIndex,resource,time:phaseStart+crossing,
                boundaryTime:phaseStart+to,deficit,deficitAtBoundary:deficit,requiredBuffer:requiredBuffers[resource],rate,message:`${resource} is short by ${deficit}`});
            }
          }
        }
        boundaries.push({time:phaseStart+to,phaseTime:to,phaseIndex,kind:"switch",inventory:copyMap(inv),
          ordinaryRates:copyMap(ordinaryRates),minedRates:copyMap(minedRates),active});
      }
      if(phase.kind==="project"){
        const inventoryBeforeDebit=copyMap(inv),demandDebit={};
        for(const [resource,rawNeed] of Object.entries(phase.demandSub||{})){
          const need=Math.max(0,Number(rawNeed)||0);if(!(need>0))continue;
          demandDebit[resource]=need;
          inv[resource]=(inv[resource]||0)-need;
          if(inv[resource]<0){
            const deficit=-inv[resource];requiredBuffers[resource]=Math.max(requiredBuffers[resource]||0,deficit);
            if(inv[resource]<-stockTol(c,need,inv[resource]))firstFailure=failureEarlier(firstFailure,{kind:"demand",phaseIndex,
              resource,time:phaseStart+phase.eta,boundaryTime:phaseStart+phase.eta,deficit,message:`${resource} project demand is short by ${deficit}`});
          }
        }
        boundaries.push({time:phaseStart+phase.eta,phaseTime:phase.eta,phaseIndex,kind:"completion",
          inventory:copyMap(inv),inventoryBeforeDebit,demandDebit,minedRates:{},reserved});
      }
      globalTime+=phase.eta;
    });
    return {ok:!firstFailure,phases:canon.phases,boundaries,requiredBuffers,firstFailure,finalInventory:copyMap(inv),eta:globalTime};
  }

  function buildExecutableProjectSchedule(lpPhases,initialInventory,context,solveBuffer){
    const c=copyContext(context),canon=canonicalizePhases(lpPhases,c);
    if(canon.error){const validation=replayProjectSchedule(lpPhases,initialInventory,c);return {phases:canon.phases,eta:0,validation};}
    const execution=[],inv=inventoryCopy(initialInventory,c);
    const maxDepth=Math.max(0,...Object.values(c.recipeDepth).filter(finite))+1;
    let blocking=null;
    const positiveDeficits=validation=>{
      const out={};
      Object.entries(validation.requiredBuffers||{}).forEach(([r,v])=>{
        if(c.ordinaryResources.includes(r)&&!c.minedResources.includes(r)&&!c.informationalResources.includes(r)&&v>stockTol(c,v))out[r]=v;
      });
      return out;
    };
    const transitiveOrdinaryDependencies=targets=>{
      const roots=new Set(Object.keys(targets||{})),allowed=new Set(),visiting=new Set();
      const visit=resource=>{
        if(visiting.has(resource))return;
        visiting.add(resource);
        for(const dependency of c.recipeDependencies[resource]||[]){
          if(!c.ordinaryResources.includes(dependency)||c.minedResources.includes(dependency)||c.informationalResources.includes(dependency))continue;
          allowed.add(dependency);visit(dependency);
        }
      };
      roots.forEach(visit);roots.forEach(resource=>allowed.delete(resource));
      return allowed;
    };
    const addWarmups=(need,sourcePhase,depth,pathSignatures)=>{
      pathSignatures=pathSignatures||new Set();
      if(depth>maxDepth){blocking={kind:"warmup",resource:null,time:0,deficit:0,message:"Warm-up dependency depth exceeded the acyclic recipe bound"};return false;}
      const target={};Object.entries(need).forEach(([r,v])=>{if(v>stockTol(c,v))target[r]=v;});
      const signature=Object.keys(target).sort().map(r=>r+":"+target[r].toPrecision(12)).join("|");
      if(!signature){blocking={kind:"warmup",resource:null,time:0,deficit:0,message:"Warm-up made no material deficit progress"};return false;}
      if(pathSignatures.has(signature)){blocking={kind:"warmup",resource:null,time:0,deficit:0,message:"Warm-up repeated a target without reducing its deficit"};return false;}
      const nextPath=new Set(pathSignatures);nextPath.add(signature);
      if(typeof solveBuffer!=="function"){blocking={kind:"warmup",resource:Object.keys(target)[0]||null,time:0,
        deficit:Object.values(target)[0]||0,message:"No warm-up solver is available for the required startup stock"};return false;}
      let made;
      try{made=solveBuffer(copyMap(target),copyMap(inv),{depth,sourcePhase,recipeDependencies:c.recipeDependencies});}
      catch(error){blocking={kind:"warmup",resource:null,time:0,deficit:0,message:"Warm-up solver failed: "+String(error&&error.message||error)};return false;}
      const list=Array.isArray(made)?made:(made&&Array.isArray(made.phases)?made.phases:[made]);
      if(!list.length||!list[0]){blocking={kind:"warmup",resource:null,time:0,deficit:0,message:"Warm-up solver returned no plan"};return false;}
      const startStock={};Object.keys(target).forEach(r=>startStock[r]=inv[r]||0);
      for(const raw of list){
        const remaining=()=>Object.entries(target).reduce((sum,[r,v])=>sum+Math.max(0,v-Math.max(0,(inv[r]||0)-startStock[r])),0);
        const warm=Object.assign({},raw,{kind:"warmup",demandSub:{},invStart:copyMap(inv)});
        const before=remaining(),trial=replayProjectSchedule([warm],inv,c);
        let warmTrial=trial;
        if(!warmTrial.ok&&warmTrial.firstFailure&&warmTrial.firstFailure.kind==="prerequisite"){
          const prereq={kind:"prerequisite",name:`External ${warmTrial.firstFailure.resource} prerequisite`,eta:0,plan:[],
            externalSupply:{[warmTrial.firstFailure.resource]:warmTrial.firstFailure.deficit},
            prerequisiteDemand:copyMap(warmTrial.phases[0]&&warmTrial.phases[0].preProducedDemand),demandSub:{},preProducedDemand:{},invStart:copyMap(inv)};
          const supplied=replayProjectSchedule([prereq],inv,c);Object.assign(inv,supplied.finalInventory);execution.push(supplied.phases[0]);
          warm.invStart=copyMap(inv);warmTrial=replayProjectSchedule([warm],inv,c);
        }
        if(!warmTrial.ok){
          if(warmTrial.firstFailure&&warmTrial.firstFailure.kind==="stock"){
            const ancestors=positiveDeficits(warmTrial);
            const allowed=transitiveOrdinaryDependencies(target);
            const unrelated=Object.keys(ancestors).filter(resource=>!allowed.has(resource)).sort();
            if(unrelated.length){blocking={kind:"warmup",resource:unrelated[0],time:0,deficit:ancestors[unrelated[0]],
              message:`Warm-up introduced unrelated ${unrelated[0]} stock; recursive buffers must be recipe dependencies of ${Object.keys(target).sort().join(", ")}`};return false;}
            if(!addWarmups(ancestors,warm,depth+1,nextPath))return false;
          }else{blocking=warmTrial.firstFailure||{kind:"warmup",message:"Warm-up schedule is not executable"};return false;}
        }
        const replay=replayProjectSchedule([warm],inv,c);
        if(!replay.ok){blocking=replay.firstFailure;return false;}
        Object.assign(inv,replay.finalInventory);execution.push(replay.phases[0]);
        const after=remaining();
        if(!(after<before-stockTol(c,before,after))){blocking={kind:"warmup",resource:Object.keys(target)[0]||null,
          time:0,deficit:after,message:"Warm-up returned a plan but made no material deficit progress"};return false;}
      }
      return true;
    };
    for(const phase of canon.phases){
      phase.invStart=copyMap(inv);
      let replay=replayProjectSchedule([phase],inv,c);
      if(!replay.ok){
        if(replay.firstFailure&&replay.firstFailure.kind==="prerequisite"){
          const prerequisite={kind:"prerequisite",name:`External ${replay.firstFailure.resource} prerequisite`,eta:0,plan:[],
            externalSupply:{[replay.firstFailure.resource]:replay.firstFailure.deficit},prerequisiteDemand:copyMap(phase.preProducedDemand),
            demandSub:{},preProducedDemand:{},invStart:copyMap(inv)};
          const supplied=replayProjectSchedule([prerequisite],inv,c);
          Object.assign(inv,supplied.finalInventory);execution.push(supplied.phases[0]);phase.invStart=copyMap(inv);
          replay=replayProjectSchedule([phase],inv,c);
        }
        if(!replay.ok&&replay.firstFailure&&["prerequisite","mined-rate","malformed"].includes(replay.firstFailure.kind)){blocking=replay.firstFailure;break;}
      }
      if(!replay.ok){
        const deficits=positiveDeficits(replay);
        if(!addWarmups(deficits,phase,0)){break;}
        phase.invStart=copyMap(inv);
        replay=replayProjectSchedule([phase],inv,c);
        if(!replay.ok&&replay.firstFailure&&replay.firstFailure.kind==="prerequisite"){
          const prerequisite={kind:"prerequisite",name:`External ${replay.firstFailure.resource} prerequisite`,eta:0,plan:[],
            externalSupply:{[replay.firstFailure.resource]:replay.firstFailure.deficit},prerequisiteDemand:copyMap(phase.preProducedDemand),
            demandSub:{},preProducedDemand:{},invStart:copyMap(inv)};
          const supplied=replayProjectSchedule([prerequisite],inv,c);
          Object.assign(inv,supplied.finalInventory);execution.push(supplied.phases[0]);phase.invStart=copyMap(inv);
          replay=replayProjectSchedule([phase],inv,c);
        }
        if(!replay.ok){blocking=replay.firstFailure||{kind:"warmup",message:"Warm-up did not make the project phase executable"};break;}
      }
      Object.assign(inv,replay.finalInventory);execution.push(replay.phases[0]);
    }
    const validation=blocking?replayProjectSchedule(execution,initialInventory,c):replayProjectSchedule(execution,initialInventory,c);
    if(blocking){validation.ok=false;validation.firstFailure=blocking;}
    return {phases:execution,eta:execution.reduce((sum,p)=>sum+(p.eta||0),0),validation};
  }

  root.replayProjectSchedule=replayProjectSchedule;
  root.buildExecutableProjectSchedule=buildExecutableProjectSchedule;
  if(typeof module!=="undefined"&&module.exports)module.exports={replayProjectSchedule,buildExecutableProjectSchedule};
})(typeof globalThis!=="undefined"?globalThis:this);
