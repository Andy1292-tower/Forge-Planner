"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = { console };
vm.createContext(context);
vm.runInContext([
  fs.readFileSync(path.join(root, "js", "catalog.js"), "utf8"),
  fs.readFileSync(path.join(root, "js", "core.js"), "utf8"),
  `globalThis.__catalogContract = {
    catalog: PROJECT_CATALOG,
    metadata: typeof PROJECT_CATALOG_METADATA === "undefined" ? null : PROJECT_CATALOG_METADATA,
    prereqs: PROJECT_PREREQS,
    unlocks: UNLOCKS,
    knownItems: ALLITEMS,
  };`,
].join("\n;\n"), context, { filename: "catalog-validation.bundle.js" });

const actual = context.__catalogContract;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_NAME_LENGTH = 256;
const MAX_LEVELS = 256;
const MAX_COSTS_PER_LEVEL = 64;
const MAX_QUANTITY = 1e100;
const PLAIN_OBJECT_PROTOTYPES = new Set([
  Object.prototype,
  Object.getPrototypeOf(actual.catalog[0]),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ownDataValue(object, key) {
  if (!object || typeof object !== "object") return { ok: false, value: undefined };
  const descriptor = Object.getOwnPropertyDescriptor(object, String(key));
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    return { ok: false, value: undefined };
  }
  return { ok: true, value: descriptor.value };
}

function isOrdinaryDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return PLAIN_OBJECT_PROTOTYPES.has(Object.getPrototypeOf(value));
}

function validateCatalog({ catalog, prereqs, unlocks, knownItems }) {
  const errors = [];
  const known = new Set(knownItems || []);
  const ids = new Set();

  if (!Array.isArray(catalog) || catalog.length === 0) {
    return ["catalog must contain at least one project"];
  }

  for (let projectIndex = 0; projectIndex < catalog.length; projectIndex += 1) {
    const projectPath = `catalog[${projectIndex}]`;
    const projectSlot = ownDataValue(catalog, projectIndex);
    if (!projectSlot.ok) {
      errors.push(`${projectPath} must be an ordinary data property`);
      continue;
    }
    const project = projectSlot.value;
    if (!isOrdinaryDataObject(project)) {
      errors.push(`${projectPath} must be an ordinary object`);
      continue;
    }

    const fields = {};
    for (const key of ["catId", "name", "description", "levels"]) {
      const field = ownDataValue(project, key);
      if (!field.ok) errors.push(`${projectPath}.${key} must be an ordinary data property`);
      else fields[key] = field.value;
    }

    if (typeof fields.catId !== "string" || !ID_PATTERN.test(fields.catId)) {
      errors.push(`${projectPath}.catId must be a descriptor-valid ID`);
    } else if (ids.has(fields.catId)) {
      errors.push(`${projectPath}.catId duplicates ${fields.catId}`);
    } else {
      ids.add(fields.catId);
    }

    if (typeof fields.name !== "string" || fields.name.trim() !== fields.name ||
        fields.name.length === 0 || fields.name.length > MAX_NAME_LENGTH) {
      errors.push(`${projectPath}.name must be a nonempty, trimmed name of at most ${MAX_NAME_LENGTH} characters`);
    }
    if (typeof fields.description !== "string" || fields.description.length > 2048) {
      errors.push(`${projectPath}.description must be text of at most 2048 characters`);
    }

    const levels = fields.levels;
    if (!Array.isArray(levels) || levels.length === 0 || levels.length > MAX_LEVELS) {
      errors.push(`${projectPath}.levels must contain 1-${MAX_LEVELS} levels`);
      continue;
    }

    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const levelPath = `${projectPath}.levels[${levelIndex}]`;
      const levelSlot = ownDataValue(levels, levelIndex);
      if (!levelSlot.ok) {
        errors.push(`${levelPath} must be an ordinary data property`);
        continue;
      }
      const level = levelSlot.value;
      if (!isOrdinaryDataObject(level)) {
        errors.push(`${levelPath} must be an ordinary object`);
        continue;
      }

      const costsField = ownDataValue(level, "costs");
      const costs = costsField.value;
      if (!costsField.ok || !Array.isArray(costs) || costs.length > MAX_COSTS_PER_LEVEL) {
        errors.push(`${levelPath}.costs must be an ordinary array with at most ${MAX_COSTS_PER_LEVEL} entries`);
        continue;
      }

      const costItems = new Set();
      for (let costIndex = 0; costIndex < costs.length; costIndex += 1) {
        const costPath = `${levelPath}.costs[${costIndex}]`;
        const costSlot = ownDataValue(costs, costIndex);
        if (!costSlot.ok) {
          errors.push(`${costPath} must be an ordinary data property`);
          continue;
        }
        const cost = costSlot.value;
        if (!isOrdinaryDataObject(cost)) {
          errors.push(`${costPath} must be an ordinary object`);
          continue;
        }

        const costFields = {};
        for (const key of ["item", "qty"]) {
          const field = ownDataValue(cost, key);
          if (!field.ok) errors.push(`${costPath}.${key} must be an ordinary data property`);
          else costFields[key] = field.value;
        }
        if (!known.has(costFields.item)) errors.push(`${costPath}.item is unknown: ${String(costFields.item)}`);
        if (costItems.has(costFields.item)) errors.push(`${levelPath} repeats cost item ${String(costFields.item)}`);
        costItems.add(costFields.item);
        if (typeof costFields.qty !== "number" || !Number.isFinite(costFields.qty) ||
            costFields.qty < 0 || costFields.qty > MAX_QUANTITY) {
          errors.push(`${costPath}.qty must be finite and between 0 and ${MAX_QUANTITY}`);
        }
      }
    }
  }

  if (!prereqs || typeof prereqs !== "object" || Array.isArray(prereqs)) {
    errors.push("PROJECT_PREREQS must be an object");
  } else {
    const adjacency = new Map();
    for (const dependent of Object.keys(prereqs)) {
      if (!ids.has(dependent)) errors.push(`PROJECT_PREREQS key does not resolve: ${dependent}`);

      const requirementsField = ownDataValue(prereqs, dependent);
      if (!requirementsField.ok) {
        errors.push(`PROJECT_PREREQS.${dependent} must be an ordinary data property containing an array`);
        adjacency.set(dependent, []);
        continue;
      }
      const requirements = requirementsField.value;
      if (!Array.isArray(requirements)) {
        errors.push(`PROJECT_PREREQS.${dependent} must be an array`);
        adjacency.set(dependent, []);
        continue;
      }

      const unique = new Set();
      const validatedRequirements = [];
      for (let requirementIndex = 0; requirementIndex < requirements.length; requirementIndex += 1) {
        const requirementPath = `PROJECT_PREREQS.${dependent}[${requirementIndex}]`;
        const requirementField = ownDataValue(requirements, requirementIndex);
        if (!requirementField.ok) {
          errors.push(`${requirementPath} must be an ordinary data property`);
          continue;
        }
        const requirement = requirementField.value;
        if (!ids.has(requirement)) errors.push(`PROJECT_PREREQS target does not resolve: ${requirement}`);
        if (requirement === dependent) errors.push(`PROJECT_PREREQS contains a self-dependency: ${dependent}`);
        if (unique.has(requirement)) errors.push(`PROJECT_PREREQS.${dependent} repeats ${requirement}`);
        if (!unique.has(requirement) && ids.has(requirement)) validatedRequirements.push(requirement);
        unique.add(requirement);
      }
      adjacency.set(dependent, validatedRequirements);
    }

    const visiting = new Set();
    const visited = new Set();
    const visit = id => {
      if (visiting.has(id)) {
        errors.push(`PROJECT_PREREQS contains a cycle through ${id}`);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const requirement of adjacency.get(id) || []) visit(requirement);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of adjacency.keys()) visit(id);
  }

  if (!unlocks || typeof unlocks !== "object" || Array.isArray(unlocks)) {
    errors.push("UNLOCKS must be an object");
  } else {
    const unlockOwners = new Map();
    for (const [projectId, item] of Object.entries(unlocks)) {
      if (!ids.has(projectId)) errors.push(`UNLOCKS key does not resolve: ${projectId}`);
      if (!known.has(item)) errors.push(`UNLOCKS item is unknown: ${String(item)}`);
      if (unlockOwners.has(item)) {
        errors.push(`UNLOCKS has an ambiguous unlock owner for ${String(item)}: ${unlockOwners.get(item)} and ${projectId}`);
      } else {
        unlockOwners.set(item, projectId);
      }
    }
  }

  return errors;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function errorsFor(candidate) {
  let errors;
  assert.doesNotThrow(() => { errors = validateCatalog(candidate); });
  return errors.join("\n");
}

test("catalog provenance is explicit, machine-readable, and unverified until a trusted artifact exists", () => {
  assert.ok(actual.metadata, "PROJECT_CATALOG_METADATA must exist");
  assert.equal(actual.metadata.schemaVersion, 1);
  assert.equal(actual.metadata.status, "unverified");
  assert.equal(actual.metadata.sourceType, "unknown");
  assert.equal(actual.metadata.gameVersion, null);
  assert.equal(actual.metadata.exportedAt, null);
  assert.equal(actual.metadata.sourceSha256, null);
  assert.equal(actual.metadata.updatedAt, null);
  assert.equal(actual.metadata.verified, false);
  assert.equal(Object.isFrozen(actual.metadata), true);
});

test("the shipped catalog satisfies the structural and semantic contract", () => {
  assert.deepEqual(validateCatalog(actual), []);
});

test("the catalog gate rejects a sparse project index", () => {
  const candidate = clone(actual);
  delete candidate.catalog[0];
  assert.match(errorsFor(candidate), /catalog\[0\].*ordinary data property/i);
});

test("the catalog gate rejects null and non-ordinary project nodes without throwing", () => {
  const nullProject = clone(actual);
  nullProject.catalog[0] = null;
  assert.match(errorsFor(nullProject), /catalog\[0\].*ordinary object/i);

  const inheritedProject = clone(actual);
  inheritedProject.catalog[0] = Object.assign(Object.create({ inherited: true }), inheritedProject.catalog[0]);
  assert.match(errorsFor(inheritedProject), /catalog\[0\].*ordinary object/i);

  const chainedNullPrototypeProject = clone(actual);
  chainedNullPrototypeProject.catalog[0] = Object.assign(
    Object.create(Object.create(null)),
    chainedNullPrototypeProject.catalog[0]
  );
  assert.match(errorsFor(chainedNullPrototypeProject), /catalog\[0\].*ordinary object/i);
});

test("the catalog gate rejects a sparse level index", () => {
  const candidate = clone(actual);
  delete candidate.catalog[0].levels[0];
  assert.match(errorsFor(candidate), /catalog\[0\]\.levels\[0\].*ordinary data property/i);
});

test("the catalog gate rejects null and non-ordinary level nodes without throwing", () => {
  const nullLevel = clone(actual);
  nullLevel.catalog[0].levels[0] = null;
  assert.match(errorsFor(nullLevel), /catalog\[0\]\.levels\[0\].*ordinary object/i);

  const inheritedLevel = clone(actual);
  inheritedLevel.catalog[0].levels[0] = Object.assign(Object.create({ inherited: true }), inheritedLevel.catalog[0].levels[0]);
  assert.match(errorsFor(inheritedLevel), /catalog\[0\]\.levels\[0\].*ordinary object/i);

  const chainedNullPrototypeLevel = clone(actual);
  chainedNullPrototypeLevel.catalog[0].levels[0] = Object.assign(
    Object.create(Object.create(null)),
    chainedNullPrototypeLevel.catalog[0].levels[0]
  );
  assert.match(errorsFor(chainedNullPrototypeLevel), /catalog\[0\]\.levels\[0\].*ordinary object/i);
});

test("the catalog gate rejects a sparse cost index", () => {
  const candidate = clone(actual);
  delete candidate.catalog[0].levels[0].costs[0];
  assert.match(errorsFor(candidate), /catalog\[0\]\.levels\[0\]\.costs\[0\].*ordinary data property/i);
});

test("the catalog gate rejects null and non-ordinary cost nodes without throwing", () => {
  const nullCost = clone(actual);
  nullCost.catalog[0].levels[0].costs[0] = null;
  assert.match(errorsFor(nullCost), /catalog\[0\]\.levels\[0\]\.costs\[0\].*ordinary object/i);

  const inheritedCost = clone(actual);
  inheritedCost.catalog[0].levels[0].costs[0] = Object.assign(Object.create({ inherited: true }), inheritedCost.catalog[0].levels[0].costs[0]);
  assert.match(errorsFor(inheritedCost), /catalog\[0\]\.levels\[0\]\.costs\[0\].*ordinary object/i);

  const chainedNullPrototypeCost = clone(actual);
  chainedNullPrototypeCost.catalog[0].levels[0].costs[0] = Object.assign(
    Object.create(Object.create(null)),
    chainedNullPrototypeCost.catalog[0].levels[0].costs[0]
  );
  assert.match(errorsFor(chainedNullPrototypeCost), /catalog\[0\]\.levels\[0\]\.costs\[0\].*ordinary object/i);
});

test("the catalog gate rejects malformed prerequisite adjacency without throwing", () => {
  const [dependent] = Object.keys(actual.prereqs);

  const objectValue = clone(actual);
  objectValue.prereqs[dependent] = {};
  assert.match(errorsFor(objectValue), /PROJECT_PREREQS\..*must be an array/i);

  const accessorValue = clone(actual);
  Object.defineProperty(accessorValue.prereqs, dependent, {
    configurable: true,
    enumerable: true,
    get() { throw new Error("prerequisite value getter must not run"); },
  });
  assert.match(errorsFor(accessorValue), /PROJECT_PREREQS\..*ordinary data property/i);

  const accessorEntry = clone(actual);
  Object.defineProperty(accessorEntry.prereqs[dependent], "0", {
    configurable: true,
    enumerable: true,
    get() { throw new Error("prerequisite entry getter must not run"); },
  });
  assert.match(errorsFor(accessorEntry), /PROJECT_PREREQS\..*\[0\].*ordinary data property/i);
});

test("the catalog gate rejects duplicate IDs, bad item costs, and unresolved dependencies", () => {
  const duplicateId = clone(actual);
  duplicateId.catalog[1].catId = duplicateId.catalog[0].catId;
  assert.match(validateCatalog(duplicateId).join("\n"), /duplicates/);

  const badCosts = clone(actual);
  badCosts.catalog[0].levels[0].costs.push({ item: badCosts.catalog[0].levels[0].costs[1].item, qty: 1 });
  badCosts.catalog[0].levels[0].costs[0].item = "Unknownium";
  badCosts.catalog[0].levels[0].costs[0].qty = Infinity;
  badCosts.catalog[0].levels[0].costs[1].qty = -1;
  badCosts.catalog[0].levels[0].costs[2].qty = 1e101;
  const badCostErrors = validateCatalog(badCosts).join("\n");
  assert.match(badCostErrors, /unknown/);
  assert.match(badCostErrors, /repeats cost item/);
  assert.match(badCostErrors, /must be finite/);
  assert.equal((badCostErrors.match(/must be finite/g) || []).length, 3);

  const unresolved = clone(actual);
  unresolved.prereqs[unresolved.catalog[0].catId] = ["missing-project"];
  assert.match(validateCatalog(unresolved).join("\n"), /target does not resolve/);
});

test("the catalog gate rejects duplicate prerequisite edges, cycles, and ambiguous unlock owners", () => {
  const [dependent] = Object.keys(actual.prereqs);
  const [requirement] = actual.prereqs[dependent];

  const duplicatePrerequisite = clone(actual);
  duplicatePrerequisite.prereqs[dependent] = [requirement, requirement];
  assert.match(validateCatalog(duplicatePrerequisite).join("\n"), /repeats/);

  const cycle = clone(actual);
  cycle.prereqs[requirement] = [dependent];
  assert.match(validateCatalog(cycle).join("\n"), /cycle/);

  const duplicateUnlock = clone(actual);
  const unlockIds = Object.keys(duplicateUnlock.unlocks);
  duplicateUnlock.unlocks[unlockIds[1]] = duplicateUnlock.unlocks[unlockIds[0]];
  assert.match(validateCatalog(duplicateUnlock).join("\n"), /unlock owner/i);
});

let failed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}
if (failed) process.exitCode = 1;
else console.log(`${tests.length} catalog validation test(s) passed`);
