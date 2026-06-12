# Tailwind Computed-Style Promotion — Design Spec

**Date:** 2026-06-11  
**Status:** Design — ready for implementation planning  

## Overview

The GB Converter currently handles Tailwind sites by capturing compiled CSS
(via `tailwind-inliner.ts`) and passing Tailwind classes through as
`globalClasses`. This produces pixel-accurate frontend rendering but leaves
all block `styles` objects empty — zero GB editor attributes promoted, zero
editor visibility.

This spec extends the pipeline to capture **per-element computed styles**
from the same Playwright session, then classify and distribute those
properties into GB's styling hierarchy:

> 1. Customizer → 2. Global Styles → 3. Inline `styles` → 4. styles-unique.css

All classification rules are deterministic: type-based, frequency-based, or
token-based. Zero AI judgment, zero regex-based class name guessing.

---

## Architecture

### Pipeline (extended)

```
Source HTML
  │
  ├── [NEW] tailwind-cleaner.ts  — structural cleanup (Tailwind sites only)
  │
  ▼
tailwind-inliner.ts (existing, extended)
  ├── Capture compiled CSS (existing)
  ├── Capture class names (existing)
  └── Capture per-element computed styles (NEW)
  │
  ▼
[NEW] style-classifier.ts
  ├── Customizer: colors (config → actually used), fonts, base font size
  ├── Global Styles: computed property sets appearing ≥3 times
  ├── Inline: computed property sets appearing <3 times (unique per block)
  └── styles-unique.css: preflight, keyframes, pseudo-elements (existing split)
  │
  ▼
dom-walker.ts (modified)
  └── Query classified styles when creating each block
  │
  ▼
serializer.ts (modified)
  └── Populate block `styles`, GB attributes via gb-attribute-mapper
```

### New & modified files

```
src/core/
├── tailwind-cleaner.ts     # NEW: structural cleanup for Tailwind sites
├── tailwind-inliner.ts     # MODIFY: add captureComputedStyles()
├── style-classifier.ts     # NEW: frequency/type-based classification
├── dom-walker.ts           # MODIFY: query classifier for block styles
├── serializer.ts           # MODIFY: receive classified styles
├── gb-attribute-mapper.ts  # MODIFY: may need minor property key updates
├── customizer-generator.ts # MODIFY: accept Tailwind config colors
├── orchestrator.ts         # MODIFY: wire cleaner + classifier between inliner and walker

tests/
├── tailwind-cleaner.test.ts     # NEW
├── style-classifier.test.ts     # NEW
```

---

## 1. Structural Cleanup (`tailwind-cleaner.ts`)

Runs before the main pipeline when `usesTailwind(html)` returns true.
Pure function: HTML in → cleaned HTML out. No guessing.

| Input pattern | Action |
|---|---|
| Raw text nodes at block level (not wrapped in `<p>`, `<span>`, etc.) | Wrap in `<span>` for short phrases, `<p>` for sentences |
| `<body>` class attributes | Capture for wrapper div (existing behavior, preserved) |
| `<style>` blocks with `@import` for fonts | Note font URLs (already handled by existing font extractor) |
| `<script>` with `tailwind.config` | Extract config JSON, remove from source (already handled) |
| Whitespace-only text nodes between block elements | Strip |
| Empty `<div>` elements (no children, no content) | Remove |

**Interface:**

```typescript
export function cleanTailwindSource(html: string): {
  html: string;
  warnings: string[];
}
```

---

## 2. Computed Style Capture (extending `tailwind-inliner.ts`)

The existing `compileWithPlaywright()` already loads the page in headless
Chromium with Tailwind CDN. We add a new step: after CSS compilation,
capture `getComputedStyle()` for every element that will become a GB block.

### Element identification

The structural cleaner (`tailwind-cleaner.ts`) injects `data-gb-path` attributes
on elements matching the DOM walker's target tags **before** the inliner runs.
This ensures the same path identifiers appear in both:
- The Playwright browser DOM (used for computed style capture)
- The source HTML DOM (used by the walker)

The path is a stable CSS selector: `section#hero`, `div.gb-wrapper > header`,
or an index-based fallback for elements with no id/class.

### Captured properties

Not ALL computed properties — only those relevant to GB panels and layout:

```typescript
const CAPTURED_PROPERTIES = [
  // Layout & spacing
  "display", "flexDirection", "gap", "paddingTop", "paddingRight",
  "paddingBottom", "paddingLeft", "marginTop", "marginRight",
  "marginBottom", "marginLeft",
  // Typography
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "textAlign", "textTransform", "color",
  // Backgrounds
  "backgroundColor", "backgroundImage", "backgroundSize",
  "backgroundPosition", "backgroundRepeat",
  // Borders
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius",
  "borderBottomLeftRadius",
  // Effects
  "opacity", "boxShadow",
];
```

### Return type

```typescript
export interface ComputedStyleMap {
  [elementPath: string]: Record<string, string>;
}

// Added to InlinerResult:
export interface InlinerResult {
  html: string;
  stylesCss: string;
  classNames: string[];
  computedStyles: ComputedStyleMap;  // NEW
  warnings: string[];
}
```

---

## 3. Style Classification (`style-classifier.ts`)

Pure function: takes the inliner result → produces classified output.

### Classification rules

#### Level 1: Customizer

**Colors**: All color tokens from `tailwind.config.theme.extend.colors` that
**actually appear** in computed styles anywhere on the page. Skip config
entries that are never used. Each color becomes a CSS custom property
(`--gb-color-slate-800: #272f31`) in `customizer-import.json`.

**Fonts**: Body font-family (from `<body>` computed style or CSS reset),
heading font-family (from any `h1`-`h6` computed style). If same, only one
token. Base font size from root element.

**Already partially implemented** in `customizer-generator.ts` — this extends
it to use computed values rather than regex-extracted config values.

#### Level 2: Global Styles

Computed property sets (same properties with same values) appearing on
**≥3 elements** become shared classes: `.gb-s-{hash}`. Each shared class
goes to `global-styles.json` with the standard `{name, selector, css}` format.

**Deduplication**: Property sets are hashed (sorted keys + values → SHA-like
hash). Elements with the same exact property set share the same Global Styles
class. Frequency counts are per unique set, not per individual property.

**Example**: If 15 elements all have the set `{paddingTop:"32px", paddingBottom:"32px"}`,
they share `.gb-s-a1b2c3`. If 8 have `{display:"flex", flexDirection:"column", gap:"16px"}`,
they share `.gb-s-d4e5f6`. An element matching both gets both classes.

#### Level 3: Inline `styles`

Computed property sets appearing on **<3 elements** (unique per block).
Mapped to:
- GB editor attributes where equivalents exist (`backgroundColor`, `textColor`,
  `bgImage`, `gradient*`, border properties)
- Flat `styles` object for everything else

The existing `gb-attribute-mapper.ts` handles this mapping — we feed it the
classified inline properties.

#### Level 4: styles-unique.css

Unchanged from existing `css-splitter.ts` — preflight reset, keyframes,
pseudo-elements, multi-selector rules.

### Interface

```typescript
export interface ClassifiedStyles {
  customizer: {
    colors: Record<string, string>;       // token-name → hex value
    bodyFont: string;
    headingFont: string;
    baseFontSize: string;
  };
  globalStyles: Array<{
    name: string;
    selector: string;
    css: string;
  }>;
  inlineStyles: {
    [elementPath: string]: Record<string, string>;
  };
}

export function classifyStyles(
  computedStyles: ComputedStyleMap,
  tailwindConfig: Record<string, unknown> | null,
  frequencyThreshold?: number,  // default 3
): ClassifiedStyles;
```

---

## 4. Integration with DOM Walker & Serializer

### DOM Walker changes

When `makeElementBlock()` or `makeTextBlock()` creates a block, it now also
looks up the element's path in the classified inline styles map. If found,
populates `block.styles` with the inline properties AND sets GB attributes
via the mapper.

```typescript
// In dom-walker.ts, when creating a block:
const elementPath = el.getAttribute("data-gb-path");
if (elementPath && classifiedStyles.inlineStyles[elementPath]) {
  block.styles = classifiedStyles.inlineStyles[elementPath];
  // gb-attribute-mapper promotes backgroundColor, bgImage, etc. from styles
}
```

### Serializer changes

The serializer already calls `gb-attribute-mapper` via `buildElementAttrs()`.
If `block.styles` is populated from the classifier, the mapper promotes
properties to GB attributes. **No serializer changes needed** beyond ensuring
the mapper handles the property keys produced by the classifier.

### Orchestrator changes

The orchestrator wires the new modules between inliner and walker:

```typescript
// In orchestrator.ts convert():
if (!input.skipInliner && usesTailwind(rawHtml)) {
  rawHtml = cleanTailwindSource(rawHtml).html;        // NEW
  const compiled = await inlineTailwindStyles(rawHtml);
  const classified = classifyStyles(                  // NEW
    compiled.computedStyles,                          // NEW
    extractTailwindConfig(rawHtml),                   // NEW
  );
  // Pass classified to walker via context
  walkerContext.classifiedStyles = classified;
}
```

---

## Edge Cases & Their Deterministic Rules

| Edge case | Rule |
|---|---|
| Config color used on 0 elements | Skip — don't emit to Customizer |
| Config color used on 1 element only | Still emit to Customizer (it's a design token) |
| Arbitrary value color (not in config), used ≥3 times | → Global Styles shared class |
| Arbitrary value color, used <3 times | → Inline `styles` |
| Implicit base text color (inherited, no class) | Read computed `color` on `<body>` → Customizer base text color |
| Same property with different values on same element type | Each unique value set gets its own hash; frequency count is per exact set |
| Responsive values (mobile vs desktop) | Not captured in Phase 1. Desktop computed values only. Responsive deferred. |
| Pseudo-class computed styles (`:hover`, `:focus`) | Not captured. Playwright captures default state only. Deferred. |

---

## Testing Strategy

### Unit tests

- **`tailwind-cleaner.test.ts`** — Bare text wrapping, empty div removal,
  whitespace stripping, config extraction
- **`style-classifier.test.ts`** — Frequency threshold (≥3 vs <3), color
  classification (config vs arbitrary), font extraction, property hashing,
  empty input

### Integration tests

- **HKVC re-conversion** — After implementation, re-convert HKVC and verify:
  - `bgImage` / `backgroundColor` attributes appear on blocks
  - `styles` objects are non-empty for blocks with unique computed styles
  - Customizer output includes used config colors
  - Global Styles include shared property sets
  - `compare` mismatch drops significantly from 44%

### Fixtures

- `fixtures/computed-styles/simple-tailwind.html` — Minimal Tailwind page
  with known computed styles for deterministic testing

---

## What This Does NOT Address (Deferred)

- Responsive/breakpoint computed styles (mobile, tablet)
- Pseudo-class computed styles (`:hover`, `:focus`, `:active`)
- CSS variable resolution in computed styles (browser already resolves them)
- The "Promoted attrs strip CSS from block" problem (Risk B from verification
  spec — renderer already handles this by deriving CSS back from attrs)
