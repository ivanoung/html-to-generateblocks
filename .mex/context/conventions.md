---
name: conventions
description: How code is written in this project — naming, structure, patterns, and style. Load when writing new code or reviewing existing code.
triggers:
  - "convention"
  - "pattern"
  - "naming"
  - "style"
  - "how should I"
  - "what's the right way"
edges:
  - target: context/architecture.md
    condition: when a convention depends on understanding the system structure
  - target: context/tailwind-mapping.md
    condition: when the convention concerns Tailwind class mapping
  - target: context/setup.md
    condition: when looking up the verify commands referenced in the Verify Checklist
last_updated: 2026-06-21
---

# Conventions

## Naming

- **Files:** kebab-case (`tailwind-layout-mapper.ts`, `dom-walker.ts`, `verify-prepare.ts`).
- **Functions:** camelCase, verb-first (`tailwindLayoutToGbAttributes`, `isGbSupported`, `extractBlocks`).
- **Block JSON keys:** camelCase (`uniqueId`, `tagName`, `globalClasses`, `htmlAttributes`).
- **CSS:** kebab-case properties; the `css` string is sorted, single-line, minified.
- **Reusable consolidated classes:** `.gb-s-{hash}` (hash of the shared property set); original source class names (e.g. `.blueprint-bg`) are preserved.

## Structure

- `src/core/` — pipeline modules (one responsibility each: preprocessor, inliner, verify-prepare, dom-walker, mapper, css-splitter, serializer, validator, + the mapping surface + auxiliaries).
- `src/cli/` — `index.ts` (command surface) and `verify.ts` (self-verification).
- `src/runner/` — `run-fixture.ts` (M1 + fidelity orchestration).
- `tests/` — `*.test.ts` using `node:test`; `tests/snapshots/` holds M1 golden files.
- `fixtures/` — JSON fixtures (M1 + fidelity + DOM-walk + preprocess suites).
- `inputs/` — raw HTML sites for the `convert` command (e.g. `inputs/mino/`).
- `plugin/` — GenerateBlocks / GP-Premium plugin JSON, used as the canonical key-order reference.
- `config/` — Tailwind config samples.
- `output/` — generated output (gitignored), organised by project.

## Code Patterns

- **Dual output** — every `convert` produces fallback/ (pixel-perfect reference) and processed/ (editor-ready). Never emit one without the other.
- **`styles` vs `css`, kept in sync** — properties with a GB editor panel go to BOTH `styles` (camelCase) and `css` (kebab); properties without a panel go to `css` only. Shorthand (padding/margin/border-radius) is expanded to granular keys in `styles` but kept as shorthand in `css`. Editor preview and frontend render must match.
- **Desktop-first cascade** — base styles at top, `@media(max-width:1024px)` (tablet) and `@media(max-width:768px)` (mobile) overrides below. Tailwind is mobile-first; the inverter flips it (largest breakpoint → base; smaller → `@media(max-width: N-1px)` resets). Both `styles` and `css` carry the `@media` blocks.
- **Canonical key order** per block type — taken from `plugin/generateblocks/<block>/block.json`. Never reorder keys arbitrarily.
- **Four JSON escapes** in block markup: `--` → `\u002d\u002d`, `&` → `\u0026`, `<` → `\u003c`, `>` → `\u003e`.
- **`<a>` handling** — text-only `<a>` → generateblocks/text with `href` in `htmlAttributes` (never in `content`); `<a>` with inner blocks → generateblocks/element (tagName `a`).
- **Tag-driven mapping** — see `context/architecture.md` for the full tag → block table.

## Verify Checklist

Run every item explicitly before claiming a change is done (this is ROUTER step 3):

1. `npm run build` — `tsc` passes with no errors (typecheck).
2. `npx tsx src/cli/index.ts regression` — all M1 fixtures match `tests/snapshots/`.
3. `node --import tsx --test tests/*.test.ts` — all tests pass.
4. `npx tsx src/cli/verify.ts --output output/<site>` — zero discrepancies (layout fidelity).
5. (Optional) `npx tsx src/cli/verify.ts --output output/<site> --coverage` — CSS coverage for used classes.
6. Block-level recovery rules hold: no `className` in block JSON (use `globalClasses`); no descendant selectors, no `transition`, no hover rules in `css`; four JSON escapes applied; canonical key order per block type.
7. `styles` and `css` are in sync — editor preview and frontend render identically.

## What Not To Do

- Do not map colour classes (`bg-*`/`text-*`/`border-*` using `--tw-*` vars), state modifiers (`hover:`/`focus:`/`group-hover:`), or transition/animation classes to inline `styles` — they stay as utility classes backed by `tailwind-utilities.css` by design.
- Do not read Tailwind config font families dynamically (`font-display`, `font-mono`) — they stay in `globalClasses`.
- Do not add a build/bundle step — execution is via `tsx`.
