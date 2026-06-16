# CSS Classification & Canonicalization Design

> **Status:** Spec — updated with hardening measures, ready for implementation plan  
> **Updated:** 2026-06-16 (hardening: AST parser, full color fn support, property-level splitting, @media unwrapping, rejected.json, schemaVersion, golden snapshots, fuzz testing)

**Goal:** Split the monolithic `styles.css` (69 KB, ~1,044 CSS rules from Tailwind CDN compilation) into `global-styles.json` (GenerateBlocks-editable class styles) and `styles-unique.css` (raw CSS: preflight, keyframes, transforms, vendor prefixes) in a way that maximizes GB editability while producing visually lossless output.

**Architecture:** A PostCSS AST-based pipeline: parser → canonicalizer (resolves Tailwind `--tw-*-opacity` variables across ALL color function types) → property-level classifier (declarations split individually, not rule-level) → annotated output router with `rejected.json` sidecar for observability. Canonicalization is config-driven via JSON patterns, matching Tailwind's opacity contract rather than hardcoded variable names.

**Hardening principle:** Pessimistic by default. Any property, value syntax, or selector pattern not explicitly whitelisted → raw CSS. No silent routing. Every rejection is logged with machine-readable reason codes.

---

## 1. CSS Inventory (mino, 69 KB)

| Category | Count | Destination |
|---|---|---|
| Class rules, GB-compatible | ~897 | `global-styles.json` |
| Class rules, GB-incompatible (transforms, filters, animations, transitions) | ~49 | `styles-unique.css` |
| @media-wrapped class rules | ~220 | `global-styles.json` (unwrapped, annotated with breakpoint keys) |
| Element selectors (`body`, `html`, `*,::before,::after`) | ~28 | `styles-unique.css` |
| `@keyframes` blocks | 13 | `styles-unique.css` |
| Compound selectors (`.group:hover .group-hover\:text-primary`) | ~48 | `styles-unique.css` |
| Pseudo-elements (`::selection`, `::placeholder`) | 5 | `styles-unique.css` |

### Blockers to GB editability

1. **Tailwind opacity variables:** 173 `--tw-*-opacity: X` declarations wrap color values. Without canonicalization, every color/background/border class would be rejected to raw CSS despite being otherwise GB-compatible.
2. **Rule-level splitting:** A rule with both `color` (GB-supported) and `transform` (unsupported) gets blanket-rejected. Property-level splitting recovers the compatible declarations.
3. **@media-wrapped utilities:** Responsive classes like `@media (max-width: 768px) { .md\:text-lg { ... } }` contain GB-compatible properties buried inside an at-rule. Unwrapping annotates them with breakpoint keys.

---

## 2. Pipeline

```
styles.css (monolithic)
    │
    ▼
┌──────────────────────────┐
│ 1. PostCSS AST Parser     │  ← HARDENED: proper AST, not regex
│    Parses styles.css into │
│    a structured AST.      │
│    Tags each node by type │
│    (Rule, AtRule, Decl).  │
│    Rejects malformed CSS  │
│    with code=PARSE_ERROR. │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 2. @media Unwrapper       │  ← NEW
│    Unwraps @media blocks: │
│    md\:text-lg inside     │
│    @media (max-width:768) │
│    → annotated with       │
│    breakpoint key.        │
│    @keyframes stay raw.   │
└────────────┬─────────────┘
             ▼
    ┌────────┴────────┐
    │ Node type?       │
    └──┬────┬────┬─────┘
       │    │    │
  element @keyframe class
       │    │    │
       ▼    ▼    ▼
     raw  raw  ┌──────────────────────────┐
               │ 3. Canonicalizer          │  ← HARDENED: all color fns
               │    Per rule:              │
               │    a. Walk declarations   │
               │       via AST (not regex) │
               │    b. Find --tw-*-opacity │
               │       declarations        │
               │    c. Name-pair match     │
               │       with color values   │
               │       (rgb, rgba, hsl,    │
               │        oklch, hwb, hex)   │
               │    d. Resolve & strip     │
               │    e. Cross-var mismatch  │
               │       check → raw if fail │
               └────────────┬─────────────┘
                            ▼
               ┌──────────────────────────┐
               │ 4. Property-Level         │  ← HARDENED: declaration split
               │    Classifier              │
               │    For each declaration:  │
               │    - In GB whitelist?     │
               │    - Value syntax safe?   │
               │    GB props → structured  │
               │    Non-GB props → raw CSS │
               │    (same rule can split)  │
               └────────────┬─────────────┘
                            ▼
                    ┌───────┴───────┐
                    ▼               ▼
               global-styles    styles-unique
               .json            .css
                    │
                    ▼
               ┌──────────────────────────┐
               │ 5. rejected.json          │  ← NEW: observability
               │    Every rejection logged │
               │    with rule, reason code,│
               │    and severity.          │
               └──────────────────────────┘
```

### Detailed Routing Rules

**Always → styles-unique.css:**
- Element selectors (`body`, `html`, `*`, `*,::before,::after`)
- `@keyframes` blocks
- `@layer`, `@container`, `@scope`, `@supports` blocks
- Pseudo-elements (`::selection`, `::placeholder`, `::backdrop`, `::-webkit-*`)
- Compound/combinator selectors (`.group:hover .group-hover\:text-primary`, `.peer:checked ~ .peer-checked\:text-seafoam`)

**Per-declaration (after canonicalization):**
- Property in GB whitelist AND value syntax safe → `global-styles.json`
- Property NOT in whitelist OR value syntax unsafe → `styles-unique.css`
- Same rule CAN output to both files (property-level split)

**@media-wrapped class rules → global-styles.json (annotated):**
```json
{
  "selector": ".md\\:text-lg",
  "styles": {
    "fontSize": "1.125rem",
    "@media (max-width: 768px)": { "fontSize": "1.125rem" }
  }
}
```

---

## 3. Parser (AST-Based)

### 3.1 Technology

Use **PostCSS** with the `postcss` npm package. PostCSS provides a full CSS AST including:
- `Root` — top-level document
- `Rule` — selector + declarations
- `AtRule` — @media, @keyframes, @layer, @container, @supports, etc.
- `Declaration` — property: value pairs

Regex-based parsing is explicitly rejected — it cannot handle minified CSS, multi-line rules, nested at-rules, escaped characters, or malformed input safely.

### 3.2 Error Handling

- Malformed CSS that PostCSS cannot parse → reject the entire input with `code: "PARSE_ERROR"`
- PostCSS's built-in error recovery is not used — strict mode only
- Individual rule failures (canonicalizer error on one rule) → route that rule to raw CSS with rejection reason, continue processing remaining rules

### 3.3 AST Walking

```js
root.walkRules(rule => { /* class rules */ });
root.walkAtRules('media', atRule => { /* @media blocks */ });
root.walkAtRules('keyframes', atRule => { /* @keyframes */ });
root.walk(node => { /* catch-all for @layer, @supports, etc. */ });
```

---

## 4. @media Unwrapping

Responsive Tailwind utilities are compiled inside @media blocks:

```css
@media (min-width: 768px) {
  .md\:text-lg { font-size: 1.125rem; line-height: 1.75rem; }
  .md\:flex { display: flex; }
}
```

### Algorithm

1. Walk all `@media` at-rules
2. For each child `Rule` inside: extract the selector and declarations
3. Annotate declarations with the @media's breakpoint key:
   - `(max-width: 768px)` → Mobile
   - `(max-width: 1024px)` → Tablet
   - `(min-width: 768px)` → Desktop-Tablet+
   - `(min-width: 1024px)` → Desktop+
   - `(min-width: 1280px)` → Wide
4. Run canonicalizer + classifier on the unwrapped rule
5. GB-compatible declarations → global-styles.json with breakpoint annotation
6. GB-incompatible → styles-unique.css (the @media block is preserved as-is)

### Breakpoint Mapping

| Source @media | GB Breakpoint Key |
|---|---|
| `@media (max-width: 768px)` | `"@media (max-width: 768px)"` |
| `@media (max-width: 1024px)` | `"@media (max-width: 1024px)"` |
| `@media (min-width: 640px)` | `"@media (min-width: 640px)"` |
| `@media (min-width: 768px)` | `"@media (min-width: 768px)"` |
| `@media (min-width: 1024px)` | `"@media (min-width: 1024px)"` |
| `@media (min-width: 1280px)` | `"@media (min-width: 1280px)"` |

---

## 5. Canonicalization Algorithm

### 5.1 The Pattern (Tailwind's opacity contract)

```css
/* Full opacity (always 1) */
--tw-text-opacity: 1;
color: rgb(255 127 89 / var(--tw-text-opacity, 1));

/* Reduced opacity (e.g., text-orange/50) */
--tw-text-opacity: 0.5;
color: rgb(255 127 89 / var(--tw-text-opacity, 1));
```

The contract: every `--tw-<name>-opacity: X` declaration has a matching `var(--tw-<name>-opacity, Y)` in a color function within the same rule. The fallback `Y` always equals `1`, but the declared value `X` can vary.

### 5.2 Algorithm (per rule, AST-driven)

```
For each --tw-<name>-opacity: X declaration in the rule:
    1. Extract <name> ("text", "bg", "border", "ring", "divide", "placeholder")
    2. Extract numeric value X (0–1)
    3. Walk ALL declarations in the rule via AST
    4. Find color function declarations containing var(--tw-<name>-opacity, Y)
       - Match by NAME, not by position
    5. For each match:
       a. Parse the color function via AST (get channels)
       b. Resolve: replace var(--tw-<name>-opacity, Y) with X
       c. If X = 1: simplify to opaque form (e.g., rgb(R, G, B), #RRGGBB)
       d. If 0 < X < 1: emit as rgba(R, G, B, X)
       e. If X = 0: emit as rgba(R, G, B, 0) (preserve channels)
    6. Strip the --tw-<name>-opacity: X declaration from the rule
    7. If no matching var() found → skip canonicalization, log MISMATCH (see §8)
```

### 5.3 Supported Color Functions

| Function | Syntax | Handling |
|---|---|---|
| `rgb()` (modern) | `rgb(255 127 89 / var(--tw-text-opacity, 1))` | Extract R G B, resolve opacity |
| `rgba()` (legacy) | `rgba(197, 255, 214, var(--tw-bg-opacity, 1))` | Extract R G B, resolve opacity |
| `hsl()` | `hsl(15 100% 68% / var(--tw-text-opacity, 1))` | Extract H S L, resolve opacity → emit as `hsla(H, S%, L%, X)` |
| `hsla()` (legacy) | `hsla(15, 100%, 68%, var(--tw-text-opacity, 1))` | Same |
| `oklch()` | `oklch(0.6 0.2 150 / var(--tw-bg-opacity, 1))` | Extract L C H, resolve opacity |
| `hwb()` | `hwb(15 50% 0% / var(--tw-text-opacity, 1))` | Extract H W B, resolve opacity |
| Hex-alpha | `#FF7F5980` | No var() in hex — already resolved by CDN. Pass through unchanged. |
| `color-mix()` | `color-mix(in srgb, red, var(--tw-text-opacity))` | Reject to raw CSS (GB-unsupported function) |

**Resolution strategy:** the config file defines accepted color functions and their channel extraction patterns. Adding a new color function format requires only a config update, not code changes.

### 5.4 Cross-Variable Mismatch Detection

```
Input rule:
  --tw-text-opacity: 0.5;
  color: rgb(255 127 89 / var(--tw-bg-opacity, 1));  ← MISMATCH

Detection:
  Declaration name: --tw-text-opacity → "text"
  var() reference name: --tw-bg-opacity → "bg"
  text ≠ bg → log MISMATCH, route to raw CSS
```

### 5.5 Multiple Opacity Variables in One Rule

Each `--tw-<name>-opacity` is name-pair matched independently. No global substitution. Iterate per variable.

### 5.6 Box-Shadow

```css
/* Safe: no shadow-colored */
--tw-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
→ Strip --tw-shadow declaration. box-shadow value is fully resolved.

/* Unsafe: shadow-colored variable present */
box-shadow: ... var(--tw-shadow-colored) ...
→ Log SHADOW_COLORED, route to raw CSS.
```

---

## 6. Property-Level Classification

### 6.1 Why Declaration-Level Splitting

A rule may contain both GB-compatible and incompatible declarations:

```css
.some-class {
  color: rgb(255, 127, 89);       /* GB-supported */
  transform: translateX(1rem);     /* GB-unsupported */
}
```

**Before (rule-level):** Entire rule → raw CSS. Color editability lost.  
**After (declaration-level):** `color` → global-styles.json. `transform` → styles-unique.css.

### 6.2 Precedence

When the same property appears in both global-styles.json and styles-unique.css for the same selector:
- The raw CSS value wins (higher specificity in the cascade since it's loaded after)
- This is intentional: raw CSS is the ground truth; global-styles.json is the editable override

### 6.3 Complete GB Property Whitelist

```json
{
  "version": "2.2",
  "source": "generateblocks/block.json + generateblocks-pro/block.json",
  "properties": {
    "color": { "acceptedValues": ["rgb", "rgba", "hsl", "hsla", "hex", "named"] },
    "backgroundColor": { "acceptedValues": ["rgb", "rgba", "hsl", "hsla", "hex", "named"] },
    "fontSize": { "acceptedValues": ["length", "percentage", "calc"] },
    "fontWeight": { "acceptedValues": ["number", "named"] },
    "fontFamily": { "acceptedValues": ["string", "ident-list"] },
    "fontStyle": { "acceptedValues": ["normal", "italic", "oblique"] },
    "textTransform": { "acceptedValues": ["none", "uppercase", "lowercase", "capitalize"] },
    "textDecoration": { "acceptedValues": ["none", "underline", "line-through", "overline"] },
    "textAlign": { "acceptedValues": ["left", "center", "right", "justify"] },
    "lineHeight": { "acceptedValues": ["number", "length", "percentage"] },
    "letterSpacing": { "acceptedValues": ["length", "normal"] },
    "wordSpacing": { "acceptedValues": ["length", "normal"] },
    
    "marginTop": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "marginRight": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "marginBottom": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "marginLeft": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "paddingTop": { "acceptedValues": ["length", "percentage", "calc"] },
    "paddingRight": { "acceptedValues": ["length", "percentage", "calc"] },
    "paddingBottom": { "acceptedValues": ["length", "percentage", "calc"] },
    "paddingLeft": { "acceptedValues": ["length", "percentage", "calc"] },
    
    "borderTopWidth": { "acceptedValues": ["length"] },
    "borderRightWidth": { "acceptedValues": ["length"] },
    "borderBottomWidth": { "acceptedValues": ["length"] },
    "borderLeftWidth": { "acceptedValues": ["length"] },
    "borderTopLeftRadius": { "acceptedValues": ["length", "percentage"] },
    "borderTopRightRadius": { "acceptedValues": ["length", "percentage"] },
    "borderBottomLeftRadius": { "acceptedValues": ["length", "percentage"] },
    "borderBottomRightRadius": { "acceptedValues": ["length", "percentage"] },
    "borderRadius": { "acceptedValues": ["length", "percentage"] },
    "borderWidth": { "acceptedValues": ["length"] },
    "borderStyle": { "acceptedValues": ["none", "solid", "dashed", "dotted", "double"] },
    "borderColor": { "acceptedValues": ["rgb", "rgba", "hsl", "hsla", "hex", "named"] },
    
    "backgroundImage": { "acceptedValues": ["url", "linear-gradient", "radial-gradient", "none"] },
    "backgroundSize": { "acceptedValues": ["length", "percentage", "cover", "contain", "auto"] },
    "backgroundPosition": { "acceptedValues": ["position"] },
    "backgroundRepeat": { "acceptedValues": ["repeat", "no-repeat", "repeat-x", "repeat-y"] },
    "backgroundAttachment": { "acceptedValues": ["scroll", "fixed"] },
    
    "display": { "acceptedValues": ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none"] },
    "position": { "acceptedValues": ["static", "relative", "absolute", "fixed", "sticky"] },
    "zIndex": { "acceptedValues": ["integer", "auto"] },
    
    "flexDirection": { "acceptedValues": ["row", "row-reverse", "column", "column-reverse"] },
    "flexWrap": { "acceptedValues": ["nowrap", "wrap", "wrap-reverse"] },
    "alignItems": { "acceptedValues": ["flex-start", "flex-end", "center", "baseline", "stretch"] },
    "alignContent": { "acceptedValues": ["flex-start", "flex-end", "center", "space-between", "space-around", "stretch"] },
    "alignSelf": { "acceptedValues": ["auto", "flex-start", "flex-end", "center", "baseline", "stretch"] },
    "justifyContent": { "acceptedValues": ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"] },
    "justifyItems": { "acceptedValues": ["start", "end", "center", "stretch"] },
    "gap": { "acceptedValues": ["length", "percentage", "calc"] },
    "columnGap": { "acceptedValues": ["length", "percentage", "calc"] },
    "rowGap": { "acceptedValues": ["length", "percentage", "calc"] },
    "flexGrow": { "acceptedValues": ["number"] },
    "flexShrink": { "acceptedValues": ["number"] },
    "flexBasis": { "acceptedValues": ["length", "percentage", "auto"] },
    "order": { "acceptedValues": ["integer"] },
    
    "overflowX": { "acceptedValues": ["visible", "hidden", "scroll", "auto"] },
    "overflowY": { "acceptedValues": ["visible", "hidden", "scroll", "auto"] },
    
    "width": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "minWidth": { "acceptedValues": ["length", "percentage", "calc"] },
    "maxWidth": { "acceptedValues": ["length", "percentage", "none", "calc"] },
    "height": { "acceptedValues": ["length", "percentage", "auto", "calc"] },
    "minHeight": { "acceptedValues": ["length", "percentage", "calc"] },
    "maxHeight": { "acceptedValues": ["length", "percentage", "none", "calc"] },
    
    "aspectRatio": { "acceptedValues": ["ratio", "auto"] },
    
    "opacity": { "acceptedValues": ["number"] },
    "cursor": { "acceptedValues": ["named"] },
    "boxShadow": { "acceptedValues": ["any"] }
  }
}
```

### 6.4 Shorthand Property Handling

Shorthand properties (`margin`, `padding`, `border`, `background`, `flex`, `overflow`, `border-radius`, `gap`) are expanded to their longhand equivalents BEFORE classification. Each expanded longhand is individually classified against the whitelist.

Example: `margin: 1rem 2rem` → `marginTop: 1rem`, `marginRight: 2rem`, `marginBottom: 1rem`, `marginLeft: 2rem`.

### 6.5 Property-Value Validation

Beyond property-name matching:

| Check | Example | Action |
|---|---|---|
| Standard value | `color: rgb(255, 127, 89)` | Accept |
| GB-unsupported function | `color: color-mix(in srgb, red, blue)` | Reject, code=UNSUPPORTED_FUNCTION |
| GB-unsupported color space | `color: oklch(0.6 0.2 150)` | Reject, code=UNSUPPORTED_COLOR_SPACE |
| Unresolved var() | `color: var(--brand-color)` | Reject, code=UNRESOLVED_VAR |
| Non-Tailwind custom property | `--brand-spacing: 1rem` | Reject, code=CUSTOM_PROPERTY |
| Calc with var() | `width: calc(100% - var(--gap))` | Reject, code=UNRESOLVED_VAR_IN_CALC |
| CSS-wide keyword | `color: inherit` | Reject, code=CSS_WIDE_KEYWORD (GB uses its own inheritance) |
| Vendor-prefixed value | `display: -webkit-box` | Reject, code=VENDOR_PREFIXED_VALUE |

---

## 7. Observability: rejected.json

Every rejection is logged to a machine-readable sidecar:

```json
{
  "version": "1.0",
  "totalRules": 1044,
  "rejectedRules": 97,
  "rejectionRate": "9.3%",
  "rejections": [
    {
      "selector": ".rotate-6",
      "reason": "UNSUPPORTED_PROPERTY",
      "property": "transform",
      "severity": "expected",
      "destination": "styles-unique.css"
    },
    {
      "selector": ".md\\:text-lg",
      "reason": "CROSS_VARIABLE_MISMATCH",
      "detail": "declared --tw-text-opacity but var() references --tw-bg-opacity",
      "severity": "warning",
      "destination": "styles-unique.css"
    }
  ],
  "summaryByReason": {
    "UNSUPPORTED_PROPERTY": 49,
    "COMPOUND_SELECTOR": 48,
    "UNRESOLVED_VAR": 0,
    "CROSS_VARIABLE_MISMATCH": 0,
    "CUSTOM_PROPERTY": 0,
    "UNSUPPORTED_FUNCTION": 0,
    "UNSUPPORTED_COLOR_SPACE": 0,
    "CSS_WIDE_KEYWORD": 0,
    "VENDOR_PREFIXED_VALUE": 0,
    "SHADOW_COLORED": 0
  }
}
```

**Severity levels:**
- `expected` — known GB-incompatible (transforms, filters). No action needed.
- `warning` — unexpected rejection. May indicate a parser or config issue.
- `error` — malformed input or parser failure. Requires investigation.

---

## 8. Output Format

### 8.1 global-styles.json (versioned)

```json
{
  "schemaVersion": "1.0.0",
  "generator": {
    "name": "gb-converter",
    "version": "0.2.0"
  },
  "canonicalizer": {
    "framework": "tailwind",
    "version": "3.4",
    "configVersion": "1.0"
  },
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
    },
    {
      "selector": ".md\\:text-lg",
      "name": "Md Text Lg",
      "styles": {
        "fontSize": "1.125rem",
        "lineHeight": "1.75rem",
        "@media (min-width: 768px)": {
          "fontSize": "1.125rem",
          "lineHeight": "1.75rem"
        }
      }
    }
  ],
  "collisionStrategy": "last-write-wins"
}
```

### 8.2 styles-unique.css

Raw CSS containing: preflight reset, `@keyframes`, `@media` blocks with unsupported declarations, element selectors, compound selectors, pseudo-elements, transform/filter classes, cross-variable mismatches, unresolvable custom properties, vendor-prefixed values.

### 8.3 styles.css (unchanged)

The monolithic master fallback at project root remains untouched — it is always the canonical pixel-perfect reference.

### 8.4 rejected.json

See §7. Written alongside the other output files.

---

## 9. Configuration

### 9.1 Canonicalizer Config (`config/canonicalizer-tailwind-v3.json`)

```json
{
  "version": "1.0",
  "framework": "tailwind",
  "frameworkVersion": "3.4",
  "patterns": {
    "opacityVariable": {
      "declarationPattern": "^--tw-(?<name>\\w+)-opacity:\\s*(?<value>[\\d.]+)",
      "usagePattern": "var\\(--tw-(?<name>\\w+)-opacity,\\s*[\\d.]+\\)",
      "colorFunctions": {
        "rgb": { "channels": ["r", "g", "b"], "separator": "space" },
        "rgba": { "channels": ["r", "g", "b"], "separator": "comma" },
        "hsl": { "channels": ["h", "s", "l"], "separator": "space" },
        "hsla": { "channels": ["h", "s", "l"], "separator": "comma" },
        "oklch": { "channels": ["l", "c", "h"], "separator": "space" },
        "hwb": { "channels": ["h", "w", "b"], "separator": "space" }
      },
      "outputFormat": {
        "1": "{fn}({channels})",
        "other": "rgba({r}, {g}, {b}, {opacity})"
      }
    }
  },
  "skipIfContains": ["--tw-shadow-colored"]
}
```

### 9.2 GB Whitelist Config (`config/gb-whitelist.json`)

See §6.3 for the full property table. Stored as a standalone JSON file for easy updating.

---

## 10. Test Strategy

### 10.1 Unit Tests

**Canonicalizer:**
- Opacity=1 in rgb(), rgba(), hsl(), hsla(), oklch(), hwb()
- Opacity=0.5, 0.25, 0 in rgb()
- Multiple opacity variables in one rule (text + bg)
- Cross-variable mismatch → routed to raw CSS with MISMATCH code
- Box-shadow with and without shadow-colored
- calc() containing var(--tw-*-opacity) → reject, code=UNRESOLVED_VAR_IN_CALC
- Rule with ZERO declarations after stripping (only had --tw-* vars) → remove empty rule

**Classifier:**
- Every property in whitelist → accepted
- Property NOT in whitelist → rejected with UNSUPPORTED_PROPERTY
- Property in whitelist but value uses color-mix() → rejected with UNSUPPORTED_FUNCTION
- Property in whitelist but value uses oklch() → rejected with UNSUPPORTED_COLOR_SPACE
- Shorthand expansion → each longhand individually classified
- `display: -webkit-box` → rejected with VENDOR_PREFIXED_VALUE
- `color: inherit` → rejected with CSS_WIDE_KEYWORD

**@media Unwrapper:**
- Class rule inside @media unwrapped and annotated
- @keyframes inside @media → stays raw (not unwrapped)
- Nested @media → rejected with code=NESTED_MEDIA

### 10.2 Golden Snapshot Tests

Pre-generated known-good output for the mino project committed to `tests/snapshots/`:
- `global-styles.json` — golden file
- `styles-unique.css` — golden file
- `rejected.json` — golden file

CI compares pipeline output against golden snapshots. Any deviation fails the build.

### 10.3 Fuzz Testing

Generate random CSS rules with:
- Random combinations of GB-supported and unsupported properties
- Nested var() references
- Malformed CSS (unmatched braces, invalid property names)
- Extremely long selectors (10,000+ characters)
- CSS injection payloads (`</style><script>alert(1)</script>`)

Assert: pipeline never crashes, never produces invalid JSON, never emits unescaped HTML in CSS output.

### 10.4 Visual Parity Test

- After canonicalization, extract all color values from output
- Compare RGB channels and opacity against source CSS
- Assert: identical channels, identical resolved opacity

### 10.5 WordPress Sanitization Test

- Run `styles-unique.css` output through `safecss_filter_attr` in CI
- Assert: no silent stripping of `*` selectors, escaped colons, `@keyframes`, `@media`, or `--tw-*` custom properties

### 10.6 Performance Budget

- Pipeline must process 1,000 CSS rules in under 500ms (Node.js, single thread)
- `rejected.json` must be under 100KB for a 69KB input
- No unbounded memory growth with rule count (linear scaling)

---

## 11. Phased Implementation Roadmap

| Phase | Scope | Why phased |
|---|---|---|
| **P1: Foundation** | PostCSS AST parser, opacity canonicalization for rgb/rgba, rule-level classifier (existing logic, just ported to AST), rejected.json, golden snapshots | Replace fragile regex with AST. Ship the 173-opacity fix. Get observability. |
| **P2: Full Coverage** | Expand canonicalizer to hsl/oklch/hwb/hex-alpha, property-level declaration splitting, @media unwrapping, shorthand expansion, formal GB whitelist with value-type validation | Maximize GB editability. Recover responsive utilities. |
| **P3: Hardened** | CSS nesting support, @container/@supports handling, fuzz testing, WordPress sanitization CI test, performance budgets, SHA-256 input→output integrity manifest | Production-grade. Catch regressions before they ship. |
