"use strict";

const path = require("path");
const { buildStaticSite } = require("../scripts/build-static.cjs");

const root = path.resolve(__dirname, "..");
buildStaticSite({ sourceRoot: root, outputRoot: path.join(root, "dist") });
process.env.STATIC_ROOT = path.join(root, "dist");
process.env.ENABLE_REQUEST_METRICS = "1";
require("./serve-vercel-config.cjs");
