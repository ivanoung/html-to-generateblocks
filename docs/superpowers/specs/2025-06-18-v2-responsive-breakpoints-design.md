# Design: V2 — Responsive Tailwind → GB Breakpoint Mapping

**Date:** 2025-06-18
**Status:** Design approved, pending implementation
**Scope:** Map Tailwind responsive layout classes (`sm:flex`, `md:grid-cols-2`, `lg:gap-8`) to GenerateBlocks' native `@media` structure in block JSON styles, so responsive layouts render in the WordPress block editor.

## Problem

V1 converts only unprefixed classes (`flex`, `grid-cols-3`, `gap-4`). Responsive variants (`sm:flex`, `md:grid-cols-2`, `lg:grid-cols-4`) pass through as CSS classes in `globalClasses`. They render on the frontend (via `tailwind-utilities.css`) but NOT in the block editor — the editor shows only the desktop layout. Resizing the editor viewport has no effect.

## Solution

Extend `tailwindLayoutToGbAttributes()` to return responsive-aware styles with nested `@media` keys matching GenerateBlocks' native responsive system.

### Before (V1)

```json
{
  "styles": { "gridTemplateColumns": "repeat(1, minmax(0, 1fr))" },
  "globalClasses": ["md:grid-cols-2", "lg:grid-cols-4"]
}
```

### After (V2)

```json
{
  "styles": {
    "gridTemplateColumns": "repeat(4, minmax(0, 1fr))",
    "@media (max-width: 1024px) and (min-width: 768px)": {
      "gridTemplateColumns": "repeat(2, minmax(0, 1fr))"
    },
    "@media (max-width: 767px)": {
      "gridTemplateColumns": "repeat(1, minmax(0, 1fr))"
    }
  },
  "globalClasses": []
}
```

## GB Responsive System (confirmed via live WordPress blocks)

GenerateBlocks uses a desktop-first responsive model with 3 tiers:

| GB Tier | Media Query | CSS behavior |
|---|---|---|
| **All Screens** | `default` (no @media) | Applies everywhere, cascade root |
| **Tablet** | `@media (max-width: 1024px) and (min-width: 768px)` | Overrides All Screens in tablet range |
| **Mobile** | `@media (max-width: 767px)` | Overrides All Screens + Tablet in mobile range |

Verified: `default` and `@media (min-width: 1025px)` produce identical visual results when values match. The 3-tier system covers all practical GB responsive use cases.

## Tailwind Breakpoints (reference)

| Prefix | Min-width | GB Equivalent |
|---|---|---|
| `default` (no prefix) | 0px | Mobile (0–767px) |
| `sm:` | 640px | Cascades to Tablet/Desktop (768px+) |
| `md:` | 768px | Tablet (768–1024) |
| `lg:` | 1024px | All Screens / Desktop (≥1025) |
| `xl:` | 1280px | All Screens / Desktop (≥1280) |
| `2xl:` | 1536px | All Screens / Desktop (≥1536) |

**Important: sm: placement.** `sm:640px` falls inside GB's Mobile range (≤767px) BUT its cascade position is ABOVE default. Mobile tier always picks the default (0px) value — small-screen breakpoint. sm's value cascades forward into Tablet and Desktop. This avoids ambiguity about which value wins in the 640–767px overlap.

**1px boundary:** TW `lg:1024` vs GB `Desktop≥1025` is inherent to mixing frameworks. At exactly 1024px, TW's `lg:` has just fired but GB shows Tablet. Documented — not worth engineering around.

## Algorithm: Breakpoint Cascade with Tier Collapse

### Step 1: Group classes by breakpoint prefix

Parse the class string, extracting the breakpoint prefix (if any). For each CSS property, build a per-breakpoint value map:

```
Input: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"

gridTemplateColumns:
  default:  "repeat(1, minmax(0, 1fr))"
  md:       "repeat(2, minmax(0, 1fr))"
  lg:       "repeat(4, minmax(0, 1fr))"
```

### Step 2: Cascade resolution

Working from smallest to largest breakpoint, inherit values not explicitly set:

```
default (0px):   "repeat(1, minmax(0, 1fr))"  ← explicit
sm     (640px):  "repeat(1, minmax(0, 1fr))"  ← inherited from default
md     (768px):  "repeat(2, minmax(0, 1fr))"  ← explicit
lg     (1024px): "repeat(4, minmax(0, 1fr))"  ← explicit
xl     (1280px): "repeat(4, minmax(0, 1fr))"  ← inherited from lg
2xl    (1536px): "repeat(4, minmax(0, 1fr))"  ← inherited from lg
```

### Step 3: Map to GB tiers

| GB Tier | Picks value from |
|---|---|
| **Desktop** (All Screens) | Largest breakpoint with an explicit value. Walk 2xl→xl→lg→md→default, first match wins. |
| **Tablet** (768–1024) | md value (after cascade). Falls back to cascade-inherited if md not set. |
| **Mobile** (≤767) | default (0px) value. sm: cascades forward, does NOT change Mobile. |

**Desktop rule reasoning:** If a page has `xl:grid-cols-5` but no `2xl:grid-cols-*`, the Desktop value is `xl`. If only `lg:grid-cols-4` is set, Desktop uses `lg`. If neither is set, it walks down until it finds a value. This ensures xl/2xl variants are never silently dropped.

**sm: rule reasoning:** `sm:flex-row` means "flex-row at 640px and up." In GB, Mobile tier shows the default (0px) value. sm cascades into Tablet and Desktop. Example: `flex-col sm:flex-row` → Mobile = column, Tablet/Desktop = row.

```
default (0px):   "repeat(1, minmax(0, 1fr))"
sm     (640px):  "repeat(1, minmax(0, 1fr))"  ← inherited from default
md     (768px):  "repeat(2, minmax(0, 1fr))"  ← explicit
lg     (1024px): "repeat(4, minmax(0, 1fr))"  ← explicit
xl     (1280px): "repeat(4, minmax(0, 1fr))"  ← inherited from lg
2xl    (1536px): "repeat(4, minmax(0, 1fr))"  ← inherited from lg

Desktop (All Screens):  lg → "repeat(4, minmax(0, 1fr))"     ← highest breakpoint with explicit value
Tablet (768–1024):      md → "repeat(2, minmax(0, 1fr))"
Mobile (≤767):          default → "repeat(1, minmax(0, 1fr))" ← sm value cascades forward, not used here
```

### Step 4: Emit only diffs

Only emit `@media` when the tier's value differs from the tier above. **Flat keys (desktop defaults) are always emitted first, then @media blocks.** CSS output order is deterministic — defaults before overrides ensures correct cascade within GB's renderer.

```
All Screens:  "repeat(4, minmax(0, 1fr))"           ← always emitted
Tablet:       "repeat(2, minmax(0, 1fr))"           ← differs from All Screens → emit
Mobile:       "repeat(1, minmax(0, 1fr))"           ← differs from Tablet → emit
```

Result:
```json
{
  "gridTemplateColumns": "repeat(4, minmax(0, 1fr))",
  "@media (max-width: 1024px) and (min-width: 768px)": {
    "gridTemplateColumns": "repeat(2, minmax(0, 1fr))"
  },
  "@media (max-width: 767px)": {
    "gridTemplateColumns": "repeat(1, minmax(0, 1fr))"
  }
}
```

## Multi-property Example

```
Input: "flex flex-col md:flex-row md:gap-4 lg:gap-8 lg:items-start"

Step 1: Group by breakpoint + property

  display →    default: "flex" (from flex),   md: — (no md:display),   lg: — (no lg:display)
  flexDirection → default: "column" (from flex-col), md: "row" (from md:flex-row), lg: — (inherited)
  columnGap/rowGap → default: — (no gap),     md: "16px" (from md:gap-4),  lg: "32px" (from lg:gap-8)
  alignItems →  default: — (no items),         md: —,                     lg: "flex-start" (from lg:items-start)

Step 2: Cascade each property

  display →       d:"flex"  sm:"flex"  md:"flex"  lg:"flex"  xl:"flex"  2xl:"flex"
  flexDirection → d:"col"   sm:"col"   md:"row"   lg:"row"   xl:"row"   2xl:"row"
  gap →           d:—       sm:—       md:"16px"  lg:"32px" xl:"32px"  2xl:"32px"
  alignItems →    d:—       sm:—       md:—       lg:"flex-start" xl:"flex-start" 2xl:"flex-start"

Step 3-4: Map to GB tiers + emit diffs

  All Screens:  { display: "flex", flexDirection: "row", columnGap: "32px", rowGap: "32px", alignItems: "flex-start" }
  Tablet:       { columnGap: "16px", rowGap: "16px" }                   ← gap differs, flex already row
  Mobile:       { flexDirection: "column" }                              ← direction differs, no gap set
```

Result:
```json
{
  "display": "flex",
  "flexDirection": "row",
  "columnGap": "32px",
  "rowGap": "32px",
  "alignItems": "flex-start",
  "@media (max-width: 1024px) and (min-width: 768px)": {
    "columnGap": "16px",
    "rowGap": "16px"
  },
  "@media (max-width: 767px)": {
    "flexDirection": "column"
  }
}
```

## Edge Cases

### 1. Desktop picks highest breakpoint with explicit value

Walk 2xl→xl→lg→md→default. First breakpoint that has an explicit value (not inherited) wins.

```
Input: "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"

Desktop = xl → "repeat(3, minmax(0, 1fr))"  ← NOT lg
Tablet  = — (md not set, cascade inherits from default) → "repeat(1, ...)"
Mobile  = default → "repeat(1, minmax(0, 1fr))"

Result: only emit Desktop default + Mobile @media (Tablet = Mobile = same value → skip)
{
  "gridTemplateColumns": "repeat(3, minmax(0, 1fr))",
  "@media (max-width: 767px)": {
    "gridTemplateColumns": "repeat(1, minmax(0, 1fr))"
  }
}
```

### 1b. sm: cascades forward, doesn't change Mobile

sm: (640px) sits inside GB's Mobile range (≤767px) but its cascade position is ABOVE default. Mobile always uses the default (0px) value. sm: value cascades into Tablet and Desktop.

```
Input: "flex-col sm:flex-row"

default: flexDirection = "column"   → Mobile (≤767):  "column"
sm:      flexDirection = "row"      → cascades to md/lg → Tablet: "row", Desktop: "row"

Result: Mobile = column, Tablet/Desktop = row. Tablet = Desktop → no Tablet @media.
{
  "flexDirection": "row",
  "@media (max-width: 767px)": {
    "flexDirection": "column"
  }
}
```

### 2. Value resets are intentional overrides

```
Input: "grid-cols-4 md:grid-cols-2 lg:grid-cols-none"

default: "repeat(4, ...)"   → Mobile: 4 columns
md:      "repeat(2, ...)"   → Tablet: 2 columns
lg:      "none"             → Desktop: none (intentional reset, not cascade)
```

`grid-cols-none` is an explicit reset — the cascade must NOT inherit "repeat(4, ...)" through it.

### 3. Same value across breakpoints — no redundant @media

```
Input: "grid-cols-2 md:grid-cols-2 lg:grid-cols-4"

default: "repeat(2, ...)"
md:      "repeat(2, ...)"   ← SAME as default
lg:      "repeat(4, ...)"

Mobile = default = "repeat(2, ...)"
Tablet = md      = "repeat(2, ...)"  ← SAME as Mobile → skip @media
Desktop = lg     = "repeat(4, ...)"  ← DIFFERS from Tablet → emit

Result:
{
  "gridTemplateColumns": "repeat(4, minmax(0, 1fr))",
  "@media (max-width: 767px)": {
    "gridTemplateColumns": "repeat(2, minmax(0, 1fr))"
  }
}
```

Mobile and Tablet share the same value (2 cols), so only one @media is emitted (at Mobile level), saving a redundant Tablet @media block.

### 4. Properties with no responsive variants — V1 behavior

```
Input: "flex shadow-lg"

No breakpoint prefix on any layout class → V1 flat output.
{
  "styles": { "display": "flex" },
  "globalClasses": ["shadow-lg"]
}
```

### 5. Only responsive variants, no default

```
Input: "md:flex md:gap-4 lg:flex lg:gap-8"

default: — (no value → desktop inherits nothing for these properties)
md:      display: flex, gap: 16px
lg:      display: flex, gap: 32px

Mobile = no value   → no @media for these properties
Tablet = md         → emit Tablet @media
Desktop = lg        → All Screens default
```

### 6. xl/2xl — same rule as edge case 1 (no separate mapping)

Edge case 1 already covers this. Since Desktop = largest breakpoint with an explicit value, the Desktop default automatically picks xl or 2xl if either is set. No additional logic needed.

```
Input: "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"

Desktop = xl → "repeat(4, minmax(0, 1fr))"  ← xl picked over lg/md (not set)
Tablet  = md → "repeat(2, minmax(0, 1fr))"
Mobile  = default → "repeat(1, minmax(0, 1fr))"
```

### 7. 2xl (1536px) has no dedicated GB tier

```json
Input: "w-full 2xl:w-1/2"

Desktop picks 2xl value. No upper sub-tier in GB exists for 2xl-only changes.
Documented limitation — 2xl behaves identically to xl from GB's perspective.
```

### 8. Unsupported values at any breakpoint → pass through

```
Input: "flex md:gap-[13px]"

default: display: flex  → mapped
md: gap → null (13 not in spacing scale) → class passes through as CSS class

Result:
{
  "styles": { "display": "flex" },
  "globalClasses": ["md:gap-[13px]"]
}
```

### 9. Stacked prefixes — breakpoint + state (md:hover:flex)

Tailwind supports stacking breakpoint prefixes with state prefixes. The breakpoint parser extracts ONLY the recognized breakpoint (sm/md/lg/xl/2xl) and the `rest` is processed through MAPPING_TABLE:

```
Input: "md:hover:flex"

Parser: bp="md", rest="hover:flex"
Mapper: "hover:flex" doesn't match any MAPPING_TABLE entry → leftover

Result: class survives as "md:hover:flex" in globalClasses.
The responsive prefix was consumed (bp="md") but the state prefix
prevents mapper matching — safe passthrough.

Intentionally NOT stripped in V2. The full class "md:hover:flex"
preserves both the breakpoint and state semantics in the CSS fallback.
```

## What's NOT in V2

V2 only converts breakpoint-prefixed classes that match entries in the existing `MAPPING_TABLE` (the same table used by V1). The MAPPING_TABLE IS the layout vs cosmetic boundary:
- **Layout** (converted): Any breakpoint-prefixed class matching a MAPPING_TABLE entry → becomes a nested @media style
- **Cosmetic** (pass through): Any breakpoint-prefixed class NOT matching a MAPPING_TABLE entry → stays as a CSS class in globalClasses

Specifically excluded from responsive conversion:
- Typography (`sm:text-lg`, `md:font-bold`) — cosmetic, not editor-critical
- Colors (`md:bg-blue-500`, `lg:text-white`) — cosmetic
- Borders/radius (`sm:rounded-lg`, `md:border-2`) — cosmetic
- Shadows/opacity/filters/transforms/transitions — cosmetic
- Arbitrary responsive values (`md:[&>*]:flex`) — pass through
- Container queries, print, dark mode, reduced-motion, RTL variants — pass through

## Implementation Notes

- Function: `tailwindLayoutToGbAttributesV2(classString) → { styles: GbStyles, leftoverClasses: string }`
- `GbStyles` type: `Record<string, string | GbStyles>` (supports nested `@media` keys)
- Reuses existing `MAPPING_TABLE` and spacing scale from V1
- New helper: `groupClassesByBreakpoint(classString) → Map<BreakpointKey, string>`
- New helper: `resolveCascade(breakpointMap) → ResolvedValues`
- New helper: `collapseToGbTiers(resolved, propKey) → GbStyles`
- V2 function replaces V1 → single entry point, backward compatible (classes without breakpoints produce same output)
- Integration point unchanged: called from `dom-walker.ts` block creation sites

## Testing Strategy

1. **Unit tests**: Cascade resolution, tier collapse, diff detection for 20+ class combinations
2. **Edge case tests**: Value resets, same-value skip, xl/2xl, only-responsive-no-default, unsupported values at specific breakpoints
3. **Integration test**: Full conversion on mino, verify block JSON contains `@media` keys, responsive classes removed from globalClasses
4. **Manual test**: Copy-paste mino index into WordPress, resize editor, verify 4→2→1 column grids, flex→block switches

## Verified GB Media Queries

From live WordPress blocks:
```
All Screens:    default (no @media)
Tablet:         @media (max-width: 1024px) and (min-width: 768px)
Mobile:         @media (max-width: 767px)
```
