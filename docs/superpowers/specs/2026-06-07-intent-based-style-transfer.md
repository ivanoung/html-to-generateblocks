# Intent-Based Style Transfer — Design Spec

**Date:** 2026-06-07
**Status:** Design (awaiting approval)

## Problem

The current inliner uses `getComputedStyle()` to extract ~300 CSS properties per element, then tries to filter out browser defaults. This is fundamentally backwards:

1. **Noise-dominated**: 65+ properties per consolidated class, most are browser defaults (`alignContent: normal`, `borderBlockEndWidth: 0px`, `gridTemplateRows: none`). Only ~5-8 are actually meaningful.

2. **global-styles.json bloat**: 59 classes × 65 properties = 3,835 entries, 1.6 MB. Most entries are noise.

3. **Meaningless inline styles**: 215 blocks carry `gridTemplateRows: none`, `justifyItems: normal`, `backgroundAttachment: scroll` — values Tailwind never set.

4. **Fragile**: Depends on browser internals, viewport-specific pixel values, and incomplete defaults filtering.

## Approach: Intent-Based Style Transfer

Instead of extracting computed styles (what the browser rendered), parse the **compiled Tailwind CSS rules** (what Tailwind intended). The Tailwind CDN compiles utility classes into `<style>` blocks. We read those rules directly and map them to elements by class name.

```
raw HTML → Playwright loads page, CDN compiles
         → Parse document.styleSheets → build class→property registry
         → Per element: look up class list, collect ONLY matching properties
         → Deduplicate shared sets → global-styles.json
         → Unique non-default properties → inline on blocks
         → Pseudo-classes → follow their base (global-styles or inline)
         → @keyframes/::-webkit-*/body rules → custom.css
         → Strip Tailwind classes
         → Pass to existing pipeline
```

## Architecture

### Phase 1: CSS Rule Extraction (replaces getComputedStyle)

After the Tailwind CDN compiles, extract all CSS rules from `document.styleSheets`:

```ts
interface ParsedRule {
  selector: string;        // e.g., ".pt-32" or ".lg\\:pt-48" or ".hover\\:bg-red-500"
  properties: Record<string, string>; // { "padding-top": "8rem" }
  breakpoint?: string;     // "lg", "md", "sm", "xl" — from media query wrapper
  state?: string;          // "hover", "focus", "focus-visible", "active"
  isGroupHover?: boolean;  // true if selector uses .group:hover pattern
  parentGroup?: string;    // "dropdown" for group/dropdown hover
}

interface ClassRegistry {
  // className → rule
  base: Map<string, ParsedRule>;           // .pt-32 { padding-top: 8rem }
  responsive: Map<string, ParsedRule[]>;   // .lg\:pt-48 { padding-top: 12rem } @ lg
  state: Map<string, ParsedRule[]>;        // .hover\:bg-red-500:hover { ... }
}
```

**Parsing logic**:

1. Iterate all `document.styleSheets` (skip cross-origin)
2. For each `CSSStyleRule`:
   - If inside `@media (min-width: ...)`: extract breakpoint name by matching against config screens
   - Check selector for `:hover`, `:focus`, `:focus-visible`, `:active` → extract state
   - Check for `.group/hover` or `.group:hover` patterns → tag as group-hover
   - Unescape Tailwind's class name escaping (`\:` → `:`, `\/` → `/`)
   - Extract properties from `rule.style`
3. Build ClassRegistry indexed by unescaped class name

**Advantages over getComputedStyle()**:
- Only captures properties Tailwind actually set (~5-8 per element vs ~300)
- No browser defaults noise
- No viewport-dependent computed values
- No need for multi-viewport resizes (responsive values come from the rules directly)
- No need for relative value reconstruction (rules have original `1fr`, `100vh`, etc.)
- Pseudo-class properties captured directly (don't need CSSOM scan)

### Phase 2: Per-Element Style Assignment

For each element (identified by `data-gb-idx`):

1. Take its original class list (captured before stripping)
2. Look up each class in the ClassRegistry
3. Collect all properties, organized by breakpoint/state:

```ts
interface ElementStyles {
  base: Record<string, string>;                    // Desktop properties
  responsive: Record<string, Record<string, string>>; // "md" → { props }
  state: Record<string, Record<string, string>>;      // "hover" → { props }
}
```

4. If class list contains `pt-32 lg:pt-48`:
   - `base`: `{ "padding-top": "8rem" }`
   - `responsive.lg`: `{ "padding-top": "12rem" }`

### Phase 3: Property Placement

For each element's style set, decide where each property goes:

| Condition | Location | Example |
|---|---|---|
| Property value is browser default | Stripped | `display: block` on a div |
| Unique to 1 element (non-default) | Inline `styles` on block | Specific `color: #c5ffd6` |
| Shared by 2+ elements | `global-styles.json` class | 12 elements share `display:flex; gap:2rem` |
| `:hover` on a shared class | Same class entry, `"&:hover": {...}` | `.gb-s-abc123:hover{background:#10b981}` |
| `:hover` on a unique element | Inline (GB generates from styles) | Block `styles` with `hoverBackgroundColor` |
| `@keyframes` | `custom.css` | Marquee animation |
| `::-webkit-*` | `custom.css` | Scrollbar styling |
| `body { ... }` | `custom.css` | Body background/text color |

### Phase 4: Responsive Handling

Responsive variants (`lg:`, `md:`, `sm:`) are extracted from the CSS rules directly — the compiled CSS already has them inside `@media` queries. The registry captures which breakpoint each rule belongs to.

For shared classes, responsive overrides go in the class's `data` block as `"@media (max-width: 1023px)": {...}`. For unique elements, responsive overrides stay as inline responsive keys (GB supports `"@media (max-width: 1024px)": {...}` in the styles object).

## Defaults Filter

Since we only capture properties from actual Tailwind rules, the defaults problem is much smaller. But Tailwind does set some properties to their default values explicitly (e.g., `display: block`, `position: static`). These should be stripped.

Filter: for each property in the element's Base set, compare against a reference of CSS initial values. Strip if the value equals the initial value. Only apply to Base set (not responsive or state — those are always intentional overrides).

## Class Consolidation (simplified)

Since we only have 5-8 properties per element (vs 300), the consolidation is simpler:

1. Hash the Base properties (after stripping defaults)
2. Elements sharing the same hash → same class
3. Class used by 2+ elements → `global-styles.json` entry
4. Class used by 1 element → properties go inline on the block
5. Original class names from source CSS (`.blueprint-bg`, `.clip-hex`) are preserved

No more structural/decorative split — we just hash whatever Tailwind set.

## global-styles.json Format (unchanged from previous spec)

```json
[
  {
    "selector": ".gb-s-a1b2c3d4",
    "name": "Generated gb-s-a1b2c3d4",
    "css": ".gb-s-a1b2c3d4{display:flex;flex-direction:column;gap:2rem;padding:2rem}@media(max-width:1023px){.gb-s-a1b2c3d4{flex-direction:column;padding:1.5rem}}",
    "data": {
      "display": "flex",
      "flexDirection": "column",
      "gap": "2rem",
      "paddingTop": "2rem",
      "paddingRight": "2rem",
      "paddingBottom": "2rem",
      "paddingLeft": "2rem",
      "@media (max-width: 1023px)": {
        "flexDirection": "column",
        "paddingTop": "1.5rem",
        "paddingRight": "1.5rem",
        "paddingBottom": "1.5rem",
        "paddingLeft": "1.5rem"
      }
    }
  },
  {
    "selector": ".gb-s-b2c3d4e5",
    "name": "Generated gb-s-b2c3d4e5",
    "css": ".gb-s-b2c3d4e5{display:flex;align-items:center;gap:1rem;padding:1rem}.gb-s-b2c3d4e5:hover{background-color:#10b981;color:#fff}",
    "data": {
      "display": "flex",
      "alignItems": "center",
      "gap": "1rem",
      "paddingTop": "1rem",
      "paddingRight": "1rem",
      "paddingBottom": "1rem",
      "paddingLeft": "1rem",
      "&:hover": {
        "backgroundColor": "#10b981",
        "color": "#fff"
      }
    }
  }
]
```

## custom.css

Contains only what Global Styles can't express:

- `@keyframes marquee-left { ... }`
- `@keyframes marquee-right { ... }`
- `::-webkit-scrollbar { display: none }`
- `.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none }`
- `body { background-color: #EEE; color: #334155; overflow-x: hidden }`

Pseudo-classes that belong to classes in `global-styles.json` are embedded in those class entries. Pseudo-classes on elements with inline-only styles go inline. **No pseudo-classes in custom.css unless the base selector also lives there.**

## Files Changed

| File | Action | What changes |
|---|---|---|
| `src/core/tailwind-inliner.ts` | **Rewrite main logic** | Replace `getComputedStyle()` extraction with CSS rule parsing. Remove multi-viewport capture, defaults filter, relative value reconstruction. Add ClassRegistry building and per-element property collection. |
| `src/core/class-consolidator.ts` | **Simplify** | Remove structural/decorative split. Hash everything Tailwind set (after defaults strip). |
| `src/core/orchestrator.ts` | **Minor** | Wire new inliner output to consolidator. Update InlinerResult interface. |
| `src/core/dom-walker.ts` | **No change** | Section wrapper unchanged. |

## What Goes Away

| Removed | Why |
|---|---|
| Multi-viewport Playwright resizes | Rules already contain responsive values in @media blocks |
| getComputedStyle() loop over all elements | Replaced by CSS rule parsing (1 pass, not per-element) |
| Browser defaults DEFAULTS map | Filter becomes a simple initial-value check on ~5-8 props |
| Relative value reconstruction (fr→repeat, vh→%, etc.) | Rules have original values: `1fr`, `100vh`, `100%` |
| CSSOM state style scan | Pseudo-classes captured during rule parsing |
| Browser-internal property filter (SKIP_PROPS) | No computed values to filter |
| Structural/decorative split | All properties from Tailwind are intentional |

## Output Contract

| Guarantee | How |
|---|---|
| Near pixel-perfect | Properties come from Tailwind's own compiled CSS — exactly what the browser would apply |
| No browser defaults | Only properties from actual Tailwind rules; initial-value filter catches remainder |
| No viewport artifacts | Rules have original values: `1fr`, `100vh`, `100%`, not computed pixels |
| Minimal inline styles | Only unique non-default properties; everything shared → global-styles.json |
| Responsive preserved | Breakpoint overrides extracted from @media rules |
| State styles preserved | :hover/:focus/:active attached to their base (global-styles or inline) |
| Custom CSS minimal | Only @keyframes, ::-webkit-*, body rules |
| Section wrapper | Outer/inner pattern unchanged |

## Deferred

- **Self-verify loop** (Playwright screenshot comparison): post-implementation enhancement, not part of this spec.
