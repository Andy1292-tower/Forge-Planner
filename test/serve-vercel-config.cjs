"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const HEADER_ROUTES = (CONFIG.headers || []).map(route => ({
  matcher: new RegExp(`^${route.source}$`),
  headers: route.headers || [],
}));

function applyConfiguredHeaders(response, pathname) {
  HEADER_ROUTES.forEach(route => {
    if (!route.matcher.test(pathname)) return;
    route.headers.forEach(header => response.setHeader(header.key, header.value));
  });
}

function resolveRequestPath(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const absolute = path.resolve(ROOT, relative);
  return absolute === ROOT || absolute.startsWith(ROOT + path.sep) ? absolute : null;
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  applyConfiguredHeaders(response, pathname);
  if (!response.hasHeader("Cache-Control")) response.setHeader("Cache-Control", "no-store");
  const file = resolveRequestPath(pathname);
  if (!file) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(file, (statError, stats) => {
    const target = !statError && stats.isDirectory() ? path.join(file, "index.html") : file;
    fs.readFile(target, (readError, bytes) => {
      if (readError) {
        response.writeHead(readError.code === "ENOENT" ? 404 : 500).end(readError.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }
      response.setHeader("Content-Type", MIME[path.extname(target).toLowerCase()] || "application/octet-stream");
      response.writeHead(200);
      if (request.method === "HEAD") response.end();
      else response.end(bytes);
    });
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Serving Forge Planner with vercel.json headers at http://${HOST}:${PORT}\n`);
});

function stop() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
