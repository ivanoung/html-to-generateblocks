# Property-Based CSS Split for Editor Preview Fidelity

> **Status:** Design approved — ready for implementation plan

**Goal:** Move structural and typography Tailwind utility classes into GB Global Styles so blocks render correctly in the block editor. Effects, backgrounds, and colors stay in `styles-unique.css` (Additional CSS via WPCodeBox). The current selector-pattern-based split (GS = custom design tokens only, UC = all utilities) is replaced with property-based classification.

**Architecture:** `css-splitter.ts` is rewritten to classify each CSS rule by the properties of its declarations rather than by selector pattern. `@media` blocks are recursed into so responsive variants can be classified individually while preserving their media query wrappers.

**Tech Stack:** TypeScript, `css` npm package (v3.0.0)

---

## Property Classification

The classification is explicit and conservative: every CSS property we handle falls into exactly one of two named sets. Properties not in either set default to styles-unique.css as a safety net.

### GS_ELIGIBLE_PROPERTIES (→ global-styles.json)

These are the properties that become Global Style entries when they appear in a single-class rule with no UC-only properties:

**Layout**
- `display`
- `flex-direction`, `flex-wrap`
- `align-items`, `align-content`, `align-self`
- `justify-content`, `justify-items`, `justify-self`
- `gap`, `column-gap`, `row-gap`
- `place-items`, `place-content`, `place-self`
- `position`
- `z-index`
- `overflow`, `overflow-x`, `overflow-y`
- `visibility`

**Sizing**
- `width`, `height`
- `min-width`, `max-width`
- `min-height`, `max-height`
- `aspect-ratio`

**Flex & Grid**
- `flex`, `flex-grow`, `flex-shrink`, `flex-basis`
- `order`
- `grid-template-columns`, `grid-template-rows`
- `grid-column`, `grid-row`, `grid-area`
- `grid-auto-columns`, `grid-auto-rows`, `grid-auto-flow`

**Spacing**
- `padding`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left`
- `margin`, `margin-top`, `margin-right`, `margin-bottom`, `margin-left`
- `box-sizing`

**Borders**
- `border`, `border-top`, `border-right`, `border-bottom`, `border-left`
- `border-width`, `border-top-width`, `border-right-width`, `border-bottom-width`, `border-left-width`
- `border-style`, `border-top-style`, `border-right-style`, `border-bottom-style`, `border-left-style`
- `border-radius`, `border-top-left-radius`, `border-top-right-radius`, `border-bottom-left-radius`, `border-bottom-right-radius`

**Positioning**
- `top`, `right`, `bottom`, `left`
- `inset`, `inset-block`, `inset-inline`

**Float & Clear**
- `float`, `clear`

**Object**
- `object-fit`, `object-position`

**Typography**
- `font-family`, `font-size`, `font-weight`, `font-style`, `font-variant`
- `line-height`, `letter-spacing`, `word-spacing`
- `text-align`, `text-align-last`
- `text-transform`, `text-decoration`, `text-decoration-line`
- `text-indent`
- `white-space`, `word-break`, `overflow-wrap`
- `vertical-align`
- `direction`, `writing-mode`

**Text Color**
- `color`

**Container Queries**
- `container-type`, `container-name`

**Outline (structural only)**
- `outline`, `outline-width`, `outline-style`, `outline-offset`

---

### UC_ONLY_PROPERTIES (→ styles-unique.css)

These properties, if present anywhere in a rule's declarations, force the entire rule into styles-unique.css:

**Background Colors**
- `background-color`

**Background Images & Gradients**
- `background-image`
- `background-size`
- `background-position`, `background-position-x`, `background-position-y`
- `background-repeat`
- `background-attachment`
- `background-clip`, `background-origin`
- `background` (shorthand — treated as UC-only unless value is a simple color; see shorthand handling below)
- `background-blend-mode`

**Effects**
- `transform`, `transform-origin`, `transform-style`
- `filter`, `backdrop-filter`
- `opacity`
- `box-shadow`, `text-shadow`
- `mix-blend-mode`
- `clip-path`
- `mask`, `mask-image`, `mask-size`, `mask-position`, `mask-repeat`, `mask-composite`, `mask-mode`

**Transitions**
- `transition`, `transition-delay`, `transition-duration`, `transition-property`, `transition-timing-function`, `transition-behavior`

**Animations**
- `animation`, `animation-name`, `animation-duration`, `animation-timing-function`, `animation-delay`, `animation-iteration-count`, `animation-direction`, `animation-fill-mode`, `animation-play-state`

**Interaction**
- `cursor`
- `pointer-events`
- `user-select`
- `scroll-behavior`, `scroll-snap-type`, `scroll-snap-align`
- `resize`
- `touch-action`

**Performance hints**
- `will-change`
- `perspective`, `perspective-origin`
- `backface-visibility`

**Colors (non-text)**
- `border-color`, `border-top-color`, `border-right-color`, `border-bottom-color`, `border-left-color`
- `outline-color`
- `accent-color`, `caret-color`
- `text-decoration-color`
- `column-rule-color`

**Other/Content**
- `content`
- `isolation`

---

### Background Shorthand Handling

The `background` shorthand property is a special case. Its classification depends on the value:

- If the value contains `url(`, `linear-gradient`, `radial-gradient`, `conic-gradient`, `repeating-`, or a comma (multi-layer) → **UC-only**
- If the value is a simple color (hex, rgb, hsl, or named color) → treat as `background-color` → **GS-eligible**
- All other values → **UC-only** (safe default)

---

### Fallback: Unclassified Properties

Any CSS property not listed in either `GS_ELIGIBLE_PROPERTIES` or `UC_ONLY_PROPERTIES` defaults to **UC-only**. This includes:
- CSS custom properties (`--*`)
- Vendor-prefixed properties (`-webkit-*`, `-moz-*`)
- Future CSS properties not yet classified
- Rare or edge-case properties

This ensures we never accidentally promote an unvetted property to Global Styles.

---

## Classification Algorithm

```
function classifyRule(rule):
  declarations = parseDeclarations(rule)
  
  for each decl in declarations:
    prop = normalize(decl.property)
    
    if prop in UC_ONLY_PROPERTIES:
      return UC
    if prop in GS_ELIGIBLE_PROPERTIES:
      continue
    // Unclassified property → safe fallback
    return UC
  
  // All properties are GS-eligible
  if rule has single class selector:
    return GS
  else:
    return UC
```

**For `@media` blocks:** Recursively walk children. Each child is classified independently. If GS-eligible, the parent `@media` wrapper is included in the `css` field of the GlobalStyleEntry. Children classified as UC are appended to `uniqueCssParts` with the `@media` wrapper preserved.

**Pseudo-classes** (`:hover`, `:focus`, `:active`, `:first-child`, etc.) are preserved on the selector. They do not affect classification — only the declaration properties matter.

**Pseudo-elements** (`::before`, `::after`, `::placeholder`, `::-webkit-scrollbar`, etc.) force the rule to UC regardless of properties. Pseudo-elements are not class-based styling.

---

## Output Format (global-styles.json)

Unchanged from current format:

```json
[
  {
    "name": "Flex",
    "selector": ".flex",
    "css": ".flex{display:flex}"
  },
  {
    "name": "Md Flex",
    "selector": ".md\\:flex",
    "css": "@media(min-width:768px){.md\\:flex{display:flex}}"
  },
  {
    "name": "Pt 32",
    "selector": ".pt-32",
    "css": ".pt-32{padding-top:8rem}"
  }
]
```

Note: `name` is derived from the selector (kebab → Title Case). Responsive variants include the breakpoint prefix (e.g., "Md Flex").

---

## Load Order

WordPress frontend CSS load order (with recommended WPCodeBox configuration):

| Priority | Source | Content |
|---|---|---|
| 10 | WPCodeBox snippet (`wp_head`) | `styles-unique.css` — backgrounds, effects, colors, preflight, keyframes |
| 20 | GB Global Styles (built-in) | `global-styles.json` — structural + typography classes |
| 25 | GB block-specific CSS (built-in) | Per-block dynamic styles from block attributes |

**Rationale:** Preflight resets load first to establish baseline. Global Styles load next to apply layout/typography. Block-specific CSS loads last for overrides.

For the editor: only Global Styles are loaded via `add_editor_styles_css()`. `styles-unique.css` is not loaded in the editor, which is the intended behavior — the editor needs structural/typography for layout correctness; backgrounds and effects are visually acceptable without.

---

## Files

### Rewrite: `src/core/css-splitter.ts`

**New exports:**
```typescript
export const GS_ELIGIBLE_PROPERTIES: Set<string>;
export const UC_ONLY_PROPERTIES: Set<string>;

export function splitCss(
  compiledCss: string,
  customClassNames?: Set<string>,
): CssSplitResult;
```

**Key changes from current implementation:**
1. Remove `isSingleClassSelector()` — still used but classification is no longer selector-driven
2. Add `classifyDeclarations(declarations)` — checks each property against UC_ONLY / GS_ELIGIBLE
3. Add `isBackgroundShorthandValueSafe(value)` — determines if `background` shorthand is a simple color
4. `walkRule()` now recurses into `@media` children and classifies each individually
5. `walkRule()` preserves `@media` wrapper when building GlobalStyleEntry.css for responsive classes
6. Pseudo-element detection (`::`) continues to force UC
7. Custom class names from `<style>` blocks still receive priority treatment (they can bypass property checks if they're known custom design tokens)

### Modify: `src/core/types.ts`

Add the property set constants (exported for testing):
```typescript
export const GS_ELIGIBLE_PROPERTIES: ReadonlySet<string>;
export const UC_ONLY_PROPERTIES: ReadonlySet<string>;
```

### No change: `src/core/orchestrator.ts`

The `splitCss()` function signature remains compatible. Custom class names are still passed as a `Set<string>`.

### New: Tests for `css-splitter`

| Test | Description |
|---|---|
| Structural class → GS | `.flex{display:flex}` becomes a GS entry |
| Typography class → GS | `.text-lg{font-size:1.125rem;line-height:1.75rem}` becomes GS |
| Color class → GS | `.text-primary{color:var(--primary)}` becomes GS |
| Background-color class → UC | `.bg-primary{background-color:var(--primary)}` stays in UC |
| Effect class → UC | `.shadow{box-shadow:0 1px 3px rgba(0,0,0,0.1)}` stays in UC |
| Mixed class → UC | `.btn{padding:1rem;transition:0.3s}` stays in UC (transition is UC-only) |
| Responsive class → GS | `.md\:flex` inside `@media(min-width:768px)` becomes GS with @media wrapper |
| Responsive bg-color → UC | `.md\:bg-primary` inside `@media` stays in UC |
| Pseudo-element → UC | `.no-scrollbar::-webkit-scrollbar` stays in UC |
| Element selector → UC | `h1,h2,h3` stays in UC |
| Keyframes → UC | `@keyframes spin` stays in UC |
| Unclassified property → UC | A property not in either set forces the rule to UC |
| Preflight reset → UC | `*,:after,:before{box-sizing:border-box}` stays in UC |

---

## Migration Notes

**Impact on existing output:** The `global-styles.json` file will grow from ~5 entries (custom design tokens only) to potentially hundreds of entries (all structural + typography utility classes). The `styles-unique.css` file will shrink accordingly, containing only background/effect/color utilities, preflight, element selectors, and keyframes.

**Backward compatibility:** The output format (`GlobalStyleEntry` shape) is unchanged. Existing import workflows (manual JSON paste into GB Global Styles admin page) continue to work.

**Custom class priority:** Classes extracted from the source HTML's `<style>` blocks via `classNameToProperties` still get special treatment — they bypass the property-based classification and always go to GS if they're a single class selector. This preserves the current behavior for genuine design tokens like `.blueprint-bg`.

---

## Scope Boundaries

**In scope:**
- Property-based classification replacing selector-pattern-based classification in `css-splitter.ts`
- `@media` block recursion for responsive variant classification
- `background` shorthand value inspection
- Property set constants in `types.ts`
- Unit tests for all classification scenarios
- WPCodeBox load order documentation in `manual-steps.txt`

**Out of scope:**
- Changing the GB block markup or `globalClasses` attributes
- Changing `global-styles-collector.ts` or per-page `globalClasses` logic
- Auto-import into WordPress
- The slate shade auto-expansion (separate deferred item)
- Splitting individual properties within a single rule (all-or-nothing per rule)
- User-configurable property sets (the sets are hardcoded based on GB plugin source analysis)

---

## Self-Review

1. **Placeholder scan:** No TBD, TODO, or incomplete sections.
2. **Internal consistency:** Property classification matches GB plugin source (`functions.php` CSS helpers). Load order matches WordPress hook priorities found in `class-styles-enqueue.php` (priority 20) and `class-enqueue-css.php` (priority 25). Output format matches existing `GlobalStyleEntry` interface.
3. **Scope check:** Focused on `css-splitter.ts` rewrite plus property constants. No unrelated refactoring.
4. **Ambiguity:** Property sets are exhaustive and explicit. Fallback rule (unclassified → UC) prevents ambiguity for edge cases. `background` shorthand has explicit value-based branching. Pseudo-elements have an explicit UC gate.
