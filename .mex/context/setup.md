---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/architecture.md
    condition: when understanding how components connect during setup
  - target: context/conventions.md
    condition: when looking up the Verify Checklist
last_updated: 2026-06-21
---

# Setup

## Prerequisites

- **Node.js 18+** (22 recommended; the test suite is run on v22.22.3).
- **npm**.
- **Chromium** for the Tailwind inliner — install once: `npx playwright install chromium`.

## Install

```bash
npm install
```

## Common Commands

```bash
# Typecheck (tsc, noEmit — no dist is emitted)
npm run build

# Dev watch
npm run dev

# Convert an entire site (all pages, shared styles.css, with CSS split)
npx tsx src/cli/index.ts convert inputs/<site>/ --split

# Convert a single page
npx tsx src/cli/index.ts convert inputs/<site>/index.html

# Verify layout fidelity (processed vs fallback)
npx tsx src/cli/verify.ts --output output/<site>

# CSS coverage report
npx tsx src/cli/verify.ts --output output/<site> --coverage

# M1 regression against snapshots
npx tsx src/cli/index.ts regression

# Run all fixtures
npx tsx src/cli/index.ts fixtures:run-all

# Tests (Node built-in runner + tsx loader)
node --import tsx --test tests/*.test.ts
# Single test file
node --import tsx --test tests/<file>.test.ts
```

## CLI Command Surface

`fixtures:list` · `fixtures:run <name>` · `fixtures:run-all` · `convert <input.html|dir/> [--skip-shared] [--split]` · `validate <name>` · `report:update <name> --pasted true --saved true --notes "..."` · `regression`.

Convert flags: `--skip-shared` (skip shared `styles.css`/manual-steps on subsequent pages of a project run), `--split` (also generate processed/setup/ with `global-styles.json`, `tailwind-utilities.css`, `styles-unique.css`, `rejected.json`).

## Common Issues

- **`npm run build` emits nothing** — by design (`tsconfig.json` `noEmit: true`); it is a typecheck, not a build. It currently reports pre-existing errors (`tailwind-inliner.ts` needs `dom` lib; `tailwind-layout-mapper.ts` has a circular `GbStyles` alias) that do not block the `tsx` runtime — see `ROUTER.md` Known issues.
- **Tailwind v3 + v4 coinstall** — `tailwindcss3` is an npm alias to `tailwindcss@^3.4.19` so both versions resolve; do not remove either.
- **Playwright Chromium missing** — the Tailwind inliner fails fast without it; run `npx playwright install chromium`.
- **Tests** — CONTRIBUTING.md mentions Vitest for the layout mapper, but Vitest is not installed and every test file imports `node:test`. Use `node --import tsx --test tests/*.test.ts` (216 tests).
- **`convert` on a project dir** compiles `styles.css` once from the union of all pages' classes, then converts each page. For subsequent single-page runs use `--skip-shared`.
- **Squarespace / Wix / Webflow exports** — out of scope; clean the markup first (see README "Out of scope").
- **Fixture-based commands broken** — `regression`, `fixtures:run`, `fixtures:run-all`, `validate`, `report:update` all read fixtures/*.json (and `regression` reads snapshots/m1/*.html), but both fixtures/ and snapshots/ are gitignored (`.gitignore` lines 11–12) and not in the repo, so these commands throw ENOENT. The reliable verification path is `convert` + `verify.ts` + `node --import tsx --test` (see `context/conventions.md` Verify Checklist).
