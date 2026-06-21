---
name: convert-a-new-input-site
description: Convert a new HTML site/page to GenerateBlocks markup — the most common task. Use when dropping a new site into inputs/ and running convert.
triggers:
  - "convert"
  - "new site"
  - "new page"
  - "html to gb"
  - "inputs"
edges:
  - target: context/setup.md
    condition: for the exact convert/verify commands and flags
  - target: context/tailwind-mapping.md
    condition: when deciding whether a class should map to inline styles or stay a utility
  - target: patterns/debug-conversion-discrepancy.md
    condition: when verify.ts reports discrepancies after converting
last_updated: 2026-06-21
---

# Convert a New Input Site

## Context

Load `context/architecture.md` (pipeline) and `context/setup.md` (commands).
Source HTML lives under `inputs/<site>/` (e.g. `inputs/mino/`). Output lands in
`output/<site>/{fallback,processed}/`. Chromium must be installed
(`npx playwright install chromium`) for the Tailwind inliner.

## Steps

1. Drop the site's HTML (and assets) into `inputs/<site>/`. Keep `index.html` at the site root.
2. Run the pre-conversion checklist: wrap any bare text inside section, article, aside, header, main, div in `<p>` or `<span>` to avoid `FIX_SOURCE` hard fails.
3. Add `data-gb-wrap="core-html"` to any element that must stay as raw HTML (forms, custom charts, JSON `<script>`).
4. Convert the whole site (shared `styles.css` from the union of all pages, with CSS split):
   ```bash
   npx tsx src/cli/index.ts convert inputs/<site>/ --split
   ```
   For a single page: `npx tsx src/cli/index.ts convert inputs/<site>/index.html`.
   For subsequent pages after a project run, add `--skip-shared`.
5. Check `output/<site>/processed/pages/*.report.json` for `hardFails` and `overallStatus`.
6. Verify layout fidelity:
   ```bash
   npx tsx src/cli/verify.ts --output output/<site>
   ```
   Expect zero discrepancies.
7. (Optional) CSS coverage:
   ```bash
   npx tsx src/cli/verify.ts --output output/<site> --coverage
   ```
8. Manual WordPress check: paste `output/<site>/processed/pages/<page>.html` into the WP code editor (Ctrl+Shift+Alt+M), save, reload, confirm no "Attempt Recovery".

## Gotchas

- **Shared `styles.css`** is compiled once from the union of all pages' classes in a project-mode run. Re-running a single page without `--skip-shared` recompiles it.
- **`<iconify-icon>`** is auto-resolved to inline SVG via the Iconify API; on failure it falls back to core/html.
- **Colour / state / transition classes** stay in `globalClasses` by design — do not try to force them inline (see `context/tailwind-mapping.md`).
- **Squarespace / Wix / Webflow exports** need a human cleanup pass first — out of scope.
- **`leading-*` + responsive `text-*`** may pick the largest breakpoint's lineHeight (see `docs/superpowers/learnings/2025-06-21-v3-cascade-precedence.md`).

## Verify

- [ ] `output/<site>/processed/pages/*.report.json` shows `overallStatus: validator_pass` and `hardFails: 0`.
- [ ] `npx tsx src/cli/verify.ts --output output/<site>` → zero discrepancies.
- [ ] `node --import tsx --test tests/*.test.ts` green.
- [ ] Paste/save/reload in WordPress → no "Attempt Recovery".

## Debug

See `patterns/debug-conversion-discrepancy.md`.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if a new site exposes a new limitation or a new block type starts working.
- [ ] Update `.mex/context/tailwind-mapping.md` if a class category's mapping behaviour changed.
- [ ] If this site revealed a recurring gotcha, add a pattern and update `.mex/patterns/INDEX.md`.
