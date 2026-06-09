# WordPress-Safe CSS Selectors for Global Styles

> **Status:** Design approved — ready for implementation plan

**Goal:** Prevent WordPress from corrupting CSS selectors in Global Styles by eliminating backslash escape characters from both the `selector` field (admin label) and the `css` field (browser CSS). WordPress's `wp_unslash()` strips backslashes from all post meta values, breaking selectors with special characters (`:`, `[`, `]`, `/`).

**Architecture:** Two transformations applied in `css-splitter.ts`:
1. `selector` field → sanitized with `-` replacement (safe WordPress label)
2. `css` field → class selectors containing escapes converted to `[class~="..."]` attribute selectors (backslash-free CSS that browsers parse correctly)

**Tech Stack:** TypeScript, `css` npm package (v3.0.0)

---

## Problem

WordPress calls `wp_unslash()` when reading post meta values. This strips literal backslash characters (`\`) from `gb_style_selector` and `gb_style_css` meta fields.

**Broken CSS output:**
```
CSS-escaped input:   .lg\:flex{display:flex}
After wp_unslash():  .lg:flex{display:flex}       ← invalid CSS, : parsed as pseudo-class

CSS-escaped input:   .w-\[600px\]{width:600px}
After wp_unslash():  .w-[600px]{width:600px}       ← invalid CSS, [ starts attribute selector

CSS-escaped input:   .aspect-\[16\/9\]{aspect-ratio:16/9}
After wp_unslash():  .aspect-[16/9]{aspect-ratio:16/9}  ← invalid CSS
```

**Impact:** ~200+ of 524 Global Style entries have special characters. All responsive variants (`.sm:*`, `.md:*`, `.lg:*`, `.xl:*`) and all arbitrary value classes (`.w-[...]`, `.min-h-[...]`, etc.) produce invalid CSS. Layout, spacing, and responsive behavior break.

---

## Solution

### Transformation 1: `selector` field (admin label)

Replace CSS-escaped special characters with hyphens:

| Input (`selector`) | Output (`selector`) |
|---|---|
| `.lg\:flex` | `.lg-flex` |
| `.w-\[600px\]` | `.w-600px` |
| `.aspect-\[16\/9\]` | `.aspect-16-9` |
| `.md\:grid-cols-12` | `.md-grid-cols-12` |
| `.flex` (no escapes) | `.flex` (unchanged) |

**Rule:** `\:` → `-`, `\[` → `-`, `\]` → (removed), `\/` → `-`

The `selector` field is stored as `gb_style_selector` and used only as an admin identifier (post title, editor source label). It is never used for CSS matching.

### Transformation 2: `css` field (browser CSS)

Convert CSS-escaped class selectors to `[class~="..."]` attribute selectors. This eliminates all backslash characters while preserving correct browser matching.

| Input (`css`) | Output (`css`) |
|---|---|
| `.lg\:flex{display:flex}` | `[class~="lg:flex"]{display:flex}` |
| `.w-\[600px\]{width:600px}` | `[class~="w-[600px]"]{width:600px}` |
| `.aspect-\[16\/9\]{aspect-ratio:16/9}` | `[class~="aspect-[16/9]"]{aspect-ratio:16/9}` |
| `.hover\:bg-seafoam:hover{...}` | `[class~="hover:bg-seafoam"]:hover{...}` |
| `.flex{display:flex}` (no escapes) | `.flex{display:flex}` (unchanged) |

**Rule:** Only convert selectors containing CSS escapes (`\:`, `\[`, `\]`, `\/`). Simple selectors stay as class selectors for cleaner output.

**Pseudo-class handling:** Pseudo-classes (`:hover`, `:focus`, `:active`, etc.) must be split from the class name before wrapping. The pseudo-class stays outside:
- `.hover\:bg-seafoam:hover` → class=`hover\:bg-seafoam`, pseudo=`:hover` → `[class~="hover:bg-seafoam"]:hover`

**Inside `@media` wrappers:** The attribute selector goes inside the `@media` wrapper, same as before:
```
@media (min-width: 768px){[class~="md:flex"]{display:flex}}
```

**Multi-selector rules:** If a rule has multiple selectors, each is converted individually before serialization. If any selector in a multi-selector rule needs escaping, the entire serialized rule uses attribute selectors for the affected selectors.

**No change to:** Preflight resets, element selectors, keyframes, pseudo-elements, `styles-unique.css` — these never go through WordPress post meta.

---

## Specificity Analysis

| Selector type | Specificity |
|---|---|
| `.flex` | (0,1,0) |
| `[class~="flex"]` | (0,1,0) |
| `.lg\:flex` (CSS-escaped) | (0,1,0) |
| `[class~="lg:flex"]` | (0,1,0) |

All have the same specificity. No cascade changes. ✓

**Edge case — matching behavior:** `[class~="lg:flex"]` matches elements where `lg:flex` is a whitespace-separated token in the `class` attribute. This is semantically identical to `.lg\:flex`. ✓

---

## Implementation

### File: `src/core/css-splitter.ts`

**New function: `toSafeCssSelector(selector: string): string`**

```typescript
/**
 * Convert a CSS-escaped class selector to a WordPress-safe format.
 * Uses [class~="..."] attribute selectors to avoid backslash characters
 * that WordPress wp_unslash() strips from post meta.
 *
 * Only converts selectors that actually contain CSS escapes.
 * Pseudo-classes are split and placed outside the attribute selector.
 */
function toSafeCssSelector(selector: string): string {
  // Only convert if the selector has CSS escapes
  if (!/[\\]:\[\/]/.test(selector)) return selector;

  // Separate pseudo-classes from the base class name
  // Match: everything up to (but not including) the final :pseudo chain
  const pseudoMatch = selector.match(/^(.+?)((?::[a-zA-Z-]+)+)$/);
  const base = pseudoMatch ? pseudoMatch[1] : selector;
  const pseudo = pseudoMatch ? pseudoMatch[2] : "";

  // Unescape the class portion (remove backslash escapes to get the raw class name)
  const rawClass = base
    .replace(/^\./, "")          // strip leading dot
    .replace(/\\(.)/g, "$1");    // unescape \: → :, \[ → [, etc.

  // Sanitize internal double quotes (shouldn't exist in class names, but be safe)
  const safeClass = rawClass.replace(/"/g, '\\"');

  return `[class~="${safeClass}"]${pseudo}`;
}
```

**New function: `sanitizeSelector(selector: string): string`**

```typescript
/**
 * Sanitize a CSS selector for the WordPress admin label (gb_style_selector).
 * Replaces CSS escape sequences with hyphens since WordPress strips backslashes.
 */
function sanitizeSelector(selector: string): string {
  return selector
    .replace(/\\:/g, "-")
    .replace(/\\\[/g, "-")
    .replace(/\\\]/g, "")
    .replace(/\\\//g, "-");
}
```

**Modified: `serializeRule()`**

Before serializing a `css.Rule`, convert selectors that need escaping:

```typescript
function serializeRule(rule: css.Rule | css.Media): string {
  // ... existing media, keyframes, font-face, supports handling ...
  
  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selectors = (r.selectors || [])
      .map((s) => toSafeCssSelector(s));   // ← NEW: convert escaped selectors
    const selector = selectors.join(",");
    // ... rest unchanged ...
  }
}
```

**Modified: `walkRule()` — selector field sanitization**

Wherever `GlobalStyleEntry.selector` is assigned, apply `sanitizeSelector()`:

```typescript
// Top-level rule → GS
globalStyles.push({
  name: classNameToName(baseSelector),
  selector: sanitizeSelector(baseSelector),   // ← sanitized
  css: serializeRule(r),                       // ← uses toSafeCssSelector internally
});

// @media GS child
globalStyles.push({
  name: classNameToName(baseSelector),
  selector: sanitizeSelector(baseSelector),   // ← sanitized
  css: serializeRule(wrappedMedia),            // ← uses toSafeCssSelector internally
});

// Custom class bypass
globalStyles.push({
  name: classNameToName(baseSelector),
  selector: sanitizeSelector(baseSelector),   // ← sanitized
  css: serializeRule(r),                       // ← uses toSafeCssSelector internally
});
```

---

## Example Output Comparison

### Before (broken — backslashes stripped by WordPress)

```json
{
  "selector": ".lg\\:flex",
  "css": ".lg\\:flex{display:flex}"
}
```

WordPress stores → `gb_style_css` = `.lg:flex{display:flex}` → **invalid CSS**

### After (fixed)

```json
{
  "selector": ".lg-flex",
  "css": "[class~=\"lg:flex\"]{display:flex}"
}
```

WordPress stores → `gb_style_css` = `[class~="lg:flex"]{display:flex}` → **valid CSS** ✓

### Before (broken — responsive with pseudo-class)

```json
{
  "selector": ".hover\\:bg-seafoam",
  "css": ".hover\\:bg-seafoam:hover{background-color:#93FFD8}"
}
```

WordPress stores → invalid CSS

### After (fixed)

```json
{
  "selector": ".hover-bg-seafoam",
  "css": "[class~=\"hover:bg-seafoam\"]:hover{background-color:#93FFD8}"
}
```

WordPress stores → valid CSS ✓

---

## Files Changed

| File | Change |
|---|---|
| `src/core/css-splitter.ts` | Add `toSafeCssSelector()`, `sanitizeSelector()`. Modify `serializeRule()` to convert selectors. Modify `walkRule()` to sanitize selector field. |
| `tests/css-splitter.test.ts` | Add tests for selector sanitization and CSS safe conversion. |

No changes to: `types.ts`, `orchestrator.ts`, `global-styles-collector.ts`, `dom-walker.ts`, HTML output, `styles-unique.css`.

---

## Test Cases

| Test | Input (selector/css) | Expected selector | Expected css |
|---|---|---|---|
| Simple class (no escape) | `.flex` / `.flex{display:flex}` | `.flex` | `.flex{display:flex}` |
| Responsive variant | `.md\:flex` / `.md\:flex{display:flex}` | `.md-flex` | `[class~="md:flex"]{display:flex}` |
| Arbitrary value brackets | `.w-\[600px\]` / `.w-\[600px\]{width:600px}` | `.w-600px` | `[class~="w-[600px]"]{width:600px}` |
| Fraction | `.w-1\/2` / `.w-1\/2{width:50%}` | `.w-1-2` | `[class~="w-1/2"]{width:50%}` |
| Pseudo-class preserved | `.hover\:bg:hover` / `.hover\:bg:hover{...}` | `.hover-bg` | `[class~="hover:bg"]:hover{...}` |
| @media wrapper | `@media(...){.lg\:flex{...}}` | `.lg-flex` | `@media(...){[class~="lg:flex"]{...}}` |
| Multiple selectors (mixed) | `.flex,.lg\:flex{display:flex}` | N/A (UC) | `.flex,[class~="lg:flex"]{display:flex}` |
| Custom class bypass | `.blueprint-bg` / `.blueprint-bg{background:...}` | `.blueprint-bg` | `.blueprint-bg{...}` (no escapes) |

---

## Scope Boundaries

**In scope:**
- `toSafeCssSelector()` — converts escaped class selectors to `[class~="..."]` format
- `sanitizeSelector()` — replaces escapes with `-` for the admin label
- Integration into `serializeRule()` and `walkRule()`
- Unit tests for all transformation scenarios

**Out of scope:**
- Changing the GB import/export process (WordPress-side fix)
- Fixing `styles-unique.css` (not stored in post meta, no backslash issue)
- Changing the HTML output or `globalClasses` format
- The `name` field (already Title Case, no escapes)
- Classes without CSS escapes (`.flex`, `.grid` — unchanged)

---

## Self-Review

1. **Placeholder scan:** No TBD, TODO, or incomplete sections.
2. **Internal consistency:** Both transformations are applied consistently across all GS-entry creation points. `serializeRule()` converts the CSS; `walkRule()` sanitizes the label. The `name` field is unchanged.
3. **Scope check:** Two functions + integration into one file. Tightly scoped.
4. **Ambiguity:** Attribute selector matching behavior identical to class selector. Pseudo-class split logic handles edge case of multiple pseudo-classes. No unescaped double quotes possible in Tailwind class names.
