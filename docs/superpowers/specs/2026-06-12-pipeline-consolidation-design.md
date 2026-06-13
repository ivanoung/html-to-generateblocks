# Pipeline Consolidation — Design Spec

**Date:** 2026-06-12  
**Status:** Design — ready for implementation planning  

## Overview

The conversion pipeline currently has 23 modules with overlapping responsibilities.
Styles captured from the browser (computed styles) are injected into HTML as inline
`style="..."` attributes, then re-parsed by the DOM walker — a lossy round-trip
that introduces fidelity gaps. Three modules are consolidated to eliminate this
round-trip, and the self-verification modules are detached from the conversion flow.

### Goals

1. **Pixel preservation**: every visual pixel matches the source when rendered in
   WordPress. The browser's computed styles are the single source of truth.
2. **GB fidelity**: styles flow into the GB priority hierarchy (Customizer →
   Global Styles → Inline `styles`/GB attributes → CSS fallback) with zero
   intermediate HTML transformations.
3. **Consolidation**: fewer modules, fewer transformation steps, fewer failure
   points.

---

## Changes

### 1. Remove Cheerio inline-style injector

**Current state** (in `orchestrator.ts`): classified inline styles are applied as
`style="padding-top:64px;..."` attributes on elements matched by `data-gb-path`,
using Cheerio to modify the HTML. The DOM walker then parses these back via
`style-parser.ts`.

**New state**: the orchestrator no longer modifies HTML to inject styles. Instead,
the classified style lookup table is passed directly to the DOM walker. The walker
queries it when building each block.

**Files affected**: `src/core/orchestrator.ts` — remove ~40 lines of Cheerio
injection code, pass `classifiedInlineStyles` to walker instead.

### 2. Move `data-gb-path` injection into the Playwright session

**Current state**: `tailwind-cleaner.ts` uses Cheerio to inject `data-gb-path`
attributes on the source HTML BEFORE the inliner runs. The inliner then loads
this modified HTML in Playwright.

**New state**: `data-gb-path` attributes are injected via `page.evaluate()` inside
the `tailwind-inliner.ts` Playwright session. The source HTML is NOT modified on
disk — paths exist only in the browser DOM. The DOM walker receives paths through
the classified style lookup table (keyed by path), not from HTML attributes.

**Why**: eliminates a Cheerio parse→modify→serialize cycle. The browser DOM is
the single environment where paths are assigned and styles are captured.

**Files affected**:
- `src/core/tailwind-inliner.ts` — add `page.evaluate()` to inject paths before
  capturing computed styles
- `src/core/tailwind-cleaner.ts` — reduced to bare-text warnings only (no path injection).
  Path injection moves to `tailwind-inliner.ts` via `page.evaluate()`.

### 3. Refactor `style-classifier` → direct lookup table

**Current state**: `classifyStyles()` returns `ClassifiedStyles` with three
sections: `customizer`, `globalStyles`, `inlineStyles`. The `inlineStyles` section
is keyed by `data-gb-path` and is injected into HTML by the orchestrator.

**New state**: `classifyStyles()` returns the same structure, but the
`inlineStyles` map is passed directly to the DOM walker. The walker receives
it as a constructor parameter or function argument. When building a block for
element with path `section#hero`, the walker calls `inlineStyles["section#hero"]`
and populates `block.styles` directly — no HTML round-trip.

**Interface change**:

```typescript
// Before: styles injected into HTML, walker parses them back
// After: styles passed directly to walker
export function walkDom(
  html: string,
  classNameToProps: Map<string, Record<string, string>>,
  collector: GlobalStylesCollector,
  skipStripNavFooter?: boolean,
  computedStyles?: Record<string, Record<string, string>>,  // NEW
): WalkResult;
```

**Files affected**:
- `src/core/style-classifier.ts` — no interface change needed; the return type
  stays the same
- `src/core/dom-walker.ts` — accept `computedStyles` parameter, query it when
  building blocks, populate `block.styles` directly
- `src/core/orchestrator.ts` — pass `classifiedInlineStyles` to `walkDom()`

### 4. Detach self-verification from conversion

**Current state**: `renderer.ts`, `screenshotter.ts`, `pixel-differ.ts` are in
`src/core/` alongside conversion modules. The `compare` CLI command can be
invoked after `convert`.

**New state**: these modules remain in the codebase and are usable as standalone
CLI commands (`render`, `compare`), but they are NOT called during `convert`.
No orchestrator changes invoke them. The user verifies output visually.

**No code changes needed** — this is a usage convention. The modules are already
separate CLI commands.

---

## Pipeline After Consolidation

```
Source HTML
  │
  ▼
tailwind-inliner.ts (Playwright session)
  ├── Inject data-gb-path via page.evaluate()          [was: tailwind-cleaner]
  ├── Compile Tailwind CDN (existing)
  ├── Capture compiled CSS (existing)
  └── Capture per-element computed styles (existing)
  │
  ▼
style-classifier.ts
  ├── Customizer: colors, fonts                        [unchanged]
  ├── Global Styles: shared property sets (≥3 uses)    [unchanged]
  └── Inline styles: unique per element                [unchanged, now passed directly]
  │
  ▼
iconify-resolver.ts                                    [unchanged]
  │
  ▼
preprocessor.ts                                        [unchanged]
  │
  ▼
dom-walker.ts                                          [MODIFIED: queries computedStyles directly]
  └── Populates block.styles from computed styles
  │
  ▼
serializer.ts + gb-attribute-mapper.ts                 [unchanged]
  │
  ▼
validator.ts                                           [unchanged]
  │
  ▼
Output: block HTML + css-splitter + customizer + global.js + manual-steps
```

### Eliminated

- ❌ Cheerio inline-style injector (~40 lines in orchestrator)
- ❌ `tailwind-cleaner.ts` path injection (path injection moves to inliner)
- ❌ `style="..."` round-trip (walker queries computed styles directly)

---

## Module Count

| Before | After | Change |
|---|---|---|
| 23 | 20 | Style-classifier refactored, cleaner merged, injector removed, self-verification detached |

---

## Testing

### Existing tests that must still pass
- `tests/renderer.test.ts`
- `tests/screenshotter.test.ts`
- `tests/pixel-differ.test.ts`
- `tests/compare.test.ts`
- `tests/gb-attribute-mapper.test.ts`
- `tests/css-splitter.test.ts`
- `tests/script-extractor.test.ts`
- `tests/preprocessor-custom-css.test.ts`

### Modified tests
- `tests/dom-walker.test.ts` (if exists) — add test for `computedStyles` parameter
- `tests/style-classifier.test.ts` — ensure return type unchanged

### New test
- Integration test: convert HKVC, verify block output has `styles` populated
  from computed values, verify no `data-gb-path` attributes leak into output

---

## What This Does NOT Change

- `css-splitter.ts` — still splits CSS into global-styles.json + styles-unique.css
- `customizer-generator.ts` — still generates Customizer import from Tailwind config
- `script-extractor.ts` — still generates global.js with CDN loads
- `manual-steps.ts` — still generates installation checklist
- `validator.ts` — still validates block output
- `serializer.ts` — still assembles WP block markup
- `gb-attribute-mapper.ts` — still promotes styles to GB attributes
- `dom-walker.ts` tag→block mapping logic — unchanged, only the style source changes
