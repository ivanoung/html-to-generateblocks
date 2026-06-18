# Design: Tailwind Layout → GB Attributes (V1)

**Date:** 2025-06-18
**Status:** Approved (revised after spike + model review)
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
    gap: "16px",
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
    "gap": "16px",
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

## Verified GB Block Schema (from live WordPress blocks)

All keys and values below were confirmed working in GenerateBlocks element blocks. Source: `style-parser.ts` mapping table + live block JSON from user's WordPress instance.

| GB key | Evidence |
|---|---|
| `display` | `"inline-flex"`, `"inline-grid"`, `"flex"`, `"grid"` all confirmed |
| `gap` | Shorthand works; accepts px, em, rem, %, vw, vh, ch |
| `columnGap`, `rowGap` | Directional gaps confirmed |
| `flexDirection`, `flexWrap` | Confirmed via style-parser.ts CSS→GB map |
| `alignItems`, `alignSelf`, `alignContent` | Confirmed |
| `justifyContent`, `justifyItems`, `justifySelf` | Confirmed |
| `gridTemplateColumns` | `"repeat(2, minmax(0, 1fr))"` confirmed (Tailwind's compiled value) |
| `gridTemplateRows` | Confirmed |
| `gridColumn`, `gridRow` | Confirmed |
| `flex`, `flexGrow`, `flexShrink`, `flexBasis` | Confirmed |
| `order` | Confirmed |
| Width/height units | px, em, rem, %, vw, vh, ch all accepted |

## Algorithm Specification

The function processes classes left-to-right in the order they appear in the original class string. This is deterministic: for the same input string, output is always identical.

### Processing rules

1. **Split**: `classString.trim().split(/\s+/)` → ordered array of class tokens
2. **Deduplicate (preserving first occurrence)**: remove duplicate class tokens, keeping the first instance
3. **Map**: iterate tokens in order. For each token, test against the mapping table in priority order (see below). On first match:
   - Extract the target GB styles from the mapping entry
   - Set each key→value in the styles accumulator (last-write-wins per key)
   - Remove the matched token from the class list
4. **Accumulate**: unmapped tokens become `leftoverClasses`, joined with single spaces in original order
5. **Merge**: the caller shallow-merges the returned `styles` object into the block's existing `styles` object. If a key already exists (e.g., from inline style parsing), the mapper's value takes precedence (mapper runs after inline extraction)

### Mapping table priority

Patterns are tested in this explicit order. More specific patterns MUST appear before more general ones:

```
1. gap-x-*  (directional gap) → columnGap
2. gap-y-*  (directional gap) → rowGap
3. gap-*    (bidirectional gap) → gap shorthand
4. flex-row / flex-col / flex-row-reverse / flex-col-reverse → flexDirection
5. flex-wrap / flex-nowrap / flex-wrap-reverse → flexWrap
6. flex-1 / flex-auto / flex-none / flex-initial → flex
7. grow / grow-0 → flexGrow
8. shrink / shrink-0 → flexShrink
9. grid-cols-* → gridTemplateColumns
10. grid-rows-* → gridTemplateRows
11. col-span-* → gridColumn
12. col-start-* / col-end-* → gridColumnStart / gridColumnEnd
13. row-span-* / row-start-* / row-end-* → gridRow / gridRowStart / gridRowEnd
14. items-* (align-items) → alignItems
15. justify-* (justify-content) → justifyContent
16. self-* (align-self) → alignSelf
17. justify-self-* (justify-self) → justifySelf
18. content-* (align-content) → alignContent
19. place-items-* → placeItems
20. place-content-* → placeContent
21. place-self-* → placeSelf
22. order-* → order
23. grid-flow-* → gridAutoFlow
24. auto-cols-* → gridAutoColumns
25. auto-rows-* → gridAutoRows
26. overflow-* → overflow
27. display values (flex, grid, inline-flex, inline-grid, block, inline-block, hidden) → display
28. basis-* → flexBasis
```

### Gap interaction resolution

`gap-4` maps to BOTH `columnGap: "16px"` and `rowGap: "16px"` (no shorthand). Directional gaps map individually:
- `gap-x-8` → `columnGap: "32px"` (only sets column gap)
- `gap-y-4` → `rowGap: "16px"` (only sets row gap)

If both appear in the same class string (`gap-4 gap-x-8`), processing order (left-to-right, last-write-wins) determines the final `columnGap`: `gap-4` sets both axes, then `gap-x-8` overrides column to 32px:
```
"gap-4 gap-x-8" → { columnGap: "32px", rowGap: "16px" }
```

### Partial / arbitrary matches

If a class token matches a pattern (e.g., `/^gap-/`) but the extracted value is not in the spacing lookup table (e.g., `gap-[13px]`), the token is **NOT consumed**. It passes through to `leftoverClasses`. This ensures arbitrary values that don't fit the lookup table are preserved in the CSS fallback.

### Whitespace normalization

Input is `trim()`ed before splitting. Multiple spaces are collapsed by `split(/\s+/)`. The `leftoverClasses` output uses a single space as separator (no leading/trailing spaces).

## V1 Mapping Table

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

### Flex Container Direction

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `flex-row` | `flexDirection` | `"row"` |
| `flex-row-reverse` | `flexDirection` | `"row-reverse"` |
| `flex-col` | `flexDirection` | `"column"` |
| `flex-col-reverse` | `flexDirection` | `"column-reverse"` |

### Flex Wrap

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `flex-wrap` | `flexWrap` | `"wrap"` |
| `flex-nowrap` | `flexWrap` | `"nowrap"` |
| `flex-wrap-reverse` | `flexWrap` | `"wrap-reverse"` |

### Flex Child Sizing

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `flex-1` | `flex` | `"1 1 0%"` |
| `flex-auto` | `flex` | `"1 1 auto"` |
| `flex-initial` | `flex` | `"0 1 auto"` |
| `flex-none` | `flex` | `"none"` |
| `grow` | `flexGrow` | `"1"` |
| `grow-0` | `flexGrow` | `"0"` |
| `shrink` | `flexShrink` | `"1"` |
| `shrink-0` | `flexShrink` | `"0"` |
| `basis-0` through `basis-96` | `flexBasis` | spacing scale → px |
| `basis-auto` | `flexBasis` | `"auto"` |
| `basis-full` | `flexBasis` | `"100%"` |

### Flex Alignment

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
| `justify-normal` | `justifyContent` | `"normal"` |
| `justify-stretch` | `justifyContent` | `"stretch"` |

### Self Alignment

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `self-auto` | `alignSelf` | `"auto"` |
| `self-start` | `alignSelf` | `"flex-start"` |
| `self-center` | `alignSelf` | `"center"` |
| `self-end` | `alignSelf` | `"flex-end"` |
| `self-stretch` | `alignSelf` | `"stretch"` |
| `self-baseline` | `alignSelf` | `"baseline"` |

### Gap

**Note:** `gap` shorthand is NOT a valid GB styles key (tested in WordPress editor — does not render). Use `columnGap`/`rowGap` always.

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `gap-0` | `columnGap`, `rowGap` | `"0px"` |
| `gap-px` | `columnGap`, `rowGap` | `"1px"` |
| `gap-1` through `gap-96` | `columnGap`, `rowGap` | spacing scale → px |
| `gap-x-*` | `columnGap` | spacing scale → px |
| `gap-y-*` | `rowGap` | spacing scale → px |

### Grid Template

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `grid-cols-1` through `grid-cols-12` | `gridTemplateColumns` | `"repeat(N, minmax(0, 1fr))"` |
| `grid-cols-none` | `gridTemplateColumns` | `"none"` |
| `grid-rows-1` through `grid-rows-6` | `gridTemplateRows` | `"repeat(N, minmax(0, 1fr))"` |
| `grid-rows-none` | `gridTemplateRows` | `"none"` |

### Grid Span / Placement

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `col-span-1` through `col-span-12` | `gridColumn` | `"span N / span N"` |
| `col-span-full` | `gridColumn` | `"1 / -1"` |
| `col-start-1` through `col-start-13` | `gridColumnStart` | `"N"` |
| `col-start-auto` | `gridColumnStart` | `"auto"` |
| `col-end-1` through `col-end-13` | `gridColumnEnd` | `"N"` |
| `col-end-auto` | `gridColumnEnd` | `"auto"` |
| `row-span-1` through `row-span-6` | `gridRow` | `"span N / span N"` |
| `row-span-full` | `gridRow` | `"1 / -1"` |
| `row-start-1` through `row-start-7` | `gridRowStart` | `"N"` |
| `row-start-auto` | `gridRowStart` | `"auto"` |
| `row-end-1` through `row-end-7` | `gridRowEnd` | `"N"` |
| `row-end-auto` | `gridRowEnd` | `"auto"` |

### Grid Auto Flow

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `grid-flow-row` | `gridAutoFlow` | `"row"` |
| `grid-flow-col` | `gridAutoFlow` | `"column"` |
| `grid-flow-dense` | `gridAutoFlow` | `"dense"` |
| `grid-flow-row-dense` | `gridAutoFlow` | `"row dense"` |
| `grid-flow-col-dense` | `gridAutoFlow` | `"column dense"` |

### Grid Auto Sizing

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `auto-cols-auto` | `gridAutoColumns` | `"auto"` |
| `auto-cols-min` | `gridAutoColumns` | `"min-content"` |
| `auto-cols-max` | `gridAutoColumns` | `"max-content"` |
| `auto-cols-fr` | `gridAutoColumns` | `"minmax(0, 1fr)"` |
| `auto-rows-auto` | `gridAutoRows` | `"auto"` |
| `auto-rows-min` | `gridAutoRows` | `"min-content"` |
| `auto-rows-max` | `gridAutoRows` | `"max-content"` |
| `auto-rows-fr` | `gridAutoRows` | `"minmax(0, 1fr)"` |

### Place Content / Items

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `place-content-center` | `placeContent` | `"center"` |
| `place-content-start` | `placeContent` | `"start"` |
| `place-content-end` | `placeContent` | `"end"` |
| `place-content-between` | `placeContent` | `"space-between"` |
| `place-content-around` | `placeContent` | `"space-around"` |
| `place-content-evenly` | `placeContent` | `"space-evenly"` |
| `place-content-stretch` | `placeContent` | `"stretch"` |
| `place-items-center` | `placeItems` | `"center"` |
| `place-items-start` | `placeItems` | `"start"` |
| `place-items-end` | `placeItems` | `"end"` |
| `place-items-stretch` | `placeItems` | `"stretch"` |
| `place-self-center` | `placeSelf` | `"center"` |
| `place-self-start` | `placeSelf` | `"start"` |
| `place-self-end` | `placeSelf` | `"end"` |
| `place-self-stretch` | `placeSelf` | `"stretch"` |
| `place-self-auto` | `placeSelf` | `"auto"` |

### Order

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `order-1` through `order-12` | `order` | `"N"` |
| `order-first` | `order` | `"-9999"` |
| `order-last` | `order` | `"9999"` |
| `order-none` | `order` | `"0"` |

### Overflow

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `overflow-auto` | `overflow` | `"auto"` |
| `overflow-hidden` | `overflow` | `"hidden"` |
| `overflow-visible` | `overflow` | `"visible"` |
| `overflow-scroll` | `overflow` | `"scroll"` |

### Align Content (multi-line flex/grid)

| Tailwind class | GB styles key | GB styles value |
|---|---|---|
| `content-normal` | `alignContent` | `"normal"` |
| `content-center` | `alignContent` | `"center"` |
| `content-start` | `alignContent` | `"flex-start"` |
| `content-end` | `alignContent` | `"flex-end"` |
| `content-between` | `alignContent` | `"space-between"` |
| `content-around` | `alignContent` | `"space-around"` |
| `content-evenly` | `alignContent` | `"space-evenly"` |
| `content-stretch` | `alignContent` | `"stretch"` |
| `content-baseline` | `alignContent` | `"baseline"` |

## Tailwind Spacing Scale (px values)

Used for gap, flex-basis. Each Tailwind spacing unit converted to px at default 16px root font size:

```
0→0px, px→1px, 0.5→2px, 1→4px, 1.5→6px, 2→8px, 2.5→10px,
3→12px, 3.5→14px, 4→16px, 5→20px, 6→24px, 7→28px, 8→32px,
9→36px, 10→40px, 11→44px, 12→48px, 14→56px, 16→64px,
20→80px, 24→96px, 28→112px, 32→128px, 36→144px, 40→160px,
44→176px, 48→192px, 52→208px, 56→224px, 60→240px, 64→256px,
72→288px, 80→320px, 96→384px
```

**Unit note:** px is the correct unit for GB styles. GB accepts px, em, rem, %, vw, vh, ch (all confirmed). The converter already uses px for margin/padding/width/height values in GB JSON. Tailwind's `gap-4` = `1rem` = `16px` at the default 16px root font size. If the source page uses a different root font size, the px values may differ. V1 assumes 16px root (the Tailwind default).

## Handling Known Edge Cases

1. **Partial conversion:** `"flex gap-4 shadow-lg"` → `flex` and `gap-4` become styles, `shadow-lg` stays as leftover class. Normal operation.

2. **Duplicate classes:** `"flex flex"` → deduplicated to `"flex"` (first occurrence kept). Single mapping.

3. **Duplicate mappings with different keys:** `"gap-4 gap-x-8"` → `gap: "16px"` set first, then `columnGap: "32px"` overrides column axis. Both keys in final styles.

4. **Mapping overlap with existing converter styles:** If the block already has `marginTop` from inline style parsing, and the mapper produces `display: "flex"`, both coexist (shallow merge, no conflict — different keys).

5. **Conflicting keys:** If the mapper and inline extraction both produce the same key, mapper wins (mapper runs second). This is correct — layout attributes from class names are more intentional than generic inline styles.

6. **Removing classes changes specificity:** When `flex` is removed from the class string but `flex-wrap` stays, the element loses `display: flex` from CSS. But the GB `styles` attribute sets `display: flex` via inline CSS, which beats class-based CSS. Visual result is identical.

7. **Responsive variants** (`sm:flex`, `md:grid-cols-3`): NOT mapped in V1. Survive as classes in `leftoverClasses`. The css fallback handles them. Future V2 could use GB's native `@media` structure.

8. **Arbitrary values:** `gap-[13px]` matches the gap pattern but 13 isn't in the spacing lookup → passes through to leftoverClasses, preserved in css.

9. **Empty/whitespace-only class strings:** Return `{ styles: {}, leftoverClasses: "" }`. No error.

10. **gb-element hash stability:** The `gb-element-{hash}` class is generated by the existing converter and is never touched by the mapper. No risk of collision or identity drift.

11. **Object key ordering:** In V1, the output order of `styles` object keys is not significant (GB parses keys by name, not by position). If later versions need deterministic key order, a `Map` should be used instead of a plain object.

## What's NOT in V1

- Responsive variants (`sm:`, `md:`, `lg:`, etc.) — future V2 with GB's `@media` structure
- Margin/padding — already handled by existing converter's inline style extraction
- Width/height — edge cases with `full`, `screen`, `min`, `max`, `fit`, arbitrary values
- Position/inset — needs parent context
- Typography (font-size, font-weight, text-align, etc.) — cosmetic, not editor-critical
- Colors (bg-*, text-*, border-*) — cosmetic, not editor-critical
- Borders (border, border-radius) — cosmetic, not editor-critical
- Effects (shadow, opacity, filter, backdrop) — can't map to GB attributes
- Transforms (scale, rotate, translate) — can't map to GB attributes
- Transitions/animations — can't map to GB attributes
- Z-index — not editor-critical
- Cursor/select/scroll — not editor-critical

All unmapped classes remain as CSS classes on the element and are preserved in the `css` field.

## Testing Strategy

1. **Unit tests for `tailwindLayoutToGbAttributes()`:** Pure function, test a matrix of class combinations against expected outputs. Must cover: basic mappings, multi-class combinations, duplicates, gap interactions, arbitrary-value pass-through, empty strings, only-unmapped, and every single mapping entry.

2. **Integration test:** Full conversion on mino, verify block JSON contains layout attributes, old classes stripped, leftover classes preserved, existing converter attributes untouched.

3. **Edge case tests:** Pattern priority (flex-row before flex), conflicting keys (mapper wins), whitespace normalization, deduplication.

## Implementation Notes

- New file: `src/core/tailwind-layout-mapper.ts`
- Modify: existing HTML→GB block converter to call mapper during element→block conversion
- Uses the same deterministic pattern as `isTailwindUtility()`: explicit regex enumeration, ordered testing
- Reuses `style-parser.ts` CSS_PROPERTIES and STYLES_PROPERTIES for key validation
- Mapping table: ordered array of `{ pattern: RegExp, extract: (match: RegExpMatchArray) => Record<string, string> }` objects
- Function signature: `tailwindLayoutToGbAttributes(classString: string, config?: { spacingScale?: Record<string, string> }) → { styles: Record<string, string>, leftoverClasses: string }`
- Default spacing scale is the standard Tailwind v3 4px-step scale at 16px root
