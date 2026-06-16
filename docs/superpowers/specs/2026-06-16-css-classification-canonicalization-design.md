# CSS Classification & Canonicalization Design

> **Status:** Spec — approved, ready for implementation plan

**Goal:** Split the monolithic `styles.css` (69 KB, ~1,044 CSS rules from Tailwind CDN compilation) into `global-styles.json` (GenerateBlocks-editable class styles) and `styles-unique.css` (raw CSS: preflight, keyframes, transforms, vendor prefixes) in a way that maximizes GB editability while producing visually lossless output.

**Architecture:** A 4-stage pipeline: CSS parser → canonicalizer (strips dead Tailwind variables) → classifier (property-level check against GB whitelist) → output router. The canonicalizer is framework-aware and config-driven, matching Tailwind's `--tw-*-opacity` contract pattern rather than hardcoded variable names.

---

## 1. CSS Inventory (mino, 69 KB)

| Category | Count | Destination |
|---|---|---|
| Class rules, GB-compatible | ~897 | `global-styles.json` |
| Class rules, GB-incompatible (transforms, filters, animations, transitions) | ~49 | `styles-unique.css` |
| Element selectors (`body`, `html`, `*,::before,::after`) | ~28 | `styles-unique.css` |
| `@media` blocks | 4 | `styles-unique.css` |
| `@keyframes` blocks | 13 | `styles-unique.css` |
| Compound selectors (`.group:hover .group-hover\:text-primary`) | ~48 | `styles-unique.css` |
| Pseudo-elements (`::selection`, `::placeholder`) | 5 | `styles-unique.css` |

### Blockers to GB editability

The primary blocker: Tailwind wraps color values with dead `--tw-*-opacity: 1` custom properties that GB doesn't support. In the mino project, 173 out of 173 opacity declarations are `1` (full opacity). Without canonicalization, all color/background/border classes would be rejected to raw CSS despite being otherwise GB-compatible.

---

## 2. Pipeline

```
styles.css (monolithic)
    │
    ▼
┌──────────────────────────┐
│ 1. CSS Parser             │
│    Splits into individual │
│    rules, tags each by    │
│    type (class, @media,   │
│    @keyframes, element,   │
│    compound, pseudo)      │
└────────────┬─────────────┘
             ▼
    ┌────────┴────────┐
    │ Type = class?    │
    └────────┬────────┘
       no    │    yes
        │    ▼
        │  ┌──────────────────────────┐
        │  │ 2. Canonicalizer          │
        │  │    Per rule:              │
        │  │    a. Find --tw-*-opacity │
        │  │       declarations        │
        │  │    b. Name-pair match     │
        │  │       with color values   │
        │  │    c. Resolve & strip     │
        │  │    d. Pre-flight: check   │
        │  │       for cross-variable  │
        │  │       mismatches          │
        │  └────────────┬─────────────┘
        │               ▼
        │  ┌──────────────────────────┐
        │  │ 3. Classifier             │
        │  │    For each property:     │
        │  │    - In GB whitelist?     │
        │  │    - Value syntax safe?   │
        │  │    All pass → structured  │
        │  │    Any fail → raw         │
        │  └────────────┬─────────────┘
        │               ▼
        │       ┌───────┴───────┐
        │       ▼               ▼
        │  global-styles    styles-unique
        │  .json            .css
        │
        ▼
   styles-unique.css
```

**Routing rules:**
- `@media`, `@keyframes`, `@layer`, `@container`, `@scope` → `styles-unique.css`
- Element selectors (`body`, `html`, `*`, `*,::before,::after`) → `styles-unique.css`
- Compound/combinator selectors (`.group:hover .group-hover\:text-primary`, `.peer:checked ~ .peer-checked\:text-seafoam`) → `styles-unique.css`
- Pseudo-elements (`::selection`, `::placeholder`, `::backdrop`, `::-webkit-*`) → `styles-unique.css`
- Class rules with ANY unsupported property after canonicalization → `styles-unique.css`
- Class rules with ONLY GB-supported properties → `global-styles.json`

---

## 3. Canonicalization Algorithm

### 3.1 The Pattern (Tailwind's opacity contract)

```css
/* Pattern A: full opacity (always 1) */
--tw-text-opacity: 1;
color: rgb(255 127 89 / var(--tw-text-opacity, 1));

/* Pattern B: reduced opacity (e.g., text-orange/50) */
--tw-text-opacity: 0.5;
color: rgb(255 127 89 / var(--tw-text-opacity, 1));
```

The contract: every `--tw-*-opacity` declaration has a matching `var(--tw-*-opacity, Y)` usage in exactly one color function within the same rule. The fallback `Y` always equals `1`.

### 3.2 Algorithm (per rule)

```
For each --tw-<name>-opacity: X declaration in the rule:
    1. Extract the property name <name> (e.g., "text", "bg", "border", "ring")
    2. Extract the numeric value X (e.g., 1, 0.5, 0.25)
    3. Find ALL color functions in the SAME rule containing var(--tw-<name>-opacity, ...)
       - Match by NAME, not by position
       - Support both: rgb(R G B / var(...)) and rgba(R, G, B, var(...))
    4. For each match:
       a. Extract R, G, B channel values
       b. If X = 1: replace with `rgb(R, G, B)`
       c. If 0 < X < 1: replace with `rgba(R, G, B, X)`
       d. If X = 0: replace with `rgba(R, G, B, 0)` (preserve channels, don't collapse to "transparent")
    5. Strip the --tw-<name>-opacity: X declaration entirely
    6. If no matching var() found for the declared variable → skip the rule, route to raw CSS (cross-variable mismatch)
```

### 3.3 Cross-Variable Mismatch Detection

Before canonicalizing, validate pairing:

```
Input rule:
  --tw-text-opacity: 0.5;
  color: rgb(255 127 89 / var(--tw-bg-opacity, 1));  ← MISMATCH

Detection:
  Declaration name: --tw-text-opacity
  var() reference name: --tw-bg-opacity
  → route to raw CSS, emit warning
```

This is a passive safety net. In practice, Tailwind CDN output never produces cross-variable mismatches, but the check costs nothing and prevents silent corruption if input format changes.

### 3.4 Multiple Opacity Variables in One Rule

Handle iteratively:

```css
--tw-text-opacity: 1;
--tw-bg-opacity: 0.5;
color: rgb(255 127 89 / var(--tw-text-opacity, 1));
background-color: rgb(197 255 214 / var(--tw-bg-opacity, 1));
```

Each `--tw-*-opacity` is name-pair matched to its own `var()` reference. No global substitution.

### 3.5 Supported Color Function Syntaxes

| Syntax | Example | Handling |
|---|---|---|
| Modern rgb (space-separated, slash-opacity) | `rgb(255 127 89 / var(--tw-text-opacity, 1))` | Extract R G B, resolve opacity |
| Legacy rgba (comma-separated) | `rgba(197, 255, 214, var(--tw-bg-opacity, 1))` | Extract R G B, resolve opacity |
| Future formats (v3.4+): oklch, hsl, hwb | `oklch(0.6 0.2 150 / var(--tw-text-opacity, 1))` | Config-driven; RGB-only initially |

### 3.6 Box-Shadow Handling

```css
/* Safe to canonicalize: no shadow-colored variable */
--tw-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-shadow);
→ Strip --tw-shadow declaration, preserve box-shadow: 0 1px 2px ...

/* Skip canonicalization: shadow-colored present */
--tw-shadow: 0 1px 2px 0;
--tw-shadow-colored: 0 1px 2px 0 var(--tw-shadow-color);
box-shadow: var(--tw-ring-offset-shadow), var(--tw-shadow);
→ Route entire rule to raw CSS
```

---

## 4. Classification (GB Property Whitelist)

After canonicalization, classify each rule's remaining properties.

### 4.1 GB-Supported Properties

```
fontSize, fontWeight, fontFamily, fontStyle,
textTransform, textDecoration, textAlign,
lineHeight, letterSpacing, wordSpacing,
color, backgroundColor,
marginTop, marginRight, marginBottom, marginLeft,
paddingTop, paddingRight, paddingBottom, paddingLeft,
margin, padding,
borderTopWidth, borderRightWidth, borderBottomWidth, borderLeftWidth,
borderTopLeftRadius, borderTopRightRadius,
borderBottomLeftRadius, borderBottomRightRadius,
borderRadius, borderWidth, borderStyle, borderColor,
backgroundImage, backgroundSize, backgroundPosition,
backgroundRepeat, backgroundAttachment,
display, position, zIndex,
flexDirection, flexWrap,
alignItems, alignContent, alignSelf,
justifyContent, justifyItems,
gap, columnGap, rowGap,
flexGrow, flexShrink, flexBasis, order,
overflowX, overflowY, overflow,
width, minWidth, maxWidth,
height, minHeight, maxHeight,
opacity, cursor, boxShadow
```

### 4.2 Property-Value Validation

Beyond property-name matching, validate value syntax:

| Check | Example | Action |
|---|---|---|
| Standard value | `color: rgb(255, 127, 89)` | Accept |
| GB-unsupported function | `color: color-mix(in srgb, red, blue)` | Reject to raw CSS |
| GB-unsupported color space | `color: oklch(0.6 0.2 150)` | Reject to raw CSS |
| Unresolved var() | `color: var(--brand-color)` | Reject to raw CSS |
| Non-Tailwind custom property | `--brand-spacing: 1rem` | Reject to raw CSS |

**Default rule:** any property or value syntax not explicitly whitelisted → raw CSS. Optimistic classification (accept if looks safe) is the wrong default; pessimistic (reject unless known-safe) is correct.

---

## 5. Output Format

### 5.1 global-styles.json (versioned)

```json
{
  "version": "1.0",
  "generator": "gb-converter/0.2.0",
  "canonicalizer": "tailwind-v3/1.0",
  "styles": [
    {
      "selector": ".text-orange",
      "name": "Text Orange",
      "styles": {
        "color": "rgb(255, 127, 89)"
      }
    },
    {
      "selector": ".bg-primary\\/50",
      "name": "Bg Primary 50",
      "styles": {
        "backgroundColor": "rgba(197, 255, 214, 0.5)"
      }
    }
  ]
}
```

### 5.2 styles-unique.css

Raw CSS containing: preflight reset, `@keyframes`, `@media` blocks, element selectors, compound selectors, pseudo-elements, transform/filter classes, cross-variable mismatches, unresolvable custom properties.

### 5.3 styles.css (unchanged)

The monolithic master fallback at project root remains untouched — it is always the canonical pixel-perfect reference.

---

## 6. Configuration

### 6.1 Canonicalizer Config (`config/canonicalizer-tailwind-v3.json`)

```json
{
  "version": "3.4",
  "framework": "tailwind",
  "patterns": {
    "opacityVariable": {
      "declarationPattern": "^--tw-(?<name>\\w+)-opacity:\\s*(?<value>[\\d.]+)",
      "usagePattern": "var\\(--tw-(?<name>\\w+)-opacity,\\s*[\\d.]+\\)",
      "colorFunctions": ["rgb", "rgba"],
      "outputFormat": {
        "1": "rgb({r}, {g}, {b})",
        "other": "rgba({r}, {g}, {b}, {opacity})"
      }
    }
  },
  "skipIfContains": ["--tw-shadow-colored"]
}
```

### 6.2 GB Whitelist Config (`config/gb-whitelist.json`)

```json
{
  "version": "2.2",
  "source": "generateblocks/block.json + generateblocks-pro/block.json",
  "properties": {
    "color": { "acceptedValues": ["rgb", "rgba", "hex", "named"] },
    "backgroundColor": { "acceptedValues": ["rgb", "rgba", "hex", "named"] },
    "boxShadow": { "acceptedValues": ["any"] }
  }
}
```

---

## 7. Test Strategy

### 7.1 Unit Tests
- **Canonicalizer:** rules with opacity=1, opacity=0.5, opacity=0.25, opacity=0, multiple opacity variables, cross-variable mismatches, both rgb() and rgba() syntax, box-shadow with and without shadow-colored
- **Classifier:** property-whitelist positive/negative, value-syntax positive/negative, compound selectors rejection, pseudo-element rejection
- **Config:** loading/missing config, version mismatch warnings

### 7.2 Integration Tests
- Full pipeline run on mino → verify output file existence and structure
- Regression: run on hkvc → verify no regressions

### 7.3 Visual Parity Test
- Run pipeline, compare canonicalized color values against source CSS values for identical RGB channels and opacity

### 7.4 WordPress Sanitization Test
- Run output `styles-unique.css` through WordPress's `safecss_filter_attr` filter in CI → verify no silent stripping of `*` selectors, escaped colons, or `@keyframes`

---

## 8. Future Extensions (out of scope for V1)

- **Auto-generated whitelist:** CI job that scrapes GB `block.json` files to auto-generate `gb-whitelist.json` on each GB update
- **New framework plugins:** Plugin interface for Bootstrap utilities, UnoCSS, Tailwind v4 (which uses `@layer` and `oklch()` natively)
- **CI release watches:** Automated triggers on new Tailwind/GB releases to run regression suite
- **Property-value deep validation:** Full CSS value parser that understands `color-mix()`, `oklch()`, `hsl()`, and can determine GB compatibility at value level
