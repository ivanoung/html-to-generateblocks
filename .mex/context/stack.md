---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
  - target: context/tailwind-mapping.md
    condition: when working with the Tailwind v3/v4 mapping surface
last_updated: 2026-06-21
---

# Stack

## Core Technologies

- **TypeScript** (ESM, strict) — primary language; `tsconfig.json` targets ES2022, `module: ESNext`, `moduleResolution: bundler`, `noEmit: true` (tsc is typecheck-only).
- **Node.js 18+** (22 recommended; the test suite is run on v22.22.3) — runtime.
- **tsx** — direct TS execution with no build step; also used as the test loader (`node --import tsx --test`).

## Key Libraries

- **cheerio** `^1.2.0` — server-side DOM parsing/walking for the preprocessor and DOM walker.
- **css** `^3.0.0` — CSS parser used by the style parser / CSS splitter.
- **postcss** `^8.5.15` — CSS post-processing.
- **playwright** `^1.60.0` — drives headless Chromium for the Tailwind inliner (the Tailwind CDN compiles in-browser).
- **tailwindcss** `^4.3.0` + **tailwindcss3** (aliased to `tailwindcss@^3.4.19`) — both v3 and v4 are coinstalled so the resolver can handle either config format from source pages.
- **mex-agent** `^0.6.1` (dev) — drift-detection CLI for this scaffold (`mex check` / `mex sync`).

## Tooling

- **Package manager:** npm.
- **Test runner:** Node.js built-in test runner (`node:test` + `node:assert`) via the tsx loader — `node --import tsx --test tests/*.test.ts`. (CONTRIBUTING.md mentions Vitest for the layout mapper, but every test file imports `node:test`; Vitest is not installed.)
- **Build:** `npm run build` runs `tsc` but emits nothing (`noEmit: true`) — it is a typecheck, not a bundler.
- **No linter / formatter configured.**

## Rationale

- **tsx + ESM, no build step** — prototype velocity; iterate without a compile barrier (see `context/decisions.md`).
- **cheerio over a browser DOM for the walker** — fast server-side traversal; Chromium is reserved strictly for where it is unavoidable (Tailwind CDN compilation).
- **Playwright for Tailwind resolution** — the Tailwind CDN compiles stylesheets in the browser; static resolution cannot reproduce `document.styleSheets`, so a real headless browser is required.
- **Dual tailwind v3 + v4** — source sites use either version; coinstalling both (via the `tailwindcss3` alias) lets the resolver handle either config format.
