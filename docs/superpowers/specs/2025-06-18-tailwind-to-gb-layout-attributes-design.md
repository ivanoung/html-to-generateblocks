# Design: Tailwind Layout → GB Attributes (V1)

**Date:** 2025-06-18
**Status:** Approved
**Scope:** Map Tailwind Tier 1 layout classes to `generateblocks/element` block JSON `styles` attributes during HTML→GB conversion.

## Problem

Converted GB blocks have Tailwind layout classes (`flex gap-4 items-center grid-cols-3`) in their `class` attribute. The CSS rules for these classes live in `tailwind-utilities.css`, which loads on the frontend but NOT in the Gutenberg block editor. Blocks appear stacked vertically in the editor with no layout context.

## Solution

A pure, deterministic function `tailwindLayoutToGbAttributes(classString)` that:

1. Parses a space-delimited Tailwind class string
2. Maps recognized layout classes to GB block `styles` attributes
3. Returns unmapped classes as `leftoverClasses`

Called during the existing HTML→GB block conversion pipeline, where the original class string is available.

## Architecture

```
HTML element with class="flex gap-4 items-center shadow-lg"
        │
        ▼
tailwindLayoutToGbAttributes("flex gap-4 items-center shadow-lg")
        │
        ▼
{
  styles: {
    display: "flex",
    columnGap: "64px",
    rowGap: "64px",
    alignItems: "center"
  },
  leftoverClasses: "shadow-lg"
}
        │
        ▼
Existing converter merges styles into block JSON,
replaces class with leftoverClasses,
css field captures leftoverClasses as fallback
        │
        ▼
<!-- wp:generateblocks/element {
  "styles": {
    "display": "flex",
    "columnGap": "64px",
    "rowGap": "64px",
    "alignItems": "center"
  },
  "css": ".gb-element-abc{box-shadow:...}"
} -->
<div class="gb-element-abc shadow-lg">
  ...children...
</div>
<!-- /wp:generateblocks/element -->
```

The existing `css` field is the unconditional fallback. Anything the function doesn't map survives as a class and lands in `css`. Zero style loss guaranteed.

## V1 Mapping Table

Limited to editor-critical layout classes (Tier 1). Margin, padding, width, height, position, typography, colors, effects, transforms are excluded — they stay as CSS classes.

### Display / Layout Mode

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `flex` | `display` | `"flex"` |
| `grid` | `display` | `"grid"` |
| `inline-flex` | `display` | `"inline-flex"` |
| `inline-grid` | `display` | `"inline-grid"` |
| `block` | `display` | `"block"` |
| `inline-block` | `display` | `"inline-block"` |
| `hidden` | `display` | `"none"` |

### Flex Container

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `flex-row` | `flexDirection` | `"row"` |
| `flex-col` | `flexDirection` | `"column"` |
| `flex-wrap` | `flexWrap` | `"wrap"` |
| `flex-nowrap` | `flexWrap` | `"nowrap"` |

### Flex Items (Alignment)

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `items-start` | `alignItems` | `"flex-start"` |
| `items-center` | `alignItems` | `"center"` |
| `items-end` | `alignItems` | `"flex-end"` |
| `items-stretch` | `alignItems` | `"stretch"` |
| `items-baseline` | `alignItems` | `"baseline"` |
| `justify-start` | `justifyContent` | `"flex-start"` |
| `justify-center` | `justifyContent` | `"center"` |
| `justify-end` | `justifyContent` | `"flex-end"` |
| `justify-between` | `justifyContent` | `"space-between"` |
| `justify-around` | `justifyContent` | `"space-around"` |
| `justify-evenly` | `justifyContent` | `"space-evenly"` |

### Gap

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `gap-0` | `columnGap`, `rowGap` | `"0px"` |
| `gap-px` | `columnGap`, `rowGap` | `"1px"` |
| `gap-1` through `gap-96` | `columnGap`, `rowGap` | Tailwind spacing scale → px |
| `gap-x-*` | `columnGap` | spacing → px |
| `gap-y-*` | `rowGap` | spacing → px |

### Grid Columns / Rows

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `grid-cols-1` through `grid-cols-12` | `gridTemplateColumns` | `"repeat(N, 1fr)"` |
| `col-span-1` through `col-span-12` | `gridColumn` | `"span N / span N"` |
| `col-span-full` | `gridColumn` | `"1 / -1"` |

## Tailwind Spacing Scale (px values)

```
0→0px, px→1px, 0.5→2px, 1→4px, 1.5→6px, 2→8px, 2.5→10px,
3→12px, 3.5→14px, 4→16px, 5→20px, 6→24px, 7→28px, 8→32px,
9→36px, 10→40px, 11→44px, 12→48px, 14→56px, 16→64px,
20→80px, 24→96px, 28→112px, 32→128px, 36→144px, 40→160px,
44→176px, 48→192px, 52→208px, 56→224px, 60→240px, 64→256px,
72→288px, 80→320px, 96→384px
```

## Handling Known Edge Cases

1. **Partial conversion:** `"flex gap-4 shadow-lg"` → `flex` and `gap-4` become styles, `shadow-lg` stays as leftover class. Normal operation, not a special case.

2. **Duplicate mapping:** If a class maps to a styles key already set by the existing converter (e.g., margin via inline style), the layout mapper's value takes precedence (layout mapper runs after inline extraction).

3. **Nested blocks:** GB attributes are applied per-block. A child block's `display: grid` doesn't conflict with its parent's `display: flex` — same as vanilla CSS.

4. **Removing classes changes specificity:** When `flex` is removed from the class string but `flex-wrap` stays, the element no longer has `display: flex` from CSS — but the GB `styles` attribute sets `display: flex`. Since GB injects styles as inline CSS on the element, it wins over class-based CSS. The visual result is identical.

5. **Responsive variants** (`sm:flex`, `md:grid-cols-3`): NOT mapped in V1. These survive as classes and go to `leftoverClasses`. The css fallback handles them.

6. **Generated class names:** The `gb-element-{hash}` class is appended by the converter. The function never strips it — it only strips classes it explicitly maps.

## What's NOT in V1

- Responsive variants (`sm:`, `md:`, `lg:`, etc.) — too complex for GB's responsive controls in V1
- Margin/padding — already handled by existing converter
- Width/height — edge cases with `full`, `screen`, `min`, `max`, `fit`, arbitrary values
- Position/inset — needs parent context
- Typography, colors, borders — cosmetic, not editor-critical
- Effects, transforms, transitions — can't map to GB attributes

All unmapped classes remain as CSS classes on the element and are preserved in the `css` field.

## Testing Strategy

1. **Unit tests for `tailwindLayoutToGbAttributes()`:** Pure function, test a matrix of class combinations against expected outputs
2. **Integration test:** Full conversion on mino, verify block JSON contains layout attributes, old classes stripped, leftover classes preserved
3. **Visual regression:** Convert mino, diff block markup against previous runs to confirm only class→style changes
4. **Edge case tests:** Partial conversion, empty class strings, unrecognized classes, duplicate styles keys

## Implementation Notes

- New file: `src/core/tailwind-layout-mapper.ts`
- Modify: existing HTML→GB converter to call mapper during element→block conversion
- Uses the same `isTailwindUtility()` pattern: explicit regex enumeration, no guessing
- The `TailwindMapEntry` table is an array of `{ pattern: RegExp, styles: Record<string, string>, consumedClass: string }` objects
- Order matters: more specific patterns tested before general ones
- Function signature: `tailwindLayoutToGbAttributes(classString: string, config?: TailwindConfig) → { styles: Record<string, string>, leftoverClasses: string }`
- Optional `config` parameter includes spacing scale for gap resolution
