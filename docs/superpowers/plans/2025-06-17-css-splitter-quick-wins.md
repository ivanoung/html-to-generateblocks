# Quick Wins: Preflight Kill + Utility Filter — Implementation Spec

> **Context:** The CSS splitter (`--split` flag) produces 608 GB Global Style entries where ~580 are Tailwind utility noise and 1100 lines of raw CSS where ~400 are preflight reset. These two fixes eliminate the noise at the source, dropping structured entries to ~20-50 meaningful design tokens and raw CSS to ~300 lines.

---

## Overview

| Fix | What | Impact | Risk |
|---|---|---|---|
| **#1 Preflight kill** | Inject `corePlugins: { preflight: false }` into Tailwind CDN config | Raw CSS: 1100→~300 lines | Low — one-line config change |
| **#2 Utility filter** | Route Tailwind utility classes to static CSS, skip GB Global Styles | Structured entries: 608→~20-50 | Low — regex filter, doesn't modify existing logic |

Both fixes live in the **global CSS splitting pipeline** (`--split`). Inline styles (block-level `style=""` → GB `styles` objects) are unchanged — they're already block-scoped and don't need this classification.

---

## The Architecture After Fixes

```
styles.css (Tailwind CDN compiled)
    │
    ├─ PREFLIGHT LAYER (stripped via CDN config)
    │   *, ::before, ::after { --tw-*:... }  ← never generated
    │   html, body, h1-h6 resets             ← never generated
    │
    ├─ UTILITY LAYER (regex-filtered → static CSS)
    │   .mt-4, .flex, .text-slate-700        ← styles-unique.css
    │   .hover\:opacity-80                   ← styles-unique.css
    │   .sm\:flex, .dark\:bg-slate-800       ← styles-unique.css
    │
    └─ DESIGN COMPONENTS (only these reach GB canonicalizer)
        .blueprint-bg, .ruler-x              ← global-styles-import.json
        .hover-shadow-md                     ← global-styles-import.json
        Unsupported properties in components ← styles-unique.css (small)
```

---

## Fix #1: Disable Preflight at CDN Source

### Where

`src/core/tailwind-resolver.ts` — new helper function  
`src/core/tailwind-inliner.ts` — two injection points

### What

The Tailwind CDN injects a massive preflight block:

```css
*, ::before, ::after { --tw-border-spacing-x: 0; --tw-translate-x: 0; ... }
::backdrop { --tw-border-spacing-x: 0; ... }
*, ::after, ::before { box-sizing: border-box; border-width: 0; border-style: solid; }
html { line-height: 1.5; -webkit-text-size-adjust: 100%; tab-size: 4; font-family: "DM Sans", sans-serif; }
body { margin: 0; line-height: inherit; }
hr { height: 0; color: inherit; border-top-width: 1px; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
a { color: inherit; text-decoration: inherit; }
img, svg, video, canvas, audio, iframe, embed, object { display: block; vertical-align: middle; }
...
```

None of this is "design CSS." It's browser normalization that should be handled by:
- The WordPress theme's own reset
- GeneratePress's built-in normalize
- Or a minimal custom reset if needed

The fix: suppress preflight at the Tailwind CDN level by adding `corePlugins: { preflight: false }` to the config object injected into the CDN document.

### Implementation

**Step 1: Add helper to `src/core/tailwind-resolver.ts`**

```typescript
/**
 * Inject corePlugins: { preflight: false } into a tailwind config JSON string.
 * Handles existing corePlugins objects by merging.
 */
export function disablePreflight(configJson: string): string {
  // If config has existing corePlugins, merge into it
  if (configJson.includes('"corePlugins"') || configJson.includes("corePlugins")) {
    return configJson.replace(
      /(corePlugins\s*:\s*\{)/,
      '$1"preflight":false,'
    );
  }

  // Inject corePlugins after the opening brace
  return configJson.replace(
    /\{/,
    '{"corePlugins":{"preflight":false},'
  );
}
```

**Step 2: Apply in `src/core/tailwind-inliner.ts`**

In `inlineTailwindMultiPage()`, after config extraction and expansion:

```typescript
// Existing code (~line 143)
const configJson = preExpandedConfig || extractTailwindConfig(pageHtmls[0]) || "{}";

// NEW: disable preflight
const configWithoutPreflight = disablePreflight(configJson);
```

Then use `configWithoutPreflight` in the CDN doc construction (~line 158):

```typescript
// Was: <script>tailwind.config = ${configJson}</script>
// Now:
<script>tailwind.config = ${configWithoutPreflight}</script>
```

**Step 3: Same for `compileWithPlaywright()` single-page path**

The single-page path in `compileWithPlaywright()` doesn't build its own CDN doc — it receives HTML directly. But `inlineTailwindStyles()` calls `compileWithPlaywright()` with the raw HTML that contains `<script>tailwind.config = {...}</script>`. We need to modify the HTML before passing it.

In `compileWithPlaywright()`, just before `page.setContent()`:

```typescript
// Inject preflight:false into any tailwind.config script tags in the HTML
html = html.replace(
  /(tailwind\.config\s*=\s*\{)/,
  '$1"corePlugins":{"preflight":false},'
);
```

### Verification

Run conversion on mino, check `styles-unique.css`:

```bash
# Before: 1100 lines, starts with *,::before,::after{--tw-border-spacing-x:0;...
# After: ~300-400 lines, NO *,::before,::after block, NO normalize.css reset
head -20 output/mino/setup/styles-unique.css
```

**Expected:** First lines should be user CSS (body background-color, .blueprint-bg, etc.), not Tailwind internals.

**Risk:** The WordPress theme might rely on Tailwind's box-sizing reset. Test by viewing converted pages in WordPress after import. If layout breaks, add a minimal reset to `styles-unique.css` manually (rare — GeneratePress already normalizes).

---

## Fix #2: Utility-Class Filter

### Where

`src/core/css-classifier.ts` — add filter before GB classification  
`src/core/css-classifier.ts` — new export `isTailwindUtility()`

### What

Before any class selector enters the GB canonicalizer, test it against a Tailwind utility pattern. Utilities go to raw CSS (they're static, never edited). Only custom design component classes pass through to GB Global Styles.

### Detection Pattern

```typescript
/**
 * Detect Tailwind utility classes by naming pattern.
 * Matches Tailwind v3 default utilities and common variants.
 * Custom utilities defined via theme.extend.utilities may also match
 * these patterns — see the manual override mechanism below.
 */
export function isTailwindUtility(className: string): boolean {
  // Strip leading dot
  const c = className.replace(/^\./, "");

  // Variant prefixes (any combination)
  const variantPrefix = "(?:hover|focus|active|focus-within|focus-visible|group-hover|group-focus|peer-checked|peer-hover|first|last|odd|even|visited|target|disabled|checked|indeterminate|required|valid|invalid|autofill|placeholder-shown|open|motion-safe|motion-reduce|dark|rtl|ltr|sm|md|lg|xl|2xl|min-\\[[^\\]]+\\]|max-\\[[^\\]]+\\]|portrait|landscape|contrast-more|contrast-less|supports-\\[[^\\]]+\\]|aria-\\[[^\\]]+\\]|data-\\[[^\\]]+\\])";
  const variantChain = `(?:${variantPrefix}:)*`;

  // Utility class patterns
  const patterns: RegExp[] = [
    // Spacing: m-4, mt-2, p-0, px-4, py-2, space-x-4, gap-4
    new RegExp(`^${variantChain}[mp][tblrxy]?-`, "i"),
    new RegExp(`^${variantChain}space-[xy]-`, "i"),
    new RegExp(`^${variantChain}gap-[xy]?-`, "i"),
    new RegExp(`^${variantChain}inset-[xy]?-`, "i"),

    // Sizing: w-full, h-64, min-w-0, max-w-4xl
    new RegExp(`^${variantChain}[wh]-(?:auto|full|screen|min|max|fit|\\d|\\[)`, "i"),
    new RegExp(`^${variantChain}min-[wh]-`, "i"),
    new RegExp(`^${variantChain}max-[wh]-`, "i"),
    new RegExp(`^${variantChain}size-`, "i"),

    // Typography: text-sm, font-sans, tracking-wider, leading-relaxed
    new RegExp(`^${variantChain}text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis|\\[)`, "i"),
    new RegExp(`^${variantChain}font-(?:sans|serif|mono|display|script|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\\[)`, "i"),
    new RegExp(`^${variantChain}tracking-`, "i"),
    new RegExp(`^${variantChain}leading-`, "i"),
    new RegExp(`^${variantChain}whitespace-`, "i"),
    new RegExp(`^${variantChain}break-`, "i"),
    new RegExp(`^${variantChain}truncate`, "i"),
    new RegExp(`^${variantChain}indent-`, "i"),
    new RegExp(`^${variantChain}align-`, "i"),
    new RegExp(`^${variantChain}list-`, "i"),
    new RegExp(`^${variantChain}decoration-`, "i"),
    new RegExp(`^${variantChain}underline`, "i"),
    new RegExp(`^${variantChain}overline`, "i"),
    new RegExp(`^${variantChain}line-through`, "i"),
    new RegExp(`^${variantChain}no-underline`, "i"),
    new RegExp(`^${variantChain}uppercase|lowercase|capitalize|normal-case`, "i"),

    // Colors: bg-slate-100, text-primary, border-red-500, ring-blue-200
    new RegExp(`^${variantChain}(?:bg|text|border|ring|ring-offset|outline|fill|stroke|placeholder|caret|accent|decoration|divide|shadow|from|via|to)-`, "i"),

    // Layout: block, flex, grid, hidden, inline, contents, flow-root
    new RegExp(`^${variantChain}(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|flow-root|table|table-row|table-cell)`, "i"),
    new RegExp(`^${variantChain}container`, "i"),

    // Position: static, fixed, absolute, relative, sticky
    new RegExp(`^${variantChain}(?:static|fixed|absolute|relative|sticky)`, "i"),

    // Flex/Grid: flex-row, flex-col, items-center, justify-between, place-items-*
    new RegExp(`^${variantChain}flex-(?:row|col|wrap|nowrap|1|auto|initial|none|shrink|grow)`, "i"),
    new RegExp(`^${variantChain}items-`, "i"),
    new RegExp(`^${variantChain}justify-(?:start|end|center|between|around|evenly|normal|stretch)`, "i"),
    new RegExp(`^${variantChain}justify-items-`, "i"),
    new RegExp(`^${variantChain}justify-self-`, "i"),
    new RegExp(`^${variantChain}place-(?:content|items|self)-`, "i"),
    new RegExp(`^${variantChain}self-`, "i"),
    new RegExp(`^${variantChain}content-`, "i"),
    new RegExp(`^${variantChain}order-`, "i"),
    new RegExp(`^${variantChain}grid-cols-`, "i"),
    new RegExp(`^${variantChain}grid-rows-`, "i"),
    new RegExp(`^${variantChain}col-`, "i"),
    new RegExp(`^${variantChain}row-`, "i"),
    new RegExp(`^${variantChain}auto-cols-`, "i"),
    new RegExp(`^${variantChain}auto-rows-`, "i"),

    // Overflow: overflow-hidden, overflow-x-auto, overflow-y-scroll
    new RegExp(`^${variantChain}overflow-[xy]?-`, "i"),

    // Effects: opacity-50, shadow-lg, rounded-xl, blur-sm, brightness-75
    new RegExp(`^${variantChain}opacity-`, "i"),
    new RegExp(`^${variantChain}shadow-`, "i"),
    new RegExp(`^${variantChain}rounded(?:-[tblr][lrb]?)?-`, "i"),
    new RegExp(`^${variantChain}rounded(?:-[tblr][lrb]?)?$`, "i"),
    new RegExp(`^${variantChain}blur-`, "i"),
    new RegExp(`^${variantChain}brightness-`, "i"),
    new RegExp(`^${variantChain}contrast-`, "i"),
    new RegExp(`^${variantChain}grayscale`, "i"),
    new RegExp(`^${variantChain}invert`, "i"),
    new RegExp(`^${variantChain}sepia`, "i"),
    new RegExp(`^${variantChain}saturate-`, "i"),
    new RegExp(`^${variantChain}hue-rotate-`, "i"),
    new RegExp(`^${variantChain}drop-shadow-`, "i"),
    new RegExp(`^${variantChain}backdrop-`, "i"),
    new RegExp(`^${variantChain}mix-blend-`, "i"),
    new RegExp(`^${variantChain}bg-blend-`, "i"),

    // Transforms: scale-90, rotate-45, translate-x-4, skew-x-2, origin-center
    new RegExp(`^${variantChain}scale-[xy]?-`, "i"),
    new RegExp(`^${variantChain}rotate-`, "i"),
    new RegExp(`^${variantChain}translate-[xy]-`, "i"),
    new RegExp(`^${variantChain}skew-[xy]-`, "i"),
    new RegExp(`^${variantChain}origin-`, "i"),

    // Transitions/Animation: transition-all, duration-300, ease-out, animate-spin
    new RegExp(`^${variantChain}transition-`, "i"),
    new RegExp(`^${variantChain}duration-`, "i"),
    new RegExp(`^${variantChain}ease-`, "i"),
    new RegExp(`^${variantChain}delay-`, "i"),
    new RegExp(`^${variantChain}animate-`, "i"),

    // Interactivity: cursor-pointer, select-none, resize, scroll-*, sr-only
    new RegExp(`^${variantChain}cursor-`, "i"),
    new RegExp(`^${variantChain}select-`, "i"),
    new RegExp(`^${variantChain}resize`, "i"),
    new RegExp(`^${variantChain}scroll-`, "i"),
    new RegExp(`^${variantChain}sr-only`, "i"),
    new RegExp(`^${variantChain}not-sr-only`, "i"),
    new RegExp(`^${variantChain}pointer-events-`, "i"),
    new RegExp(`^${variantChain}appearance-`, "i"),

    // SVG: fill-current, stroke-current, stroke-2
    new RegExp(`^${variantChain}(?:fill|stroke)-(?:current|none|inherit|transparent|\\[)`, "i"),
    new RegExp(`^${variantChain}stroke-\\d`, "i"),

    // Accessibility
    new RegExp(`^${variantChain}forced-color-`, "i"),

    // Z-index
    new RegExp(`^${variantChain}z-`, "i"),

    // Object fit / aspect ratio
    new RegExp(`^${variantChain}object-`, "i"),
    new RegExp(`^${variantChain}aspect-`, "i"),

    // Columns
    new RegExp(`^${variantChain}columns-`, "i"),

    // Box decoration break
    new RegExp(`^${variantChain}box-decoration-`, "i"),

    // Box sizing
    new RegExp(`^${variantChain}box-(?:border|content)`, "i"),

    // Arbitrary values: [&_>*]:, w-[300px], text-[#fff], bg-[url(...)]
    new RegExp(`^${variantChain}\\[`, "i"),
  ];

  // Custom utility catch-all: single-word classes that are all-lowercase
  // with hyphens (Tailwind naming convention for utilities)
  // BUT skip known design patterns and custom project classes
  // This catches things like .antialiased, .subpixel-antialiased
  const singleWordPattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;
  if (singleWordPattern.test(c) && c.split("-").length >= 2) {
    // These are likely utilities. Exceptions: classes with mixed case or leading underscore
    return true;
  }

  // Check against compiled patterns
  for (const pattern of patterns) {
    if (pattern.test(className)) return true;
  }

  return false;
}
```

### Integration into the Classifier

In `src/core/css-classifier.ts`, add the filter in `processRule()` before classification:

```typescript
// Inside processRule(), right after selector extraction (~line 151):

const selector = rule.selector.trim();

// NEW: Route Tailwind utilities to raw CSS — they're static, not editable design tokens
if (isTailwindUtility(selector)) {
  rawParts.push(rule.toString());
  rejectionLog.add(selector, "TAILWIND_UTILITY", undefined, "expected");
  return;
}

// ... rest of existing classification logic unchanged
```

### Manual Override (Custom Utility Handling)

Some projects define custom utility classes via `theme.extend` that match Tailwind naming patterns but ARE meaningful design tokens. Add a config file for project-specific exceptions:

`config/global-style-classes.json` (optional):
```json
{
  "include": [
    ".btn-primary",
    ".card",
    ".section-header",
    ".custom-gradient"
  ],
  "exclude": []
}
```

The classifier checks `include` first (always keep as Global Style), then checks utility patterns. `exclude` forces routing to raw CSS even if the regex doesn't match.

### Verification

```bash
# Before: 608 structured entries
# After: ~20-50 entries (only design component classes)
node -e "
const d = require('./output/mino/setup/global-styles-import.json');
console.log('Structured entries:', d.length);
d.forEach(s => console.log('  ' + s.selector));
"
```

**Expected output sample:**
```
Structured entries: 24
  .blueprint-bg
  .blueprint-bg-dark
  .ruler-x
  .hover-shadow-md
  .clip-hex
  .no-scrollbar
  .cal-embed
  (no .mt-4, .flex, .text-slate-700, .hover\:opacity-80, etc.)
```

**Rejection log should show `TAILWIND_UTILITY` as the dominant reason:**
```bash
node -e "
const d = require('./output/mino/setup/rejected.json');
const counts = {};
d.rejections.forEach(r => { counts[r.reason] = (counts[r.reason]||0)+1 });
console.log(counts);
"
# Expected: TAILWIND_UTILITY: ~550, UNSUPPORTED_PROPERTY: ~20, ...
```

---

## Shared Architecture Notes (for later)

These two fixes are designed to compose with the future three-layer refactor:

```
FUTURE STATE (after refactor):
  styles.css
    │
    ├─ Preflight layer → STRIPPED (via CDN config, no file output)
    │
    ├─ Utility layer → tailwind-utilities.css (site-wide, static)
    │   └─ isTailwindUtility() → write to tailwind-utilities.css
    │
    └─ Design components → global-styles-import.json + styles-unique.css
        └─ !isTailwindUtility() → GB canonicalizer → structured + raw

INLINE STYLES (block-level):
  style="margin-top: 1rem; clip-path: polygon(...);"
    │
    ├─ Utility check via isTailwindUtility(): style values matching spacing scale
    │   → per-block css string (static, not editable)
    │
    └─ Non-utility: GB canonicalizer → block.styles object + block.css string
```

The `isTailwindUtility()` function from Fix #2 is designed to be extracted into a shared module later, consumed by both the global CSS splitter and the inline style mapper.

### Inline Style Enhancement (Phase 2)

Once `isTailwindUtility()` is extracted to a shared module, apply it to inline styles in the DOM walker:

```typescript
// In dom-walker.ts or mapper.ts, when processing inline styles:
for (const [prop, value] of Object.entries(inlineStyles)) {
  if (isTailwindScaleValue(prop, value)) {
    // e.g., marginTop: "1rem" matches Tailwind's m-4 → static css
    blockCss.push(`${prop}: ${value}`);
  } else {
    // e.g., marginTop: "3.333px" → designer's custom value → GB styles object
    block.styles[camelProp] = value;
  }
}
```

Where `isTailwindScaleValue` checks:
- Numeric values that match Tailwind's spacing scale (0, 0.25rem, 0.5rem, 0.75rem, 1rem, 1.25rem, 1.5rem, 2rem, 2.5rem, 3rem, 3.5rem, 4rem, 5rem, 6rem, 7rem, 8rem, 9rem, 10rem, etc.)
- Color values that match the project's color palette
- Font sizes that match Tailwind's type scale

---

## Testing Strategy

### Before Implementing (baseline)

```bash
# Record current state
npx tsx src/cli/index.ts convert inputs/mino/ --split
wc -l output/mino/setup/styles-unique.css
node -e "console.log(require('./output/mino/setup/global-styles-import.json').length)"
node -e "console.log(require('./output/mino/setup/rejected.json').rejections.length)"

# Save as baseline
cp -r output/mino output/mino-baseline
```

### After Fix #1 (preflight)

```bash
npx tsx src/cli/index.ts convert inputs/mino/ --split
# Verify: no *,::before,::after block in styles-unique.css
head -5 output/mino/setup/styles-unique.css
# Verify: styles-unique.css shrank
wc -l output/mino/setup/styles-unique.css
```

### After Fix #2 (utility filter)

```bash
npx tsx src/cli/index.ts convert inputs/mino/ --split
# Verify: structured entries dropped dramatically
node -e "const d=require('./output/mino/setup/global-styles-import.json'); console.log(d.length, 'entries'); d.forEach(s=>console.log(' ',s.selector))"
# Verify: TAILWIND_UTILITY is top rejection reason
node -e "const d=require('./output/mino/setup/rejected.json'); const c={}; d.rejections.forEach(r=>{c[r.reason]=(c[r.reason]||0)+1}); console.log(c)"
```

### Visual Regression

After both fixes, import the converted pages into WordPress and verify:
- No visual differences in rendered pages (preflight was redundant with theme reset)
- Global Styles panel shows ~24 meaningful design classes, not 608 noise entries
- All 10 mino pages still pass the validator (no regressions)
