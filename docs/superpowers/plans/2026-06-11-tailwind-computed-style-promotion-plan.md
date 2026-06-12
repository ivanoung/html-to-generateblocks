# Tailwind Computed-Style Promotion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the pipeline to capture per-element computed styles from the Playwright session, classify them into Customizer → Global Styles → Inline → styles-unique.css by deterministic rules, and populate GB block `styles` and editor attributes.

**Architecture:** Three new modules extend the existing pipeline: `tailwind-cleaner.ts` (structural cleanup before conversion), `style-classifier.ts` (frequency/type-based property classification), and computed style capture inside the existing `tailwind-inliner.ts` Playwright session. The DOM walker and orchestrator are modified to wire classified styles into blocks.

**Tech Stack:** TypeScript, Playwright (existing), Cheerio (existing), Node.js `crypto` (for property set hashing).

---

## File Structure

```
src/core/
├── tailwind-cleaner.ts     # NEW: structural cleanup for Tailwind sources
├── tailwind-inliner.ts     # MODIFY: add captureComputedStyles() to InlinerResult
├── style-classifier.ts     # NEW: frequency/type-based property classification
├── dom-walker.ts           # MODIFY: accept and use classified styles
├── gb-attribute-mapper.ts  # MODIFY: accept styles from classifier (minor)
├── orchestrator.ts         # MODIFY: wire cleaner + classifier between inliner and walker

tests/
├── tailwind-cleaner.test.ts     # NEW
├── style-classifier.test.ts     # NEW
├── computed-styles-e2e.test.ts  # NEW: integration test with fixture

fixtures/computed-styles/
├── simple-tailwind.html         # NEW: minimal Tailwind page for deterministic testing
```

---

### Task 1: Create test fixture

**Files:**
- Create: `fixtures/computed-styles/simple-tailwind.html`

A minimal Tailwind page with known classes and computed styles, used as the deterministic test baseline.

- [ ] **Step 1: Write fixture**

Write `fixtures/computed-styles/simple-tailwind.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Simple Tailwind Test</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 500: '#ff6600', 700: '#cc4400' }
          }
        }
      }
    }
  </script>
</head>
<body>
  <!-- Section 1: shared padding pattern (appears 3+ times) -->
  <section class="px-8 py-16 bg-gray-50">
    <h1 class="text-3xl font-bold text-gray-900">Heading One</h1>
    <p class="text-base text-gray-600">Body text here.</p>
  </section>

  <!-- Section 2: same shared padding pattern -->
  <section class="px-8 py-16 bg-white">
    <h2 class="text-2xl font-semibold text-gray-800">Heading Two</h2>
    <p class="text-base text-gray-600">More body text.</p>
  </section>

  <!-- Section 3: same shared padding pattern -->
  <section class="px-8 py-16 bg-gray-50">
    <h2 class="text-2xl font-semibold text-gray-800">Heading Three</h2>
    <p class="text-base text-gray-600">Even more body text.</p>
  </section>

  <!-- Section 4: unique background (appears only once) -->
  <section id="hero" class="px-8 py-32 bg-brand-500 text-white">
    <h1 class="text-5xl font-bold">Hero Heading</h1>
    <p class="text-lg">Hero body with brand color background.</p>
  </section>

  <!-- Section 5: another unique background -->
  <section class="px-8 py-16 bg-brand-700 text-white">
    <h2 class="text-2xl font-semibold">CTA Section</h2>
  </section>
</body>
</html>
```

Key testable properties of this fixture:

| Property | Expected Classification |
|---|---|
| `paddingLeft/Right: 32px, paddingTop/Bottom: 64px` | Global Styles (≥3 sections use `px-8 py-16`) |
| `backgroundColor: #ff6600` (section#hero) | Customizer (in config) + Inline (unique use, <3) |
| `backgroundColor: #cc4400` (CTA section) | Customizer (in config) + Inline (unique use, <3) |
| `backgroundColor: #f9fafb` (gray-50, 2 sections) | Customizer (Tailwind default) + Inline (<3 uses) |
| `color: #111827` (gray-900 heading) | Customizer (Tailwind default) |
| `fontSize: 48px` (text-5xl hero) | Inline (unique, <3) |

- [ ] **Step 2: Commit**

```bash
git add fixtures/computed-styles/
git commit -m "test: add simple-tailwind fixture for computed-style testing"
```

---

### Task 2: Tailwind Cleaner — structural cleanup

**Files:**
- Create: `src/core/tailwind-cleaner.ts`
- Test: `tests/tailwind-cleaner.test.ts`

A pre-conversion module that runs when Tailwind is detected. Pure function: HTML in → cleaned HTML out.

- [ ] **Step 1: Write failing test**

Write `tests/tailwind-cleaner.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { cleanTailwindSource } from "../src/core/tailwind-cleaner.js";

describe("cleanTailwindSource", () => {
  it("wraps bare text nodes inside div with <p>", () => {
    const input = '<div>Hello world</div>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes("<p>Hello world</p>"), "bare text should be wrapped in <p>");
  });

  it("wraps short bare text inside section with <span>", () => {
    const input = '<section>Hi</section>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes("<span>Hi</span>") || result.html.includes("<p>Hi</p>"), "short text should be wrapped");
  });

  it("does not touch already-wrapped text", () => {
    const input = '<section><p>Already wrapped</p></section>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes("<p>Already wrapped</p>"), "already-wrapped text preserved");
    assert.strictEqual(result.warnings.length, 0);
  });

  it("injects data-gb-path on target elements", () => {
    const input = '<section id="hero" class="px-8"><h1>Title</h1></section>';
    const result = cleanTailwindSource(input);
    assert.ok(result.html.includes('data-gb-path="section#hero"'), "should inject data-gb-path with id-based selector");
    assert.ok(result.html.match(/data-gb-path="section#hero > h1"/) || result.html.includes('data-gb-path="h1'), "child should get path");
  });

  it("strips empty div elements", () => {
    const input = '<div></div><div>  </div><section>content</section>';
    const result = cleanTailwindSource(input);
    assert.ok(!result.html.includes('<div></div>'), "empty div should be removed");
    assert.ok(result.html.includes("content"), "section should remain");
  });

  it("strips whitespace-only text nodes between blocks", () => {
    const input = '<section>First</section>\n  \n<section>Second</section>';
    const result = cleanTailwindSource(input);
    // Sections should still be present, whitespace collapsed
    assert.ok(result.html.includes("First"), "first section present");
    assert.ok(result.html.includes("Second"), "second section present");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/tailwind-cleaner.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement cleanTailwindSource**

Write `src/core/tailwind-cleaner.ts`:

```typescript
import * as cheerio from "cheerio";

export interface CleanResult {
  html: string;
  warnings: string[];
}

/**
 * Structural cleanup for Tailwind-sourced HTML before conversion.
 * Pure function: HTML in → cleaned HTML out. Deterministic, no guessing.
 */
export function cleanTailwindSource(rawHtml: string): CleanResult {
  const warnings: string[] = [];
  const $ = cheerio.load(rawHtml, { decodeEntities: false, xmlMode: false });

  // Step 1: Wrap bare text nodes in block-level elements
  const BLOCK_TAGS = new Set(["section", "div", "header", "footer", "nav", "main", "article", "aside"]);
  $("*").each((_, el) => {
    const tag = (el as cheerio.TagElement).tagName?.toLowerCase();
    if (!tag || !BLOCK_TAGS.has(tag)) return;

    const $el = $(el);
    // Check for direct text nodes (not inside child elements)
    const childNodes = (el as cheerio.TagElement).childNodes || [];
    for (const child of childNodes) {
      if (child.type === "text") {
        const text = ((child as cheerio.TextElement).data || "").trim();
        if (text.length === 0) {
          $(child).remove();
          continue;
        }
        const wrapper = text.length < 60 ? "<span>" : "<p>";
        $(child).replaceWith(`${wrapper}${text}</${wrapper.replace("<", "</")}>`);
      }
    }
  });

  // Step 2: Strip empty divs
  $("div").each((_, el) => {
    const $el = $(el);
    const html = $el.html();
    if (!html || html.trim().length === 0) {
      $el.remove();
      warnings.push("Stripped empty div");
    }
  });

  // Step 3: Inject data-gb-path on elements the DOM walker processes
  const WALKER_TAGS = ["section", "div", "header", "footer", "nav", "main", "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "img", "svg"];
  let pathCounters: Record<string, number> = {};

  WALKER_TAGS.forEach(tag => {
    $(tag).each((_, el) => {
      const $el = $(el);
      // Build a stable path
      const id = $el.attr("id");
      const classes = $el.attr("class");
      let path: string;
      if (id) {
        path = `${tag}#${id}`;
      } else if (classes) {
        const firstClass = classes.split(/\s+/)[0];
        path = `${tag}.${firstClass}`;
      } else {
        pathCounters[tag] = (pathCounters[tag] || 0) + 1;
        path = `${tag}:nth-of-type(${pathCounters[tag]})`;
      }
      $el.attr("data-gb-path", path);
    });
  });

  return { html: $.html(), warnings };
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test tests/tailwind-cleaner.test.ts
```
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-cleaner.ts tests/tailwind-cleaner.test.ts
git commit -m "feat: add tailwind-cleaner — structural cleanup + data-gb-path injection"
```

---

### Task 3: Extend tailwind-inliner — capture computed styles

**Files:**
- Modify: `src/core/tailwind-inliner.ts` — add `captureComputedStyles()`, extend `InlinerResult`

- [ ] **Step 1: Add computed style capture to compileWithPlaywright**

In `src/core/tailwind-inliner.ts`, add after the existing `page.evaluate()` block that captures CSS:

```typescript
// After existing CSS capture payload, add:
// Capture computed styles for elements with data-gb-path
const computedPayload = await page.evaluate(() => {
  const CAPTURED_PROPERTIES = [
    "display", "flexDirection", "gap",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
    "textAlign", "textTransform", "color",
    "backgroundColor", "backgroundImage", "backgroundSize",
    "backgroundPosition", "backgroundRepeat",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
    "borderTopLeftRadius", "borderTopRightRadius",
    "borderBottomRightRadius", "borderBottomLeftRadius",
    "opacity", "boxShadow",
  ];

  const result: Record<string, Record<string, string>> = {};
  document.querySelectorAll("[data-gb-path]").forEach((el) => {
    const path = el.getAttribute("data-gb-path");
    if (!path) return;
    const computed = window.getComputedStyle(el);
    const props: Record<string, string> = {};
    for (const prop of CAPTURED_PROPERTIES) {
      const val = computed.getPropertyValue(prop.replace(/[A-Z]/g, m => "-" + m.toLowerCase()));
      if (val && val !== "none" && val !== "normal" && val !== "rgba(0, 0, 0, 0)") {
        props[prop] = val;
      }
    }
    if (Object.keys(props).length > 0) {
      result[path] = props;
    }
  });
  return result;
});
```

- [ ] **Step 2: Extend InlinerResult type**

Modify the `InlinerResult` interface to include `computedStyles`:

```typescript
export interface InlinerResult {
  html: string;
  stylesCss: string;
  classNames: string[];
  computedStyles: Record<string, Record<string, string>>;  // NEW
  warnings: string[];
}
```

- [ ] **Step 3: Update return statements**

Update all `return` statements in the inliner functions to include `computedStyles: {}` (for error paths) or `computedStyles: computedPayload` (for success path).

In `compileWithPlaywright`, update the success return:
```typescript
return {
  html,
  stylesCss: payload.css,
  classNames: payload.classNames,
  computedStyles: computedPayload,  // NEW
  warnings,
};
```

In the catch block and other returns:
```typescript
return { html, stylesCss: "", classNames: [], computedStyles: {}, warnings };
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
npx tsx --test tests/tailwind-cleaner.test.ts tests/renderer.test.ts
```
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: add computed style capture to tailwind-inliner Playwright session"
```

---

### Task 4: Style Classifier — frequency/type-based classification

**Files:**
- Create: `src/core/style-classifier.ts`
- Test: `tests/style-classifier.test.ts`

Pure function: takes computed styles + Tailwind config → produces classified output for Customizer, Global Styles, and Inline.

- [ ] **Step 1: Write failing test**

Write `tests/style-classifier.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyStyles } from "../src/core/style-classifier.js";

describe("classifyStyles", () => {
  // Simulated computed styles from our test fixture
  const computedStyles: Record<string, Record<string, string>> = {
    "section:nth-of-type(1)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(249, 250, 251)",
    },
    "section:nth-of-type(2)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(255, 255, 255)",
    },
    "section:nth-of-type(3)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(249, 250, 251)",
    },
    "section#hero": {
      paddingTop: "128px", paddingBottom: "128px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(255, 102, 0)", color: "rgb(255, 255, 255)",
    },
    "section:nth-of-type(5)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(204, 68, 0)", color: "rgb(255, 255, 255)",
    },
  };

  const config = {
    theme: { extend: { colors: { brand: { 500: "#ff6600", 700: "#cc4400" } } } }
  };

  it("classifies shared padding (≥3 uses) as Global Styles", () => {
    const result = classifyStyles(computedStyles, config);
    const sharedPad = result.globalStyles.find(g => g.css.includes("padding-top:64px"));
    assert.ok(sharedPad, "shared px-8 py-16 pattern should become a Global Style");
  });

  it("classifies unique section#hero styles as Inline", () => {
    const result = classifyStyles(computedStyles, config);
    const heroStyles = result.inlineStyles["section#hero"];
    assert.ok(heroStyles, "hero section should have inline styles");
    assert.ok(heroStyles.paddingTop === "128px" || Object.values(heroStyles).some(v => v === "128px"), "hero padding should be inline");
  });

  it("includes config colors that are actually used in Customizer", () => {
    const result = classifyStyles(computedStyles, config);
    assert.ok(result.customizer.colors["brand-500"], "brand-500 should be in customizer");
    assert.ok(result.customizer.colors["brand-700"], "brand-700 should be in customizer");
  });

  it("excludes config colors that are never used", () => {
    const configWithUnused = {
      theme: { extend: { colors: { brand: { 500: "#ff6600" }, unused: { 100: "#abcdef" } } } }
    };
    const result = classifyStyles(computedStyles, configWithUnused);
    assert.ok(!result.customizer.colors["unused-100"], "unused config color should be excluded");
  });

  it("handles empty computed styles gracefully", () => {
    const result = classifyStyles({}, null);
    assert.deepStrictEqual(result.customizer.colors, {});
    assert.deepStrictEqual(result.globalStyles, []);
    assert.deepStrictEqual(result.inlineStyles, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/style-classifier.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement classifyStyles**

Write `src/core/style-classifier.ts`:

```typescript
import { createHash } from "node:crypto";

export interface CustomizerOutput {
  colors: Record<string, string>;
  bodyFont: string;
  headingFont: string;
  baseFontSize: string;
}

export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}

export interface ClassifiedStyles {
  customizer: CustomizerOutput;
  globalStyles: GlobalStyleEntry[];
  inlineStyles: Record<string, Record<string, string>>;
}

/**
 * Flatten nested Tailwind config colors into flat token-name → hex map.
 * e.g., { brand: { 500: "#ff6600" } } → { "brand-500": "#ff6600" }
 */
function flattenConfigColors(
  colors: Record<string, unknown> | undefined,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!colors) return result;
  for (const [key, val] of Object.entries(colors)) {
    if (typeof val === "string") {
      const name = prefix ? `${prefix}-${key}` : key;
      result[name] = val;
    } else if (typeof val === "object" && val !== null) {
      const nestedPrefix = prefix ? `${prefix}-${key}` : key;
      Object.assign(result, flattenConfigColors(val as Record<string, unknown>, nestedPrefix));
    }
  }
  return result;
}

/**
 * Hash a set of CSS properties into a short identifier.
 */
function hashProperties(props: Record<string, string>): string {
  const sorted = Object.entries(props)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 8);
}

/**
 * Convert a camelCase CSS property name to kebab-case.
 */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

/**
 * Classify computed styles into Customizer / Global Styles / Inline.
 *
 * @param computedStyles - Per-element computed property map (path → props)
 * @param tailwindConfig - Parsed tailwind.config object (or null)
 * @param frequencyThreshold - Min occurrences for Global Styles (default 3)
 */
export function classifyStyles(
  computedStyles: Record<string, Record<string, string>>,
  tailwindConfig: Record<string, unknown> | null,
  frequencyThreshold = 3,
): ClassifiedStyles {
  const paths = Object.keys(computedStyles);

  // ── Customizer: colors ──
  const configColors = tailwindConfig
    ? flattenConfigColors(
        (tailwindConfig as any)?.theme?.extend?.colors ||
        (tailwindConfig as any)?.theme?.colors,
      )
    : {};

  // Determine which config colors are actually used in computed styles
  const usedColors: Record<string, string> = {};
  for (const [tokenName, hex] of Object.entries(configColors)) {
    // Check if any element's computed backgroundColor or color matches this hex approximately
    const hexLower = hex.toLowerCase();
    for (const props of Object.values(computedStyles)) {
      const bg = (props.backgroundColor || "").toLowerCase();
      const fg = (props.color || "").toLowerCase();
      if (bg.includes(hexLower) || fg.includes(hexLower)) {
        usedColors[tokenName] = hex;
        break;
      }
    }
  }

  // ── Customizer: fonts ──
  let bodyFont = "";
  let headingFont = "";
  let baseFontSize = "";

  for (const [path, props] of Object.entries(computedStyles)) {
    if (props.fontFamily && !bodyFont) {
      bodyFont = props.fontFamily.split(",")[0].replace(/"/g, "").trim();
    }
    if (props.fontSize && !baseFontSize && (path.includes("p:") || path.includes("body") || path.includes("html"))) {
      baseFontSize = props.fontSize;
    }
    if (props.fontFamily && (path.includes("h1") || path.includes("h2") || path.includes("h3"))) {
      headingFont = props.fontFamily.split(",")[0].replace(/"/g, "").trim();
    }
  }

  // ── Global Styles vs Inline: frequency-based ──
  // Count occurrences of each property set hash
  const hashCounts: Record<string, number> = {};
  const hashToProps: Record<string, Record<string, string>> = {};
  const pathHashes: Record<string, string[]> = {};

  for (const [path, props] of Object.entries(computedStyles)) {
    // Only consider properties that differ between elements (exclude empty props)
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v && v !== "0px" && v !== "normal" && v !== "none" && v !== "rgba(0, 0, 0, 0)") {
        filtered[k] = v;
      }
    }
    if (Object.keys(filtered).length === 0) continue;

    const hash = hashProperties(filtered);
    hashCounts[hash] = (hashCounts[hash] || 0) + 1;
    hashToProps[hash] = filtered;
    if (!pathHashes[path]) pathHashes[path] = [];
    pathHashes[path].push(hash);
  }

  // Global Styles: hashes appearing ≥ frequencyThreshold times
  const globalStyles: GlobalStyleEntry[] = [];
  const sharedHashes = new Set<string>();

  for (const [hash, count] of Object.entries(hashCounts)) {
    if (count >= frequencyThreshold) {
      sharedHashes.add(hash);
      const props = hashToProps[hash];
      const css = Object.entries(props)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${camelToKebab(k)}:${v}`)
        .join(";");
      globalStyles.push({
        name: `Shared Style gb-s-${hash}`,
        selector: `.gb-s-${hash}`,
        css,
      });
    }
  }

  // Inline styles: paths whose hashes are NOT all shared
  const inlineStyles: Record<string, Record<string, string>> = {};
  for (const [path, props] of Object.entries(computedStyles)) {
    const hashes = pathHashes[path] || [];
    const allShared = hashes.length > 0 && hashes.every(h => sharedHashes.has(h));
    if (!allShared) {
      // Only include properties whose hash is NOT shared
      const uniqueProps: Record<string, string> = {};
      for (const [k, v] of Object.entries(props)) {
        // Check each property individually: if any hash containing this key+value is shared, skip
        let isShared = false;
        for (const h of hashes) {
          if (sharedHashes.has(h) && hashToProps[h][k] === v) {
            isShared = true;
            break;
          }
        }
        if (!isShared) {
          uniqueProps[k] = v;
        }
      }
      if (Object.keys(uniqueProps).length > 0) {
        inlineStyles[path] = uniqueProps;
      }
    }
  }

  return {
    customizer: {
      colors: usedColors,
      bodyFont,
      headingFont,
      baseFontSize,
    },
    globalStyles,
    inlineStyles,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test tests/style-classifier.test.ts
```
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/style-classifier.ts tests/style-classifier.test.ts
git commit -m "feat: add style-classifier — frequency/type-based computed style classification"
```

---

### Task 5: Wire into orchestrator

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Add cleaner + classifier to convert pipeline**

In `src/core/orchestrator.ts`, add imports:

```typescript
import { cleanTailwindSource } from "./tailwind-cleaner.js";
import { classifyStyles } from "./style-classifier.js";
import { extractTailwindConfig } from "./tailwind-resolver.js";
```

Modify the `convert()` function. After `resetIds()` and before `inlineTailwindStyles()`:

```typescript
// Stage 0: Clean Tailwind source
let rawHtml = input.rawHtml;
let classifiedStyles: ClassifiedStyles | null = null;

if (!input.skipInliner && usesTailwind(rawHtml)) {
  const cleanResult = cleanTailwindSource(rawHtml);
  rawHtml = cleanResult.html;
  // Merge cleaner warnings
  cleanResult.warnings.forEach(m => inlinerWarnings.push({ code: "CLEANER", message: m }));
}

// Existing inliner block (modified to capture computedStyles):
if (!input.skipInliner && usesTailwind(rawHtml)) {
  const compiled = await inlineTailwindStyles(rawHtml);
  // ... existing code ...

  // Classify computed styles
  if (Object.keys(compiled.computedStyles).length > 0) {
    const config = extractTailwindConfig(input.rawHtml);
    classifiedStyles = classifyStyles(compiled.computedStyles, config ? JSON.parse(config) : null);

    // Emit Customizer output
    const customizer = generateCustomizerSettingsFromClassified(classifiedStyles.customizer);
    // (existing customizer generation is replaced/enhanced by this)
  }
}
```

- [ ] **Step 2: Pass classified styles to walker**

The DOM walker currently takes `prepResult.html`, `prepResult.classNameToProperties`, and `collector`. Add a fourth parameter for classified styles:

```typescript
const walkResult = walkDom(
  prepResult.html,
  prepResult.classNameToProperties,
  collector,
  input.skipStripNavFooter,
  classifiedStyles?.inlineStyles,  // NEW
);
```

- [ ] **Step 3: Update dom-walker to accept and use inline styles**

In `src/core/dom-walker.ts`, modify the `walkDom` signature:

```typescript
export function walkDom(
  html: string,
  classNameToProps: Map<string, Record<string, string>>,
  collector: GlobalStylesCollector,
  skipStripNavFooter?: boolean,
  inlineStyles?: Record<string, Record<string, string>>,  // NEW
): WalkResult {
```

When creating blocks, look up the element's `data-gb-path` in `inlineStyles`:

```typescript
// In makeElementBlock or equivalent:
const path = el.getAttribute("data-gb-path");
if (path && inlineStyles?.[path]) {
  block.styles = { ...block.styles, ...inlineStyles[path] };
  // Remove data-gb-path from output (it's an internal marker)
  el.removeAttribute("data-gb-path");
}
```

- [ ] **Step 4: Verify with existing tests**

```bash
npx tsx --test tests/*.test.ts
```
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts src/core/dom-walker.ts
git commit -m "feat: wire tailwind-cleaner + style-classifier into orchestrator and dom-walker"
```

---

### Task 6: Integration test — end-to-end with fixture

**Files:**
- Create: `tests/computed-styles-e2e.test.ts`

- [ ] **Step 1: Write integration test**

Write `tests/computed-styles-e2e.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convert } from "../src/core/orchestrator.js";

const FIXTURE = resolve(process.cwd(), "fixtures/computed-styles/simple-tailwind.html");

describe("computed-styles e2e", () => {
  it("converts Tailwind fixture with non-empty styles on blocks", async () => {
    const rawHtml = readFileSync(FIXTURE, "utf-8");
    const result = await convert({
      rawHtml,
      pageName: "simple-tailwind",
      projectDir: undefined,
      skipShared: true,
    });

    // Verify blocks have non-empty styles
    const hasStyles = result.blockHtml.includes('"styles":{') &&
      !result.blockHtml.includes('"styles":{}');
    // If styles promotion works, at least some blocks should have inline styles
    // (hero section with unique background, etc.)
    assert.ok(
      result.blockHtml.includes("backgroundColor") || hasStyles,
      "block output should include promoted styles from computed values"
    );

    // Verify block delimiters are present (correct format)
    assert.ok(result.blockHtml.includes("<!-- wp:generateblocks/element"), "should have element blocks");
  });

  it("produces renderable standalone HTML from the conversion", async () => {
    const { renderStandalone } = await import("../src/core/renderer.js");
    const rawHtml = readFileSync(FIXTURE, "utf-8");
    const result = await convert({ rawHtml, pageName: "simple-tailwind", skipShared: true });

    // The result.blockHtml contains GB blocks — we need to save and render
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const tmpDir = resolve(process.cwd(), "fixtures/computed-styles/output");
    mkdirSync(resolve(tmpDir, "pages"), { recursive: true });
    mkdirSync(resolve(tmpDir, "setup"), { recursive: true });
    writeFileSync(resolve(tmpDir, "pages", "simple-tailwind.html"), result.blockHtml, "utf-8");
    writeFileSync(resolve(tmpDir, "pages", "styles.css"), "", "utf-8");
    writeFileSync(resolve(tmpDir, "setup", "styles-unique.css"), "", "utf-8");
    writeFileSync(resolve(tmpDir, "setup", "global-styles.json"), "[]", "utf-8");

    const html = renderStandalone(tmpDir, "simple-tailwind");
    assert.ok(html.startsWith("<!DOCTYPE html>"), "should produce valid HTML");
    assert.ok(!html.includes("<!-- wp:"), "should have zero block delimiters");
    assert.ok(html.includes("Hero Heading"), "should contain content");
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
npx tsx --test tests/computed-styles-e2e.test.ts
```
Expected: PASS — the fixture converts and styles are promoted.

- [ ] **Step 3: Commit**

```bash
git add tests/computed-styles-e2e.test.ts
git commit -m "test: add e2e integration test for computed-style promotion pipeline"
```

---

### Task 7: HKVC re-conversion — verify improvement

**Files:**
- None (verification only)

- [ ] **Step 1: Clean HKVC output and convert**

```bash
rm -rf output/hkvc/
npx tsx src/cli/index.ts convert inputs/hkvc/
```

- [ ] **Step 2: Check block output for promoted styles**

```bash
grep -o '"styles":{[^}]*}' output/hkvc/pages/index.html | grep -v '"styles":{}' | head -10
```
Expected: Non-empty `styles` objects on blocks (background colors, padding, etc.).

- [ ] **Step 3: Render and compare**

```bash
npx tsx src/cli/index.ts render output/hkvc/ --source inputs/hkvc/index.html
npx tsx src/cli/index.ts compare inputs/hkvc/index.html output/hkvc/
```
Expected: Mismatch significantly below 44% (target: well under the previous 24% content mismatch).

- [ ] **Step 4: Commit verification results**

```bash
git add output/hkvc/verify/verification-log.json
git commit -m "verify: HKVC re-conversion after computed-style promotion — mismatch X%"
```

---

### Task 8: Run all tests and finalize

- [ ] **Step 1: Run all tests**

```bash
npx tsx --test tests/*.test.ts
```
Expected: All tests pass.

- [ ] **Step 2: Commit any final changes**

```bash
git add -A
git commit -m "chore: finalize computed-style promotion — all tests passing"
```
