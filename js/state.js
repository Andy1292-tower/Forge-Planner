"use strict";

const STATE_BACKUP_KEY=LSKEY+"_previous_good";
const STATE_REJECTED_KEY=LSKEY+"_rejected";
const STATE_REJECTED_REASON_KEY=STATE_REJECTED_KEY+"_reason";
let _activeStateRecovery=null;

function _plainObject(value){
  if(value===null||typeof value!=="object"||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  // A JSON object produced in another realm (an iframe or test VM) has a different
  // Object.prototype identity, but its prototype is still that realm's root prototype.
  return proto===null||proto===Object.prototype||Object.getPrototypeOf(proto)===null;
}
function _own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
function _freshCurrentDefaults(){
  const state=normalize(defaults());
  state.schemaVersion=CURRENT_SCHEMA_VERSION;
  return state;
}
function _pushError(errors,path,message){
  if(errors.length<100)errors.push(path+" "+message);
}
function _readData(object,key,path,errors){
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor)return undefined;
  if(!_own(descriptor,"value")){
    _pushError(errors,path,"must be ordinary data, not an accessor");
    return undefined;
  }
  return descriptor.value;
}
function _scanStructure(root,errors){
  const seen=new WeakSet();let nodes=0;
  const visit=(value,path,depth)=>{
    if(typeof value==="string"){
      if(value.length>STATE_LIMITS.maxStringLength)_pushError(errors,path,"exceeds the global string length limit");
      return;
    }
    if(value===null||typeof value!=="object")return;
    if(depth>STATE_LIMITS.maxDepth){_pushError(errors,path,"exceeds the object depth limit");return;}
    if(seen.has(value)){_pushError(errors,path,"must not contain circular references");return;}
    seen.add(value);nodes++;
    if(nodes>STATE_LIMITS.maxNodes){_pushError(errors,path,"exceeds the object count limit");return;}
    if(Array.isArray(value)){
      if(value.length>STATE_LIMITS.maxArrayLength){_pushError(errors,path,"exceeds the array length limit");return;}
      Object.keys(value).forEach(key=>visit(_readData(value,key,path+"["+key+"]",errors),path+"["+key+"]",depth+1));
      return;
    }
    if(!_plainObject(value)){_pushError(errors,path,"must contain only plain objects");return;}
    const keys=Object.keys(value);
    if(keys.length>STATE_LIMITS.maxObjectKeys){_pushError(errors,path,"exceeds the object key limit");return;}
    keys.forEach(key=>{
      if(key.length>STATE_LIMITS.maxStringLength)_pushError(errors,path,"contains an oversized key");
      visit(_readData(value,key,path+"."+key,errors),path+"."+key,depth+1);
    });
  };
  visit(root,"state",0);
}
function _number(value,rule,path,errors){
  if(value===null&&rule.allowBlank)return null;
  if(typeof value!=="number"||!Number.isFinite(value)){
    _pushError(errors,path,"must be a finite number");return undefined;
  }
  if(rule.type==="integer"&&!Number.isInteger(value))_pushError(errors,path,"must be an integer");
  if(value<rule.min||value>rule.max)_pushError(errors,path,"must be between "+rule.min+" and "+rule.max);
  return value;
}
function _string(value,rule,path,errors){
  if(typeof value!=="string"){
    _pushError(errors,path,"must be a string");return undefined;
  }
  if(!rule.allowBlank&&value.length===0)_pushError(errors,path,"must not be blank");
  if(value.length>rule.maxLength)_pushError(errors,path,"exceeds the "+rule.maxLength+" character length limit");
  if(rule.pattern&&!rule.pattern.test(value))_pushError(errors,path,"must use a safe ID format (letter first; then letters, numbers, underscores, or hyphens)");
  return value;
}
function _boolean(value,path,errors){
  if(typeof value!=="boolean"){
    _pushError(errors,path,"must be a boolean");return undefined;
  }
  return value;
}
function _enum(value,rule,path,errors){
  if(!rule.values.includes(value)){
    _pushError(errors,path,"must be one of the supported values");return undefined;
  }
  return value;
}
function _object(value,path,errors){
  if(!_plainObject(value)){_pushError(errors,path,"must be a plain object");return null;}
  return value;
}
function _array(value,path,errors,limit){
  if(!Array.isArray(value)){_pushError(errors,path,"must be an array");return null;}
  if(value.length>limit)_pushError(errors,path,"exceeds the "+limit+" entry limit");
  return value;
}
function _required(candidate,key,errors){
  if(!_own(candidate,key))_pushError(errors,key,"is required for schema version "+CURRENT_SCHEMA_VERSION);
}

function validateAndMigrate(candidate){
  const errors=[];
  if(!_plainObject(candidate))return {ok:false,errors:["state must be a plain object"],sourceVersion:null};
  _scanStructure(candidate,errors);
  if(errors.some(error=>/depth limit|object count limit|array length limit|only plain objects|circular references|accessor/.test(error)))return {ok:false,errors,sourceVersion:null};

  let sourceVersion=0;
  if(_own(candidate,"schemaVersion")){
    const rawVersion=_readData(candidate,"schemaVersion","schemaVersion",errors);
    if(typeof rawVersion!=="number"||!Number.isInteger(rawVersion)||rawVersion<1){
      _pushError(errors,"schemaVersion","must be a positive integer");
      sourceVersion=rawVersion;
    }else sourceVersion=rawVersion;
    if(sourceVersion>CURRENT_SCHEMA_VERSION){
      _pushError(errors,"schemaVersion","was written by a newer version of Forge Planner");
      return {ok:false,errors,sourceVersion};
    }
    if(sourceVersion!==CURRENT_SCHEMA_VERSION)return {ok:false,errors:["schemaVersion is not supported"],sourceVersion};
  }else{
    const legacyShape=Array.isArray(candidate.lines)&&_plainObject(candidate.prodCost)&&_plainObject(candidate.targets);
    if(!legacyShape)return {ok:false,errors:["unversioned save does not match a known Forge Planner shape"],sourceVersion:0};
  }

  const current=sourceVersion===CURRENT_SCHEMA_VERSION;
  if(current){
    ["lines","maxTurbo","dupe","prodCost","baseTime","baseTimeRev","margin","mode","solveBudget",
      "sellPrice","priceText","forgie","forgieText","minedIncome","minedIncomeText","targets",
      "projects","inventory","inventoryText","projectSeq","projectGate","planStart","manual","manualSaved",
      "manualActiveId"].forEach(key=>_required(candidate,key,errors));
  }
  const out=defaults();
  out.schemaVersion=CURRENT_SCHEMA_VERSION;

  const rawLines=_readData(candidate,"lines","lines",errors);
  const lines=_array(rawLines,"lines",errors,STATE_LIMITS.maxLines);
  if(lines){
    if(lines.length===0)_pushError(errors,"lines","must contain at least one crafter line");
    out.lines=[];
    lines.slice(0,STATE_LIMITS.maxLines).forEach((raw,index)=>{
      const path="lines["+index+"]",line=_object(raw,path,errors);if(!line)return;
      if(!_own(line,"max"))_pushError(errors,path+".max","is required");
      if(!_own(line,"spx"))_pushError(errors,path+".spx","is required");
      if(current&&!_own(line,"turbo"))_pushError(errors,path+".turbo","is required");
      const max=_enum(_readData(line,"max",path+".max",errors),FIELD_SCHEMA.lineMax,path+".max",errors);
      const spx=_number(_readData(line,"spx",path+".spx",errors),FIELD_SCHEMA.lineSpeed,path+".spx",errors);
      const turbo=_own(line,"turbo")?_number(_readData(line,"turbo",path+".turbo",errors),FIELD_SCHEMA.turbo,path+".turbo",errors):0;
      if(_own(line,"dup"))_number(_readData(line,"dup",path+".dup",errors),FIELD_SCHEMA.dupe,path+".dup",errors);
      out.lines.push({max,spx,turbo});
    });
  }

  if(_own(candidate,"maxTurbo"))out.maxTurbo=_number(_readData(candidate,"maxTurbo","maxTurbo",errors),FIELD_SCHEMA.maxTurbo,"maxTurbo",errors);
  if(_own(candidate,"dupe"))out.dupe=_number(_readData(candidate,"dupe","dupe",errors),FIELD_SCHEMA.dupe,"dupe",errors);
  else if(_own(candidate,"attrDupe")){
    const attr=_number(_readData(candidate,"attrDupe","attrDupe",errors),FIELD_SCHEMA.dupe,"attrDupe",errors);
    const trio=_own(candidate,"trio4")?_number(_readData(candidate,"trio4","trio4",errors),FIELD_SCHEMA.dupe,"trio4",errors):0;
    if(attr!==undefined&&trio!==undefined){
      const migrated=attr+(out.maxTurbo||0)*trio;
      out.dupe=_number(migrated,FIELD_SCHEMA.dupe,"dupe (migrated)",errors);
    }
  }else if(lines){
    const legacyLine=lines.find(line=>_plainObject(line)&&_own(line,"dup"));
    if(legacyLine)out.dupe=_number(_readData(legacyLine,"dup","lines[].dup",errors),FIELD_SCHEMA.dupe,"lines[].dup",errors);
  }
  if(_own(candidate,"margin"))out.margin=_number(_readData(candidate,"margin","margin",errors),FIELD_SCHEMA.margin,"margin",errors);
  if(_own(candidate,"mode"))out.mode=_enum(_readData(candidate,"mode","mode",errors),FIELD_SCHEMA.mode,"mode",errors);
  if(_own(candidate,"solveBudget"))out.solveBudget=_number(_readData(candidate,"solveBudget","solveBudget",errors),FIELD_SCHEMA.solveBudget,"solveBudget",errors);

  const rawBase=_readData(candidate,"baseTime","baseTime",errors),base=_object(rawBase,"baseTime",errors);
  if(base){
    ALLITEMS.forEach(item=>{
      if(current&&!_own(base,item))_pushError(errors,"baseTime."+item,"is required");
      if(_own(base,item))out.baseTime[item]=_number(_readData(base,item,"baseTime."+item,errors),FIELD_SCHEMA.baseTime,"baseTime."+item,errors);
    });
  }
  if(_own(candidate,"baseTimeRev"))out.baseTimeRev=_number(_readData(candidate,"baseTimeRev","baseTimeRev",errors),{type:"integer",min:0,max:CURRENT_SCHEMA_VERSION+10,allowBlank:false},"baseTimeRev",errors);

  const rawCosts=_readData(candidate,"prodCost","prodCost",errors),prodCost=_object(rawCosts,"prodCost",errors);
  if(prodCost){
    PRODUCTS.forEach(product=>{
      if(current&&!_own(prodCost,product))_pushError(errors,"prodCost."+product,"is required");
      if(!_own(prodCost,product))return;
      const productMap=_object(_readData(prodCost,product,"prodCost."+product,errors),"prodCost."+product,errors);if(!productMap)return;
      RECIPE[product].inputs.forEach(input=>{
        const path="prodCost."+product+"."+input;
        if(current&&!_own(productMap,input))_pushError(errors,path,"is required");
        if(!_own(productMap,input))return;
        const levelMap=_object(_readData(productMap,input,path,errors),path,errors);if(!levelMap)return;
        Object.keys(levelMap).forEach(level=>{if(!LEVELS.some(item=>String(item)===level))_pushError(errors,path+"."+level,"uses an unknown compression level");});
        LEVELS.forEach(level=>{
          if(current&&!_own(levelMap,String(level)))_pushError(errors,path+"."+level,"is required");
          if(_own(levelMap,String(level)))out.prodCost[product][input][level]=_number(_readData(levelMap,String(level),path+"."+level,errors),FIELD_SCHEMA.recipeCost,path+"."+level,errors);
        });
      });
    });
  }

  const copyItemMap=(key,rule,text)=>{
    if(!_own(candidate,key))return;
    const map=_object(_readData(candidate,key,key,errors),key,errors);if(!map)return;
    ALLITEMS.forEach(item=>{
      if(current&&!text&&!_own(map,item))_pushError(errors,key+"."+item,"is required");
      if(_own(map,item))out[key][item]=text?_string(_readData(map,item,key+"."+item,errors),rule,key+"."+item,errors):_number(_readData(map,item,key+"."+item,errors),rule,key+"."+item,errors);
    });
  };
  copyItemMap("sellPrice",FIELD_SCHEMA.amount,false);
  copyItemMap("priceText",FIELD_SCHEMA.displayText,true);
  copyItemMap("forgie",FIELD_SCHEMA.amount,false);
  copyItemMap("forgieText",FIELD_SCHEMA.displayText,true);
  copyItemMap("inventory",FIELD_SCHEMA.amount,false);
  copyItemMap("inventoryText",FIELD_SCHEMA.displayText,true);

  if(_own(candidate,"minedIncome")){
    const map=_object(_readData(candidate,"minedIncome","minedIncome",errors),"minedIncome",errors);
    if(map)MINED_RESOURCES.forEach(resource=>{
      if(current&&!_own(map,resource))_pushError(errors,"minedIncome."+resource,"is required");
      if(_own(map,resource))out.minedIncome[resource]=_number(_readData(map,resource,"minedIncome."+resource,errors),FIELD_SCHEMA.amount,"minedIncome."+resource,errors);
    });
  }else if(_own(candidate,"gelVesp"))out.minedIncome.Vespium=_number(_readData(candidate,"gelVesp","gelVesp",errors),FIELD_SCHEMA.amount,"gelVesp",errors);
  if(_own(candidate,"minedIncomeText")){
    const map=_object(_readData(candidate,"minedIncomeText","minedIncomeText",errors),"minedIncomeText",errors);
    if(map)MINED_RESOURCES.forEach(resource=>{
      if(current&&!_own(map,resource))_pushError(errors,"minedIncomeText."+resource,"is required");
      if(_own(map,resource))out.minedIncomeText[resource]=_string(_readData(map,resource,"minedIncomeText."+resource,errors),FIELD_SCHEMA.displayText,"minedIncomeText."+resource,errors);
    });
  }else if(_own(candidate,"gelVespText"))out.minedIncomeText.Vespium=_string(_readData(candidate,"gelVespText","gelVespText",errors),FIELD_SCHEMA.displayText,"gelVespText",errors);

  const rawTargets=_readData(candidate,"targets","targets",errors),targets=_object(rawTargets,"targets",errors);
  if(targets)ALLITEMS.forEach(item=>{
    const path="targets."+item;
    if(current&&!_own(targets,item))_pushError(errors,path,"is required");
    if(!_own(targets,item))return;
    const target=_object(_readData(targets,item,path,errors),path,errors);if(!target)return;
    if(!_own(target,"on"))_pushError(errors,path+".on","is required");
    if(!_own(target,"w"))_pushError(errors,path+".w","is required");
    out.targets[item]={
      on:_boolean(_readData(target,"on",path+".on",errors),path+".on",errors),
      w:_number(_readData(target,"w",path+".w",errors),FIELD_SCHEMA.targetWeight,path+".w",errors)
    };
  });

  let totalLevels=0,totalCosts=0;
  if(_own(candidate,"projects")){
    const projects=_array(_readData(candidate,"projects","projects",errors),"projects",errors,STATE_LIMITS.maxProjects);
    if(projects){out.projects=[];projects.slice(0,STATE_LIMITS.maxProjects).forEach((raw,index)=>{
      const path="projects["+index+"]",project=_object(raw,path,errors);if(!project)return;
      if(current)["id","name","on","prio","from","to","done","levels"].forEach(key=>{if(!_own(project,key))_pushError(errors,path+"."+key,"is required");});
      const rawLevels=_readData(project,"levels",path+".levels",errors),levels=_array(rawLevels,path+".levels",errors,STATE_LIMITS.maxLevelsPerProject);
      if(!levels||levels.length===0){_pushError(errors,path+".levels","must contain at least one level");return;}
      totalLevels+=levels.length;if(totalLevels>STATE_LIMITS.maxTotalLevels)_pushError(errors,"projects","exceeds the total level limit");
      const copiedLevels=[];
      levels.slice(0,STATE_LIMITS.maxLevelsPerProject).forEach((rawLevel,levelIndex)=>{
        const levelPath=path+".levels["+levelIndex+"]",level=_object(rawLevel,levelPath,errors);if(!level)return;
        const costs=_array(_readData(level,"costs",levelPath+".costs",errors),levelPath+".costs",errors,STATE_LIMITS.maxCostsPerLevel);if(!costs)return;
        totalCosts+=costs.length;if(totalCosts>STATE_LIMITS.maxTotalCosts)_pushError(errors,"projects","exceeds the total cost limit");
        const copiedCosts=[];
        costs.slice(0,STATE_LIMITS.maxCostsPerLevel).forEach((rawCost,costIndex)=>{
          const costPath=levelPath+".costs["+costIndex+"]",cost=_object(rawCost,costPath,errors);if(!cost)return;
          if(current)["item","qty"].forEach(key=>{if(!_own(cost,key))_pushError(errors,costPath+"."+key,"is required");});
          copiedCosts.push({
            item:_enum(_readData(cost,"item",costPath+".item",errors),FIELD_SCHEMA.item,costPath+".item",errors),
            qty:_number(_readData(cost,"qty",costPath+".qty",errors),FIELD_SCHEMA.amount,costPath+".qty",errors)
          });
        });
        copiedLevels.push({costs:copiedCosts});
      });
      const count=copiedLevels.length||1;
      const id=_own(project,"id")?_string(_readData(project,"id",path+".id",errors),FIELD_SCHEMA.id,path+".id",errors):"legacy-project-"+(index+1);
      const name=_own(project,"name")?_string(_readData(project,"name",path+".name",errors),FIELD_SCHEMA.projectName,path+".name",errors):"Project";
      const on=_own(project,"on")?_boolean(_readData(project,"on",path+".on",errors),path+".on",errors):true;
      const legacyCursorRule={type:"integer",min:-1e6,max:1e6,allowBlank:false};
      const cursorRule=current?{...FIELD_SCHEMA.projectIndex,max:count}:legacyCursorRule;
      const from=_own(project,"from")?_number(_readData(project,"from",path+".from",errors),cursorRule,path+".from",errors):1;
      const to=_own(project,"to")?_number(_readData(project,"to",path+".to",errors),cursorRule,path+".to",errors):count;
      if(current&&Number.isFinite(from)&&Number.isFinite(to)&&from>to)_pushError(errors,path+".from","must not exceed "+path+".to");
      const span=Number.isFinite(from)&&Number.isFinite(to)?Math.max(0,to-from+1):count;
      const doneRule=current?{...FIELD_SCHEMA.projectDone,max:span}:legacyCursorRule;
      const done=_own(project,"done")?_number(_readData(project,"done",path+".done",errors),doneRule,path+".done",errors):0;
      let prio=null;
      if(_own(project,"prio"))prio=_number(_readData(project,"prio",path+".prio",errors),FIELD_SCHEMA.projectPriority,path+".prio",errors);
      else if(_readData(project,"first",path+".first",errors)===true)prio=1;
      const copied={id,name,on,prio,from,to,done,levels:copiedLevels};
      if(_own(project,"catId"))copied.catId=_string(_readData(project,"catId",path+".catId",errors),FIELD_SCHEMA.id,path+".catId",errors);
      if(_own(project,"description"))copied.description=_string(_readData(project,"description",path+".description",errors),FIELD_SCHEMA.projectDescription,path+".description",errors);
      if(_own(project,"_open"))copied._open=_boolean(_readData(project,"_open",path+"._open",errors),path+"._open",errors);
      out.projects.push(copied);
    });}
  }

  if(_own(candidate,"projectSeq"))out.projectSeq=_boolean(_readData(candidate,"projectSeq","projectSeq",errors),"projectSeq",errors);
  if(_own(candidate,"projectGate"))out.projectGate=_boolean(_readData(candidate,"projectGate","projectGate",errors),"projectGate",errors);
  if(_own(candidate,"planStart"))out.planStart=_number(_readData(candidate,"planStart","planStart",errors),FIELD_SCHEMA.timestamp,"planStart",errors);

  if(_own(candidate,"manual")){
    const manual=_array(_readData(candidate,"manual","manual",errors),"manual",errors,STATE_LIMITS.maxLines);
    if(manual){if(current&&manual.length!==out.lines.length)_pushError(errors,"manual","must have one entry per crafter line");out.manual=[];manual.slice(0,STATE_LIMITS.maxLines).forEach((raw,index)=>{
      const path="manual["+index+"]",entry=_object(raw,path,errors);if(!entry)return;
      if(current)["job","lvl","sell"].forEach(key=>{if(!_own(entry,key))_pushError(errors,path+"."+key,"is required");});
      const job=_enum(_readData(entry,"job",path+".job",errors),FIELD_SCHEMA.manualJob,path+".job",errors);
      const lvl=_enum(_readData(entry,"lvl",path+".lvl",errors),FIELD_SCHEMA.lineMax,path+".lvl",errors);
      const sell=_boolean(_readData(entry,"sell",path+".sell",errors),path+".sell",errors);
      if(current&&Number.isFinite(lvl)&&out.lines[index]&&Number.isFinite(out.lines[index].max)&&lvl>out.lines[index].max)_pushError(errors,path+".lvl","must not exceed its crafter line cap");
      out.manual.push({job,lvl,sell});
    });}
  }
  if(_own(candidate,"manualSaved")){
    const presets=_array(_readData(candidate,"manualSaved","manualSaved",errors),"manualSaved",errors,STATE_LIMITS.maxPresets);
    if(presets){out.manualSaved=[];presets.slice(0,STATE_LIMITS.maxPresets).forEach((raw,index)=>{
      const path="manualSaved["+index+"]",preset=_object(raw,path,errors);if(!preset)return;
      if(current)["id","name","config"].forEach(key=>{if(!_own(preset,key))_pushError(errors,path+"."+key,"is required");});
      const config=_array(_readData(preset,"config",path+".config",errors),path+".config",errors,STATE_LIMITS.maxLines);if(!config)return;
      const copiedConfig=[];config.slice(0,STATE_LIMITS.maxLines).forEach((rawEntry,entryIndex)=>{
        const entryPath=path+".config["+entryIndex+"]",entry=_object(rawEntry,entryPath,errors);if(!entry)return;
        if(current)["job","lvl","sell"].forEach(key=>{if(!_own(entry,key))_pushError(errors,entryPath+"."+key,"is required");});
        copiedConfig.push({job:_enum(_readData(entry,"job",entryPath+".job",errors),FIELD_SCHEMA.manualJob,entryPath+".job",errors),lvl:_enum(_readData(entry,"lvl",entryPath+".lvl",errors),FIELD_SCHEMA.lineMax,entryPath+".lvl",errors),sell:_boolean(_readData(entry,"sell",entryPath+".sell",errors),entryPath+".sell",errors)});
      });
      out.manualSaved.push({id:_own(preset,"id")?_string(_readData(preset,"id",path+".id",errors),FIELD_SCHEMA.id,path+".id",errors):"legacy-preset-"+(index+1),name:_own(preset,"name")?_string(_readData(preset,"name",path+".name",errors),FIELD_SCHEMA.projectName,path+".name",errors):"Setup",config:copiedConfig});
    });}
  }
  if(_own(candidate,"manualActiveId")){
    const active=_readData(candidate,"manualActiveId","manualActiveId",errors);
    out.manualActiveId=active===null?null:_string(active,FIELD_SCHEMA.id,"manualActiveId",errors);
  }

  if(errors.length)return {ok:false,errors,sourceVersion};
  normalize(out);
  out.schemaVersion=CURRENT_SCHEMA_VERSION;
  return {ok:true,state:out,sourceVersion};
}

function parseStoredState(raw){
  if(raw===null||raw===undefined||raw==="")return {state:_freshCurrentDefaults(),recovery:null};
  if(typeof raw!=="string")return {state:_freshCurrentDefaults(),recovery:{raw:String(raw),reason:"Stored save must be text"}};
  if(raw.length>STATE_LIMITS.maxBytes)return {state:_freshCurrentDefaults(),recovery:{raw,reason:"Stored save is too large to open safely"}};
  let candidate;
  try{candidate=JSON.parse(raw);}catch(error){return {state:_freshCurrentDefaults(),recovery:{raw,reason:"Stored save is not valid JSON"}};}
  const result=validateAndMigrate(candidate);
  if(!result.ok)return {state:_freshCurrentDefaults(),recovery:{raw,reason:result.errors.join("; "),errors:result.errors,sourceVersion:result.sourceVersion}};
  return {state:result.state,recovery:null};
}
function importState(candidate){return validateAndMigrate(candidate);}
function validateWorkerState(candidate){return validateAndMigrate(candidate);}

function quarantineRejectedState(raw,reason){
  _activeStateRecovery={raw:typeof raw==="string"?raw:String(raw==null?"":raw),reason:String(reason||"Save rejected")};
  if(typeof localStorage!=="undefined")try{
    localStorage.setItem(STATE_REJECTED_KEY,_activeStateRecovery.raw);
    localStorage.setItem(STATE_REJECTED_REASON_KEY,_activeStateRecovery.reason);
  }catch(error){}
  return _activeStateRecovery;
}
function _acceptStateMutation(change){
  let result;
  if(typeof change==="function")result=change(S);
  else{S=change;result=S;}
  stateRevision+=1;
  return result===undefined?S:result;
}
function commitState(nextState){return _acceptStateMutation(nextState);}
function mutateState(mutator){
  if(typeof mutator!=="function")throw new TypeError("mutateState requires a mutation function");
  return _acceptStateMutation(mutator);
}
// Persistence validation returns a fresh, normalized clone of the already accepted state. Adopting
// that equivalent clone must not manufacture a second logical mutation/revision.
function _adoptValidatedClone(nextState){S=nextState;return S;}
function _readStorage(key){
  if(typeof localStorage==="undefined")return {ok:false,raw:null,error:"Local storage is unavailable"};
  try{return {ok:true,raw:localStorage.getItem(key)};}catch(error){return {ok:false,raw:null,error:(error&&error.message)||String(error)};}
}
function _restoreStorage(key,raw){if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);}
function _restorePersistedPair(mainRaw,backupRaw){
  try{_restoreStorage(LSKEY,mainRaw);}catch(error){}
  try{_restoreStorage(STATE_BACKUP_KEY,backupRaw);}catch(error){}
}
function _persistValidatedState(state,previousRaw){
  const validation=validateAndMigrate(state);
  if(!validation.ok)return {ok:false,errors:validation.errors};
  if(typeof localStorage==="undefined")return {ok:false,errors:["Local storage is unavailable"]};
  const nextRaw=JSON.stringify(validation.state);
  const oldMain=previousRaw!==undefined?previousRaw:_readStorage(LSKEY).raw;
  const oldBackup=_readStorage(STATE_BACKUP_KEY).raw;
  try{
    if(oldMain&&parseStoredState(oldMain).recovery===null)localStorage.setItem(STATE_BACKUP_KEY,oldMain);
    localStorage.setItem(LSKEY,nextRaw);
    return {ok:true,state:validation.state,raw:nextRaw};
  }catch(error){
    // Restore each key independently: an origin that rejects writes to the primary key
    // must not prevent restoration of the backup key changed earlier in the transaction.
    _restorePersistedPair(oldMain,oldBackup);
    return {ok:false,errors:[(error&&error.message)||String(error)]};
  }
}
function initializeState(render){
  const stored=_readStorage(LSKEY),raw=stored.raw;
  const backupBefore=_readStorage(STATE_BACKUP_KEY).raw;
  const parsed=stored.ok?parseStoredState(raw):{state:_freshCurrentDefaults(),recovery:null};
  commitState(parsed.state);
  let recovery=parsed.recovery;
  try{render();}
  catch(error){
    if(raw!==null){
      _restorePersistedPair(raw,backupBefore);
      recovery={raw,reason:"The saved build could not be rendered safely: "+((error&&error.message)||String(error))};
      commitState(_freshCurrentDefaults());
      render();
    }else throw error;
  }
  if(recovery)quarantineRejectedState(recovery.raw,recovery.reason);
  else if(stored.ok){
    const persisted=_persistValidatedState(S,raw);
    if(persisted.ok)_adoptValidatedClone(persisted.state);
  }
  return {state:S,recovery};
}
function applyImportedState(candidate,render){
  const validation=importState(candidate);
  if(!validation.ok)return validation;
  const previousState=S,previousRaw=_readStorage(LSKEY).raw,previousBackup=_readStorage(STATE_BACKUP_KEY).raw;
  commitState(validation.state);
  try{render();}
  catch(error){
    _restorePersistedPair(previousRaw,previousBackup);
    commitState(previousState);
    try{render();}catch(rollbackError){}
    return {ok:false,errors:["Imported build could not be rendered: "+((error&&error.message)||String(error))]};
  }
  const persisted=_persistValidatedState(S,previousRaw);
  if(!persisted.ok){
    commitState(previousState);
    try{render();}catch(rollbackError){}
    return {ok:false,errors:persisted.errors};
  }
  _adoptValidatedClone(persisted.state);
  return {ok:true,state:S,sourceVersion:validation.sourceVersion};
}

let savT;
function save(){
  const previousRaw=_readStorage(LSKEY).raw;
  const persisted=_persistValidatedState(S,previousRaw);
  if(!persisted.ok){
    const el=typeof document!=="undefined"?document.getElementById("saveind"):null;
    if(el)el.textContent="invalid value not saved";
    return false;
  }
  _adoptValidatedClone(persisted.state);flashSaved();return true;
}
function flashSaved(){
  const el=typeof document!=="undefined"?document.getElementById("saveind"):null;if(!el)return;
  el.innerHTML="<b>saved</b>";clearTimeout(savT);savT=setTimeout(()=>el.textContent="auto-saves locally",1400);
}
