# Issue Intake

The header disclosure "Report a bug or contribute a project" offers one form with two
submit paths. Both send only what was typed into that form.

| Path | Button | What happens | Issue author |
| --- | --- | --- | --- |
| With an account | Post with my GitHub account | Opens a prefilled `issues/new` tab on github.com. The reporter presses Create. | The reporter |
| Without an account | Send without an account | Posts to `/api/report-issue`, which opens the issue server-side. | The token owner (see below) |

The account path needs no server and works on any host, including the static preview.
The account-free path needs the Vercel Function and the configuration below; where the
function is unreachable, that button disables itself and the form says so rather than
failing at submit time.

## The one thing to know before enabling this

Issues opened through the account-free path are authored by whoever owns the configured
token. Using a personal token means anonymous reports appear in the tracker **under your
own name**, as though you filed them. Nothing in the GitHub UI distinguishes them at a
glance, so the endpoint compensates:

- every such issue carries the `community` label,
- every body ends with a footer stating it arrived anonymously and is unverified,
- `@mentions` and `#123` references in submitted text are defused so a report cannot
  notify anyone or cross-link an unrelated issue before you have read it.

If authorship under your name is not acceptable, create the token on a separate bot
account with collaborator access to this repository, or install a GitHub App and issue
installation tokens. Both change only which credential `GITHUB_TOKEN` holds; no code
changes.

## Setup

### 1. Create a scoped token

Use a **fine-grained** personal access token, not a classic one, so the blast radius is a
single repository:

1. Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. **Resource owner:** the account that owns this repository.
3. **Repository access:** Only select repositories → `Forge-Planner`.
4. **Repository permissions:** `Issues` → **Read and write**. Leave everything else at No
   access. (`Metadata: Read-only` is added automatically and is required.)
5. Set an expiration and put its renewal on a calendar — see Rotation below.

The token can open and read issues on this one repository and can do nothing else. It
cannot push code, read other repositories, or act on your account.

### 2. Add it to Vercel

In the Vercel project: **Settings → Environment Variables**.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | yes | The token from step 1. |
| `GITHUB_REPO` | no | `owner/repo` override. Defaults to `Andy1292-tower/Forge-Planner`. |
| `FORGE_SUBMIT_SECRET` | no | Signing key for submit tokens. Derived from `GITHUB_TOKEN` when unset. |
| `ALLOWED_ORIGINS` | no | Extra comma-separated origins allowed to post, for a custom domain. |

Apply `GITHUB_TOKEN` to Production and Preview. Redeploy — environment variables are read
at request time, but an existing deployment will not pick up a new variable until it is
redeployed.

### 3. Create the labels

Create `community` plus `bug`, `enhancement`, and `catalog` in **Issues → Labels**. If a
label is missing, the endpoint retries once without labels rather than dropping the
report, so a missing label costs you the filter, not the submission.

### 4. Verify

With the deployment live, open the header disclosure and check that the "Send without an
account" button is enabled. Submit a real test report, confirm it appears with the
`community` label and the provenance footer, then close it.

`curl` a token to confirm the function is reachable at all:

```bash
curl -sS https://YOUR-DEPLOYMENT/api/report-issue
```

A JSON body containing `token` means it is configured. `{"error":"unconfigured"}` means
`GITHUB_TOKEN` is not set on that deployment.

## What stops abuse

This is the only unauthenticated write path into the public tracker, so the endpoint
refuses a submission that fails any of:

- **Signed submit token.** A `GET` issues an HMAC-signed token; a `POST` must carry one
  that verifies, is at least 3 seconds old, and is under 2 hours old. Posting directly
  without loading the form fails.
- **Same-origin check.** The `Origin` header must match the deployment host or an entry in
  `ALLOWED_ORIGINS`. A missing `Origin` is refused.
- **Honeypot.** A hidden `website` field that only automation fills.
- **Size and shape caps.** Title 5–120 characters, details 20–4000, contact up to 120,
  request body up to 16 KB, and one of three known report kinds.
- **Rate limits.** 3 per 10 minutes and 10 per day per hashed address, plus 60 per hour
  per instance. Addresses are hashed, never stored raw.

The rate limiter is **per function instance**, held in memory. Vercel runs several
instances and recycles them, so it thins bursts from one source rather than enforcing a
true global quota. That is deliberate for a project this size: the durable protection is
that everything arrives labeled and reviewable.

If real spam ever arrives, the next step is Cloudflare Turnstile or Vercel BotID on this
one route. Turnstile requires adding its host to `script-src` and `frame-src` in the
`vercel.json` Content-Security-Policy, which is currently strict enough that no
third-party script can run.

## Rotation

Fine-grained tokens expire. When this one does, the account-free button starts failing and
the function logs `report-issue: GitHub responded 401`. Nothing else in the site is
affected, and the GitHub path keeps working throughout.

To rotate: create a replacement token with the same scope, update `GITHUB_TOKEN` in
Vercel, and redeploy. Leaving `FORGE_SUBMIT_SECRET` unset means the submit-token signing
key is derived from `GITHUB_TOKEN`, so rotating the token also rotates that key and
invalidates any form left open — reporters just reload.

## Privacy

The submitted payload is exactly: kind, title, details, optional contact, the honeypot
field, and the submit token. Planner state is never read or attached, so the page's
promise that saved builds stay in the browser still holds. `test/report-issue.cjs`
asserts that the posted payload contains no other field, so widening it fails the suite.

Anything typed into the form becomes a public GitHub issue. The form says so; the contact
field is optional and labeled for people who want a reply without an account.
