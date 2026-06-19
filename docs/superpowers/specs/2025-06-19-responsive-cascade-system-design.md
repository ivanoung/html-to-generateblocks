# Tailwind → GB Responsive Cascade: Complete No-Gap System

**Status:** Draft
**Date:** 2025-06-19
**Goal:** 100% coverage — every Tailwind responsive pattern maps losslessly to GenerateBlocks output.

---

## 1. The Two Cascades

### Tailwind (mobile-first, min-width)

```
0px (default) → 640px (sm) → 768px (md) → 1024px (lg) → 1280px (xl) → 1536px (2xl)
```

Values cascade **upward**: at each breakpoint, override all values from smaller breakpoints.

### GB (desktop-first, max-width)

```
All Screens (default, applies everywhere)
  ↳ Tablet & Mobile (max-width: 1024px, overrides AS at ≤1024px)
    ↳ Mobile (max-width: 767px, overrides T&M at ≤767px)
```

Values cascade **downward**. Priority: Mobile > T&M > All Screens.

### Core mechanic

**Mobile (≤767px) acts as a seal.** When Mobile has a value, it blocks T&M from applying at 0-767. Without Mobile, T&M (≤1024) also applies at 0-767. This seal is the ONLY mechanism that pins T&M to only the 768-1023 range.

### Critical constraint

**T&M's max-width is 1024px.** This means md's range must end at 1024 — i.e. lg must exist. If md's range extends beyond 1024 (because lg is absent or because xl exists without lg covering 1024-1279), T&M cannot cover it correctly.

---

## 2. Path A: GB Native Tiers

Three sub-paths using GB's built-in breakpoint structure.

### Path A1: Single Value (trivial)

**When:** default only, no responsive breakpoints.
**Output:** `styles` + `css` in All Screens. No @media blocks.

### Path A2: Two-Tier (default + lg/xl/2xl only)

**When:** default exists, lg|xl|2xl exists, NO md, NO sm (or sm = default).

**Why it works:** The default value applies at 0-1023. T&M (≤1024) perfectly covers this range. AS covers 1024+.

| TW | GB output | At 0-1023 | At 1024+ |
|---|---|---|---|
| `p-4 lg:p-12` | AS:48, T&M:16 | T&M=16 ✓ | AS=48 ✓ |
| `p-4 2xl:p-16` | AS:64, T&M:16 | T&M=16 ✓ | AS=64 ✓ |

**Algorithm:**
```
AS = value at largest breakpoint (lg|xl|2xl)
T&M = value at default (0px)
No Mobile (inherits from T&M)
```

### Path A3: Three-Tier Golden Case (default + md + lg)

**When:** default exists, md exists, lg exists, AND:
- sm does NOT exist OR sm = default (otherwise splits Mobile)
- xl/2xl do NOT exist OR xl = lg and 2xl = lg (otherwise splits desktop)

**Why it works:** All 3 GB tiers align exactly with Tailwind's 3 value boundaries.

| TW | GB output | At 0-767 | At 768-1023 | At 1024+ |
|---|---|---|---|---|
| `p-4 md:p-8 lg:p-12` | AS:48, T&M:32, M:16 | M=16 ✓ | T&M=32 ✓ | AS=48 ✓ |

**Algorithm:**
```
AS = value at largest breakpoint (lg|xl|2xl), all must equal each other if multiple set
T&M = value at md (768px)
M = value at default (0px)
```

**Golden case output format:**
```json
{
  "styles": { "paddingTop": "48px" },
  "css": "padding-top: 48px;",
  "@media (max-width: 1024px)": {
    "styles": { "paddingTop": "32px" },
    "css": "padding-top: 32px;"
  },
  "@media (max-width: 767px)": {
    "styles": { "paddingTop": "16px" },
    "css": "padding-top: 16px;"
  }
}
```

---

## 3. Path B: Custom @media(min-width)

**When:** Everything not covered by Path A1/A2/A3.

**Breakpoint values (exact Tailwind px):**
- sm: 640px
- md: 768px
- lg: 1024px
- xl: 1280px
- 2xl: 1536px

**Algorithm:**
1. Resolve Tailwind cascade at all breakpoints
2. Find the base value at 0px (default if set, sm if set and default not, otherwise no base)
3. If base exists: emit `styles` = base (All Screens)
4. Walk breakpoints smallest→largest
5. At each breakpoint where value DIFFERS from the previous breakpoint's value, emit `@media (min-width: Npx)` with the new value
6. If no base exists: skip All Screens, start emitting at the first breakpoint with a value

**Output examples:**

```
// Case: md:col-span-7 (md-only, no default)
{
  "@media (min-width: 768px)": {
    "styles": { "gridColumn": "span 7" },
    "css": "grid-column: span 7;"
  }
}
// Nothing at 0-767px → browser default
```

```
// Case: p-4 md:p-8 (default + md, no lg)
{
  "styles": { "paddingTop": "16px" },
  "css": "padding-top: 16px;",
  "@media (min-width: 768px)": {
    "styles": { "paddingTop": "32px" },
    "css": "padding-top: 32px;"
  }
}
```

```
// Case: p-4 sm:p-6 md:p-8 lg:p-12 (all bp diff)
{
  "styles": { "paddingTop": "16px" },
  "css": "padding-top: 16px;",
  "@media (min-width: 640px)": {
    "styles": { "paddingTop": "24px" },
    "css": "padding-top: 24px;"
  },
  "@media (min-width: 768px)": {
    "styles": { "paddingTop": "32px" },
    "css": "padding-top: 32px;"
  },
  "@media (min-width: 1024px)": {
    "styles": { "paddingTop": "48px" },
    "css": "padding-top: 48px;"
  }
}
```

```
// Case: flex-col md:flex-row (qualitative toggle)
{
  "styles": { "display": "flex", "flexDirection": "column" },
  "css": "display: flex; flex-direction: column;",
  "@media (min-width: 768px)": {
    "styles": { "flexDirection": "row" },
    "css": "flex-direction: row;"
  }
}
```

---

## 4. Full Coverage Matrix

See `responsive-cascade-analysis.md` for all 20 combinations. Summary:

| Path | Count | When |
|---|---|---|
| A1 (single) | 1 | default only |
| A2 (2-tier) | 2 | default + lg/xl/2xl (no md, no sm) |
| A3 (3-tier) | 3 | default + md + lg (sm=none/default, xl/2xl=lg or absent) |
| B (custom) | 14 | everything else |
| **Total** | **20** | **100% coverage, zero leakage** |

---

## 5. Key Constraints

### 5.1 xl/2xl merging in Path A3

xl and 2xl can participate in Path A3 ONLY when they equal lg. If they differ, Path B for full precision.

Example: `p-4 md:p-8 lg:p-12 xl:p-16` — lg ≠ xl → Path B.
Example: `p-4 md:p-8 lg:p-12 xl:p-12` — lg = xl → Path A3.

### 5.2 sm in Path A

sm can participate in Path A2/A3 ONLY when it equals default. Otherwise it splits the Mobile (≤767) tier at 640px — Path B needed.

### 5.3 Change detection

Only emit a breakpoint when the value at that breakpoint DIFFERS from the previous breakpoint's value. Redundant blocks are never emitted.

### 5.4 No "reset value" table needed

Path B uses exact @media queries, so there's no T&M leak to worry about. No property-specific reset values needed. The approach is property-agnostic.

---

## 6. Multi-Property Handling

Each CSS property from class names is resolved independently through the cascade. A single block may produce:
- Property A → Path A3 (GB tiers)
- Property B → Path B (custom @media)

They coexist in the same block output. @media blocks of different formats (`max-width` for Path A, `min-width` for Path B) never collide.

**Example:** `p-4 md:p-8 lg:p-12 flex-col md:flex-row`

```json
{
  "styles": {
    "paddingTop": "48px",
    "display": "flex",
    "flexDirection": "column"
  },
  "css": "display: flex; flex-direction: column; padding-top: 48px;",
  "@media (max-width: 1024px)": {
    "styles": { "paddingTop": "32px" },
    "css": "padding-top: 32px;"
  },
  "@media (max-width: 767px)": {
    "styles": { "paddingTop": "16px" },
    "css": "padding-top: 16px;"
  },
  "@media (min-width: 768px)": {
    "styles": { "flexDirection": "row" },
    "css": "flex-direction: row;"
  }
}
```

---

## 7. Implementation Notes

### 7.1 Flow

```
Class string → TW resolver (computed property values)
→ Per-property loop:
    1. Resolve values at all 6 breakpoints
    2. Classify: A1/A2/A3/B
    3. Write GB-tier JSON (A) or custom @media JSON (B)
→ Merge into block JSON
```

### 7.2 GB @media format

- `max-width` queries use GB's exact format: `"@media (max-width: 1024px)"`
- CSS properties sorted alphabetically
- No space after commas: `repeat(3,1fr)` not `repeat(3, 1fr)`
- `min-width` queries use exact Tailwind px values for Path B

### 7.3 Verification

For each pattern in the coverage matrix:
- Input TW class → output GB JSON
- Verify computed value at screen widths 0, 640, 768, 1024, 1280, 1536 matches TW expected value

---

## 8. Why Not 100% GB Tiers?

GB's 3-tier max-width cascade can only represent 3 value groups where boundaries align at 767 and 1024. Tailwind has 6 min-width breakpoints. The impedance mismatch means only a narrow set of Tailwind patterns (default + lg, default + md + lg) map cleanly. Everything else requires custom @media.

This is not a deficiency — it's the correct design given the directional mismatch between the two cascade systems. Custom @media queries are fully supported by GB's block JSON and the WordPress block editor.
