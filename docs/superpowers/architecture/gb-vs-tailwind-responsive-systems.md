# Architecture: GenerateBlocks vs Tailwind CSS — Responsive Systems Comparison

**Date:** 2025-06-18
**Status:** Core reference document
**Purpose:** Architecturally authoritative comparison of two inverted responsive systems. Used as the foundation for all responsive-mapping decisions in the gb-converter.

---

## 1. Fundamental Architecture Inversion

| Property | GenerateBlocks | Tailwind CSS |
|---|---|---|
| **Direction** | Desktop-first | Mobile-first |
| **Default applies to** | All screen sizes (desktop) | All screen sizes (mobile) |
| **Overrides cascade** | DOWNWARD (Mobile > Tablet > All Screens) | UPWARD (2xl > xl > lg > md > sm > default) |
| **Mental model** | Start rich, strip down for smaller screens | Start minimal, add for larger screens |
| **Tiers** | 3 fixed (All Screens, Tablet, Mobile) | 5+ configurable (default, sm, md, lg, xl, 2xl) |

**Converting between them is not breakpoint relabeling — it requires value-flow analysis: "at which screen ranges should this property hold what value?"**

## 2. Tier Mapping

| Screen Range | GB Tier | TW Breakpoint |
|---|---|---|
| ≥ 1025px | All Screens (default) | lg (≥1024px), xl (≥1280px), 2xl (≥1536px) |
| 768–1024px | Tablet (`max-width: 1024px`) | md (≥768px) |
| ≤ 767px | Mobile (`max-width: 767px`) | default (0px+), sm (≥640px) |

### 2.1 The 1px Boundary Gap

TW's `lg:` fires at ≥1024px. GB's Desktop (All Screens) has no explicit min-width but is effectively ≥1025px via Tablet's `max-width: 1024px`. At exactly 1024px, TW shows the `lg:` value while GB shows the Tablet value. This is a documented trade-off — not a bug worth engineering around.

### 2.2 Tier Reduction (5 → 3)

| TW Breakpoint | GB Mapping | Rationale |
|---|---|---|
| default (0px) | Mobile (`max-width: 767px`) | Small-screen baseline |
| sm (640px) | Cascades forward to Tablet/Desktop | 640–767px sits inside Mobile range; sm: value continues upward |
| md (768px) | Tablet (`max-width: 1024px`) | 768–1024px range |
| lg (1024px) | Desktop default | ≥1024px desktop screens |
| xl (1280px) | Desktop default | ≥1280px — same GB tier as lg |
| 2xl (1536px) | Desktop default | ≥1536px — same GB tier, documented limitation |

## 3. Media Query Polarity

| System | Query type | Example |
|---|---|---|
| GenerateBlocks | `max-width` (occasional ranges) | `@media (max-width: 1024px)` |
| Tailwind | `min-width` exclusively | `@media (min-width: 768px)` |
| GB also observed | `min-width` (treated as default equivalent) | `@media (min-width: 1025px)` — used for desktop-only properties |
| GB also observed | Range queries | `@media (max-width: 1024px) and (min-width: 768px)` |

**Converter rule:** Use `max-width: 1024px` for Tablet (simple, GB-native). Use `min-width: 1025px` ONLY for properties with no default value (desktop-only). Use `max-width: 767px` for Mobile. Avoid range queries unless they prevent leakage.

## 4. Storage Format

| System | How responsive styles are stored |
|---|---|
| GenerateBlocks | Nested `@media` keys inside block JSON `styles`: `{"display": "flex", "@media (max-width: 767px)": {"display": "block"}}` |
| Tailwind | Flat prefixed utility classes in `class` attribute: `class="flex md:block lg:grid"` |

GB also mirrors `styles` into a `css` field with CSS syntax: `.gb-element-{id}{display:flex}@media(max-width:767px){.gb-element-{id}{display:block}}`

## 5. CSS Shorthand Support

| Shorthand | Tailwind | GenerateBlocks |
|---|---|---|
| `gap` | ✅ `gap-4` | ❌ Must use `columnGap` + `rowGap` |
| `overflow` | ✅ `overflow-hidden` | ❌ Must use `overflowX` + `overflowY` |
| `margin` | ✅ `m-4` | ✅ `marginTop/Right/Bottom/Left` (longhands) |
| `padding` | ✅ `p-4` | ✅ `paddingTop/Right/Bottom/Left` (longhands) |
| `border` | ✅ `border` | ✅ `borderWidth/Style/Color` (longhands) |
| `flex` | ✅ `flex-1` | ✅ `flex` (shorthand value like `"1 1 0%"`) |

**Rule:** Expand Tailwind shorthands to GB longhands before responsive tier mapping.

## 6. The Cascade Inversion Problem (and Our Bug)

### How TW works (mobile-first, cascade UP):
```
Value: "flex-col" (default, 0px+)
       "flex-row" (lg:, ≥1024px)

Screen 0-767px:    flex-col (default applies)
Screen 768-1024px:  flex-col (default still applies, no md override)
Screen ≥1024px:     flex-row (lg overrides)
```

### How GB works (desktop-first, cascade DOWN):
```
All Screens:   flex-row (desktop default)
Tablet:        flex-col (overrides desktop at 768-1024px)
Mobile:        flex-col (overrides at ≤767px — same as tablet → skip redundant @media)

Output:
{ "flexDirection": "row", "@media (max-width: 1024px)": { "flexDirection": "column" } }
```

### The downward-leak bug (FIXED):
```
TW: lg:col-span-7 (only at ≥1024px, no default)

ORIGINAL (buggy): 
  Desktop → All Screens: gridColumn: "span 7"
  Mobile has no override → inherits "span 7" from desktop → THIN STRIP

FIXED:
  Desktop → @media (min-width: 1025px): gridColumn: "span 7"
  Mobile has no gridColumn → browser default auto → full width
```

**Invariant:** A TW value set only at a larger breakpoint (with no default) must NOT cascade downward in GB. Use `@media (min-width: 1025px)` to scope it to desktop-only.

## 7. Design Principles

### 7.1 Model the Cascade, Not Just the Breakpoints
Don't map breakpoint names. Map "what value applies at each screen range." This means resolving the Tailwind cascade first, then projecting into GB's inverted cascade.

### 7.2 Explicit Tier Population Over Fallback Reliance
Prefer setting values explicitly at each GB tier rather than relying on GB's cascade inheritance. GB and TW have opposite inheritance semantics — relying on implicit fallback invites bugs.

### 7.3 Internal Neutral Representation
Model responsiveness internally as discrete screen ranges → values, then project into GB or TW syntax as the final step. This abstracts cascade direction from storage format.

```typescript
// Internal representation (direction-agnostic):
type ScreenRange = { min: number; max: number };
type PropertyValues = Map<ScreenRange, string>;

// Then project to GB or TW:
function rangeToGb(ranges: PropertyValues, propKey: string): GbStyles;
function rangeToTw(ranges: PropertyValues): string;
```

### 7.4 Prefer GB Max-Width Queries
Use simple `max-width` for Tablet and Mobile (GB-native). Use `min-width` only for desktop-only properties without defaults.

### 7.5 Shorthand as Preprocessing
Expand TW shorthands before any responsive mapping. This is a discrete pipeline stage, not ad-hoc logic sprinkled through the converter.

### 7.6 Visual Parity Over Semantic Matching
Prioritize rendered appearance over syntactic correspondence. When tradeoffs force imperfect mappings, the correct visual output wins.

## 8. Invariants (Non-Negotiable)

1. **No style leakage**: A TW value set only at ≥1024px must not affect ≤1023px in GB output
2. **No property loss**: Every TW layout class consumed must have an equivalent GB styles entry (flat or @media)
3. **Cosmetic preservation**: Non-layout classes (shadow, opacity, transition) always pass through to CSS fallback
4. **Responsive class consumption**: When `md:flex` is mapped to GB Tablet @media, the class must be removed from the element to prevent double-styling
5. **CSS field mirroring**: `styles` and `css` fields must be in sync for GB's editor+frontend dual system
6. **GB-native syntax**: `@media` blocks must use GB's confirmed query format, not ad-hoc queries
7. **V1 backward compatibility**: Non-responsive classes produce identical output to V1 flat path

## 9. Test Matrix

Verify every responsive conversion at these 6 viewport widths:

| Width | Tests |
|---|---|
| 320px | Mobile — sm: not yet active |
| 640px | sm: boundary — sm: just fired |
| 800px | md: active, below lg |
| 1024px | lg: boundary — 1px gap zone |
| 1100px | Desktop — all breakpoints active |
| 1400px | Desktop — xl: active |

## 10. Documented Technical Debt

| Item | Impact | Mitigation |
|---|---|---|
| 5→3 tier reduction (no xl/2xl sub-tiers) | xl/2xl styles flattened into Desktop | GB has no 4th tier. xl/2xl behave identically to lg in GB |
| 1px boundary at 1024px | TW lg fires at 1024, GB Desktop at 1025 | At exactly 1024px, GB shows Tablet value. Marginal — not worth engineering around |
| Shorthand expansion bloat | gap-4 → 2 properties × 3 tiers = 6 entries | Acceptable — GB native behavior |
| @media (min-width: 1025px) usage | Not a GB-native tier, but functionally equivalent to default | Used only for desktop-only properties without defaults |
