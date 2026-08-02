"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PAGE_SCRIPTS = [
  "catalog.js",
  "core.js",
  "fields.js",
  "state.js",
  "dom.js",
  "render.js",
  "project-schedule.js",
  "solver.js",
  "solve-service.js",
  "results.js",
  "manual.js",
  "dialogs.js",
  "events.js",
];
const WORKER_SCRIPTS = ["core.js", "fields.js", "state.js", "project-schedule.js", "solver.js"];
const IMAGE_FILES = ["favicon.png", "dupe.jpg", "speed.jpg"];
const HASH_LENGTH = 16;
const LEGACY_V2_SHA256 = "9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2";

function read(file) {
  return fs.readFileSync(file);
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function sha16(bytes) {
  return sha256(bytes).slice(0, HASH_LENGTH);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function replaceExactly(text, search, replacement, expectedCount, label) {
  const pieces = text.split(search);
  const count = pieces.length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} occurrence(s), found ${count}`);
  }
  return pieces.join(replacement);
}

function write(directory, relative, bytes) {
  const target = path.join(directory, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function emitHashed(directory, stem, extension, bytes) {
  const name = `${stem}.${sha16(bytes)}.${extension}`;
  write(directory, `static/${name}`, bytes);
  return `/static/${name}`;
}

function assertSafeRoots(sourceRoot, outputRoot) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  if (output === path.parse(output).root || output === source || source.startsWith(output + path.sep)) {
    throw new Error(`Refusing unsafe build output path: ${output}`);
  }
}

function buildWorkerPayload(sourceRoot) {
  const handlerPath = path.join(sourceRoot, "js", "solver.worker.v2.js");
  let handler = readText(handlerPath);
  handler = replaceExactly(
    handler,
    'importScripts("core.js", "fields.js", "state.js", "project-schedule.js", "solver.js");',
    "",
    1,
    "Worker dependency import"
  );
  const payload = [
    ...WORKER_SCRIPTS.map(file => readText(path.join(sourceRoot, "js", file))),
    handler,
  ].join("\n;\n");
  if (/importScripts\s*\(/.test(payload)) {
    throw new Error("The production Worker payload still contains importScripts");
  }
  return payload;
}

function workerBootstrap(workerPayload) {
  return `"use strict";
const __FORGE_SOLVER_WORKER_SOURCE__=${JSON.stringify(workerPayload)};
function __forgeCreateSolverWorker(){
  const objectUrl=URL.createObjectURL(new Blob([__FORGE_SOLVER_WORKER_SOURCE__],{type:"text/javascript"}));
  let created=null;
  let release=null;
  try{
    created=new Worker(objectUrl);
    let released=false;
    let releaseTimer=null;
    release=()=>{
      if(released)return;
      released=true;
      if(releaseTimer!==null){clearTimeout(releaseTimer);releaseTimer=null;}
      URL.revokeObjectURL(objectUrl);
    };
    created.__forgeRelease=release;
    if(typeof created.addEventListener==="function"){
      created.addEventListener("message",release,{once:true});
      created.addEventListener("error",release,{once:true});
      releaseTimer=setTimeout(release,60000);
    }else releaseTimer=setTimeout(release,0);
    return created;
  }catch(error){
    if(created)try{created.terminate();}catch(cleanupError){}
    if(release){
      try{release();}catch(cleanupError){try{URL.revokeObjectURL(objectUrl);}catch(revokeError){}}
    }else try{URL.revokeObjectURL(objectUrl);}catch(cleanupError){}
    throw error;
  }
}
`;
}

function buildApp(sourceRoot, assetUrls) {
  const sources = PAGE_SCRIPTS.map(file => readText(path.join(sourceRoot, "js", file)));
  let app = `${workerBootstrap(buildWorkerPayload(sourceRoot))}\n;\n${sources.join("\n;\n")}`;
  app = replaceExactly(
    app,
    'new Worker("js/solver.worker.v2.js")',
    "__forgeCreateSolverWorker()",
    1,
    "production Worker constructor"
  );
  app = replaceExactly(app, "/assets/speed.jpg", assetUrls.speed, 1, "speed tooltip image");
  if (/importScripts\s*\(/.test(app)) throw new Error("The app still contains a network-importing Worker");
  if (/js\/solver\.worker(?:\.v2)?\.js/.test(app)) throw new Error("The app still references a Worker URL");
  if (/\/assets\/speed\.jpg/.test(app)) throw new Error("The app still references the unhashed speed image");
  return Buffer.from(app);
}

function buildIndex(sourceRoot, urls) {
  let html = readText(path.join(sourceRoot, "index.html"));
  html = replaceExactly(html, "assets/favicon.png", urls.favicon, 2, "favicon references");
  html = replaceExactly(
    html,
    "css/styles.css?v=20260801-mined-resources-v2",
    urls.styles,
    1,
    "stylesheet reference"
  );
  html = replaceExactly(html, "/assets/dupe.jpg", urls.dupe, 1, "dupe tooltip image");
  html = replaceExactly(html, "worker-src 'self';", "worker-src 'self' blob:;", 1, "HTML Worker CSP");

  const sourceTags = PAGE_SCRIPTS.map(file => `<script src="js/${file}"></script>`).join("\n");
  html = replaceExactly(html, sourceTags, `<script src="${urls.app}"></script>`, 1, "page script block");

  if (/(?:src|href)=["'](?:js\/|css\/|assets\/)/.test(html)) {
    throw new Error("Generated HTML still references unhashed local assets");
  }
  if (/\/assets\/(?:dupe|speed)\.jpg/.test(html)) {
    throw new Error("Generated HTML still references an unhashed tooltip image");
  }
  return Buffer.from(html);
}

function verifyStage(stageRoot) {
  const staticRoot = path.join(stageRoot, "static");
  for (const name of fs.readdirSync(staticRoot)) {
    const bytes = read(path.join(staticRoot, name));
    const match = name.match(/\.([0-9a-f]{16})\.[^.]+$/);
    if (!match || match[1] !== sha16(bytes)) {
      throw new Error(`Generated asset is not named from its final bytes: ${name}`);
    }
  }
  const appFiles = fs.readdirSync(staticRoot).filter(name => /^app\.[0-9a-f]{16}\.js$/.test(name));
  if (appFiles.length !== 1) throw new Error(`Expected one generated app bundle, found ${appFiles.length}`);
  const html = readText(path.join(stageRoot, "index.html"));
  if (!html.includes(`/static/${appFiles[0]}`)) throw new Error("Generated HTML does not load the emitted app bundle");
}

function buildStaticSite({ sourceRoot, outputRoot } = {}) {
  const source = path.resolve(sourceRoot || path.join(__dirname, ".."));
  const output = path.resolve(outputRoot || path.join(source, "dist"));
  assertSafeRoots(source, output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(output), ".forge-static-stage-"));

  try {
    const imageUrls = {};
    for (const file of IMAGE_FILES) {
      const extension = path.extname(file).slice(1);
      const stem = path.basename(file, path.extname(file));
      imageUrls[stem] = emitHashed(stage, stem, extension, read(path.join(source, "assets", file)));
    }

    const styles = read(path.join(source, "css", "styles.css"));
    if (/url\s*\(/i.test(styles.toString("utf8"))) {
      throw new Error("styles.css contains url(...); add that dependency to the content-hash build graph");
    }
    const stylesUrl = emitHashed(stage, "styles", "css", styles);
    const app = buildApp(source, imageUrls);
    const appUrl = emitHashed(stage, "app", "js", app);
    write(stage, "index.html", buildIndex(source, {
      app: appUrl,
      styles: stylesUrl,
      favicon: imageUrls.favicon,
      dupe: imageUrls.dupe,
    }));
    write(stage, "js/solver.worker.js", read(path.join(source, "js", "solver.worker.js")));
    const legacyV2 = read(path.join(source, "compat", "solver.worker.v2.js"));
    if (sha256(legacyV2) !== LEGACY_V2_SHA256) {
      throw new Error("compat/solver.worker.v2.js changed, but its immutable URL is a permanent browser contract");
    }
    write(stage, "js/solver.worker.v2.js", legacyV2);

    verifyStage(stage);
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(stage, output);
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }

  return { outputRoot: output };
}

if (require.main === module) {
  const requestedOutput = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const result = buildStaticSite({ outputRoot: requestedOutput });
  process.stdout.write(`Built Forge Planner at ${result.outputRoot}\n`);
}

module.exports = { buildStaticSite, buildWorkerPayload };
