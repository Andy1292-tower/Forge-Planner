"use strict";

const path = require("path");
const { buildStaticSite } = require("../scripts/build-static.cjs");
const { createStaticServer } = require("./serve-vercel-config.cjs");

const root = path.resolve(__dirname, "..");
const outputRoot = path.join(root, "dist");
buildStaticSite({ sourceRoot: root, outputRoot });

const controller = createStaticServer({
  staticRoot: outputRoot,
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4173),
  enableRequestMetrics: process.env.ENABLE_REQUEST_METRICS !== "0",
});

async function main() {
  const address = await controller.start();
  process.stdout.write(`Serving Forge Planner from ${outputRoot} with vercel.json headers at ${address.origin}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await controller.close();
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
