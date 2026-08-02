"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "verify.yml"), "utf8");

assert.match(workflow, /^on:\n  push:\n    branches:\n      - main\n  pull_request:\s*$/m,
  "feature branches must verify through pull_request only; direct pushes run the suite only on main");

function runOwnerCount(source, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directRuns = (source.match(new RegExp(`^[ \\t]*(?:-[ \\t]+)?run:[ \\t]+${escaped}[ \\t]*$`, "gm")) || []).length;
  const matrixCommands = (source.match(new RegExp(`^[ \\t]*command:[ \\t]+["']${escaped}["'][ \\t]*$`, "gm")) || []).length;
  return directRuns + matrixCommands;
}
function commandMentionCount(source, command) {
  return source.split(/\r?\n/).filter(line => !line.trimStart().startsWith("#") && line.includes(command)).length;
}
function jobBlock(source, name) {
  const header = `  ${name}:\n`;
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `${name} job must exist`);
  const remainder = source.slice(start + header.length);
  const nextJob = remainder.search(/^  [A-Za-z0-9_-]+:\n/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

function assertPlaywrightContract(source) {
  const playwrightJob = jobBlock(source, "playwright");
  assert.match(playwrightJob, /fail-fast: false/);
  const lanes = Array.from(playwrightJob.matchAll(/^\s*- lane: (\S+)$/gm), match => match[1]);
  assert.deepEqual(lanes, ["browser", "accessibility", "visual", "release"],
    "the Playwright matrix must contain exactly the four required verification lanes");
  assert.match(playwrightJob, /playwright-\$\{\{ matrix\.lane \}\}-artifacts/);
}

function assertVerifyContract(source) {
  const verifyJob = jobBlock(source, "verify");
  assert.match(verifyJob, /^    name: verify$/m);
  assert.match(verifyJob, /needs: \[node, playwright\]/);
  assert.match(verifyJob, /if: always\(\)/);
  assert.match(verifyJob, /needs\.node\.result/);
  assert.match(verifyJob, /needs\.playwright\.result/);
}

for (const command of ["npm test", "npm run test:browser", "npm run test:a11y", "npm run test:visual", "npm run test:release"]) {
  const count = runOwnerCount(workflow, command);
  assert.equal(count, 1, `${command} must have exactly one CI owner, found ${count}`);
  assert.equal(commandMentionCount(workflow, command), 1,
    `${command} must not be duplicated through an inline, combined, prefixed, or block run form`);
}
assert.equal(runOwnerCount(`${workflow}\n      - run: npm run test:visual\n`, "npm run test:visual"), 2,
  "the lane-owner check must detect an unnamed inline run step");
for (const duplicate of [
  "      - run: npm run test:visual # duplicate",
  "      - run: |\n          npm run test:visual",
  "      - run: NO_COLOR=1 npm run test:visual && echo duplicate",
]) {
  assert.equal(commandMentionCount(`${workflow}\n${duplicate}\n`, "npm run test:visual"), 2,
    "the lane-owner check must fail closed on alternate run syntax");
}

assert.match(workflow, /^concurrency:\n[\s\S]*?cancel-in-progress: true$/m);
const nodeJob = jobBlock(workflow, "node");
assert.match(nodeJob, /run: npm test/);
assertPlaywrightContract(workflow);
assertVerifyContract(workflow);

assert.throws(() => assertPlaywrightContract(workflow.replace(
  "          - lane: visual\n            command: \"npm run test:visual\"\n", "")),
"the contract must reject a workflow that omits a verification lane");
assert.throws(() => assertPlaywrightContract(workflow.replace(
  "          - lane: release\n            command: \"npm run test:release\"\n",
  "          - lane: release\n            command: \"npm run test:release\"\n          - lane: smoke\n            command: \"npm run test:smoke\"\n")),
"the contract must reject an extra verification lane");
assert.throws(() => assertPlaywrightContract(workflow.replace("fail-fast: false", "fail-fast: true")),
  "the contract must reject fail-fast Playwright lanes");
assert.throws(() => assertVerifyContract(workflow.replace(/(  verify:[\s\S]*?)if: always\(\)/, "$1if: success()")),
  "the contract must reject an aggregator that does not always run");
assert.throws(() => assertVerifyContract(workflow.replace("    name: verify\n", "    name: all-checks\n")),
  "the contract must reject a renamed required check");
assert.throws(() => assertPlaywrightContract(workflow.replace(
  "name: playwright-${{ matrix.lane }}-artifacts", "name: playwright-artifacts")),
"the contract must reject non-unique failure artifact names");

function visualUploadStep(source) {
  return source.match(/\n      - name: Upload visual release-matrix evidence\n([\s\S]*?)(?=\n      - |$)/);
}
function assertVisualUploadContract(source) {
  const visualUpload = visualUploadStep(source);
  assert.ok(visualUpload, "the visual release-matrix upload step must exist");
  assert.match(visualUpload[1], /if: always\(\) && matrix\.lane == 'visual'/,
    "the visual release-matrix upload must always run only for the visual lane");
  assert.match(visualUpload[1], /if-no-files-found: error/,
    "a green visual lane must not silently omit release-matrix evidence");
}

assertVisualUploadContract(workflow);
assert.throws(() => assertVisualUploadContract(workflow.replace("if-no-files-found: error", "if-no-files-found: ignore")),
  "the contract must reject relaxed visual-evidence uploads");
assert.throws(() => assertVisualUploadContract(workflow.replace(
  "if: always() && matrix.lane == 'visual'", "if: matrix.lane == 'visual'")),
"the contract must reject a visual upload that does not always run");
assert.throws(() => assertVisualUploadContract(workflow.replace(
  "if: always() && matrix.lane == 'visual'", "if: always()")),
"the contract must reject a visual upload that is not lane-scoped");

const uploadBoundaryMutation = workflow
  .replace("if-no-files-found: error", "if-no-files-found: ignore")
  .replace("      - name: Upload Playwright failure artifacts", "      - uses: example/upload@v1\n        with:\n          if-no-files-found: error\n      - name: Upload Playwright failure artifacts");
assert.doesNotMatch(visualUploadStep(uploadBoundaryMutation)[1], /if-no-files-found: error/,
  "the evidence check must not borrow success policy from a later unnamed step");

console.log("CI workflow contract passed");
