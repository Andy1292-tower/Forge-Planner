"use strict";

/* Persisted-field rules are the one numeric authority for imports, live controls, the page-side
 * dispatch boundary, and the generated Blob Worker. Collection limits remain deliberately
 * generous security ceilings, not recommendations for ordinary planner builds. */
const CURRENT_SCHEMA_VERSION=2;
const STATE_LIMITS=Object.freeze({
  maxBytes:2*1024*1024,
  maxDepth:10,
  maxNodes:50000,
  maxArrayLength:32768,
  maxObjectKeys:512,
  maxLines:64,
  maxProjects:128,
  maxLevelsPerProject:256,
  maxCostsPerLevel:64,
  maxTotalLevels:4096,
  maxTotalCosts:32768,
  maxPresets:128,
  maxStringLength:2048
});

const _FIELD_DEFAULTS=defaults();
const DISPLAY_TEXT_MAX_LENGTH=128;
const _field=(type,defaultValue,extra)=>Object.freeze({type,defaultValue,...extra});
const _amountField=(label,persistsDisplayText=false)=>_field("number",null,{min:0,max:1e100,allowBlank:true,notation:"game",inputMode:"decimal",label,
  ...(persistsDisplayText?{maxDraftLength:DISPLAY_TEXT_MAX_LENGTH}:{})});
const FIELD_SCHEMA=Object.freeze({
  schemaVersion:_field("integer",CURRENT_SCHEMA_VERSION,{min:CURRENT_SCHEMA_VERSION,max:CURRENT_SCHEMA_VERSION,allowBlank:false,label:"save version"}),
  lineMax:_field("enum",_FIELD_DEFAULTS.lines[0].max,{values:Object.freeze(LEVELS.slice()),allowBlank:false,label:"compression"}),
  lineSpeed:_field("number",1,{min:1e-6,max:1e9,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"line speed"}),
  turbo:_field("number",0,{min:0,max:1e6,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"turbo stacks"}),
  maxTurbo:_field("number",_FIELD_DEFAULTS.maxTurbo,{min:0,max:1e6,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"maximum turbo stacks"}),
  dupe:_field("number",_FIELD_DEFAULTS.dupe,{min:0,max:100,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"duplication chance"}),
  margin:_field("number",_FIELD_DEFAULTS.margin,{min:0,max:20,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"May-work margin"}),
  solveBudget:_field("integer",_FIELD_DEFAULTS.solveBudget,{min:200,max:60000,allowBlank:false,notation:"decimal",inputMode:"numeric",label:"solve time in milliseconds"}),
  baseTime:_field("number",null,{min:1e-6,max:1e15,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"base craft time"}),
  baseTimeRev:_field("integer",CURRENT_SCHEMA_VERSION,{min:0,max:CURRENT_SCHEMA_VERSION+10,allowBlank:false,notation:"decimal",inputMode:"numeric",label:"base-time revision"}),
  recipeCost:_field("number",null,{min:0,max:1e100,allowBlank:true,notation:"decimal",inputMode:"decimal",label:"recipe cost"}),
  sellPrice:_amountField("sell price",true),
  forgie:_amountField("Lil' Forgie rate",true),
  minedIncome:_amountField("mined income",true),
  inventory:_amountField("inventory amount",true),
  projectQuantity:_amountField("project quantity"),
  /* Backward-compatible alias for non-UI migrations; live field families use the named rules. */
  amount:_amountField("amount"),
  calibrationSpeed:_field("number",null,{min:1e-6,max:1e9,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"calibration speed"}),
  calibrationSeconds:_field("number",null,{min:1e-6,max:1e15,allowBlank:false,notation:"decimal",inputMode:"decimal",label:"craft seconds"}),
  targetEnabled:_field("boolean",false,{allowBlank:false,label:"target enabled"}),
  targetWeight:_field("integer",1,{min:1,max:9,allowBlank:false,notation:"decimal",inputMode:"numeric",label:"target priority"}),
  mode:_field("enum",_FIELD_DEFAULTS.mode,{values:Object.freeze(["items","credits","project","manual"]),allowBlank:false,label:"planner mode"}),
  projectStability:_field("enum",_FIELD_DEFAULTS.projectStability,{values:Object.freeze(["prefer-current","reoptimize"]),allowBlank:false,label:"Project line-job policy"}),
  flag:_field("boolean",false,{allowBlank:false,label:"option"}),
  displayText:_field("string","",{maxLength:DISPLAY_TEXT_MAX_LENGTH,allowBlank:true,label:"display text"}),
  id:_field("string","",{maxLength:64,allowBlank:false,pattern:/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,label:"ID"}),
  projectName:_field("string","Project",{maxLength:256,allowBlank:true,label:"project name"}),
  projectDescription:_field("string","",{maxLength:2048,allowBlank:true,label:"project description"}),
  projectIndex:_field("integer",1,{min:1,max:1e6,allowBlank:false,notation:"decimal",inputMode:"numeric",label:"project level"}),
  projectPriority:_field("integer",null,{min:1,max:1e6,allowBlank:true,notation:"decimal",inputMode:"numeric",label:"project order"}),
  projectDone:_field("integer",0,{min:0,max:1e6,allowBlank:false,notation:"decimal",inputMode:"numeric",label:"completed project levels"}),
  item:_field("enum",PRODUCTS[0],{values:Object.freeze(ALLITEMS.slice()),allowBlank:false,label:"item"}),
  manualJob:_field("enum","Idle",{values:Object.freeze(["Idle",...ALLITEMS]),allowBlank:false,label:"Manual job"}),
  timestamp:_field("number",null,{min:0,max:Number.MAX_SAFE_INTEGER,allowBlank:true,notation:"decimal",inputMode:"numeric",label:"time"})
});

function _fieldNumber(value){
  if(typeof value!=="number"||!Number.isFinite(value))return null;
  return value;
}
function _fieldBound(value){return String(value);}
function fieldRuleDescription(rule){
  const label=rule.label||"value";
  if(rule.type==="integer")return `${label} as a whole number from ${_fieldBound(rule.min)} to ${_fieldBound(rule.max)}`;
  if(rule.type==="number"){
    const notation=rule.notation==="game"?" (game suffixes such as k, m, or qa are allowed)":"";
    return `${label} from ${_fieldBound(rule.min)} to ${_fieldBound(rule.max)}${notation}`;
  }
  if(rule.type==="enum")return `${label} as one of ${rule.values.join(", ")}`;
  return label;
}
function _fieldMessage(rule,prefix="Enter"){
  const description=fieldRuleDescription(rule);
  if(rule.type==="integer")return `${prefix} ${description}.`;
  return `${prefix} ${description}.`;
}
function validateFieldValue(rule,value){
  if(!rule||typeof rule!=="object")return {valid:false,message:"This field is not configured."};
  if(value===null){
    return rule.allowBlank?{valid:true,value:null}:{valid:false,message:_fieldMessage(rule)};
  }
  if(rule.type==="number"||rule.type==="integer"){
    const number=_fieldNumber(value);
    if(number===null)return {valid:false,message:_fieldMessage(rule)};
    if(rule.type==="integer"&&!Number.isInteger(number))return {valid:false,message:_fieldMessage(rule)};
    if(number<rule.min||number>rule.max)return {valid:false,message:_fieldMessage(rule)};
    return {valid:true,value:number};
  }
  if(rule.type==="enum")return rule.values.includes(value)
    ?{valid:true,value}
    :{valid:false,message:_fieldMessage(rule)};
  if(rule.type==="boolean")return typeof value==="boolean"
    ?{valid:true,value}
    :{valid:false,message:`Choose a valid ${rule.label||"option"}.`};
  if(rule.type==="string"){
    if(typeof value!=="string")return {valid:false,message:`Enter ${rule.label||"text"} as text.`};
    if(!rule.allowBlank&&value.length===0)return {valid:false,message:`Enter ${rule.label||"text"}.`};
    if(value.length>rule.maxLength)return {valid:false,message:`Keep ${rule.label||"text"} to ${rule.maxLength} characters or fewer.`};
    if(rule.pattern&&!rule.pattern.test(value))return {valid:false,message:`Enter a valid ${rule.label||"value"}.`};
    return {valid:true,value};
  }
  return {valid:false,message:"This field is not configured."};
}

function _decimalIncomplete(value){
  return /^[+-]?(?:\.|\d+\.?\d*)?[eE][+-]?$/.test(value)||/^[+-]?$/.test(value)||/^[+-]?\.$/.test(value);
}
function _parseDecimalSyntax(value){
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))return null;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}
function _parseGameSyntax(raw){
  const value=raw.toLowerCase().replace(/,/g,"").replace(/\s+/g,"");
  if(_decimalIncomplete(value))return {incomplete:true};
  const match=value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/);
  if(!match)return {invalid:true};
  const suffix=match[2];
  if(suffix&&SUFFIX[suffix]==null){
    const canComplete=Object.keys(SUFFIX).some(candidate=>candidate.startsWith(suffix));
    return canComplete?{incomplete:true}:{invalid:true};
  }
  let number=Number(match[1]);
  if(!Number.isFinite(number))return {invalid:true};
  if(suffix)number*=SUFFIX[suffix];
  return Number.isFinite(number)?{value:number}:{invalid:true};
}
function parseFieldDraft(rule,raw,options={}){
  if(options&&options.badInput)return {status:"incomplete",message:_fieldMessage(rule,"Finish entering")};
  const source=String(raw==null?"":raw),text=source.trim();
  if(text==="")return rule.allowBlank
    ?{status:"blank",value:null}
    :{status:"invalid",message:_fieldMessage(rule)};
  if(rule.maxDraftLength&&source.length>rule.maxDraftLength)return {
    status:"invalid",message:`Keep ${rule.label||"this value"} to ${rule.maxDraftLength} characters or fewer.`
  };
  if(rule.type==="enum"){
    const checked=validateFieldValue(rule,text);
    return checked.valid?{status:"valid",value:checked.value}:{status:"invalid",message:checked.message};
  }
  if(rule.type!=="number"&&rule.type!=="integer")return {status:"invalid",message:_fieldMessage(rule)};
  let parsed;
  if(rule.notation==="game"){
    parsed=_parseGameSyntax(text);
    if(parsed.incomplete)return {status:"incomplete",message:_fieldMessage(rule,"Finish entering")};
    if(parsed.invalid)return {status:"invalid",message:_fieldMessage(rule)};
    parsed=parsed.value;
  }else{
    if(_decimalIncomplete(text))return {status:"incomplete",message:_fieldMessage(rule,"Finish entering")};
    parsed=_parseDecimalSyntax(text);
    if(parsed===null)return {status:"invalid",message:_fieldMessage(rule)};
  }
  const checked=validateFieldValue(rule,parsed);
  return checked.valid?{status:"valid",value:checked.value}:{status:"invalid",message:checked.message};
}

function formatFieldValue(rule,value){
  if(value===null||value===undefined)return "";
  const checked=validateFieldValue(rule,value);
  if(!checked.valid)return "";
  if(rule.notation==="game"){
    const compact=formatGameNum(checked.value,4),roundTrip=parseFieldDraft(rule,compact);
    return roundTrip.status==="valid"&&roundTrip.value===checked.value?compact:String(checked.value);
  }
  return String(checked.value);
}
function fieldInputAttributes(rule,overrides={}){
  const attrs={};
  if(rule&&(rule.type==="number"||rule.type==="integer")){
    attrs.min=String(rule.min);
    attrs.max=String(rule.max);
    attrs.step=rule.type==="integer"?"1":"any";
    attrs.inputmode=rule.inputMode||(rule.type==="integer"?"numeric":"decimal");
    if(rule.maxDraftLength)attrs.maxlength=String(rule.maxDraftLength);
  }
  Object.entries(overrides||{}).forEach(([key,value])=>{
    if(value===null||value===undefined||value===false)delete attrs[key];
    else attrs[key]=String(value);
  });
  return attrs;
}
function fieldRuleWithBounds(rule,{min=rule.min,max=rule.max,label=rule.label}={}){
  return Object.freeze({...rule,min,max,label});
}
function clampFieldValue(rule,value,fallback=rule.defaultValue){
  const checked=validateFieldValue(rule,value);
  if(checked.valid&&checked.value!==null)return checked.value;
  const fallbackChecked=validateFieldValue(rule,fallback);
  return fallbackChecked.valid?fallbackChecked.value:rule.min;
}
