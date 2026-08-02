"use strict";

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

const PX_TOLERANCE = 1;
const OVERFLOW_VIEWPORTS = [320, 375, 390, 430, 560, 561, 640, 768, 880, 881, 900, 1024, 1440];

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
  await page.getByRole("button", { name: "Shopping list", exact: true }).click();
  await page.evaluate(() => addCatalogProject(CATALOG[0].catId));
  await expect(page.locator("#projList .cat-card")).toBeVisible();
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

test("the wrapped page toolbar fills its available row at 430 and 560px", async ({ page }) => {
  // Break caught: later desktop rules override the mobile .tools width, leaving a visibly short toolbar.
  for (const width of [430, 560]) {
    await loadPlanner(page, { width, height: 1100 });
    const headerBox = await rect(page.locator("header.top"));
    const toolsBox = await rect(page.locator(".tools"));
    expect(Math.abs(toolsBox.left - headerBox.left), `${width}px toolbar left edge`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(toolsBox.right - headerBox.right), `${width}px toolbar right edge`).toBeLessThanOrEqual(PX_TOLERANCE);
  }
});

test("mobile project cards preserve a named identity row and put tools below it", async ({ page }) => {
  // Break caught: the auto-sized tools column collapses catalog project identity text to nearly zero width.
  for (const width of [375, 390]) {
    await loadPlanner(page, { width, height: 844 });
    await seedCatalogProject(page);
    const card = page.locator("#projList .cat-card");
    const nameBox = await rect(card.locator(".pname-static"));
    const toolsBox = await rect(card.locator(".proj-tools"));
    const cardBox = await rect(card);
    expect(nameBox.width, `${width}px project identity width`).toBeGreaterThanOrEqual(140);
    expect(toolsBox.top, `${width}px project tools must start below the identity row`).toBeGreaterThanOrEqual(nameBox.bottom - PX_TOLERANCE);
    expectInside(toolsBox, cardBox, `${width}px project tools must stay in the project card`);
  }
});

test("320px validation feedback stays inside line, Shopping-list Project, inline Project, and price owners", async ({ page }) => {
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

  await page.getByRole("button", { name: "Sell prices" }).click();
  const price = page.getByRole("textbox", { name: "Frames sell price per unit" });
  await price.fill("abc");
  const priceError = page.locator(`#${await price.getAttribute("data-field-error")}`);
  await expect(priceError).toBeVisible();
  expectInside(await rect(priceError), await rect(price.locator("xpath=..")), "price error must stay in its row");
  await expectRootFits("price error");
  await page.getByRole("button", { name: "Done editing sell prices" }).click();

  await page.getByRole("button", { name: "Shopping list" }).click();
  await page.getByRole("button", { name: "New custom project" }).click();
  await page.getByRole("button", { name: "Add level to New project" }).click();
  const from = page.getByRole("spinbutton", { name: "New project starting level" });
  const to = page.getByRole("spinbutton", { name: "New project ending level" });
  await to.fill("1");
  await from.fill("2");
  const projectErrors = page.locator(".proj-field-errors").first();
  await expect(projectErrors).toBeVisible();
  expectInside(await rect(projectErrors), await rect(page.locator(".proj-tools").first()), "Shopping-list errors must stay in tools");
  await expectRootFits("Shopping-list Project error");

  await from.fill("1");
  await to.fill("2");
  await page.evaluate(() => {
    mutateState(st => { st.projects[0].levels[0].costs = [{ item: "Frames", qty: 100 }]; });
    save();
  });
  await page.getByRole("button", { name: "Done editing shopping list" }).click();
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
    { opener: "Sell prices", root: "#priceModal", close: "#priceDone", row: "#priceRows .price-row" },
    { opener: "Lil' Forgie", root: "#forgieModal", close: "#forgieDone", row: "#forgieRows .price-row" },
    { opener: "Shopping list", root: "#projModal", close: "#projDone", row: "#invRows .price-row" },
  ];
  for (const entry of compactRows) {
    await page.getByRole("button", { name: entry.opener, exact: true }).click();
    const row = page.locator(entry.row).first();
    await expect(row).toBeVisible();
    const rowBox = await rect(row);
    const labelBox = await rect(row.locator(".pnm"));
    const inputBox = await rect(row.locator("input"));
    expect(inputBox.top, `${entry.opener} input must stack below its label`).toBeGreaterThanOrEqual(labelBox.bottom - PX_TOLERANCE);
    expect(Math.abs(inputBox.left - rowBox.left), `${entry.opener} input left edge`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(inputBox.right - rowBox.right), `${entry.opener} input right edge`).toBeLessThanOrEqual(PX_TOLERANCE);
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
  await page.locator("#projDone").click();

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
      { opener: "Shopping list", root: "#projModal", close: "#projDone" },
    ]) {
      await page.getByRole("button", { name: dialog.opener, exact: true }).click();
      await expect(page.locator(dialog.root)).toBeVisible();
      await expectHorizontalOverflowContract(page, `${width}px ${dialog.opener} dialog`);
      await page.locator(dialog.close).click();
    }
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
      { opener: "Shopping list", root: "#projModal", close: "#projDone" },
    ]) {
      await page.getByRole("button", { name: dialog.opener, exact: true }).click();
      const root = page.locator(dialog.root);
      const panel = root.locator(".modal");
      const header = panel.locator(".modal-h");
      const body = panel.locator("[data-dialog-body]");
      const footer = panel.locator(".modal-f");
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
      expectInside(headerBox, panelBox, `${viewport.width}px ${dialog.opener} header`);
      expectInside(footerBox, panelBox, `${viewport.width}px ${dialog.opener} footer`);
      expect(geometry.panelScrollHeight).toBeLessThanOrEqual(geometry.panelClientHeight + PX_TOLERANCE);
      expect(geometry.rootScrollHeight).toBeLessThanOrEqual(geometry.rootClientHeight + PX_TOLERANCE);
      expect(geometry.rootOverflow).not.toBe("auto");
      expect(["auto", "scroll"]).toContain(geometry.bodyOverflow);
      expect(geometry.bodyScrollHeight).toBeGreaterThan(geometry.bodyClientHeight);

      await body.evaluate(element => { element.scrollTop = Math.min(300, element.scrollHeight); });
      expectInside(await rect(header), await rect(panel), `${viewport.width}px ${dialog.opener} header after body scroll`);
      expectInside(await rect(footer), await rect(panel), `${viewport.width}px ${dialog.opener} footer after body scroll`);
      await page.locator(dialog.close).click();
      await page.getByRole("button", { name: dialog.opener, exact: true }).click();
      expect(await body.evaluate(element => element.scrollTop)).toBe(0);
      await page.locator(dialog.close).click();
    }
  }
});

test("Credits-only Sell prices nudge clears before Project and Manual render", async ({ page }) => {
  // Break caught: both synchronous early returns bypass the Credits-only nudge cleanup and leave it covering toolbar actions.
  await loadPlanner(page, { width: 390, height: 844 });
  const prices = page.getByRole("button", { name: "Sell prices", exact: true });
  const poke = page.locator(".poke");

  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await expect(prices).toHaveClass(/poke-on/);
  await expect(poke).toBeVisible();
  await page.getByRole("button", { name: "Project plan", exact: true }).click();
  await expect(prices).not.toHaveClass(/poke-on/);
  await expect(poke).toBeHidden();
  await expect(page.getByRole("button", { name: "Shopping list", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await expect(prices).toHaveClass(/poke-on/);
  await expect(poke).toBeVisible();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await expect(prices).not.toHaveClass(/poke-on/);
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
  await page.getByRole("button", { name: "Shopping list", exact: true }).click();
  await expect(page.locator("#projList .cat-card")).toBeVisible();
  await capture(430, "project-card-dialog");
  await page.locator("#projDone").click();

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
