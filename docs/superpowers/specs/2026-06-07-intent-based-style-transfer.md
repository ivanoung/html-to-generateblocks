# Intent-Based Style Transfer — Design Spec (v2)

**Date:** 2026-06-07
**Status:** Design (awaiting approval)

## Problem

The current inliner uses `getComputedStyle()` to extract ~300 CSS properties per element, then tries to filter out browser defaults. This is fundamentally backwards:

1. **Noise-dominated**: 65+ properties per consolidated class, most are browser defaults (`alignContent: normal`, `borderBlockEndWidth: 0px`, `gridTemplateRows: none`). Only ~5-8 are actually meaningful.

2. **global-styles.json bloat**: 59 classes × 65 properties = 3,835 entries, 1.6 MB.

3. **Meaningless inline styles**: 215 blocks carry `gridTemplateRows: none`, `justifyItems: normal`, `backgroundAttachment: scroll`.

4. **Fragile**: Depends on browser internals, viewport-specific pixel values, and incomplete defaults filtering.

## Approach: Intent-Based Style Transfer

Instead of extracting computed styles (what the browser rendered), parse the **compiled Tailwind CSS rules** (what Tailwind intended). The Tailwind CDN compiles utility classes into `<style>` blocks. We read those rules directly and map them to elements by class name.

```
raw HTML → Playwright loads page, CDN compiles
         → Parse document.styleSheets → build ClassRegistry
         → Per element: look up class list, collect matching properties
         → Merge with existing inline styles from source
         → Resolve CSS variables in transform/filter properties
         → Normalize values (hex colors, strip 0px)
         → Deduplicate shared sets → global-styles.json
         → Unique non-default properties → inline on blocks
         → Pseudo-classes → follow their base (global-styles or inline)
         → Element selectors, @keyframes, ::-webkit-* → custom.css
         → Strip Tailwind classes
         → Pass to existing pipeline
```

## Architecture

### Phase 1: CSS Rule Extraction

After the Tailwind CDN compiles, iterate `document.styleSheets` and classify every rule:

```ts
type RuleKind = "class-base" | "class-state" | "class-responsive" | "compound" | "element" | "keyframe" | "vendor-pseudo";

interface ParsedRule {
  kind: RuleKind;
  selector: string;
  className?: string;          // Unescaped class name for class-based rules
  properties: Record<string, string>;
  breakpoint?: string;         // "lg" | "md" | "sm" | "xl"
  state?: string;              // "hover" | "focus" | "focus-visible" | "active"
}

interface ClassRegistry {
  base: Map<string, ParsedRule>;           // .pt-32 { padding-top: 8rem }
  responsive: Map<string, ParsedRule[]>;   // .lg\:pt-48 → @media (min-width: 1024px)
  state: Map<string, ParsedRule[]>;        // .hover\:bg-red-500:hover
}

interface ExtractionResult {
  registry: ClassRegistry;
  customCssRules: string[];    // Element selectors, @keyframes, ::-webkit-*, body rules
}
```

**Classification logic** (runs inside `page.evaluate()`):

1. Iterate all `document.styleSheets` (skip cross-origin via try/catch)
2. For each `CSSStyleRule`:
   - Extract selector text
   - **Class-based** (selector starts with `.` followed by a class name): unescape Tailwind escaping (`\:` → `:`, `\/` → `/`, `\.` → `.`). Check for `:hover`, `:focus`, `:focus-visible`, `:active` → classify as `class-state`. Check for compound selectors (contains `>`, `~`, `+`, space-separated classes) → classify as `compound`.
   - **Element/universal** (selector doesn't start with `.`): route to `customCssRules`. Includes: `body`, `*`, `::before`, `::after`, `h1-h6`, `a`, `img`, `:host`, `html`, `hr`, `abbr`, `code`, `small`, `sub`, `sup`, `table`, `button`, `input`, `select`, `textarea`.
   - **Vendor-prefixed** (selector contains `::-webkit-` or `::-moz-` or `::-ms-`): route to `customCssRules`.
   - If inside `@media (min-width: ...)`: extract breakpoint name. Match pixel value against config screens (`{ sm: "640px", md: "768px", lg: "1024px", xl: "1280px" }`). The compiled CDN uses `min-width` (mobile-first). Convert to `max-width` for GB's desktop-first style panel (e.g., `min-width: 1024px` → `max-width: 1023px`).
   - Extract properties from `rule.style`. **Filter out `--tw-*` properties** (CSS custom properties used internally by Tailwind).
3. For `CSSKeyframesRule`: extract name + keyframes text → `customCssRules`.
4. Build `ClassRegistry` indexed by unescaped class name (without breakpoint/state prefix).
5. Also collect the Tailwind config's `theme.screens` for breakpoint name resolution.

### Phase 2: Per-Element Style Assignment

For each element (identified by `data-gb-idx`):

1. **Capture existing inline style**: save the element's `style` attribute before modification.
2. **Split class list**: separate responsive-prefixed classes (`lg:pt-48`) from base classes (`pt-32`) and state classes (`hover:bg-red-500`).
3. **Look up in ClassRegistry**:
   - Base classes → `base` properties
   - Responsive classes → `responsive[breakpoint]` properties (overrides base for same property)
   - State classes → `state[state]` properties
4. **Handle compound selectors**: for rules with compound selectors (e.g., `.group\/dropdown:hover .invisible`), check if the element matches the full selector in the DOM context. If yes, include properties.
5. **Merge with existing inline styles**: Tailwind properties first, then existing inline properties (existing wins for conflicts).
6. **Resolve CSS variables in transform/filter** (see Phase 3).
7. **Normalize values** (see Phase 4).

```ts
interface ElementStyles {
  base: Record<string, string>;                      // Desktop properties
  responsive: Record<string, Record<string, string>>; // "lg" → { props }
  state: Record<string, Record<string, string>>;      // "hover" → { props }
  compound: Record<string, string>;                   // Compound selector overrides
}
```

### Phase 3: CSS Variable Resolution

Tailwind's transform/translate/scale/rotate/skew utilities use CSS custom properties (`--tw-translate-x`, `--tw-translate-y`, `--tw-rotate`, `--tw-scale-x`, `--tw-scale-y`, `--tw-skew-x`, `--tw-skew-y`).

After collecting all properties for an element:

1. **Collect variable values**: from the element's matching rules AND from the preflight reset (`* { --tw-translate-x: 0; --tw-translate-y: 0; --tw-rotate: 0; --tw-scale-x: 1; --tw-scale-y: 1; --tw-skew-x: 0; --tw-skew-y: 0 }`), collect all `--tw-*` values.
2. **Find the `transform` property**: if any matching rule sets `transform`, extract it.
3. **Substitute variables**: replace `var(--tw-translate-x)`, `var(--tw-translate-y)`, etc. with their collected values.
4. **Simplify**: remove identity components from the transform string:
   - `translate(0px, 0px)` → remove
   - `rotate(0deg)` → remove
   - `scaleX(1) scaleY(1)` → `scale(1)` → remove
   - `skewX(0deg) skewY(0deg)` → remove
5. **Output clean transform**: e.g., `transform: translateY(-0.5rem) scale(1.1)`
6. **Remove `--tw-*` properties** from the final output (they're not visual).

Same logic applies to `filter` (uses `--tw-blur`, `--tw-brightness`, etc.) and `backdrop-filter`.

**Special case — multiple transform classes on one element**: Each class sets its specific variable AND the full transform shorthand. During Phase 2, we collect ALL variable values from ALL matching classes. The last rule's `transform` value is used (CSS cascade). Since we already captured all variable values, the substitution produces the correct combined transform.

### Phase 4: Value Normalization

Before hashing or output, normalize values for consistency:

| Raw | Normalized |
|---|---|
| `rgb(51, 65, 85)` | `#334155` |
| `rgba(16, 185, 129, 0.1)` | Keep as-is (alpha channel) |
| `0px` | `0` |
| `rgb(0, 0, 0)` | `#000` |
| `rgb(255, 255, 255)` | `#fff` |
| `transparent` | `transparent` (unchanged) |

Color normalization uses a hex conversion: parse `rgb(r, g, b)` → `#rrggbb`, use shorthand `#rgb` if all pairs match.

### Phase 5: Property Placement

For each element's resolved `ElementStyles`:

| Condition | Location | Example |
|---|---|---|
| Property value is CSS initial value | Stripped | `display: block` on a div |
| Unique to 1 element (non-default) | Inline `styles` on block | Specific `color: #c5ffd6` |
| Shared by 2+ elements | `global-styles.json` class | 12 elements share `display:flex; gap:2rem` |
| `:hover` on shared class | Same class entry, `"&:hover": {...}` | `.gb-s-abc123:hover{background:#10b981}` |
| `:hover` on unique element | Inline (GB generates hover from styles) | Block `styles.hoverBackgroundColor` |
| Element selectors (`body`, `*`, `h1-h6`) | `custom.css` | `body { background: #eee }` |
| `@keyframes` | `custom.css` | `@keyframes marquee-left { ... }` |
| `::-webkit-*`, `::-moz-*` | `custom.css` | `::-webkit-scrollbar { display: none }` |
| CSS variables `--tw-*` | Stripped | Already resolved in Phase 3 |

**CSS initial values reference** (strip these from base set — they're not meaningful):

```
display: inline (for spans) / block (for divs) — match against tag defaults
position: static
margin: 0
padding: 0
border-width: 0
border-radius: 0
flex: 0 1 auto
order: 0
float: none
opacity: 1
z-index: auto
overflow: visible
box-sizing: content-box
visibility: visible
```

### Phase 6: Class Consolidation

1. Hash the Base properties (after stripping defaults and normalizing)
2. Elements sharing same hash → same class
3. Class used by 2+ elements → `global-styles.json` entry
4. Class used by 1 element → properties go inline on block
5. Original class names from source CSS (`.blueprint-bg`, `.clip-hex`, `.hover-shadow-md`) preserved — their selector is used as-is
6. Responsive deltas stored in class's `data` as `"@media (max-width: Npx)": {...}`
7. State styles stored as `"&:hover"`/`"&:focus"`/`"&:focus-visible"`/`"&:active"` in class data

### Phase 7: State-only classes

Classes like `.hover-shadow-md` have no base properties, only `:hover`. These produce class entries with only the `&:hover` block:

```json
{
  "selector": ".hover-shadow-md",
  "name": "Hover Shadow Md",
  "css": ".hover-shadow-md:hover{box-shadow:0 0 0 1px rgba(0,0,0,0.06),0 1px 1px -0.5px rgba(0,0,0,0.06),0 3px 3px -1.5px rgba(0,0,0,0.06),0 6px 6px -3px rgba(0,0,0,0.06),0 12px 12px -6px rgba(0,0,0,0.06),0 24px 24px -12px rgba(0,0,0,0.06)}",
  "data": {
    "&:hover": {
      "boxShadow": "0 0 0 1px rgba(0,0,0,0.06),0 1px 1px -0.5px rgba(0,0,0,0.06),0 3px 3px -1.5px rgba(0,0,0,0.06),0 6px 6px -3px rgba(0,0,0,0.06),0 12px 12px -6px rgba(0,0,0,0.06),0 24px 24px -12px rgba(0,0,0,0.06)"
    }
  }
}
```

### Phase 8: custom.css Assembly

Assemble from `customCssRules` collected in Phase 1, plus any pseudo-class styles that don't have a corresponding base class:

1. Element selectors (`body`, `*`, `::before`, `::after`, `h1-h6`, `a`, `img`, etc.)
2. `@keyframes` definitions
3. `::-webkit-*` / `::-moz-*` pseudo-element rules
4. Any class-based rules from the original `<head> <style>` blocks that we preserved original names for

Body-level rules are critical — they set the page's base `background-color`, `color`, `overflow-x`, and font defaults.

## global-styles.json Format

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
    "selector": ".hover-shadow-md",
    "name": "Hover Shadow Md",
    "css": ".hover-shadow-md:hover{box-shadow:0 0 0 1px rgba(0,0,0,0.06),...}",
    "data": {
      "&:hover": {
        "boxShadow": "0 0 0 1px rgba(0,0,0,0.06),..."
      }
    }
  }
]
```

## custom.css Format

```css
/* Tailwind Preflight / Reset */
*, ::before, ::after { box-sizing: border-box; border: 0 solid #e5e7eb; }
body { margin: 0; line-height: inherit; background-color: #eee; color: #334155; overflow-x: hidden; }

/* @keyframes */
@keyframes marquee-left { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
@keyframes marquee-right { 0% { transform: translateX(-50%); } 100% { transform: translateX(0); } }

/* Vendor-prefixed */
.no-scrollbar::-webkit-scrollbar { display: none; }
```

## Files Changed

| File | Action | What changes |
|---|---|---|
| `src/core/tailwind-inliner.ts` | **Rewrite** | CSS rule parsing replaces getComputedStyle. Phases 1-5 (extraction, assignment, variable resolution, normalization, placement). Removes: multi-viewport capture, defaults DEFAULTS map, relative value reconstruction, browser-internal SKIP_PROPS, structural/decorative split. |
| `src/core/class-consolidator.ts` | **Simplify** | Phases 6-7. No more structural/decorative split — hash whatever Tailwind set. Handle state-only classes. Preserve original CSS class names. |
| `src/core/orchestrator.ts` | **Minor** | Wire new inliner + consolidator output. Write global-styles.json + custom.css. |
| `src/core/dom-walker.ts` | **No change** | Section wrapper unchanged. |

## What Gets Removed

| Removed module/logic | Why |
|---|---|
| Multi-viewport Playwright resizes | Rules contain @media breakpoints |
| getComputedStyle() per-element loop | Replaced by CSS rule parsing |
| Browser DEFAULTS filter (40 properties) | Only ~5-8 Tailwind properties per element; simple initial-value check |
| Relative value reconstruction | Rules have original `1fr`, `100vh`, `100%` |
| CSSOM state style scan | Pseudo-classes captured during rule parsing |
| Browser-internal SKIP_PROPS filter (120+ properties) | No computed values to filter |
| Structural/decorative split | All Tailwind properties are intentional |
| `width`/`height` explicit sizing check | No viewport artifacts |

## Output Contract

| Guarantee | How |
|---|---|
| Near pixel-perfect | Properties from Tailwind's compiled CSS + CSS variable resolution |
| No browser defaults | Only Tailwind-set properties; initial-value filter on ~5-8 props |
| No viewport artifacts | Rules have original units: `1fr`, `100vh`, `100%` |
| Minimal inline styles | Only unique non-default properties; shared → global-styles.json |
| Responsive preserved | Breakpoint overrides from @media rules |
| State styles preserved | :hover/:focus/:active follow their base |
| Custom CSS minimal | Only element selectors, @keyframes, ::-webkit-*, body rules |
| Section wrapper | Outer/inner pattern unchanged |
| Inline styles from source preserved | Captured before processing, merged with Tailwind properties |

## Deferred

- **Self-verify loop** (Playwright screenshot comparison of original vs converted): post-implementation enhancement.

## Design Decisions

- **Mobile-first to desktop-first**: Tailwind CDN compiles with `min-width` media queries (mobile-first). GB's style panel uses desktop-first. During Phase 1, convert: `@media (min-width: 1024px)` → breakpoint `"lg"` stored as `"@media (max-width: 1023px)"` override.
- **CSS variable resolution**: Done per-element in Phase 3, not globally. Each element may have different transform classes.
- **Value normalization**: Applied before hashing to ensure `rgb(51,65,85)` and `#334155` produce the same hash.
- **Compound selectors**: Limited support — only simple descendant patterns (`.parent .child`). Complex combinators (`>`, `~`, `+`) with `:not()` are skipped (fallback: properties not captured for those rules).
