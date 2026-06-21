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

# Tests (Node built-in runner + tsx loader)
node --import tsx --test tests/*.test.ts
# Single test file
node --import tsx --test tests/<file>.test.ts
```

## CLI Command Surface

`convert <input.html|dir/> [--skip-shared] [--split]` · `project:setup <dir/>` · `verify:prepare`.

Convert flags: `--skip-shared` (skip shared `styles.css`/manual-steps on subsequent pages of a project run), `--split` (also generate a processed/setup/ directory with tailwind-utilities.css, styles-unique.css, and rejected.json). Note: the CLI help text in `src/cli/index.ts` still mentions global-styles.json, but the `--split` code path no longer writes it — only the three files listed here.

## Common Issues

- **`npm run build`** — `tsc` typecheck (`tsconfig.json` `noEmit: true`, so nothing is emitted). Exits 0 cleanly.
- **Tailwind v3 + v4 coinstall** — `tailwindcss3` is an npm alias to `tailwindcss@^3.4.19` so both versions resolve; do not remove either.
- **Playwright Chromium missing** — the Tailwind inliner fails fast without it; run `npx playwright install chromium`.
- **Tests** — CONTRIBUTING.md mentions Vitest for the layout mapper, but Vitest is not installed and every test file imports `node:test`. Use `node --import tsx --test tests/*.test.ts` (216 tests).
- **`convert` on a project dir** compiles `styles.css` once from the union of all pages' classes, then converts each page. For subsequent single-page runs use `--skip-shared`.
- **Squarespace / Wix / Webflow exports** — out of scope; clean the markup first (see README "Out of scope").
