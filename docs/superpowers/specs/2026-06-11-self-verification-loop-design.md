# Self-Verification Loop — Design Spec

**Date:** 2026-06-11  
**Status:** Design — ready for implementation planning  

## Overview

The GB Converter currently produces WordPress block markup and CSS files, but
verification is entirely manual: copy output, paste in WordPress, save, reload,
check for "Attempt Recovery." This takes 10–15 minutes per page and creates a
slow human-in-the-loop feedback cycle. The goal is a self-verifying converter
that can:

1. Render converted GB output as standalone HTML with all CSS injected
2. Take screenshots of both source and rendered output
3. Compare them pixel-by-pixel, producing a diff image and mismatch report
4. Let a coding agent review the diff, diagnose issues, and fix the converter
5. Repeat until the conversion is visually faithful

This enables converting 10–20 sites per day instead of one page per day.

## Architecture

Three new commands build on the existing `convert` pipeline:

```
Source HTML ──→ convert ──→ GB blocks + CSS ──→ render ──→ standalone HTML
                                                     │
                                                     ↓
                                              compare ──→ diff image + report
                                                     │
                                                     ↓
                                              Agent reviews → fixes → repeats
```

### New source files

```
src/core/
├── renderer.ts        # Parse block delimiters, derive CSS from attrs, inject CSS, wrap HTML
├── screenshotter.ts   # Playwright: load page, wait, capture full-page
├── pixel-differ.ts    # Pixel comparison, mismatch %, diff image generation
src/cli/
└── index.ts           # Add "render" and "compare" subcommands
```

## The `render` Command

Takes GB block output and produces a standalone, self-contained HTML page.

### Input
- `output/<project>/pages/<page>.html` — GB block markup  
- `output/<project>/pages/styles.css` — master CSS (CDN output from `inlineTailwindStyles()`, captured during convert)
- `output/<project>/setup/styles-unique.css` — backgrounds, effects, colors  
- `output/<project>/setup/global-styles.json` — GB Global Styles manifest  
- `output/<project>/setup/global.js` — extracted JS (optional)  

### Output
- `output/<project>/pages/<page>.rendered.html` — self-contained HTML  

### Transformation steps

1. **Parse block delimiters** — Extract the JSON attributes from each
   `<!-- wp:blockname {...} -->` delimiter. The HTML between delimiters is
   preserved. Uses the same parsing logic as the validator. When the `css`
   string in a block's JSON is non-empty, its CSS is injected as a `<style>`
   block scoped to the block's unique class selector.

2. **Derive CSS from GB attributes** — For each block, if promoted attributes
   (`backgroundColor`, `bgImage`, `bgImageSize`, `textColor`, `gradient*`)
   exist but the `css` string doesn't include the equivalent property, inject
   inline styles on the rendered element. This prevents the "magically appears"
   problem where WordPress renders styles from attributes but the standalone
   page doesn't.

3. **Inject CSS** — Inline all stylesheets into `<style>` blocks in `<head>`:
   - `global-styles.json` → expanded to `selector { css }` for each entry
   - `styles-unique.css` → injected as-is
   - `styles.css` → injected as-is. This is the CDN-compiled output from
     `inlineTailwindStyles()` captured during `convert` — NOT a separate
     compilation. Using the same CSS as WordPress ensures identical rendering
     (see Risk A).

4. **Inject font links** — When invoked by the `compare` command (which has
   access to the source HTML), scan source for Google Fonts `<link>` tags
   and `@import` declarations. Inject into rendered `<head>` to prevent
   fallback font layout shifts. When invoked standalone via CLI without
   `--source`, this step is skipped.

5. **Inject JS (optional)** — Add `global.js` if present. Skipped with
   `--no-js` flag (default for faster comparison).

6. **Wrap in document** — Full HTML5 document: `<!DOCTYPE html>`, charset
   meta, viewport meta, all injected `<style>` and `<link>` tags in `<head>`,
   rendered HTML in `<body>`.

### GB Component Stubs
Not needed. The existing layout comes from Tailwind utility classes, which
are fully covered by the injected `styles.css`. Elements without Tailwind
layout classes that would rely on GB's `.gb-element { display: flex; }` are
rare in practice. If discovered during testing, stubs can be added as needed.

### CLI

```bash
npx tsx src/cli/index.ts render output/mino/              # all pages
npx tsx src/cli/index.ts render output/mino/pages/index.html  # single page
npx tsx src/cli/index.ts render output/mino/ --no-js      # skip JS
npx tsx src/cli/index.ts render output/mino/ --source inputs/mino/index.html  # inject fonts
```

## The `compare` Command

Screenshots the source page and the rendered GB output, produces a visual diff.

### Input
- Source HTML file (e.g., `inputs/site/index.html`)  
- Converted output directory (e.g., `output/site/`)  

### Output
```
output/<project>/verify/
├── source.png             # full-page screenshot of source HTML
├── rendered.png           # full-page screenshot of rendered GB output
├── diff.png               # side-by-side: source | rendered | diff overlay
├── compare-report.json    # mismatch %, dimensions, errors
└── verification-log.json  # agent findings (written by agent, not CLI)
```

### Pipeline

1. **Screenshot source** — Load source HTML in headless Chromium via Playwright.
   Wait for network idle, fonts to load, images to load, 500ms settle.
   Force `overflow-y: scroll` on `<html>` to normalize scrollbar presence.
   Capture full-page screenshot at 1440×900 viewport (default, configurable).

2. **Render + screenshot output** — Run `render` on the GB output, then load
   the rendered HTML in a new Playwright context. Same wait strategy, same
   viewport, same scrollbar normalization. Capture full-page screenshot.

3. **Align & diff** — Resize both screenshots to the wider width. Pad shorter
   screenshot with white pixels to match heights. Pixel-by-pixel comparison
   with 0.1 intensity threshold on a 0–1 scale (pixels whose RGB channels
   differ by &lt;10% are matching — catches anti-aliasing noise). Produce diff
   overlay image (mismatched pixels in red) and mismatch percentage.

4. **Write artifacts** — Save all three images and `compare-report.json`.

### Wait strategy

| Step | Description |
|---|---|
| `networkidle` | Playwright built-in — wait for 0 network connections for 500ms |
| `fonts.ready` | `document.fonts.ready` — wait for custom fonts |
| images loaded | All `<img>` elements fire `onload` |
| settle timeout | Extra 500ms for CSS animations/transitions to complete |
| `--wait N` | CLI flag to override settle timeout for JS-heavy pages |

### Pixel diff tolerance

| Band | Mismatch % | Meaning |
|---|---|---|
| `< 1%` | Pass | Conversion is clean |
| `1–5%` | Minor | Agent reviews, likely acceptable or small fixes |
| `> 5%` | Significant | Agent must diagnose and fix |

Threshold is aspirational and will be calibrated after the first 3–5 real
conversion runs.

### Source path resolution

Source HTML loaded via `file://` protocol may have relative paths
(`../assets/logo.png`, `./styles/custom.css`). The compare command resolves
all paths relative to the source file's directory before loading in Playwright.

### CLI

```bash
npx tsx src/cli/index.ts compare inputs/site/index.html output/site/
npx tsx src/cli/index.ts compare inputs/site/index.html output/site/ --threshold 3 --wait 2000
npx tsx src/cli/index.ts compare inputs/site/index.html output/site/ --viewport 375x812  # mobile
npx tsx src/cli/index.ts compare inputs/site/index.html output/site/ --golden  # regression mode
```

### Golden file regression

`--golden` flag saves the current screenshots as golden files. On subsequent
runs, compares against golden instead of source. If mismatch exceeds threshold,
the command exits with a non-zero code — useful for CI or pre-commit hooks.
If golden files don't exist yet, creates them (first run is always "pass").

## Agent Loop

The coding agent orchestrates the verification cycle:

### Single-page workflow

```
0. Clean source — agent runs pre-conversion checklist (bare text, markers)
1. Convert — npx tsx src/cli/index.ts convert inputs/site/
2. Compare — npx tsx src/cli/index.ts compare inputs/site/index.html output/site/
3. Diagnose — agent reviews diff image + compare-report.json
   - Classifies each issue as converter or source
   - Converter issues: would this break on a different site tomorrow?
   - Source issues: specific to this page's HTML
   - Writes findings to verification-log.json
4a. Fix source (source issue) → edit input HTML → go to step 1
4b. Fix converter (converter issue) → edit src/core/ → go to step 1
5. Converge — repeat 2–4 until mismatch < 1% or acceptable
```

### Multi-page workflow

For sites with multiple pages: convert all pages first (shared CSS compiled
once from union of all classes), then compare each page sequentially.
Converter fixes from page 1 cascade to pages 2–N. After all pages pass,
re-run page 1 to verify no regressions from later fixes.

### Stopping rules

| Condition | Action |
|---|---|
| Mismatch < 1% | Stop — pass |
| 3 iterations, no improvement | Stop — log remaining as known gaps |
| 5 total iterations | Hard stop — too many rounds, review manually |
| Same issue, 3rd recurrence | Stop — known systemic gap, file product todo |

### Issue classification

Each finding in `verification-log.json` is tagged:

- **`type: "converter"`** — Systematic gap. Fix the converter code. Will
  benefit all future conversions.
- **`type: "source"`** — Page-specific quirk. Fix the source HTML or add
  a preprocessing pass.

Decision rule: "If I saw this exact same pattern on a different website
tomorrow, would it break again?" Yes → converter. No → source.

### Cross-conversion patterns (Phase 2)

After multiple conversions, accumulated `verification-log.json` files feed
into a `patterns` command that identifies recurring categories. When the same
`category` appears in >N% of conversions, it graduates from "case by case" to
"needs product fix."

## Data Schemas

### `compare-report.json`

Written by the `compare` command after each run.

```json
{
  "page": "index",
  "timestamp": "2026-06-11T18:30:00Z",
  "iteration": 2,

  "source": {
    "file": "inputs/hkvc/index.html",
    "viewport": { "width": 1440, "height": 900 },
    "dimensions": { "width": 1440, "height": 5847 },
    "status": "ok"
  },

  "rendered": {
    "file": "output/hkvc/pages/index.rendered.html",
    "dimensions": { "width": 1440, "height": 5812 },
    "status": "ok",
    "warnings": [
      { "code": "IMAGE_404", "url": "https://...", "count": 2 }
    ]
  },

  "diff": {
    "mismatchPct": 12.3,
    "mismatchPixels": 1034587,
    "totalPixels": 8415328,
    "threshold": 0.1,
    "band": "significant"
  },

  "errors": []
}
```

**Error codes:** `SOURCE_LOAD_FAILED`, `RENDERED_LOAD_FAILED`, `SCREENSHOT_FAILED`,
`DIFF_FAILED`, `VIEWPORT_MISMATCH`.

### `verification-log.json`

Written by the agent after reviewing each compare run.

```json
{
  "project": "hkvc",
  "iterations": [
    {
      "iteration": 1,
      "timestamp": "2026-06-11T18:25:00Z",
      "mismatchPct": 12.3,
      "findings": [
        {
          "id": "F-1",
          "type": "converter",
          "category": "style-promotion",
          "description": "bgImage not promoted from Tailwind arbitrary value class",
          "location": "src/core/gb-attribute-mapper.ts",
          "status": "fixed"
        }
      ],
      "resolution": "partial"
    }
  ],
  "golden": {
    "saved": false,
    "mismatchPct": null,
    "screenshot": null
  }
}
```

**Finding statuses:** `open`, `fixed`, `deferred`, `known-gap`.  
**Resolution statuses:** `fixed` (all findings resolved), `partial` (some resolved),
`stuck` (no improvement this iteration), `passed` (mismatch < 1%, no findings needed).

## Risk Analysis & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| A | Source uses Tailwind CDN, rendered uses compiled CSS — different output → false positives | HIGH | Use exact same CDN output from `inlineTailwindStyles()` for both convert and render |
| B | Promoted GB attributes remove CSS from `css` string — rendered page loses styles | HIGH | Renderer parses block JSON and derives CSS from GB attributes, injecting as inline styles |
| C | Missing font links in rendered page — fallback fonts cause layout shift | MED | Renderer scans source for font `<link>` tags and injects into rendered `<head>` |
| D | Height mismatch skews pixel diff — misaligned rows produce false mismatch | MED | Pad shorter screenshot with white pixels; report height delta as warning |
| E | Block delimiter stripping collides with real HTML comments in core/html blocks | MED | Use precise `<!-- wp:... -->` regex, only match known block patterns |
| H | Renderer must parse block JSON (not just strip) to handle Risk B | MED | Parse delimiters using existing validator logic before stripping |
| I | Scrollbar presence differs between pages — shifts layout by ~15px | MED | Inject `html { overflow-y: scroll }` on both pages before screenshot |
| J | Cookie banners / popups overlay source page | MED | Phase 1: accept as limitation. Agent identifies and manually handles. Phase 2: `--hide-popups` flag |
| K | Threshold calibration unknown — <1% may be unrealistic baseline | MED | Calibrate after 3–5 real runs; start with aspirational <1%, let agent use judgment |
| F,G,L | Lazy images, JS animations, browser context isolation | LOW | Handled by `--no-js` default and wait strategy |

## Testing Strategy

### Unit tests

- **`renderer.test.ts`** — Block delimiter parsing, CSS derivation from GB attrs,
  global-styles.json → CSS expansion, font link extraction, document wrapping
- **`pixel-differ.test.ts`** — Same-image diff (0% mismatch), known-difference diff,
  height padding, threshold calibration
- **`screenshotter.test.ts`** — Viewport handling, wait strategy, scrollbar normalization

### Integration tests

- **`compare.test.ts`** — End-to-end: known-good fixture HTML → convert → compare → verify
  mismatch < 1%. Tests the full pipeline from source to diff.
- **Golden regression test** — Save golden files for a known-good fixture, verify
  re-running with `--golden` produces 0% mismatch.

### Fixtures needed

- `fixtures/verify/good-simple.html` — A simple page with inline styles only (no Tailwind),
  known to convert cleanly. Used as baseline for render + compare.
- `fixtures/verify/good-tailwind.html` — A Tailwind-based page known to convert cleanly.
  Validates CDN-vs-compiled CSS equivalence.

## Phase 2 (Future)

### WordPress Sandbox

A WordPress instance (local or cloud staging) that the agent can access via
MCP or REST API to:

1. Paste converted block markup into a post
2. Save and reload
3. Check for "Attempt Recovery" triggers
4. Inspect rendered frontend output
5. Compare against source screenshots

This closes the final verification gap: structural survival in real WordPress.
The sandbox is used sparingly — only after the local render+compare loop converges.

### Cross-Conversion Patterns

A `patterns` command that aggregates `verification-log.json` files across
multiple conversions and identifies recurring categories. When the same issue
category appears in >N% of conversions, it's promoted to a product fix todo.

### Section-Level Diffing

Currently full-page diff only. For faster diagnosis on long pages, add
per-section mismatch stats by splitting screenshots at known section boundaries.

## CLI Command Summary

| Command | Purpose | Phase |
|---|---|---|
| `convert` | HTML → GB blocks + CSS | Existing |
| `render` | GB blocks → standalone HTML | **Phase 1** |
| `compare` | Source vs rendered → diff image + report | **Phase 1** |
| `compare --golden` | Regression check against saved screenshots | **Phase 1** |
| `patterns` | Cross-conversion issue pattern detection | Phase 2 |
