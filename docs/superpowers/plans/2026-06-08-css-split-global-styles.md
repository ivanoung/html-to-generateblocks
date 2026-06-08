# CSS Split & Global Styles Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split compiled `styles.css` into `global-styles.json` (single-class rules for GB import) and `styles-unique.css` (everything else), placed in a `setup/` subfolder alongside `customizer-import.json` and `manual-steps.txt`.

**Architecture:** New `css-splitter.ts` module parses CSS with the `css` npm package, classifies rules by selector type, returns split result. Orchestrator calls it after building `combinedCss` and writes the new output files. `styles.css` stays unchanged at the project root.

**Tech Stack:** TypeScript, `css` npm package v3.0.0 (already a dependency), Node.js fs

---

### Task 1: Create css-splitter.ts module

**Files:**
- Create: `src/core/css-splitter.ts`
- Create: `tests/css-splitter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/css-splitter.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { splitCss } from "../src/core/css-splitter.js";

describe("splitCss", () => {
  it("classifies single-class rules into globalStyles", () => {
    const css = ".pt-32{padding-top:8rem}.flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
    assert.strictEqual(result.globalStyles[0].selector, ".pt-32");
    assert.strictEqual(result.globalStyles[1].selector, ".flex");
    assert.strictEqual(result.uniqueCss, "");
  });

  it("puts element selectors into uniqueCss", () => {
    const css = "body{margin:0}h1{font-size:2rem}.foo{color:red}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".foo");
    assert.ok(result.uniqueCss.includes("body"), "uniqueCss should contain body rule");
    assert.ok(result.uniqueCss.includes("h1"), "uniqueCss should contain h1 rule");
  });

  it("handles pseudo-classes on single-class selectors", () => {
    const css = ".hover\\:bg-seafoam:hover{background-color:#93FFD8}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".hover\\:bg-seafoam");
    assert.ok(result.globalStyles[0].css.includes(":hover"), "CSS should preserve pseudo-class");
  });

  it("puts pseudo-element selectors into uniqueCss", () => {
    const css = ".no-scrollbar::-webkit-scrollbar{display:none}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("no-scrollbar"), "pseudo-element rule should be in uniqueCss");
  });

  it("puts multi-selector rules into uniqueCss", () => {
    const css = "h1,h2,h3{font-weight:bold}*,:after,:before{box-sizing:border-box}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("h1,h2,h3"));
    assert.ok(result.uniqueCss.includes("*,:after,:before"));
  });

  it("extracts class rules from inside @media blocks", () => {
    const css = "@media(min-width:768px){.md\\:text-7xl{font-size:4.5rem}.md\\:flex{display:flex}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
    assert.ok(result.globalStyles[0].css.includes("@media"), "CSS should preserve @media wrapper");
  });

  it("handles @keyframes — goes to uniqueCss", () => {
    const css = "@keyframes spin{to{transform:rotate(360deg)}}.animate-spin{animation:spin 1s linear infinite}";
    const result = splitCss(css);
    // Only .animate-spin should be a global style
    // @keyframes goes to uniqueCss
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".animate-spin");
    assert.ok(result.uniqueCss.includes("@keyframes"), "keyframes should be in uniqueCss");
  });

  it("generates human-readable names from class names", () => {
    const css = ".pt-32{padding-top:8rem}.bg-primary{background:#c5ffd6}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles[0].name, "Pt 32");
    assert.strictEqual(result.globalStyles[1].name, "Bg Primary");
  });

  it("returns empty results for empty input", () => {
    const result = splitCss("");
    assert.strictEqual(result.globalStyles.length, 0);
    assert.strictEqual(result.uniqueCss, "");
  });

  it("survives malformed CSS — returns all as uniqueCss", () => {
    const result = splitCss("not valid css {{{");
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/css-splitter.test.ts
```
Expected: FAIL — `Cannot find module '../src/core/css-splitter.js'`

- [ ] **Step 3: Create the css-splitter.ts module**

Create `src/core/css-splitter.ts`:

```typescript
// ── CSS Splitter ───────────────────────────────────────────
//
// Parses compiled CSS and splits into:
// - globalStyles: single-class rules suitable for GB Global Styles import
// - uniqueCss: everything else (preflight, element selectors, keyframes, etc.)

import css from "css";

export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}

export interface CssSplitResult {
  globalStyles: GlobalStyleEntry[];
  uniqueCss: string;
}

/**
 * Check if a CSS selector is a single class selector.
 * Matches: .foo, .foo\:bar, .foo\:bar:hover, .foo\:bar:active
 * Does NOT match: tag selectors, pseudo-elements (::), multi-selectors (a,b),
 *   combinators (a b, a>b, a+b, a~b)
 */
function isSingleClassSelector(selector: string): boolean {
  // Strip pseudo-classes (:hover, :focus, :active, :first-child, etc.)
  // but keep them for the actual CSS content
  const withoutPseudo = selector.replace(/:(?![a-zA-Z])/g, ""); // don't strip \: escapes
  
  // Check for pseudo-elements (::before, ::after, ::-webkit-*, etc.)
  if (/::/.test(selector)) return false;

  // Check for combinators or multi-selectors
  if (/[,\s>+~]/.test(withoutPseudo.replace(/\\:/g, "").replace(/\\\//g, "").replace(/\\\[/g, "").replace(/\\\]/g, "").replace(/\\#/g, ""))) return false;

  // Must start with exactly one dot (class selector), optionally with pseudo-classes
  // Pattern: .classname or .class\:name or .class\:name:pseudo or .class\:name:pseudo:pseudo
  return /^\.[a-zA-Z_-][\w-]*(\\:[a-zA-Z_-][\w-]*)*(:[a-zA-Z-]+)*$/.test(selector);
}

/**
 * Extract the base class name (without pseudo-classes) for the selector field.
 * .hover\:bg-seafoam:hover → .hover\:bg-seafoam
 */
function extractBaseSelector(selector: string): string {
  // Remove pseudo-class suffixes
  return selector.replace(/(:[a-zA-Z-]+)+$/, "");
}

/**
 * Convert a kebab-case class name to Title Case for human-readable name.
 * pt-32 → Pt 32, bg-primary → Bg Primary
 */
function classNameToName(className: string): string {
  // Strip the leading dot and pseudo-classes
  const clean = className.replace(/^\./, "").replace(/(:[a-zA-Z-]+)+$/, "");
  // Split on hyphens, capitalize each segment
  return clean
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Serialize a CSS rule AST node back to a CSS string.
 */
function serializeRule(rule: css.Rule | css.Media): string {
  if (rule.type === "media") {
    const media = rule as css.Media;
    const innerCss = (media.rules || [])
      .map((r) => serializeRule(r as css.Rule))
      .join("");
    return `@media ${media.media}{${innerCss}}`;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selector = (r.selectors || []).join(",");
    const declarations = (r.declarations || [])
      .map((d) => `${d.property}:${d.value}`)
      .join(";");
    return `${selector}{${declarations}${declarations ? ";" : ""}}`;
  }

  // keyframes, font-face, etc.
  if (rule.type === "keyframes") {
    const kf = rule as css.KeyFrames;
    const keyframesCss = (kf.keyframes || [])
      .map((k) => {
        const decs = (k.declarations || [])
          .map((d) => `${d.property}:${d.value}`)
          .join(";");
        return `${k.values.join(",")}{${decs}${decs ? ";" : ""}}`;
      })
      .join("");
    return `@keyframes ${kf.name}{${keyframesCss}}`;
  }

  return "";
}

/**
 * Walk a CSS rule and classify it.
 * Returns updated result with any extracted global styles and unique CSS.
 */
function walkRule(
  rule: css.Rule | css.Media,
  parentMediaQuery: string | null,
  globalStyles: GlobalStyleEntry[],
  uniqueCssParts: string[],
): void {
  if (rule.type === "media") {
    const media = rule as css.Media;
    const mediaQuery = `@media ${media.media}`;

    // Check if ALL rules inside are single-class — if so, extract each as a global style
    const innerRules = (media.rules || []) as css.Rule[];
    const allSingleClass = innerRules.every(
      (r) =>
        r.type === "rule" &&
        (r.selectors || []).length === 1 &&
        isSingleClassSelector(r.selectors![0]),
    );

    if (allSingleClass && innerRules.length > 0) {
      for (const r of innerRules) {
        const selector = r.selectors![0];
        const baseSelector = extractBaseSelector(selector);
        const ruleCss = `${selector}{${(r.declarations || [])
          .map((d) => `${d.property}:${d.value}`)
          .join(";")}}`;
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: baseSelector,
          css: `${mediaQuery}{${ruleCss}}`,
        });
      }
    } else {
      // Mixed or non-class rules — serialize the whole block as unique CSS
      uniqueCssParts.push(serializeRule(rule));
    }
    return;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selectors = r.selectors || [];

    if (selectors.length === 1 && isSingleClassSelector(selectors[0])) {
      const selector = selectors[0];
      const baseSelector = extractBaseSelector(selector);
      const ruleCss = serializeRule(r);
      globalStyles.push({
        name: classNameToName(baseSelector),
        selector: baseSelector,
        css: parentMediaQuery
          ? `${parentMediaQuery}{${ruleCss}}`
          : ruleCss,
      });
    } else {
      const serialized = parentMediaQuery
        ? `${parentMediaQuery}{${serializeRule(r)}}`
        : serializeRule(r);
      uniqueCssParts.push(serialized);
    }
    return;
  }

  // Other types: keyframes, font-face, charset, etc. — always unique
  uniqueCssParts.push(serializeRule(rule));
}

/**
 * Split compiled CSS into globalStyles (single-class rules) and uniqueCss (everything else).
 */
export function splitCss(compiledCss: string): CssSplitResult {
  const globalStyles: GlobalStyleEntry[] = [];
  const uniqueCssParts: string[] = [];

  if (!compiledCss.trim()) {
    return { globalStyles: [], uniqueCss: "" };
  }

  try {
    const ast = css.parse(compiledCss, { silent: true });
    const rules = ast.stylesheet?.rules || [];

    for (const rule of rules) {
      walkRule(rule as css.Rule | css.Media, null, globalStyles, uniqueCssParts);
    }
  } catch {
    // Parse failed — return everything as unique CSS
    return { globalStyles: [], uniqueCss: compiledCss };
  }

  return {
    globalStyles,
    uniqueCss: uniqueCssParts.join(""),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/css-splitter.test.ts
```
Expected: PASS — all 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/core/css-splitter.ts tests/css-splitter.test.ts
git commit -m "feat: css-splitter — split compiled CSS into global-styles.json and unique CSS"
```

---

### Task 2: Wire splitter into orchestrator + move shared files into setup/

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Add setup/ subfolder writes to orchestrator**

The `skipShared` block in `orchestrator.ts` currently writes `styles.css`, `customizer-import.json`, and `manual-steps.txt` to `outDir`. Change it to:

1. Create `setup/` subfolder: `const setupDir = resolve(outDir, "setup"); mkdirSync(setupDir, { recursive: true });`
2. Write `styles.css` to `outDir` (unchanged — master fallback)
3. Call `splitCss(combinedCss)` and write `global-styles.json` and `styles-unique.css` to `setupDir`
4. Write `customizer-import.json` and `manual-steps.txt` to `setupDir` (moved from `outDir`)

In `src/core/orchestrator.ts`, add import at top:

```typescript
import { splitCss } from "./css-splitter.js";
```

Then replace the `skipShared` block. The relevant section (starting around line 149) should become:

```typescript
  // Single styles.css: compiled Tailwind CSS + custom CSS
  const combinedCss = [compiledCss, prepResult.customCss]
    .filter(Boolean).join("\n");
  if (!input.skipShared) {
    // Setup subfolder for shared assets
    const setupDir = resolve(outDir, "setup");
    mkdirSync(setupDir, { recursive: true });

    // Master styles.css (unchanged — always the complete fallback)
    if (combinedCss.trim()) {
      writeFileSync(
        resolve(outDir, "styles.css"),
        combinedCss + "\n",
        "utf-8",
      );

      // Split into global-styles.json + styles-unique.css
      const split = splitCss(combinedCss);
      writeFileSync(
        resolve(setupDir, "global-styles.json"),
        JSON.stringify(split.globalStyles, null, 2) + "\n",
        "utf-8",
      );
      writeFileSync(
        resolve(setupDir, "styles-unique.css"),
        split.uniqueCss + "\n",
        "utf-8",
      );
    }

    const customizer = generateCustomizerSettings(input.rawHtml);
    if (customizer) {
      writeFileSync(
        resolve(setupDir, "customizer-import.json"),
        JSON.stringify(customizer, null, 2) + "\n",
        "utf-8",
      );
    }

    const manualSteps = analyzeSource(input.rawHtml);
    writeFileSync(
      resolve(setupDir, "manual-steps.txt"),
      generateManualStepsReport(manualSteps) + "\n",
      "utf-8",
    );
  }
```

- [ ] **Step 2: Run fixture regression to check nothing broke**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```
Expected: Same results as before (18 passed, 2 pre-existing `FIX_SOURCE` failures). No new failures.

- [ ] **Step 3: Run a full project-mode conversion and verify outputs**

```bash
rm -rf output/mino && npx tsx src/cli/index.ts convert inputs/mino/
```

Then verify:
```bash
# Check setup folder exists with all files
ls output/mino/setup/
# Expected: customizer-import.json  global-styles.json  manual-steps.txt  styles-unique.css

# Check styles.css still at root
ls output/mino/styles.css
# Expected: output/mino/styles.css

# Check global-styles.json has entries
python3 -c "import json; d=json.load(open('output/mino/setup/global-styles.json')); print(f'Global styles: {len(d)} entries')"
# Expected: several hundred entries

# Check styles-unique.css is smaller than styles.css
wc -c output/mino/styles.css output/mino/setup/styles-unique.css
```

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: wire css-splitter into orchestrator, move shared assets to setup/ folder"
```

---

### Task 3: Update CLI output messages for setup/ paths

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Update console output paths**

In the project-mode and single-page sections of the CLI, update the output messages to show the new `setup/` paths. Find the lines that print `styles.css`, `customizer-import`, and `manual-steps` paths and prefix them with `setup/`.

In the project-mode section (around line 388), change:

```typescript
console.log(`  Shared CSS: ${outputDir}styles.css`);
```

To:

```typescript
console.log(`  Setup files: ${outputDir}setup/`);
console.log(`    global-styles.json  (import into GB Global Styles)`);
console.log(`    styles-unique.css   (paste into Additional CSS if needed)`);
console.log(`    customizer-import.json`);
console.log(`    manual-steps.txt`);
```

In the single-page section (around line 443), change the output prefix similarly.

- [ ] **Step 2: Commit**

```bash
git add src/cli/index.ts
git commit -m "chore: update CLI output to show setup/ folder paths"
```

---

### Task 4: Update manual-steps.txt template

**Files:**
- Modify: `src/core/manual-steps.ts`

- [ ] **Step 1: Update the manual steps template**

The manual steps currently say "Paste styles.css into Additional CSS" and reference `customizer-import.json` at the root. Update to reference `setup/` paths and mention `global-styles.json`:

Find the section that generates step 5 (ADD STYLES.CSS) and update it to reference:
- `setup/global-styles.json` — import into GB Global Styles
- `setup/styles-unique.css` — paste into Additional CSS for remaining styles
- `setup/customizer-import.json` — import customizer settings

And note that `styles.css` at the project root is always available as a complete fallback.

- [ ] **Step 2: Commit**

```bash
git add src/core/manual-steps.ts
git commit -m "docs: update manual-steps template for setup/ folder and global-styles.json"
```

---

### Task 5: Update MEMORY.md

**Files:**
- Modify: `MEMORY.md`

- [ ] **Step 1: Add documentation for the new feature**

Add an entry under Architecture decisions:

```markdown
### ✅ CSS split into global-styles.json + styles-unique.css (implemented 2026-06-08)

The compiled `styles.css` is now split into two additional outputs in a `setup/`
subfolder:

- `setup/global-styles.json` — single-class CSS rules (`.pt-32`, `.flex`, etc.)
  formatted for import into GenerateBlocks Global Styles. Each entry has `name`,
  `selector`, and `css` fields. Responsive variants inside `@media` blocks are
  included with their media query wrapper preserved.

- `setup/styles-unique.css` — everything that can't be a global style: preflight
  reset, element selectors, keyframes, pseudo-elements, multi-selector rules.
  Paste this into Additional CSS if needed.

- `styles.css` at the project root remains unchanged as the complete master
  fallback.

The `css-splitter.ts` module uses the `css` npm package to parse and classify
each CSS rule by selector type.
```

- [ ] **Step 2: Commit**

```bash
git add MEMORY.md
git commit -m "docs: document css-splitter and setup/ folder in MEMORY.md"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ New `css-splitter.ts` module → Task 1
- ✅ Wire into orchestrator → Task 2
- ✅ Move shared assets to `setup/` → Task 2
- ✅ Update CLI output → Task 3
- ✅ Update manual-steps template → Task 4
- ✅ Documentation → Task 5

**2. Placeholder scan:** No TBDs, TODOs, or incomplete sections. All code blocks are complete.

**3. Type consistency:** `GlobalStyleEntry` and `CssSplitResult` defined in Task 1, consumed in Task 2. `splitCss` signature matches usage. `setupDir` is defined from `outDir`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-css-split-global-styles.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks

**2. Inline Execution** — Execute tasks here using executing-plans, batch execution with checkpoints

Which approach?
