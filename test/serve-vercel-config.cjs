"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const DEFAULT_MOUNTS = ["", "/Forge-Planner"];
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function configuredHeaderRoutes(projectRoot) {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, "vercel.json"), "utf8"));
  return (config.headers || []).map(route => ({
    matcher: new RegExp(`^${route.source}$`),
    headers: route.headers || [],
  }));
}

function normalizeMounts(mounts) {
  const normalized = [...new Set((mounts || DEFAULT_MOUNTS).map(mount => {
    if (!mount || mount === "/") return "";
    return `/${String(mount).replace(/^\/+|\/+$/g, "")}`;
  }))];
  if (!normalized.includes("")) normalized.push("");
  return normalized.sort((a, b) => b.length - a.length);
}

function logicalRequestPath(pathname, mounts) {
  for (const mountPath of mounts) {
    if (!mountPath) return { mountPath, logicalPathname: pathname };
    if (pathname === mountPath || pathname.startsWith(`${mountPath}/`)) {
      return { mountPath, logicalPathname: pathname.slice(mountPath.length) || "/" };
    }
  }
  return null;
}

function requestCountScope(request) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === "forge-test-session" && value.length) return value.join("=");
  }
  return "shared";
}

function validatedStaticRoot(staticRoot) {
  const resolved = path.resolve(staticRoot);
  const real = fs.realpathSync(resolved);
  if (!fs.statSync(real).isDirectory()) throw new Error(`Static root is not a directory: ${resolved}`);
  return real;
}

function isContained(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function strongEtag(bytes) {
  return `"${crypto.createHash("sha256").update(bytes).digest("hex")}"`;
}

function ifNoneMatchMatches(header, currentEtag) {
  if (header == null) return false;
  return String(header).split(",").some(value => {
    const candidate = value.trim();
    if (candidate === "*") return true;
    return candidate.replace(/^W\//i, "") === currentEtag;
  });
}

function ifModifiedSinceMatches(header, mtimeMs) {
  if (header == null) return false;
  const since = Date.parse(String(header));
  if (!Number.isFinite(since)) return false;
  return Math.floor(mtimeMs / 1000) <= Math.floor(since / 1000);
}

function createStaticServer({
  staticRoot = PROJECT_ROOT,
  projectRoot = PROJECT_ROOT,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  mounts = DEFAULT_MOUNTS,
  enableRequestMetrics = false,
} = {}) {
  const headerRoutes = configuredHeaderRoutes(path.resolve(projectRoot));
  const recognizedMounts = normalizeMounts(mounts);
  const requestCounts = Object.create(null);
  const requestLogs = Object.create(null);
  let requestSequence = 0;
  let activeStaticRoot = validatedStaticRoot(staticRoot);

  function applyConfiguredHeaders(response, logicalPathname) {
    headerRoutes.forEach(route => {
      if (!route.matcher.test(logicalPathname)) return;
      route.headers.forEach(header => response.setHeader(header.key, header.value));
    });
  }

  function resolveRequestPath(logicalPathname) {
    const relative = logicalPathname === "/" ? "index.html" : logicalPathname.replace(/^\/+/, "");
    const root = activeStaticRoot;
    const absolute = path.resolve(root, relative);
    return isContained(root, absolute) ? { root, absolute } : null;
  }

  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }

    const countScope = requestCountScope(request);
    const scopedCounts = requestCounts[countScope] || (requestCounts[countScope] = Object.create(null));
    if (enableRequestMetrics && pathname === "/__test/request-counts") {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.writeHead(200).end(JSON.stringify(scopedCounts));
      return;
    }
    if (enableRequestMetrics && pathname === "/__test/request-log") {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.writeHead(200).end(JSON.stringify((requestLogs[countScope] || []).map(entry => ({ ...entry }))));
      return;
    }
    scopedCounts[pathname] = (scopedCounts[pathname] || 0) + 1;

    const logical = logicalRequestPath(pathname, recognizedMounts);
    if (enableRequestMetrics) {
      const scopedLog = requestLogs[countScope] || (requestLogs[countScope] = []);
      const entry = {
        sequence: ++requestSequence,
        method: request.method,
        pathname,
        logicalPathname: logical && logical.logicalPathname,
        mountPath: logical && logical.mountPath,
        status: null,
      };
      scopedLog.push(entry);
      response.once("finish", () => { entry.status = response.statusCode; });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.setHeader("Content-Length", "0");
      response.writeHead(405).end();
      return;
    }

    if (recognizedMounts.some(mountPath => mountPath && pathname === mountPath)) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Location", `${pathname}/`);
      response.setHeader("Content-Length", "0");
      response.writeHead(308).end();
      return;
    }

    if (!logical) {
      response.writeHead(404).end("Not found");
      return;
    }
    applyConfiguredHeaders(response, logical.logicalPathname);
    if (!response.hasHeader("Cache-Control")) response.setHeader("Cache-Control", "no-store");
    const resolved = resolveRequestPath(logical.logicalPathname);
    if (!resolved) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    fs.stat(resolved.absolute, (statError, stats) => {
      const target = !statError && stats.isDirectory() ? path.join(resolved.absolute, "index.html") : resolved.absolute;
      fs.realpath(target, (realError, realTarget) => {
        if (realError) {
          response.writeHead(realError.code === "ENOENT" ? 404 : 500)
            .end(realError.code === "ENOENT" ? "Not found" : "Server error");
          return;
        }
        if (!isContained(resolved.root, realTarget)) {
          response.writeHead(403).end("Forbidden");
          return;
        }
        fs.stat(realTarget, (targetStatError, targetStats) => {
          if (targetStatError) {
            response.writeHead(targetStatError.code === "ENOENT" ? 404 : 500)
              .end(targetStatError.code === "ENOENT" ? "Not found" : "Server error");
            return;
          }
          fs.readFile(realTarget, (readError, bytes) => {
            if (readError) {
              response.writeHead(readError.code === "ENOENT" ? 404 : 500)
                .end(readError.code === "ENOENT" ? "Not found" : "Server error");
              return;
            }
            const etag = strongEtag(bytes);
            response.setHeader("Content-Type", MIME[path.extname(realTarget).toLowerCase()] || "application/octet-stream");
            response.setHeader("ETag", etag);
            response.setHeader("Last-Modified", targetStats.mtime.toUTCString());
            const ifNoneMatch = request.headers["if-none-match"];
            const notModified = ifNoneMatch !== undefined
              ? ifNoneMatchMatches(ifNoneMatch, etag)
              : ifModifiedSinceMatches(request.headers["if-modified-since"], targetStats.mtimeMs);
            if (notModified) {
              response.writeHead(304).end();
              return;
            }
            response.setHeader("Content-Length", String(bytes.length));
            response.writeHead(200);
            if (request.method === "HEAD") response.end();
            else response.end(bytes);
          });
        });
      });
    });
  });

  function start() {
    if (server.listening) return Promise.reject(new Error("Static server is already listening"));
    return new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        const address = server.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        const origin = `http://${host}:${actualPort}`;
        resolve({ host, port: actualPort, origin, url: origin });
      });
    });
  }

  function close() {
    if (!server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  function setStaticRoot(nextRoot) {
    const next = validatedStaticRoot(nextRoot);
    const previousRoot = activeStaticRoot;
    activeStaticRoot = next;
    return { previousRoot, staticRoot: activeStaticRoot };
  }

  function requestMetrics(scope = "shared") {
    return {
      counts: { ...(requestCounts[scope] || {}) },
      log: (requestLogs[scope] || []).map(entry => ({ ...entry })),
    };
  }

  return { server, start, setStaticRoot, close, requestMetrics };
}

async function runCli() {
  const staticRoot = path.resolve(PROJECT_ROOT, process.env.STATIC_ROOT || ".");
  const controller = createStaticServer({
    staticRoot,
    host: process.env.HOST || DEFAULT_HOST,
    port: Number(process.env.PORT || DEFAULT_PORT),
    enableRequestMetrics: process.env.ENABLE_REQUEST_METRICS === "1",
  });
  const address = await controller.start();
  process.stdout.write(`Serving Forge Planner from ${staticRoot} with vercel.json headers at ${address.origin}\n`);
  const stop = async () => {
    await controller.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

module.exports = { createStaticServer };

if (require.main === module) {
  runCli().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
