# Self-Verification Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `render` and `compare` CLI commands that produce standalone HTML from GB block output, screenshot both source and rendered pages, and produce pixel-diff comparison images for agent-driven self-verification.

**Architecture:** Three new core modules — `renderer.ts` (block parsing, CSS derivation, HTML wrapping), `screenshotter.ts` (Playwright full-page capture with wait strategy), `pixel-differ.ts` (pixel comparison with tolerance, diff image generation). Two new CLI subcommands wired into the existing `src/cli/index.ts`.

**Tech Stack:** TypeScript, Playwright (already a dependency), Node.js `fs`/`path`, Cheerio (already a dependency), `sharp` (new dependency for image diff/resize).

---

## File Structure

```
src/core/
├── renderer.ts           # NEW: Parse delimiters, derive CSS from attrs, inject CSS, wrap HTML
├── screenshotter.ts      # NEW: Playwright full-page screenshot with wait strategy
├── pixel-differ.ts       # NEW: Pixel comparison, diff image, mismatch stats

src/cli/
├── index.ts              # MODIFY: Add "render", "compare" subcommands

tests/
├── renderer.test.ts      # NEW
├── screenshotter.test.ts # NEW
├── pixel-differ.test.ts  # NEW
├── compare.test.ts       # NEW: integration test

fixtures/verify/
├── good-simple.html      # NEW: inline-styles-only page for baseline
├── good-simple-output/   # NEW: pre-converted GB output of good-simple.html

package.json              # MODIFY: add sharp dependency
```

---

### Task 1: Install sharp dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install sharp**

```bash
npm install sharp
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add sharp dependency for pixel-diff image processing"
```

---

### Task 2: Create verification test fixture

**Files:**
- Create: `fixtures/verify/good-simple.html`
- Create: `fixtures/verify/good-simple-output/pages/index.html`
- Create: `fixtures/verify/good-simple-output/pages/styles.css`
- Create: `fixtures/verify/good-simple-output/setup/styles-unique.css`
- Create: `fixtures/verify/good-simple-output/setup/global-styles.json`

A minimal, inline-styles-only page that converts cleanly and produces known-good GB output. This fixture tests the full render → compare pipeline end-to-end.

- [ ] **Step 1: Create source fixture**

Write `fixtures/verify/good-simple.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Simple Test Page</title>
</head>
<body>
  <section id="hero" style="padding:64px 24px;background:#f7f7f7;text-align:center">
    <h1 style="font-size:2rem;color:#111;margin-bottom:16px">Hello World</h1>
    <p style="font-size:1rem;color:#444">This is a simple test page for verification.</p>
  </section>
  <section id="content" style="padding:48px 24px">
    <h2 style="font-size:1.5rem;color:#333;margin-bottom:8px">Section Title</h2>
    <p style="font-size:1rem;color:#666">Section body text goes here.</p>
  </section>
</body>
</html>
```

- [ ] **Step 2: Create pre-converted GB output**

Write `fixtures/verify/good-simple-output/pages/index.html`:

```
<!-- wp:generateblocks/element {"uniqueId":"elem001","tagName":"section","styles":{"paddingTop":"64px","paddingRight":"24px","paddingBottom":"64px","paddingLeft":"24px","backgroundColor":"#f7f7f7","textAlign":"center"},"css":"","globalClasses":[],"htmlAttributes":{"id":"hero"}} -->
<section class="gb-element-elem001 gb-element" id="hero">
    <!-- wp:generateblocks/text {"uniqueId":"text001","tagName":"h1","content":"Hello World","styles":{"fontSize":"2rem","color":"#111","marginBottom":"16px"},"css":"","globalClasses":[]} -->
    <h1 class="gb-text gb-text-text001">Hello World</h1>
    <!-- /wp:generateblocks/text -->
    <!-- wp:generateblocks/text {"uniqueId":"text002","tagName":"p","content":"This is a simple test page for verification.","styles":{"fontSize":"1rem","color":"#444"},"css":"","globalClasses":[]} -->
    <p class="gb-text gb-text-text002">This is a simple test page for verification.</p>
    <!-- /wp:generateblocks/text -->
</section>
<!-- /wp:generateblocks/element -->
<!-- wp:generateblocks/element {"uniqueId":"elem002","tagName":"section","styles":{"paddingTop":"48px","paddingRight":"24px","paddingBottom":"48px","paddingLeft":"24px"},"css":"","globalClasses":[],"htmlAttributes":{"id":"content"}} -->
<section class="gb-element-elem002 gb-element" id="content">
    <!-- wp:generateblocks/text {"uniqueId":"text003","tagName":"h2","content":"Section Title","styles":{"fontSize":"1.5rem","color":"#333","marginBottom":"8px"},"css":"","globalClasses":[]} -->
    <h2 class="gb-text gb-text-text003">Section Title</h2>
    <!-- /wp:generateblocks/text -->
    <!-- wp:generateblocks/text {"uniqueId":"text004","tagName":"p","content":"Section body text goes here.","styles":{"fontSize":"1rem","color":"#666"},"css":"","globalClasses":[]} -->
    <p class="gb-text gb-text-text004">Section body text goes here.</p>
    <!-- /wp:generateblocks/text -->
</section>
<!-- /wp:generateblocks/element -->
```

- [ ] **Step 3: Create empty CSS files**

```bash
echo "" > fixtures/verify/good-simple-output/pages/styles.css
echo "" > fixtures/verify/good-simple-output/setup/styles-unique.css
echo '[]' > fixtures/verify/good-simple-output/setup/global-styles.json
mkdir -p fixtures/verify/good-simple-output/setup
```

- [ ] **Step 4: Commit**

```bash
git add fixtures/verify/
git commit -m "test: add good-simple verification fixture with pre-converted GB output"
```

---

### Task 3: Renderer — block delimiter parser and CSS derivation

**Files:**
- Create: `src/core/renderer.ts`
- Test: `tests/renderer.test.ts`

The renderer parses block delimiters to extract JSON attributes, derives CSS from promoted GB attributes, strips delimiters, and wraps in a full HTML document.

- [ ] **Step 1: Write failing test**

Write `tests/renderer.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseBlockDelimiters, deriveCssFromAttrs, renderStandalone } from "../src/core/renderer.js";

const SAMPLE_BLOCK = `<!-- wp:generateblocks/element {"uniqueId":"elem001","tagName":"section","styles":{"paddingTop":"64px","backgroundColor":"#f7f7f7"},"css":"","globalClasses":[],"htmlAttributes":{"id":"hero"}} -->
<section class="gb-element-elem001 gb-element" id="hero"><!-- /wp:generateblocks/element -->`;

describe("parseBlockDelimiters", () => {
  it("extracts block JSON from delimiter comments", () => {
    const blocks = parseBlockDelimiters(SAMPLE_BLOCK);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].blockName, "generateblocks/element");
    assert.strictEqual(blocks[0].attrs.uniqueId, "elem001");
    assert.strictEqual(blocks[0].attrs.styles.backgroundColor, "#f7f7f7");
    assert.strictEqual(blocks[0].innerHtml.trim(), '<section class="gb-element-elem001 gb-element" id="hero">');
  });
});

describe("deriveCssFromAttrs", () => {
  it("derives background-color from backgroundColor attribute", () => {
    const attrs = { uniqueId: "elem001", backgroundColor: "#f7f7f7", styles: {}, css: "" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.backgroundColor, "#f7f7f7");
  });

  it("derives bgImage from bgImage attribute (URL)", () => {
    const attrs = { uniqueId: "elem002", bgImage: "https://example.com/bg.jpg", bgImageSize: "cover", styles: {}, css: "" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.backgroundImage, "url(https://example.com/bg.jpg)");
    assert.strictEqual(styleObj.backgroundSize, "cover");
  });

  it("skips properties already present in css string", () => {
    const attrs = { uniqueId: "elem003", backgroundColor: "#f7f7f7", css: "background-color:#fff;" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.backgroundColor, undefined); // already in css, skip
  });

  it("derives gradient from gradient attributes", () => {
    const attrs = {
      uniqueId: "elem004",
      gradient: "linear-gradient",
      gradientDirection: "90deg",
      gradientColorOne: "#ff0000",
      gradientColorTwo: "#0000ff",
      styles: {},
      css: ""
    };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.background, "linear-gradient(90deg,#ff0000,#0000ff)");
  });

  it("returns empty object when no GB attrs to derive", () => {
    const attrs = { uniqueId: "elem005", styles: {}, css: "" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.deepStrictEqual(styleObj, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/renderer.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parseBlockDelimiters**

Write `src/core/renderer.ts`:

```typescript
// ── Renderer ──────────────────────────────────────────────────
//
// Parses GB block markup, derives inline CSS from promoted GB
// attributes, strips delimiters, and injects CSS to produce a
// standalone, self-contained HTML page.

export interface ParsedBlock {
  blockName: string;
  attrs: Record<string, unknown>;
  rawJson: string;
  innerHtml: string;
  fullMatch: string;
}

/**
 * Parse all block delimiters from GB block output.
 * Extracts block JSON attributes and inner HTML.
 * Uses the same delimiter pattern as the validator.
 */
export function parseBlockDelimiters(raw: string): ParsedBlock[] {
  const results: ParsedBlock[] = [];
  // Match <!-- wp:blockname {json} -->
  const openerRegex = /<!--\s*wp:([a-z]+\/[a-z-]+)\s+(\{.*?\})\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = openerRegex.exec(raw)) !== null) {
    const blockName = match[1];
    let rawJson = match[2];
    let attrs: Record<string, unknown>;

    try {
      attrs = JSON.parse(rawJson);
    } catch {
      attrs = {};
    }

    // Find the closing delimiter
    const closeTag = `<!-- /wp:${blockName} -->`;
    const closeIdx = raw.indexOf(closeTag, match.index + match[0].length);
    const innerHtml = closeIdx !== -1
      ? raw.slice(match.index + match[0].length, closeIdx)
      : "";

    results.push({
      blockName,
      attrs,
      rawJson,
      innerHtml,
      fullMatch: closeIdx !== -1
        ? raw.slice(match.index, closeIdx + closeTag.length)
        : match[0],
    });
  }

  return results;
}
```

- [ ] **Step 4: Implement deriveCssFromAttrs**

Append to `src/core/renderer.ts`:

```typescript
/** Properties that may appear in the css string (kebab-case patterns to check) */
const CSS_PROPERTY_CHECK: Record<string, RegExp> = {
  backgroundColor: /background-color\s*:/,
  backgroundImage: /background-image\s*:/,
  color: /(?<!\w)color\s*:/,
  backgroundSize: /background-size\s*:/,
  textColor: /(?<!\w)color\s*:/,
};

/**
 * Derive CSS properties from promoted GB attributes when they're
 * missing from the `css` string. Prevents the "magically appears"
 * problem where WordPress renders styles from attributes but a
 * standalone page would not.
 */
export function deriveCssFromAttrs(attrs: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  const cssStr = (attrs.css as string) || "";

  // Map GB attribute → CSS property, with optional value transform
  const mappings: Array<{ attr: string; cssProp: string; transform?: (v: unknown) => string }> = [
    { attr: "backgroundColor", cssProp: "backgroundColor" },
    { attr: "textColor", cssProp: "color" },
    { attr: "bgImageSize", cssProp: "backgroundSize" },
  ];

  for (const { attr, cssProp } of mappings) {
    const checkKey = attr in CSS_PROPERTY_CHECK ? attr : "";
    const pattern = checkKey ? CSS_PROPERTY_CHECK[checkKey] : null;
    const alreadyInCss = pattern ? pattern.test(cssStr) : false;
    if (!alreadyInCss && attrs[attr] !== undefined && attrs[attr] !== "" && attrs[attr] !== null) {
      result[cssProp] = String(attrs[attr]);
    }
  }

  // Handle bgImage specially (needs url() wrapper)
  if (attrs.bgImage && typeof attrs.bgImage === "string" && attrs.bgImage.length > 0) {
    const checkPattern = CSS_PROPERTY_CHECK.backgroundImage;
    if (!checkPattern.test(cssStr)) {
      result.backgroundImage = `url(${attrs.bgImage})`;
    }
  }

  // Handle gradient attributes
  if (attrs.gradient && !cssStr.includes("linear-gradient") && !cssStr.includes("radial-gradient")) {
    const direction = (attrs.gradientDirection as string) || "";
    const color1 = (attrs.gradientColorOne as string) || "";
    const color2 = (attrs.gradientColorTwo as string) || "";
    if (color1 && color2) {
      const gradParts = [attrs.gradient, direction, color1, color2].filter(Boolean);
      result.background = `${gradParts[0]}(${gradParts.slice(1).join(",")})`;
    }
  }

  return result;
}
```

- [ ] **Step 5: Run tests to verify**

```bash
npx tsx --test tests/renderer.test.ts
```
Expected: PASS — all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/renderer.ts tests/renderer.test.ts
git commit -m "feat: add renderer block delimiter parser and CSS derivation from GB attrs"
```

---

### Task 4: Renderer — HTML assembly and CSS injection

**Files:**
- Modify: `src/core/renderer.ts` (add `renderStandalone`, helper functions)
- Modify: `tests/renderer.test.ts` (add tests)

- [ ] **Step 1: Add failing test for renderStandalone**

Append to `tests/renderer.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("renderStandalone", () => {
  const FIXTURE_DIR = resolve(process.cwd(), "fixtures/verify/good-simple-output");

  it("produces valid HTML document from GB output", () => {
    const html = renderStandalone(FIXTURE_DIR, "index");
    // Must start with doctype
    assert.ok(html.startsWith("<!DOCTYPE html>"), "should start with <!DOCTYPE html>");
    // Must contain rendered content (no block delimiters)
    assert.ok(!html.includes("<!-- wp:generateblocks/"), "should not contain block delimiter comments");
    // Must contain the section element
    assert.ok(html.includes('<section class="gb-element-elem001'), "should contain rendered element");
    // Must contain text block content
    assert.ok(html.includes("Hello World"), "should contain text block content");
  });

  it("injects inline styles from GB attributes when css is empty", () => {
    const html = renderStandalone(FIXTURE_DIR, "index");
    // The header section has backgroundColor:#f7f7f7 but css is empty
    // It should appear as an inline style
    assert.ok(html.includes("background-color"), "should inject derived background-color");
  });

  it("strips all block delimiter comments", () => {
    const html = renderStandalone(FIXTURE_DIR, "index");
    const comments = html.match(/<!--\s*wp:/g);
    assert.strictEqual(comments, null, "should have zero block delimiters");
  });

  it("wraps in proper HTML document structure", () => {
    const html = renderStandalone(FIXTURE_DIR, "index");
    assert.ok(html.includes("<head>"), "should have <head>");
    assert.ok(html.includes("<body>"), "should have <body>");
    assert.ok(html.includes("</html>"), "should close with </html>");
    assert.ok(html.includes('<meta charset="UTF-8">'), "should have charset meta");
    assert.ok(html.includes('<meta name="viewport"'), "should have viewport meta");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/renderer.test.ts
```
Expected: FAIL — `renderStandalone` not defined.

- [ ] **Step 3: Implement renderStandalone**

Append to `src/core/renderer.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Expand global-styles.json entries into CSS.
 * Each entry has {name, selector, css}.
 */
export function expandGlobalStyles(jsonPath: string): string {
  if (!existsSync(jsonPath)) return "";
  const raw = readFileSync(jsonPath, "utf-8");
  let entries: Array<{ name: string; selector: string; css: string }>;
  try {
    entries = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!Array.isArray(entries)) return "";
  return entries
    .map((e) => `${e.selector} { ${e.css} }`)
    .join("\n");
}

/**
 * Build a style attribute string from a property dictionary.
 */
function buildStyleAttr(styles: Record<string, string>): string {
  const entries = Object.entries(styles).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${v}`)
    .join(";");
}

/**
 * Extract font <link> tags from source HTML for injection into rendered page.
 */
function extractFontLinks(sourceHtml: string): string {
  const regex = /<link[^>]*fonts\.googleapis\.com[^>]*>/gi;
  const matches = sourceHtml.match(regex);
  return matches ? matches.join("\n") : "";
}

/**
 * Render a GB block output page as standalone HTML.
 *
 * @param outputDir - Path to output/<project>/ directory
 * @param pageName - Page name without extension (e.g., "index")
 * @param sourceHtml - Optional source HTML for font link extraction
 * @param injectJs - Whether to inject global.js (default false)
 */
export function renderStandalone(
  outputDir: string,
  pageName: string,
  sourceHtml?: string,
  injectJs = false,
): string {
  const pagesDir = resolve(outputDir, "pages");
  const setupDir = resolve(outputDir, "setup");

  // Read GB block output
  const blockPath = resolve(pagesDir, `${pageName}.html`);
  if (!existsSync(blockPath)) {
    throw new Error(`Block output not found: ${blockPath}`);
  }
  const rawBlocks = readFileSync(blockPath, "utf-8");

  // Read CSS files
  const stylesCss = existsSync(resolve(pagesDir, "styles.css"))
    ? readFileSync(resolve(pagesDir, "styles.css"), "utf-8") : "";
  const uniqueCss = existsSync(resolve(setupDir, "styles-unique.css"))
    ? readFileSync(resolve(setupDir, "styles-unique.css"), "utf-8") : "";
  const globalStylesCss = expandGlobalStyles(resolve(setupDir, "global-styles.json"));

  // Parse blocks
  const blocks = parseBlockDelimiters(rawBlocks);

  // Build rendered HTML: replace each block delimiter with the inner HTML,
  // injecting derived inline styles
  let rendered = rawBlocks;
  for (const block of blocks) {
    const derived = deriveCssFromAttrs(block.attrs);

    // If css string is non-empty, we inject it as a <style> tag (not inline)
    // For now, derived styles go on the element itself
    if (Object.keys(derived).length > 0) {
      const styleStr = buildStyleAttr(derived);
      if (styleStr) {
        // Insert style attribute into the first HTML tag in innerHtml
        const tagMatch = block.innerHtml.match(/<(\w+)([^>]*)>/);
        if (tagMatch) {
          const tagName = tagMatch[1];
          const existingAttrs = tagMatch[2];
          const hasStyle = /style\s*=\s*["']/.test(existingAttrs);
          let newAttrs: string;
          if (hasStyle) {
            newAttrs = existingAttrs.replace(/(style\s*=\s*["'])([^"']*)(["'])/, (_, prefix, val, suffix) => {
              return `${prefix}${val};${styleStr}${suffix}`;
            });
          } else {
            newAttrs = `${existingAttrs} style="${styleStr}"`;
          }
          const newTag = `<${tagName}${newAttrs}>`;
          block.innerHtml = block.innerHtml.replace(tagMatch[0], newTag);
        }
      }
    }

    // Replace the full block match (delimiter + innerHTML + closing delimiter) with just innerHTML
    rendered = rendered.replace(block.fullMatch, block.innerHtml);
  }

  // Extract font links if source provided
  const fontLinks = sourceHtml ? extractFontLinks(sourceHtml) : "";

  // Inject JS if requested
  const jsScript = injectJs && existsSync(resolve(setupDir, "global.js"))
    ? `<script>\n${readFileSync(resolve(setupDir, "global.js"), "utf-8")}\n</script>`
    : "";

  // Assemble full document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${fontLinks}
  <style>
/* ── Global Styles (from global-styles.json) ── */
${globalStylesCss}

/* ── Unique Styles (backgrounds, effects, colors) ── */
${uniqueCss}

/* ── Master Styles (compiled Tailwind CDN output) ── */
${stylesCss}
  </style>
</head>
<body>
${rendered}
${jsScript}
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test tests/renderer.test.ts
```
Expected: PASS — all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/renderer.ts tests/renderer.test.ts
git commit -m "feat: add renderStandalone — HTML assembly, CSS injection, font extraction"
```

---

### Task 5: Render CLI command

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add render subcommand**

In `src/cli/index.ts`, add the `render` subcommand to the CLI dispatcher. Locate the command routing section (where `convert`, `validate`, etc. are dispatched) and add:

```typescript
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { renderStandalone } from "../core/renderer.js";

// In the CLI command dispatcher, add:
if (command === "render") {
  const targetPath = resolve(process.cwd(), args[1] || "output/");
  const sourcePath = parsed.flags.source ? resolve(process.cwd(), parsed.flags.source as string) : undefined;
  const noJs = parsed.flags["no-js"] as boolean | undefined;
  const sourceHtml = sourcePath && existsSync(sourcePath) ? readFileSync(sourcePath, "utf-8") : undefined;

  // Determine if target is a single file or a directory
  const stat = existsSync(targetPath) ? statSync(targetPath) : null;

  if (stat?.isFile() && targetPath.endsWith(".html")) {
    // Single page render
    const pageName = basename(targetPath, ".html");
    // Go up from pages/<page>.html to project dir
    const projectDir = resolve(dirname(targetPath), "..");
    const html = renderStandalone(projectDir, pageName, sourceHtml, !noJs);
    const outPath = resolve(dirname(targetPath), `${pageName}.rendered.html`);
    writeFileSync(outPath, html, "utf-8");
    console.log(`Rendered: ${outPath}`);
  } else if (stat?.isDirectory()) {
    // Directory: render all pages
    const pagesDir = resolve(targetPath, "pages");
    if (!existsSync(pagesDir)) {
      console.error(`No pages/ directory found in ${targetPath}`);
      process.exit(1);
    }
    const pageFiles = readdirSync(pagesDir).filter(f => f.endsWith(".html") && !f.endsWith(".rendered.html"));
    for (const file of pageFiles) {
      const pageName = basename(file, ".html");
      const html = renderStandalone(targetPath, pageName, sourceHtml, !noJs);
      const outPath = resolve(pagesDir, `${pageName}.rendered.html`);
      writeFileSync(outPath, html, "utf-8");
      console.log(`Rendered: ${outPath}`);
    }
  } else {
    console.error(`Target not found: ${targetPath}`);
    process.exit(1);
  }
  process.exit(0);
}
```

Make sure the import for `dirname` is present at the top of the CLI file.

- [ ] **Step 2: Test render command manually**

```bash
npx tsx src/cli/index.ts render fixtures/verify/good-simple-output/ --source fixtures/verify/good-simple.html
```
Expected: prints "Rendered: ..." with path to rendered file. Check output:

```bash
head -20 fixtures/verify/good-simple-output/pages/index.rendered.html
```
Expected: shows `<!DOCTYPE html>` and rendered content with no block delimiters.

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add render CLI subcommand"
```

---

### Task 6: Screenshotter — Playwright full-page capture

**Files:**
- Create: `src/core/screenshotter.ts`
- Test: `tests/screenshotter.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/screenshotter.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, unlinkSync } from "node:fs";
import { captureFullPage } from "../src/core/screenshotter.js";
import { resolve } from "node:path";

const FIXTURE_HTML = resolve(process.cwd(), "fixtures/verify/good-simple-output/pages/index.rendered.html");

describe("captureFullPage", () => {
  it("captures a full-page screenshot as PNG", async () => {
    // First ensure rendered HTML exists (run render first)
    if (!existsSync(FIXTURE_HTML)) {
      throw new Error(`Fixture not found: ${FIXTURE_HTML}. Run render command first.`);
    }

    const outPath = resolve(process.cwd(), "fixtures/verify/good-simple-output/verify/source.png");
    const result = await captureFullPage(FIXTURE_HTML, outPath, { width: 1440, height: 900 });

    assert.ok(existsSync(outPath), "screenshot file should exist");
    assert.ok(result.width > 0, "should have positive width");
    assert.ok(result.height > 0, "should have positive height");
    assert.strictEqual(result.status, "ok");

    // Cleanup
    try { unlinkSync(outPath); } catch {}
  });

  it("reports error status when page fails to load", async () => {
    const result = await captureFullPage(
      "/nonexistent/file.html",
      "/tmp/should-not-exist.png",
      { width: 1440, height: 900 },
    );
    assert.strictEqual(result.status, "error");
    assert.ok(result.error, "should have error message");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/screenshotter.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement captureFullPage**

Write `src/core/screenshotter.ts`:

```typescript
// ── Screenshotter ─────────────────────────────────────────────
//
// Takes full-page screenshots of HTML pages using Playwright.
// Handles wait strategy, scrollbar normalization, and error reporting.

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

export interface ScreenshotResult {
  width: number;
  height: number;
  status: "ok" | "error";
  error?: string;
  warnings?: Array<{ code: string; url: string; count: number }>;
}

export interface ScreenshotOptions {
  width: number;
  height: number;
  waitMs?: number;
}

/**
 * Capture a full-page screenshot of an HTML file.
 *
 * Wait strategy:
 * 1. networkidle (built-in)
 * 2. document.fonts.ready
 * 3. All <img> loaded
 * 4. Extra settle timeout (default 500ms)
 *
 * Injects overflow-y: scroll on <html> to normalize scrollbar presence.
 */
export async function captureFullPage(
  htmlPath: string,
  outputPath: string,
  options: ScreenshotOptions,
): Promise<ScreenshotResult> {
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    const page: Page = await context.newPage();

    // Track 404 images
    const image404s: Array<{ url: string }> = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "image" && response.status() === 404) {
        image404s.push({ url: response.url() });
      }
    });

    // Load the page
    const fileUrl = `file://${htmlPath}`;
    await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for fonts
    await page.evaluate(() => document.fonts.ready);

    // Wait for all images to load
    await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve(); // resolve even on error
              }
            }),
        ),
      );
    });

    // Inject scrollbar normalization
    await page.addStyleTag({ content: "html { overflow-y: scroll !important; }" });

    // Settle timeout
    const settleMs = options.waitMs ?? 500;
    await page.waitForTimeout(settleMs);

    // Capture full-page screenshot
    await page.screenshot({ path: outputPath, fullPage: true });

    const viewportSize = page.viewportSize();
    const warnings = image404s.length > 0
      ? [{ code: "IMAGE_404", url: image404s.map(i => i.url).join(", "), count: image404s.length }]
      : undefined;

    await context.close();

    return {
      width: viewportSize?.width ?? options.width,
      height: viewportSize?.height ?? options.height,
      status: "ok",
      warnings,
    };
  } catch (err) {
    return {
      width: 0,
      height: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) await browser.close();
  }
}
```

- [ ] **Step 4: Run tests**

First ensure the rendered fixture exists:
```bash
npx tsx src/cli/index.ts render fixtures/verify/good-simple-output/
```

Then run:
```bash
npx tsx --test tests/screenshotter.test.ts
```
Expected: PASS — both tests pass (first captures screenshot, second handles error).

- [ ] **Step 5: Commit**

```bash
git add src/core/screenshotter.ts tests/screenshotter.test.ts
git commit -m "feat: add screenshotter — Playwright full-page capture with wait strategy"
```

---

### Task 7: Pixel Differ — comparison and diff image

**Files:**
- Create: `src/core/pixel-differ.ts`
- Test: `tests/pixel-differ.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/pixel-differ.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { compareImages } from "../src/core/pixel-differ.js";

const TMP_DIR = resolve(process.cwd(), "fixtures/verify/tmp");
mkdirSync(TMP_DIR, { recursive: true });

async function createSolidPng(path: string, width: number, height: number, r: number, g: number, b: number) {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  }).png().toBuffer();
  writeFileSync(path, buf);
}

describe("compareImages", () => {
  it("returns 0% mismatch for identical images", async () => {
    const a = resolve(TMP_DIR, "identical-a.png");
    const b = resolve(TMP_DIR, "identical-b.png");
    const diff = resolve(TMP_DIR, "identical-diff.png");
    await createSolidPng(a, 100, 100, 255, 0, 0);
    await createSolidPng(b, 100, 100, 255, 0, 0);
    const result = await compareImages(a, b, diff);
    assert.strictEqual(result.mismatchPct, 0);
    assert.strictEqual(result.band, "pass");
  });

  it("returns 100% mismatch for completely different images", async () => {
    const a = resolve(TMP_DIR, "diff-a.png");
    const b = resolve(TMP_DIR, "diff-b.png");
    const diff = resolve(TMP_DIR, "diff-diff.png");
    await createSolidPng(a, 100, 100, 255, 0, 0);
    await createSolidPng(b, 100, 100, 0, 0, 255);
    const result = await compareImages(a, b, diff);
    assert.ok(result.mismatchPct > 90, `expected >90%, got ${result.mismatchPct}`);
    assert.strictEqual(result.band, "significant");
  });

  it("pads shorter image to match height", async () => {
    const a = resolve(TMP_DIR, "tall-a.png");
    const b = resolve(TMP_DIR, "short-b.png");
    const diff = resolve(TMP_DIR, "height-diff.png");
    await createSolidPng(a, 100, 200, 255, 255, 255);
    await createSolidPng(b, 100, 100, 255, 255, 255);
    const result = await compareImages(a, b, diff);
    // Same white content, just different heights — white padding matches
    assert.strictEqual(result.mismatchPct, 0);
  });

  it("resizes to wider width", async () => {
    const a = resolve(TMP_DIR, "wide-a.png");
    const b = resolve(TMP_DIR, "narrow-b.png");
    const diff = resolve(TMP_DIR, "width-diff.png");
    await createSolidPng(a, 200, 100, 128, 128, 128);
    await createSolidPng(b, 100, 100, 128, 128, 128);
    const result = await compareImages(a, b, diff);
    assert.strictEqual(result.totalWidth, 200, "should resize to wider width");
  });

  it("respects intensity threshold", async () => {
    const a = resolve(TMP_DIR, "threshold-a.png");
    const b = resolve(TMP_DIR, "threshold-b.png");
    const diff = resolve(TMP_DIR, "threshold-diff.png");
    // a = rgb(100,100,100), b = rgb(105,105,105) — 5/255 ≈ 2% difference
    await createSolidPng(a, 100, 100, 100, 100, 100);
    await createSolidPng(b, 100, 100, 105, 105, 105);
    const result = await compareImages(a, b, diff, { threshold: 0.1 });
    // Difference is ~2% per channel, threshold is 10% → should match
    assert.strictEqual(result.mismatchPct, 0, "small intensity diff should be below threshold");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/pixel-differ.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement compareImages**

Write `src/core/pixel-differ.ts`:

```typescript
// ── Pixel Differ ───────────────────────────────────────────────
//
// Compares two screenshots pixel-by-pixel with configurable intensity
// threshold. Produces a diff overlay image and mismatch statistics.

import sharp from "sharp";

export interface DiffResult {
  mismatchPct: number;
  mismatchPixels: number;
  totalPixels: number;
  threshold: number;
  band: "pass" | "minor" | "significant";
  totalWidth: number;
  totalHeight: number;
}

export interface CompareOptions {
  threshold?: number; // 0–1, default 0.1 (10% intensity difference → match)
  passBand?: number;  // default 1 (%)
  minorBand?: number; // default 5 (%)
}

/**
 * Compare two PNG images pixel-by-pixel.
 *
 * - Resizes both to the wider width
 * - Pads the shorter image with white pixels at the bottom
 * - Compares each pixel's RGB channels against the threshold
 * - Produces a diff overlay image (mismatched pixels in red)
 */
export async function compareImages(
  imageAPath: string,
  imageBPath: string,
  diffOutputPath: string,
  options: CompareOptions = {},
): Promise<DiffResult> {
  const threshold = options.threshold ?? 0.1;
  const passBand = options.passBand ?? 1;
  const minorBand = options.minorBand ?? 5;

  // Load images
  const [imgA, imgB] = await Promise.all([
    sharp(imageAPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(imageBPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  let { width: wA, height: hA } = imgA.info;
  let { width: wB, height: hB } = imgB.info;

  const targetWidth = Math.max(wA, wB);
  const targetHeight = Math.max(hA, hB);

  // Resize to same width if needed
  const buffers = await Promise.all([
    wA !== targetWidth
      ? sharp(imageAPath).resize(targetWidth, hA, { fit: "fill" }).ensureAlpha().raw().toBuffer()
      : Promise.resolve(imgA.data),
    wB !== targetWidth
      ? sharp(imageBPath).resize(targetWidth, hB, { fit: "fill" }).ensureAlpha().raw().toBuffer()
      : Promise.resolve(imgB.data),
  ]);

  // Pad to same height with white pixels
  const rowBytes = targetWidth * 4; // RGBA
  const paddedA = hA < targetHeight ? padBuffer(buffers[0], hA, targetHeight, rowBytes) : buffers[0];
  const paddedB = hB < targetHeight ? padBuffer(buffers[1], hB, targetHeight, rowBytes) : buffers[1];

  // Build diff overlay
  const diffBuffer = Buffer.alloc(targetWidth * targetHeight * 4);
  let mismatchPixels = 0;
  const totalPixels = targetWidth * targetHeight;

  const thresholdAbs = threshold * 255; // Convert 0–1 threshold to 0–255 scale

  for (let i = 0; i < paddedA.length; i += 4) {
    const rA = paddedA[i], gA = paddedA[i + 1], bA = paddedA[i + 2];
    const rB = paddedB[i], gB = paddedB[i + 1], bB = paddedB[i + 2];

    const dr = Math.abs(rA - rB);
    const dg = Math.abs(gA - gB);
    const db = Math.abs(bA - bB);

    const isMatch = dr <= thresholdAbs && dg <= thresholdAbs && db <= thresholdAbs;

    if (isMatch) {
      // Matching pixel: show original dimmed
      diffBuffer[i] = Math.round(rA * 0.5);
      diffBuffer[i + 1] = Math.round(gA * 0.5);
      diffBuffer[i + 2] = Math.round(bA * 0.5);
      diffBuffer[i + 3] = 255;
    } else {
      // Mismatching pixel: show in red
      diffBuffer[i] = 255;
      diffBuffer[i + 1] = 0;
      diffBuffer[i + 2] = 0;
      diffBuffer[i + 3] = 255;
      mismatchPixels++;
    }
  }

  // Write diff image
  await sharp(diffBuffer, {
    raw: { width: targetWidth, height: targetHeight, channels: 4 },
  }).png().toFile(diffOutputPath);

  const mismatchPct = (mismatchPixels / totalPixels) * 100;
  let band: DiffResult["band"];
  if (mismatchPct < passBand) band = "pass";
  else if (mismatchPct < minorBand) band = "minor";
  else band = "significant";

  return {
    mismatchPct: Math.round(mismatchPct * 100) / 100,
    mismatchPixels,
    totalPixels,
    threshold,
    band,
    totalWidth: targetWidth,
    totalHeight: targetHeight,
  };
}

function padBuffer(buf: Buffer, currentHeight: number, targetHeight: number, rowBytes: number): Buffer {
  const padded = Buffer.alloc(rowBytes * targetHeight, 255); // white RGBA
  buf.copy(padded, 0, 0, rowBytes * currentHeight);
  return padded;
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test tests/pixel-differ.test.ts
```
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/pixel-differ.ts tests/pixel-differ.test.ts
git commit -m "feat: add pixel-differ — image comparison with threshold and diff overlay"
```

---

### Task 8: Compare CLI command

**Files:**
- Create: `src/cli/compare.ts` (new file with compare logic, keep index.ts lean)
- Modify: `src/cli/index.ts` (import and dispatch)

- [ ] **Step 1: Write compare command module**

Write `src/cli/compare.ts`:

```typescript
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { captureFullPage } from "../core/screenshotter.js";
import { renderStandalone } from "../core/renderer.js";
import { compareImages } from "../core/pixel-differ.js";
import type { ScreenshotResult } from "../core/screenshotter.js";

export interface CompareOptions {
  sourcePath: string;
  outputDir: string;
  viewport?: { width: number; height: number };
  waitMs?: number;
  threshold?: number;
  golden?: boolean;
}

export interface CompareReport {
  page: string;
  timestamp: string;
  iteration: number;
  source: {
    file: string;
    viewport: { width: number; height: number };
    dimensions: { width: number; height: number };
    status: string;
    error?: string;
  };
  rendered: {
    file: string;
    dimensions: { width: number; height: number };
    status: string;
    error?: string;
    warnings?: Array<{ code: string; url: string; count: number }>;
  };
  diff: {
    mismatchPct: number;
    mismatchPixels: number;
    totalPixels: number;
    threshold: number;
    band: string;
  } | null;
  errors: Array<{ code: string; message: string }>;
}

export async function runCompare(opts: CompareOptions): Promise<void> {
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  const verifyDir = resolve(opts.outputDir, "verify");
  mkdirSync(verifyDir, { recursive: true });

  const sourceHtml = readFileSync(opts.sourcePath, "utf-8");
  const pageName = basename(opts.sourcePath, extname(opts.sourcePath));

  const errors: Array<{ code: string; message: string }> = [];
  const report: CompareReport = {
    page: pageName,
    timestamp: new Date().toISOString(),
    iteration: 1, // agent updates this on re-runs
    source: {
      file: opts.sourcePath,
      viewport: { ...viewport },
      dimensions: { width: 0, height: 0 },
      status: "pending",
    },
    rendered: {
      file: "",
      dimensions: { width: 0, height: 0 },
      status: "pending",
    },
    diff: null,
    errors: [],
  };

  // Step 1: Screenshot source
  const sourceOutPath = resolve(verifyDir, "source.png");
  const sourceResult: ScreenshotResult = await captureFullPage(opts.sourcePath, sourceOutPath, {
    width: viewport.width,
    height: viewport.height,
    waitMs: opts.waitMs,
  });

  report.source.status = sourceResult.status;
  report.source.dimensions = { width: sourceResult.width, height: sourceResult.height };
  if (sourceResult.error) {
    errors.push({ code: "SOURCE_SCREENSHOT_FAILED", message: sourceResult.error });
  }

  // Step 2: Render GB output
  const renderedPath = resolve(opts.outputDir, "pages", `${pageName}.rendered.html`);
  try {
    const renderedHtml = renderStandalone(opts.outputDir, pageName, sourceHtml, false);
    writeFileSync(renderedPath, renderedHtml, "utf-8");
    report.rendered.file = renderedPath;
  } catch (err) {
    errors.push({
      code: "RENDER_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
    report.rendered.status = "error";
    report.rendered.error = err instanceof Error ? err.message : String(err);
  }

  // Step 3: Screenshot rendered output
  if (report.rendered.status !== "error") {
    const renderedOutPath = resolve(verifyDir, "rendered.png");
    const renderedResult = await captureFullPage(renderedPath, renderedOutPath, {
      width: viewport.width,
      height: viewport.height,
      waitMs: opts.waitMs,
    });

    report.rendered.status = renderedResult.status;
    report.rendered.dimensions = { width: renderedResult.width, height: renderedResult.height };
    report.rendered.warnings = renderedResult.warnings;

    if (renderedResult.error) {
      errors.push({ code: "RENDERED_SCREENSHOT_FAILED", message: renderedResult.error });
    }

    // Step 4: Diff
    if (sourceResult.status === "ok" && renderedResult.status === "ok") {
      const diffOutPath = resolve(verifyDir, "diff.png");
      const diffResult = await compareImages(sourceOutPath, renderedOutPath, diffOutPath, {
        threshold: opts.threshold,
      });
      report.diff = {
        mismatchPct: diffResult.mismatchPct,
        mismatchPixels: diffResult.mismatchPixels,
        totalPixels: diffResult.totalPixels,
        threshold: diffResult.threshold,
        band: diffResult.band,
      };
    }
  }

  report.errors = errors;

  // Write report
  const reportPath = resolve(verifyDir, "compare-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

  console.log(`Compare complete: ${verifyDir}/`);
  if (report.diff) {
    console.log(`  Mismatch: ${report.diff.mismatchPct}% (${report.diff.band})`);
  }
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
    for (const e of errors) {
      console.log(`    [${e.code}] ${e.message}`);
    }
  }
}
```

- [ ] **Step 2: Wire into CLI**

In `src/cli/index.ts`, add the import and `compare` case:

```typescript
import { runCompare } from "./compare.js";

// In the command dispatcher, add:
if (command === "compare") {
  const sourcePath = resolve(process.cwd(), args[1] || "");
  const outputDir = resolve(process.cwd(), args[2] || "");
  const viewportParts = ((parsed.flags.viewport as string) || "1440x900").split("x");

  if (!sourcePath || !outputDir) {
    console.error("Usage: compare <source.html> <output-dir> [--viewport WxH] [--wait N] [--threshold N] [--golden]");
    process.exit(1);
  }

  await runCompare({
    sourcePath,
    outputDir,
    viewport: { width: parseInt(viewportParts[0]), height: parseInt(viewportParts[1]) },
    waitMs: parsed.flags.wait ? parseInt(parsed.flags.wait as string) : undefined,
    threshold: parsed.flags.threshold ? parseFloat(parsed.flags.threshold as string) : undefined,
    golden: !!parsed.flags.golden,
  });
  process.exit(0);
}
```

- [ ] **Step 3: Manual test with good fixture**

```bash
npx tsx src/cli/index.ts compare fixtures/verify/good-simple.html fixtures/verify/good-simple-output/ --threshold 5
```
Expected: prints "Compare complete" with mismatch %. Should be low (<5%) since the fixture is known-good.

- [ ] **Step 4: Commit**

```bash
git add src/cli/compare.ts src/cli/index.ts
git commit -m "feat: add compare CLI command — source vs rendered screenshot diff"
```

---

### Task 9: Integration test

**Files:**
- Create: `tests/compare.test.ts`

- [ ] **Step 1: Write integration test**

Write `tests/compare.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCompare } from "../src/cli/compare.js";

const FIXTURE_SOURCE = resolve(process.cwd(), "fixtures/verify/good-simple.html");
const FIXTURE_OUTPUT = resolve(process.cwd(), "fixtures/verify/good-simple-output");

describe("compare (integration)", () => {
  it("produces compare-report.json with mismatch < 5% for known-good fixture", async () => {
    await runCompare({
      sourcePath: FIXTURE_SOURCE,
      outputDir: FIXTURE_OUTPUT,
      threshold: 5,
    });

    const reportPath = resolve(FIXTURE_OUTPUT, "verify", "compare-report.json");
    assert.ok(existsSync(reportPath), "compare-report.json should exist");

    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    assert.strictEqual(report.source.status, "ok");
    assert.strictEqual(report.rendered.status, "ok");
    assert.ok(report.diff, "should have diff results");
    assert.ok(report.diff.mismatchPct < 5, `mismatch should be <5%, got ${report.diff.mismatchPct}%`);
  });

  it("produces screenshot files", async () => {
    const verifyDir = resolve(FIXTURE_OUTPUT, "verify");
    assert.ok(existsSync(resolve(verifyDir, "source.png")), "source.png should exist");
    assert.ok(existsSync(resolve(verifyDir, "rendered.png")), "rendered.png should exist");
    assert.ok(existsSync(resolve(verifyDir, "diff.png")), "diff.png should exist");
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
npx tsx --test tests/compare.test.ts
```
Expected: PASS — both tests pass, diff mismatch < 5%.

- [ ] **Step 3: Commit**

```bash
git add tests/compare.test.ts
git commit -m "test: add integration test for compare command"
```

---

### Task 10: Run all tests and finalize

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npx tsx --test tests/renderer.test.ts tests/screenshotter.test.ts tests/pixel-differ.test.ts tests/compare.test.ts
```
Expected: All tests pass.

- [ ] **Step 2: Run the full pipeline end-to-end**

```bash
npx tsx src/cli/index.ts render fixtures/verify/good-simple-output/
npx tsx src/cli/index.ts compare fixtures/verify/good-simple.html fixtures/verify/good-simple-output/
```
Expected: Compare completes, writes report. Check output:

```bash
cat fixtures/verify/good-simple-output/verify/compare-report.json
```

- [ ] **Step 3: Commit any final changes**

```bash
git add -A
git commit -m "chore: finalize self-verification loop — all tests passing"
```

---

### Task 11 (Follow-up): Golden file regression

**Files:**
- Modify: `src/cli/compare.ts`
- Create: `tests/golden.test.ts`

**Note:** Implement after core render + compare pipeline is stable. The spec requires `--golden` flag support for regression testing.

- [ ] **Step 1: Add golden mode to compare**

In `src/cli/compare.ts`, add golden file logic to `runCompare`:

When `opts.golden` is true:
1. Check if `verify/golden-source.png` and `verify/golden-rendered.png` exist
2. If they don't exist: save current screenshots as golden files, exit with success
3. If they exist: compare current screenshots against golden files instead of each other
4. If mismatch exceeds threshold: exit with code 1 (fails CI)

- [ ] **Step 2: Add golden test fixture and tests**

- [ ] **Step 3: Commit**

---

### Implementation Notes

- **`verification-log.json`** is NOT written by the CLI. It's written by the coding agent after reviewing `compare-report.json` and `diff.png`. The schema is defined in the spec; the agent creates it manually during the diagnosis step of the agent loop.
- **Tailwind CDN output** — The renderer uses `styles.css` from the output directory. This file is produced by `inlineTailwindStyles()` during `convert` and is the same CSS the browser compiled. No separate compilation happens during render.
- **Source path resolution** for `file://` — Playwright handles `file://` protocol natively. The compare command resolves the absolute path before passing to `captureFullPage`.
