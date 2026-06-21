---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
  - target: context/tailwind-mapping.md
    condition: when working on Tailwind class → GB style mapping (the deepest domain)
last_updated: 2026-06-21
---

# Architecture

## System Overview

Input HTML/CSS/JS flows through a tag-driven, dual-output pipeline. For the
`convert` command (HTML pages with Tailwind), the Tailwind inliner first loads
the page in headless Chromium, compiles the Tailwind CDN, and parses
`document.styleSheets` into a ClassRegistry mapping each class to its declared
properties. The preprocessor extracts `<style>` blocks into `customCss` and
transfers matched class styles to inline `style` attributes. `verify-prepare`
parses the compiled `styles.css` into a `classNameToProperties` map. The DOM
walker then walks the DOM and emits GenerateBlocks blocks by tag name — twice:
a **fallback** pass (every class kept in `globalClasses`, `styles.css` present,
pixel-perfect reference) and a **processed** pass (mappable classes → inline
`styles`, unmappable classes → `globalClasses`). The CSS splitter splits
`styles.css` into `tailwind-utilities.css` (unmapped utilities) and
`styles-unique.css` (structured + unique CSS). The serializer writes block
markup with `styles` (editor) and `css` (frontend) kept in sync. The validator
enforces WordPress "Attempt Recovery" rules. Output lands in
`output/{project}/{fallback,processed}/`. The `convert` command
(preprocessor → inliner → verify-prepare → dom-walk → serialize → validate)
is the only active pipeline; the legacy M1/fidelity fixture pipeline has been
removed.

## Key Components

- **orchestrator** (`src/core/orchestrator.ts`) — top-level `convert()`; stitches preprocess → inliner → verify-prepare → dom-walk → split → serialize → validate → multi-file output.
- **preprocessor** (`src/core/preprocessor.ts`) — extracts `<style>` → `customCss`, maps class definitions → property dicts, transfers matched class styles to inline `style`; detects inline `<script>` Tailwind configs.
- **tailwind-inliner** (`src/core/tailwind-inliner.ts`) — convert-only: headless Chromium compiles Tailwind CDN → parse `document.styleSheets` → ClassRegistry → per-element assignment → CSS var resolution (`--tw-*`) → normalize (rgb→hex, 0px→0) → desktop-first conversion → consolidate shared sets into `.gb-s-{hash}` classes.
- **verify-prepare** (`src/core/verify-prepare.ts`) — parses `styles.css` → `classNameToProperties` map consumed by the mapper.
- **dom-walker** (`src/core/dom-walker.ts`) — walks DOM, maps tags → blocks (section/div/nav/header/footer/main/article/aside → generateblocks/element; h1–h6/p/span/a/strong/em/small/label → generateblocks/text; img → media/core image; svg → shape; iframe → core embed; ul/ol → core list; blockquote → core quote; form → core/html fallback).
- **tailwind-layout-mapper** (`src/core/tailwind-layout-mapper.ts`) + **token-mapper** (`src/core/token-mapper.ts`) + **gb-whitelist** (`src/core/gb-whitelist.ts`) — the Tailwind utility → GB inline `styles` mapping surface (see `context/tailwind-mapping.md`).
- **css-splitter** (`src/core/css-splitter.ts`) — splits `styles.css` into `tailwind-utilities.css` + `styles-unique.css` (processed pass, `--split`).
- **serializer** (`src/core/serializer.ts`) — blocks → WordPress block markup; `styles` (camelCase) + `css` (kebab, sorted, minified) kept in sync.
- **validator** (`src/core/validator.ts`) — hard-fail & warning checks; enforces the "Attempt Recovery" rules.
- **verify.ts** (`src/cli/verify.ts`) — self-verification: re-runs the mapper on each fallback block's `globalClasses` and diffs against the processed block's `styles`; also `--coverage` for CSS coverage.
- **design-dossier / customizer-generator / iconify-resolver** — auxiliary: design extraction, WordPress customizer JSON, `<iconify-icon>` → inline SVG.

## External Services and References

- **Chromium (via Playwright)** — required for the Tailwind inliner; the Tailwind CDN compiles in-browser, so real `document.styleSheets` are needed. Install with `npx playwright install chromium`.
- **Iconify API** (`api.iconify.design`) — `<iconify-icon>` elements are resolved to inline SVGs at convert time; on failure the element falls back to a core/html block.
- **GenerateBlocks plugin schema** (`plugin/generateblocks/`, `plugin/generateblocks-pro/`, `plugin/gp-premium/`) — canonical block block.json files used to enforce canonical key order per block type (prevents "Attempt Recovery").

## What Does NOT Exist Here

- No WordPress runtime or database — output is paste-ready markup verified by manual paste/save/reload in the WP editor.
- No Squarespace / Wix / Webflow parsers — those exports need a human cleanup pass first (proprietary component systems, attribute-selector CSS).
- No HTTP server — this is a CLI only (`src/cli/index.ts`).
- No CSS-in-JS runtime and no Tailwind build pipeline of its own — Tailwind is resolved at runtime from the source page's CDN/config.
