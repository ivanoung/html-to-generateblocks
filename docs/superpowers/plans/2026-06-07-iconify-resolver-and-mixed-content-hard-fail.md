# Iconify Resolver & Mixed Content Hard-Fail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate spurious `core/html` fallback blocks by resolving `<iconify-icon>` to SVG and making mixed-content a hard fail instead of silent fallback.

**Architecture:** New `iconify-resolver.ts` module inserted between the Tailwind inliner and preprocessor. DOM walker changed to emit `FIX_SOURCE` hard fails instead of silently wrapping mixed-content divs in `core/html`. Extended `WalkResult` carries hard fails from walker to orchestrator.

**Tech Stack:** TypeScript, cheerio, Node.js native `fetch`, ESM

---

## File Structure

| File | Role |
|---|---|
| `src/core/iconify-resolver.ts` | **Create.** Fetches SVG from Iconify API, replaces `<iconify-icon>` |
| `src/core/dom-walker.ts` | **Modify.** Hard fail for mixed content, extend `WalkResult` |
| `src/core/orchestrator.ts` | **Modify.** Insert resolver call, merge walker hard fails |
| `README.md` | **Modify.** Add Pre-Conversion Checklist section |

---

### Task 1: Create the Iconify Resolver module

**Files:**
- Create: `src/core/iconify-resolver.ts`

- [ ] **Step 1: Write the module skeleton**

```typescript
// ── Iconify Resolver ─────────────────────────────────────────
//
// Finds <iconify-icon> elements in HTML, fetches their SVG
// markup from the Iconify API, and replaces them in-place.
// Inserted between the Tailwind inliner and preprocessor
// in the convert pipeline.
//
// Caches SVGs in-memory per invocation. Falls back to
// leaving the tag if the API is unreachable — the
// preprocessor wraps unresolved tags in core/html.

import * as cheerio from "cheerio";

export interface IconifyResult {
  html: string;
  resolved: number;
  failed: string[];  // icon names that couldn't be resolved
}

const ICONIFY_API = "https://api.iconify.design";
const FETCH_TIMEOUT_MS = 5000;

export async function resolveIconifyIcons(rawHtml: string): Promise<IconifyResult> {
  const failed: string[] = [];
  let resolved = 0;

  const $ = cheerio.load(rawHtml);
  const icons = $("iconify-icon").toArray();

  if (icons.length === 0) {
    return { html: rawHtml, resolved: 0, failed: [] };
  }

  // In-memory cache for this invocation
  const cache = new Map<string, string>();

  for (const el of icons) {
    const $el = $(el);
    const iconAttr = ($el.attr("icon") || "").trim();

    if (!iconAttr) {
      failed.push("(missing icon attribute)");
      continue;
    }

    const colonIdx = iconAttr.indexOf(":");
    if (colonIdx === -1) {
      failed.push(iconAttr);
      continue;
    }

    const prefix = iconAttr.substring(0, colonIdx);
    const name = iconAttr.substring(colonIdx + 1);
    const cacheKey = `${prefix}:${name}`;

    try {
      let svgText: string;

      if (cache.has(cacheKey)) {
        svgText = cache.get(cacheKey)!;
      } else {
        const url = `${ICONIFY_API}/${prefix}/${name}.svg`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          failed.push(cacheKey);
          continue;
        }

        svgText = await response.text();
        cache.set(cacheKey, svgText);
      }

      // Transfer attributes from <iconify-icon> to <svg>
      const $svg = cheerio.load(svgText)("svg");
      if ($svg.length === 0) {
        failed.push(cacheKey);
        continue;
      }

      // Copy width, height, class, style from iconify-icon
      const width = $el.attr("width");
      const height = $el.attr("height");
      const cls = $el.attr("class");
      const style = $el.attr("style");

      if (width && !$svg.attr("width")) $svg.attr("width", width);
      if (height && !$svg.attr("height")) $svg.attr("height", height);
      if (cls) {
        const existingClass = $svg.attr("class") || "";
        $svg.attr("class", [existingClass, cls].filter(Boolean).join(" "));
      }
      if (style) {
        const existingStyle = $svg.attr("style") || "";
        $svg.attr("style", [existingStyle, style].filter(Boolean).join(";"));
      }

      // Replace <iconify-icon> with <svg>
      $el.replaceWith($.html($svg));
      resolved++;
    } catch {
      // Network error, timeout, or invalid SVG — leave tag as-is
      failed.push(cacheKey);
    }
  }

  // Return the modified HTML (entire document, not just body)
  return {
    html: $.html(),
    resolved,
    failed,
  };
}
```

- [ ] **Step 2: Verify the module compiles**

```bash
npx tsx --eval "import { resolveIconifyIcons } from './src/core/iconify-resolver.js'; console.log('OK')"
```

Expected: `OK` (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/core/iconify-resolver.ts
git commit -m "feat: add iconify-resolver module"
```

---

### Task 2: Extend WalkResult with hard fails

**Files:**
- Modify: `src/core/dom-walker.ts` (the `WalkResult` interface and `walkDom` function)

- [ ] **Step 1: Add `hardFails` field to `WalkResult`**

In `src/core/dom-walker.ts`, find the `WalkResult` interface near the bottom and add the field:

```typescript
export interface WalkResult {
  blocks: Block[];
  warnings: string[];
  hardFails: { code: string; message: string }[];
}
```

- [ ] **Step 2: Initialize `hardFails` in the `walkDom` entry point**

In the `walkDom` function, initialize the array and pass it through options:

```typescript
export function walkDom(
  html: string,
  classNameToProperties: Map<string, BlockStyles>,
  collector: GlobalStylesCollector,
): WalkResult {
  const warnings: string[] = [];
  const hardFails: { code: string; message: string }[] = [];
  const $ = cheerio.load(`<div>${html}</div>`);

  const opts: WalkerOptions = { classNameToProperties, collector, warnings, hardFails };
  const blocks: Block[] = [];

  const $wrapper = $("body > div, div").first();
  if ($wrapper.length > 0) {
    $wrapper.children().each((_, el) => {
      const tag = (el as any).name?.toLowerCase() || "";
      if (tag === "nav" || tag === "footer" || tag === "script" || tag === "style") return;

      const $el = $(el);
      blocks.push(...walkElement($el, $, opts));
    });
  }

  return { blocks, warnings, hardFails };
}
```

- [ ] **Step 3: Add `hardFails` to `WalkerOptions` interface**

At the top of the file, add the field:

```typescript
interface WalkerOptions {
  classNameToProperties: Map<string, BlockStyles>;
  collector: GlobalStylesCollector;
  warnings: string[];
  hardFails: { code: string; message: string }[];
}
```

- [ ] **Step 4: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "feat: extend WalkResult with hardFails array"
```

---

### Task 3: Replace silent fallback with hard fail (Path 3 + 4)

**Files:**
- Modify: `src/core/dom-walker.ts` (the `walkElement` function)

- [ ] **Step 1: Add text preview helper**

At the top of dom-walker.ts, add after the imports:

```typescript
/** Extract first 60 chars of text from element for error messages */
function textPreview($el: cheerio.Cheerio<any>): string {
  const text = ($el.text() || "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? text.substring(0, 60) + "…" : text;
}
```

- [ ] **Step 2: Replace Path 3 — div with text + block children**

Find the block in `walkElement` that handles mixed content (around line 100-103). Replace:

**Old:**
```typescript
  if (hasBlockChildren && hasTextOrInline) {
    return makeCoreHtmlFallback($el, $, opts.warnings, tag);
  }
```

**New:**
```typescript
  if (hasBlockChildren && hasTextOrInline) {
    // Only div gets the hard fail — other tags may have valid mixed patterns
    if (tag === "div") {
      opts.hardFails.push({
        code: "FIX_SOURCE",
        message: `<${tag}> contains raw text mixed with block children. Wrap bare text in <span> or <p>. "${textPreview($el)}"`,
      });
      return []; // skip the element — produce no blocks
    }
    return makeCoreHtmlFallback($el, $, opts.warnings, tag);
  }
```

- [ ] **Step 3: Replace Path 4 — semantic container with only text**

Find the block that handles semantic containers with only text (around line 106-113). Replace:

**Old:**
```typescript
  if (!hasBlockChildren && (hasMeaningfulText || hasInlineElements)) {
    if (SEMANTIC_CONTAINER_TAGS.has(tag)) {
      // Container with only text/inline → core/html fallback
      return makeCoreHtmlFallback($el, $, opts.warnings, tag);
    }
    return [makeTextBlock($el, $, opts)];
  }
```

**New:**
```typescript
  if (!hasBlockChildren && (hasMeaningfulText || hasInlineElements)) {
    if (SEMANTIC_CONTAINER_TAGS.has(tag)) {
      opts.hardFails.push({
        code: "FIX_SOURCE",
        message: `<${tag}> contains only raw text/inline content. Wrap text in <p> or other block tag. "${textPreview($el)}"`,
      });
      return []; // skip the element — produce no blocks
    }
    return [makeTextBlock($el, $, opts)];
  }
```

- [ ] **Step 4: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Run existing fixtures to check for regressions**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: All previously passing fixtures still pass. Some may show new `FIX_SOURCE` hard fails if their test HTML had mixed content — those need fixture updates.

- [ ] **Step 6: If any fixtures break, update their expected values**

Check which fixtures failed and whether the `FIX_SOURCE` is correct for their input. If a fixture intentionally had mixed content, update its `expect.hardFailCount` and add `"FIX_SOURCE"` to `expect.warningCodes`. If the fixture was correct and the walker is wrong, fix the walker logic.

- [ ] **Step 7: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "feat: hard-fail mixed content instead of silent core/html fallback"
```

---

### Task 4: Integrate iconify resolver into orchestrator

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Import the resolver**

At the top of `src/core/orchestrator.ts`, add the import:

```typescript
import { resolveIconifyIcons } from "./iconify-resolver.js";
```

Place it after the existing imports.

- [ ] **Step 2: Insert resolver call between Stage 0 and Stage 1**

Find the orchestrator's `convert` function. After Stage 0 (Tailwind inliner) and before Stage 1 (Preprocess), insert the resolver:

```typescript
  // Stage 0: Compile Tailwind CSS (if present)
  let rawHtml = input.rawHtml;
  const inlinerWarnings: { code: string; message: string }[] = [];
  let compiledCss = "";

  if (usesTailwind(rawHtml)) {
    const compiled = await inlineTailwindStyles(rawHtml);
    if (compiled.warnings.length > 0) {
      inlinerWarnings.push(
        ...compiled.warnings.map((m) => ({ code: "INLINER", message: m })),
      );
    }
    compiledCss = compiled.stylesCss;
  }

  // Stage 0.5: Resolve <iconify-icon> to SVG
  const iconifyResult = await resolveIconifyIcons(rawHtml);
  rawHtml = iconifyResult.html;
  if (iconifyResult.failed.length > 0) {
    inlinerWarnings.push({
      code: "ICONIFY",
      message: `Could not resolve ${iconifyResult.failed.length} icon(s): ${iconifyResult.failed.join(", ")}`,
    });
  }

  // Stage 1: Preprocess
  const prepResult = preprocess(rawHtml);
```

- [ ] **Step 3: Merge walker hard fails into report**

Find where the report is built (where `hardFails` from `validateBlocks` is used). Merge the walker's hard fails:

```typescript
  // Stage 5: Validate
  const { hardFails: validatorHardFails, warnings: valWarnings } = validateBlocks(
    walkResult.blocks,
    html,
  );

  // Merge walker hard fails with validator hard fails
  const hardFails = [
    ...validatorHardFails,
    ...walkResult.hardFails,
  ];

  // Build report
  const report = {
    page: input.pageName,
    blockCount,
    hardFails: hardFails.map((f) => ({ code: f.code, message: f.message })),
    warnings: [
      ...allWarnings,
      ...valWarnings.map((w) => ({ code: w.code, message: w.message })),
    ],
    overallStatus: hardFails.length > 0 ? "partial" : "pass",
    customCssRequired: prepResult.customCss.length > 0,
    globalClassesExtracted: collector
      .toManifest()
      .classes.map((c) => c.slug),
    strippedElements: prepResult.warnings
      .filter((w) => w.startsWith("Stripped"))
      .map((w) => w.replace("Stripped ", "").replace(" element(s)", "")),
  };
```

Note: Replace the existing `hardFails` variable name from `validateBlocks` destructuring with `validatorHardFails`, and create a new merged `hardFails` array.

- [ ] **Step 4: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: integrate iconify resolver + merge walker hard fails"
```

---

### Task 5: Test the full pipeline end-to-end

**Files:**
- Create: `fixtures/fidelity-iconify-resolved.json`

- [ ] **Step 1: Create fidelity fixture for iconify resolution**

Create `fixtures/fidelity-iconify-resolved.json`:

```json
{
  "name": "fidelity-iconify-resolved",
  "description": "<iconify-icon> resolved to <svg> by iconify resolver",
  "inputHtml": "<main><div><iconify-icon icon=\"lucide:rocket\" width=\"18\"></iconify-icon></div></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 2
  }
}
```

- [ ] **Step 2: Run the fixture**

```bash
npx tsx src/cli/index.ts fixtures:run fidelity-iconify-resolved
```

Expected: The `<iconify-icon>` is resolved to an `<svg>` and produces a `generateblocks/shape` block inside a `generateblocks/element` wrapper (2 blocks total). No hard fails.

If the Iconify API is unreachable, the icon won't be resolved — the test may produce a `core/html` wrapper instead. This is acceptable for now (network-dependent test).

- [ ] **Step 3: Create fidelity fixture for mixed-content hard fail**

Create `fixtures/fidelity-mixed-content-hard-fail.json`:

```json
{
  "name": "fidelity-mixed-content-hard-fail",
  "description": "Div with raw text + block children → FIX_SOURCE hard fail",
  "inputHtml": "<main><section><h1>Good Heading</h1><div>Bare text<h2>Block child</h2></div></section></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 1,
    "blockCount": 1
  }
}
```

- [ ] **Step 4: Run the fixture**

```bash
npx tsx src/cli/index.ts fixtures:run fidelity-mixed-content-hard-fail
```

Expected: 1 hard fail (`FIX_SOURCE`), 1 block (the `<h1>` — the mixed-content `<div>` is skipped).

- [ ] **Step 5: Run all fixtures to check for regressions**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: All previously passing fixtures still pass. Any that now show `FIX_SOURCE` hard fails need fixture updates.

- [ ] **Step 6: Commit fixtures**

```bash
git add fixtures/fidelity-iconify-resolved.json fixtures/fidelity-mixed-content-hard-fail.json
git commit -m "test: add fidelity fixtures for iconify resolver and mixed-content hard fail"
```

---

### Task 6: Re-run MINO conversion to verify fixes

**Files:** None (verification only)

- [ ] **Step 1: Clear previous output**

```bash
rm -rf output/mino/ && mkdir -p output/mino/
```

- [ ] **Step 2: Run project setup**

```bash
npx tsx src/cli/index.ts project:setup inputs/mino/
```

- [ ] **Step 3: Convert index.html**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html --skip-shared
```

- [ ] **Step 4: Convert fast-seo.html**

```bash
npx tsx src/cli/index.ts convert inputs/mino/fast-seo.html --skip-shared
```

- [ ] **Step 5: Compare results**

Check the reports for both pages:

```bash
cat output/mino/index.report.json | python3 -m json.tool | head -20
cat output/mino/fast-seo.report.json | python3 -m json.tool | head -20
```

Expected improvements:
- `fast-seo.html`: `core/html` block count drops from 134 to ~40. `FIX_SOURCE` hard fails appear for mixed-content divs.
- `index.html`: `core/html` block count drops from 46 to ~15.
- Both reports may show `overallStatus: "partial"` if FIX_SOURCE hard fails exist — this is correct (source needs cleanup).

- [ ] **Step 6: Verify no stray `STRAY_HTML_COMMENTS` errors from iconify removals**

```bash
grep -c 'STRAY_HTML_COMMENTS' output/mino/fast-seo.report.json
```

Expected: Same or fewer than before (iconify resolution doesn't add comments).

---

### Task 7: Update README with Pre-Conversion Checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Pre-Conversion Checklist section**

Insert before the "Quick Start" section in README.md:

```markdown
## Pre-Conversion Checklist

Before running `convert` on an HTML page, clean the source to avoid
`FIX_SOURCE` hard fails. Run this prompt with your AI assistant:

> Scan all HTML files. Find any element (section, article, aside, header,
> main, div) where raw text sits at the same level as block children — i.e.,
> text not wrapped in `<p>`, `<span>`, `<h1>`–`<h6>`, or other tags. For
> each, wrap the bare text in the smallest appropriate tag: `<span>` for
> short inline phrases, `<p>` for sentences and paragraphs. Do not touch
> elements where all text is already properly wrapped. Show each change
> as a diff before applying.

### Marker System

Add `data-gb-wrap="core-html"` to any element you want preserved as raw
HTML in the output (not decomposed into GB blocks):

```html
<div data-gb-wrap="core-html">
  <!-- This entire div stays as raw HTML in a core/html block -->
  <custom-chart data-source="analytics"></custom-chart>
  <script type="application/json">{"key": "value"}</script>
</div>
```

### Iconify Icons

`<iconify-icon>` elements are automatically resolved to inline SVGs during
conversion. No manual action needed. If an icon can't be resolved (API
downtime, invalid name), the converter falls back to wrapping it in a
`core/html` block.

```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add pre-conversion checklist, marker system, and iconify notes"
```

---

### Task 8: Final verification suite

- [ ] **Step 1: Run full regression**

```bash
npx tsx src/cli/index.ts regression
```

Expected: All M1 snapshots match.

- [ ] **Step 2: Run all fixtures**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: All fixtures pass (including new fidelity fixtures).

- [ ] **Step 3: TypeScript compilation check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Final commit if any cleanup needed**
