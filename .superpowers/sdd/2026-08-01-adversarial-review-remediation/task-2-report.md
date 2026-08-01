# Task 2 Report: Close the Imported-Markup Execution Boundary

## Outcome

The confirmed imported-markup execution paths are closed independently of Content Security Policy. Imported display strings and saved names now enter form controls and text nodes through DOM properties; remaining project templates use separate text and attribute encoders; solver exceptions are text-only. Unsafe imported identifiers are rejected before rendering. Analytics was removed, and both a deployment header and an early meta fallback now enforce the page's real resource requirements.

## RED evidence

The browser corpus was first run against the original production renderers with CSP deliberately bypassed. Eight of nine cases failed. Across the sell-price, Forgie, and inventory maps, every injected entry created an element with an event attribute, ran its marker, and made its probe request. Project-name, Manual-preset-ID, and solver-error sinks did the same. The Manual preset name was already inert, which was retained as a regression case. The clean quoted-value case also showed value-attribute truncation. The schema corpus separately failed both new ID constraints while retaining the existing `planStart` type rejection.

No hostile payload text is reproduced in this report; the complete local-only corpus is in `test/browser/import-security.spec.js`.

## Implemented boundary

| Imported value | Rendering boundary | Result |
| --- | --- | --- |
| `priceText`, `forgieText`, `inventoryText` | `createElement`, `.value`, `textContent`, `replaceChildren` | Exact values; no HTML parsing |
| Project name and description | `htmlText` in text contexts; `htmlAttribute` only in quoted attribute contexts | All shopping-list, progress, step, and result surfaces remain inert |
| Manual preset ID | Schema ID format, 64-character maximum, DOM `.value` | Invalid IDs rejected before render |
| Manual preset name | DOM option/button properties and `textContent` | Exact option, button, and title text |
| Solver error | Text nodes and `replaceChildren` | Exception text cannot become markup |
| `planStart` | Existing finite-number timestamp schema | Type coverage only, as scoped |

All imported string descriptors retain explicit length limits: display strings 128, project/preset names 256, project descriptions 2048, and identifiers 64 characters. IDs must start with a letter and then contain only letters, digits, underscores, or hyphens.

## CSP and network posture

- Removed the inline analytics bootstrap and the Vercel Analytics request. The generic smoke test now fails on every console error and failed HTTP response.
- Added a `vercel.json` header for every route and an early meta fallback. The deployment form follows Vercel's documented `headers` configuration: <https://vercel.com/docs/project-configuration/vercel-json>.
- `script-src` and `worker-src` are self-only; inline scripts are not allowed. Objects and frames are disabled, forms and connections are same-origin, and the response header adds `frame-ancestors 'none'`.
- Current inline style attributes are explicitly allowed only through `style-src-attr 'unsafe-inline'`. Stylesheets otherwise allow self plus Google Fonts CSS; fonts allow self plus Google Fonts files; images allow self and data URLs.
- DOM safety is tested with CSP bypassed. The CSP test independently proves the application and Worker run, a deliberate inline script is blocked, no analytics request occurs, and the only CSP console message is the deliberate blocked probe.

## Verification

- RED browser run: 8 failed, 1 passed; failures reproduced every confirmed raw-HTML sink and clean value truncation.
- GREEN focused browser run before the final static-header case: 9 passed.
- `npm test`: 16 test scripts passed, including 39 state-schema tests and parity checks.
- Full installed-Chrome browser suite: 18 passed, including the final host-header/meta assertion and progress-surface coverage.
- In-app Browser: app loaded at the local origin, Worker-backed results rendered, Sell Prices showed all 12 controls, Manual mode showed its saved-setup control and line table, and browser warnings/errors were empty. Visual inspection found no overlay, clipping, or interaction regression in the inspected desktop viewport.
- `git diff --check`: passed.

## Self-review

- Audited every remaining `innerHTML` in `events.js`, `manual.js`, `results.js`, `render.js`, and `state.js`. Imported names/descriptions are encoded for their exact contexts; IDs are encoded and schema-constrained; remaining interpolations are static strings, validated enums, or numeric solver output.
- Confirmed all executable scripts are external same-origin files, `dom.js` loads before its consumers, and repository analytics references exist only in the negative regression assertion.
- Confirmed clean values preserve whitespace, angle brackets, ampersands, and both quote types through import, export, storage reset, re-import, and display.
- Confirmed valid catalog/generated IDs satisfy the new format and current state/Worker snapshots continue through the shared validation boundary.

## Residual concerns

No blocking concern remains for this task. The policy intentionally retains inline style attributes and Google Fonts origins because the current end-user interface depends on them. Self-hosting fonts and migrating inline presentation to classes would permit a narrower future style policy, but is outside this security boundary.
