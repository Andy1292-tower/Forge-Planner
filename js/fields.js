"use strict";

/* Authoritative persisted-field rules. Task 8 may bind these descriptors to controls, but
 * validation and migrations own the rules now. Collection limits are deliberately generous
 * security ceilings, not recommendations for ordinary planner builds. */
const CURRENT_SCHEMA_VERSION=1;
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
const _field=(type,defaultValue,extra)=>Object.freeze({type,defaultValue,...extra});
const FIELD_SCHEMA=Object.freeze({
  schemaVersion:_field("integer",CURRENT_SCHEMA_VERSION,{min:CURRENT_SCHEMA_VERSION,max:CURRENT_SCHEMA_VERSION,allowBlank:false}),
  lineMax:_field("enum",_FIELD_DEFAULTS.lines[0].max,{values:Object.freeze(LEVELS.slice()),allowBlank:false}),
  lineSpeed:_field("number",1,{min:1e-6,max:1e9,allowBlank:false}),
  turbo:_field("number",0,{min:0,max:1e6,allowBlank:false}),
  maxTurbo:_field("number",_FIELD_DEFAULTS.maxTurbo,{min:0,max:1e6,allowBlank:false}),
  dupe:_field("number",_FIELD_DEFAULTS.dupe,{min:0,max:100,allowBlank:false}),
  margin:_field("number",_FIELD_DEFAULTS.margin,{min:0,max:20,allowBlank:false}),
  solveBudget:_field("integer",_FIELD_DEFAULTS.solveBudget,{min:200,max:60000,allowBlank:false}),
  baseTime:_field("number",null,{min:1e-6,max:1e15,allowBlank:false}),
  amount:_field("number",null,{min:0,max:1e100,allowBlank:true}),
  recipeCost:_field("number",null,{min:0,max:1e100,allowBlank:true}),
  targetEnabled:_field("boolean",false,{allowBlank:false}),
  targetWeight:_field("integer",1,{min:1,max:9,allowBlank:false}),
  mode:_field("enum",_FIELD_DEFAULTS.mode,{values:Object.freeze(["items","credits","project","manual"]),allowBlank:false}),
  flag:_field("boolean",false,{allowBlank:false}),
  displayText:_field("string","",{maxLength:128,allowBlank:true}),
  id:_field("string","",{maxLength:64,allowBlank:false,pattern:/^[A-Za-z][A-Za-z0-9_-]{0,63}$/}),
  projectName:_field("string","Project",{maxLength:256,allowBlank:true}),
  projectDescription:_field("string","",{maxLength:2048,allowBlank:true}),
  projectIndex:_field("integer",1,{min:1,max:1e6,allowBlank:false}),
  projectPriority:_field("integer",null,{min:1,max:1e6,allowBlank:true}),
  projectDone:_field("integer",0,{min:0,max:1e6,allowBlank:false}),
  item:_field("enum",PRODUCTS[0],{values:Object.freeze(ALLITEMS.slice()),allowBlank:false}),
  manualJob:_field("enum","Idle",{values:Object.freeze(["Idle",...ALLITEMS]),allowBlank:false}),
  timestamp:_field("number",null,{min:0,max:Number.MAX_SAFE_INTEGER,allowBlank:true})
});
