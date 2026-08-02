"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-parity-"));
const currentPath = path.join(tempDir, "current.json");

try {
  const parity = spawnSync(process.execPath, [path.join(__dirname, "parity.cjs")], {
    encoding: "utf8",
  });
  if (parity.error) throw parity.error;
  if (parity.status !== 0) {
    process.stderr.write(parity.stderr || "");
    throw new Error(`test/parity.cjs exited ${parity.status}`);
  }
  fs.writeFileSync(currentPath, parity.stdout);

  const check = spawnSync(process.execPath, [
    path.join(__dirname, "check.cjs"),
    path.join(root, "test", "golden.json"),
    currentPath,
  ], { stdio: "inherit" });
  if (check.error) throw check.error;
  if (check.status !== 0) process.exitCode = check.status || 1;
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
