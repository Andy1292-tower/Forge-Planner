# Issue Intake

The header button "Report a bug or contribute a project" opens a dialog holding one form
with two submit paths. Both send only what was typed into that form.

| Path | Button | What happens | Issue author |
| --- | --- | --- | --- |
| With an account | Post with my GitHub account | Opens a prefilled `issues/new` tab on github.com. The reporter presses Create. | The reporter |
| Without an account | Send without an account | Posts to `/api/report-issue`, which opens the issue server-side. | The configured credential |

The account path needs no server and works on any host, including the static preview. The
account-free path needs the Vercel Function and one of the two credentials below; where
the function is unreachable, that button disables itself and the form says so rather than
failing at submit time.

## Choosing a credential

Anonymous reports are opened by whatever credential the function holds, and that decides
whose name appears on them.

|  | GitHub App **(recommended)** | Personal access token |
| --- | --- | --- |
| Issues authored by | `your-app[bot]`, visibly not a person | **You**, as though you filed them |
| Credential in the environment | A private key that mints tokens expiring in an hour | A token valid until it expires, often a year |
| Expiry work | None; the key does not expire | Rotate before expiry or the path breaks |
| Cost | Free | Free |
| Setup | Six steps, once | Two steps |

Both are free. The App is better on every axis except setup length, and the difference is
about ten minutes. Use the App unless you want the fastest possible thing that works.

Either way, anonymous issues carry the `community` label and a footer stating they arrived
anonymously and are unverified, and submitted `@mentions` and `#123` references are defused
so a report cannot notify anyone or cross-link an unrelated issue before you have read it.

### Option A: a GitHub App

A GitHub App is an identity that belongs to the repository rather than to you. It holds
its own permissions, and it posts under its own bot name.

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Name it something recognizable — the name becomes the issue author, so `Forge Planner
   Bot` shows up as `forge-planner-bot[bot]`. Set Homepage URL to your deployment.
3. **Uncheck "Active" under Webhook.** Nothing here listens for events, and leaving it on
   makes GitHub demand a webhook URL.
4. Under **Repository permissions**, set `Issues` to **Read and write**. Leave every other
   permission at No access. Under "Where can this GitHub App be installed?", choose **Only
   on this account**.
5. Create it, then on its page: note the **App ID**, scroll to **Private keys**, and press
   **Generate a private key**. A `.pem` file downloads — this is the only copy, so keep it
   somewhere safe.
6. Press **Install App** in the sidebar, install it on your account, and choose **Only
   select repositories → Forge-Planner**.

Then set two variables in Vercel under **Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `GITHUB_APP_ID` | The App ID from step 5 (a number). |
| `GITHUB_APP_PRIVATE_KEY` | The contents of the `.pem` file. |

The private key is multi-line. Pasting it into Vercel's editor works as-is; if whatever
you paste through mangles the newlines, the function also accepts a single-line form with
`\n` escapes, or the whole PEM base64-encoded:

```bash
base64 -i ~/Downloads/your-app.private-key.pem | pbcopy
```

The installation is discovered automatically, so there is no installation ID to configure.
Each request mints a token that GitHub expires within the hour, and the function reuses one
until it is close to expiring.

### Option B: a personal access token

Faster, at the cost of anonymous issues appearing under your own name.

1. **Settings → Developer settings → Personal access tokens → Fine-grained tokens.** Use a
   fine-grained token, not a classic one, so the blast radius is a single repository.
2. **Resource owner:** the account owning this repository. **Repository access:** Only
   select repositories → `Forge-Planner`. **Repository permissions:** `Issues` → **Read and
   write**, everything else No access. (`Metadata: Read-only` is added automatically and is
   required.)
3. Set it as `GITHUB_TOKEN` in Vercel.

The token can open and read issues on this one repository and nothing else. It cannot push
code, read other repositories, or act on your account. Set an expiration and calendar its
renewal — when it lapses the account-free button starts failing and the function logs
`report-issue: GitHub responded 401`. Nothing else in the site is affected and the GitHub
path keeps working.

To rotate: create a replacement with the same scope, update `GITHUB_TOKEN`, redeploy.

### Optional variables

| Variable | Purpose |
| --- | --- |
| `GITHUB_REPO` | `owner/repo` override. Defaults to `Andy1292-tower/Forge-Planner`. |
| `FORGE_SUBMIT_SECRET` | Signing key for submit tokens. Derived from the GitHub credential when unset. |
| `ALLOWED_ORIGINS` | Extra comma-separated origins allowed to post, for a custom domain. |

Leaving `FORGE_SUBMIT_SECRET` unset means rotating the GitHub credential also rotates the
submit-token signing key, invalidating any form left open. Reporters just reload.

## After configuring

Apply the variables to Production and Preview, then **redeploy** — an existing deployment
does not pick up a new variable until it is rebuilt.

Create the `community` label plus `bug`, `enhancement`, and `catalog` in **Issues →
Labels**. If a label is missing the endpoint retries once without labels rather than
dropping the report, so a missing label costs you the filter, not the submission.

Verify by opening the report dialog and checking that "Send without an account" is enabled,
then submitting a real test report. Confirm it appears with the `community` label, the
provenance footer, and — on the App path — a `[bot]` author. Close it afterwards.

To check reachability without submitting anything:

```bash
curl -sS https://YOUR-DEPLOYMENT/api/report-issue
```

A JSON body containing `token` means it is configured. `{"error":"unconfigured"}` means
neither credential reached that deployment.

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

## Privacy

The submitted payload is exactly: kind, title, details, optional contact, the honeypot
field, and the submit token. Planner state is never read or attached, so the page's
promise that saved builds stay in the browser still holds. `test/report-issue.cjs` asserts
that the posted payload contains no other field, so widening it fails the suite.

Anything typed into the form becomes a public GitHub issue. The form says so; the contact
field is optional and labeled for people who want a reply without an account.
