# Pixel-Perfect Restoration & CSS Architecture Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore pixel-perfect conversion parity with the milestone baseline (93d8743) while fixing three regressions: missing DEFAULT key in color palette expansion, body-level CSS not applying to GB wrapper divs, and CSS split complexity confusing users.

**Architecture:** Five layered fixes: (1) make CSS split opt-in behind a CLI flag, (2) inject body tag classes into the CDN compilation document via a hidden proxy div, (3) copy body inline styles onto the wrapper div during preprocessing, (4) add a global-selector inventory step that inventories `html`/`body`/`:root`/`::selection` rules and flags them in manual-steps.md, (5) verification script that asserts every custom color class and body-level utility appears in compiled CSS.

**Tech Stack:** TypeScript + ESM (tsx runtime), Cheerio for HTML parsing, Playwright for Tailwind CDN compilation, Node.js fs for file I/O.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/cli/index.ts` (modify) | Add `--split` flag gate; wire body proxy classes into `inlineTailwindMultiPage` call |
| `src/core/tailwind-inliner.ts` (modify) | Extract body classes from all pages and inject hidden proxy div into CDN document |
| `src/core/preprocessor.ts` (modify) | Extract `body` element's `style` attribute alongside `class`; carry it onto wrapper div |
| `src/core/manual-steps.ts` (modify) | Add body-background note; add global-selector inventory section |
| `src/core/global-selector-inventory.ts` (create) | Scan custom CSS for `html`, `body`, `:root`, `::selection` rules |
| `tests/body-proxy.test.ts` (create) | Unit test: body class injection into CDN document |
| `tests/global-selector-inventory.test.ts` (create) | Unit test: inventory extraction from CSS |

---

### Task 1: Make CSS Split Opt-In Behind `--split` Flag

**Files:**
- Modify: `src/cli/index.ts:500-530` (Phase 2 split block)

- [ ] **Step 1: Gate the split block with `--split` flag check**

In `src/cli/index.ts`, the `convert` command's directory-mode handler runs Phase 2 split unconditionally. Wrap it:

Replace the Phase 2 block (lines 500-530) — the section that starts at `// Phase 2: Split styles.css into global-styles.json + styles-unique.css` through the closing `}` after `writeFileSync(resolve(setupDir, "styles-unique.css"), ...)` — with a gated version:

```typescript
      // Phase 2: Split styles.css into global-styles.json + styles-unique.css
      // Only runs when --split flag is passed. Monolithic styles.css at
      // project root is always the canonical pixel-perfect fallback.
      const doSplit = args.includes("--split");
      const cssPath = resolve(outDir, "styles.css");
      const setupDir = resolve(outDir, "setup");

      if (existsSync(cssPath) && doSplit) {
        mkdirSync(setupDir, { recursive: true });

        const fullCss = readFileSync(cssPath, "utf-8");

        const { editable, raw } = generateGlobalStylesData(fullCss);
        const manifest = buildGlobalStylesManifest(editable, raw, []);
        writeFileSync(resolve(setupDir, "global-styles.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

        const split = splitCss(fullCss);
        writeFileSync(resolve(setupDir, "styles-unique.css"), split.uniqueCss + "\n", "utf-8");

        console.log(`  Global Styles: ${editable.length} structured (editable), ${raw.length} raw (CSS-only)`);

        // Write app.js at project root with all scripts
        if (uniqueScripts.length > 0) {
          writeFileSync(resolve(outDir, "app.js"), formatGlobalJs(uniqueScripts), "utf-8");
        }
      }
```

- [ ] **Step 2: Move `customizer-import.json` generation inside the `--split` gate**

The `customizer-generator.ts` call in `orchestrator.ts` currently runs on every conversion. Move the customizer JSON write into the `--split` path in `cli/index.ts` so it's only generated when explicitly requested. In `orchestrator.ts`, remove the `import { generateCustomizerSettings } from "./customizer-generator.js"` and the customizer write block (the section inside `if (!input.skipShared)` that writes `customizer-import.json`). In `cli/index.ts`, add inside the `if (doSplit)` block:

```typescript
        const { generateCustomizerSettings } = await import("../core/customizer-generator.js");
        const customizer = generateCustomizerSettings(pageContents[0].html);
        if (customizer) {
          writeFileSync(resolve(setupDir, "customizer-import.json"), JSON.stringify(customizer, null, 2) + "\n", "utf-8");
        }
```

- [ ] **Step 3: Update CLI help text**

In `src/cli/index.ts`, update the usage section at the top of `main()` to mention `--split`:

```typescript
    console.log("  convert <input.html|dir/>  Convert HTML page(s) to GB blocks");
    console.log("    --skip-shared            Skip shared files (styles.css, manual-steps)");
    console.log("    --split                  Also generate setup/ (global-styles.json + styles-unique.css)");
```

- [ ] **Step 4: Run convert WITHOUT --split and verify monolithic styles.css works**

Run: `npx tsx src/cli/index.ts convert inputs/mino/`
Expected: `styles.css` generated at root, NO `setup/` directory created, output message does NOT show "Global Styles:" line.

- [ ] **Step 5: Run convert WITH --split and verify setup/ directory is created**

Run: `npx tsx src/cli/index.ts convert inputs/mino/ --split`
Expected: `setup/` directory exists with `global-styles.json`, `styles-unique.css`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts src/core/orchestrator.ts
git commit -m "feat: make CSS split opt-in behind --split flag, remove customizer from orchestrator"
```

---

### Task 2: Inject Body Classes Into CDN Compilation

**Files:**
- Modify: `src/core/tailwind-inliner.ts:100-138` (inlineTailwindMultiPage function)
- Create: `tests/body-proxy.test.ts`

The CDN only sees body CONTENT (everything inside `<body>...</body>`), so Tailwind classes on the `<body>` tag like `selection:bg-primary` and `selection:text-surface` are never compiled. Fix: extract all unique body classes and inject a hidden proxy div into the CDN document.

- [ ] **Step 1: Add helper to extract body classes from all pages**

In `src/core/tailwind-inliner.ts`, add a function before `inlineTailwindMultiPage`:

```typescript
/**
 * Extract all unique class names from <body> tags across pages.
 * These classes would otherwise be invisible to the Tailwind CDN
 * since only body CONTENT (not the body tag itself) is compiled.
 */
function extractBodyClasses(pageHtmls: string[]): string[] {
  const classSet = new Set<string>();
  for (const html of pageHtmls) {
    const bodyMatch = html.match(/<body[^>]*class="([^"]*)"[^>]*>/i);
    if (bodyMatch) {
      bodyMatch[1].split(/\s+/).filter(c => c.length > 0).forEach(c => classSet.add(c));
    }
  }
  return [...classSet];
}
```

- [ ] **Step 2: Inject hidden proxy div into CDN document**

Inside `inlineTailwindMultiPage`, after building `combinedBody` and before building `cdnDoc`, add:

```typescript
  // Inject hidden proxy div with all body classes so Tailwind CDN
  // compiles utilities like selection:bg-primary that only appear on <body>
  const bodyClasses = extractBodyClasses(pageHtmls);
  const proxyDiv = bodyClasses.length > 0
    ? `\n<div class="${bodyClasses.join(" ")}" style="display:none" data-gb-proxy></div>`
    : "";
```

Then append `proxyDiv` to the CDN document body:

```typescript
  const cdnDoc = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = ${configJson}</script>
${combinedHead}
</head><body>
${combinedBody}
${proxyDiv}
</body></html>`;
```

- [ ] **Step 3: Write unit test**

Create `tests/body-proxy.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";

// Test helper inline since extractBodyClasses is not exported
function extractBodyClasses(pageHtmls: string[]): string[] {
  const classSet = new Set<string>();
  for (const html of pageHtmls) {
    const bodyMatch = html.match(/<body[^>]*class="([^"]*)"[^>]*>/i);
    if (bodyMatch) {
      bodyMatch[1].split(/\s+/).filter(c => c.length > 0).forEach(c => classSet.add(c));
    }
  }
  return [...classSet];
}

describe("extractBodyClasses", () => {
  it("extracts classes from a single body tag", () => {
    const html = '<html><body class="font-sans antialiased blueprint-bg selection:bg-primary"></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, ["font-sans", "antialiased", "blueprint-bg", "selection:bg-primary"]);
  });

  it("deduplicates across multiple pages", () => {
    const html1 = '<html><body class="font-sans blueprint-bg"></body></html>';
    const html2 = '<html><body class="font-sans antialiased"></body></html>';
    const classes = extractBodyClasses([html1, html2]);
    assert.deepStrictEqual(classes, ["font-sans", "blueprint-bg", "antialiased"]);
  });

  it("returns empty array when no body tag", () => {
    const html = '<html><head></head></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, []);
  });

  it("returns empty array when body has no class attribute", () => {
    const html = '<html><body></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, []);
  });

  it("returns empty array when body class is empty string", () => {
    const html = '<html><body class=""></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, []);
  });
});
```

- [ ] **Step 4: Run test**

Run: `npx tsx --test tests/body-proxy.test.ts`
Expected: 5/5 tests pass.

- [ ] **Step 5: Run full conversion and verify selection classes now appear**

Run: `npx tsx src/cli/index.ts convert inputs/mino/`
Verify: `grep "selection" output/mino/styles.css` returns lines containing `selection\\:bg-primary` and `selection\\:text-surface`.

- [ ] **Step 6: Commit**

```bash
git add src/core/tailwind-inliner.ts tests/body-proxy.test.ts
git commit -m "feat: inject body-tag classes into CDN compilation via hidden proxy div"
```

---

### Task 3: Copy Body Inline Styles to Wrapper Div

**Files:**
- Modify: `src/core/preprocessor.ts:162-168`

The preprocessor already extracts `body` classes and puts them on a wrapper div. But the `body` element's `style` attribute (inline styles) are ignored. Fix: also extract the body's style attribute.

- [ ] **Step 1: Extract body style attribute alongside classes**

In `src/core/preprocessor.ts`, replace lines 162-168:

```typescript
  // 5. Extract cleaned HTML with body classes and styles preserved
  const bodyClasses = $("body").attr("class") || "";
  const bodyStyle = $("body").attr("style") || "";
  const bodyHtml = $("body").html() || "";
  // Wrap body content in a div that carries the body's classes AND inline styles
  // so the DOM walker preserves blueprint-bg, font-sans, etc. and any body-level
  // inline styles like overflow-x: hidden.
  const wrapperAttrs: string[] = [];
  if (bodyClasses) wrapperAttrs.push(`class="${bodyClasses}"`);
  if (bodyStyle) wrapperAttrs.push(`style="${bodyStyle}"`);
  const html = wrapperAttrs.length > 0
    ? `<div ${wrapperAttrs.join(" ")}>${bodyHtml}</div>`
    : bodyHtml;
```

- [ ] **Step 2: Run full conversion and verify wrapper div has style attribute when source body has one**

Run: `npx tsx src/cli/index.ts convert inputs/mino/`
Verify: the first `<div>` element in `output/mino/pages/index.html` does NOT have a `style` attribute (since the mino source body has no inline style). This is correct — the code gracefully handles absent style.

To test the positive case, temporarily add `style="background: #EEEEEE"` to the body tag in `inputs/mino/index.html`, re-run, then verify the wrapper div now has `style="background: #EEEEEE"`. Then revert the test change.

- [ ] **Step 3: Commit**

```bash
git add src/core/preprocessor.ts
git commit -m "feat: carry body inline styles onto GB wrapper div during preprocessing"
```

---

### Task 4: Global Selector Inventory (Future-Proofing)

**Files:**
- Create: `src/core/global-selector-inventory.ts`
- Modify: `src/core/manual-steps.ts` (add inventory section)
- Create: `tests/global-selector-inventory.test.ts`

Document-level CSS rules (`html { ... }`, `body { ... }`, `:root { ... }`, `::selection { ... }`) target elements that exist in the WordPress document but not inside the blocks. This module inventories these rules and flags them in `manual-steps.md` so the user knows to enqueue them globally.

- [ ] **Step 1: Create the inventory module**

Create `src/core/global-selector-inventory.ts`:

```typescript
// ── Global Selector Inventory ──────────────────────────────
//
// Scans the custom CSS for document-level selectors (html, body,
// :root, ::selection) that target elements outside the GB blocks.
// These rules are preserved as-is in the output CSS but need to
// be flagged because they won't apply when viewing blocks in
// isolation — they rely on the WordPress document structure.
//
// Returns categorized rules for inclusion in manual-steps.md.

export interface GlobalSelectorRule {
  selector: string;        // e.g. "body", "html", ":root"
  css: string;             // full rule text including declarations
  category: "element" | "pseudo-element" | "custom-property";
}

export interface GlobalSelectorInventory {
  rules: GlobalSelectorRule[];
  hasBackgroundColor: boolean;
  hasTextColor: boolean;
  hasOverflowX: boolean;
}

/**
 * Extract document-level CSS rules from custom CSS string.
 * Matches: html, body, :root, ::selection, ::backdrop, ::placeholder.
 * Does NOT parse the CSS AST — uses simple regex to be fast
 * and avoid needing a full CSS parser for this narrow task.
 */
export function inventoryGlobalSelectors(customCss: string): GlobalSelectorInventory {
  const rules: GlobalSelectorRule[] = [];
  let hasBackgroundColor = false;
  let hasTextColor = false;
  let hasOverflowX = false;

  // Match rules starting with document-level selectors
  // Pattern: selector { ... } where selector is one of the globals
  const selectorPatterns: { pattern: RegExp; category: GlobalSelectorRule["category"] }[] = [
    { pattern: /^(html|body)\s*\{[^}]*\}/gm, category: "element" },
    { pattern: /^:root\s*\{[^}]*\}/gm, category: "custom-property" },
    { pattern: /^::(?:selection|backdrop|placeholder)\s*\{[^}]*\}/gm, category: "pseudo-element" },
  ];

  for (const { pattern, category } of selectorPatterns) {
    let match;
    while ((match = pattern.exec(customCss)) !== null) {
      const css = match[0];
      const selector = css.substring(0, css.indexOf("{")).trim();
      rules.push({ selector, css, category });

      // Track common properties for manual-steps flags
      if (selector === "body") {
        if (/background-color\s*:/.test(css)) hasBackgroundColor = true;
        if (/^\s*color\s*:/.test(css)) hasTextColor = true;
        if (/overflow-x\s*:/.test(css)) hasOverflowX = true;
      }
    }
  }

  return { rules, hasBackgroundColor, hasTextColor, hasOverflowX };
}
```

- [ ] **Step 2: Write unit tests**

Create `tests/global-selector-inventory.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { inventoryGlobalSelectors } from "../src/core/global-selector-inventory.js";

describe("inventoryGlobalSelectors", () => {
  it("detects body rule with background-color", () => {
    const css = "body { background-color: #EEEEEE; color: #334155; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.hasBackgroundColor, true);
    assert.strictEqual(result.hasTextColor, true);
    assert.strictEqual(result.hasOverflowX, false);
  });

  it("detects body rule with overflow-x", () => {
    const css = "body { overflow-x: hidden; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.hasOverflowX, true);
    assert.strictEqual(result.hasBackgroundColor, false);
  });

  it("detects :root custom properties", () => {
    const css = ":root { --brand: #FF7F59; --spacing: 1rem; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.rules[0].category, "custom-property");
  });

  it("detects ::selection pseudo-element", () => {
    const css = "::selection { background: #C5FFD6; color: #1E293B; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.rules[0].category, "pseudo-element");
  });

  it("detects multiple document-level rules", () => {
    const css = `
      body { background-color: #EEE; }
      html { scroll-behavior: smooth; }
      :root { --accent: blue; }
      ::selection { background: green; }
    `;
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 4);
  });

  it("ignores non-document-level selectors", () => {
    const css = ".blueprint-bg { background-size: 40px; } .container { max-width: 1200px; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 0);
  });

  it("returns empty inventory for empty CSS", () => {
    const result = inventoryGlobalSelectors("");
    assert.strictEqual(result.rules.length, 0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx tsx --test tests/global-selector-inventory.test.ts`
Expected: 7/7 tests pass.

- [ ] **Step 4: Integrate into manual-steps.md generation**

Modify `src/core/manual-steps.ts` to accept the inventory and add a dedicated section. At the top of the file, add:

```typescript
import type { GlobalSelectorInventory } from "./global-selector-inventory.js";
```

Change the `generateManualStepsReport` signature:

```typescript
export function generateManualStepsReport(steps: ManualSteps, inventory?: GlobalSelectorInventory): string {
```

In the auto-fixable section, after step 4 (Customizer Settings), add when inventory has rules:

```typescript
  // ── Global Selector Rules Inventory ──────────────────
  if (inventory && inventory.rules.length > 0) {
    autoFixable.push(
      "5. GLOBAL DOCUMENT STYLES",
      "   The following CSS rules target <html>, <body>, :root,",
      "   or pseudo-elements like ::selection. These are preserved",
      "   in styles.css but only apply when enqueued globally.",
    );
    for (const rule of inventory.rules) {
      autoFixable.push(`   - ${rule.selector}`);
    }
    if (inventory.hasBackgroundColor) {
      autoFixable.push(
        "   ⚠ The source body has a background-color. If your theme",
        "     overrides body styles, add class=\"bg-background\" to",
        "     the outermost GB container block.",
      );
    }
    autoFixable.push("");
  }
```

- [ ] **Step 5: Wire inventory into CLI convert command**

In `src/cli/index.ts`, after the `manualSteps` variable is set (line ~488-491), add the inventory call. Find:

```typescript
    const manualSteps = analyzeSource(pageContents[0].html);
    writeFileSync(
      resolve(outDir, "manual-steps.md"),
      generateManualStepsReport(manualSteps) + "\n",
      "utf-8",
    );
```

Replace with:

```typescript
    const { inventoryGlobalSelectors } = await import("../core/global-selector-inventory.js");
    const manualSteps = analyzeSource(pageContents[0].html);
    const inventory = inventoryGlobalSelectors(
      pageContents.map(pc => pc.html).join("\n"),
    );
    writeFileSync(
      resolve(outDir, "manual-steps.md"),
      generateManualStepsReport(manualSteps, inventory) + "\n",
      "utf-8",
    );
```

- [ ] **Step 6: Run full conversion and check manual-steps.md output**

Run: `npx tsx src/cli/index.ts convert inputs/mino/`
Verify: `cat output/mino/manual-steps.md` includes section "GLOBAL DOCUMENT STYLES" listing `html`, `body`, `::selection`, `:root` rules, with the `⚠` note about `bg-background` fallback.

- [ ] **Step 7: Commit**

```bash
git add src/core/global-selector-inventory.ts src/core/manual-steps.ts src/cli/index.ts tests/global-selector-inventory.test.ts
git commit -m "feat: add global selector inventory for body/html/:root/::selection rules"
```

---

### Task 5: Verification — Assert Pixel-Perfect Parity

**Files:**
- Create: `tests/pixel-parity.test.ts`

A script-based test that runs a full conversion and asserts the key classes that previously broke are present in the output.

- [ ] **Step 1: Write pixel parity test**

Create `tests/pixel-parity.test.ts`:

```typescript
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const PROJECT_ROOT = resolve(process.cwd());
const STYLES_CSS = resolve(PROJECT_ROOT, "output/mino/styles.css");

// Custom color classes that must appear in compiled CSS
const REQUIRED_CLASSES = [
  ".text-orange",
  ".text-surface",
  ".bg-surface",
  ".text-primary",
  ".bg-primary",
  ".text-seafoam",
  ".bg-seafoam",
  ".text-magenta",
  ".bg-magenta",
  ".text-fog",
  ".bg-fog",
  ".bg-secondary",
  ".bg-background",
  ".text-slate",
  ".bg-slate",
];

// Body-level classes that must appear (fixed by proxy injection)
const BODY_CLASSES = [
  "selection\\:bg-primary",
  "selection\\:text-surface",
  "font-sans",
  "antialiased",
];

describe("Pixel Parity Verification", () => {
  before(() => {
    // Run conversion
    execSync("npx tsx src/cli/index.ts convert inputs/mino/", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 120_000,
    });
  });

  it("styles.css exists and is non-empty after conversion", () => {
    assert.ok(existsSync(STYLES_CSS), "styles.css should exist");
    const css = readFileSync(STYLES_CSS, "utf-8");
    assert.ok(css.length > 1000, "styles.css should contain substantial CSS");
  });

  it("all custom color classes appear in compiled CSS", () => {
    const css = readFileSync(STYLES_CSS, "utf-8");
    const missing: string[] = [];
    for (const cls of REQUIRED_CLASSES) {
      if (!css.includes(cls + "{")) {
        missing.push(cls);
      }
    }
    assert.deepStrictEqual(missing, [], `Missing custom color classes: ${missing.join(", ")}`);
  });

  it("body-level classes appear in compiled CSS (proxy injection)", () => {
    const css = readFileSync(STYLES_CSS, "utf-8");
    const missing: string[] = [];
    for (const cls of BODY_CLASSES) {
      if (!css.includes(cls)) {
        missing.push(cls);
      }
    }
    assert.deepStrictEqual(missing, [], `Missing body-level classes: ${missing.join(", ")}`);
  });

  it("body element selector rules are preserved in styles.css", () => {
    const css = readFileSync(STYLES_CSS, "utf-8");
    assert.ok(css.includes("body{"), "body rule should be preserved as element selector");
    assert.ok(css.includes("background-color: #EEEEEE"), "body background-color should be preserved");
    assert.ok(css.includes("color: #334155"), "body text color should be preserved");
  });

  it("all 10 mino pages convert without hard fails", () => {
    const pagesDir = resolve(PROJECT_ROOT, "output/mino/pages");
    const reports = [
      "ai-integrations", "bespoke-systems", "blog-wordpress", "blog",
      "care-plans", "case-featured", "case-studies", "contact",
      "fast-seo", "index",
    ];
    for (const name of reports) {
      const report = JSON.parse(readFileSync(resolve(pagesDir, `${name}.report.json`), "utf-8"));
      assert.strictEqual(
        report.overallStatus, "pass",
        `${name} should pass, got ${report.overallStatus}. Hard fails: ${JSON.stringify(report.hardFails)}`,
      );
    }
  });
});
```

- [ ] **Step 2: Run pixel parity test**

Run: `npx tsx --test tests/pixel-parity.test.ts`
Expected: 5/5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/pixel-parity.test.ts
git commit -m "test: add pixel-parity verification for custom colors, body classes, and page pass rate"
```

---

### Task 6: Final Integration & Regression Run

- [ ] **Step 1: Run full hkvc + mino conversions**

```bash
npx tsx src/cli/index.ts convert inputs/hkvc/
npx tsx src/cli/index.ts convert inputs/mino/
```

- [ ] **Step 2: Verify hkvc still passes**

Check: `cat output/hkvc/pages/index.report.json | grep overallStatus` shows `"pass"`.

- [ ] **Step 3: Run with --split flag to verify split still works**

```bash
npx tsx src/cli/index.ts convert inputs/mino/ --split
```

Check: `ls output/mino/setup/` shows `global-styles.json` and `styles-unique.css`.

- [ ] **Step 4: Run without --split to verify monolithic-only mode**

```bash
rm -rf output/mino/setup
npx tsx src/cli/index.ts convert inputs/mino/
```

Check: `ls output/mino/setup/` does NOT exist.

- [ ] **Step 5: Run all tests**

```bash
npx tsx --test tests/*.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: final integration — all tests pass, both split and monolithic modes work"
```
