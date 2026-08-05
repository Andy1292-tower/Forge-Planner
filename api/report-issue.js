"use strict";

/* Anonymous issue intake.
 *
 * GET  issues a short-lived signed submit token.
 * POST validates a submission and opens a labeled GitHub issue.
 *
 * The submitter needs no GitHub account, so this endpoint is the only unauthenticated
 * write path into the public tracker. Everything below exists to keep that path narrow:
 * the token proves the form was actually loaded, the caps bound what one request can
 * write, and mention neutralization keeps issue text from notifying or cross-linking
 * anyone. None of it is a substitute for reading what arrives; issues land labeled
 * `community` precisely so unverified input stays identifiable.
 */

const crypto = require("crypto");

const REPO = process.env.GITHUB_REPO || "Andy1292-tower/Forge-Planner";
const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";
const USER_AGENT = "forge-planner-issue-intake";

const TOKEN_VERSION = "v1";
// A human opens the form, reads it, and types. Under three seconds is a script, and a
// token older than two hours is a stale tab worth re-fetching rather than trusting.
const MIN_TOKEN_AGE_MS = 3000;
const MAX_TOKEN_AGE_MS = 2 * 60 * 60 * 1000;

const MAX_BODY_BYTES = 16 * 1024;
const LIMITS = {
  title: { min: 5, max: 120 },
  body: { min: 20, max: 4000 },
  contact: { min: 0, max: 120 },
};

const KINDS = {
  bug: { label: "bug", heading: "Bug report" },
  project: { label: "catalog", heading: "Project catalog submission" },
  feature: { label: "enhancement", heading: "Feature request" },
};

const COMMUNITY_LABEL = "community";
const GITHUB_TIMEOUT_MS = 10000;

/* Per-instance only. Vercel runs several instances and recycles them, so this thins
 * out floods from one source rather than enforcing a real global quota. It is the
 * cheap layer; the durable protection is that everything lands labeled and reviewable. */
const RATE_LIMITS = [
  { windowMs: 10 * 60 * 1000, max: 3 },
  { windowMs: 24 * 60 * 60 * 1000, max: 10 },
];
const INSTANCE_HOURLY_MAX = 60;
const seenSubmissions = new Map();
let instanceWindowStart = 0;
let instanceWindowCount = 0;

/* Two ways to authenticate to GitHub, preferred first:
 *
 * 1. A GitHub App. Issues are authored by the app's bot identity rather than a person,
 *    and each request mints an installation token that expires within the hour, so no
 *    long-lived credential sits in the environment.
 * 2. A personal access token. Simpler to set up, but issues are authored by whoever owns
 *    it, and it is long-lived until it expires.
 *
 * Both produce a bearer token for the same issue-creation call. */

function appPrivateKey() {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) return null;
  // A PEM pasted through a shell usually arrives with its newlines escaped, and base64 is
  // the common way to sidestep multi-line values entirely. Accept all three spellings.
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return decoded.includes("-----BEGIN") ? decoded : null;
  } catch (error) {
    return null;
  }
}

function usingApp() {
  return Boolean(process.env.GITHUB_APP_ID && appPrivateKey());
}

function credentialConfigured() {
  return usingApp() || Boolean(process.env.GITHUB_TOKEN);
}

function submitSecret() {
  if (process.env.FORGE_SUBMIT_SECRET) return process.env.FORGE_SUBMIT_SECRET;
  /* Derived so a working deployment needs no second secret. Whichever GitHub credential
   * is configured is already required, never leaves the server, and rotating it rotates
   * this — which invalidates open forms, and reporters simply reload. */
  const material = process.env.GITHUB_TOKEN || appPrivateKey();
  if (!material) return null;
  return crypto.createHmac("sha256", material).update("forge-planner-submit-token-v1").digest("hex");
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function appJwt(now) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const seconds = Math.floor(now / 1000);
  // GitHub rejects a JWT issued in the future, so back-date `iat` to absorb clock skew.
  const claims = { iat: seconds - 60, exp: seconds + 540, iss: process.env.GITHUB_APP_ID };
  const payload = base64url(JSON.stringify(claims));
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).sign(appPrivateKey());
  return `${header}.${payload}.${base64url(signature)}`;
}

let installationId = null;
let installationToken = null;

async function appToken(now) {
  // Installation tokens last an hour; reuse one until it is close enough to expiry that a
  // slow request could outlive it.
  if (installationToken && installationToken.expiresAt - now > 5 * 60 * 1000) {
    return installationToken.value;
  }
  const headers = {
    Authorization: `Bearer ${appJwt(now)}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  if (!installationId) {
    // Discovered rather than configured, so installing the app is the only setup step.
    const found = await fetch(`${GITHUB_API}/repos/${REPO}/installation`, { headers });
    if (!found.ok) throw new Error(`installation lookup returned ${found.status}`);
    installationId = (await found.json()).id;
  }
  const minted = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers,
  });
  if (!minted.ok) {
    // A revoked or reinstalled app changes the id; forget it so the next try re-discovers.
    installationId = null;
    throw new Error(`installation token returned ${minted.status}`);
  }
  const issued = await minted.json();
  installationToken = { value: issued.token, expiresAt: Date.parse(issued.expires_at) };
  return installationToken.value;
}

async function githubCredential(now) {
  return usingApp() ? appToken(now) : process.env.GITHUB_TOKEN;
}

function sign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function issueToken(secret, now) {
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = `${TOKEN_VERSION}.${now}.${nonce}`;
  return `${payload}.${sign(secret, payload)}`;
}

function verifyToken(secret, token, now) {
  if (typeof token !== "string" || token.length > 256) return "missing";
  const parts = token.split(".");
  if (parts.length !== 4) return "malformed";
  const [version, issuedAt, nonce, signature] = parts;
  if (version !== TOKEN_VERSION) return "malformed";
  if (!/^\d{1,15}$/.test(issuedAt) || !/^[0-9a-f]{24}$/.test(nonce)) return "malformed";
  if (!timingSafeEqual(signature, sign(secret, `${version}.${issuedAt}.${nonce}`))) return "forged";
  const age = now - Number(issuedAt);
  if (age < MIN_TOKEN_AGE_MS) return "too-fast";
  if (age > MAX_TOKEN_AGE_MS) return "expired";
  return "ok";
}

function clientFingerprint(secret, req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = forwarded || (req.socket && req.socket.remoteAddress) || "unknown";
  /* Hashed so the rate limiter never holds a raw address, matching the project's
   * stance that visitor data is not collected. */
  return sign(secret, `rate:${address}`).slice(0, 32);
}

function rateLimited(fingerprint, now) {
  if (now - instanceWindowStart > 60 * 60 * 1000) {
    instanceWindowStart = now;
    instanceWindowCount = 0;
  }
  if (instanceWindowCount >= INSTANCE_HOURLY_MAX) return true;

  const longestWindow = RATE_LIMITS.reduce((max, limit) => Math.max(max, limit.windowMs), 0);
  for (const [key, stamps] of seenSubmissions) {
    const live = stamps.filter(stamp => now - stamp <= longestWindow);
    if (live.length) seenSubmissions.set(key, live);
    else seenSubmissions.delete(key);
  }

  const history = seenSubmissions.get(fingerprint) || [];
  for (const limit of RATE_LIMITS) {
    if (history.filter(stamp => now - stamp <= limit.windowMs).length >= limit.max) return true;
  }

  history.push(now);
  seenSubmissions.set(fingerprint, history);
  instanceWindowCount++;
  return false;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowList = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
  if (allowList.includes(origin)) return true;
  let host;
  try {
    host = new URL(origin).host;
  } catch (error) {
    return false;
  }
  return host === (req.headers["x-forwarded-host"] || req.headers.host);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("too-large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    // Control characters carry no meaning in an issue and can disguise what was written.
    // Tab and newline survive; the rest of the C0 range and DEL are dropped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    // Zero-width and bidirectional marks can hide text or reverse how it reads.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function neutralizeReferences(text) {
  /* A submitter must not be able to notify maintainers or cross-link unrelated issues
   * from text nobody has read yet. The zero-width space stops GitHub resolving the
   * reference while leaving the text readable. cleanText strips these first, so the
   * only ones present afterwards are the ones inserted here. */
  return text
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@\u200B")
    .replace(/(^|[^\w`])#(?=\d)/g, "$1#\u200B")
    .replace(/\b(https?:\/\/(?:www\.)?github\.com\/[^\s)]*\/(?:issues|pull)\/\d+)/gi, "`$1`");
}

function checkLength(field, value) {
  const limit = LIMITS[field];
  if (value.length < limit.min) return `${field}-short`;
  if (value.length > limit.max) return `${field}-long`;
  return null;
}

function validate(payload) {
  if (!payload || typeof payload !== "object") return { error: "malformed" };
  // Honeypot: a real form keeps this hidden and empty.
  if (cleanText(payload.website)) return { error: "rejected" };

  const kind = KINDS[payload.kind] ? payload.kind : null;
  if (!kind) return { error: "kind" };

  const title = cleanText(payload.title);
  const body = cleanText(payload.body);
  const contact = cleanText(payload.contact);

  for (const [field, value] of [["title", title], ["body", body], ["contact", contact]]) {
    const problem = checkLength(field, value);
    if (problem) return { error: problem };
  }
  return { kind, title, body, contact };
}

function composeIssue(submission, receivedAt) {
  const kind = KINDS[submission.kind];
  const contact = submission.contact
    ? neutralizeReferences(submission.contact)
    : "not provided";
  const body = [
    neutralizeReferences(submission.body),
    "",
    "---",
    "",
    `Submitted anonymously through the Forge Planner in-app form (${kind.heading}).`,
    "The contents above are unverified visitor input and no GitHub account was involved.",
    "",
    `Contact for follow-up: ${contact}`,
    `Received: ${new Date(receivedAt).toISOString()}`,
  ].join("\n");
  return {
    title: neutralizeReferences(submission.title),
    body,
    labels: [COMMUNITY_LABEL, kind.label],
  };
}

async function postIssue(issue, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const send = payload =>
      fetch(`${GITHUB_API}/repos/${REPO}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

    let response = await send(issue);
    if (response.status === 422) {
      /* A repository that has not been given the intake labels yet must still be able
       * to receive reports; the provenance footer survives either way. */
      const { labels, ...unlabeled } = issue;
      response = await send(unlabeled);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, status: response.status, detail: detail.slice(0, 500) };
    }
    const created = await response.json();
    return { ok: true, url: created.html_url, number: created.number };
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Tokens are single-use-ish and time-boxed; nothing here may sit in a shared cache.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(payload));
}

const MESSAGES = {
  kind: "Choose what kind of report this is.",
  "title-short": "Give the report a title of at least 5 characters.",
  "title-long": `Keep the title under ${LIMITS.title.max} characters.`,
  "body-short": "Add at least 20 characters of detail.",
  "body-long": `Keep the details under ${LIMITS.body.max} characters.`,
  "contact-long": `Keep the contact under ${LIMITS.contact.max} characters.`,
  "too-fast": "That was submitted faster than the form can be filled in. Try again.",
  expired: "This form has been open a while. Reload the page and resend.",
  forged: "This submission could not be verified. Reload the page and try again.",
  malformed: "This submission could not be read. Reload the page and try again.",
  missing: "This submission could not be verified. Reload the page and try again.",
  rejected: "This submission was rejected.",
  "too-large": "That report is too large to send.",
};

function failure(res, status, error) {
  sendJson(res, status, { ok: false, error, message: MESSAGES[error] || MESSAGES.rejected });
}

module.exports = async function handler(req, res) {
  const now = Date.now();
  const secret = submitSecret();

  if (!secret || !credentialConfigured()) {
    // Configuration is a server problem; say so plainly without naming what is missing.
    console.error("report-issue: no GitHub credential is configured");
    return sendJson(res, 503, {
      ok: false,
      error: "unconfigured",
      message: "Issue submission is not available right now.",
    });
  }

  if (req.method === "GET") {
    return sendJson(res, 200, { token: issueToken(secret, now), minWaitMs: MIN_TOKEN_AGE_MS });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return failure(res, 405, "rejected");
  }

  if (!sameOrigin(req)) return failure(res, 403, "rejected");

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return failure(res, error.message === "too-large" ? 413 : 400, error.message === "too-large" ? "too-large" : "malformed");
  }

  const tokenState = verifyToken(secret, payload.token, now);
  if (tokenState !== "ok") return failure(res, tokenState === "too-fast" ? 429 : 400, tokenState);

  const submission = validate(payload);
  if (submission.error) return failure(res, 400, submission.error);

  if (rateLimited(clientFingerprint(secret, req), now)) {
    return sendJson(res, 429, {
      ok: false,
      error: "rate-limited",
      message: "A few reports have already come from here. Try again later.",
    });
  }

  let result;
  try {
    // Minting an app token can fail on its own; that belongs in the upstream path below.
    result = await postIssue(composeIssue(submission, now), await githubCredential(now));
  } catch (error) {
    console.error("report-issue: GitHub request failed", error && error.message);
    return sendJson(res, 502, {
      ok: false,
      error: "upstream",
      message: "GitHub could not be reached. Try again shortly.",
    });
  }

  if (!result.ok) {
    // Upstream detail stays in the server log; the client never sees token or repo state.
    console.error(`report-issue: GitHub responded ${result.status}: ${result.detail}`);
    return sendJson(res, 502, {
      ok: false,
      error: "upstream",
      message: "GitHub rejected the report. Try again shortly.",
    });
  }

  return sendJson(res, 201, { ok: true, url: result.url, number: result.number });
};

module.exports.internals = {
  appJwt,
  appPrivateKey,
  cleanText,
  clientFingerprint,
  composeIssue,
  credentialConfigured,
  githubCredential,
  issueToken,
  usingApp,
  neutralizeReferences,
  rateLimited,
  sameOrigin,
  validate,
  verifyToken,
  LIMITS,
  MIN_TOKEN_AGE_MS,
  MAX_TOKEN_AGE_MS,
};
