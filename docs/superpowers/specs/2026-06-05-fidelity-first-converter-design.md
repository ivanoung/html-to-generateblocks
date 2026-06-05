# Fidelity-First Converter — Design Spec

**Date:** 2026-06-05
**Status:** Design — approved, awaiting implementation plan
**Revert point:** `2de3a77` — last commit before this architectural change

---

## Overview

### Philosophy Shift

The original converter was **pattern-recognition-first**: parse HTML, classify sections into semantic roles (hero, card-grid, testimonial), rebuild via an IR layer, and serialize. This introduced fragility at every stage — misclassification, selector misses, style resolution errors, IR mismatches.

The new converter is **fidelity-first**: preserve the original HTML structure as scaffolding, layer GB block wrappers on top, and only normalize when required for WordPress compatibility.

**Product principle:** preserve first, normalize second, infer intent only when required for compatibility.

### Success Metric

The converted output must:
- Render visually close to the source
- Be structurally faithful (same nesting, same element count)
- Never trigger WordPress "Attempt Recovery"
- Be editable inside WordPress so the user can finish manually

---

## Revert Point

This design replaces the entire `converter/` directory and several `core/` modules. To revert to the pattern-recognition pipeline:

```bash
git checkout 2de3a77  # commit: docs: record self-verification loop idea for future
```

All files created under this design are additive; the old pipeline lives at that commit.

---

## Architecture

Three stages, replacing the current five-phase pipeline:

```
RAW HTML (any source)
         │
    ┌────▼─────┐
    │  Pre-     │  Strip: <nav>, <footer>, <script>, <link>
    │  process  │  Wrap: <form>, <style> blocks, standalone <iconify-icon>
    │           │  → tagged with data-gb-wrap="core-html"
    │           │  Scan: <head> <style> → class definitions → classNameToProperties
    └────┬─────┘
         │  clean HTML + classNameToProperties map
    ┌────▼─────┐
    │   Walk    │  Depth-first DOM traversal
    │  & Wrap   │  Children classified: inline-only → text block, block-only → element,
    │           │                         mixed → core/html
    │           │  Tag → block type (deterministic mapping)
    │           │  style attr → parseStyleString() → { styles, css }
    │           │  Other attrs → htmlAttributes
    │           │  class → cross-ref classNameToProperties → globalClasses
    └────┬─────┘
         │  Block[]
    ┌────▼─────┐
    │ Serialize │  Existing serializer.ts + validator.ts
    │ & Validate│  (unchanged)
    └────┬─────┘
         │
    ┌────┴─────┬──────────────┬──────────────┐
    ▼          ▼              ▼              ▼
  page.html   page-report    page-global-   page-custom
  (GB markup) .json           styles.json    .css
```

### Removed from Codebase

| Module | Reason |
|---|---|
| `converter/structure-parser.ts` | No section detection needed |
| `converter/manifest-validator.ts` | No manifests |
| `converter/style-resolver.ts` | Decoupled (Tailwind resolution is separate concern) |
| `converter/html-to-ir.ts` | No IR layer |
| `converter/role-mapper.ts` | No semantic roles |
| `converter/pipeline.ts` | Replaced by simpler orchestrator |
| `core/ir-node.ts` | No IR types |
| `core/ir-planner.ts` | Walker produces Block[] directly |
| `core/mapper.ts` | Replaced by dom-walker |
| `core/hero-scorer.ts` | No hero detection |
| `core/hero-converter.ts` | No hero conversion |
| `types/manifest.ts` | No manifests |

### Preserved (Unchanged)

| Module | Notes |
|---|---|
| `core/types.ts` | Block type definitions |
| `core/style-parser.ts` | `parseStyleString()` — minor: add 4 background properties to STYLES_PROPERTIES |
| `core/id-generator.ts` | `nextId()`, `resetIds()` |
| `core/serializer.ts` | Block[] → WP markup (unchanged) |
| `core/validator.ts` | `validateBlocks()` (unchanged) |
| `runner/run-fixture.ts` | Fixture runner (adapted input format) |
| `cli/index.ts` | Simplified commands |

### New Modules

| Module | Lines (est.) | Purpose |
|---|---|---|
| `core/dom-walker.ts` | ~250 | DOM traversal → Block[] conversion |
| `core/preprocessor.ts` | ~80 | Strip/wrap elements, scan `<head>` styles |
| `core/global-styles-collector.ts` | ~60 | Collect reusable class definitions |
| `core/orchestrator.ts` | ~50 | Ties preprocessor → walker → serializer → outputs |

---

## Stage 1: Pre-processor

Runs once before the walker.

### Strip

| Element | Action |
|---|---|
| `<nav>` | Remove entire subtree |
| `<footer>` | Remove entire subtree |
| `<script>` | Remove |
| `<link>` | Remove (fonts handled by WordPress theme) |

### Wrap

Elements not meaningfully convertible are wrapped in `<div data-gb-wrap="core-html">`:

| Element | Action |
|---|---|
| `<form>...</form>` | Wrap entire form |
| `<style>...</style>` (inside body sections) | Wrap style block |
| `<iconify-icon ...>` (direct child of block-level element, not nested inside inline parent) | Wrap icon element |

The walker sees `data-gb-wrap="core-html"` and produces a single `core/html` block:
```
coreHtmlBlock($wrapper) = {
  blockName: "core/html",
  html: $wrapper.html()    // innerHTML of wrapper = original element's outerHTML
}
```
No recursion into wrapped content.

### Scan `<head>` styles

Parse `<head>` `<style>` blocks to extract class definitions:

```
For each CSS rule:
  IF selector is simple (.clip-hex, .blueprint-bg) 
     AND all properties are GB-compatible (no :hover, no ::pseudo, no @keyframes)
     AND no vendor prefixes (::-webkit-*)
  → add to classNameToProperties map
  
  ELSE
  → append rule to page-custom.css
```

`classNameToProperties` is passed to the walker. Classes used on 2+ elements are promoted to `globalClasses` references in blocks and added to `page-global-styles.json`.

Classes with pseudo-selectors, keyframes, or vendor prefixes go to `page-custom.css` for manual import into WordPress Customizer → Additional CSS.

### Output from this stage

- Clean HTML DOM (nav/footer/scripts/links removed, special elements wrapped)
- `classNameToProperties`: Map<string, BlockStyles> — class → properties for global styles
- `customCss`: string — raw CSS for manual import

---

## Stage 2: DOM Walker

A single recursive function. Takes a cheerio DOM root and `classNameToProperties` map.

### Algorithm

```
function walk($el):
    1. If $el has data-gb-wrap="core-html" → return [coreHtmlBlock($el)]
       (no recursion)

    2. Classify children:
       - Collect child nodes (text nodes + element nodes)
       - hasMeaningfulText = any text node where data.trim() !== ''
       - hasInlineOnly    = all element children are in INLINE_TAGS
       - hasBlockChildren = any element child NOT in INLINE_TAGS
    
    3. If hasBlockChildren AND (hasMeaningfulText OR hasInlineOnly):
       → return [coreHtmlBlock($el)]  // mixed content, impossible in GB

    4. If (hasMeaningfulText OR hasInlineOnly) AND NOT hasBlockChildren:
       → return [textBlock($el)]  // all content is inline/text

    5. Determine block type from tag:

       Container tags → generateblocks/element:
         div, section, article, aside, header, main,
         ul, ol, li, dl, dt, dd, figure

       Text leaf tags → generateblocks/text:
         h1, h2, h3, h4, h5, h6, p, blockquote, pre

       <a> with only inline children → generateblocks/text, tagName:"a"
       <a> with block children → generateblocks/element, tagName:"a"

       <img> standalone → generateblocks/media
       <figure> containing img + figcaption → core/image

       <svg> → generateblocks/shape (html = outerHTML, NO recursion)

       <button> standalone → generateblocks/text, tagName:"button"

       <iframe>, <video>, <audio>, <canvas>, <picture> → core/html
       <table> → core/html

       Unrecognized → core/html

    6. Extract styles:
       style attr → parseStyleString() → { styles, css }

    7. Extract htmlAttributes:
       Collect id, aria-*, data-*, role, type, target, rel, name, href (for <a>), src, alt
       Skip: class (GB manages classes internally)
       Only include if non-empty

    8. Check class attribute:
       For each class on the element, lookup in classNameToProperties
       If found AND class used on 2+ elements across page → 
         add to block's globalClasses array
         add to globalStylesCollector

    9. Recurse into block-level children only (skip inline children)
       → block.innerBlocks = flatten(walk(child) for each child)

    10. Warn: if styles empty AND css empty AND element had non-empty class attr
        → report warning CLASS_ONLY_STYLING

    11. Return [block]
```

### INLINE_TAGS (stay as raw HTML, never become separate blocks)

```
a, abbr, b, br, cite, code, data, del, dfn, em, i,
iconify-icon, ins, kbd, mark, q, s, samp, small, span,
strong, sub, sup, time, u, var, wbr
```

### Children Classification Rules

| Children type | Block produced |
|---|---|
| Only whitespace text nodes | `generateblocks/element` (empty container) |
| Only text/inline (no block elements) | `generateblocks/text` with same tagName |
| Only block elements (no text/inline) | `generateblocks/element` with same tagName |
| Mixed: text/inline AND block elements | `core/html` (fallback — invalid in GB) |
| Empty (no text, no children) | `generateblocks/element` (valid empty container) |

This rule is critical: per recovery rules §5.3, GB element blocks cannot contain raw text between their HTML tags. Any element that would produce text between tags must become a `generateblocks/text` block instead, or fall back to `core/html` for mixed content.

### Tag → Block Type Mapping

| Tag | Block | Notes |
|---|---|---|
| `div`, `section`, `article`, `aside`, `header`, `main` | `generateblocks/element` | Tag preserved as `tagName` |
| `ul`, `ol`, `li`, `dl`, `dt`, `dd` | `generateblocks/element` | Per GB team recommendation |
| `figure` (no figcaption) | `generateblocks/element` | |
| `h1`–`h6`, `p`, `blockquote`, `pre` | `generateblocks/text` | `content` = innerHTML |
| `a` (only inline children) | `generateblocks/text` | `tagName:"a"`, `htmlAttributes.href` |
| `a` (block children) | `generateblocks/element` | `tagName:"a"` |
| `img` (standalone) | `generateblocks/media` | `src`/`alt` → `htmlAttributes` |
| `figure > img + figcaption` | `image` (core/image) | Caption extracted from figcaption |
| `svg` | `generateblocks/shape` | `html` = `outerHTML`, no recursion |
| `button` (standalone) | `generateblocks/text` | `tagName:"button"` |
| `iframe`, `video`, `audio`, `canvas`, `picture` | `core/html` | Preserved verbatim |
| `table`, `input`, `textarea`, `select` | `core/html` | Only reached if not inside form |
| Empty element (no meaningful content) | Skipped | No block produced |
| Unrecognized | `core/html` | |

### Leaf Block with Children — Fallback

If the tag→block mapping produces a leaf block (text, media, shape) but the element has block-level children (detected in step 3 of classification), the element falls back to `core/html`. This handles edge cases like:

- `<button>` containing inline text + `<iconify-icon>` (pre-processor wraps icon as core-html div)
- `<a>` containing text + wrapped icon
- `<p>` containing block elements (invalid HTML, but handled gracefully)

---

## Stage 3: Serialize & Validate

Existing pipeline, unchanged:

1. `serializer.ts` → WordPress block markup
2. `validator.ts` → hard fails + warnings

The serializer handles:
- Canonical key ordering per block type
- JSON escape substitutions (`--` → `\u002d\u002d`, `&` → `\u0026`, `<` → `\u003c`, `>` → `\u003e`)
- CSS minification and property sorting
- `content` omission from text block JSON (rich-text sourced, goes in HTML body only)
- `globalClasses` array output
- `htmlAttributes` as plain object

No changes needed.

---

## Style Handling

### style-parser.ts — Properties Added

Add to `STYLES_PROPERTIES` set (properties that appear in BOTH `styles` and `css`):

```typescript
"background-size",
"background-position",
"background-repeat",
"background-attachment",
```

These are supported by the free GB element block's `bgOptions` panel.

### Properties in css Only (Correct Behavior)

These properties go to `css` only — they render correctly on the frontend via the CSS string:

| Property | Reason |
|---|---|
| `opacity` | GB Pro uses `useOpacity` + `opacities[]` array format |
| `box-shadow` | GB Pro uses `useBoxShadow` + `boxShadows[]` array format |
| `transform` | GB Pro uses `useTransform` + `transforms[]` array format |
| `filter` | GB Pro uses `useFilter` + `filters[]` |
| `clip-path` | No GB editor panel equivalent |
| Background gradients/URLs | `css` only (color extracted to `backgroundColor` in `styles`) |

### CSS Class-Only Elements

Elements with only `class="..."` and no `style="..."` produce blocks with empty `styles` and `css`. A warning `CLASS_ONLY_STYLING` is emitted. The block is valid — the user styles it in the GB editor.

### Class → globalClasses

Elements with classes matching definitions in `classNameToProperties` (from `<head>` style scan):

- If the class is used on 2+ elements → add to block's `globalClasses` array
- First occurrence adds the class definition to `globalStylesCollector`

The block output:
```json
{"uniqueId":"btn001","tagName":"a","globalClasses":["clip-hex"],"styles":{...},"css":"..."}
```

---

## Output Files

Four files per page conversion:

| File | Contents |
|---|---|
| `output/<page-name>.html` | Paste-ready WordPress block markup |
| `output/<page-name>.report.json` | Validation results + warnings (CLASS_ONLY_STYLING, stripped elements, etc.) |
| `output/<page-name>-global-styles.json` | Reusable classes for GB Global Styles import (WP Admin → GB → Settings → Global Classes) |
| `output/<page-name>-custom.css` | Raw CSS from `<head>` `<style>` for manual import (WP Customizer → Additional CSS) |

### page-global-styles.json Schema

```json
{
  "page": "mino",
  "classes": [
    {
      "slug": "clip-hex",
      "name": "Clip Hex",
      "styles": {
        "clipPath": "polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)"
      }
    }
  ]
}
```

### page-report.json Schema (extended)

```json
{
  "page": "mino",
  "blockCount": 150,
  "hardFails": [],
  "warnings": [
    { "code": "CLASS_ONLY_STYLING", "element": "div.ruler-x", "message": "Element has class-only styling, may appear unstyled" },
    { "code": "STRIPPED_NAV", "message": "Navigation stripped — handle separately in WordPress" },
    { "code": "STRIPPED_FOOTER", "message": "Footer stripped — handle separately in WordPress" },
    { "code": "CUSTOM_CSS_REQUIRED", "message": "15 CSS rules in page-custom.css need manual import (pseudo-classes, keyframes, vendor prefixes)" }
  ],
  "strippedElements": ["nav#navbar", "footer"],
  "globalClassesExtracted": ["clip-hex", "blueprint-bg", "blueprint-bg-dark", "ruler-x"]
}
```

---

## Edge Cases

| Situation | Behavior |
|---|---|
| Element with only text node children | `generateblocks/text` with same tagName (not element block) |
| Element with mixed text + block children | `core/html` fallback |
| Whitespace-only text nodes between elements | Ignored (not counted as meaningful text) |
| Leaf block (text/media/shape) with block children | `core/html` fallback |
| Empty element (no text, children, or meaningful attrs) | Skipped |
| `class`-only styling (no `style` attr) | Valid block, empty styles, warn CLASS_ONLY_STYLING |
| `<iconify-icon>` inside text/element parent | Inline — stays in parent's `innerHTML` |
| `<iconify-icon>` standalone | Pre-processor wraps in core-html |
| `<button>` or `<a>` with iconify-icon child | Falls back to `core/html` (mixed content) |
| `<style>` block inside section body | Pre-processor wraps in core-html |
| `@keyframes` in `<head>` `<style>` | Extracted to `page-custom.css` |
| Pseudo-class rules in `<head>` `<style>` | Extracted to `page-custom.css` |
| Deep nesting (>10 levels) | Preserved — no flattening |
| Self-closing tags (`<br>`, `<hr>`) | `<br>` → inline. `<hr>` → unrecognized → core/html |
| `<picture>` with `<source>` + `<img>` | `core/html` (no GB equivalent) |
| SVG with nested elements | Leaf — `outerHTML` captured, no recursion |
| `<a>` with `mailto:` or `tel:` href | Preserved in `htmlAttributes.href` |
| Malformed HTML | cheerio handles recovery. If parsing fails → `core/html` |
| Multi-byte text, emoji | Preserved verbatim in `content` |
| `<li>` with inline children only | `generateblocks/text` with tagName:"li" |
| `<li>` with block children (nested list) | `generateblocks/element` with tagName:"li" if block-only; `core/html` if mixed |
| `<blockquote>` with inline content | `generateblocks/text` with tagName:"blockquote" |
| `<pre>` with text | `generateblocks/text` with tagName:"pre" |

---

## Fixture Strategy

Shift from pattern-recognition tests to fidelity tests:

| Fixture | Tests |
|---|---|
| `flat-section` | section + h1 + p → 3 blocks, correct types, 1 nesting level |
| `nested-wrappers` | section > div > div > h1 → 4 blocks, nesting preserved |
| `inline-formatting` | `<p>Some <strong>bold</strong> text</p>` → 1 text block, inline preserved |
| `cta-link` | `<a href="...">Click</a>` → text block tagName:"a" with htmlAttributes.href |
| `linked-image` | `<a><img/></a>` → element<a> + media child |
| `list-structure` | ul > li > text → element blocks with ul/li tagNames |
| `svg-icon` | inline svg → shape block, no recursion into svg children |
| `iframe-embed` | iframe → core/html |
| `captioned-image` | figure > img + figcaption → core/image |
| `mixed-content` | div containing h1, p, img → correct types in order |
| `form-fallback` | form with inputs → single core/html, no recursion |
| `style-block-wrap` | section with embedded `<style>` → core/html |
| `iconify-wrap` | standalone `<iconify-icon>` → core/html |
| `deep-nesting` | 10-level divs → 10 blocks, output valid |
| `global-class-ref` | 3 buttons with .clip-hex → each has globalClasses:["clip-hex"], class in global-styles.json |
| `skip-nav-footer` | page with nav + section + footer → nav/footer stripped |
| `aria-attrs` | div with id/aria-label/data-* → htmlAttributes preserved |
| `text-only-div` | `<div>Plain text</div>` → text block with tagName:"div" (NOT element block) |
| `mixed-div` | `<div>Text<h2>Heading</h2></div>` → core/html fallback |
| `button-with-icon` | `<button><span>Text</span><iconify-icon/></button>` → core/html fallback |
| `li-with-nested-list` | `<li>Text<ul><li>Sub</li></ul></li>` → core/html fallback |
| `class-only-element` | `<div class="ruler-x"></div>` → warning CLASS_ONLY_STYLING |
| `head-style-scan` | `<head>` `<style>` with .clip-hex → extracted to global-styles.json + custom.css |

Existing M1 regression fixtures stay for serializer/validator coverage.

---

## Style Parser Change

Single change to `src/core/style-parser.ts` — add to `STYLES_PROPERTIES`:

```diff
  // overflow
  "overflow",
  "overflow-x",
  "overflow-y",

  // object-fit (for media)
  "object-fit",
  "object-position",
+
+ // background (from GB bgOptions panel)
+ "background-size",
+ "background-position",
+ "background-repeat",
+ "background-attachment",
]);
```

All other style-parser behavior is unchanged.

---

## Non-Goals (Explicitly Excluded)

- Tailwind class resolution — this is a separate, decoupled pre-processing step
- Navigation menu conversion — `<nav>` is stripped, handled separately in WordPress
- Footer conversion — `<footer>` is stripped
- Form conversion — `<form>` is wrapped in `core/html`, handled by a separate forms plugin
- GB Pro feature generation (opacity, box-shadow, transform arrays) — these stay in `css` only
- Hero pattern recognition — removed entirely
- Semantic classification / manifest generation — removed entirely
- Multi-page batch conversion — single page per run
