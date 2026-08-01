# Forge Planner Full Adversarial Project Review

**Review date:** 2026-08-01

**Reviewed revision:** `78f496a1ee442a062dd667b2fb85825fbd468261` (`main`, aligned with `origin/main`)

**Scope:** product behavior, solver correctness, saved state, security, accessibility, desktop/mobile UI, performance, architecture, tests, documentation, and release operations

**Review posture:** hostile pre-release review; findings are separated into confirmed defects, intentional tradeoffs that need disclosure, and lower-confidence engineering risks

## Executive Verdict

Forge Planner is a useful, unusually domain-aware tool with a recognizable industrial visual identity, a responsive Worker-based optimizer, good mined-resource modeling, and meaningful regression coverage. That identity currently masks materially unfinished composition: the main result body has accidentally lost all padding, the title/tabs/status collide at common laptop widths, narrow-mobile project and data controls collapse into each other, and several dense surfaces rely on clipping or undiscoverable horizontal scrolling. The current test suite is green, the catalog is structurally clean, no application JavaScript errors occur on a fresh-origin load, and the main Items solver matched exhaustive search in 48 deliberately small comparison cases. Outside Vercel, the expected Analytics script request still returns 404.

It is not ready to be treated as a fully trustworthy planner yet. The highest-risk defects are not merely visual polish:

1. A project can be labeled feasible while the displayed step order immediately runs an input negative from the stated inventory.
2. A late optimizer Worker result can overwrite Manual mode after the user has switched away.
3. A crafted imported build can inject executable markup through persisted text fields.
4. A malformed local save can prevent the application from booting, with no GUI recovery path.
5. Core project and dialog workflows remain inaccessible to keyboard, screen-reader, and many touch users.
6. At narrow mobile widths, primary project and data-entry layouts visibly overlap or crush labels, making the GUI unreliable for the audience it is intended to serve.

There are also two direct optimizer-trust problems: the Mined Resources modal can call a Gel loadout “best” when it is 25% below the true discrete optimum, and Project mode silently accepts a plan up to 5% below newly optimized throughput while continuing to use “optimal” and “fastest” language.

**Release recommendation:** stop feature expansion until the P1 work, the optimizer-trust subset of P2, and the confirmed visual-regression repairs are complete. Keep the static, local-first architecture and the established visual character; this review recommends a system-first recomposition, not a framework rewrite.

## Severity Model

| Priority | Meaning | Release treatment |
| --- | --- | --- |
| P0 | Data compromise or core application failure with broad, immediate impact | Emergency stop-ship |
| P1 | Wrong or stale instructions, executable import, unrecoverable startup, or a primary workflow blocked for a class of users | Fix before the next public release |
| P2 | Material trust, correctness, performance, usability, or maintainability problem | Fix in the next hardening cycle |
| P3 | Polish, resilience, documentation, or longer-term engineering debt | Schedule after the hardening cycle |

No P0 issue was found.

## What Was Verified

- Inspected the static HTML/CSS application, all eight JavaScript modules, all CommonJS tests, the 4,751-line project catalog, README, issue templates, and recent history.
- Ran every targeted Node regression harness, JavaScript syntax checks, scale scenarios through 12 lines, and the golden parity comparison: `16 ok, 0 improved, 0 failed`.
- Exercised Items, Credits, Project, and Manual modes; every modal; catalog-to-plan-to-progress; empty, blocked, partial, and stale states; desktop/laptop at 1440×900, 1024×768, and 900×760; tablet at 880×800; and mobile at 390×844 and 320×700.
- Measured rendered boxes, computed padding/grid tracks, horizontal scroll extents, modal heights, and breakpoint transitions instead of judging visual quality from source alone.
- Reproduced candidate failures with controlled Node diagnostics or the real browser/Worker path rather than relying only on code inspection.
- Compared small Items problems with exhaustive search: 48/48 matched.
- Audited 26 catalog projects and 264 levels: no duplicate IDs/names, invalid item names, duplicate cost entries, negative quantities, or malformed level structures.
- Queried the current GitHub issue backlog. There were no open issues to deduplicate against on the review date.

## Priority Summary

| ID | Priority | Finding | Confidence |
| --- | --- | --- | --- |
| COR-01 | P1 | Displayed project steps can be impossible from the stated inventory | Confirmed repro |
| COR-02 | P1 | Obsolete Worker output can overwrite Manual mode | Confirmed browser + harness repro |
| SEC-01 | P1 | Imported display text is a stored DOM-XSS path | Confirmed code path |
| STATE-01 | P1 | One malformed persisted value can brick startup | Confirmed repro |
| A11Y-01 | P1 | Five of six dialogs lack a usable dialog/focus lifecycle | Confirmed browser repro |
| A11Y-02 | P1 | Repeated controls, sliders, tooltips, and state changes lack accessible identity | Confirmed accessibility-tree inspection |
| A11Y-03 | P1 | Project cards are partly keyboard-inoperable and have undersized touch targets | Confirmed mobile repro |
| A11Y-04 | P1 | Widespread small secondary text fails contrast | Confirmed color measurement |
| VIS-01 | P1 | Narrow-mobile project and data-entry layouts visibly collide or crush content | Confirmed 390px/320px browser repro |
| VIS-03 | P1 | Result navigation and tooltip geometry cause clipping/overflow across common widths | Confirmed 561–1024px browser measurement |
| VIS-05 | P1 | Result tables and long dialogs hide actionable content/controls | Confirmed desktop/mobile repro |
| COR-03 | P2 | “Best” Gel loadout can be 25% below the true discrete optimum | Confirmed counterexample |
| COR-04 | P2 | Credits can attach a losing candidate’s margin warning to a strict winner | Confirmed counterexample |
| COR-05 | P2 | Credits “max solve time” is not an end-to-end time ceiling | Confirmed timing diagnostic |
| COR-06 | P2 | Project stability silently accepts slower plans | Confirmed by existing test |
| STATE-02 | P2 | Import and numeric-state validation are weak and inconsistent | Confirmed inspection/repro |
| DEPLOY-01 | P2 | Unversioned scripts permit mixed-release cache failures | Confirmed locally; production incidence unproven |
| UX-01 | P2 | First use looks preconfigured and buries the result on mobile | Confirmed browser measurement |
| UX-02 | P2 | Stale-plan feedback is remote and visual-only | Confirmed mobile measurement |
| UX-03 | P2 | Invalid game notation fails silently | Confirmed browser repro |
| UX-04 | P2 | Empty Credits results can be copied into an all-idle Manual setup | Confirmed browser repro |
| UX-05 | P2 | Toolbar and long modal workflows lack progressive disclosure | Confirmed heuristic review |
| UX-06 | P2 | Sell-price nudge persists into unrelated modes and covers another action | Confirmed browser + source repro |
| UX-07 | P2 | Long dialogs reopen at their stale scroll offset with the header offscreen | Confirmed browser repro |
| VIS-02 | P2 | Optimal Setup lost its body padding after the solve-overlay wrapper was added | Confirmed selector + computed-style repro |
| VIS-04 | P2 | Header, line cards, metrics, and tables lack coherent hierarchy and spacing rhythm | Confirmed measurement + screenshot review |
| VIS-06 | P2 | Inline presentation and missing design tokens make visual drift systemic | Confirmed source inventory |
| TEST-01 | P2 | No unified test command, CI, real-Worker integration, or accessibility gate | Confirmed repository audit |
| ENG-01 | P2 | Global state, HTML-string rendering, and mixed concerns amplify defects | Confirmed architecture audit |
| DOC-01 | P2 | Accuracy, privacy, and performance claims overstate observed behavior | Confirmed source/network review |
| RES-01 | P3 | Recent edits can be lost on immediate close | Confirmed lifecycle inspection |
| RES-02 | P3 | Progress rendering invokes the optimizer on the UI thread | Confirmed source path |
| RES-03 | P3 | One transient Worker failure permanently disables background solving | Confirmed source path |
| WEB-01 | P3 | Root-relative optional assets break subpath hosting | Confirmed URL resolution |
| A11Y-05 | P3 | Reduced-motion and landmark semantics are missing | Confirmed source inspection |
| DATA-01 | P3 | Catalog provenance and generation/validation are undocumented | Confirmed repository audit |
| DOC-02 | P3 | Credits code comment asserts a false mathematical invariant | Confirmed counterexample; behavior is intentional |

---

## Detailed Findings

### COR-01 — Displayed project steps can be impossible from the stated inventory (P1)

The project LP proves average-rate feasibility. The renderer then sorts each line’s fractional jobs independently and turns them into sequential instructions. It does not coordinate switch times across lines or simulate transient inventory.

Confirmed case:

- Demand: 10,000 Frames, zero inventory, no duplication.
- Lines: `64×@20`, `64×@18`, `32×@16`, `16×@14`, `8×@12`.
- Solver result: feasible, ETA 17.154 hours.
- Following the displayed first interval produces Ingots at `-567.054232/hour` for 5.171317 hours.
- Startup stock required by that specific displayed simultaneous schedule: 2,932.417170 Ingots. This is not claimed to be the globally minimum unavoidable buffer.

The projected on-hand display uses phase-average rates and clamps negative stock to zero, hiding this failure. Relevant paths are `js/solver.js:631-768` and `js/events.js:610-669`.

**User impact:** the primary “do this next” output can stall immediately even though the interface says it is feasible.

**Required change:** create a global executable schedule from the LP result, or calculate and prominently require exact startup buffers. Replay every displayed event boundary against inventory; never clamp a deficit away before validation.

**Acceptance gate:** from the stated inventory, every ordinary resource remains nonnegative at every rendered switch boundary and each mined-resource burn stays within its instantaneous income rate. If an ordinary startup buffer is unavoidable, the plan must state its exact amount before any run instruction.

### COR-02 — Obsolete Worker output can overwrite Manual mode (P1)

`renderResults()` returns directly for Manual mode without invalidating the active request, terminating the Worker, clearing its callback, or hiding the solve overlay. A prior Items/Credits/Project response therefore still owns the current request ID.

Browser reproduction:

1. Start a multi-target or Credits solve.
2. Immediately switch to Manual.
3. Manual initially renders while the solve overlay remains visible.
4. When the old Worker finishes, the Manual tab remains selected but its body is replaced by the old optimizer result.

Relevant paths: `js/results.js:35-68,282-289` and `js/events.js:100-107`.

**Required change:** one solve-lifecycle controller must cancel/invalidate on every mode transition, reset, import, and synchronous render. A response must match a generation token plus the expected mode/state revision.

**Acceptance gate:** a controllable fake Worker delivers request A after switching to Manual; A is ignored, the Worker is terminated, Manual remains rendered, and the overlay is hidden.

### SEC-01 — Imported display text is a stored DOM-XSS path (P1)

Import checks only that `lines`, `prodCost`, and `targets` are truthy. Arbitrary values in `priceText`, `forgieText`, `inventoryText`, and Manual preset IDs survive normalization and are later interpolated into `innerHTML` attribute contexts without escaping.

Confirmed sinks:

- `js/events.js:110-121` — sell prices.
- `js/events.js:148-159` — Lil’ Forgie rates.
- `js/events.js:384-392` — inventory.
- `js/manual.js:101-105` — preset option IDs.

A string beginning with `"><img ... onerror=...>` breaks out of an input’s `value` attribute. The payload executes on the app origin when the corresponding modal renders and can read or replace the full local build. The app has no CSP to contain it.

**Required change:** validate into a fresh defaults-based object using an explicit versioned schema; whitelist fields; limit string lengths; build user-controlled form values with DOM properties (`input.value`, `textContent`), never HTML interpolation; and add a restrictive CSP as defense in depth.

**Acceptance gate:** import attack strings through every text/ID field. No unexpected node or event attribute may appear, no side effect may run, and valid old/current exports must still round-trip.

### STATE-01 — One malformed persisted value can brick startup (P1)

`load()` catches JSON/storage errors, but `normalize(load())` runs outside that boundary. Setting the storage value to JSON primitive `1` and reloading produces:

```text
TypeError: Cannot create property 'lines' on number '1'
```

The page never reaches Reset, so a nontechnical user has no in-app recovery. Relevant path: `js/core.js:135-195`.

**Required change:** validate a plain-object root before migration, wrap load/validation/migration in one recovery boundary, quarantine the rejected payload, start from defaults, and show a recovery message with Download rejected data / Reset / Retry import actions.

**Acceptance gate:** primitives, arrays, wrong nested types, truncated old versions, and future versions all boot to a usable GUI without silently destroying the rejected data.

### A11Y-01 — Five dialogs lack a usable dialog/focus lifecycle (P1)

Sell prices, Lil’ Forgie, Settings, Shopping list, and Track progress lack `role="dialog"`, `aria-modal`, programmatic titles, focus entry, focus confinement, background inertness, and reliable focus restoration. Focus remains on a covered background button and Tab can continue behind the overlay.

Mined Resources already demonstrates the correct behavior at `index.html:151-183` and `js/events.js:182-219`.

**Required change:** generalize Mined Resources into one dialog controller rather than maintaining separate open/close listeners.

**Acceptance gate:** for every dialog, opener → initial focus → Tab/Shift+Tab wrap → Escape/backdrop/Done → original focus restored; the background is inert throughout.

### A11Y-02 — Core controls and changing states lack accessible identity (P1)

Confirmed examples:

- Price, Forgie, and inventory fields announce only their placeholder/value rather than the item.
- Target-priority and May-work sliders have no unique programmatic label.
- Recipe cost/base-time fields lack item/level context.
- CSS pseudo-element tooltips expose only “?”.
- Most close buttons expose only “×”.
- Mode selection communicates its state only through the `.on` class.
- Save, stale, solve, and result updates have no status/live semantics.

**Required change:** compute unique accessible names and descriptions, use `aria-pressed` or tab semantics for modes, connect help with `aria-describedby`, and add concise live/status regions without announcing entire tables.

### A11Y-03 — Project cards are partly keyboard-inoperable and too small for touch (P1)

The level disclosure is a clickable `<span>` with no role or keyboard behavior. On mobile it measured about 14×14.5px. Schedule checkboxes are 17×17px; order, completion, and delete controls are commonly 24–30px.

**Required change:** use real buttons with `aria-expanded`, support Enter/Space, and make primary touch targets 44px where practical (or meet the 24px minimum plus sufficient spacing).

### A11Y-04 — Widespread small text fails contrast (P1)

`--ink3: #6f7680` measures approximately:

- 4.15:1 on `#0e1014`.
- 3.88:1 on `#15181d`.
- 3.65:1 on `#1a1e24`.
- 3.40:1 on `#1f242b`.

It is extensively used at 9.5–11.5px for labels, instructions, table headers, and project metadata. `--line2` against `--surface2` is roughly 1.42:1, making control boundaries difficult to perceive.

**Acceptance gate:** normal text reaches 4.5:1 and meaningful boundaries/states reach 3:1 on every surface.

### COR-03 — “Best” Gel loadout can be 25% below optimum (P2)

`gelLoadout()` is a greedy multiple-choice packing algorithm, but the UI labels its output “up to” and “Best loadout.” A three-line counterexample with cap-1 speeds `6/4/4` and a Vespium budget sized for eight speed units chooses only the speed-6 line:

| Result | Gel/hour |
| --- | ---: |
| Current greedy choice | 6.747891284 |
| True discrete optimum (both speed-4 lines) | 8.997188379 |
| Understatement | 25% |

Relevant paths: `js/solver.js:534-564`, `js/render.js:74-97`.

**Required change:** replace greedy packing with an exact Pareto-frontier or bounded branch-and-bound multiple-choice knapsack over each line’s off/compression choices.

### COR-04 — Credits can display a losing candidate’s margin warning (P2)

Credits ORs `usesMargin` and `capped` across all candidate products, then attaches those flags to the winning plan. In a confirmed case, Bits wins strictly at 2,965.360958/hour with zero consumption, a losing Glass candidate uses margin, and the returned winner is labeled “May-work.”

Relevant paths: `js/solver.js:500-525`, `js/results.js:308-313`.

**Required change:** keep plan-specific flags on each candidate and return `top.usesMargin`. A separate ranking-completeness flag may report whether any comparison was capped.

### COR-05 — Credits does not honor max solve time as a total ceiling (P2)

Credits divides the budget by products but runs candidates sequentially and gives each at least 25ms plus fixed seed work. With 12 lines and all products priced:

| Setting | Observed Credits wall time |
| ---: | ---: |
| 200ms | 613.68ms |
| 400ms | 736.74ms |
| 800ms | 1,019.38ms |
| 1,600ms | 1,628.51ms |

Relevant paths: `js/solver.js:482-525`.

**Required change:** establish one absolute deadline, pass remaining time to each candidate, and check it between fixed seeds/local search stages. Rename the setting only if it intentionally remains a per-search budget.

### COR-06 — Project stability silently accepts slower plans (P2)

The 5% throughput hysteresis is intentional and useful for avoiding line churn, but it is invisible. The existing stability test proves a cached plan is held with a 2.36% throughput gap (about 2.42% longer ETA). The configured limit can produce as much as approximately 5.26% longer ETA, while applicable project summaries can still say “fastest total.”

Relevant paths: `js/solver.js:16-24,679-727`; diagnostic fields already exist on phases.

**Required change:** show the exact tradeoff when `stabilized` is true and give a GUI choice: Keep current line jobs / Use fastest found plan. Do not silently weaken “optimal.”

### STATE-02 — Import and numeric-state validation are inconsistent (P2)

Examples:

- Nested strings can pass the top-level import gate and fail only during later interaction.
- Line compression is not normalized against `LEVELS`.
- Imported `solveBudget` allows 60 seconds, the slider max is 15, and its label can say 60 while the thumb is clamped to 15.
- Imported margin can exceed the 20% UI maximum; solver logic clamps elsewhere.
- Dupe’s HTML max is 100, but state/input logic has no matching upper bound.
- Negative Forgie/inventory text can survive and distort model inputs; Mined inputs correctly reject negatives.
- Import replaces state before any preview, field report, or rollback.

**Required change:** one authoritative field schema must drive defaults, input constraints, import validation, normalization, migration, Worker payloads, and display ranges. Import must be transactional.

### DEPLOY-01 — Unversioned scripts permit mixed-release cache failures (P2)

CSS has a release query token, but page scripts and Worker imports do not. On a warm origin, Python `SimpleHTTPServer` returned HTML/CSS as 200 and every unversioned script as 304; the browser reused incompatible cached bodies, producing old-module/current-DOM crashes and a blank result panel. The same checkout loaded successfully on a fresh origin. This proves a local validator/cache failure enabled by stable asset URLs. It does not prove that the current Vercel deployment serves mixed versions.

Relevant paths: `index.html:12,240-249`, `js/solver.worker.js:8`.

**Required change:** content-hash or apply one release revision to every CSS/JS/Worker URL and Worker dependency, deploy HTML/assets atomically, revalidate HTML, and make fingerprinted assets immutable.

### UX-01 — First use looks preconfigured and buries results on mobile (P2)

On a fresh 375px viewport, contribution/support copy plus nine toolbar actions dominate the opening screen; results begin around document y=2,104px. Additional measurements placed the result card around y=1,850 at 768px, 1,969 at 390px, and 2,368 at 320px. Defaults contain realistic five-line values, 12.4% dupe, and Frames enabled without being labeled as sample data.

**Required change:** provide a short first-run path (Use sample / Enter my stats / Import build), label sample data, move support/contribution copy into Help/About, group setup tools by task, and provide a persistent mobile route to Results.

### UX-02 — Stale-plan feedback is remote and visual-only (P2)

After editing the first line on 375×812, the stale banner appears about 1,460px below the field. On narrow mobile the result/action is roughly 1,500–1,900px away from the edited input. The visible solve status can still say “solved in … ms.” The stale bar has top margin but no bottom separation before the result, and its mobile Resimulate button is only about 33.5px high. No live announcement occurs.

**Required change:** show a nearby or sticky mobile stale action, change status to “Out of date,” keep Enter-to-resimulate, and announce the concise state change.

### UX-03 — Invalid game notation fails silently (P2)

Entering `abc` in a price or Vespium field leaves the text visible but silently converts the underlying value to blank/off. `aria-invalid` and an associated error are absent. Price code queries a `data-prev` feedback node that is never rendered.

**Required change:** nonblank invalid input must show a nearby specific message, set `aria-invalid`, preserve the last valid model value until correction, and never masquerade as a legitimate blank.

### UX-04 — Empty Credits can copy an all-idle Manual setup (P2)

With no valid prices, Copy to Manual remains available and switches modes with every line Idle.

**Required change:** hide/disable the action until a non-idle result exists and link the empty state directly to Sell prices.

### UX-05 — Toolbar and long modal workflows need progressive disclosure (P2)

The dark industrial visual character is recognizable, but the top toolbar mixes data, planning, maintenance, destructive, and support actions without hierarchy. Shopping list and Mined Resources can exceed a mobile viewport by more than a full page, with dense tables and limited sticky context. Native `alert`, `confirm`, and `prompt` further fragment the experience.

**Direction:** group Build data / Plans / Data & settings, keep one primary action per state, use summaries/accordions for long reference tables, use sticky dialog headers/footers, and replace native dialogs with app-styled confirmations plus undo where practical.

### UX-06 — Sell-price nudge persists into unrelated modes and covers another action (P2)

The Credits empty-state nudge is positioned over the header controls and can cover Shopping list. More importantly, Credits → Project and Credits → Manual leave it visible: both render paths return before `setPricePoke()` clears the Credits-only state. The interface therefore points at Sell prices while the user is doing an unrelated task and obscures the action Project mode needs.

Relevant paths: `js/events.js:247-260`; `js/results.js:282-295`.

**Required change:** own contextual coaching in the current mode’s render lifecycle, clear it before every early return/mode transition, and prefer an inline empty-state action over a floating overlay that can cover controls.

### UX-07 — Long dialogs reopen at a stale scroll position (P2)

Closing a scrolled Mined Resources dialog and reopening it preserves the overlay’s `scrollTop`. At 1024×768, a reproduced reopen retained `scrollTop=200.5px`; the header of the 1,021.7px panel was at `y=-152.5px`. Current openers only toggle `hidden=false`, so users can re-enter without a visible title or close context.

**Required change:** the shared dialog controller must reset the intended scroll container on every open, keep header/footer visible, and place initial focus in the newly visible context. If a dialog intentionally restores an internal position later, that behavior must be explicit and must not hide its title/actions.

## Visual Composition Re-Audit

The first review pass over-weighted workflow correctness and accessibility and under-weighted basic visual composition. A second pass measured the rendered interface at every material breakpoint and treated awkward spacing, alignment, wrapping, density, and emphasis as defects in their own right.

| Viewport/state | Confirmed visual behavior |
| --- | --- |
| 1440×900, Items | Page header is 195.9px tall; left-card header is 44px while Optimal Setup is 57.5px; `#results` has 0 padding; the one KPI occupies 800×88px; sparse raw recipe cards stretch to the height of the longest neighboring recipe. |
| 1024×768, Items | Layout remains 380px + 18px + 586px. The 413.6px mode switch, title, and solve status cannot share the result header, which grows to 82.5px and wraps into an accidental two-tier arrangement. |
| 900×760, Items | Result column is only 462px, but the tab strip still needs 413.6px. It visibly extends beyond the card/viewport and clips the Manual tab. |
| 390×844, Items/Project | Header is 417.4px before the planner; result header is 120px; result viewport is 364px against 520px tables; a catalog project header grows to 166.5px because its title is crushed beside a 253px tool cluster. |
| 430×932, page header | Wrapped toolbar mixes approximately 33.5px and 49px action rows instead of forming one intentional control grid. |
| 320×700, Items/dialogs | Header is 451.4px; a line card becomes 167.8px with one field stranded on a second row; the result header becomes 149px; fixed 160px dialog inputs overlap long item labels. |

### VIS-01 — Narrow-mobile project and data-entry layouts visibly collide (P1)

The mobile Shopping list card is not merely dense. At 390px, `.proj-h` is 338px wide while its `.proj-tools` child consumes 253px. The remaining fixed disclosure/checkbox columns and gaps leave the `.pname-static` track only 4px wide, so “Lunar Leisure Pavilion Mk. 3” stacks into fragments beside floating order, level, progress, add, and delete controls. The header grows to 166.5px and loses any readable relationship between project name and controls.

At 320px, `.price-row` still uses `grid-template-columns: 1fr 160px`. Its 270px content width resolves to 100px + 160px plus the gap. The flex item name cannot shrink cleanly, so Frames and Reinforced Concrete text visibly runs underneath the input. Forgie and inventory rows share this component and risk the same collision. `overflow-x:hidden` on the page masks overflow rather than fixing the layout.

Relevant paths: `css/styles.css:368-376,411-418,419-479`; `index.html:127-149,203-225`; generated project markup in `js/events.js`.

**User impact:** primary GUI workflows become visually ambiguous or unreadable for narrow-phone users. This qualifies as a P1 usability failure, not a cosmetic preference.

**Required change:** use an explicit mobile project-card composition: identity/action header, controls below in labeled groups, and no fixed auto-width tool cluster competing with the name. Stack price/Forgie/inventory labels above inputs below the available inline threshold. Remove page-level overflow masking once every component owns its overflow.

**Acceptance gate:** at 320px and 390px, long catalog/custom project names, every item label, every project tool, and each value field remain non-overlapping, readable, and operable with 200% text zoom.

### VIS-02 — Optimal Setup has accidentally lost all body padding (P2)

This is the most direct missing-spacing defect. `css/styles.css:110` applies `padding:14px` only to `.card > .body`. The solve-overlay wrapper at `index.html:85-91` changed the DOM to `.card > .results-wrap > #results.body`, so the selector no longer matches. Computed `#results` padding is `0px` at every viewport while the left card body retains 14px.

Notices, metric cards, section headings, tables, project controls, and Manual controls therefore touch the result card’s inner borders. Several renderers compensate with their own margins, producing inconsistent gaps instead of restoring the missing body inset.

**Required change:** establish a semantic card-body class whose padding does not depend on DOM depth. Repair the outer inset once; do not add per-child margins around every result renderer.

**Acceptance gate:** Items, Credits, Project, Manual, empty, stale, error, and solved results all have the same intentional card inset, verified from computed geometry rather than screenshot tolerance alone.

### VIS-03 — Responsive result/help geometry causes page-level clipping (P1)

The mode switch and solve status are packed into the same `justify-content:space-between` title row as “Optimal setup.” Their combined minimum width exceeds the available result header well before the two-column layout collapses at 880px.

- At 1440px, the result header is already 13.5px taller than the left header.
- At 1024px, the result header grows to 82.5px, “Optimal setup” wraps, and status drops under the tabs.
- At 900px, the 413.6px tab strip extends beyond the 462px result card and clips a mode. The document is 915px wide inside a 900px viewport.
- At 390px and 320px, the header becomes 120px and 149px respectively; the title floats in a narrow left column beside a 2×2 tab block and detached status.
- Independent of the tabs, invisible absolutely positioned tooltip pseudo-elements enlarge the document through much of the 561–880px range. At 768px, one hidden tooltip reaches approximately x=818px in a 768px viewport.

Relevant paths: `index.html:70-80`; `css/styles.css:88-110,182-233,324-344,411-418`.

**Required change:** use a stable two-row result header: title plus current status on the first row, full-width mode navigation below. Let the tab layout adapt independently of the page-column breakpoint, and raise the page collapse breakpoint if the remaining two-column content still lacks room. Render help in a contained popover layer or clamp/flip it within the viewport; hidden help must not change document geometry.

**Acceptance gate:** no title, tab, status, or hidden-help overflow at any width from 320px through 1440px; outside explicitly named component scrollers, document `scrollWidth` equals `clientWidth`. Header alignment is intentional rather than an outcome of flex wrapping.

### VIS-04 — Page hierarchy and component rhythm are under-designed (P2)

Several individually reasonable styles combine into a screen with too many boxes, too little hierarchy, and inconsistent spacing:

- The header consumes 195.9px at desktop, 417.4px at 390px, and 451.4px at 320px. A long catalog-contribution paragraph and nine same-size controls precede the actual planner. Four orange gradient buttons all claim primary importance. At 768px the 392px toolbar sits as a left-aligned island with roughly 336px unused beside it; at 320px its min-content tracks become unequal rather than a clean grid.
- Line cards combine a centered number badge, a separate “Line N” title, three labels with measured heights of 23.75px / 13.13px / 25.01px, and a centered delete button. Control bottoms align, but label tops and adjacent chrome do not. At 320px the third field is orphaned on a second row and its tooltip wraps below the label.
- The single Items KPI stretches across 800×88px while its useful content occupies the far-left corner. Project mode’s three KPI cards become a 2+1 grid on mobile, leaving an arbitrary empty quadrant.
- Desktop Crafting Data couples cards to shared grid rows. Raw card bodies that need roughly 82px become roughly 370px tall merely because Glass in the same row has a long table. Merely adding `align-items:start` would keep the raw cards short but still leave roughly 248px of dead row gutter beneath them; raw/product groupings or a non-row-coupled layout are needed. Product tables are about 468px tall inside 330px internal scrollers, multiplying clipped micro-scroll regions.
- Project instructions are logically useful but visually read as punctuation-heavy prose. Job, duration, stop time, and expected stock need repeatable per-line alignment instead of one long, small ordered list.
- On desktop, the right result card can end roughly a viewport before the longer left configuration stack. The remaining page becomes a large empty right-hand field; a sticky result workspace or revised page flow should be prototyped before choosing a fix.
- Tiny muted uppercase text is used for field labels, section labels, metadata, and table headers alike. Simultaneously, grid lines, nested borders, input borders, glow dividers, accent rails, and pills all compete for structure.
- Orange denotes active navigation, several simultaneous primary actions, KPI values, statuses, decorative separators, and focus. That breadth weakens the meaning of the strongest color.

**Required change:** rebuild the visual hierarchy around a small spacing/type/control system. Move support/contribution detail into Help/About; retain a compact support route. Recompose each line as a clear header/action row plus aligned fields. Give lone or odd-count metrics an intentional width/span. Separate sparse raw cards from long product editors or use another non-row-coupled layout so neither stretching nor dead gutters remain. Reduce nested decoration and reserve bright orange for the active choice or current primary action.

### VIS-05 — Tables and long dialogs hide actionable content and controls (P1)

The application frequently solves width/height pressure by letting a large ancestor scroll:

- `#results` itself owns horizontal scrolling and every result table has a global 520px minimum. At 390px the result viewport is 364px; at 320px it is 294px. Key Output and Consumes columns disappear offscreen; Manual hides later output/Sell controls, while swiping can shift the entire result surface rather than one identified table. The only scrollbar can be 639–869px below the rows being read, so the overflow is effectively undiscoverable.
- Sell prices is 834px tall at 390×844 and 851.5px tall at 320×700. Shopping list is 1,207px tall before adding a project. Mined Resources is 1,751px tall at 390×844 and 921px tall at 1440×900. Primary footer actions therefore begin below the fold.
- Each mobile Mined Resources table is 620px wide inside a 326px viewport. Even in the maximum-width two-column desktop dialog at 1440×900, each 650px table has only about 534px; at 1024px it has roughly 443px. Clipping/scroll is therefore guaranteed by the structure, with no persistent edge fade, instruction, or alternate compact representation.
- Expanded Crafting Data is about 4,206px tall at 390px, including a roughly 3,635px recipe grid and eight 330px internal scrollers whose content is roughly 543px tall. This is nested-scroll overload, not useful progressive disclosure.
- Document-level horizontal overflow is present across the transition range: measured `scrollWidth` is 680px at a 561px viewport, 733px at 640px, 818px at 768px, 893px at 880px, 924px at 881px, and 915px at 900px. Absolutely positioned tooltip pseudo-elements contribute to the narrower cases; at 881–900px the squeezed result tabs also overflow. At 560px and below, `overflow-x:hidden` clips that content instead of resolving it.
- The Settings range uses the browser’s blue accent while the rest of the application uses copper/orange, exposing the lack of a shared form-control treatment.

**Required change:** constrain dialogs to the visual viewport with a scrolling body, safe-area-aware margins, and sticky header/footer; progressively disclose reference tables/editors; wrap each wide table in its own named, focusable `.table-scroll` region with a visible overflow cue; and design mobile Manual/result rows as cards or prioritized columns for the controls and values users need most. Do not rely on `overflow-x:hidden` or an ancestor scrollbar to conceal layout debt.

**Acceptance gate:** every dialog title/close/primary action remains available within one viewport; every result/editing control is reachable without a document-level horizontal scroll; and nested vertical scrollers are removed or justified in the approved design.

### VIS-06 — Visual drift is systemic in the source (P2)

The root token set defines colors, one radius, and one glow, but no spacing, type-role, control-height, border-strength, or elevation scales. The presentation inventory contains 146 inline `style` attributes: 57 in `js/results.js`, 28 in `js/events.js`, 28 in `index.html`, 24 in `js/manual.js`, and 9 in `js/render.js`. The stylesheet itself uses at least 16 distinct font sizes and six scattered max-width breakpoints (`360`, `560`, `620`, `640`, `820`, `880`).

Two concrete cascade inconsistencies show the cost:

- The intended mobile `.brand h1`, `.tools`, and `button.btn` overrides at `css/styles.css:32-36` appear before the base rules at `css/styles.css:45-68`; the later base declarations win. The supposedly 34px mobile title remains 42px, compact button sizing does not apply, and the toolbar’s intended full-width behavior is overridden by the later 392px declaration.
- `.fl` is used as a generic field-label class, but its layout/type rules are scoped only under `.line-fields` and `.globals`. Calibration, mined, and settings fields therefore acquire unrelated label treatments through incidental markup and inline styles.

**Required change:** introduce tokens for space `4/8/12/16/24/32`, type roles, compact/standard/touch controls, semantic radii, border strength, and surface elevation. Extract reusable field, toolbar, status, notice, metric, dialog, table-scroll, and action-group classes. Retain inline styles only for genuinely dynamic values such as progress width or a tooltip image variable.

### Visual remediation approaches

1. **Surgical regression repair:** restore result padding, fix the two broken mobile grids, and raise one breakpoint. Fastest and lowest-risk, but it leaves the 146 inline styles and inconsistent visual rhythm intact.
2. **System-first recomposition — recommended:** preserve the industrial palette/type character while adding visual tokens and rebuilding the header, result navigation, line cards, metrics, dialogs, and local table scrollers. This addresses current defects without replacing the application architecture.
3. **Full workflow-shell redesign:** turn the planner into a guided, step-based application shell with separate Setup/Goal/Results surfaces. It could improve first use most, but it has the highest save/workflow regression risk and should not be mixed into the hardening release.

Production UI work should pause at a design approval gate: compare wireframes for approaches 1 and 2 at desktop and mobile, with approach 2 as the review recommendation. The review documents may specify this direction; implementation should not silently choose a substantially different product shell.

### TEST-01 — The safety net does not cover the real failure boundaries (P2)

Strengths: parity, mined resources, inventory, raw targets, stock risk, project gating, Forgie, stability, and scale are all covered.

Gaps:

- No `package.json` or one-command full test runner.
- No CI workflow or release smoke gate.
- No real-page/real-Worker lifecycle test.
- No import schema/security, corrupt-storage, or export round-trip test.
- No transient project-inventory replay.
- No exact Gel packing oracle.
- No browser accessibility, mobile, or cache-upgrade test.
- `test/scale.cjs` prints many scenarios that it does not assert.
- Several UI tests extract source fragments into hand-built mocks and can pass while integration is broken.

**Required change:** add a GUI-friendly documented `npm test`, a browser integration lane, a CI workflow, and a release-upgrade smoke test. Preserve the fast pure-Node tests.

### ENG-01 — Global state and HTML-string rendering amplify defects (P2)

The app is an ordered chain of classic scripts with mutable global `S`; `events.js` combines persistence, rendering, validation, dialogs, project editing, and scheduling; the Worker imports browser-oriented core and rebinds its state. This makes lifecycle ownership unclear and encourages unsafe `innerHTML` interpolation.

**Direction, not a rewrite:** introduce four explicit boundaries incrementally:

1. Versioned state schema/migrations and transactional persistence.
2. Solve service with generation, cancellation, timing, and diagnostics.
3. Safe view helpers plus one dialog controller.
4. Pure catalog/domain validators used by tests and startup.

ES modules are reasonable after those boundaries are tested. A framework migration is not justified by this review.

### DOC-01 — Trust and privacy claims overstate observed behavior (P2)

- Footer says the plan “guarantees” sustainability even when May-work margin explicitly permits a paper shortfall.
- Capped copy says a result is “almost certainly optimal,” which the current search cannot establish for that specific run.
- Project copy says “fastest” while hidden stability may deliberately retain a slower plan.
- Footer says “nothing is uploaded,” while Google Fonts and Vercel Analytics make network requests. There is no evidence planner inputs are sent; the wording is simply broader than the implementation.
- README says Export/Import covers craftable stats, but it exports all state.
- README’s “instant at 5 lines, fine at 6+” does not describe 1–15 second configurable searches.

**Required change:** state the exact contract: build data remains local; optional fonts/analytics make requests; capped means best found within budget and not proven optimal; May-work is not guaranteed; stability may trade speed for fewer line changes.

### P3 Resilience, Web, Accessibility, and Data Findings

#### RES-01 — Recent edits can be lost on immediate close

Many values persist only when the 500ms solve debounce fires. Separate cheap persistence from expensive solving and flush pending persistence on `pagehide`/`visibilitychange`.

#### RES-02 — Progress rendering bypasses the Worker

`renderProgress()` synchronously calls `optimizeProjectTop()` on the UI thread. Reuse the asynchronous solve service or a current cached result.

#### RES-03 — Worker failure recovery is sticky; late-error ownership is under-specified

One `_workerBroken` event demonstrably forces synchronous solves for the rest of the page lifetime. A late error from a superseded Worker may also affect the active solve because ownership is not checked, but that race was identified from code and was not reproduced. Add per-Worker identity, bounded retry, and visible fallback status.

#### WEB-01 — Subpath hosting breaks root-relative optional assets

Tooltip images and analytics use `/assets/...` / `/_vercel/...`. Use document-relative or base-aware URLs and test under `/Forge-Planner/`.

#### A11Y-05 — Missing reduced-motion and landmark semantics

Add `<main>`, a skip route where useful, and a `prefers-reduced-motion` override for ember, poke, stale, progress, and spinner animations.

#### DATA-01 — Catalog provenance and validation are undocumented

The catalog itself passed structural audit. Its 4,751-line hand-maintenance surface still needs source/version provenance, an update procedure, and a validator in the standard test command.

#### DOC-02 — Credits comment states a false invariant

The code says the optimum is “always mono-product.” A counterexample makes 34.13% more credits with mixed sellable outputs. Current UI intentionally defines Credits as a dedicated-single-item comparison, so the behavior is not classified as a bug. Rewrite the comment and label to describe that product contract, not a theorem.

## Important Non-Findings and Constraints to Preserve

- **Pre-produced Bits for Frames and Wire are intentional.** Do not “fix” them into ordinary solver inputs without a mechanics change.
- **Credits is currently a dedicated-item comparison.** Do not silently change it to a mixed-sales optimizer; rename/explain it or make a separate mode if that product decision changes.
- **Explicit Resimulate after crafter-line edits is intentional.** Improve visibility and accessibility without returning to expensive solve-on-every-keystroke behavior.
- **Vespium and Hydracite are independent hard budgets.** They passed adversarial checks and must remain separate.
- **Line stability is a desirable feature.** The defect is its hidden cost and absence of user control, not the existence of stability.
- **The Mined Resources dialog is the correct dialog/focus-lifecycle reference.** Generalize that behavior; it still shares the application’s tooltip, validation, contrast, and live-status defects.
- **The static/local-first shape is an asset.** Keep it unless a future requirement genuinely needs a backend.

## Recommended Remediation Order

1. **Protect trust and recovery:** project transient feasibility, solve cancellation, import XSS, corrupt-save boot recovery.
2. **Correct optimizer claims:** exact Gel loadout, per-candidate Credits metadata, real Credits deadline, visible stability tradeoff.
3. **Repair the confirmed responsive breakage:** mobile project/data collisions, result-body inset, overflowing result navigation, and component-owned table scrolling.
4. **Build the shared UI foundation:** dialog controller, accessible naming/status, visual tokens, contrast/touch rules, validation component, and semantic reusable classes.
5. **Recompose the task flow:** header/action hierarchy, first-run/sample state, line cards, result summaries, sticky stale/results navigation, and progressive dialogs.
6. **Harden delivery:** unified tests/CI, real Worker and browser tests, screenshot/geometry gates, release fingerprinting, privacy/accuracy copy, and catalog/release docs.

The companion implementation plan turns this order into executable tasks with file-level ownership, regression-first steps, dependencies, and acceptance gates.
