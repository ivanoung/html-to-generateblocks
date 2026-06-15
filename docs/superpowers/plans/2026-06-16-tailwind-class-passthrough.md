# Tailwind Class Passthrough — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Tailwind CSS class passthrough to the gb-converter pipeline — extract Tailwind config from source HTML, compile static tailwind.css, pass utility classes through to block className attributes, and generate a companion WordPress plugin.

**Architecture:** Three new modules (extractor, translator, compiler) run before the preprocessor to produce `tailwind.css` and a known-classes manifest. The DOM walker splits each element's classes into Tailwind (→ block `className`) vs. custom CSS (→ existing styles pipeline). The serializer emits `className` in block JSON and rendered HTML. The orchestrator wires the new stage and generates a companion WordPress plugin.

**Tech Stack:** TypeScript, Cheerio (HTML parsing), Tailwind CSS v4.3.0 CLI, Node.js built-in test runner, PHP (generated plugin)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/core/types.ts` | Modify | Add `className` to `Block` interface |
| `src/core/tailwind-extractor.ts` | Create | Extract `tailwind.config = {...}` from raw HTML |
| `src/core/tailwind-translator.ts` | Create | Translate JS config → v4 `@theme` CSS block |
| `src/core/tailwind-compiler.ts` | Create | Run Tailwind CLI, scan output for known-classes manifest |
| `src/core/dom-walker.ts` | Modify | Add `tailwindClasses` to `WalkerOptions`, class splitting in `extractGlobalClasses` |
| `src/core/serializer.ts` | Modify | Emit `className` in block JSON attrs + rendered HTML |
| `src/core/orchestrator.ts` | Modify | Wire Tailwind stage before preprocessor, write `tailwind.css` / manifest / plugin |
| `tests/tailwind-extractor.test.ts` | Create | Unit tests for config extraction |
| `tests/tailwind-translator.test.ts` | Create | Unit tests for JS → @theme translation |
| `tests/tailwind-compiler.test.ts` | Create | Unit tests for manifest scanning |
| `tests/tailwind-passthrough.test.ts` | Create | Integration tests for full pipeline |
| `fixtures/tailwind-passthrough.html` | Create | Mixed-class test fixture (Tailwind + custom + unknown) |

---

### Task 1: Add `className` to Block type

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/serializer.ts` (attribute builders + HTML renderers)

- [ ] **Step 1: Add `className` field to Block interface**

Open `src/core/types.ts` and add `className?: string;` to the `Block` interface after `globalClasses`:

```ts
export interface Block {
  blockName: BlockName;
  uniqueId: string;
  tagName?: string;
  content?: string;
  styles: BlockStyles;
  css: string;
  globalClasses?: string[];
  className?: string;          // Tailwind passthrough classes (space-separated)
  htmlAttributes?: Record<string, string>;
  // ... rest unchanged
}
```

- [ ] **Step 2: Add `className` to element attribute builder**

Open `src/core/serializer.ts`. In `buildElementAttrs()`, after the `align` block, add:

```ts
function buildElementAttrs(block: Block): Record<string, unknown> {
  // ... existing code ...
  if (block.align) {
    attrs.align = block.align;
  }
  // NEW: Tailwind className passthrough
  if (block.className) {
    attrs.className = block.className;
  }

  return attrs;
}
```

- [ ] **Step 3: Add `className` to text attribute builder**

In `buildTextAttrs()`, after the `iconOnly` block, add:

```ts
function buildTextAttrs(block: Block): Record<string, unknown> {
  // ... existing code ...
  if (block.iconOnly) attrs.iconOnly = block.iconOnly;
  // NEW: Tailwind className passthrough
  if (block.className) {
    attrs.className = block.className;
  }

  return attrs;
}
```

- [ ] **Step 4: Add `className` to media attribute builder**

In `buildMediaAttrs()`, after the `linkHtmlAttributes` block, add:

```ts
function buildMediaAttrs(block: Block): Record<string, unknown> {
  // ... existing code ...
  if (block.linkHtmlAttributes && Object.keys(block.linkHtmlAttributes).length > 0) {
    attrs.linkHtmlAttributes = block.linkHtmlAttributes;
  }
  // NEW: Tailwind className passthrough
  if (block.className) {
    attrs.className = block.className;
  }

  return attrs;
}
```

- [ ] **Step 5: Add `className` to shape attribute builder**

In `buildShapeAttrs()`, after the `htmlAttributes` block, add:

```ts
function buildShapeAttrs(block: Block): Record<string, unknown> {
  // ... existing code ...
  if (block.htmlAttributes && Object.keys(block.htmlAttributes).length > 0) {
    attrs.htmlAttributes = block.htmlAttributes;
  }
  // NEW: Tailwind className passthrough
  if (block.className) {
    attrs.className = block.className;
  }
  return attrs;
}
```

- [ ] **Step 6: Add `className` to rendered element HTML**

In `renderElementHtml()`, add `className` to the class string after `globalClasses`:

```ts
function renderElementHtml(block: Block): string {
  const tag = block.tagName ?? "div";
  const gbClasses = `gb-element-${block.uniqueId} gb-element`;
  const globalClasses = (block.globalClasses || []).join(" ");
  const twClasses = block.className || "";
  const parts = [gbClasses];
  if (globalClasses) parts.push(globalClasses);
  if (twClasses) parts.push(twClasses);
  const classes = parts.join(" ");
  const attrs = renderHtmlAttributes(block.htmlAttributes);
  const alignClass = block.align ? ` ${block.align === "full" ? "alignfull" : block.align}` : "";

  return `<${tag} class="${classes}${alignClass}"${attrs}>`;
}
```

- [ ] **Step 7: Add `className` to rendered text HTML**

In `renderTextHtml()`, add `className` to the class string:

```ts
function renderTextHtml(block: Block): string {
  const tag = block.tagName ?? "p";
  const gbClasses = `gb-text gb-text-${block.uniqueId}`;
  const globalClasses = (block.globalClasses || []).join(" ");
  const twClasses = block.className || "";
  const parts = [gbClasses];
  if (globalClasses) parts.push(globalClasses);
  if (twClasses) parts.push(twClasses);
  const classes = parts.join(" ");

  const attrs = renderHtmlAttributes(block.htmlAttributes);

  const content = block.content ?? "";
  return `<${tag} class="${classes}"${attrs}>${content}</${tag}>`;
}
```

- [ ] **Step 8: Run existing tests to verify no regressions**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/*.test.ts
```
Expected: All existing tests pass (className is optional, so no changes break anything).

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/serializer.ts
git commit -m "feat: add className field to Block type and serializer output"
```

---

### Task 2: Tailwind Config Extractor

**Files:**
- Create: `src/core/tailwind-extractor.ts`
- Create: `tests/tailwind-extractor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tailwind-extractor.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { extractTailwindConfig } from "../src/core/tailwind-extractor.js";

describe("extractTailwindConfig", () => {
  it("extracts a simple tailwind.config object from a <script> tag", () => {
    const html = `<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: { primary: "#C5FFD6" }
    }
  }
}
</script>`;

    const result = extractTailwindConfig(html);
    assert.ok(result, "should extract config");
    assert.ok(result.config.theme.extend.colors.primary === "#C5FFD6");
  });

  it("returns null when no tailwind.config is found", () => {
    const html = `<html><body><p>No config here</p></body></html>`;
    const result = extractTailwindConfig(html);
    assert.strictEqual(result, null);
  });

  it("handles config with multiple theme extensions", () => {
    const html = `<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: "#C5FFD6",
        surface: "#1E293B"
      },
      fontFamily: {
        display: ["Anybody", "sans-serif"]
      }
    }
  }
}
</script>`;

    const result = extractTailwindConfig(html);
    assert.ok(result);
    assert.strictEqual(result.config.theme.extend.colors.surface, "#1E293B");
    assert.deepStrictEqual(result.config.theme.extend.fontFamily.display, ["Anybody", "sans-serif"]);
  });

  it("warns on malformed config and returns null", () => {
    const html = `<script>
tailwind.config = { theme: { extend: { colors: { primary: "#C5FFD6" } }  // missing closing brace
</script>`;
    const result = extractTailwindConfig(html);
    assert.strictEqual(result, null);
  });

  it("extracts config from minified script", () => {
    const html = `<script>tailwind.config={theme:{extend:{colors:{primary:"#C5FFD6"}}}}</script>`;
    const result = extractTailwindConfig(html);
    assert.ok(result);
    assert.strictEqual(result.config.theme.extend.colors.primary, "#C5FFD6");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/tailwind-extractor.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/tailwind-extractor.ts`:

```ts
// ── Tailwind Config Extractor ──────────────────────────────
//
// Extracts `tailwind.config = {...}` from <script> blocks in raw HTML.
// Returns the parsed config object and the raw config string.
// Returns null if no config found or parsing fails.

export interface TailwindConfigResult {
  config: Record<string, unknown>;
  rawConfig: string;
}

export function extractTailwindConfig(rawHtml: string): TailwindConfigResult | null {
  // Find script block containing tailwind.config
  const configRegex = /tailwind\.config\s*=\s*(\{[\s\S]*?\n\})/;
  const match = configRegex.exec(rawHtml);

  if (!match) return null;

  const rawConfig = match[1];

  try {
    // Use Function constructor as a lightweight JS parser for the config object
    // This handles nested objects, arrays, and quoted strings correctly
    // (far more robust than regex-based key-value extraction)
    const config = new Function(`return ${rawConfig}`)() as Record<string, unknown>;
    return { config, rawConfig };
  } catch {
    // Malformed config — parsing failed
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/tailwind-extractor.test.ts
```
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-extractor.ts tests/tailwind-extractor.test.ts
git commit -m "feat: add Tailwind config extractor with Function() parsing"
```

---

### Task 3: Tailwind JS → v4 @theme Translator

**Files:**
- Create: `src/core/tailwind-translator.ts`
- Create: `tests/tailwind-translator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tailwind-translator.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { translateConfigToTheme } from "../src/core/tailwind-translator.js";

describe("translateConfigToTheme", () => {
  it("translates colors", () => {
    const config = {
      theme: { extend: { colors: { primary: "#C5FFD6", surface: "#1E293B" } } }
    };
    const result = translateConfigToTheme(config as any);
    assert.ok(result.css.includes("--color-primary: #C5FFD6;"));
    assert.ok(result.css.includes("--color-surface: #1E293B;"));
    assert.strictEqual(result.warnings.length, 0);
  });

  it("translates fontFamily arrays", () => {
    const config = {
      theme: { extend: { fontFamily: { display: ["Anybody", "sans-serif"] } } }
    };
    const result = translateConfigToTheme(config as any);
    assert.ok(result.css.includes('--font-display: "Anybody", sans-serif;'));
  });

  it("translates multiple key types in one config", () => {
    const config = {
      theme: {
        extend: {
          colors: { primary: "#C5FFD6" },
          fontFamily: { sans: ["DM Sans", "sans-serif"] },
          maxWidth: { container: "1600px" },
          spacing: { 18: "4.5rem" },
          borderRadius: { xl: "1rem" }
        }
      }
    };
    const result = translateConfigToTheme(config as any);
    assert.ok(result.css.includes("--color-primary: #C5FFD6;"));
    assert.ok(result.css.includes('--font-sans: "DM Sans", sans-serif;'));
    assert.ok(result.css.includes("--max-width-container: 1600px;"));
    assert.ok(result.css.includes("--spacing-18: 4.5rem;"));
    assert.ok(result.css.includes("--radius-xl: 1rem;"));
  });

  it("warns on unsupported keys and skips them", () => {
    const config = {
      theme: { extend: { unknownKey: { foo: "bar" } } }
    };
    const result = translateConfigToTheme(config as any);
    assert.strictEqual(result.css, "");
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0].includes("unknownKey"));
  });

  it("warns when no theme.extend is present", () => {
    const config = { theme: {} };
    const result = translateConfigToTheme(config as any);
    assert.strictEqual(result.css, "");
    assert.ok(result.warnings.length > 0);
  });

  it("handles empty config object", () => {
    const config = {};
    const result = translateConfigToTheme(config as any);
    assert.strictEqual(result.css, "");
    assert.ok(result.warnings.length > 0);
  });

  it("translates boxShadow to --shadow", () => {
    const config = {
      theme: { extend: { boxShadow: { card: "0 2px 8px rgba(0,0,0,0.1)" } } }
    };
    const result = translateConfigToTheme(config as any);
    assert.ok(result.css.includes("--shadow-card: 0 2px 8px rgba(0,0,0,0.1);"));
  });

  it("translates zIndex", () => {
    const config = {
      theme: { extend: { zIndex: { modal: "100" } } }
    };
    const result = translateConfigToTheme(config as any);
    assert.ok(result.css.includes("--z-index-modal: 100;"));
  });

  it("translates opacity", () => {
    const config = {
      theme: { extend: { opacity: { dim: "0.5" } } }
    };
    const result = translateConfigToTheme(config as any);
    assert.ok(result.css.includes("--opacity-dim: 0.5;"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/tailwind-translator.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/tailwind-translator.ts`:

```ts
// ── Tailwind JS → v4 @theme Translator ────────────────────
//
// Translates a JS tailwind.config object into a CSS @theme block
// compatible with Tailwind CSS v4 CLI.
// Supports the 13 theme keys listed in the design spec.
// Unsupported keys are warned and skipped.

export interface TranslateResult {
  css: string;
  warnings: string[];
}

// Map JS config theme keys to v4 CSS custom property prefixes
const KEY_MAP: Record<string, string> = {
  colors: "--color",
  fontFamily: "--font",
  fontSize: "--font-size",
  fontWeight: "--font-weight",
  lineHeight: "--line-height",
  letterSpacing: "--letter-spacing",
  spacing: "--spacing",
  maxWidth: "--max-width",
  borderRadius: "--radius",
  boxShadow: "--shadow",
  zIndex: "--z-index",
  opacity: "--opacity",
  screens: "--breakpoint",
};

function toCssValue(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    // Font family arrays: ["Anybody", "sans-serif"] → "Anybody", sans-serif
    return val.map((v) => (typeof v === "string" && v.includes(" ") ? `"${v}"` : String(v))).join(", ");
  }
  return String(val);
}

export function translateConfigToTheme(config: Record<string, unknown>): TranslateResult {
  const warnings: string[] = [];
  const cssLines: string[] = [];

  const theme = config?.theme as Record<string, unknown> | undefined;
  const extend = theme?.extend as Record<string, Record<string, unknown>> | undefined;

  if (!extend || typeof extend !== "object") {
    warnings.push("No theme.extend found in config — nothing to translate");
    return { css: "", warnings };
  }

  for (const [key, values] of Object.entries(extend)) {
    const prefix = KEY_MAP[key];
    if (!prefix) {
      warnings.push(`Unsupported theme key: "${key}" — skipping`);
      continue;
    }

    if (typeof values !== "object" || values === null) {
      warnings.push(`Skipping "${key}": value is not an object`);
      continue;
    }

    for (const [name, val] of Object.entries(values)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        warnings.push(`Skipping "${key}.${name}": complex nested object not supported`);
        continue;
      }
      cssLines.push(`  ${prefix}-${name}: ${toCssValue(val)};`);
    }
  }

  if (cssLines.length === 0) {
    warnings.push("No translatable values found in theme.extend");
    return { css: "", warnings };
  }

  const css = `@theme {\n${cssLines.join("\n")}\n}`;
  return { css, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/tailwind-translator.test.ts
```
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-translator.ts tests/tailwind-translator.test.ts
git commit -m "feat: add JS config → v4 @theme translator with 13 key mappings"
```

---

### Task 4: Tailwind Compiler & Manifest Generator

**Files:**
- Create: `src/core/tailwind-compiler.ts`
- Create: `tests/tailwind-compiler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tailwind-compiler.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { scanTailwindCss } from "../src/core/tailwind-compiler.js";

describe("scanTailwindCss", () => {
  it("extracts simple utility classes from compiled CSS", () => {
    const css = `
.flex { display: flex; }
.grid { display: grid; }
.items-center { align-items: center; }
.bg-primary { background-color: #C5FFD6; }
`;

    const classes = scanTailwindCss(css);
    assert.ok(classes instanceof Set);
    assert.ok(classes.has("flex"));
    assert.ok(classes.has("grid"));
    assert.ok(classes.has("items-center"));
    assert.ok(classes.has("bg-primary"));
    assert.strictEqual(classes.size, 4);
  });

  it("extracts responsive variants", () => {
    const css = `
@media (min-width: 768px) {
  .md\\:flex { display: flex; }
  .md\\:grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
}
`;

    const classes = scanTailwindCss(css);
    assert.ok(classes.has("md:flex"));
    assert.ok(classes.has("md:grid-cols-2"));
  });

  it("extracts state variants", () => {
    const css = `
.hover\\:bg-primary:hover { background-color: #C5FFD6; }
.focus\\:ring:focus { box-shadow: 0 0 0 3px rgba(59,130,246,0.5); }
`;

    const classes = scanTailwindCss(css);
    assert.ok(classes.has("hover:bg-primary"));
    assert.ok(classes.has("focus:ring"));
  });

  it("extracts arbitrary value classes", () => {
    const css = `
.w-\\[42px\\] { width: 42px; }
.text-\\[\\#bada55\\] { color: #bada55; }
`;

    const classes = scanTailwindCss(css);
    assert.ok(classes.has("w-[42px]"));
    assert.ok(classes.has("text-[#bada55]"));
  });

  it("ignores non-class selectors", () => {
    const css = `
body { margin: 0; }
#header { padding: 1rem; }
[data-attr] { color: red; }
::before { content: ""; }
`;

    const classes = scanTailwindCss(css);
    assert.strictEqual(classes.size, 0);
  });

  it("returns empty set for empty CSS", () => {
    const classes = scanTailwindCss("");
    assert.strictEqual(classes.size, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/tailwind-compiler.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/tailwind-compiler.ts`:

```ts
// ── Tailwind Compiler & Manifest Generator ─────────────────
//
// Scans compiled tailwind.css output to extract known class names.
// Handles standard classes, responsive variants (md:flex),
// state variants (hover:bg-primary), and arbitrary values (w-[42px]).

/**
 * Scan compiled Tailwind CSS output and extract all class selectors.
 * Returns a Set of de-escaped class names suitable for Set.has() lookups
 * during DOM walking.
 */
export function scanTailwindCss(compiledCss: string): Set<string> {
  const classes = new Set<string>();

  // Matches CSS class selectors:
  // .flex, .items-center, .md\:flex, .hover\:bg-primary, .w-\[42px\]
  // Captures the class name including escaped characters
  const classRegex = /\.((?:[a-zA-Z0-9\[\]\/\#\.\:%_@-]|\\.)+)/g;

  let match;
  while ((match = classRegex.exec(compiledCss)) !== null) {
    let className = match[1];

    // De-escape CSS escapes: \: → :, \. → ., \/ → /, \[ → [, \] → ], \# → #
    className = className.replace(/\\(.)/g, "$1");

    // Skip pseudo-classes and pseudo-elements attached to the class
    // e.g., .flex:hover → we want "flex", not "flex:hover"
    const pseudoIdx = className.search(/[:]{1,2}[\w-]+$/);
    if (pseudoIdx !== -1) {
      className = className.substring(0, pseudoIdx);
    }

    if (className.length > 0) {
      classes.add(className);
    }
  }

  return classes;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/tailwind-compiler.test.ts
```
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-compiler.ts tests/tailwind-compiler.test.ts
git commit -m "feat: add Tailwind CSS class scanner for manifest generation"
```

---

### Task 5: Tailwind Pipeline Coordinator (new core module)

**Files:**
- Create: `src/core/tailwind-pipeline.ts`

- [ ] **Step 1: Write the coordinator module**

Create `src/core/tailwind-pipeline.ts`:

```ts
// ── Tailwind Pipeline Coordinator ─────────────────────────
//
// Orchestrates the three Tailwind stages:
//   1. Extract config from source HTML
//   2. Translate JS config → v4 @theme CSS
//   3. Compile tailwind.css + scan for known-classes manifest
//
// Returns null gracefully on any failure — Tailwind is an enhancement,
// not a dependency. Also generates the companion WordPress plugin.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { extractTailwindConfig } from "./tailwind-extractor.js";
import { translateConfigToTheme } from "./tailwind-translator.js";
import { scanTailwindCss } from "./tailwind-compiler.js";

export interface TailwindPipelineResult {
  /** Set of known Tailwind class names for DOM walker classification */
  tailwindClasses: Set<string>;
  /** Manifest as a sorted JSON array (for companion plugin safelist) */
  manifestJson: string;
  /** Compiled tailwind.css content */
  tailwindCss: string;
  /** Companion plugin PHP content */
  pluginPhp: string;
}

export function runTailwindPipeline(
  rawHtml: string,
  projectDir: string,
  outDir: string,
): { result: TailwindPipelineResult | null; warnings: string[] } {
  const warnings: string[] = [];

  // Stage 1: Extract config
  const extracted = extractTailwindConfig(rawHtml);
  if (!extracted) {
    // Silent skip — no Tailwind config in source
    return { result: null, warnings };
  }

  // Stage 2: Translate JS config → v4 @theme
  const { css: themeCss, warnings: translateWarnings } = translateConfigToTheme(extracted.config);
  warnings.push(...translateWarnings.map((w) => `Tailwind translate: ${w}`));
  if (!themeCss) {
    return { result: null, warnings };
  }

  // Stage 3: Compile with Tailwind CLI
  const inputCss = `@import "tailwindcss";\n\n${themeCss}\n`;
  const pagesDir = resolve(outDir, "pages");
  mkdirSync(pagesDir, { recursive: true });

  const inputPath = resolve(pagesDir, ".tw-input.css");
  const outputPath = resolve(outDir, "tailwind.css");
  writeFileSync(inputPath, inputCss, "utf-8");

  let compiledCss: string;
  try {
    execSync(`npx @tailwindcss/cli -i "${inputPath}" -o "${outputPath}"`, {
      stdio: "pipe",
      timeout: 30_000,
    });
    const { readFileSync } = require("node:fs");
    compiledCss = readFileSync(outputPath, "utf-8");
  } catch (err: any) {
    const stderr = err.stderr?.toString() || err.message;
    warnings.push(`Tailwind CLI failed: ${stderr.slice(0, 200)}`);
    return { result: null, warnings };
  }

  // Stage 4: Scan for known classes manifest
  const tailwindClasses = scanTailwindCss(compiledCss);
  const manifestSorted = [...tailwindClasses].sort();
  const manifestJson = JSON.stringify(manifestSorted, null, 2);

  // Stage 5: Generate companion WordPress plugin
  const pluginPhp = generatePluginPhp();

  return {
    result: { tailwindClasses, manifestJson, tailwindCss: compiledCss, pluginPhp },
    warnings,
  };
}

function generatePluginPhp(): string {
  return `<?php
/**
 * Plugin Name: GB Tailwind Styles
 * Description: Enqueues Tailwind CSS for GenerateBlocks sites. Auto-generated by gb-converter.
 * Version: 1.0.0
 */

define('GB_TW_DIR', __DIR__);

function gb_tw_enqueue_frontend() {
    $tw_css = GB_TW_DIR . '/tailwind.css';
    $styles_css = GB_TW_DIR . '/pages/styles.css';
    if (file_exists($tw_css)) {
        wp_enqueue_style('gb-tailwind', plugin_dir_url(__FILE__) . 'tailwind.css', [], filemtime($tw_css));
    }
    if (file_exists($styles_css)) {
        wp_enqueue_style('gb-custom', plugin_dir_url(__FILE__) . 'pages/styles.css', [], filemtime($styles_css));
    }
}
add_action('wp_enqueue_scripts', 'gb_tw_enqueue_frontend');

function gb_tw_enqueue_editor() {
    $tw_css = GB_TW_DIR . '/tailwind.css';
    $styles_css = GB_TW_DIR . '/pages/styles.css';
    if (file_exists($tw_css)) {
        wp_enqueue_style('gb-tailwind-editor', plugin_dir_url(__FILE__) . 'tailwind.css', [], filemtime($tw_css));
    }
    if (file_exists($styles_css)) {
        wp_enqueue_style('gb-custom-editor', plugin_dir_url(__FILE__) . 'pages/styles.css', [], filemtime($styles_css));
    }
}
add_action('enqueue_block_editor_assets', 'gb_tw_enqueue_editor');

function gb_tw_safelist_classes($settings) {
    $manifest = GB_TW_DIR . '/tailwind-manifest.json';
    if (!file_exists($manifest)) return $settings;
    $classes = json_decode(file_get_contents($manifest), true);
    if (!is_array($classes)) return $settings;
    $settings['allowedBlockClasses'] = array_merge(
        $settings['allowedBlockClasses'] ?? [],
        $classes
    );
    return $settings;
}
add_filter('block_editor_settings_all', 'gb_tw_safelist_classes');
`;
}
```

- [ ] **Step 2: Run all existing tests to verify no regressions**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/*.test.ts
```
Expected: All existing tests pass. The new module is not wired in yet.

- [ ] **Step 3: Commit**

```bash
git add src/core/tailwind-pipeline.ts
git commit -m "feat: add Tailwind pipeline coordinator with CLI compilation"
```

---

### Task 6: Modify DOM Walker for Class Splitting

**Files:**
- Modify: `src/core/dom-walker.ts`

- [ ] **Step 1: Add `tailwindClasses` to `WalkerOptions`**

Open `src/core/dom-walker.ts`. Add `tailwindClasses` to the `WalkerOptions` interface:

```ts
interface WalkerOptions {
  classNameToProperties: Map<string, BlockStyles>;
  collector: GlobalStylesCollector;
  warnings: string[];
  hardFails: { code: string; message: string }[];
  inlineStyles?: Record<string, Record<string, string>>;
  tailwindClasses?: Set<string>;  // NEW
}
```

- [ ] **Step 2: Replace `extractGlobalClasses` with class-splitting logic**

Replace the entire `extractGlobalClasses` function with:

```ts
// ── Warning filter for unknown classes ────────────────────────

/** Classes from WordPress core and common plugins — suppress warnings. */
const BENIGN_CLASS_PREFIXES = [
  "wp-", "has-", "is-", "align", "gb-", "iconify-", "icon-", "js-",
  "post-", "page-", "menu-", "widget-", "comment-", "search-",
  "archive-", "author-", "category-", "tag-", "attachment-",
  "gallery-", "blocks-gallery-", "wp-caption-",
];

const BENIGN_CLASS_EXACT = new Set([
  "no-js", "screen-reader-text", "skip-link", "sticky", "bypostauthor",
  "admin-bar", "custom-background", "custom-logo", "custom-header",
]);

/** Pattern for classes that look like custom CSS (warn-worthy). */
const CUSTOM_CLASS_PATTERN = /^[a-zA-Z][\w-]*(?:[-_][\w-]+)+$/;

function isBenignClass(className: string): boolean {
  if (BENIGN_CLASS_EXACT.has(className)) return true;
  return BENIGN_CLASS_PREFIXES.some((prefix) => className.startsWith(prefix));
}

// ── Core class splitting ──────────────────────────────────

export interface ClassSplitResult {
  /** Tailwind utility classes → passthrough to block className */
  tailwindClasses: string[];
  /** Custom CSS classes → resolve to GB styles */
  globalClasses: string[];
}

export function splitClasses(
  classAttr: string,
  tailwindClasses?: Set<string>,
): ClassSplitResult {
  const classNames = classAttr.split(/\s+/).filter((c) => c.length > 0);
  const tw: string[] = [];
  const global: string[] = [];

  for (const cls of classNames) {
    if (tailwindClasses?.has(cls)) {
      // Tailwind class → passthrough to className (even if also in classNameToProperties)
      tw.push(cls);
    } else {
      // Custom or unknown → keep in globalClasses for existing styles pipeline
      global.push(cls);
    }
  }

  return { tailwindClasses: tw, globalClasses };
}

// ── Modified global class extraction ───────────────────────

function extractGlobalClasses(
  $el: cheerio.Cheerio<any>,
  opts: WalkerOptions,
): { globalClasses: string[]; className?: string } {
  const classAttr = ($el.attr("class") || "").trim();
  if (!classAttr) return { globalClasses: [] };

  const { tailwindClasses: twList, globalClasses } = splitClasses(classAttr, opts.tailwindClasses);

  // Track custom classes in collector for the global-styles manifest
  for (const cls of globalClasses) {
    if (opts.classNameToProperties.has(cls)) {
      opts.collector.recordUsage(cls);
    } else if (!isBenignClass(cls) && CUSTOM_CLASS_PATTERN.test(cls)) {
      // Unknown class that looks like custom CSS — warn
      opts.warnings.push(`Unknown class "${cls}" — no style definition found`);
    }
  }

  // Dedup and preserve order from source HTML
  const className = twList.length > 0
    ? [...new Set(twList)].join(" ")
    : undefined;

  return { globalClasses, className };
}
```

- [ ] **Step 3: Update call sites — `makeTextBlock` (line ~246)**

Replace:
```ts
const globalClasses = extractGlobalClasses($el, opts);

// Content is innerHTML (preserves inline formatting, strips comments)
const content = stripHtmlComments($el.html()) || $el.text() || "";

return {
  blockName: "generateblocks/text",
  uniqueId: nextId("text"),
  tagName: tag,
  content,
  styles,
  css,
  globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
  htmlAttributes:
    Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
  innerBlocks: [],
};
```

With:
```ts
const { globalClasses, className: elClassName } = extractGlobalClasses($el, opts);

// Content is innerHTML (preserves inline formatting, strips comments)
const content = stripHtmlComments($el.html()) || $el.text() || "";

return {
  blockName: "generateblocks/text",
  uniqueId: nextId("text"),
  tagName: tag,
  content,
  styles,
  css,
  globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
  className: elClassName,
  htmlAttributes:
    Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
  innerBlocks: [],
};
```

- [ ] **Step 4: Update call sites — `makeElementBlock` (line ~283)**

Replace:
```ts
const htmlAttributes = extractHtmlAttributes($el);
const globalClasses = extractGlobalClasses($el, opts);

// Query computed styles from the classifier (direct lookup, no HTML round-trip)
const path = $el.attr("data-gb-path");
if (path && opts.inlineStyles?.[path]) {
  Object.assign(styles, opts.inlineStyles[path]);
}
// Remove data-gb-path (internal marker, don't leak into output)
$el.removeAttr("data-gb-path");

return {
  blockName: "generateblocks/element",
  uniqueId: nextId("elem"),
  tagName: tag,
  styles,
  css,
  globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
  htmlAttributes:
    Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
  innerBlocks: [],
};
```

With:
```ts
const htmlAttributes = extractHtmlAttributes($el);
const { globalClasses, className: elClassName } = extractGlobalClasses($el, opts);

// Query computed styles from the classifier (direct lookup, no HTML round-trip)
const path = $el.attr("data-gb-path");
if (path && opts.inlineStyles?.[path]) {
  Object.assign(styles, opts.inlineStyles[path]);
}
// Remove data-gb-path (internal marker, don't leak into output)
$el.removeAttr("data-gb-path");

return {
  blockName: "generateblocks/element",
  uniqueId: nextId("elem"),
  tagName: tag,
  styles,
  css,
  globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
  className: elClassName,
  htmlAttributes:
    Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
  innerBlocks: [],
};
```

- [ ] **Step 5: Update call sites — `makeMediaBlock` (line ~324)**

Replace:
```ts
const globalClasses = extractGlobalClasses($el, opts);

// Query computed styles from the classifier
const path = $el.attr("data-gb-path");
if (path && opts.inlineStyles?.[path]) {
  Object.assign(styles, opts.inlineStyles[path]);
}
$el.removeAttr("data-gb-path");

return {
  blockName: "generateblocks/media",
  uniqueId: nextId("img"),
  tagName: "img",
  styles,
  css,
  globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
```

With:
```ts
const { globalClasses, className: elClassName } = extractGlobalClasses($el, opts);

// Query computed styles from the classifier
const path = $el.attr("data-gb-path");
if (path && opts.inlineStyles?.[path]) {
  Object.assign(styles, opts.inlineStyles[path]);
}
$el.removeAttr("data-gb-path");

return {
  blockName: "generateblocks/media",
  uniqueId: nextId("img"),
  tagName: "img",
  styles,
  css,
  globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
  className: elClassName,
```

- [ ] **Step 6: Update `walkDom` signature to accept `tailwindClasses`**

In the `walkDom` function signature, add `tailwindClasses?: Set<string>` parameter:

```ts
export function walkDom(
  html: string,
  classNameToProperties: Map<string, BlockStyles>,
  collector: GlobalStylesCollector,
  allowNavFooter?: boolean,
  inlineStyles?: Record<string, Record<string, string>>,
  tailwindClasses?: Set<string>,  // NEW
): WalkResult {
```

And pass it into `WalkerOptions`:

```ts
const opts: WalkerOptions = { classNameToProperties, collector, warnings, hardFails, inlineStyles, tailwindClasses };
```

- [ ] **Step 7: Ensure `splitClasses` is exported**

Add `export` to the `splitClasses` function so it can be imported by tests.

- [ ] **Step 8: Run existing tests**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/*.test.ts
```
Expected: All existing tests pass. The new `tailwindClasses` parameter is optional; existing callers that don't pass it will get `undefined`, and the class-splitting logic treats `undefined` as "no Tailwind classes" (all classes go to globalClasses).

- [ ] **Step 9: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "feat: add class splitting with tailwindClasses passthrough to DOM walker"
```

---

### Task 7: Write DOM Walker Class Splitting Tests

**Files:**
- Create: `tests/dom-walker-class-splitting.test.ts`

- [ ] **Step 1: Write tests for splitClasses**

Create `tests/dom-walker-class-splitting.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { splitClasses } from "../src/core/dom-walker.js";

describe("splitClasses", () => {
  const twClasses = new Set(["flex", "items-center", "gap-4", "bg-primary", "md:flex", "hover:bg-surface"]);

  it("splits Tailwind classes from custom classes", () => {
    const result = splitClasses("flex items-center blueprint-bg font-sans", twClasses);
    assert.deepStrictEqual(result.tailwindClasses, ["flex", "items-center"]);
    assert.deepStrictEqual(result.globalClasses, ["blueprint-bg", "font-sans"]);
  });

  it("handles all-Tailwind classes", () => {
    const result = splitClasses("flex bg-primary gap-4", twClasses);
    assert.deepStrictEqual(result.tailwindClasses, ["flex", "bg-primary", "gap-4"]);
    assert.deepStrictEqual(result.globalClasses, []);
  });

  it("handles all-custom classes", () => {
    const result = splitClasses("blueprint-bg hero-section", twClasses);
    assert.deepStrictEqual(result.tailwindClasses, []);
    assert.deepStrictEqual(result.globalClasses, ["blueprint-bg", "hero-section"]);
  });

  it("handles empty class string", () => {
    const result = splitClasses("", twClasses);
    assert.deepStrictEqual(result.tailwindClasses, []);
    assert.deepStrictEqual(result.globalClasses, []);
  });

  it("handles no tailwindClasses set (undefined)", () => {
    const result = splitClasses("flex blueprint-bg", undefined);
    assert.deepStrictEqual(result.tailwindClasses, []);
    assert.deepStrictEqual(result.globalClasses, ["flex", "blueprint-bg"]);
  });

  it("handles responsive and state variants", () => {
    const result = splitClasses("md:flex hover:bg-surface custom-card", twClasses);
    assert.deepStrictEqual(result.tailwindClasses, ["md:flex", "hover:bg-surface"]);
    assert.deepStrictEqual(result.globalClasses, ["custom-card"]);
  });

  it("preserves original class order", () => {
    const result = splitClasses("blueprint-bg flex font-sans items-center", twClasses);
    assert.deepStrictEqual(result.tailwindClasses, ["flex", "items-center"]);
    assert.deepStrictEqual(result.globalClasses, ["blueprint-bg", "font-sans"]);
  });

  it("Tailwind class wins when in both tailwindClasses and treated as custom", () => {
    // Simulate a case where a class might be in both sets
    const bothTw = new Set(["flex", "custom-class"]);
    const result = splitClasses("flex custom-class", bothTw);
    assert.deepStrictEqual(result.tailwindClasses, ["flex", "custom-class"]);
    assert.deepStrictEqual(result.globalClasses, []);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/dom-walker-class-splitting.test.ts
```
Expected: All 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/dom-walker-class-splitting.test.ts
git commit -m "test: add class splitting tests for DOM walker Tailwind passthrough"
```

---

### Task 8: Wire Orchestrator

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Import Tailwind pipeline and wire it into `convert`**

In `src/core/orchestrator.ts`, add the import:

```ts
import { runTailwindPipeline } from "./tailwind-pipeline.js";
```

Then insert the Tailwind pipeline stage after the iconify resolution and before the preprocessor:

```ts
export async function convert(
  input: ConversionInput,
): Promise<ConversionOutput> {
  resetIds();

  let rawHtml = input.rawHtml;
  const warnings: { code: string; message: string }[] = [];

  // Stage 0: Resolve <iconify-icon> to inline SVG (always run)
  const iconifyResult = await resolveIconifyIcons(rawHtml);
  rawHtml = iconifyResult.html;
  if (iconifyResult.failed.length > 0) {
    warnings.push({
      code: "ICONIFY",
      message: `Could not resolve ${iconifyResult.failed.length} icon(s): ${iconifyResult.failed.join(", ")}`,
    });
  }

  // ── NEW: Stage 0.5 — Tailwind pipeline ─────────────────────
  let tailwindClasses: Set<string> | undefined;
  if (!input.skipShared) {
    const outDir = input.projectDir
      ? resolve(OUTPUT_DIR, input.projectDir)
      : OUTPUT_DIR;
    const twResult = runTailwindPipeline(input.rawHtml, input.projectDir || "default", outDir);
    if (twResult.result) {
      tailwindClasses = twResult.result.tailwindClasses;
      // Write tailwind.css
      writeFileSync(resolve(outDir, "tailwind.css"), twResult.result.tailwindCss, "utf-8");
      // Write manifest
      writeFileSync(resolve(outDir, "tailwind-manifest.json"), twResult.result.manifestJson, "utf-8");
      // Write companion plugin
      writeFileSync(resolve(outDir, "gb-tw-plugin.php"), twResult.result.pluginPhp, "utf-8");
    }
    twResult.warnings.forEach((w) =>
      warnings.push({ code: "TW-PIPELINE", message: w }),
    );
  }

  // Stage 1: Preprocess
  const prepResult = preprocess(rawHtml, input.skipStripNavFooter);
  // ... rest unchanged ...
```

- [ ] **Step 2: Pass `tailwindClasses` to `walkDom`**

Update the `walkDom` call in the orchestrator to pass `tailwindClasses`:

```ts
  // Stage 3: DOM walk
  const walkResult = walkDom(
    prepResult.html,
    prepResult.classNameToProperties,
    collector,
    input.skipStripNavFooter,
    undefined,  // inlineStyles (not used in current pipeline)
    tailwindClasses,  // NEW
  );
```

- [ ] **Step 3: Run existing tests**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/*.test.ts
```
Expected: All tests pass. Tailwind pipeline runs gracefully (no Tailwind config in test fixtures = silent skip).

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: wire Tailwind pipeline into orchestrator before preprocessor"
```

---

### Task 9: Integration Test with Fixture

**Files:**
- Create: `fixtures/tailwind-passthrough.html`
- Create: `tests/tailwind-passthrough.test.ts`

- [ ] **Step 1: Create test fixture HTML**

Create `fixtures/tailwind-passthrough.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: "#C5FFD6",
        surface: "#1E293B"
      },
      fontFamily: {
        sans: ["DM Sans", "sans-serif"]
      }
    }
  }
}
</script>
<style>
.blueprint-bg {
  background-size: 40px 40px;
  background-image: linear-gradient(to right, rgba(51, 65, 85, 0.08) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(51, 65, 85, 0.08) 1px, transparent 1px);
}
.font-sans { font-family: "DM Sans", sans-serif; }
</style>
</head>
<body>
<section class="flex items-center gap-4 blueprint-bg font-sans">
  <h2 class="text-2xl">Hello World</h2>
  <p class="text-base">This is a test with mixed Tailwind and custom classes.</p>
</section>
</body>
</html>
```

- [ ] **Step 2: Write integration test**

Create `tests/tailwind-passthrough.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { convert } from "../src/core/orchestrator.js";

const FIXTURE_PATH = resolve(process.cwd(), "fixtures/tailwind-passthrough.html");
const OUT_DIR = resolve(process.cwd(), "output", "tailwind-test");

describe("Tailwind class passthrough (integration)", () => {
  it("converts HTML with Tailwind classes and produces tailwind.css + plugin", async () => {
    const rawHtml = readFileSync(FIXTURE_PATH, "utf-8");

    const result = await convert({
      rawHtml,
      pageName: "tailwind-test",
      projectDir: "tailwind-test",
    });

    // Block output should have className with Tailwind classes
    assert.ok(result.blockHtml.includes("className"), "should include className attribute");
    assert.ok(
      result.blockHtml.includes("flex") || result.blockHtml.includes("items-center"),
      "should include Tailwind classes in output"
    );

    // Tailwind CSS should be generated
    const tailwindCssPath = resolve(OUT_DIR, "tailwind.css");
    assert.ok(existsSync(tailwindCssPath), "tailwind.css should exist");

    // Manifest should be generated
    const manifestPath = resolve(OUT_DIR, "tailwind-manifest.json");
    assert.ok(existsSync(manifestPath), "tailwind-manifest.json should exist");

    // Manifest should contain Tailwind classes
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.ok(Array.isArray(manifest), "manifest should be an array");
    assert.ok(manifest.includes("flex"), "manifest should include \"flex\"");
    assert.ok(manifest.includes("items-center"), "manifest should include \"items-center\"");

    // Companion plugin should be generated
    const pluginPath = resolve(OUT_DIR, "gb-tw-plugin.php");
    assert.ok(existsSync(pluginPath), "gb-tw-plugin.php should exist");
    const pluginContent = readFileSync(pluginPath, "utf-8");
    assert.ok(pluginContent.includes("wp_enqueue_style"), "plugin should enqueue styles");
    assert.ok(pluginContent.includes("allowedBlockClasses"), "plugin should safelist classes");
  });
});
```

- [ ] **Step 3: Run integration test**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/tailwind-passthrough.test.ts
```
Expected: The test converts the fixture and verifies tailwind.css, manifest, and plugin are produced. (Note: This requires `@tailwindcss/cli` to be available in node_modules.)

- [ ] **Step 4: Run ALL tests to verify no regressions**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/*.test.ts
```
Expected: All tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add fixtures/tailwind-passthrough.html tests/tailwind-passthrough.test.ts
git commit -m "test: add Tailwind passthrough integration test with fixture"
```

---

### Task 10: Cleanup & Documentation

**Files:**
- Modify: `README.md` (add Tailwind section)

- [ ] **Step 1: Add Tailwind section to README**

Open `README.md` and add a section after the Pre-Conversion Checklist:

```markdown
## Tailwind CSS Support

When source HTML includes a `tailwind.config` script (CDN pattern), the converter
automatically:

1. Extracts the Tailwind configuration
2. Compiles a full `tailwind.css` using Tailwind CSS v4 CLI
3. Passes Tailwind utility classes (`flex`, `bg-primary`, etc.) through to block
   `className` attributes
4. Generates a companion WordPress plugin (`gb-tw-plugin.php`) that enqueues
   `tailwind.css` in both the block editor and frontend

Custom CSS classes from `<style>` blocks continue to be resolved to GB styles
as before.

### Deployment

Copy the output folder (`output/<project>/`) into
`wp-content/plugins/gb-tailwind-<project>/` and activate the plugin. Paste
block markup from `pages/*.html` into the WordPress block editor. Tailwind-styled
blocks render correctly in both the editor preview and the published frontend.

### Requirements

- Tailwind CSS v4.3.0+ (`npx @tailwindcss/cli`)
- WordPress 5.8+
```

- [ ] **Step 2: Run full test suite one final time**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx --test tests/*.test.ts
```
Expected: All tests pass.

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: add Tailwind CSS support section to README"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Each spec section maps to at least one task:
  - §1 Config Extraction → Task 2 (extractor), Task 3 (translator)
  - §1.3 Compilation → Task 4 (compiler), Task 5 (pipeline coordinator)
  - §1.4 Manifest → Task 4 (scanTailwindCss)
  - §2 DOM Walker → Task 6 (modifications), Task 7 (tests)
  - §3 Companion Plugin → Task 5 (generatePluginPhp in pipeline)
  - §4 Error Handling → Task 2 (returns null), Task 5 (try/catch, warnings)
  - §5 Testing → Tasks 2, 3, 4, 7, 9 (unit + integration tests)
  - §6 Code Reuse → (addressed by clean-room implementation; constants from archive noted)
  - §8 Deployment → Task 10 (README docs)
  - §9 Requirements → Task 10 (README docs)

- [x] **No placeholders:** All steps have complete code. No TBD/TODO/fill-in-later.

- [x] **Type consistency:** `className` field added in Task 1 is used consistently in Tasks 2–9. `tailwindClasses` is `Set<string>` throughout. `WalkerOptions` extended in Task 6 matches orchestrator usage in Task 8.

- [x] **File path existence:** All referenced files exist or will be created by earlier tasks. Imports match exports. Test files import from correct relative paths.
