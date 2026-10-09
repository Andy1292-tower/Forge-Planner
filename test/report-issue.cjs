"use strict";
/* Anonymous issue intake: the submit-token contract, the input caps, and the two paths
 * offered in the page. This endpoint is the only unauthenticated write into the public
 * tracker, so each rejection below is a rule that must not quietly regress. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || "test-github-token";
process.env.FORGE_SUBMIT_SECRET = "test-submit-secret";

const root = path.join(__dirname, "..");
const endpoint = require(path.join(root, "api", "report-issue.js"));
const internals = endpoint.internals;
const SECRET = process.env.FORGE_SUBMIT_SECRET;

const NOW = 1770000000000;
const goodBody = "The solver hangs when every line is set to 16384 and I press solve.";
const goodSubmission = { kind: "bug", title: "Solver hangs", body: goodBody };
const LATEGAME_SAVE = JSON.parse(
  fs.readFileSync(path.join(root, "test", "perf", "fixtures", "lategame-7line.json"), "utf8")
);
// GitHub refuses an issue body longer than this.
const GITHUB_BODY_MAX = 65536;

function freshToken(at = NOW) {
  return internals.issueToken(SECRET, at);
}

// The fenced save block inside a composed issue body, or null when there is none.
function savedBlock(body) {
  const match = body.match(/^(`{3,})json\n([\s\S]*?)\n\1$/m);
  return match ? { fence: match[1], json: match[2] } : null;
}

// A save whose serialized form is exactly `chars` characters long.
function saveOfLength(chars) {
  const save = { schemaVersion: 9, lines: [], pad: "" };
  save.pad = "x".repeat(chars - internals.serializeSave(save).length);
  assert.strictEqual(internals.serializeSave(save).length, chars);
  return save;
}

/* ---------- submit token ---------- */

function tokenContract() {
  const token = freshToken();
  assert.strictEqual(internals.verifyToken(SECRET, token, NOW + 5000), "ok");

  // Faster than a person can read and type the form.
  assert.strictEqual(internals.verifyToken(SECRET, token, NOW + 100), "too-fast");
  assert.strictEqual(
    internals.verifyToken(SECRET, token, NOW + internals.MIN_TOKEN_AGE_MS - 1),
    "too-fast"
  );
  assert.strictEqual(internals.verifyToken(SECRET, token, NOW + internals.MIN_TOKEN_AGE_MS), "ok");

  // A tab left open overnight must re-fetch rather than be trusted.
  assert.strictEqual(
    internals.verifyToken(SECRET, token, NOW + internals.MAX_TOKEN_AGE_MS + 1),
    "expired"
  );

  assert.strictEqual(internals.verifyToken("another-secret", token, NOW + 5000), "forged");
  // Re-signing a shifted timestamp with the wrong key must not buy a fresh window.
  const parts = token.split(".");
  const forged = [parts[0], String(NOW + 60000), parts[2], parts[3]].join(".");
  assert.strictEqual(internals.verifyToken(SECRET, forged, NOW + 65000), "forged");

  for (const junk of ["", "nope", "v1.a.b.c", "v2." + parts.slice(1).join("."), "x".repeat(300)]) {
    assert.notStrictEqual(internals.verifyToken(SECRET, junk, NOW + 5000), "ok", `accepted ${junk}`);
  }
  assert.strictEqual(internals.verifyToken(SECRET, undefined, NOW + 5000), "missing");
}

/* ---------- input caps ---------- */

function validationContract() {
  assert.strictEqual(internals.validate(goodSubmission).kind, "bug");

  // The honeypot is hidden from people, so anything in it is automation.
  assert.strictEqual(
    internals.validate({ ...goodSubmission, website: "http://spam" }).error,
    "rejected"
  );

  assert.strictEqual(internals.validate({ ...goodSubmission, kind: "arbitrary" }).error, "kind");
  assert.strictEqual(internals.validate({ ...goodSubmission, title: "abc" }).error, "title-short");
  assert.strictEqual(
    internals.validate({ ...goodSubmission, title: "t".repeat(internals.LIMITS.title.max + 1) }).error,
    "title-long"
  );
  assert.strictEqual(internals.validate({ ...goodSubmission, body: "short" }).error, "body-short");
  assert.strictEqual(
    internals.validate({ ...goodSubmission, body: "b".repeat(internals.LIMITS.body.max + 1) }).error,
    "body-long"
  );
  assert.strictEqual(
    internals.validate({ ...goodSubmission, contact: "c".repeat(internals.LIMITS.contact.max + 1) }).error,
    "contact-long"
  );
  assert.strictEqual(internals.validate(null).error, "malformed");

  // Whitespace must not be a way past the minimums.
  assert.strictEqual(internals.validate({ ...goodSubmission, title: "  a  " }).error, "title-short");
}

function sanitizerContract() {
  // Zero-width joiners, a right-to-left override, NUL, and DEL all disappear.
  const hidden = internals.cleanText("visible\u200Btext\u202Ereversed\u0000\u007F");
  assert.ok(
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/.test(hidden),
    `control characters survived: ${JSON.stringify(hidden)}`
  );
  assert.strictEqual(hidden, "visibletextreversed");
  // Real formatting survives.
  assert.strictEqual(internals.cleanText("a\r\nb\tc"), "a\nb\tc");
  assert.strictEqual(internals.cleanText("a\n\n\n\n\nb"), "a\n\nb");

  /* A submitter must not be able to notify a maintainer or cross-link an unrelated
   * issue from text nobody has read yet. */
  const defused = internals.neutralizeReferences("cc @octocat about #42");
  assert.ok(!/(^|[^\w`])@[A-Za-z]/.test(defused), `mention still resolves: ${JSON.stringify(defused)}`);
  assert.ok(!/(^|[^\w`])#\d/.test(defused), `issue ref still resolves: ${JSON.stringify(defused)}`);
  assert.ok(defused.includes("octocat") && defused.includes("42"), "text became unreadable");
  assert.ok(
    internals.neutralizeReferences("https://github.com/a/b/issues/9").startsWith("`"),
    "issue link was not defused"
  );
  // An email address is not a mention and must survive intact.
  assert.ok(internals.neutralizeReferences("me@example.com").includes("me@example.com"));
}

function issueBodyContract() {
  const composed = internals.composeIssue(
    { kind: "project", title: "Add @thing", body: "costs for #5", contact: "" },
    NOW
  );
  assert.deepStrictEqual(composed.labels, ["community", "catalog"]);
  // Anyone reading the tracker must be able to tell this was unverified and account-free.
  assert.ok(composed.body.includes("Submitted anonymously"), "provenance footer missing");
  assert.ok(composed.body.includes("unverified visitor input"), "unverified notice missing");
  assert.ok(composed.body.includes("not provided"), "absent contact not stated");
  assert.ok(!/(^|[^\w`])@[A-Za-z]/.test(composed.title), "title mention still resolves");

  const withContact = internals.composeIssue({ ...goodSubmission, contact: "me@example.com" }, NOW);
  assert.ok(withContact.body.includes("me@example.com"));
  assert.deepStrictEqual(withContact.labels, ["community", "bug"]);
}

/* ---------- attached save ---------- */

function saveValidationContract() {
  const save = { schemaVersion: 9, lines: [{ product: "Bits" }], projects: [] };
  const kept = internals.validate({ ...goodSubmission, save });
  assert.strictEqual(kept.error, undefined);
  assert.deepStrictEqual(JSON.parse(kept.save), save, "the save did not survive validation intact");

  // Only bug reports carry one; catalog submissions and feature requests stay text-only.
  for (const kind of ["project", "feature"]) {
    assert.strictEqual(internals.validate({ ...goodSubmission, kind, save }).save, null, `${kind} kept a save`);
  }

  /* The field carries a save, not free text. Anything shaped otherwise is dropped, and the
   * report it came with still goes through. */
  for (const [label, junk] of [
    ["a string", "free text posted as a save"],
    ["an array", [save]],
    ["no schemaVersion", { lines: [] }],
    ["a text schemaVersion", { schemaVersion: "9", lines: [] }],
    ["no lines", { schemaVersion: 9 }],
    ["lines that are not a list", { schemaVersion: 9, lines: "x" }],
  ]) {
    const result = internals.validate({ ...goodSubmission, save: junk });
    assert.strictEqual(result.error, undefined, `${label} rejected the whole report`);
    assert.strictEqual(result.save, null, `${label} was kept`);
  }

  // Over the cap the save is dropped, not the report.
  const oversized = internals.validate({
    ...goodSubmission,
    save: { schemaVersion: 9, lines: [], pad: "x".repeat(internals.LIMITS.save.max) },
  });
  assert.strictEqual(oversized.error, undefined);
  assert.strictEqual(oversized.save, null, "an oversized save was kept");
  assert.ok(internals.validate({ ...goodSubmission, save: saveOfLength(internals.LIMITS.save.max) }).save);

  // The late-game reference save fits.
  assert.ok(internals.validate({ ...goodSubmission, save: LATEGAME_SAVE }).save, "the late-game save was dropped");

  /* Characters that hide or reverse text, and backticks that could close the code fence,
   * are written as escapes: the block reads as what it holds and parses back unchanged. */
  const sneaky = { schemaVersion: 9, lines: [], name: "safe\u202Eevil\u200Bjoin\u2028line ``````", "`key`": 1 };
  const escaped = internals.serializeSave(sneaky);
  assert.ok(
    !/[`\u200B-\u200F\u202A-\u202E\u2028\u2029\u2066-\u2069\uFEFF]/.test(escaped),
    `hidden characters or backticks survived: ${escaped}`
  );
  assert.deepStrictEqual(JSON.parse(escaped), sneaky);
}

function saveIssueContract() {
  const save = { schemaVersion: 9, lines: [], note: "cc @octocat about #42", fence: "``````\n</details>" };
  const composed = internals.composeIssue(internals.validate({ ...goodSubmission, save }), NOW);
  const block = savedBlock(composed.body);
  assert.ok(block, "no save block in a bug report");
  assert.strictEqual(block.fence, "```");
  assert.deepStrictEqual(JSON.parse(block.json), save, "the posted save does not parse back to what was sent");
  // Collapsed, so the report text stays readable above a save of any size.
  assert.match(composed.body, /<details>\n<summary>Attached save \(\d+\.\d KB\)<\/summary>\n\n```json\n/);
  // The save is unverified input too, so it sits above the footer that says so.
  const at = text => composed.body.indexOf(text);
  assert.ok(at(goodBody) < at("<details>"), "the save comes before the report text");
  assert.ok(at("</details>") < at("Submitted anonymously"), "the save comes after the provenance footer");

  // A bug report without one says so, so nobody goes looking for it.
  const without = internals.composeIssue(internals.validate(goodSubmission), NOW);
  assert.ok(without.body.includes("No save attached."), "a missing save is not stated");
  assert.ok(!without.body.includes("<details>"));

  const project = internals.composeIssue(internals.validate({ ...goodSubmission, kind: "project", save }), NOW);
  assert.ok(!/save/i.test(project.body), "a catalog submission mentions a save");

  /* Every field at its cap, the details doubled in places by neutralized mentions, and a save
   * at its cap: the issue must still be one GitHub accepts. */
  const worst = internals.composeIssue(
    internals.validate({
      kind: "bug",
      title: "@a".repeat(internals.LIMITS.title.max / 2),
      body: "@a".repeat(internals.LIMITS.body.max / 2),
      contact: "@a".repeat(internals.LIMITS.contact.max / 2),
      save: saveOfLength(internals.LIMITS.save.max),
    }),
    NOW
  );
  assert.ok(savedBlock(worst.body), "a save at the cap was left out");
  assert.ok(worst.body.length <= GITHUB_BODY_MAX, `issue body is ${worst.body.length} characters`);
}

/* ---------- request gating ---------- */

function originContract() {
  const request = (origin, host) => ({ headers: { origin, host, "x-forwarded-host": host } });
  assert.ok(internals.sameOrigin(request("https://forge.example", "forge.example")));
  assert.ok(!internals.sameOrigin(request("https://evil.example", "forge.example")), "cross-origin allowed");
  // A missing Origin is a non-browser caller; browsers always send it on POST.
  assert.ok(!internals.sameOrigin({ headers: { host: "forge.example" } }), "missing origin allowed");
  assert.ok(!internals.sameOrigin(request("not a url", "forge.example")), "unparseable origin allowed");

  process.env.ALLOWED_ORIGINS = "https://preview.example";
  assert.ok(internals.sameOrigin(request("https://preview.example", "forge.example")), "allowlist ignored");
  assert.ok(!internals.sameOrigin(request("https://other.example", "forge.example")), "allowlist too broad");
  delete process.env.ALLOWED_ORIGINS;
}

function rateLimitContract() {
  const fingerprint = `test-${NOW}`;
  let at = NOW;
  for (let i = 0; i < 3; i++) {
    assert.ok(!internals.rateLimited(fingerprint, at + i * 1000), `blocked submission ${i + 1} of 3`);
  }
  assert.ok(internals.rateLimited(fingerprint, at + 4000), "fourth submission in ten minutes allowed");
  // A different reporter is unaffected by that burst.
  assert.ok(!internals.rateLimited(`${fingerprint}-other`, at + 4000), "unrelated reporter blocked");
  // The short window drains, but the daily cap still applies.
  at += 20 * 60 * 1000;
  assert.ok(!internals.rateLimited(fingerprint, at), "short window never drained");

  // Addresses are hashed rather than retained.
  const printed = internals.clientFingerprint(SECRET, { headers: { "x-forwarded-for": "203.0.113.7" } });
  assert.ok(!printed.includes("203.0.113"), "raw address kept in the rate limiter");
}

/* ---------- the handler, with GitHub stubbed ---------- */

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(text) { this.payload = JSON.parse(text); },
  };
}

function mockRequest(method, body, headers = {}) {
  const request = {
    method,
    headers: { origin: "https://forge.example", host: "forge.example", ...headers },
  };
  if (body !== undefined) request.body = body;
  return request;
}

// A request whose body arrives as a byte stream, as it does where nothing parses it first.
function streamedRequest(text, headers = {}) {
  const request = mockRequest("POST", undefined, headers);
  const bytes = Buffer.from(text, "utf8");
  request[Symbol.asyncIterator] = async function* () {
    for (let at = 0; at < bytes.length; at += 16384) yield bytes.subarray(at, at + 16384);
  };
  return request;
}

async function handlerContract() {
  const realFetch = global.fetch;
  const calls = [];
  const respondWith = outcome => {
    global.fetch = async (url, options) => {
      calls.push({ url, options, payload: JSON.parse(options.body) });
      return outcome(calls.length);
    };
  };
  const ok = () => ({
    ok: true, status: 201,
    json: async () => ({ html_url: "https://github.com/o/r/issues/7", number: 7 }),
    text: async () => "",
  });

  try {
    // A GET hands out a token and must never be cached by a shared proxy.
    const tokenRes = mockResponse();
    await endpoint(mockRequest("GET"), tokenRes);
    assert.strictEqual(tokenRes.statusCode, 200);
    assert.strictEqual(tokenRes.headers["cache-control"], "no-store");
    const token = tokenRes.payload.token;
    assert.ok(token, "no token issued");

    // A token used the instant it was issued is a script, not a person.
    respondWith(ok);
    const instant = mockResponse();
    await endpoint(mockRequest("POST", { ...goodSubmission, token }), instant);
    assert.strictEqual(instant.statusCode, 429, "a token used instantly was accepted");
    assert.strictEqual(instant.payload.error, "too-fast");
    assert.strictEqual(calls.length, 0, "instant submission still called GitHub");

    // A complete submission reaches GitHub and the reporter gets the issue back.
    const created = mockResponse();
    await endpoint(
      mockRequest("POST", { ...goodSubmission, token: await freshTokenFor(), contact: "me@example.com" }),
      created
    );
    assert.strictEqual(created.statusCode, 201, `unexpected: ${JSON.stringify(created.payload)}`);
    assert.strictEqual(created.payload.url, "https://github.com/o/r/issues/7");
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/repos\/.+\/issues$/);
    assert.strictEqual(calls[0].options.headers.Authorization, `Bearer ${process.env.GITHUB_TOKEN}`);
    assert.deepStrictEqual(calls[0].payload.labels, ["community", "bug"]);

    // A repository without the intake labels must still receive the report.
    calls.length = 0;
    respondWith(attempt =>
      attempt === 1
        ? { ok: false, status: 422, text: async () => "label does not exist", json: async () => ({}) }
        : ok()
    );
    const relabeled = mockResponse();
    const second = await freshTokenFor();
    await endpoint(mockRequest("POST", { ...goodSubmission, token: second }), relabeled);
    assert.strictEqual(relabeled.statusCode, 201, `unexpected: ${JSON.stringify(relabeled.payload)}`);
    assert.strictEqual(calls.length, 2, "no retry without labels");
    assert.strictEqual(calls[1].payload.labels, undefined, "retry still sent labels");

    // A bug report with the late-game save posts the save, and the reporter is told it went.
    calls.length = 0;
    respondWith(ok);
    const saveReporter = { "x-forwarded-for": "198.51.100.20" };
    const withSave = mockResponse();
    await endpoint(
      mockRequest("POST", { ...goodSubmission, token: await freshTokenFor(), save: LATEGAME_SAVE }, saveReporter),
      withSave
    );
    assert.strictEqual(withSave.statusCode, 201, `unexpected: ${JSON.stringify(withSave.payload)}`);
    assert.strictEqual(withSave.payload.saveAttached, true);
    const posted = savedBlock(calls[0].payload.body);
    assert.ok(posted, "the save never reached the issue");
    assert.deepStrictEqual(JSON.parse(posted.json), LATEGAME_SAVE);

    const withoutSave = mockResponse();
    await endpoint(mockRequest("POST", { ...goodSubmission, token: await freshTokenFor() }, saveReporter), withoutSave);
    assert.strictEqual(withoutSave.statusCode, 201);
    assert.strictEqual(withoutSave.payload.saveAttached, false);

    /* A streamed request is held to a byte cap before it is parsed. A save near its own cap
     * must fit under it; anything past it is refused before it is read in full. */
    const nearCap = mockResponse();
    const nearCapBody = JSON.stringify({
      ...goodSubmission,
      token: await freshTokenFor(),
      save: saveOfLength(internals.LIMITS.save.max - 1000),
    });
    await endpoint(streamedRequest(nearCapBody, saveReporter), nearCap);
    assert.strictEqual(nearCap.statusCode, 201, `a save near the cap was refused: ${JSON.stringify(nearCap.payload)}`);
    assert.strictEqual(nearCap.payload.saveAttached, true);

    calls.length = 0;
    const tooLarge = mockResponse();
    await endpoint(
      streamedRequest(JSON.stringify({ ...goodSubmission, pad: "x".repeat(internals.MAX_BODY_BYTES) })),
      tooLarge
    );
    assert.strictEqual(tooLarge.statusCode, 413);
    assert.strictEqual(tooLarge.payload.error, "too-large");
    assert.strictEqual(calls.length, 0, "an oversized request still called GitHub");

    // Wrong method, cross-origin, and honeypot never reach GitHub.
    for (const [label, request] of [
      ["PUT", mockRequest("PUT", {})],
      ["cross-origin", mockRequest("POST", { ...goodSubmission, token }, { origin: "https://evil.example" })],
      ["honeypot", mockRequest("POST", { ...goodSubmission, token: await freshTokenFor(), website: "x" })],
    ]) {
      calls.length = 0;
      const blocked = mockResponse();
      await endpoint(request, blocked);
      assert.ok(blocked.statusCode >= 400, `${label} was not rejected`);
      assert.strictEqual(blocked.payload.ok, false);
      assert.strictEqual(calls.length, 0, `${label} still called GitHub`);
    }

    // A GitHub failure must not leak the token or upstream detail to the reporter.
    calls.length = 0;
    respondWith(() => ({
      ok: false, status: 401,
      text: async () => `Bad credentials for ${process.env.GITHUB_TOKEN}`,
      json: async () => ({}),
    }));
    const failed = mockResponse();
    const savedError = console.error;
    // The detail is meant to reach the server log; capture it instead of printing it here.
    let logged = "";
    console.error = message => { logged += String(message); };
    await endpoint(mockRequest("POST", { ...goodSubmission, token: await freshTokenFor() }), failed);
    console.error = savedError;
    assert.ok(logged.includes("Bad credentials"), "upstream detail never reached the server log");
    assert.strictEqual(failed.statusCode, 502);
    const leaked = JSON.stringify(failed.payload);
    assert.ok(!leaked.includes(process.env.GITHUB_TOKEN), "response leaked the GitHub token");
    assert.ok(!leaked.includes("Bad credentials"), "response leaked upstream detail");
  } finally {
    global.fetch = realFetch;
  }

  async function freshTokenFor() {
    const res = mockResponse();
    await endpoint(mockRequest("GET"), res);
    // Age it past the "too fast to be a person" floor without waiting in real time.
    const parts = res.payload.token.split(".");
    const aged = [parts[0], String(Number(parts[1]) - internals.MIN_TOKEN_AGE_MS - 1000), parts[2]];
    const crypto = require("crypto");
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(aged.join("."))
      .digest("hex");
    return [...aged, signature].join(".");
  }
}

async function unconfiguredContract() {
  const savedToken = process.env.GITHUB_TOKEN;
  const savedSecret = process.env.FORGE_SUBMIT_SECRET;
  const savedError = console.error;
  console.error = () => {};
  delete process.env.GITHUB_TOKEN;
  delete process.env.FORGE_SUBMIT_SECRET;
  try {
    const res = mockResponse();
    await endpoint(mockRequest("GET"), res);
    // An unconfigured deployment says so plainly rather than half-working.
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.payload.error, "unconfigured");
    assert.ok(!JSON.stringify(res.payload).includes("GITHUB_TOKEN"), "named the missing variable to the client");
  } finally {
    process.env.GITHUB_TOKEN = savedToken;
    process.env.FORGE_SUBMIT_SECRET = savedSecret;
    console.error = savedError;
  }
}

/* ---------- GitHub App authentication ---------- */

async function appAuthContract() {
  const crypto = require("crypto");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const saved = { ...process.env };
  const realFetch = global.fetch;

  try {
    delete process.env.GITHUB_TOKEN;
    process.env.GITHUB_APP_ID = "123456";

    // A PEM survives all three ways an environment variable tends to carry it.
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
    assert.strictEqual(internals.appPrivateKey(), privateKey, "literal PEM was mangled");
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
    assert.strictEqual(internals.appPrivateKey(), privateKey, "escaped newlines were not restored");
    process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(privateKey).toString("base64");
    assert.strictEqual(internals.appPrivateKey(), privateKey, "base64 PEM was not decoded");

    assert.ok(internals.usingApp(), "app credentials not detected");
    assert.ok(internals.credentialConfigured(), "app credentials not accepted as configured");

    // The JWT must actually verify under the matching public key, and be time-boxed.
    const jwt = internals.appJwt(NOW);
    const [header, payload, signature] = jwt.split(".");
    const unpad = value => value.replace(/-/g, "+").replace(/_/g, "/");
    assert.ok(
      crypto
        .createVerify("RSA-SHA256")
        .update(`${header}.${payload}`)
        .verify(publicKey, Buffer.from(unpad(signature), "base64")),
      "the app JWT does not verify under its own key"
    );
    const claims = JSON.parse(Buffer.from(unpad(payload), "base64").toString("utf8"));
    assert.strictEqual(claims.iss, "123456");
    // GitHub rejects a future iat and caps the lifetime at ten minutes.
    assert.ok(claims.iat < Math.floor(NOW / 1000), "iat is not back-dated for clock skew");
    assert.ok(claims.exp - claims.iat <= 600, "JWT lifetime exceeds the ten-minute maximum");

    // The installation is discovered, then exchanged for a short-lived token.
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, method: (options && options.method) || "GET", headers: options.headers });
      if (url.endsWith("/installation")) {
        return { ok: true, status: 200, json: async () => ({ id: 42 }), text: async () => "" };
      }
      return {
        ok: true, status: 201, text: async () => "",
        json: async () => ({
          token: "ghs_installation",
          expires_at: new Date(NOW + 60 * 60 * 1000).toISOString(),
        }),
      };
    };
    const first = await internals.githubCredential(NOW);
    assert.strictEqual(first, "ghs_installation");
    assert.strictEqual(calls.length, 2, "expected an installation lookup and a token exchange");
    assert.match(calls[0].url, /\/repos\/.+\/installation$/);
    assert.match(calls[1].url, /\/app\/installations\/42\/access_tokens$/);
    assert.strictEqual(calls[1].method, "POST");

    // A live token is reused rather than re-minted on every report.
    const second = await internals.githubCredential(NOW + 60 * 1000);
    assert.strictEqual(second, "ghs_installation");
    assert.strictEqual(calls.length, 2, "a valid installation token was re-minted");

    // Close to expiry it is refreshed before a slow request can outlive it.
    await internals.githubCredential(NOW + 58 * 60 * 1000);
    assert.ok(calls.length > 2, "an almost-expired installation token was reused");

    // A personal token still works when no app is configured.
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_TOKEN = "ghp_personal";
    assert.ok(!internals.usingApp(), "app path claimed without credentials");
    assert.strictEqual(await internals.githubCredential(NOW), "ghp_personal");

    // Neither configured is a server misconfiguration, not a silent no-op.
    delete process.env.GITHUB_TOKEN;
    assert.ok(!internals.credentialConfigured(), "no credential reported as configured");
  } finally {
    global.fetch = realFetch;
    for (const key of ["GITHUB_TOKEN", "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/* ---------- the page offers both paths ---------- */

function pageContract() {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const feedback = fs.readFileSync(path.join(root, "js", "feedback.js"), "utf8");
  const build = require(path.join(root, "scripts", "build-static.cjs"));

  // Both paths are offered, and the account-free one is not hidden behind the other.
  assert.ok(index.includes('id="reportGithub"'), "no GitHub submit path in the page");
  assert.ok(index.includes('id="reportAnon"'), "no account-free submit path in the page");
  assert.ok(index.includes('id="reportWebsite"'), "honeypot field missing");
  assert.ok(index.includes("A GitHub account is optional"), "the page does not say an account is optional");

  /* The form opens in a dialog. Inline it displaced the whole planner when expanded, so
   * it must stay hidden until asked for and must not reintroduce a header disclosure. */
  assert.ok(/<div class="modal-bg" id="reportModal" hidden>/.test(index), "report form is not a hidden dialog");
  assert.ok(index.includes('id="btnReport"'), "nothing opens the report dialog");
  assert.ok(!/<details[^>]*class="contrib"/.test(index), "the report form expands in the header again");
  // Registering with dialogController is what supplies Escape, the focus trap, and
  // backdrop dismissal; hand-rolled show/hide would silently drop all three.
  assert.ok(/dialogController\.register/.test(feedback), "the dialog is not registered with the shared controller");
  const modalStart = index.indexOf('id="reportModal"');
  const modalEnd = index.indexOf("</div>", index.indexOf('id="reportStatus"'));
  for (const field of ["reportKind", "reportTitle", "reportBody", "reportGithub", "reportAnon"]) {
    const at = index.indexOf(`id="${field}"`);
    assert.ok(at > modalStart && at < modalEnd, `${field} is outside the report dialog`);
  }

  // The bundler concatenates this list; a script the page loads but the build omits
  // would work in source and vanish in the release.
  assert.ok(index.includes('<script src="js/feedback.js"></script>'), "page does not load feedback.js");
  const pageScripts = [...index.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(match => match[1]);
  const buildScripts = fs.readFileSync(path.join(root, "scripts", "build-static.cjs"), "utf8");
  assert.ok(buildScripts.includes('"feedback.js"'), "feedback.js missing from PAGE_SCRIPTS");
  assert.ok(pageScripts.includes("feedback.js"));
  assert.strictEqual(typeof build.buildStaticSite, "function");

  /* The only planner state a report carries is the save, taken through the same check Export
   * runs so a reported save always imports — never read raw from storage or memory. */
  assert.ok(!/\bJSON\.stringify\(S\)/.test(feedback), "feedback.js serializes planner state directly");
  assert.ok(!/\bLSKEY\b/.test(feedback), "feedback.js reads the saved build from storage");
  assert.ok(/\bexportableSave\(\)/.test(feedback), "the save is not taken through exportableSave");
  assert.ok(index.includes("Bug reports include your current save"), "the page does not say bug reports carry the save");
}

/* ---------- the form, driven with a fake page ---------- */

function feedbackHarness({ save = { schemaVersion: 9, lines: [] }, saveError = null, saveAttached = true } = {}) {
  const elements = {};
  const element = id => {
    const node = {
      id, value: "", disabled: false, hidden: false, title: "", textContent: "", handlers: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, handler) { (this.handlers[type] = this.handlers[type] || []).push(handler); },
      appendChild(child) { this.textContent += child.textContent; },
      querySelector() { return {}; },
    };
    elements[id] = node;
  };
  for (const id of [
    "reportModal", "reportForm", "reportKind", "reportTitle", "reportBody", "reportContact", "reportWebsite",
    "reportGithub", "reportAnon", "reportHelp", "reportStatus", "reportSaveNote", "btnReport",
  ]) element(id);
  elements.reportKind.value = "bug";
  elements.reportTitle.value = "Solver hangs";
  elements.reportBody.value = goodBody;

  const seen = { downloads: [], opened: [], tabs: [], posts: [], copied: [], dialog: null };
  const context = vm.createContext({
    console, JSON, Math, Date, Promise, Number, String, Error, setTimeout, encodeURIComponent,
    document: {
      getElementById: id => elements[id] || null,
      createElement: () => ({ textContent: "" }),
    },
    navigator: { clipboard: { writeText: async text => { seen.copied.push(text); } } },
    window: {
      // Like a browser: asking for "noopener" opens the tab but hands back no window.
      open: (url, target, features = "") => {
        seen.opened.push(url);
        const tab = { opener: "the planner" };
        seen.tabs.push(tab);
        return /noopener|noreferrer/.test(features) ? null : tab;
      },
    },
    dialogController: { register: options => { seen.dialog = options; return {}; } },
    exportableSave: () => (saveError ? { ok: false, errors: [saveError] } : { ok: true, state: save }),
    downloadJson: (name, value) => { seen.downloads.push({ name, value }); },
    fetch: async (url, options = {}) => {
      if ((options.method || "GET") === "GET") {
        return { ok: true, json: async () => ({ token: "test-token", minWaitMs: 0 }) };
      }
      seen.posts.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ ok: true, url: "https://github.com/o/r/issues/9", number: 9, saveAttached }),
      };
    },
  });
  const source = fs.readFileSync(path.join(root, "js", "feedback.js"), "utf8");
  vm.runInContext(source, context, { filename: path.join(root, "js", "feedback.js") });
  return {
    elements,
    seen,
    context,
    async click(id) { for (const handler of elements[id].handlers.click || []) await handler(); },
    chooseKind(kind) {
      elements.reportKind.value = kind;
      for (const handler of elements.reportKind.handlers.change || []) handler();
    },
    status: () => elements.reportStatus.textContent,
    prefilledBody: () => new URL(seen.opened[0]).searchParams.get("body"),
  };
}

async function formContract() {
  // The notice follows the kind: it says the save goes with a bug report, and nothing else.
  const page = feedbackHarness();
  page.seen.dialog.onOpen();
  assert.strictEqual(page.elements.reportSaveNote.hidden, false, "notice hidden on a bug report");
  page.chooseKind("project");
  assert.strictEqual(page.elements.reportSaveNote.hidden, true, "notice shown on a catalog submission");
  page.chooseKind("bug");
  assert.strictEqual(page.elements.reportSaveNote.hidden, false);

  // The client stops sending at the same size the server stops keeping.
  assert.strictEqual(vm.runInContext("REPORT_MAX.save", page.context), internals.LIMITS.save.max);

  // Sending without an account: a bug report carries the save as its only extra field.
  const save = { schemaVersion: 9, lines: [{ product: "Bits" }] };
  const anon = feedbackHarness({ save });
  await anon.click("reportAnon");
  assert.strictEqual(anon.seen.posts.length, 1);
  assert.deepStrictEqual(
    Object.keys(anon.seen.posts[0]).sort(),
    ["body", "contact", "kind", "save", "title", "token", "website"]
  );
  assert.deepStrictEqual(anon.seen.posts[0].save, save);
  assert.match(anon.status(), /with your save/);

  for (const kind of ["project", "feature"]) {
    const other = feedbackHarness({ save });
    other.chooseKind(kind);
    await other.click("reportAnon");
    assert.ok(!("save" in other.seen.posts[0]), `a ${kind} report sent the save`);
    assert.doesNotMatch(other.status(), /save/);
  }

  // A save too large to keep is not sent, and the report still goes with a reason given.
  const huge = feedbackHarness({ save: { schemaVersion: 9, lines: [], pad: "x".repeat(internals.LIMITS.save.max) } });
  await huge.click("reportAnon");
  assert.strictEqual(huge.seen.posts.length, 1, "an oversized save stopped the report");
  assert.ok(!("save" in huge.seen.posts[0]), "an oversized save was sent");
  assert.match(huge.status(), /without your save.*too large/);

  // A build Export would refuse is not sent either.
  const broken = feedbackHarness({ saveError: "lines[0].cap is not a number" });
  await broken.click("reportAnon");
  assert.ok(!("save" in broken.seen.posts[0]), "a save that fails the export check was sent");
  assert.match(broken.status(), /without your save/);

  // The server has the last word on whether it was kept.
  const dropped = feedbackHarness({ save, saveAttached: false });
  await dropped.click("reportAnon");
  assert.match(dropped.status(), /without your save/);

  /* An opened tab is not mistaken for a blocked one, and GitHub's page gets no handle back to
   * the planner. */
  const plain = feedbackHarness();
  plain.chooseKind("feature");
  await plain.click("reportGithub");
  assert.match(plain.status(), /Opened a prefilled issue/, `an opened tab was reported as: ${plain.status()}`);
  assert.strictEqual(plain.seen.tabs[0].opener, null, "the GitHub tab can still reach the planner");

  // With a GitHub account: the save downloads, and the prefilled issue says where it goes.
  const github = feedbackHarness({ save });
  await github.click("reportGithub");
  assert.strictEqual(github.seen.opened.length, 1);
  assert.deepStrictEqual(github.seen.downloads, [{ name: "forge-build.json", value: save }]);
  assert.match(github.prefilledBody(), /^The solver hangs[\s\S]*<!-- Drag forge-build\.json [^>]*-->$/);
  assert.match(github.status(), /downloaded forge-build\.json.*Drag the file into the issue/);

  const githubProject = feedbackHarness({ save });
  githubProject.chooseKind("project");
  await githubProject.click("reportGithub");
  assert.strictEqual(githubProject.seen.downloads.length, 0, "a catalog submission downloaded the save");
  assert.strictEqual(githubProject.prefilledBody(), goodBody);

  // Nothing downloads when the tab never opened.
  const blocked = feedbackHarness({ save });
  blocked.context.window.open = () => null;
  await blocked.click("reportGithub");
  assert.strictEqual(blocked.seen.downloads.length, 0, "the save downloaded behind a blocked pop-up");

  const githubBroken = feedbackHarness({ saveError: "lines[0].cap is not a number" });
  await githubBroken.click("reportGithub");
  assert.strictEqual(githubBroken.seen.opened.length, 1, "a broken save stopped the issue opening");
  assert.strictEqual(githubBroken.seen.downloads.length, 0);
  assert.doesNotMatch(githubBroken.prefilledBody(), /forge-build\.json/);
  assert.match(githubBroken.status(), /save could not be attached/);

  // Details too long for a link still go to the clipboard, and the save still downloads.
  const long = feedbackHarness({ save });
  // Spaces triple in length once encoded, so these details overflow a link.
  const longDetails = "x y ".repeat(internals.LIMITS.body.max / 4);
  long.elements.reportBody.value = longDetails;
  await long.click("reportGithub");
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(long.seen.copied[0], longDetails.trim());
  assert.strictEqual(long.seen.downloads.length, 1);
  assert.match(long.status(), /forge-build\.json/);
}

async function main() {
  const checks = [
    ["submit token", tokenContract],
    ["input caps", validationContract],
    ["sanitizers", sanitizerContract],
    ["issue body", issueBodyContract],
    ["save validation", saveValidationContract],
    ["save in the issue", saveIssueContract],
    ["origin gate", originContract],
    ["rate limit", rateLimitContract],
    ["handler", handlerContract],
    ["app auth", appAuthContract],
    ["unconfigured", unconfiguredContract],
    ["page", pageContract],
    ["form", formContract],
  ];
  let failed = 0;
  for (const [name, check] of checks) {
    try {
      await check();
      console.log(`ok   ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}: ${error.message}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\n${failed} report-issue check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\n${checks.length} report-issue checks passed`);
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
