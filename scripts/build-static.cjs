"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PAGE_SCRIPTS = [
  "decimal.js",
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
  "changelog.js",
  "events.js",
  "feedback.js",
  "update-check.js",
];
const WORKER_SCRIPTS = ["decimal.js", "core.js", "fields.js", "state.js", "project-schedule.js", "solver.js"];
const IMAGE_FILES = ["favicon.png", "dupe.jpg", "speed.jpg"];
const HASH_LENGTH = 16;
const BUILD_STAMP_PLACEHOLDER = "__FORGE_BUILD_ID__";
const VERSION_FILE = "version.json";
const BOOT_SCRIPT = "boot.js";
const LEGACY_V2_SHA256 = "9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2";
const ANALYTICS_SIGNATURE = /(?:\/_vercel\/(?:insights|speed-insights)|va\.vercel-scripts\.com|vercelAnalytics)/i;
const ROOT_RELATIVE_OWNED_URL = /["'`(=]\/(?:static|assets|js|css)\//;
/* A leftover literal naming one of the Worker scripts the build ships as permanent endpoints. This
 * is a secondary net over a name shape, not the N1 rule: a construction path is forbidden by the
 * whole-app `new Worker(` count below, which no script name can slip past. */
const WORKER_SCRIPT_URL = /js\/[\w.-]*worker[\w.-]*\.js/i;
const WORKER_CONSTRUCTION = /new\s+Worker\s*\(/g;
const WORKER_FACTORY_CALL = /(?:^|[^\w$])workerFactory\s*\(/g;
const WORKER_PAYLOAD_SOURCE = "__FORGE_SOLVER_WORKER_SOURCE__";
const WORKER_URL_ACCESSOR = "__forgeSolverWorkerObjectUrl";
const WORKER_URL_MEMO = "__forgeSolverWorkerUrl";
const WORKER_URL_MEMO_GUARD = "if(__forgeSolverWorkerUrl===null)";

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

function countOccurrences(text, search) {
  return text.split(search).length - 1;
}

// String.prototype.match ignores a global pattern's lastIndex, so these counts stay independent of
// call order. RegExp.prototype.test does not, which is why no global pattern here is ever tested.
function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function replaceExactly(text, search, replacement, expectedCount, label) {
  const count = countOccurrences(text, search);
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} occurrence(s), found ${count}`);
  }
  return text.split(search).join(replacement);
}

function write(directory, relative, bytes) {
  const target = path.join(directory, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function emitHashed(directory, stem, extension, bytes) {
  const name = `${stem}.${sha16(bytes)}.${extension}`;
  write(directory, `static/${name}`, bytes);
  return `static/${name}`;
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
    'importScripts("decimal.js", "core.js", "fields.js", "state.js", "project-schedule.js", "solver.js");',
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

/* One payload, one object URL, page lifetime. Every solver Worker — the first, a respawn after
 * termination, and every member of a pool — is constructed from this one memo, so construction
 * costs no allocation and no request after the first. Nothing revokes it: a revoked URL cannot be
 * constructed from again, so a per-Worker release would poison every later Worker on the page.
 * The memo is also never cleared on failure, because a construction that throws must stay
 * retryable rather than permanently disabling Worker solving.
 *
 * The cost is a ~250 KB Blob copy of the payload retained for the whole session, where a per-Worker
 * release freed it seconds after the first message. That buys one allocation per page instead of
 * one per Worker: a twelve-supersede storm allocated twelve Blobs before this.
 *
 * The memo accessor is emitted BEFORE the factory on purpose: test/static-asset-build.cjs finds
 * the factory's closing brace by scanning forward from its declaration, and a helper after it
 * would be swallowed into that slice. */
function workerBootstrap(workerPayload) {
  return `"use strict";
const __FORGE_SOLVER_WORKER_SOURCE__=${JSON.stringify(workerPayload)};
let __forgeSolverWorkerUrl=null;
function __forgeSolverWorkerObjectUrl(){
  if(__forgeSolverWorkerUrl===null){
    __forgeSolverWorkerUrl=URL.createObjectURL(new Blob([__FORGE_SOLVER_WORKER_SOURCE__],{type:"text/javascript"}));
  }
  return __forgeSolverWorkerUrl;
}
function __forgeCreateSolverWorker(){
  const objectUrl=__forgeSolverWorkerObjectUrl();
  return new Worker(objectUrl);
}
`;
}

/* The build is the only place a regression here can be caught. A revoked object URL is
 * indistinguishable from a live one until a Worker silently fails to load, and a construction path
 * that fetches a script the build never emits only shows up as a 404 on a page whose whole point is
 * that the solver is inlined. Both degrade solving to the main thread for the rest of the session.
 * So every rule below is a count over the whole emitted app rather than a match on a chosen name:
 * an evasion written with a different identifier, script name, or spacing has to fail the same
 * check the obvious spelling fails.
 *
 * A whole-app URL.createObjectURL count cannot express the payload rule, because the recovery
 * download and the forge-build.json export legitimately create their own object URLs. Counting
 * references to the payload constant does, and is blind to how the Blob call is written.
 *
 * The generated memo and factory bytes are not covered here — they are pinned byte-exactly by
 * test/static-asset-build.cjs, which compares both against literals. */
function assertSolverWorkerBootstrap(app) {
  const constructions = countMatches(app, WORKER_CONSTRUCTION);
  if (constructions !== 1) {
    throw new Error(`The app must construct Workers at exactly one site, found ${constructions}`);
  }
  const payloadRefs = countOccurrences(app, WORKER_PAYLOAD_SOURCE);
  if (payloadRefs !== 2) {
    throw new Error(`The app must build the solver Worker payload into exactly one object URL, found ${payloadRefs - 1}`);
  }
  const accessorCallers = countOccurrences(app, WORKER_URL_ACCESSOR) - 1;
  if (accessorCallers !== 1) {
    throw new Error(`The shared solver Worker object URL must have exactly one caller, found ${accessorCallers}`);
  }
  // Ahead of the reference count on purpose: losing the guard also drops a reference, and the
  // specific failure is the more useful one to report.
  if (!app.includes(WORKER_URL_MEMO_GUARD)) {
    throw new Error("The shared solver Worker object URL lost its page-lifetime memo guard");
  }
  // Declaration, memo guard, assignment, return: reaching the URL by any other name is how a revoke
  // or a second wrapper gets at it.
  const memoRefs = countOccurrences(app, WORKER_URL_MEMO);
  if (memoRefs !== 4) {
    throw new Error(`The shared solver Worker object URL must stay confined to its accessor, found ${memoRefs} references`);
  }
  if (/__forgeRelease/.test(app)) {
    throw new Error("The app reintroduced a per-Worker solver Worker URL release hook");
  }
}

/* N1: every solver Worker, pooled or not, is constructed through the one factory seam the build
 * rewrites. Counted over the whole app, not over solve-service.js, because a second call site is a
 * second construction path whichever page script holds it. A leading dot is deliberately not
 * excluded: a member call through an alias object constructs exactly as directly. */
function assertSingleConstructionPath(app) {
  const callSites = countMatches(app, WORKER_FACTORY_CALL);
  if (callSites !== 1) {
    throw new Error(`The app must construct Workers at exactly one workerFactory() call site, found ${callSites}`);
  }
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
  app = replaceExactly(app, "assets/speed.jpg", assetUrls.speed, 1, "speed tooltip image");
  assertSingleConstructionPath(app);
  assertSolverWorkerBootstrap(app);
  if (/importScripts\s*\(/.test(app)) throw new Error("The app still contains a network-importing Worker");
  if (WORKER_SCRIPT_URL.test(app)) throw new Error("The app still references a Worker URL");
  if (/assets\/speed\.jpg/.test(app)) throw new Error("The app still references the unhashed speed image");
  if (ROOT_RELATIVE_OWNED_URL.test(app)) throw new Error("The app contains a root-relative owned asset URL");
  if (ANALYTICS_SIGNATURE.test(app)) throw new Error("The app contains a Vercel Analytics signature");
  return Buffer.from(app);
}

function buildIndex(sourceRoot, urls) {
  let html = readText(path.join(sourceRoot, "index.html"));
  // Out of the hashed graph on purpose: a page too stale to load its own bundle can only be
  // rescued by a URL that survives the release it was cut from. Flattened to the release root
  // so it keeps the closed-graph assertion below honest about js/, css/ and assets/.
  html = replaceExactly(html, "js/" + BOOT_SCRIPT, BOOT_SCRIPT, 1, "recovery boot script");
  html = replaceExactly(html, "assets/favicon.png", urls.favicon, 2, "favicon references");
  html = replaceExactly(
    html,
    "css/styles.css?v=20260801-mined-resources-v2",
    urls.styles,
    1,
    "stylesheet reference"
  );
  html = replaceExactly(html, "assets/dupe.jpg", urls.dupe, 1, "dupe tooltip image");
  html = replaceExactly(html, "worker-src 'self';", "worker-src 'self' blob:;", 1, "HTML Worker CSP");

  const sourceTags = PAGE_SCRIPTS.map(file => `<script src="js/${file}"></script>`).join("\n");
  html = replaceExactly(html, sourceTags, `<script src="${urls.app}"></script>`, 1, "page script block");

  if (/(?:src|href)=["'](?:js\/|css\/|assets\/)/.test(html)) {
    throw new Error("Generated HTML still references unhashed local assets");
  }
  if (/assets\/(?:dupe|speed)\.jpg/.test(html)) {
    throw new Error("Generated HTML still references an unhashed tooltip image");
  }
  if (ROOT_RELATIVE_OWNED_URL.test(html)) throw new Error("Generated HTML contains a root-relative owned asset URL");
  if (ANALYTICS_SIGNATURE.test(html)) throw new Error("Generated HTML contains a Vercel Analytics signature");
  return Buffer.from(html);
}

/* Identifies a release to a tab that is already running one. The generated page is exactly
 * the right fingerprint: it names the content-hashed URL of every script, stylesheet, and
 * image the release loads, so anything a reader would need to reload for changes these bytes,
 * and a deploy that changes nothing they load leaves them alone. Hashed before the stamp is
 * written back into the page, so the stamp can never feed into the id it is stamping.
 *
 * The stamp lives in the page rather than the bundle on purpose: the page is served
 * must-revalidate and costs nothing to rotate, while stamping the bundle would give every
 * CSS-only release a new app URL and re-download the whole of it for no reason. */
function computeBuildId(index) {
  return sha16(index);
}

function stampBuildId(index, buildId) {
  return Buffer.from(replaceExactly(
    index.toString("utf8"),
    BUILD_STAMP_PLACEHOLDER,
    buildId,
    1,
    "build id stamp"
  ));
}

/* Deliberately not content-addressed: this is the one stable URL an old tab already knows
 * how to ask for, so its name must survive every release. */
/* The newest entry in js/changelog.js names the release. It is read out of the source rather than
 * kept in a second place, so the notes the page shows and the name version.json hands an open tab
 * cannot drift apart. A source tree whose changelog has no readable version still builds — the
 * field is simply absent and the notice falls back to naming no version at all. */
function readReleaseVersion(source) {
  const match = readText(path.join(source, "js", "changelog.js")).match(/version\s*:\s*"([0-9]{4}\.[0-9]{2}\.[0-9]{2}(?:\.[0-9]+)?)"/);
  return match ? match[1] : "";
}

function buildVersionFile(buildId, version) {
  const payload = version ? { build: buildId, version } : { build: buildId };
  return Buffer.from(`${JSON.stringify(payload)}\n`);
}

function verifyStage(stageRoot, buildId) {
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
  if (!html.includes(`static/${appFiles[0]}`)) throw new Error("Generated HTML does not load the emitted app bundle");

  // The recovery script only catches the bundle's load failure if the browser has already run
  // it by the time that failure fires, and it can only be fetched at all if it shipped.
  if (!fs.existsSync(path.join(stageRoot, BOOT_SCRIPT))) throw new Error(`The release is missing ${BOOT_SCRIPT}`);
  const bootAt = html.indexOf(`src="${BOOT_SCRIPT}"`);
  if (bootAt < 0) throw new Error(`Generated HTML does not load ${BOOT_SCRIPT}`);
  if (bootAt > html.indexOf(`static/${appFiles[0]}`)) {
    throw new Error(`Generated HTML loads ${BOOT_SCRIPT} after the bundle it recovers from`);
  }

  // An unstamped page or a version file that disagrees with it would tell every open tab
  // either that nothing ever ships or that a reload is due on every single check.
  if (html.includes(BUILD_STAMP_PLACEHOLDER)) throw new Error("Generated HTML still carries the build id placeholder");
  if (!html.includes(`content="${buildId}"`)) throw new Error("Generated HTML is not stamped with the emitted build id");
  let version;
  try {
    version = JSON.parse(readText(path.join(stageRoot, VERSION_FILE)));
  } catch (error) {
    throw new Error(`${VERSION_FILE} is not readable JSON: ${error.message}`);
  }
  if (version.build !== buildId) throw new Error(`${VERSION_FILE} does not carry the stamped build id`);
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
    const appUrl = emitHashed(stage, "app", "js", buildApp(source, imageUrls));
    const unstampedIndex = buildIndex(source, {
      app: appUrl,
      styles: stylesUrl,
      favicon: imageUrls.favicon,
      dupe: imageUrls.dupe,
    });
    const buildId = computeBuildId(unstampedIndex);
    write(stage, "index.html", stampBuildId(unstampedIndex, buildId));
    write(stage, VERSION_FILE, buildVersionFile(buildId, readReleaseVersion(source)));
    write(stage, BOOT_SCRIPT, read(path.join(source, "js", BOOT_SCRIPT)));
    write(stage, "js/solver.worker.js", read(path.join(source, "js", "solver.worker.js")));
    const legacyV2 = read(path.join(source, "compat", "solver.worker.v2.js"));
    if (sha256(legacyV2) !== LEGACY_V2_SHA256) {
      throw new Error("compat/solver.worker.v2.js changed, but its immutable URL is a permanent browser contract");
    }
    write(stage, "js/solver.worker.v2.js", legacyV2);

    verifyStage(stage, buildId);
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

module.exports = { buildStaticSite, buildWorkerPayload, assertSolverWorkerBootstrap };
