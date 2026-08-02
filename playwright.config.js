"use strict";

const { defineConfig } = require("@playwright/test");

const lane = process.env.FORGE_PLAYWRIGHT_LANE || "default";
const dedicatedBrowserSpecs = [
  "**/accessibility.spec.js",
  "**/visual-layout.spec.js",
  "**/release-upgrade.spec.js",
];

module.exports = defineConfig({
  testDir: "./test/browser",
  testMatch: lane === "release" ? "**/release-upgrade.spec.js" : undefined,
  testIgnore: lane === "browser" ? dedicatedBrowserSpecs : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: lane === "release" ? undefined : {
    command: "node test/serve-built.cjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
