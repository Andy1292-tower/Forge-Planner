"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "verify.yml"), "utf8");

assert.match(workflow, /^on:\n  push:\n    branches:\n      - main\n  pull_request:\s*$/m,
  "feature branches must verify through pull_request only; direct pushes run the suite only on main");
assert.match(workflow, /^concurrency:\n[\s\S]*?cancel-in-progress: true$/m);

function jobBlock(source, name) {
  const header = `  ${name}:\n`;
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `${name} job must exist`);
  const remainder = source.slice(start + header.length);
  const nextJob = remainder.search(/^  [A-Za-z0-9_-]+:\n/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

function assertVerifyContract(source) {
  const jobsSource = source.slice(source.indexOf("jobs:\n") + "jobs:\n".length);
  const jobNames = Array.from(jobsSource.matchAll(/^  ([A-Za-z0-9_-]+):$/gm), match => match[1]);
  assert.deepEqual(jobNames, ["verify"], "CI must contain exactly one verify job");
  const verifyJob = jobBlock(source, "verify");
  assert.match(verifyJob, /^    name: verify$/m);
  assert.match(verifyJob, /run: npm ci/);
  assert.match(verifyJob, /run: npm test/);
  assert.doesNotMatch(verifyJob, /needs:|if: always\(\)|playwright|browser|upload-artifact/i);
}

assertVerifyContract(workflow);
assert.doesNotMatch(workflow, /playwright|browser|upload-artifact/i,
  "the workflow must not contain browser-suite commands or artifact uploads");
assert.throws(() => assertVerifyContract(workflow.replace("    name: verify\n", "    name: all-checks\n")),
  "the contract must reject a renamed required check");
assert.throws(() => assertVerifyContract(workflow.replace("      - run: npm test", "      - run: npm run test:browser")),
  "the contract must require npm test");
assert.throws(() => assertVerifyContract(workflow.replace("      - run: npm ci", "      - run: npx playwright install")),
  "the contract must require npm ci and reject Playwright installation");
assert.throws(() => assertVerifyContract(`${workflow}\n  extra:\n    runs-on: ubuntu-latest\n`),
  "the contract must reject extra CI jobs");

console.log("CI workflow contract passed");
