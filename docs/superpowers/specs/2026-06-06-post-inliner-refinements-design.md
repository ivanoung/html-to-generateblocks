# Post-Inliner Pipeline Refinements — Design Spec

**Date:** 2026-06-06
**Status:** Design (awaiting approval)

## Problem

The Tailwind inliner produces correct but suboptimal output:

1. **Not responsive** — all styles locked at desktop viewport (1440px). `min-height: 90vh` becomes `min-height: 810px`. `repeat(12, 1fr)` becomes `82.6562px 82.6562px...`. Viewport-dependent values break on resize.

2. **No section structure** — preserves raw DOM hierarchy. No outer/inner container pattern for full-width backgrounds vs content-constrained regions.

3. **Style bloat** — every element has 100+ inline properties including browser defaults (`margin: 0, padding: 0, flex: 0 1 auto`). 70 unique structural patterns repeated across 215 elements.

4. **No class reuse** — all styling is inline. Should be consolidated into Global Style classes referenced via `globalClasses`.

## Approach

Enhance the inliner with multi-viewport capture, computed-value cleaning, and a post-processing consolidation step. Add section wrapper logic to the DOM walker.

---

## Architecture

```
raw HTML
  │
  ▼
tailwind-inliner.ts (enhanced)
  │  1. Parse config → get breakpoints (sm=640, md=768, lg=1024, xl=1280)
  │  2. Load page at 1440px, wait for CDN compile
  │  3. Capture class list per element BEFORE stripping
  │  4. For each breakpoint + 375px mobile base:
  │     a. setViewportSize(width, 900)
  │     b. getComputedStyle() per element
  │     c. Diff against desktop baseline for media query overrides
  │  5. Strip browser defaults from computed styles
  │  6. Reverse-engineer relative values from original class names
  │     (grid-cols-N → repeat(N,1fr), min-h-screen → 100vh, etc.)
  │  7. Strip viewport-dependent dimensions (width/height from auto/100%)
  │  8. Extract <style> content → customCSS (for @keyframes, ::-webkit-*)
  │  9. Strip Tailwind classes, CDN references
  │
  ▼
clean HTML + responsive media queries + class list per element
  │
  ▼
class-consolidator.ts (new)
  │  1. Filter: keep only structural properties for hashing
  │     (display, flex-*, gap, padding, margin, border-*, position,
  │      overflow, z-index, grid-column, grid-row)
  │  2. Hash structural subset → group identical elements
  │  3. Preserve original class names for custom CSS classes
  │     (.blueprint-bg, .clip-hex, .hover-shadow-md)
  │  4. Assign .gb-s-{hash8} names to new structural classes
  │  5. Extract responsive deltas per breakpoint into class "data" blocks
  │  6. Replace inline structural styles with globalClasses references
  │  7. Keep decorative properties (color, font-*, background-*)
  │     as inline styles on element blocks
  │
  ▼
section-wrapper (inside dom-walker, modified)
  │  1. Detect <section> tags
  │  2. Wrap: Outer <section> (styles: empty, tagName: section)
  │     + Inner <div> (max-width: var(--gb-container-width),
  │       margin: auto, padding: actual values)
  │  3. Distribute: background-* → Outer, everything else → Inner
  │
  ▼
existing pipeline (preprocess → DOM walk → serialize → validate)
  │
  ▼
output/<project>/
  ├── index.html              # GB blocks with globalClasses refs
  ├── index.report.json       # Validation report
  ├── global-styles.json      # All reusable classes (WP Global Styles format)
  ├── index-custom.css        # @keyframes, ::-webkit-*, body-level rules only
  └── index-global-styles.json # Legacy manifest (classNameToProperties)
```

---

## Component 1: Enhanced Tailwind Inliner

### Multi-viewport capture

```ts
interface ViewportStyles {
  viewport: string; // "desktop", "xl", "lg", "md", "sm", "mobile"
  width: number;    // 1440, 1280, 1024, 768, 640, 375
  styles: Map<string, Record<string, string>>; // elementId → prop → value
}
```

Capture at: 1440 (desktop/base), 1280 (xl), 1024 (lg), 768 (md), 640 (sm), 375 (mobile).

Desktop values become the element's inline base styles. Each smaller breakpoint diffs against desktop: only properties that differ are written as `@media (max-width: <bp-1>px)` overrides in the consolidated class.

**Performance**: CDN compiles once at page load. Subsequent viewport resizes only trigger reflow + `getComputedStyle()`. No CDN recompilation needed. Expected: ~500ms per viewport × 6 = 3s additional time.

### Class list capture (before stripping)

```ts
// Inside page.evaluate(), before class stripping:
const classListPerElement = new Map();
document.body.querySelectorAll("*").forEach((el, i) => {
  el.setAttribute("data-gb-idx", String(i));
  classListPerElement.set(i, el.className);
});
// ... later, pass classListPerElement back with the computed styles
```

This map is used later for:
- Relative value reconstruction (was this `grid-cols-12`?)
- Original class name preservation for custom CSS classes

### Browser defaults filter

A reference map of browser default values per CSS property. Properties matching defaults are stripped:

```
display: block → strip (default for div/section)
display: inline → strip (default for span)
margin: 0 → strip
padding: 0 → strip
border-radius: 0 → strip
flex: 0 1 auto → strip
flex-direction: row → strip (default)
position: static → strip (default)
overflow: visible → strip (default)
```

Properties NOT matching defaults are kept. This eliminates ~40% of inline properties (the 40 identical "default" blocks from the data analysis).

### Relative value reconstruction

Using the captured class list, convert computed pixel values back to relative units:

| Original class | Computed value | Reconstructed value |
|---|---|---|
| `grid-cols-12` | `82.6562px 82.6562px...` | `repeat(12, minmax(0, 1fr))` |
| `grid-cols-2` | `380px 380px` | `repeat(2, minmax(0, 1fr))` |
| `min-h-screen` | `900px` | `100vh` |
| `min-h-[90vh]` | `810px` | `90vh` |
| `w-full` | `1440px` | `100%` |
| `h-full` | varies | `100%` |
| `w-1/2` | `720px` | `50%` |

Heuristic for grid columns: if `grid-template-columns` has N equal fractional values AND the element had `grid-cols-N` in its class list, replace with `repeat(N, minmax(0, 1fr))`.

For viewport units: if class list contains `min-h-screen`/`min-h-[Xvh]`/`h-screen`, convert computed pixels back to vh.

For percentages: if `w-full`/`w-1/2`/`w-1/3` etc. in class list, convert computed width back to percentage.

### `<style>` extraction before script removal

Before removing `<script>` and `<link>` tags, extract all `<style>` block content:

```ts
const styleBlocks = [];
document.querySelectorAll("style").forEach((el) => {
  styleBlocks.push(el.textContent);
});
// Pass styleBlocks back with the extraction result
```

These are split downstream:
- `@keyframes`, `::-webkit-*` → `custom.css`
- Simple class rules with pseudo-classes/media → `global-styles.json` (preserving original names)

### Responsive media query generation

For each element, compare computed styles at each breakpoint against desktop baseline:

```
desktop: { fontSize: "96px", padding: "192px 48px 80px" }
lg:      { fontSize: "96px", padding: "192px 48px 80px" }  // same → skip
md:      { fontSize: "72px", padding: "128px 32px 60px" }  // different → keep
sm:      { fontSize: "48px", padding: "96px 24px 40px" }   // different → keep
mobile:  { fontSize: "48px", padding: "96px 24px 40px" }   // same as sm → skip
```

Only write overrides when values actually differ. This prevents CSS bloat from identical breakpoints.

### State style extraction (hover / focus / group-hover / active)

After the CDN compiles but before any class stripping, scan `document.styleSheets`
for CSS rules whose selectors match elements on the page AND contain state
pseudo-classes:

```ts
// Inside page.evaluate(), after CDN compiles
const stateRules: Map<string, Array<{state: string, props: Record<string,string>}>> = new Map();

for (const sheet of document.styleSheets) {
  try {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const selector = rule.selectorText;
      
      // Match state pseudo-classes
      const stateMatch = selector.match(/(?::：(?:hover|focus|focus-visible|active))|(?:\.[^\s]+:(?:hover|focus|focus-visible|active))|(?:\.group[a-z/]*\s*:hover\s+)|(?:\.peer[a-z/]*\s*:[a-z-]+\s*[+~]\s*)/);
      if (!stateMatch) continue;
      
      // Extract which elements this rule matches
      const matchingElements = document.querySelectorAll(
        selector.replace(/:hover|:focus|:focus-visible|:active|::after|::before/g, '')
      );
      
      for (const el of matchingElements) {
        const idx = el.getAttribute('data-gb-idx');
        if (!idx) continue;
        
        const props: Record<string,string> = {};
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          props[prop] = rule.style.getPropertyValue(prop);
        }
        
        // Group by state type
        let state = '&:hover';
        if (selector.includes(':focus-visible')) state = '&:focus-visible';
        else if (selector.includes(':focus')) state = '&:focus';
        else if (selector.includes(':active')) state = '&:active';
        else if (selector.includes(':hover')) state = '&:hover';
        
        if (!stateRules.has(idx)) stateRules.set(idx, []);
        stateRules.get(idx)!.push({ state, props });
      }
    }
  } catch(e) { /* cross-origin sheet, skip */ }
}
```

**Group-hover mapping**: For `.group/dropdown:hover .child`, the rule is matched to the
child element (`.child`) and stored with state `&:hover` but tagged with a
parent-selector hint. The consolidator later generates the correct parent-hover
selector in `global-styles.json`:

```json
{
  "selector": ".gb-s-child",
  "data": {
    ".parent-class:is(:hover, :focus) &": {
      "opacity": "1",
      "visibility": "visible"
    }
  }
}
```

**Output**: State styles are included in the consolidated class's `data` block alongside
responsive overrides. The class CSS string includes the corresponding pseudo-class
rules. This preserves hover/focus/group-hover behavior without any Tailwind
classes in the output.

**Limitation**: Group-hover with namespace modifiers (`group/dropdown`) requires
the parent element to have a stable class selector. If the parent's class is
also auto-generated (`.gb-s-*`), we need to track the parent-child relationship
during consolidation to generate the correct compound selector.

---

## Component 2: Class Consolidator

### Structural vs decorative split

| Category | Properties | Goes to |
|---|---|---|
| Structural | display, flex-direction, flex-wrap, flex-grow, flex-shrink, flex-basis, justify-content, align-items, align-content, align-self, gap, column-gap, row-gap, grid-template-columns, grid-template-rows, grid-column, grid-row, padding-*, margin-*, border-*, border-radius, position, overflow-*, z-index, order | Global Styles class |
| Decorative | color, font-family, font-size, font-weight, font-style, line-height, letter-spacing, text-align, text-transform, text-decoration, background-color, background-image, background-size, background-position, opacity, box-shadow, transform, transition, width, height, min-width, max-width, min-height, max-height | Inline styles |

**Width/height exceptions**: `max-width: var(--gb-container-width)` on the inner container is structural (goes in the class). `width: 100%` / `height: 100vh` are structural. Explicit pixel widths/heights from Tailwind `w-N` / `h-N` classes are decorative (they're element-specific).

### Hashing and grouping

```ts
function hashStructural(styles: Record<string, string>): string {
  const structural = filterStructural(styles);
  const sorted = Object.keys(structural).sort().map(k => `${k}:${structural[k]}`);
  return sha256(sorted.join(";")).substring(0, 8);
}
```

Elements sharing the same hash reference the same class via `globalClasses`.

### Class naming

| Source | Naming |
|---|---|
| Custom CSS class (`.blueprint-bg`) | Keep original: `.blueprint-bg` |
| Custom CSS class (`.hover-shadow-md`) | Keep original: `.hover-shadow-md` |
| Generated structural class | `.gb-s-{hash8}` (e.g., `.gb-s-a1b2c3d4`) |

### global-styles.json format

Each entry follows the WordPress Global Styles JSON format:

```json
[
  {
    "selector": ".gb-s-a1b2c3d4",
    "name": "Flex Column Gap 8",
    "css": ".gb-s-a1b2c3d4{display:flex;flex-direction:column;gap:2rem;padding:2rem}",
    "data": {
      "display": "flex",
      "flexDirection": "column",
      "gap": "2rem",
      "paddingTop": "2rem",
      "paddingRight": "2rem",
      "paddingBottom": "2rem",
      "paddingLeft": "2rem"
    }
  },
  {
    "selector": ".gb-s-b2c3d4e5",
    "name": "Flex Row Gap 12 + lg override",
    "css": ".gb-s-b2c3d4e5{display:flex;flex-direction:row;gap:3rem;padding:3rem}@media(max-width:1023px){.gb-s-b2c3d4e5{flex-direction:column;gap:1.5rem;padding:1.5rem}}",
    "data": {
      "display": "flex",
      "flexDirection": "row",
      "gap": "3rem",
      "paddingTop": "3rem",
      "paddingRight": "3rem",
      "paddingBottom": "3rem",
      "paddingLeft": "3rem",
      "@media (max-width: 1023px)": {
        "flexDirection": "column",
        "gap": "1.5rem",
        "paddingTop": "1.5rem",
        "paddingRight": "1.5rem",
        "paddingBottom": "1.5rem",
        "paddingLeft": "1.5rem"
      }
    }
  },
  {
    "selector": ".blueprint-bg",
    "css": ".blueprint-bg{background-size:40px 40px;background-image:linear-gradient(to right,rgba(51,65,85,0.08) 1px,transparent 1px),linear-gradient(to bottom,rgba(51,65,85,0.08) 1px,transparent 1px)}",
    "data": {
      "backgroundSize": "40px 40px",
      "backgroundImage": "linear-gradient(to right,rgba(51,65,85,0.08) 1px,transparent 1px),linear-gradient(to bottom,rgba(51,65,85,0.08) 1px,transparent 1px)"
    }
  },
  {
    "selector": ".clip-hex",
    "css": ".clip-hex{clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}",
    "data": {
      "clipPath": "polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)"
    }
  },
  {
    "selector": ".hover-shadow-md",
    "css": ".hover-shadow-md:hover{box-shadow:0 0 0 1px rgba(0,0,0,0.06),0 1px 1px -0.5px rgba(0,0,0,0.06),0 3px 3px -1.5px rgba(0,0,0,0.06),0 6px 6px -3px rgba(0,0,0,0.06),0 12px 12px -6px rgba(0,0,0,0.06),0 24px 24px -12px rgba(0,0,0,0.06)}",
    "data": {
      "&:hover": {
        "boxShadow": "0 0 0 1px rgba(0,0,0,0.06),0 1px 1px -0.5px rgba(0,0,0,0.06),0 3px 3px -1.5px rgba(0,0,0,0.06),0 6px 6px -3px rgba(0,0,0,0.06),0 12px 12px -6px rgba(0,0,0,0.06),0 24px 24px -12px rgba(0,0,0,0.06)"
      }
    }
  }
]
```

### Element block output after consolidation

```html
<!-- wp:generateblocks/element {"uniqueId":"elem003","tagName":"div",
  "styles":{"fontSize":"48px","color":"rgb(30,41,59)","fontWeight":"600","fontFamily":"Anybody, sans-serif","lineHeight":"96px"},
  "globalClasses":["gb-s-a1b2c3d4"],
  "css":"",
  "metadata":{"name":"Hero Heading Wrapper"}} -->
<div class="gb-element gb-s-a1b2c3d4">
  <!-- inner blocks -->
</div>
<!-- /wp:generateblocks/element -->
```

Decorative properties stay inline in `styles`. Structural properties are referenced via `globalClasses`.

---

## Component 3: Section Wrapper (DOM Walker)

### Detection and wrapping

The DOM walker, when encountering a `<section>` tag:

1. Creates an **Outer** `<section>` block (tagName: "section", styles: empty)
2. Creates an **Inner** `<div>` block (tagName: "div")
3. Distributes styles from the original section:
   - `background-*` properties → Outer
   - All other properties → Inner
4. Sets Inner's `max-width: var(--gb-container-width)`, `margin-left: auto`, `margin-right: auto`
5. Inner's `padding-*` preserves the original section's padding values
6. Original section's children become children of the Inner block

### GB output

```html
<!-- wp:generateblocks/element {"uniqueId":"outer001","tagName":"section",
  "styles":{},
  "css":"",
  "metadata":{"name":"Outer"}} -->
<section class="gb-element">
  <!-- wp:generateblocks/element {"uniqueId":"inner001","tagName":"div",
    "styles":{"maxWidth":"var(--gb-container-width)","marginLeft":"auto","marginRight":"auto","paddingTop":"192px","paddingRight":"48px","paddingBottom":"80px","paddingLeft":"48px"},
    "css":".gb-element-inner001{margin-left:auto;margin-right:auto;max-width:var(--gb-container-width);padding:192px 48px 80px 48px}",
    "metadata":{"name":"Content"}} -->
  <div class="gb-element-inner001 gb-element">
    <!-- section children -->
  </div>
  <!-- /wp:generateblocks/element -->
</section>
<!-- /wp:generateblocks/element -->
```

Sections with background colors/images:

```html
<!-- wp:generateblocks/element {"uniqueId":"outer005","tagName":"section",
  "styles":{"backgroundColor":"rgb(75,72,92)"},
  "css":".gb-element-outer005{background-color:rgb(75,72,92)}",
  "metadata":{"name":"Outer"}} -->
<section class="gb-element-outer005 gb-element">
  <!-- Inner with max-width + padding -->
</section>
<!-- /wp:generateblocks/element -->
```

### Non-section containers

`<div>`, `<header>`, `<main>`, and other non-section elements keep their original tag and structure. Only `<section>` triggers the outer/inner pattern.

### metadata attribute

The user's reference block uses `"metadata":{"name":"Outer"}`. This is NOT in
`generateblocks/element`'s `block.json` schema. WordPress core supports `metadata`
for editor labeling (list view, block breadcrumbs), but GB may strip it during
save causing recovery diffs. **Implementation choice**: omit `metadata` in initial
implementation. Outer/Inner blocks are identifiable via `uniqueId` prefix (`outer*`
vs `inner*`). If WordPress verification confirms `metadata` is safe, add it back.

---

## Component 4: Pre-Flight Check

### CLI warning

Before conversion, the CLI scans for `<section>` tags:

```
⚠ Pre-flight: No <section> tags found in inputs/mino/index.html.
  Each content block should be wrapped in a <section> for proper
  Outer/Content container structure.
  Add <section> wrappers and re-run for optimal output.
```

This is a warning only — conversion still runs, but output won't have the container pattern.

---

## Output Contract

| Guarantee | How |
|---|---|
| Pixel-perfect desktop | Computed styles from 1440px viewport, filtered for Tailwind-set properties |
| Responsive | Media query blocks per breakpoint from real viewport resizes, stored in class data |
| State styles preserved | hover, focus, focus-visible, active, group-hover extracted from CSSOM, stored in class data as `&:hover`/`:focus`/etc. blocks |
| No Tailwind classes | Stripped by inliner; relative values reconstructed to pure CSS equivalents |
| Clean section structure | Outer `<section>` (backgrounds) + Inner `<div>` (max-width, padding, content) |
| Minimal CSS bloat | Browser defaults stripped, structural styles → global-styles.json classes |
| Reusable classes | Original names preserved for custom CSS; hash-based names for auto-generated structural classes |
| Custom CSS minimal | Only `@keyframes`, `::-webkit-*`, `body` element rules |
| No `!important` | Not needed — all styles in classes with same specificity, cascade handles responsive |

---

## Files

| File | Action | Responsibility |
|---|---|---|
| `src/core/tailwind-inliner.ts` | Modify | Multi-viewport capture, defaults filter, relative value reconstruction, class list capture, `<style>` extraction |
| `src/core/class-consolidator.ts` | Create | Structural hashing, grouping, responsive delta extraction, global-styles.json generation, globalClasses assignment |
| `src/core/dom-walker.ts` | Modify | Section wrapper logic (outer/inner container pattern), style distribution |
| `src/core/orchestrator.ts` | Modify | Wire consolidator between inliner and preprocess; pass class list through pipeline |
| `src/cli/index.ts` | Modify | Pre-flight check for `<section>` presence |
| `src/core/types.ts` | Modify | Add metadata field to Block type, add classListPerElement to pipeline types |

## Non-Goals

- Automatic CSS variable generation for spacing values (user chose actual pixels)
- Semantic class naming (user chose hash-based for generated classes, original names for custom CSS)
- `<nav>` and `<footer>` conversion (preprocessor strips; future improvement)
- `<button>` → GB button block conversion (stays `core/html`; future improvement)
