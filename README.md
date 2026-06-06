# Forge Planner

A steady-state crafting-line optimizer for a power-law compression economy. Enter your own per-level stats (cost + time) for each input and craft, set your crafter line caps, pick the outputs you want, and it computes the optimal assignment that runs forever without starving — maximizing throughput at a priority-weighted output ratio.

Everything runs client-side. No backend, no build step, no data leaves the browser. It's a single `index.html`.

## What it does

- **Inputs:** Ingots, Bits, Concrete (raw producers — time only)
- **Crafts:** Glass (←Bits), Bricks (←Concrete), Plates (←Ingots), Rods (←Ingots), Frames (←Plates + Rods; Bits pre-produced)
- **Per-line caps:** each crafter line has its own max compression, 1×–1024×
- **Multi-output:** select several outputs at once; the priority slider sets the *ratio* (higher = more of that one), and the solver maximizes the weighted floor so you always get a real mix
- **Persistence:** auto-saves to `localStorage`; Export/Import a build as JSON to share setups

The solver is branch-and-bound with symmetry reduction over identical lines — instant at 5 lines, fine at 6+.

> Note: `localStorage` works once the site is deployed (or opened from a local file in a browser). Some embedded preview sandboxes block it; the app falls back to in-memory state there.

---

## Deploy to GitHub + Vercel

### Option A — no command line (easiest)

1. **GitHub:** go to <https://github.com/new>, name the repo (e.g. `forge-planner`), create it.
2. On the new repo page, click **uploading an existing file**, drag in `index.html` (and this `README.md`), commit.
3. **Vercel:** go to <https://vercel.com/new>, sign in with GitHub, **Import** the `forge-planner` repo.
4. Framework Preset: **Other**. Leave Build Command and Output Directory **empty**. Click **Deploy**.
5. Done — you get a live `https://forge-planner-xxxx.vercel.app` URL. Every future push to the repo auto-deploys.

### Option B — command line

```bash
# in the folder containing index.html
git init
git add index.html README.md
git commit -m "Forge Planner v1"
git branch -M main
git remote add origin https://github.com/<your-username>/forge-planner.git
git push -u origin main
```

Then either import the repo at <https://vercel.com/new> (as in Option A, steps 3–5), or deploy directly with the Vercel CLI:

```bash
npm i -g vercel
vercel          # follow prompts; accept defaults (it's a static site)
vercel --prod   # promote to production
```

### Custom domain (optional)

In the Vercel project → **Settings → Domains**, add a domain you own and follow the DNS instructions. Free `.vercel.app` subdomains work out of the box.

---

## Editing later

It's one file. Open `index.html`, change it, commit/push — Vercel redeploys automatically. The default data ships with the Bricks/Glass/Concrete/Bits numbers pre-filled so you can sanity-check it loads (Bricks should read ~13,824/hr on the default 1024/1024/128/64/32 line setup).
