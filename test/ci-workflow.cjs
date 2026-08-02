"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "verify.yml"), "utf8");

assert.match(workflow, /^on:\n  push:\n    branches:\n      - main\n  pull_request:\s*$/m,
  "feature branches must verify through pull_request only; direct pushes run the suite only on main");

function runOwnerCount(source, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (source.match(new RegExp(`^[ \\t]*(?:-[ \\t]+)?run:[ \\t]+${escaped}[ \\t]*$`, "gm")) || []).length;
}
function commandMentionCount(source, command) {
  return source.split(/\r?\n/).filter(line => !line.trimStart().startsWith("#") && line.includes(command)).length;
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

function visualUploadStep(source) {
  return source.match(/\n      - name: Upload visual release-matrix evidence\n([\s\S]*?)(?=\n      - |$)/);
}
const visualUpload = visualUploadStep(workflow);
assert.ok(visualUpload, "the visual release-matrix upload step must exist");
assert.match(visualUpload[1], /if-no-files-found: error/,
  "a green visual lane must not silently omit release-matrix evidence");

const uploadBoundaryMutation = workflow
  .replace("if-no-files-found: error", "if-no-files-found: ignore")
  .replace("      - name: Release upgrade", "      - uses: example/upload@v1\n        with:\n          if-no-files-found: error\n      - name: Release upgrade");
assert.doesNotMatch(visualUploadStep(uploadBoundaryMutation)[1], /if-no-files-found: error/,
  "the evidence check must not borrow success policy from a later unnamed step");

console.log("CI workflow contract passed");
