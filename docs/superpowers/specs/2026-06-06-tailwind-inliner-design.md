# Tailwind CSS Inliner — Design Spec

**Date:** 2026-06-06
**Status:** Approved (awaiting implementation plan)

## Problem

The HTML → GB converter preserves Tailwind CSS classes as opaque `globalClasses`
on blocks with empty `styles` objects. Users who don't want Tailwind in their
output need all utility classes resolved to vanilla inline CSS before
conversion.

Example — current output for a hero heading:

```html
<!-- wp:generateblocks/text {"uniqueId":"text002","tagName":"h1","styles":{},"css":"","globalClasses":["font-display","font-semibold","text-5xl","md:text-7xl","lg:text-8xl",...]} -->
<h1 class="gb-text font-display font-semibold text-5xl md:text-7xl lg:text-8xl ...">
```

Expected output:

```html
<!-- wp:generateblocks/text {"uniqueId":"text002","tagName":"h1","styles":{"fontFamily":"Anybody, sans-serif","fontWeight":"600","fontSize":"6rem","...responsive overrides..."},"css":"..."} -->
<h1 class="gb-text">
```

## Approach

**Headless browser extraction via Playwright.**

Load the HTML page in Chromium, extract `getComputedStyle()` for every visible
element, and rewrite the HTML with resolved inline `style` attributes. The
output is a Tailwind-free HTML document that renders pixel-identically to the
original.

This is the only approach that guarantees zero fidelity loss on a page using
Tailwind CSS because:

1. **Cascade is handled by the browser** — no CSS parsing, no specificity math,
   no guessing which rule wins
2. **State variants resolve correctly** — `group-hover/dropdown:opacity-100`
   yields `opacity: 1` when the parent hovers, and `opacity: 0` otherwise; both
   states are extractable
3. **CSS custom property chains resolve** — Tailwind's `--tw-translate-y`
   variable chain with `transform: translate(...) rotate(...) scaleX(...)`
   resolves to a concrete `matrix(...)` value
4. **Responsive breakpoints resolve** — resize the viewport and re-extract
5. **Arbitrary values work** — `bg-[#10b981]`, `shadow-[0_0_15px_rgba(...)]`,
   all arbitrary value syntax resolves through the browser's CSS engine

### Why not CSS parsing?

A pure CSS parsing approach (compile Tailwind, parse minified CSS, build a
class→property map) has fatal gaps:

| Gap | Root cause | Browser extraction fix |
|---|---|---|
| Inline styles beat stylesheet rules | `style="opacity:0"` has higher specificity than `.class:hover{opacity:1}` | Browser resolves final computed value; all styles are now inline |
| CSS variable chains for transforms | `--tw-translate-y` shared across multiple utility classes | Browser computes final `matrix()` |
| Escaped arbitrary-value selectors | `hover\:shadow-\[0_0_15px_rgba\(16\,185\,129\,0\.4\)\]` | Browser resolves — no selector parsing needed |
| Group namespace modifiers | `group/dropdown` → `.group\/dropdown:hover .child` | Browser resolves based on actual DOM hover state |

## Architecture

```
                         ┌─── tailwind-inliner.ts ───┐
                         │                            │
  raw HTML ──────────────┤  1. Launch Playwright       │
  (Tailwind classes       │  2. load page + wait CDN   │
   + inline config)       │  3. extract computedStyles │
                          │  4. inject as inline style │
                          │  5. strip script/link tags │
                          │  6. remove Tailwind classes│
                          │  7. capture responsive @    │
                          │     multiple viewports     │
                          │                            │───── clean HTML ───┐
                          └────────────────────────────┘                     │
                                                                             ▼
                                                                  existing preprocessor
                                                                             │
                                                                             ▼
                                                                  existing DOM walker
                                                                             │
                                                                             ▼
                                                                     GB blocks
```

### Pipeline integration

The inliner runs as a **pre-step** before the existing `preprocess()` call in
`orchestrator.ts`. It is gated behind detection of Tailwind usage:

```ts
// orchestrator.ts
import { inlineTailwindStyles } from "./tailwind-inliner.js";

function convert(input: ConversionInput): ConversionOutput {
  let html = input.rawHtml;

  if (hasTailwindConfig(html) || hasTailwindClasses(html)) {
    const inlined = await inlineTailwindStyles(html);
    html = inlined.html;
    // inlined.responsiveCss is collected but ignored —
    // all styles are inline at this point
  }

  const prepResult = preprocess(html);
  // ... rest unchanged
}
```

### What changes in existing modules

| Module | Change |
|---|---|
| `orchestrator.ts` | Add `await inlineTailwindStyles()` call before `preprocess()` |
| `preprocessor.ts` | No changes — sees clean HTML with inline styles only |
| `dom-walker.ts` | **Remove line 413-414** that preserves all class tokens as `globalClasses`. Only preprocessor-resolved classes from `<head> <style>` blocks remain |
| `serializer.ts` | No changes |
| `validator.ts` | No changes |
| `tailwind-resolver.ts` | Retained for standalone `--resolve-css` flag; not used by the inliner |

### Detection strategy

```ts
function hasTailwindConfig(html: string): boolean {
  return /tailwind\.config\s*=\s*/.test(html);
}

function hasTailwindClasses(html: string): boolean {
  // Quick regex for Tailwind utility class patterns in class="..."
  // Matches things like: w-full, flex, pt-32, lg:pt-48, hover:bg-*
  return /class\s*=\s*"[^"]*(?:pt-\d+|pb-\d+|px-\d+|py-\d+|p-\d+|mt-\d+|mb-\d+|mx-\d+|my-\d+|m-\d+|w-(?:full|\d+\/|\[)|h-(?:full|\d+\/|\[)|flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|text-(?:xs|sm|base|lg|xl|\d?xl|\[)|font-(?:sans|serif|mono|display|script)|bg-\[|bg-(?:white|black|transparent|current|inherit|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)|hover:|focus:|active:|group-|peer-|lg:|md:|sm:|xl:|2xl:|dark:|motion-)/.test(html);
}
```

## `tailwind-inliner.ts` Module Design

### Export

```ts
export interface InlinerResult {
  html: string;          // Clean HTML with inline styles, no Tailwind classes
  elementCount: number;  // Number of elements that received styles
  warnings: string[];    // Non-fatal issues encountered
}

export async function inlineTailwindStyles(
  rawHtml: string,
  options?: InlinerOptions,
): Promise<InlinerResult>;
```

### Options

```ts
interface InlinerOptions {
  /** Viewports to extract responsive styles at. Default: desktop 1440 + mobile 375 */
  viewports?: Array<{ width: number; height: number; label: string }>;
  /** Timeout for Tailwind CDN compilation (ms). Default: 3000 */
  cdnTimeout?: number;
  /** Whether to set viewport to 375px and re-extract for mobile styles */
  captureResponsive?: boolean;
}
```

### Implementation steps

1. **Launch browser**: Chromium headless via Playwright
2. **Load page**: `page.setContent(rawHtml)` with `waitUntil: "networkidle"` to
   let the Tailwind CDN compile and apply all classes
3. **Wait**: Allow a configurable timeout for CDN compilation to complete
4. **Extract base styles** (desktop viewport, default 1440×900):
   - Query every visible element (`document.body.querySelectorAll("*")`)
   - Call `window.getComputedStyle(el)` on each
   - Set `el.style.cssText = computedStyle.cssText` to inline all resolved values
   - Merge with any existing `style` attribute (existing wins)
5. **Capture responsive styles** (mobile viewport, default 375×812):
   - Resize viewport: `page.setViewportSize({width: 375, height: 812})`
   - Re-extract computed styles
   - Write responsive overrides as media query in a `<style>` block:
     `@media (max-width: 767px) { #elem123 { font-size: 48px; } }`
   - Use element `id` attributes as selectors (assign unique IDs if needed)
6. **Strip CDN/script/link tags**: Remove `<script>`, `<link>` elements
7. **Remove Tailwind classes**: Strip class tokens matching Tailwind patterns,
   keep non-Tailwind classes (e.g., `blueprint-bg`, `clip-hex`) for the
   preprocessor to resolve
8. **Output**: Clean HTML with:
   - Inline `style` on every element
   - `<style>` block with responsive overrides (keyed by unique IDs)
   - No Tailwind CDN references, no Tailwind class names

### Responsive strategy

Base styles (desktop) go inline. Mobile overrides go in a `<style>` block as
media queries:

```html
<!-- Desktop values inlined -->
<h1 id="hero-heading" style="font-size: 96px; line-height: 96px; ...">

<style>
  @media (max-width: 767px) {
    #hero-heading { font-size: 48px !important; line-height: 43.2px !important; }
  }
</style>
```

`!important` is needed because inline styles have higher specificity than
stylesheet rules. This is the correct use of `!important` — it's the only way
to override inline styles from a stylesheet, which is exactly the semantics
we need (the responsive override MUST beat the desktop inline value).

### Edge cases

| Case | Handling |
|---|---|
| **No Tailwind detected** | Inliner is skipped entirely; pipeline runs as before |
| **Tailwind CDN fails to load** | Warn and fall through — keep original classes; report warning |
| **Element has no computed styles** | Skip (e.g., empty text nodes wrapped in spans) |
| **Element is `display: none`** | Extract styles anyway (it may become visible via JS) |
| **Large pages (500+ elements)** | Process in batches to avoid memory pressure |
| **`<nav>` and `<footer>`** | Handled by existing preprocessor; not a Tailwind concern |
| **Canvas/WebGL elements** | Skip — computed styles not meaningful |

### Performance

Playwright startup adds ~1-2 seconds per conversion. For a batch of pages in
the same project, reuse the browser instance:

```ts
const browser = await chromium.launch();
for (const page of pages) {
  await inlineTailwindStyles(page.html, { browser });
}
await browser.close();
```

## Output Contract

After inlining, the HTML passed to `preprocess()`:

1. Has NO Tailwind class names on any element
2. Has inline `style=""` on every element with fully resolved CSS
3. Has a single `<style>` block with responsive overrides (if responsive capture enabled)
4. Retains non-Tailwind custom class names (e.g., `blueprint-bg`, `clip-hex`)
5. Renders **pixel-identically** to the original page at both desktop and mobile viewports

## Verification

### Automated check

After conversion, take screenshots at 1440px and 375px of both:
- The original HTML (with Tailwind CDN)
- The inlined HTML (no Tailwind CDN)

Compare pixel diffs. Target: 0% deviation at both viewports.

### Manual check

Open `output/<project>/index-inlined.html` in a browser. Toggle between the
original and inlined versions. Confirm no visual differences at any breakpoint.

## Dependencies

- `playwright` (added to `package.json` devDependencies)
- Chromium browser (installed via `npx playwright install chromium`)

## Files

| File | Purpose |
|---|---|
| `src/core/tailwind-inliner.ts` | Main inliner module |
| `src/core/tailwind-inliner.test.ts` | Unit tests with Playwright |
| `src/core/orchestrator.ts` | Add inliner call before preprocess |
| `src/core/dom-walker.ts` | Remove line 413-414 (Tailwind class preservation) |
| `package.json` | Add `playwright` to devDependencies |

## Non-Goals

- Real-time state extraction (hover, focus, active) — the inline styles reflect
  the default state. Hover/focus states are captured via `:hover`/`:focus`
  pseudo-class extraction during the extraction pass, not by simulating user
  interaction on every element.
- Tailwind v4 JIT mode — the inliner relies on the compiled output. If Tailwind
  CDN is used (v3), it works. Custom build setups may need a different CDN wait
  strategy.
- PostCSS/Tailwind CLI compilation during inlining — the browser handles
  compilation at page load. No server-side Tailwind build step needed.
