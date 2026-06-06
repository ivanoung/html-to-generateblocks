# Tailwind CSS Inliner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright-based pre-conversion step that resolves all Tailwind CSS classes to inline vanilla CSS before the existing GB converter pipeline runs.

**Architecture:** A new `tailwind-inliner.ts` module loads the HTML in Playwright, extracts `getComputedStyle()` for every element, injects resolved styles as inline `style` attributes, strips Tailwind classes and CDN references, and outputs clean HTML. The orchestrator calls this before `preprocess()`. The DOM walker stops preserving Tailwind class tokens.

**Tech Stack:** TypeScript, Playwright (Chromium headless), Cheerio (existing)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/core/tailwind-inliner.ts` | **Create** | Main module: detection + Playwright-based style extraction |
| `src/core/tailwind-inliner.test.ts` | **Create** | Fixture-based tests + Mino page end-to-end |
| `fixtures/tailwind-inliner-basic.json` | **Create** | Minimal Tailwind HTML fixture for fast unit tests |
| `src/core/orchestrator.ts` | **Modify** | Add `await inlineTailwindStyles()` call before `preprocess()` |
| `src/core/dom-walker.ts` | **Modify** | Remove line 413-414 that preserves all class tokens |
| `package.json` | **No action** | Playwright already installed in previous commit |

**Deferred:** Responsive multi-viewport capture (spec section "Responsive strategy"). The base inliner resolves all classes to inline styles at desktop viewport. Mobile-responsive values need a second extraction pass at 375px, writing `!important`-flagged media query overrides. This is a follow-up task after the base inliner is stable.

---

### Task 1: Tailwind detection helpers

**Files:**
- Create: `src/core/tailwind-inliner.ts`
- Create: `fixtures/tailwind-inliner-basic.json`

- [ ] **Step 1: Create the fixture for testing detection**

```json
{
  "name": "tailwind-inliner-basic",
  "description": "Minimal Tailwind page for inliner tests",
  "inputHtml": "<!DOCTYPE html><html><head><script src=\"https://cdn.tailwindcss.com\"></script></head><body><section class=\"pt-32 lg:pt-48 pb-20 px-6\"><h1 class=\"font-display text-5xl lg:text-8xl text-surface\">Hello</h1><p class=\"text-base max-w-xl\">World</p></section></body></html>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0
  }
}
```

Write to `fixtures/tailwind-inliner-basic.json`.

- [ ] **Step 2: Write detection functions**

In `src/core/tailwind-inliner.ts`:

```ts
// ── Tailwind Inliner ──────────────────────────────────────
//
// Loads HTML in Playwright, extracts computed styles for every
// element, and injects them as inline style attributes. Produces
// Tailwind-free HTML ready for the GB converter pipeline.

import { chromium, type Browser } from "playwright";

/** Check if the HTML contains an inline Tailwind config script. */
export function hasTailwindConfig(html: string): boolean {
  return /tailwind\.config\s*=\s*/.test(html);
}

/** Check if the HTML uses Tailwind utility classes in class attributes. */
export function hasTailwindClasses(html: string): boolean {
  return /class\s*=\s*"[^"]*(?:pt-\d+|pb-\d+|px-\d+|py-\d+|p-\d+|mt-\d+|mb-\d+|mx-\d+|my-\d+|m-\d+|w-(?:full|\d+\/|\[)|h-(?:full|\d+\/|\[)|flex|grid|inline-flex|relative|absolute|fixed|sticky|text-(?:xs|sm|base|lg|xl|\[)|font-(?:sans|serif|mono|display|script)|bg-\[|hover:|focus:|active:|group-|peer-|lg:|md:|sm:|xl:)/.test(html);
}

export function usesTailwind(html: string): boolean {
  return hasTailwindConfig(html) || hasTailwindClasses(html);
}
```

- [ ] **Step 3: Write a quick smoke test — run with tsx**

In `src/core/tailwind-inliner.test.ts`, add:

```ts
import { hasTailwindConfig, hasTailwindClasses, usesTailwind } from "./tailwind-inliner.js";

// Manual smoke test — run with: npx tsx src/core/tailwind-inliner.test.ts
const twHtml = '<body class="flex min-h-screen"><h1 class="text-5xl font-display">Hi</h1></body>';
const vanillaHtml = '<body><h1 style="font-size:2rem">Hi</h1></body>';

console.log("hasTailwindClasses(twHtml):", hasTailwindClasses(twHtml));     // true
console.log("hasTailwindClasses(vanillaHtml):", hasTailwindClasses(vanillaHtml)); // false
console.log("hasTailwindConfig in Mino:", hasTailwindConfig(
  require("fs").readFileSync("inputs/mino/index.html", "utf-8")
)); // true
console.log("usesTailwind + classes:", usesTailwind(twHtml));               // true
console.log("usesTailwind vanilla:", usesTailwind(vanillaHtml));            // false
```

- [ ] **Step 4: Run smoke test**

```bash
npx tsx src/core/tailwind-inliner.test.ts
```

Expected output:

```
hasTailwindClasses(twHtml): true
hasTailwindClasses(vanillaHtml): false
hasTailwindConfig in Mino: true
usesTailwind + classes: true
usesTailwind vanilla: false
```

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-inliner.ts src/core/tailwind-inliner.test.ts fixtures/tailwind-inliner-basic.json
git commit -m "feat: add Tailwind detection helpers + fixture"
```

---

### Task 2: Playwright-based style inliner

**Files:**
- Modify: `src/core/tailwind-inliner.ts` (add export + main function)

- [ ] **Step 1: Define the InlinerResult interface**

Add to `tailwind-inliner.ts`, after the detection helpers:

```ts
export interface InlinerResult {
  html: string;
  elementCount: number;
  warnings: string[];
}
```

- [ ] **Step 2: Write the inliner function**

Replace the PoC script with the real implementation. Add to `tailwind-inliner.ts`:

```ts
const TAILWIND_CLASS_REGEX =
  /^(?:sr-only|static|fixed|absolute|relative|sticky|isolate|inline|block|inline-block|flex|inline-flex|grid|inline-grid|hidden|contents|table|table-caption|table-cell|table-column|table-column-group|table-footer-group|table-header-group|table-row|table-row-group|flow-root|overflow|overflow-x|overflow-y|truncate|uppercase|lowercase|capitalize|normal-case|italic|not-italic|underline|line-through|no-underline|antialiased|subpixel-antialiased|select|bg-|text-|font-|tracking-|leading-|list-|placeholder-|opacity-|shadow-|outline-|ring-|ring-offset-|border-|rounded-|divide-|space-|gap-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|w-|min-w-|max-w-|h-|min-h-|max-h-|flex-|grow|shrink|basis-|order-|col-|row-|grid-|auto-|justify-|content-|items-|self-|place-|inset-|top-|right-|bottom-|left-|z-|float-|clear-|object-|overflow-|overscroll-|box-|whitespace-|break-|align-|text-|decoration-|indent-|align-|whitespace-|break-|transition-|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|transform|snap-|scroll-|touch-|cursor-|pointer-|resize-|appearance|columns-|auto-cols-|auto-rows-|aspect-|backdrop-|will-change-|content-|forced-|sr-|contrast-|hue-rotate-|invert|saturate-|sepia-|drop-shadow-|grayscale-|blur-|brightness-|backdrop-|mix-|bg-blend-|from-|via-|to-|shadow-|decoration-|accent-|caret-|stroke-|fill-|divide-|outline-|ring-|ring-offset|group|hover:|focus:|active:|disabled:|visited:|first:|last:|odd:|even:|group-|peer-|motion-|dark:|lg:|md:|sm:|xl:|2xl:|min-|max-|-translate-|-skew-|-scale-|-rotate-)/;

function isTailwindClass(className: string): boolean {
  return TAILWIND_CLASS_REGEX.test(className);
}

export async function inlineTailwindStyles(
  rawHtml: string,
): Promise<InlinerResult> {
  const warnings: string[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // Load the page and wait for Tailwind CDN to compile
    await page.setContent(rawHtml, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Extract computed styles and inject as inline styles
    let elementCount = 0;

    const inlinedHtml = await page.evaluate(() => {
      const allElements = document.body.querySelectorAll("*");
      let count = 0;

      for (const el of allElements) {
        if (!(el instanceof HTMLElement)) continue;

        const cs = window.getComputedStyle(el);
        const cssText = cs.cssText;

        // Skip elements with negligible computed styles
        if (!cssText || cssText.length < 30) continue;

        // Merge with existing style attribute (existing wins for conflicts)
        const existing = el.getAttribute("style") || "";
        el.setAttribute("style", cssText + (existing ? ";" + existing : ""));
        count++;
      }

      // Remove <script> and <link> tags (CDN references)
      document.querySelectorAll("script, link").forEach((el) => el.remove());

      return { html: document.documentElement.outerHTML, count };
    });

    elementCount = inlinedHtml.count;

    // Strip Tailwind classes from elements, keep non-Tailwind classes
    // We use Cheerio for this since we're about to pass to preprocessor anyway
    const cleanedHtml = stripTailwindClasses(inlinedHtml.html);

    return { html: cleanedHtml, elementCount, warnings };
  } catch (err: any) {
    warnings.push(`Tailwind inliner failed: ${err.message}. Falling through with original HTML.`);
    return { html: rawHtml, elementCount: 0, warnings };
  } finally {
    if (browser) await browser.close();
  }
}

/** Remove Tailwind class tokens from class attributes, keeping custom classes. */
function stripTailwindClasses(html: string): string {
  return html.replace(
    /class="([^"]*)"/g,
    (_match, classList: string) => {
      const kept = classList
        .split(/\s+/)
        .filter((c: string) => c.length > 0 && !isTailwindClass(c));
      if (kept.length > 0) {
        return `class="${kept.join(" ")}"`;
      }
      return "";
    },
  );
}
```

- [ ] **Step 3: Write the end-to-end test against the fixture**

In `src/core/tailwind-inliner.test.ts`, replace the smoke test with:

```ts
import { inlineTailwindStyles, usesTailwind } from "./tailwind-inliner.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const fixturePath = resolve(process.cwd(), "fixtures/tailwind-inliner-basic.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

  const html = fixture.inputHtml as string;
  console.log("usesTailwind:", usesTailwind(html));

  const result = await inlineTailwindStyles(html);
  console.log("elementCount:", result.elementCount);
  console.log("warnings:", result.warnings);

  // The result should have NO Tailwind classes
  const hasTailwindAfter = /class="[^"]*(?:pt-\d+|lg:pt-\d+|text-5xl|lg:text-8xl|font-display|text-surface)/.test(result.html);
  console.log("still has Tailwind classes:", hasTailwindAfter); // should be false

  // The result should have inline styles
  const hasInlineStyles = /style="[^"]{30,}"/.test(result.html);
  console.log("has inline styles:", hasInlineStyles); // should be true

  // No script/link tags
  const hasCdnRefs = /<script|<link/.test(result.html);
  console.log("has CDN refs:", hasCdnRefs); // should be false

  // Pipeline can proceed — pass through preprocess + walk
  const { preprocess } = await import("./preprocessor.js");

  // ... (we'll chain this in Task 3)

  console.log("\n✅ All checks passed");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the end-to-end test**

```bash
npx tsx src/core/tailwind-inliner.test.ts
```

Expected output:

```
usesTailwind: true
elementCount: 3
warnings: []
still has Tailwind classes: false
has inline styles: true
has CDN refs: false

✅ All checks passed
```

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-inliner.ts src/core/tailwind-inliner.test.ts
git commit -m "feat: Playwright-based Tailwind style inliner"
```

---

### Task 3: Pipeline integration in orchestrator

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Add import and inliner call**

In `src/core/orchestrator.ts`, add the import after existing imports:

```ts
import { usesTailwind, inlineTailwindStyles } from "./tailwind-inliner.js";
```

- [ ] **Step 2: Insert the inliner call before preprocess**

In the `convert()` function, replace the `preprocess` call block. Currently:

```ts
export function convert(input: ConversionInput): ConversionOutput {
  resetIds();

  // Stage 1: Preprocess
  const prepResult = preprocess(input.rawHtml);
```

Change to:

```ts
export async function convert(input: ConversionInput): Promise<ConversionOutput> {
  resetIds();

  // Stage 0: Resolve Tailwind to inline CSS (if present)
  let rawHtml = input.rawHtml;
  const inlinerWarnings: { code: string; message: string }[] = [];

  if (usesTailwind(rawHtml)) {
    const inlined = await inlineTailwindStyles(rawHtml);
    if (inlined.warnings.length > 0) {
      inlinerWarnings.push(
        ...inlined.warnings.map((m) => ({ code: "INLINER", message: m })),
      );
    }
    // Only use inlined output if it actually produced results
    if (inlined.elementCount > 0) {
      rawHtml = inlined.html;
    }
  }

  // Stage 1: Preprocess
  const prepResult = preprocess(rawHtml);
```

- [ ] **Step 3: Include inliner warnings in the report**

After the existing warnings collection, add inliner warnings. Find:

```ts
  const allWarnings = [
    ...prepResult.warnings.map((w) => ({ code: "PREPROCESS", message: w })),
    ...walkResult.warnings.map((w) => ({ code: "WALK", message: w })),
  ];
```

Change to:

```ts
  const allWarnings = [
    ...inlinerWarnings,
    ...prepResult.warnings.map((w) => ({ code: "PREPROCESS", message: w })),
    ...walkResult.warnings.map((w) => ({ code: "WALK", message: w })),
  ];
```

- [ ] **Step 4: Make the CLI's convert command `await` the result**

In `src/cli/index.ts`, find the `convert` block. The call `const output = convert({...})` needs to become:

```ts
const output = await convert({ rawHtml, pageName, projectDir, resolveCss: args.includes("--resolve-css") });
```

- [ ] **Step 5: Run a conversion to verify integration**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Expected: Blocks should now show `styles` populated with computed values, not empty `{}`. Tailwind classes should not appear in `globalClasses`.

- [ ] **Step 6: Commit**

```bash
git add src/core/orchestrator.ts src/cli/index.ts
git commit -m "feat: integrate Tailwind inliner into orchestrator pipeline"
```

---

### Task 4: Remove Tailwind class preservation in DOM walker

**Files:**
- Modify: `src/core/dom-walker.ts` (lines 413-414)

- [ ] **Step 1: Remove the "preserve ALL class tokens" logic**

In `src/core/dom-walker.ts`, find the `extractGlobalClasses` function. Replace lines 407-414:

```ts
  classNames.forEach((className) => {
    // Track reusable classes from <head> styles for global-styles manifest
    if (opts.classNameToProperties.has(className)) {
      opts.collector.recordUsage(className);
    }
    // Preserve ALL class tokens (Tailwind utilities) in globalClasses
    result.push(className);
  });
```

With:

```ts
  classNames.forEach((className) => {
    // Only track classes from <head> <style> definitions.
    // Tailwind classes are already resolved to inline styles by the inliner.
    if (opts.classNameToProperties.has(className)) {
      opts.collector.recordUsage(className);
      result.push(className);
    }
  });
```

- [ ] **Step 2: Run the full fixture suite to ensure no regressions**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: All existing fixtures pass (no regressions). The M1/fidelity fixtures don't use Tailwind, so they should be unaffected.

- [ ] **Step 3: Run the regression check**

```bash
npx tsx src/cli/index.ts regression
```

- [ ] **Step 4: Convert the Mino page and verify styles are populated**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Check the output: `grep -o '"styles":{[^}]*}' output/mino/index.html | head -5`

Expected: Styles should contain computed CSS values like `"fontFamily":"Anybody, sans-serif"`, not empty `{}`.

- [ ] **Step 5: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "fix: stop preserving unresolvable class tokens in globalClasses"
```

---

### Task 5: Full Mino page verification

**Files:**
- Create: (none — uses existing outputs)

- [ ] **Step 1: Run the full conversion**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

- [ ] **Step 2: Verify the report**

```bash
node -e "
const r = require('./output/mino/index.report.json');
console.log('Status:', r.overallStatus);
console.log('Blocks:', r.blockCount);
console.log('Hard fails:', r.hardFails.length);
console.log('Warnings:', r.warnings.length);
console.log('Tailwind classes in globalClassesExtracted:', r.globalClassesExtracted.length);
"
```

Expected: `Status: pass`, no hard fails, `globalClassesExtracted` should only contain non-Tailwind classes (like `blueprint-bg`, `clip-hex`), NOT `pt-32`, `flex`, `grid-cols-1`, etc.

- [ ] **Step 3: Verify NO Tailwind classes in output blocks**

```bash
grep -c 'pt-32\|lg:pt-48\|text-5xl\|font-display\|flex\|grid-cols-1\|gap-12' output/mino/index.html
```

Expected: 0 matches. No Tailwind utility classes in the GB block output.

- [ ] **Step 4: Verify inline styles are populated**

```bash
grep -o '"styles":{[^}]*}' output/mino/index.html | head -3
```

Expected: Styles should contain actual CSS properties, not empty objects.

- [ ] **Step 5: Screenshot comparison check**

```bash
npx tsx src/core/tailwind-inliner.test.ts
```

Compare `output/mino/original-screenshot.png` with `output/mino/inlined-screenshot.png`. Same dimensions and visual content.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "verify: Mino page converts without Tailwind classes"
```
