"use strict";

/* Game loadout code windows and the buttons that open them.
 *
 * Export lives beside every build the planner draws — the Max items / Max credits line assignment,
 * the Manual setup and each Project step — and opens one window that names, icons and copies the
 * code. Import lives in Manual only. There is no browser here: the page scripts run in a vm context
 * against a small fake document, and the renderers' HTML is read as text. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ---- a fake document: just what the loadout windows and the DOM helpers touch ---- */
class FakeClassList {
  constructor() { this.names = new Set(); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  contains(name) { return this.names.has(name); }
  toggle(name, on) { if (on === undefined) on = !this.names.has(name); if (on) this.names.add(name); else this.names.delete(name); return on; }
}
class FakeEl {
  constructor(tag, id) {
    this.tagName = String(tag || "div").toUpperCase();
    this.id = id || "";
    this.children = [];
    this.options = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.value = ""; this.textContent = ""; this.title = "";
    this.hidden = false; this.disabled = false; this.checked = false; this.selected = false;
  }
  set className(value) { this.classList = new FakeClassList(); String(value).split(/\s+/).filter(Boolean).forEach(n => this.classList.add(n)); }
  get className() { return [...this.classList.names].join(" "); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type, extra) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    (this.listeners[type] || []).forEach(fn => fn(event));
    return event;
  }
  appendChild(child) { this.children.push(child); if (this.tagName === "SELECT" && child.tagName === "OPTION") this.options.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  focus() { fakeDocument.activeElement = this; }
  select() { this.selected = true; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  // Every piece of text under this element, the way a reader would meet it.
  get text() { return [this.textContent, ...this.children.map(child => child && child.text !== undefined ? child.text : String(child))].join(" "); }
}
const elements = {};
const fakeDocument = {
  activeElement: null,
  getElementById: id => elements[id] || (elements[id] = new FakeEl("div", id)),
  querySelector: selector => elements[selector] || (elements[selector] = new FakeEl("div")),
  createElement: tag => new FakeEl(tag)
};
// The windows' selects and inputs, created up front so their tag is right.
for (const [id, tag] of [["loadoutExportIcon", "select"], ["loadoutExportName", "input"], ["loadoutExportCode", "input"],
  ["loadoutImportCode", "input"], ["loadoutImportName", "input"], ["loadoutImportSave", "input"], ["loadoutImportApply", "button"]])
  elements[id] = new FakeEl(tag, id);

const dialogs = [];
const context = vm.createContext({
  console, setTimeout, clearTimeout,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: fakeDocument,
  navigator: {},
  confirm: () => { throw new Error("confirm was not expected"); },
  dialogController: { register(options) {
    const dialog = { options, isOpen: false, opened: 0, closed: 0, invoker: null,
      open(invoker) { dialog.isOpen = true; dialog.opened++; dialog.invoker = invoker; if (options.onOpen) options.onOpen(); },
      close() { dialog.isOpen = false; dialog.closed++; } };
    dialogs.push(dialog);
    return dialog;
  } },
  staleCauses: new Set(),
  _lastItemsCreditsRes: null,
  _lastProjectRes: null,
  commitResultMutation: () => { throw new Error("commitResultMutation was not expected"); },
  renderLines: () => {},
  renderModeSwitch: () => {}
});
for (const file of ["js/decimal.js", "js/catalog.js", "js/core.js", "js/fields.js", "js/state.js", "js/dom.js",
  "js/loadout-code.js", "js/manual.js", "js/loadout-ui.js"])
  vm.runInContext(read(file), context, { filename: path.join(ROOT, file) });
const api = expression => vm.runInContext(expression, context);
const call = (name, ...args) => api(name)(...args);
const setState = state => { context.__next = state; api("S=__next"); };
const [exportDialog, importDialog] = dialogs;
const el = id => fakeDocument.getElementById(id);
// A click inside #results, landing on the element that answers `selector`.
const clickResults = (selector, target) => el("results").dispatch("click",
  { target: { closest: candidate => (candidate === selector ? target : null) } });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const line = max => ({ max, spx: 1, turbo: 0 });
const factory = maxes => {
  const st = JSON.parse(JSON.stringify(call("defaults")));
  st.lines = maxes.map(line);
  call("syncManual", st);
  return st;
};
const wirePlan = count => Array.from({ length: count }, (_, i) =>
  ({ job: i < 2 ? { kind: "craft", res: "Wire", lvl: 16 } : { kind: "idle", res: null, lvl: null } }));
const button = (id, attributes = {}) => Object.assign(new FakeEl("button", id), { attributes });

/* ---- page wiring ---- */

test("both scripts load in the same place on the page and in the release build", () => {
  const pageOrder = [...read("index.html").matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]).filter(f => f !== "boot.js");
  const buildOrder = [...read("scripts/build-static.cjs").match(/const PAGE_SCRIPTS = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(pageOrder, buildOrder);
  assert.equal(pageOrder[pageOrder.indexOf("state.js") + 1], "loadout-code.js");
  assert.equal(pageOrder[pageOrder.indexOf("events.js") + 1], "loadout-ui.js");
});

test("the windows are body-level dialogs with the controls the script drives", () => {
  const html = read("index.html");
  for (const id of ["loadoutExportModal", "loadoutExportSource", "loadoutExportName", "loadoutExportIcon", "loadoutExportCode",
    "loadoutExportNotes", "loadoutExportStatus", "loadoutExportCopy"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<div class="modal-bg" id="loadoutExportModal" hidden>\s*<div class="modal dialog-shell loadout-modal" role="dialog" aria-modal="true" aria-labelledby="loadoutExportTitle">/);
  // The dialog controller inerts every child of <body> but the open one, so a window nested inside
  // the page would inert itself: count the <div>s still open where the window starts.
  const between = html.slice(html.indexOf("<body"), html.indexOf('<div class="modal-bg" id="loadoutExportModal"'));
  assert.equal((between.match(/<div\b/g) || []).length - (between.match(/<\/div>/g) || []).length, 0);
});

/* ---- export buttons ---- */

test("Manual offers Game code only when a line is busy", () => {
  const ids = st => { setState(st); const bar = new FakeEl("div"); call("renderManualPresetBar", bar, st.manualSaved, null); return bar.children.map(c => c.id); };
  const idle = factory([512, 64]);
  assert.ok(!ids(idle).includes("manualExportCode"));
  const busy = factory([512, 64]);
  busy.manual[1] = { job: "Rods", lvl: 64, sell: false };
  assert.ok(ids(busy).includes("manualExportCode"));
});

// stepPlanHtml lives in events.js, which wires the live page as it loads; slice the renderer out.
const eventsSrc = read("js/events.js");
const stepStart = eventsSrc.indexOf("function stepPlanHtml(res){"), stepEnd = eventsSrc.indexOf("// ── Plan-start", stepStart);
const stepPlanHtml = Function("S", "fmtDuration", "htmlText", "htmlAttribute", "disp", "RAWS", "MINED_CRAFTS", "compressionLabel",
  "minedUsageNote", "projectStepLoadouts", eventsSrc.slice(stepStart, stepEnd) + "\nreturn stepPlanHtml;")(
  { planStart: Date.UTC(2026, 9, 9, 12), projLineMode: "split" }, h => h + "h", api("htmlText"), api("htmlAttribute"), String,
  api("RAWS"), {}, api("compressionLabel"), () => "", api("projectStepLoadouts"));
const entry = (item, lvl, start, end, eta) => ({ item, lvl, frac: (end - start) / eta, start, end, outHr: 1, cons: [] });
const stepRes = (overrides = {}) => ({
  empty: false, phases: [{}], feasible: true, lpFeasible: true, eta: 4,
  executionPhases: [
    { kind: "prerequisite", eta: 0, plan: [], externalSupply: { Bits: 10 }, invStart: { Bits: 0 } },
    { kind: "warmup", name: "Warm-up: Rods", eta: 1, plan: [{ line: 1, max: 64, entries: [entry("Rods", 64, 0, 1, 1)] }] },
    { kind: "project", name: "Tower-of \"Chad\"", eta: 3, plan: [
      { line: 1, max: 64, entries: [entry("Rods", 64, 0, 2, 3), entry("Frames", 16, 2, 3, 3)] },
      { line: 2, max: 64, entries: [entry("Plates", 64, 0, 3, 3)] }] }],
  scheduleValidation: { ok: true, boundaries: [
    { kind: "switch", phaseIndex: 1, phaseTime: 1, active: [{ line: 1, item: "Rods", lvl: 64 }] },
    { kind: "switch", phaseIndex: 2, phaseTime: 2, active: [{ line: 1, item: "Rods", lvl: 64 }, { line: 2, item: "Plates", lvl: 64 }] },
    { kind: "switch", phaseIndex: 2, phaseTime: 3, active: [{ line: 1, item: "Frames", lvl: 16 }, { line: 2, item: "Plates", lvl: 64 }] }] },
  ...overrides
});

test("a Project step with one loadout gets a Game code button in its header", () => {
  const html = stepPlanHtml(stepRes());
  const header = html.slice(html.indexOf('<span class="step-n">2</span>'), html.indexOf("</div>", html.indexOf('<span class="step-n">2</span>')));
  assert.match(header, /<button type="button" class="btn ghost step-code" id="loadoutStep1_0" data-loadout-step="1" data-loadout-slice="0"/);
  assert.match(header, />Game code<\/button>/);
  assert.match(header, /data-loadout-label="Step 2 \(warm-up\), from the start of the step until ~[^"]+"/);
});

test("a Project step whose crafters change job partway through gets one button per loadout", () => {
  const html = stepPlanHtml(stepRes());
  const row = html.match(/<div class="step-codes">([\s\S]*?)<\/div>/);
  assert.ok(row, "the step has a row of codes");
  assert.match(row[1], /Game codes:/);
  assert.match(row[1], /id="loadoutStep2_0"[^>]*>Start<\/button>/);
  assert.match(row[1], /id="loadoutStep2_1"[^>]*>~[^<]+<\/button>/);
  assert.match(row[1], /data-loadout-label="Step 3 \(Tower-of &quot;Chad&quot;\), from ~[^"]+ until ~[^"]+"/);
  assert.ok(!/id="loadoutStep2_0"[^>]*>Game code/.test(html), "a multi-loadout step has no single header button");
});

test("no codes for a prerequisite step or a blocked plan", () => {
  assert.ok(!stepPlanHtml(stepRes()).includes('data-loadout-step="0"'), "prerequisite step");
  for (const blocked of [{ feasible: false }, { lpFeasible: false }, { scheduleValidation: { ok: false, boundaries: [] } }])
    assert.ok(!stepPlanHtml(stepRes(blocked)).includes("data-loadout-step"), JSON.stringify(blocked));
});

/* ---- export window ---- */

test("Max items: the window opens prefilled and the code follows the name and icon", () => {
  setState(factory([16, 16, 16]));
  context._lastItemsCreditsRes = { mode: "items", targets: ["Wire"], plan: wirePlan(3) };
  const invoker = button("btnExportCode");
  clickResults("#btnExportCode", invoker);
  assert.equal(exportDialog.isOpen, true);
  assert.equal(exportDialog.invoker, invoker);
  assert.match(el("loadoutExportSource").textContent, /last Max items\/hr solve/);
  assert.equal(el("loadoutExportName").value, "Max Wire");
  assert.equal(el("loadoutExportIcon").value, "11");
  assert.equal(el("loadoutExportIcon").options.length, 12);
  assert.equal(el("loadoutExportCode").value, "Max Wire-11-alae-alae-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa");
  el("loadoutExportName").value = "my-wire";
  el("loadoutExportName").dispatch("input");
  assert.equal(el("loadoutExportCode").value, "my wire-11-alae-alae-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa");
  el("loadoutExportIcon").value = "3";
  el("loadoutExportIcon").dispatch("change");
  assert.equal(el("loadoutExportCode").value, "my wire-3-alae-alae-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa");
  el("loadoutExportName").value = " ";
  el("loadoutExportName").dispatch("input");
  assert.match(el("loadoutExportCode").value, /^Max Wire-3-/, "a blanked name falls back to the default");
  exportDialog.close();
});

test("Max credits names the item it sells", () => {
  setState(factory([16, 16]));
  context._lastItemsCreditsRes = { mode: "credits", bestItem: "Wire", plan: wirePlan(2) };
  clickResults("#btnExportCode", button("btnExportCode"));
  assert.match(el("loadoutExportSource").textContent, /Max credits\/hr solve, which sells Wire\./);
  assert.equal(el("loadoutExportName").value, "Max credits");
  exportDialog.close();
});

test("lines past eight and an out-of-date plan are both called out; Manual is never out of date", () => {
  setState(factory(Array(10).fill(16)));
  const plan = wirePlan(10); plan[9] = { job: { kind: "craft", res: "Bits", lvl: 1 } };
  context._lastItemsCreditsRes = { mode: "items", targets: ["Wire", "Bits"], plan };
  context.staleCauses = new Set(["lines"]);
  clickResults("#btnExportCode", button("btnExportCode"));
  const notes = el("loadoutExportNotes").children.map(c => c.textContent);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /Line #10 is left out — a game loadout holds 8 crafters\./);
  assert.match(notes[1], /out of date/);
  exportDialog.close();
  const st = factory([16]); st.manual[0] = { job: "Bits", lvl: 16, sell: false }; setState(st);
  clickResults("#manualExportCode", button("manualExportCode"));
  assert.deepEqual(el("loadoutExportNotes").children, []);
  assert.equal(el("loadoutExportName").value, "Manual");
  assert.equal(el("loadoutExportSource").textContent, "Your current Manual setup.");
  context.staleCauses = new Set();
  exportDialog.close();
});

test("a Project step button exports that stretch, named for its step and place", () => {
  setState(factory([64, 64]));
  context._lastProjectRes = stepRes();
  const target = button("loadoutStep2_1", { "data-loadout-step": "2", "data-loadout-slice": "1",
    "data-loadout-label": "Step 3 (Tower), from ~2:00 PM until ~3:00 PM" });
  clickResults("[data-loadout-step]", target);
  assert.equal(exportDialog.isOpen, true);
  assert.equal(el("loadoutExportName").value, "Step 3.2");
  assert.equal(el("loadoutExportSource").textContent, "Step 3 (Tower), from ~2:00 PM until ~3:00 PM.");
  assert.equal(el("loadoutExportCode").value, "Step 3.2-10-amae-aeag-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa");
  exportDialog.close();
});

test("Copy puts the code on the clipboard, and falls back to selecting it when the browser refuses", async () => {
  setState(factory([16, 16, 16]));
  context._lastItemsCreditsRes = { mode: "items", targets: ["Wire"], plan: wirePlan(3) };
  clickResults("#btnExportCode", button("btnExportCode"));
  let written = null;
  context.navigator = { clipboard: { writeText: text => { written = text; return Promise.resolve(); } } };
  await call("copyLoadoutCode");
  assert.equal(written, el("loadoutExportCode").value);
  assert.match(el("loadoutExportStatus").textContent, /Copied/);
  assert.ok(el("loadoutExportStatus").classList.contains("is-good"));
  for (const navigator of [{ clipboard: { writeText: () => Promise.reject(new Error("denied")) } }, {}]) {
    context.navigator = navigator;
    el("loadoutExportCode").selected = false;
    await call("copyLoadoutCode");
    assert.ok(el("loadoutExportCode").selected, "the code is selected for a manual copy");
    assert.equal(fakeDocument.activeElement, el("loadoutExportCode"));
    assert.match(el("loadoutExportStatus").textContent, /blocked the clipboard/);
    assert.ok(el("loadoutExportStatus").classList.contains("is-bad"));
  }
  // A refused clipboard API still copies when the browser allows the older selection copy.
  context.navigator = { clipboard: { writeText: () => Promise.reject(new Error("denied")) } };
  fakeDocument.execCommand = command => command === "copy" && el("loadoutExportCode").selected;
  el("loadoutExportCode").selected = false;
  await call("copyLoadoutCode");
  assert.match(el("loadoutExportStatus").textContent, /Copied/);
  fakeDocument.execCommand = () => { throw new Error("unsupported"); };
  await call("copyLoadoutCode");
  assert.match(el("loadoutExportStatus").textContent, /blocked the clipboard/);
  delete fakeDocument.execCommand;
  el("loadoutExportName").dispatch("input");
  assert.equal(el("loadoutExportStatus").textContent, "", "editing the name clears a stale copy status");
  exportDialog.close();
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok - ${name}`); }
    catch (error) { failed++; console.error(`not ok - ${name}`); console.error(error.stack || error); }
  }
  if (failed) {
    console.error(`\n${failed} loadout-ui test(s) failed`);
    process.exitCode = 1;
  } else console.log(`\n${tests.length} loadout-ui tests passed`);
})();
