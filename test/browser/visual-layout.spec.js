"use strict";

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

const PX_TOLERANCE = 1;
const RELEASE_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
  { width: 881, height: 900 },
  { width: 880, height: 900 },
  { width: 768, height: 1024 },
  { width: 640, height: 900 },
  { width: 561, height: 900 },
  { width: 560, height: 900 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 320, height: 568 },
];
const OVERFLOW_VIEWPORTS = RELEASE_VIEWPORTS.map(viewport => viewport.width);
const RELEASE_MODES = [
  { name: "Max items/hr", ready: "Line assignment" },
  { name: "Max credits/hr", ready: "Credits mode." },
  { name: "Manual", ready: "Manual mode." },
  { name: "Project plan", ready: "Track progress" },
];
const RELEASE_DIALOGS = [
  { name: "Projects+Prices", opener: "#btnInputs", root: "#inputsModal", close: "#inputsDone", tabs: ["Inventory", "Projects", "Sell prices"] },
  { name: "Lil' Forgie", opener: "#btnForgie", root: "#forgieModal", close: "#forgieDone" },
  { name: "Mined resources", opener: "#btnMined", root: "#minedModal", close: "#minedDone" },
  { name: "Settings", opener: "#btnSettings", root: "#settingsModal", close: "#settingsDone" },
  { name: "Track progress", opener: "#btnProgress", root: "#progModal", close: "#progDone" },
];

async function loadPlanner(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#results")).toContainText("Line assignment");
  await expect(page.locator("#solveOverlay")).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
}

async function rect(locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  });
}

async function openInputsTab(page, name) {
  await page.locator("#btnInputs").click();
  await page.getByRole("tab", { name, exact: true }).click();
}

function expectInside(inner, outer, message) {
  expect(inner.left, message).toBeGreaterThanOrEqual(outer.left - PX_TOLERANCE);
  expect(inner.right, message).toBeLessThanOrEqual(outer.right + PX_TOLERANCE);
  expect(inner.top, message).toBeGreaterThanOrEqual(outer.top - PX_TOLERANCE);
  expect(inner.bottom, message).toBeLessThanOrEqual(outer.bottom + PX_TOLERANCE);
}

async function collectHorizontalOverflow(page) {
  return page.evaluate(tolerance => {
    const selectorFor = element => {
      if (element === document.documentElement) return "html";
      if (element === document.body) return "body";
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let current = element;
      while (current && current !== document.documentElement && parts.length < 4) {
        let part = current.localName;
        if (current.classList.length) part += `.${[...current.classList].slice(0, 2).map(name => CSS.escape(name)).join(".")}`;
        const siblings = current.parentElement ? [...current.parentElement.children].filter(child => child.localName === current.localName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const rendered = element => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.clip === "auto"
        && style.clipPath === "none";
    };
    const paintedCache = new WeakMap();
    const painted = element => {
      if (paintedCache.has(element)) return paintedCache.get(element);
      let current = element;
      let result = true;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        const style = getComputedStyle(current);
        if (!rendered(current) || Number(style.opacity) === 0) {
          result = false;
          break;
        }
        current = current.parentElement;
      }
      paintedCache.set(element, result);
      return result;
    };
    const pseudoIsPainted = (element, side) => {
      const style = getComputedStyle(element, side);
      const content = style.content;
      if (!content || content === "none" || content === "normal"
        || style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity) === 0
        || style.clip !== "auto"
        || style.clipPath !== "none") return false;
      return true;
    };
    const hasPaintedPseudoOverflow = element => {
      if (!pseudoIsPainted(element, "::before") && !pseudoIsPainted(element, "::after")) return false;
      const style = getComputedStyle(element);
      const borderWidth = parseFloat(style.borderLeftWidth || "0") + parseFloat(style.borderRightWidth || "0");
      const clone = element.cloneNode(false);
      clone.setAttribute("aria-hidden", "true");
      clone.style.setProperty("position", "fixed", "important");
      clone.style.setProperty("left", "-10000px", "important");
      clone.style.setProperty("top", "0", "important");
      clone.style.setProperty("display", "block", "important");
      clone.style.setProperty("box-sizing", "border-box", "important");
      clone.style.setProperty("width", `${element.clientWidth + borderWidth}px`, "important");
      clone.style.setProperty("min-width", "0", "important");
      clone.style.setProperty("max-width", "none", "important");
      clone.style.setProperty("margin", "0", "important");
      clone.style.setProperty("overflow", "visible", "important");
      (element.parentElement || document.body).append(clone);
      const overflows = clone.scrollWidth > clone.clientWidth + tolerance;
      clone.remove();
      return overflows;
    };
    const hasPaintedOverflow = element => {
      if (hasPaintedPseudoOverflow(element)) return true;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const left = box.left + parseFloat(style.borderLeftWidth || "0");
      const right = left + element.clientWidth;
      const outside = rect => rect.left < left - tolerance || rect.right > right + tolerance;
      if ([...element.querySelectorAll("*")].some(descendant => painted(descendant)
        && [...descendant.getClientRects()].some(outside))) return true;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode;
      while ((textNode = walker.nextNode())) {
        if (!textNode.textContent.trim() || !painted(textNode.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        if ([...range.getClientRects()].some(outside)) return true;
      }
      return false;
    };
    const critical = [document.documentElement, document.body, document.getElementById("results")].map(element => {
      const style = getComputedStyle(element);
      return {
        selector: element === document.documentElement ? "html" : element === document.body ? "body" : "#results",
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflowX: style.overflowX,
        dialogLocked: element === document.body && element.classList.contains("dialog-open"),
      };
    });
    const wide = [...document.querySelectorAll("*")]
      .filter(element => painted(element)
        && element.scrollWidth > element.clientWidth + tolerance
        && hasPaintedOverflow(element))
      .map(element => {
        const owner = element.closest(".table-scroll");
        const ownerStyle = owner && getComputedStyle(owner);
        const tableRelated = !!owner && (element === owner
          ? !!owner.querySelector("table")
          : !!element.closest("table") || element.matches("table") || !!element.querySelector("table"));
        return {
          selector: selectorFor(element),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          ownerSelector: owner ? selectorFor(owner) : null,
          ownerIsNearest: !!owner && element.closest(".table-scroll") === owner,
          ownerRole: owner && owner.getAttribute("role"),
          ownerName: owner && owner.getAttribute("aria-label"),
          ownerTabindex: owner && owner.getAttribute("tabindex"),
          ownerOverflowX: ownerStyle && ownerStyle.overflowX,
          ownerContainsTable: !!owner && !!owner.querySelector("table"),
          tableRelated,
        };
      });
    return { critical, wide };
  }, PX_TOLERANCE);
}

function assertHorizontalOverflowContract(audit, label) {
  const criticalViolations = audit.critical.filter(entry => {
    const exceedsWidth = entry.scrollWidth > entry.clientWidth + PX_TOLERANCE;
    const intentionalDialogLock = entry.selector === "body"
      && entry.dialogLocked
      && entry.overflowX === "hidden"
      && !exceedsWidth;
    return exceedsWidth
      || (["auto", "scroll", "hidden", "clip"].includes(entry.overflowX) && !intentionalDialogLock);
  });
  const wideViolations = audit.wide.filter(entry =>
    !entry.ownerSelector
    || !entry.ownerIsNearest
    || entry.ownerRole !== "region"
    || !entry.ownerName?.trim()
    || entry.ownerTabindex !== "0"
    || !["auto", "scroll"].includes(entry.ownerOverflowX)
    || !entry.ownerContainsTable
    || !entry.tableRelated);
  if (criticalViolations.length || wideViolations.length) {
    throw new Error(`${label} horizontal overflow contract failed: ${JSON.stringify({ criticalViolations, wideViolations })}`);
  }
}

async function expectHorizontalOverflowContract(page, label) {
  const audit = await collectHorizontalOverflow(page);
  assertHorizontalOverflowContract(audit, label);
  return audit;
}

async function seedCatalogProject(page) {
  await openInputsTab(page, "Projects");
  await page.evaluate(() => addCatalogProject(CATALOG[0].catId));
  await expect(page.locator("#projList .cat-card")).toBeVisible();
}

async function addCatalogProjectAndFlushSolve(page, label) {
  const generation = await page.evaluate(() => {
    addCatalogProject(CATALOG[0].catId);
    flushSolve();
    if (renderT !== null) throw new Error("flushSolve left the scheduled project solve pending");
    return solveService.status().generation;
  });
  await expect.poll(() => page.evaluate(expectedGeneration => {
    const status = solveService.status();
    return { generation: status.generation, active: status.active, current: status.current };
  }, generation), { message: `${label}: flushed project solve must finish before release geometry is measured` }).toEqual({
    generation,
    active: false,
    current: false,
  });
  await expect(page.locator("#solveOverlay")).toBeHidden();
}

async function expectReleaseMatrixState(page, label, { result = false, scope = null } = {}) {
  const audit = await page.evaluate(({ tolerance, scope, result }) => {
    const visible = element => {
      if (!element || !element.getClientRects().length) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    };
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const overlaps = (a, b) => a.left < b.right - tolerance && a.right > b.left + tolerance
      && a.top < b.bottom - tolerance && a.bottom > b.top + tolerance;
    const root = scope ? document.querySelector(scope) : document;
    const labelCollisions = [];
    const seen = new Set();
    const compare = (labelElement, control, owner) => {
      if (!visible(labelElement) || !visible(control)) return;
      const key = `${labelElement.textContent.trim()}\u0000${control.id || control.getAttribute("aria-label") || control.localName}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (overlaps(box(labelElement), box(control))) {
        labelCollisions.push({
          owner: owner.id || owner.className || owner.localName,
          label: labelElement.textContent.trim().slice(0, 80),
          control: control.id || control.getAttribute("aria-label") || control.localName,
        });
      }
    };
    root.querySelectorAll("label[for]").forEach(labelElement => {
      const control = document.getElementById(labelElement.htmlFor);
      compare(labelElement, control, labelElement.parentElement || labelElement);
    });
    root.querySelectorAll(".fl,.price-row,.base-time-field").forEach(owner => {
      const labelElement = owner.querySelector(":scope > span, :scope > label, .pnm");
      const control = owner.querySelector(":scope > input, :scope > select, :scope > textarea, input, select, textarea");
      compare(labelElement, control, owner);
    });

    const tableFailures = [...root.querySelectorAll("table")].filter(visible).map(table => {
      const owner = table.closest(".table-scroll");
      const ownerStyle = owner && getComputedStyle(owner);
      if (owner && owner.getAttribute("role") === "region" && owner.getAttribute("aria-label")?.trim()
        && owner.getAttribute("tabindex") === "0" && ["auto", "scroll"].includes(ownerStyle.overflowX)) return null;
      return {
        table: table.getAttribute("aria-label") || table.querySelector("th")?.textContent?.trim() || "unnamed table",
        owner: owner && owner.className,
        role: owner && owner.getAttribute("role"),
        name: owner && owner.getAttribute("aria-label"),
        tabindex: owner && owner.getAttribute("tabindex"),
        overflowX: ownerStyle && ownerStyle.overflowX,
      };
    }).filter(Boolean);

    let resultGeometry = null;
    if (result) {
      const results = document.getElementById("results");
      const head = document.querySelector(".result-card > .results-head");
      const title = head && head.querySelector("h2");
      const tabs = document.getElementById("modesw");
      const status = document.getElementById("solveStat");
      const style = getComputedStyle(results);
      const headBox = box(head),titleBox = box(title),tabsBox = box(tabs),statusBox = box(status);
      const tabBoxes = [...tabs.querySelectorAll("button")].filter(visible).map(box);
      const tabOverlaps = [];
      for (let left = 0; left < tabBoxes.length; left += 1) {
        for (let right = left + 1; right < tabBoxes.length; right += 1) {
          if (overlaps(tabBoxes[left], tabBoxes[right])) tabOverlaps.push([left, right]);
        }
      }
      resultGeometry = {
        token: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-inset")),
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
        headBox,titleBox,tabsBox,statusBox,tabBoxes,tabOverlaps,
        collisions: {
          titleTabs: overlaps(titleBox, tabsBox),
          titleStatus: overlaps(titleBox, statusBox),
          tabsStatus: overlaps(tabsBox, statusBox),
        },
      };
    }

    return {
      html: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
      labelCollisions,
      tableFailures,
      resultGeometry,
    };
  }, { tolerance: PX_TOLERANCE, scope, result });

  expect(audit.html.scrollWidth, `${label}: html must not scroll horizontally`)
    .toBeLessThanOrEqual(audit.html.clientWidth + PX_TOLERANCE);
  expect(audit.body.scrollWidth, `${label}: body must not scroll horizontally`)
    .toBeLessThanOrEqual(audit.body.clientWidth + PX_TOLERANCE);
  expect(audit.labelCollisions, `${label}: labels and controls must not overlap`).toEqual([]);
  expect(audit.tableFailures, `${label}: visible tables must own named keyboard-operable scrolling`).toEqual([]);

  if (audit.resultGeometry) {
    const geometry = audit.resultGeometry;
    expect(geometry.token, `${label}: result inset token`).toBeGreaterThan(0);
    geometry.padding.forEach((padding, index) => {
      expect(Math.abs(padding - geometry.token), `${label}: result inset side ${index}`).toBeLessThanOrEqual(PX_TOLERANCE);
    });
    for (const [name, candidate] of [["title", geometry.titleBox], ["tabs", geometry.tabsBox], ["status", geometry.statusBox]]) {
      expectInside(candidate, geometry.headBox, `${label}: ${name} must stay in the result header`);
    }
    expect(geometry.collisions, `${label}: title, tabs, and status must not collide`).toEqual({
      titleTabs: false,
      titleStatus: false,
      tabsStatus: false,
    });
    expect(geometry.tabOverlaps, `${label}: planning tabs must not overlap`).toEqual([]);
    geometry.tabBoxes.forEach((tabBox, index) => expectInside(tabBox, geometry.tabsBox, `${label}: planning tab ${index + 1}`));
  }
}

async function expectDialogActionsReachable(page, dialog, viewport, label) {
  const geometry = await page.locator(dialog.root).evaluate((root, tolerance) => {
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const panel = root.querySelector(".modal"),header = panel.querySelector(".modal-h");
    const body = panel.querySelector("[data-dialog-body]"),footer = panel.querySelector(".modal-f");
    const actions = [...panel.querySelectorAll(".modal-h button,.modal-f button")]
      .filter(button => button.getClientRects().length).map(button => ({ name: button.getAttribute("aria-label") || button.textContent.trim(), box: box(button) }));
    return {
      panel: box(panel),header: box(header),body: box(body),footer: box(footer),actions,
      panelScrollHeight: panel.scrollHeight,panelClientHeight: panel.clientHeight,
      rootScrollHeight: root.scrollHeight,rootClientHeight: root.clientHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
      tolerance,
    };
  }, PX_TOLERANCE);
  const viewportBox = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  expectInside(geometry.panel, viewportBox, `${label}: dialog panel`);
  expectInside(geometry.header, geometry.panel, `${label}: dialog header`);
  expectInside(geometry.footer, geometry.panel, `${label}: dialog footer`);
  expect(geometry.actions.length, `${label}: dialog must expose a close or footer action`).toBeGreaterThan(0);
  geometry.actions.forEach(action => {
    expectInside(action.box, geometry.panel, `${label}: ${action.name} inside panel`);
    expectInside(action.box, viewportBox, `${label}: ${action.name} on screen`);
  });
  expect(geometry.panelScrollHeight, `${label}: panel must not own vertical scrolling`)
    .toBeLessThanOrEqual(geometry.panelClientHeight + PX_TOLERANCE);
  expect(geometry.rootScrollHeight, `${label}: overlay must not own vertical scrolling`)
    .toBeLessThanOrEqual(geometry.rootClientHeight + PX_TOLERANCE);
  expect(["auto", "scroll"], `${label}: dialog body owns vertical scrolling`).toContain(geometry.bodyOverflowY);
}

async function expectProjectIdentityNotCollapsed(page, label) {
  const card = page.locator("#projList .cat-card").first();
  const name = card.locator(".pname-static");
  await expect(name).toBeVisible();
  const nameBox = await rect(name),cardBox = await rect(card);
  expect(nameBox.width, `${label}: project identity must retain readable width`).toBeGreaterThanOrEqual(140 - PX_TOLERANCE);
  expectInside(nameBox, cardBox, `${label}: project identity must stay inside its card`);
}

async function expectSparseRecipeCardsStable(page, label) {
  await page.locator("#recipeToggle").click();
  await expect(page.locator("#recipeBody")).toBeVisible();
  const cards = page.locator("#recipes .rcard");
  const count = await cards.count();
  expect(count, `${label}: recipe fixture needs several cards`).toBeGreaterThan(2);
  const last = cards.last();
  await last.evaluate(element => { element.hidden = true; });
  const geometry = await page.locator("#recipes").evaluate((grid, tolerance) => {
    const gridBox = grid.getBoundingClientRect();
    const cards = [...grid.querySelectorAll(".rcard")].filter(card => card.getClientRects().length).map(card => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, width: rect.width };
    });
    const rows = [];
    cards.forEach(card => {
      let row = rows.find(candidate => Math.abs(candidate.top - card.top) <= tolerance);
      if (!row) { row = { top: card.top, cards: [] };rows.push(row); }
      row.cards.push({ left: card.left, right: card.right, width: card.width });
    });
    const columns = Math.max(...rows.map(row => row.cards.length));
    const fullRow = rows.find(row => row.cards.length === columns);
    const sparseRow = [...rows].reverse().find(row => row.cards.length < columns);
    return {
      grid: { left: gridBox.left, right: gridBox.right },cards,columns,
      referenceWidth: fullRow && fullRow.cards[0].width,
      sparseWidths: sparseRow ? sparseRow.cards.map(card => card.width) : [],
    };
  }, PX_TOLERANCE);
  await last.evaluate(element => { element.hidden = false; });
  geometry.cards.forEach((card, index) => {
    expect(card.left, `${label}: recipe card ${index + 1} left edge`).toBeGreaterThanOrEqual(geometry.grid.left - PX_TOLERANCE);
    expect(card.right, `${label}: recipe card ${index + 1} right edge`).toBeLessThanOrEqual(geometry.grid.right + PX_TOLERANCE);
  });
  if (geometry.columns > 1 && geometry.sparseWidths.length) {
    geometry.sparseWidths.forEach((width, index) => {
      expect(Math.abs(width - geometry.referenceWidth), `${label}: sparse recipe card ${index + 1} must not stretch`)
        .toBeLessThanOrEqual(PX_TOLERANCE);
    });
  }
  await expectReleaseMatrixState(page, `${label}: crafting data`, { scope: "#recipeBody" });
  await page.locator("#recipeToggle").click();
  await expect(page.locator("#recipeBody")).toBeHidden();
}

async function attachReleaseMatrixScreenshot(page, testInfo, name) {
  await page.evaluate(() => {
    const status = document.getElementById("solveStat");
    if (status && /Solved in/.test(status.textContent)) status.textContent = "Plan updated. Solved in 0.0 ms";
  });
  const file = testInfo.outputPath(`release-matrix-${name}.png`);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide", fullPage: false });
  await testInfo.attach(`release-matrix-${name}`, { path: file, contentType: "image/png" });
}

test("result content keeps its shared inset and its mode row fits at 1440, 1024, and 900px", async ({ page }) => {
  // Break caught: nesting #results inside .results-wrap bypasses the card body inset, while the title/status flex row squeezes the modes off-card.
  for (const width of [1440, 1024, 900]) {
    await loadPlanner(page, { width, height: 900 });
    const resultGeometry = await page.locator("#results").evaluate(element => {
      const style = getComputedStyle(element);
      const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-inset"));
      return {
        token,
        top: parseFloat(style.paddingTop),
        right: parseFloat(style.paddingRight),
        bottom: parseFloat(style.paddingBottom),
        left: parseFloat(style.paddingLeft),
      };
    });
    expect(resultGeometry.token, `${width}px must expose a positive shared card inset`).toBeGreaterThan(0);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(Math.abs(resultGeometry[side] - resultGeometry.token), `${width}px #results ${side} inset`).toBeLessThanOrEqual(PX_TOLERANCE);
    }

    const card = page.locator("#results").locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
    const head = card.locator(":scope > .head");
    const mode = page.locator("#modesw");
    const cardBox = await rect(card);
    const headBox = await rect(head);
    const modeBox = await rect(mode);
    const headPadding = await head.evaluate(element => {
      const style = getComputedStyle(element);
      return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) };
    });
    expectInside(modeBox, cardBox, `${width}px mode row must remain in the result card`);
    expect(Math.abs(modeBox.left - (headBox.left + headPadding.left)), `${width}px mode row left edge`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(modeBox.right - (headBox.right - headPadding.right)), `${width}px mode row right edge`).toBeLessThanOrEqual(PX_TOLERANCE);

    const titleBox = await rect(head.locator("h2"));
    const statusBox = await rect(page.locator("#solveStat"));
    expectInside(titleBox, headBox, `${width}px result title must remain in its header`);
    expectInside(statusBox, headBox, `${width}px result status must remain in its header`);
    expect(titleBox.bottom <= statusBox.top + PX_TOLERANCE || statusBox.bottom <= titleBox.top + PX_TOLERANCE || titleBox.right <= statusBox.left + PX_TOLERANCE || statusBox.right <= titleBox.left + PX_TOLERANCE,
      `${width}px result title and status must not overlap`).toBe(true);
  }
});

test("the document remains the viewport, not an overflow mask, at every supported width", async ({ page }) => {
  // Break caught: a component wider than any responsive grid makes the document itself a horizontal scroller or invites overflow masking.
  for (const width of OVERFLOW_VIEWPORTS) {
    await loadPlanner(page, { width, height: width >= 900 ? 900 : 844 });
    const audit = await expectHorizontalOverflowContract(page, `${width}px Items`);
    const root = audit.critical.find(entry => entry.selector === "html");
    expect(root.scrollWidth, `${width}px root width is asserted directly`).toBeLessThanOrEqual(root.clientWidth + PX_TOLERANCE);
  }
});

test("the 1440px toolbar is one ordered row of four equal columns", async ({ page }) => {
  // Break caught: the new opener is added without reducing the old grid or one label receives a different column width.
  await loadPlanner(page, { width: 1440, height: 900 });
  const geometry = await page.locator(".tools > button").evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect();
    return { text: button.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
  }));
  expect(geometry.map(button => button.text)).toEqual(["Projects+Prices", "Lil' Forgie", "Mined resources", "Settings"]);
  expect(geometry).toHaveLength(4);
  geometry.forEach((button, index) => {
    expect(Math.abs(button.top - geometry[0].top), `desktop button ${index + 1} row`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(button.bottom - geometry[0].bottom), `desktop button ${index + 1} height`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(button.width - geometry[0].width), `desktop button ${index + 1} column width`).toBeLessThanOrEqual(PX_TOLERANCE);
    if (index) expect(button.left, `desktop button ${index + 1} must follow its predecessor`).toBeGreaterThan(geometry[index - 1].right);
  });
});

test("the 390px toolbar is an equal two-by-two grid that fills the header", async ({ page }) => {
  // Break caught: the phone toolbar becomes one cramped row, a 3+1 wrap, or a short grid after the action consolidation.
  await loadPlanner(page, { width: 390, height: 844 });
  const headerBox = await rect(page.locator("header.top"));
  const toolsBox = await rect(page.locator(".tools"));
  const buttons = await page.locator(".tools > button").evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  }));
  expect(buttons).toHaveLength(4);
  expect(Math.abs(toolsBox.left - headerBox.left), "phone toolbar left edge").toBeLessThanOrEqual(PX_TOLERANCE);
  expect(Math.abs(toolsBox.right - headerBox.right), "phone toolbar right edge").toBeLessThanOrEqual(PX_TOLERANCE);
  expect(Math.abs(buttons[0].top - buttons[1].top), "phone first row").toBeLessThanOrEqual(PX_TOLERANCE);
  expect(Math.abs(buttons[2].top - buttons[3].top), "phone second row").toBeLessThanOrEqual(PX_TOLERANCE);
  expect(buttons[2].top, "phone rows must not overlap").toBeGreaterThan(buttons[0].bottom);
  expect(Math.abs(buttons[0].left - buttons[2].left), "phone first column").toBeLessThanOrEqual(PX_TOLERANCE);
  expect(Math.abs(buttons[1].left - buttons[3].left), "phone second column").toBeLessThanOrEqual(PX_TOLERANCE);
  buttons.forEach((button, index) => {
    expect(Math.abs(button.width - buttons[0].width), `phone button ${index + 1} column width`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(button.height - buttons[0].height), `phone button ${index + 1} row height`).toBeLessThanOrEqual(PX_TOLERANCE);
  });
});

test("project cards preserve readable identity through the stacked-to-desktop handoff", async ({ page }) => {
  // Break caught: the auto-sized tools column collapses catalog project identity text to nearly zero width.
  for (const width of [375, 390, 560, 561, 640, 700, 720, 721, 768]) {
    await loadPlanner(page, { width, height: 844 });
    await seedCatalogProject(page);
    const customCard = page.locator("#projList .proj:not(.cat-card)").first();
    if (await customCard.count() === 0) await page.locator("#projAdd").click();
    await expect(customCard).toBeVisible();
    const cards = [
      { label: "catalog", card: page.locator("#projList .cat-card"), name: ".pname-static" },
      { label: "custom", card: customCard, name: ".pname" },
    ];
    for (const entry of cards) {
      const nameBox = await rect(entry.card.locator(entry.name));
      const toolsBox = await rect(entry.card.locator(".proj-tools"));
      const cardBox = await rect(entry.card);
      expect(nameBox.width, `${width}px ${entry.label} project identity width`).toBeGreaterThanOrEqual(140 - PX_TOLERANCE);
      expectInside(nameBox, cardBox, `${width}px ${entry.label} project identity must stay in its card`);
      expectInside(toolsBox, cardBox, `${width}px ${entry.label} project tools must stay in its card`);
      if (width <= 720) {
        expect(toolsBox.top, `${width}px ${entry.label} project tools must start below the identity row`)
          .toBeGreaterThanOrEqual(nameBox.bottom - PX_TOLERANCE);
      }
    }
  }
});

test("320px validation feedback stays inside line, Projects-tab, inline Project, and Sell-prices owners", async ({ page }) => {
  await loadPlanner(page, { width: 320, height: 760 });
  const expectRootFits = async label => {
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(width.scroll, `${label}: ${width.scroll}px root must fit ${width.client}px`).toBeLessThanOrEqual(width.client + PX_TOLERANCE);
  };

  const speed = page.getByRole("spinbutton", { name: "Line 1 currently displayed speed multiplier" });
  await speed.fill("");
  const lineError = page.locator(`#${await speed.getAttribute("data-field-error")}`);
  await expect(lineError).toBeVisible();
  expectInside(await rect(lineError), await rect(speed.locator("xpath=..")), "line error must stay in its field");
  await expectRootFits("line error");

  await openInputsTab(page, "Sell prices");
  const price = page.getByRole("textbox", { name: "Frames sell price per unit" });
  await price.fill("abc");
  const priceError = page.locator(`#${await price.getAttribute("data-field-error")}`);
  await expect(priceError).toBeVisible();
  expectInside(await rect(priceError), await rect(price.locator("xpath=..")), "price error must stay in its row");
  await expectRootFits("price error");
  await page.locator("#inputsDone").click();

  await openInputsTab(page, "Projects");
  await page.getByRole("button", { name: "New custom project" }).click();
  await page.getByRole("button", { name: "Add level to New project" }).click();
  const from = page.getByRole("spinbutton", { name: "New project starting level" });
  const to = page.getByRole("spinbutton", { name: "New project ending level" });
  await to.fill("1");
  await from.fill("2");
  const projectErrors = page.locator(".proj-field-errors").first();
  await expect(projectErrors).toBeVisible();
  expectInside(await rect(projectErrors), await rect(page.locator(".proj-tools").first()), "Projects-tab errors must stay in tools");
  await expectRootFits("Projects-tab Project error");

  await from.fill("1");
  await to.fill("2");
  await page.evaluate(() => {
    mutateState(st => { st.projects[0].levels[0].costs = [{ item: "Frames", qty: 100 }]; });
    save();
  });
  await page.locator("#inputsDone").click();
  await page.getByRole("button", { name: "Project plan" }).click();
  await expect(page.getByText("Adjust project levels & completion")).toBeVisible();
  await page.getByText("Adjust project levels & completion").click();
  const inlineFrom = page.locator("[data-spfrom]").first(),inlineTo = page.locator("[data-spto]").first();
  await inlineTo.fill("1");
  await inlineFrom.fill("2");
  const inlineErrors = page.locator(".proj-inline-errors").first();
  await expect(inlineErrors).toBeVisible();
  expectInside(await rect(inlineErrors), await rect(page.locator(".proj-inline-row").first()), "inline errors must stay in row");
  await expectRootFits("inline Project error");
});

test("320px fields keep labels clear and give the third line field an intentional full row", async ({ page }) => {
  // Break caught: the third crafter input is stranded in half a row and compact modal labels crowd their inputs.
  await loadPlanner(page, { width: 320, height: 760 });
  const lineFields = page.locator("#lines .line-row").first().locator(".line-fields");
  const lineBox = await rect(lineFields);
  const fields = lineFields.locator(":scope > .fl");
  expect(await fields.count()).toBe(3);
  for (let index = 0; index < 3; index += 1) {
    const field = fields.nth(index);
    const labelBox = await rect(field.locator(":scope > span"));
    const controlBox = await rect(field.locator(":scope > input, :scope > select"));
    expect(labelBox.bottom, `line field ${index + 1} label must end above its control`).toBeLessThanOrEqual(controlBox.top + PX_TOLERANCE);
  }
  const thirdBox = await rect(fields.nth(2));
  expect(Math.abs(thirdBox.width - lineBox.width), "third line field must span the full second row").toBeLessThanOrEqual(PX_TOLERANCE);

  const compactRows = [
    { tab: "Sell prices", close: "#inputsDone", row: "#priceRows .price-row" },
    { opener: "Lil' Forgie", root: "#forgieModal", close: "#forgieDone", row: "#forgieRows .price-row" },
    { tab: "Inventory", close: "#inputsDone", row: "#invRows .price-row" },
  ];
  for (const entry of compactRows) {
    if (entry.tab) await openInputsTab(page, entry.tab);
    else await page.getByRole("button", { name: entry.opener, exact: true }).click();
    const row = page.locator(entry.row).first();
    await expect(row).toBeVisible();
    const rowBox = await rect(row);
    const labelBox = await rect(row.locator(".pnm"));
    const inputBox = await rect(row.locator("input"));
    const label = entry.tab || entry.opener;
    expect(inputBox.top, `${label} input must stack below its label`).toBeGreaterThanOrEqual(labelBox.bottom - PX_TOLERANCE);
    expect(Math.abs(inputBox.left - rowBox.left), `${label} input left edge`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(inputBox.right - rowBox.right), `${label} input right edge`).toBeLessThanOrEqual(PX_TOLERANCE);
    await page.locator(entry.close).click();
  }

  const tooltip = page.getByRole("button", { name: "Help for Line 1 turbo stacks", exact: true });
  await tooltip.hover();
  const tooltipBox = await rect(tooltip.locator(".tip-text"));
  expect(tooltipBox.left).toBeGreaterThanOrEqual(PX_TOLERANCE);
  expect(tooltipBox.right).toBeLessThanOrEqual(320 + PX_TOLERANCE);
});

test("every rendered planning mode and long-dialog state obeys the discovered overflow contract", async ({ page }) => {
  // Break caught: checking only known table owners misses rogue non-table overflow and untested Credits, Project, or dialog states.
  await loadPlanner(page, { width: 320, height: 844 });
  await seedCatalogProject(page);
  await page.locator("#inputsDone").click();

  for (const width of [320, 390, 560, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: width >= 900 ? 900 : 844 });
    for (const mode of ["Max items/hr", "Max credits/hr", "Project plan", "Manual"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await expect(page.locator("#solveOverlay")).toBeHidden();
      if (mode === "Max items/hr" || mode === "Manual") await expect(page.locator("#results table:visible").first()).toBeVisible();
      if (mode === "Project plan") await expect(page.locator("#results .metrics")).toBeVisible();
      await expectHorizontalOverflowContract(page, `${width}px ${mode}`);
    }
  }

  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  const manualControlReachability = await page.locator("#results .table-scroll").first().evaluate(owner => {
    const controls = [...owner.querySelectorAll("select,input,button")].filter(control => control.getClientRects().length);
    return controls.map(control => {
      control.scrollIntoView({ block: "nearest", inline: "nearest" });
      const controlBox = control.getBoundingClientRect();
      const ownerBox = owner.getBoundingClientRect();
      return controlBox.left >= ownerBox.left - 1 && controlBox.right <= ownerBox.right + 1;
    });
  });
  expect(manualControlReachability.length).toBeGreaterThan(0);
  expect(manualControlReachability.every(Boolean), "every Manual table control must be reachable within its named scroller").toBe(true);

  for (const width of [320, 390, 560, 1024]) {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 600 });
    for (const dialog of [
      { opener: "Mined resources", root: "#minedModal", close: "#minedDone" },
      { opener: "Projects+Prices", tab: "Projects", root: "#inputsModal", close: "#inputsDone" },
    ]) {
      if (dialog.tab) await openInputsTab(page, dialog.tab);
      else await page.getByRole("button", { name: dialog.opener, exact: true }).click();
      await expect(page.locator(dialog.root)).toBeVisible();
      await expectHorizontalOverflowContract(page, `${width}px ${dialog.opener} dialog`);
      await page.locator(dialog.close).click();
    }
  }
});

test.describe("Task 16 release viewport matrix", () => {
  for (const viewport of RELEASE_VIEWPORTS) {
    test(`${viewport.width}x${viewport.height} covers every mode and registered dialog`, async ({ page }, testInfo) => {
      // Break caught: a semantic dialog or one consolidated tab is omitted from the hosted release geometry and action-reachability matrix.
      test.setTimeout(60_000);
      const viewportLabel = `${viewport.width}x${viewport.height}`;
      await loadPlanner(page, viewport);
      await addCatalogProjectAndFlushSolve(page, viewportLabel);

      const dialogRoots = await page.locator(".modal-bg").evaluateAll(roots => roots
        .filter(root => root.querySelector('.modal[role="dialog"]')).map(root => `#${root.id}`).sort());
      expect(dialogRoots, `${viewportLabel}: release matrix must track every semantic dialog`)
        .toEqual(RELEASE_DIALOGS.map(dialog => dialog.root).sort());

      for (const mode of RELEASE_MODES) {
        await page.getByRole("button", { name: mode.name, exact: true }).click();
        await expect(page.locator("#results")).toContainText(mode.ready);
        await expect(page.locator("#solveOverlay")).toBeHidden();
        await expectReleaseMatrixState(page, `${viewportLabel}: ${mode.name}`, { result: true });

        if (viewport.width === 1440 && mode.name === "Max items/hr") {
          await attachReleaseMatrixScreenshot(page, testInfo, `${viewportLabel}-items`);
        }
        if (viewport.width === 880 && mode.name === "Project plan") {
          await attachReleaseMatrixScreenshot(page, testInfo, `${viewportLabel}-project`);
        }
        if (viewport.width === 320 && mode.name === "Manual") {
          await attachReleaseMatrixScreenshot(page, testInfo, `${viewportLabel}-manual`);
        }
      }

      await expect(page.locator("#btnProgress")).toBeVisible();
      for (const dialog of RELEASE_DIALOGS) {
        await page.locator(dialog.opener).click();
        await expect(page.locator(dialog.root)).toBeVisible();
        const states = dialog.tabs || [null];
        for (const tab of states) {
          if (tab) {
            await page.getByRole("tab", { name: tab, exact: true }).click();
            await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
          }
          const stateLabel = `${viewportLabel}: ${dialog.name}${tab ? ` ${tab}` : ""} dialog`;
          await expectReleaseMatrixState(page, stateLabel, { scope: dialog.root });
          await expectDialogActionsReachable(page, dialog, viewport, stateLabel);
          if (tab === "Projects") await expectProjectIdentityNotCollapsed(page, stateLabel);
          if ((viewport.width === 390 || viewport.width === 640) && tab === "Projects") {
            await attachReleaseMatrixScreenshot(page, testInfo, `${viewportLabel}-projects-prices`);
          }
        }
        await page.locator(dialog.close).click();
        await expect(page.locator(dialog.root)).toBeHidden();
      }

      await expectSparseRecipeCardsStable(page, viewportLabel);
    });
  }
});

test("the overflow detector rejects and then releases a rogue non-table surface", async ({ page }) => {
  // Break caught: a gate that starts from .table-scroll owners cannot see an unrelated overflowing component.
  await loadPlanner(page, { width: 390, height: 844 });
  await page.evaluate(() => {
    const rogue = document.createElement("div");
    rogue.id = "visual-overflow-mutation";
    rogue.style.cssText = "width:120px;overflow:visible";
    const child = document.createElement("div");
    child.style.width = "420px";
    child.textContent = "overflow mutation";
    rogue.append(child);
    document.querySelector("main").append(rogue);
  });
  const mutatedAudit = await collectHorizontalOverflow(page);
  expect(() => assertHorizontalOverflowContract(mutatedAudit, "rogue mutation")).toThrow(/#visual-overflow-mutation/);
  await page.locator("#visual-overflow-mutation").evaluate(element => element.remove());
  await expectHorizontalOverflowContract(page, "restored after rogue mutation");
});

test("the overflow detector rejects and then releases a visible pseudo-element surface", async ({ page }) => {
  // Break caught: a gate that inspects only DOM descendants and text ranges cannot see generated overflow.
  await loadPlanner(page, { width: 390, height: 844 });
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`#visual-pseudo-mutation::before {
      content: "visible pseudo overflow";
      display: block;
      width: 240px;
      height: 20px;
      background: rgb(255, 0, 0);
      color: rgb(255, 255, 255);
      white-space: nowrap;
    }`);
    const rogue = document.createElement("div");
    rogue.id = "visual-pseudo-mutation";
    rogue.style.cssText = "width:120px;overflow:visible";
    window.__visualPseudoMutationSheet = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    document.querySelector("main").append(rogue);
  });
  const mutatedAudit = await collectHorizontalOverflow(page);
  expect(() => assertHorizontalOverflowContract(mutatedAudit, "pseudo mutation")).toThrow(/#visual-pseudo-mutation/);
  await page.evaluate(() => {
    document.getElementById("visual-pseudo-mutation")?.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.__visualPseudoMutationSheet);
    delete window.__visualPseudoMutationSheet;
  });
  await expectHorizontalOverflowContract(page, "restored after pseudo mutation");
});

test("the overflow detector rejects and then releases auto-width inline generated content", async ({ page }) => {
  // Break caught: parsing computed width "auto" as zero misses nowrap generated text with no DOM rectangle.
  await loadPlanner(page, { width: 390, height: 844 });
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`#visual-auto-pseudo-mutation::after {
      content: "auto width generated overflow";
      white-space: nowrap;
    }`);
    const rogue = document.createElement("div");
    rogue.id = "visual-auto-pseudo-mutation";
    rogue.style.cssText = "width:120px;overflow:visible";
    window.__visualAutoPseudoMutationSheet = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    document.querySelector("main").append(rogue);
  });
  const metrics = await page.locator("#visual-auto-pseudo-mutation").evaluate(element => {
    const pseudo = getComputedStyle(element, "::after");
    return {
      host: { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth },
      root: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      pseudo: { content: pseudo.content, display: pseudo.display, width: pseudo.width, whiteSpace: pseudo.whiteSpace },
    };
  });
  expect(metrics.host.scrollWidth).toBeGreaterThan(metrics.host.clientWidth + PX_TOLERANCE);
  expect(metrics.root.scrollWidth).toBeLessThanOrEqual(metrics.root.clientWidth + PX_TOLERANCE);
  expect(metrics.pseudo).toEqual({
    content: '"auto width generated overflow"',
    display: "inline",
    width: "auto",
    whiteSpace: "nowrap",
  });
  const mutatedAudit = await collectHorizontalOverflow(page);
  expect(() => assertHorizontalOverflowContract(mutatedAudit, "auto-width pseudo mutation")).toThrow(/#visual-auto-pseudo-mutation/);
  await page.evaluate(() => {
    document.getElementById("visual-auto-pseudo-mutation")?.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.__visualAutoPseudoMutationSheet);
    delete window.__visualAutoPseudoMutationSheet;
  });
  await expectHorizontalOverflowContract(page, "restored after auto-width pseudo mutation");
});

test("long dialogs keep header and footer reachable while only the designated body scrolls", async ({ page }) => {
  // Break caught: the overlay becomes the scroll owner, pushing dialog actions and the close control offscreen.
  for (const viewport of [{ width: 390, height: 600 }, { width: 1024, height: 720 }]) {
    await loadPlanner(page, viewport);
    for (const dialog of [
      { opener: "Mined resources", root: "#minedModal", close: "#minedDone" },
      { opener: "Projects+Prices", tab: "Inventory", root: "#inputsModal", close: "#inputsDone" },
      { opener: "Projects+Prices", tab: "Projects", root: "#inputsModal", close: "#inputsDone" },
      { opener: "Projects+Prices", tab: "Sell prices", root: "#inputsModal", close: "#inputsDone" },
    ]) {
      if (dialog.tab) await openInputsTab(page, dialog.tab);
      else await page.getByRole("button", { name: dialog.opener, exact: true }).click();
      const root = page.locator(dialog.root);
      const panel = root.locator(".modal");
      const header = panel.locator(".modal-h");
      const body = panel.locator("[data-dialog-body]");
      const footer = panel.locator(".modal-f");
      await body.evaluate(element => {
        const fixture = document.createElement("div");
        fixture.dataset.scrollFixture = "";
        fixture.style.height = "1200px";
        fixture.setAttribute("aria-hidden", "true");
        element.append(fixture);
      });
      const geometry = await panel.evaluate(panelElement => {
        const rootElement = panelElement.parentElement;
        const bodyElement = panelElement.querySelector("[data-dialog-body]");
        const panelStyle = getComputedStyle(panelElement);
        const rootStyle = getComputedStyle(rootElement);
        const bodyStyle = getComputedStyle(bodyElement);
        return {
          panelScrollHeight: panelElement.scrollHeight,
          panelClientHeight: panelElement.clientHeight,
          rootScrollHeight: rootElement.scrollHeight,
          rootClientHeight: rootElement.clientHeight,
          bodyScrollHeight: bodyElement.scrollHeight,
          bodyClientHeight: bodyElement.clientHeight,
          panelOverflow: panelStyle.overflowY,
          rootOverflow: rootStyle.overflowY,
          bodyOverflow: bodyStyle.overflowY,
        };
      });
      const panelBox = await rect(panel);
      const headerBox = await rect(header);
      const footerBox = await rect(footer);
      expect(panelBox.top).toBeGreaterThanOrEqual(-PX_TOLERANCE);
      expect(panelBox.bottom).toBeLessThanOrEqual(viewport.height + PX_TOLERANCE);
      const label = `${viewport.width}px ${dialog.opener}${dialog.tab ? ` ${dialog.tab}` : ""}`;
      expectInside(headerBox, panelBox, `${label} header`);
      expectInside(footerBox, panelBox, `${label} footer`);
      expect(geometry.panelScrollHeight).toBeLessThanOrEqual(geometry.panelClientHeight + PX_TOLERANCE);
      expect(geometry.rootScrollHeight).toBeLessThanOrEqual(geometry.rootClientHeight + PX_TOLERANCE);
      expect(geometry.rootOverflow).not.toBe("auto");
      expect(["auto", "scroll"]).toContain(geometry.bodyOverflow);
      expect(geometry.bodyScrollHeight).toBeGreaterThan(geometry.bodyClientHeight);

      await body.evaluate(element => { element.scrollTop = Math.min(300, element.scrollHeight); });
      expectInside(await rect(header), await rect(panel), `${label} header after body scroll`);
      expectInside(await rect(footer), await rect(panel), `${label} footer after body scroll`);
      await page.locator(dialog.close).click();
      if (dialog.tab) await openInputsTab(page, dialog.tab);
      else await page.getByRole("button", { name: dialog.opener, exact: true }).click();
      expect(await body.evaluate(element => element.scrollTop)).toBe(0);
      await page.locator(dialog.close).click();
      await page.locator("[data-scroll-fixture]").evaluate(element => element.remove());
    }
  }
});

test("Credits-only Projects+Prices nudge clears before Project and Manual render", async ({ page }) => {
  // Break caught: both synchronous early returns bypass the Credits-only nudge cleanup and leave it covering toolbar actions.
  await loadPlanner(page, { width: 390, height: 844 });
  const inputs = page.getByRole("button", { name: "Projects+Prices", exact: true });
  const poke = page.locator(".poke");

  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await expect(inputs).toHaveClass(/poke-on/);
  await expect(poke).toBeVisible();
  await page.getByRole("button", { name: "Project plan", exact: true }).click();
  await expect(inputs).not.toHaveClass(/poke-on/);
  await expect(poke).toBeHidden();
  await expect(inputs).toBeVisible();

  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await expect(inputs).toHaveClass(/poke-on/);
  await expect(poke).toBeVisible();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await expect(inputs).not.toHaveClass(/poke-on/);
  await expect(poke).toBeHidden();
});

test("capture deterministic 11A review evidence when requested", async ({ page }) => {
  test.skip(!process.env.VISUAL_EVIDENCE_DIR, "Set VISUAL_EVIDENCE_DIR to capture ignored review evidence.");
  const phase = process.env.VISUAL_EVIDENCE_PHASE || "review";
  const outputDirectory = process.env.VISUAL_EVIDENCE_DIR;
  fs.mkdirSync(outputDirectory, { recursive: true });

  await page.addInitScript(() => {
    const RealDate = Date;
    const fixed = Date.UTC(2026, 7, 1, 17, 0, 0);
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
  });

  const capture = async (width, state) => {
    await page.evaluate(() => {
      const status = document.getElementById("solveStat");
      if (status && /Solved in/.test(status.textContent)) status.textContent = "Plan updated. Solved in 0.0 ms";
    });
    await page.screenshot({
      path: path.join(outputDirectory, `${phase}-${width}-${state}.png`),
      animations: "disabled",
      caret: "hide",
      fullPage: false,
    });
  };

  for (const width of [1440, 1024, 900, 560, 430, 390, 375, 320]) {
    await page.setViewportSize({ width, height: width >= 900 ? 900 : 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#results")).toContainText("Line assignment");
    await page.evaluate(() => document.fonts.ready);
    await capture(width, "items-result");
  }

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.evaluate(() => {
    addCatalogProject(CATALOG[0].catId);
    mutateState(st => { st.planStart = Date.UTC(2026, 7, 1, 17, 0, 0); });
    save();
  });
  await page.getByRole("button", { name: "Project plan", exact: true }).click();
  await expect(page.locator("#results .metrics")).toBeVisible();
  await capture(1024, "project-result");

  await page.setViewportSize({ width: 430, height: 844 });
  await openInputsTab(page, "Projects");
  await expect(page.locator("#projList .cat-card")).toBeVisible();
  await capture(430, "project-card-dialog");
  await page.locator("#inputsDone").click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#results .metrics")).toBeVisible();
  await capture(390, "project-result");

  await page.setViewportSize({ width: 560, height: 844 });
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await expect(page.locator("#results")).toContainText("Manual mode.");
  await capture(560, "manual");

  await page.setViewportSize({ width: 375, height: 700 });
  await page.getByRole("button", { name: "Mined resources", exact: true }).click();
  await expect(page.locator("#minedModal")).toBeVisible();
  await capture(375, "long-dialog");
  await page.locator("#minedDone").click();

  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await expect(page.locator("#results")).toContainText("Manual mode.");
  await capture(320, "manual");
});
