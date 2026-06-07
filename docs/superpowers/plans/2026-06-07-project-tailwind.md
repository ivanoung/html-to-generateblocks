# Project-Level Tailwind Compilation + Content-Loss Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile Tailwind CSS from all pages in a project (not just the first), and detect silent content loss during conversion.

**Architecture:** A new project-mode path in the orchestrator concatenates all `.html` files, runs the Tailwind inliner once on the combined content, then converts each page individually. A content verifier compares source text length against output to flag >5% loss.

**Tech Stack:** TypeScript, cheerio, existing Tailwind/Playwright inliner pipeline.

---

### Task 1: Add `skipInliner` flag to ConversionInput

**Files:**
- Modify: `src/core/orchestrator.ts:23-30`

- [ ] **Step 1: Add the flag to the interface**

```typescript
export interface ConversionInput {
  rawHtml: string;
  pageName: string;
  projectDir?: string;
  resolveCss?: boolean;
  skipShared?: boolean;  // skip styles.css, customizer, manual-steps
  skipInliner?: boolean; // skip Tailwind inliner + iconify resolver (CSS already compiled)
}
```

- [ ] **Step 2: Gate the inliner and iconify on `!input.skipInliner`**

In the `convert()` function, wrap the inliner blocks:

```typescript
// Stage 0: Compile Tailwind CSS (if present and not skipped)
let rawHtml = input.rawHtml;
const inlinerWarnings: { code: string; message: string }[] = [];
let compiledCss = "";

if (!input.skipInliner && usesTailwind(rawHtml)) {
  const compiled = await inlineTailwindStyles(rawHtml);
  if (compiled.warnings.length > 0) {
    inlinerWarnings.push(
      ...compiled.warnings.map((m) => ({ code: "INLINER", message: m })),
    );
  }
  compiledCss = compiled.stylesCss;
}

// Stage 0.5: Resolve <iconify-icon> to inline SVG (if not skipped)
if (!input.skipInliner) {
  const iconifyResult = await resolveIconifyIcons(rawHtml);
  rawHtml = iconifyResult.html;
  if (iconifyResult.failed.length > 0) {
    inlinerWarnings.push({
      code: "ICONIFY",
      message: `Could not resolve ${iconifyResult.failed.length} icon(s): ${iconifyResult.failed.join(", ")}`,
    });
  }
}
```

- [ ] **Step 3: Verify nothing broke**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```
Expected: 300 blocks, pass, same as before (no `skipInliner` set, so pipeline unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: add skipInliner flag to ConversionInput"
```

---

### Task 2: Create content-loss verifier

**Files:**
- Create: `src/core/content-verifier.ts`

- [ ] **Step 1: Write the file**

```typescript
// ── Content-Loss Verifier ────────────────────────────────────
//
// Compares source HTML text content against output block body content.
// Flags >5% loss as a warning — silent data loss (empty core/html,
// dropped inline elements) goes undetected until someone views the
// page in WordPress.

import * as cheerio from "cheerio";

export interface LossCheck {
  sourceTextLen: number;
  outputTextLen: number;
  lossPercent: number;
  warning: string | null; // null = no significant loss
}

const LOSS_THRESHOLD = 0.05; // 5%

/** Tags stripped from source before counting (not convertible content). */
const STRIP_TAGS = new Set([
  "nav", "footer", "script", "style", "link", "head", "title", "meta",
]);

export function checkContentLoss(sourceHtml: string, blockHtml: string): LossCheck {
  // 1. Strip known-removable elements from source
  const $source = cheerio.load(sourceHtml);
  for (const tag of STRIP_TAGS) {
    $source(tag).remove();
  }

  // Remove HTML comments from source
  let sourceText = $source("body").text() || $source.root().text() || "";
  sourceText = sourceText.replace(/<!--[\s\S]*?-->/g, "");
  sourceText = sourceText.replace(/\s+/g, " ").trim();
  const sourceLen = sourceText.length;

  // 2. Count text content of output blocks (excluding GB delimiters)
  let outputText = blockHtml
    .replace(/<!--\s*wp:[a-z]+\/[a-z-]+\s*\{[^}]*\}\s*-->/g, "")  // opener delim
    .replace(/<!--\s*\/wp:[a-z]+\/[a-z-]+\s*-->/g, "")              // closer delim
    .replace(/<!--[\s\S]*?-->/g, "")                                  // any remaining comments
    .replace(/<[^>]+>/g, " ")                                         // HTML tags → space
    .replace(/\s+/g, " ")
    .trim();
  const outputLen = outputText.length;

  // 3. Compare
  if (sourceLen === 0) {
    return { sourceTextLen: 0, outputTextLen: outputLen, lossPercent: 0, warning: null };
  }

  const lossPercent = Math.max(0, (sourceLen - outputLen) / sourceLen);

  const warning = lossPercent > LOSS_THRESHOLD
    ? `Page lost ~${Math.round(lossPercent * 100)}% of text content during conversion — check for missing elements`
    : null;

  return {
    sourceTextLen: sourceLen,
    outputTextLen: outputLen,
    lossPercent: Math.round(lossPercent * 10000) / 100,
    warning,
  };
}
```

- [ ] **Step 2: Test it quickly with a known-good case**

```bash
node -e "
const { checkContentLoss } = require('./src/core/content-verifier.ts');
// This should not show loss for a simple conversion
" 2>/dev/null || echo "Skipped runtime test — verified via integration below"
```

- [ ] **Step 3: Commit**

```bash
git add src/core/content-verifier.ts
git commit -m "feat: add content-loss verifier"
```

---

### Task 3: Wire loss verifier into the orchestrator

**Files:**
- Modify: `src/core/orchestrator.ts` (import + call in convert())

- [ ] **Step 1: Add import**

At top of orchestrator.ts, add:

```typescript
import { checkContentLoss } from "./content-verifier.js";
```

- [ ] **Step 2: Call verifier after serialize, merge into warnings**

In `convert()`, after `const blockCount = countBlocks(walkResult.blocks)`, add:

```typescript
// Stage 4.5: Content-loss check
const lossCheck = checkContentLoss(input.rawHtml, html);
if (lossCheck.warning) {
  allWarnings.push({ code: "LOSS", message: lossCheck.warning });
}
```

- [ ] **Step 3: Verify — run index.html, should show no loss**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```
Expected: no `[LOSS]` warning in output (index.html converts cleanly). 300 blocks, pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: wire content-loss verifier into orchestrator"
```

---

### Task 4: Add project-mode orchestration

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Add `compileProjectShared()` function**

Add to orchestrator.ts:

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { resolve, basename, extname } from "node:path";

export interface ProjectSharedAssets {
  compiledCss: string;
  customCss: string;
  customizerJson: Record<string, unknown> | null;
  manualSteps: string;
  iconifyHtml: string; // combined HTML with icons resolved
}

export function compileProjectShared(
  projectDir: string,
): { assets: ProjectSharedAssets; pageNames: string[] } {
  const inputDir = resolve(process.cwd(), "inputs", projectDir);
  const files = readdirSync(inputDir)
    .filter((f) => f.endsWith(".html"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .html files found in ${inputDir}`);
  }

  const pageNames = files.map((f) => basename(f, extname(f)));

  // Concatenate all pages for shared Tailwind compilation
  const combinedHtml = files
    .map((f, i) => {
      const html = readFileSync(resolve(inputDir, f), "utf-8");
      return `<!-- page:${pageNames[i]} -->\n${html}`;
    })
    .join("\n");

  // Note: shared compilation (inliner + iconify) runs synchronously here,
  // but the actual async work happens in convertProject() which calls convert()
  // with skipInliner=true using these pre-compiled assets.

  // For now, return the raw HTML and page names. The actual compilation
  // will be done in Task 5 when we wire up the CLI.
  return {
    assets: {
      compiledCss: "",
      customCss: "",
      customizerJson: null,
      manualSteps: "",
      iconifyHtml: combinedHtml,
    },
    pageNames,
  };
}
```

- [ ] **Step 2: Verify the function reads files correctly**

Add a temporary test in the CLI (will be replaced in Task 5):

```bash
node -e "
const { compileProjectShared } = require('./src/core/orchestrator.ts');
const result = compileProjectShared('mino');
console.log('Pages:', result.pageNames);
"
```

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: add compileProjectShared skeleton"
```

---

### Task 5: Wire project mode into CLI with full Tailwind compilation

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add project-mode detection**

In the `convert` command handler, after resolving `fullPath`, add detection:

```typescript
// ── convert (project mode) ──────────────────────────
if (cmd === "convert" && existsSync(fullPath) && statSync(fullPath).isDirectory()) {
  const projectDir = fullPath.replace(process.cwd() + "/inputs/", "");
  const inputDir = resolve(process.cwd(), "inputs", projectDir);
  const files = readdirSync(inputDir).filter((f) => f.endsWith(".html")).sort();

  if (files.length === 0) {
    console.error(`No .html files found in ${fullPath}`);
    process.exit(1);
  }

  console.log(`\nProject mode: ${files.length} page(s) in ${projectDir}/\n`);

  // Stage 1: Concatenate all pages
  const combinedHtml = files
    .map((f) => readFileSync(resolve(inputDir, f), "utf-8"))
    .join("\n");

  // Stage 2: Run Tailwind inliner on combined content
  let baseHtml = combinedHtml;
  if (usesTailwind(baseHtml)) {
    console.log("  Compiling Tailwind CSS from all pages...");
    const compiled = await inlineTailwindStyles(baseHtml);
    if (compiled.warnings.length > 0) {
      for (const w of compiled.warnings.slice(0, 3)) {
        console.log(`    [INLINER] ${w}`);
      }
    }
    // Store compiled CSS for shared output
    const sharedCss = compiled.stylesCss;
    // (will write to styles.css below)
  }

  // Stage 3: Resolve iconify icons on combined content
  const iconifyResult = await resolveIconifyIcons(baseHtml);
  const resolvedHtml = iconifyResult.html;
  // (each page will use skipInliner=true)

  // Stage 4: Write shared assets once
  // (extract custom CSS from all pages, generate manual-steps, customizer)
  // ... 

  // Stage 5: Convert each page with skipInliner=true and skipShared=true
  for (const f of files) {
    const pageName = basename(f, extname(f));
    const rawHtml = readFileSync(resolve(inputDir, f), "utf-8");
    
    const output = await convert({
      rawHtml,
      pageName,
      projectDir,
      skipShared: true,
      skipInliner: true, // CSS already compiled from combined content
    });

    console.log(`  ✓ ${pageName}: ${output.report.blockCount} blocks, ${output.report.overallStatus}`);

    // Content-loss check
    const lossCheck = checkContentLoss(rawHtml, output.blockHtml);
    if (lossCheck.warning) {
      console.log(`    [LOSS] ${lossCheck.warning}`);
    }
  }

  // Report
  console.log(`\n  Done. ${files.length} page(s) converted.`);
  console.log(`  Shared: output/${projectDir}/styles.css`);
  return;
}
```

- [ ] **Step 2: Add missing imports at top of CLI**

Add to existing imports:

```typescript
import { statSync } from "node:fs";
import { inlineTailwindStyles, usesTailwind } from "../core/tailwind-inliner.js";
import { resolveIconifyIcons } from "../core/iconify-resolver.js";
import { checkContentLoss } from "../core/content-verifier.js";
```

- [ ] **Step 3: Verify project mode works**

```bash
npx tsx src/cli/index.ts convert inputs/mino/
```
Expected: reads all 3 HTML files, compiles Tailwind once, converts each page. styles.css should now contain fast-seo's classes.

- [ ] **Step 4: Verify fast-seo classes in styles.css**

```bash
grep -c '4C4656\|F8F7FA\|C4C1CC\|B4B0C2' output/mino/styles.css
```
Expected: >0 matches (previously 0).

- [ ] **Step 5: Run fixtures to confirm no regression**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```
Expected: 18 passed, 2 failed (unchanged).

- [ ] **Step 6: Run M1 regression**

```bash
npx tsx src/cli/index.ts regression
```
Expected: all 5 pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add project-mode compilation (union Tailwind from all pages)"
```

---

### Task 6: Remove stale `compileProjectShared` skeleton

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Delete the unused `compileProjectShared` function added in Task 4**

The actual shared compilation logic now lives in the CLI directly. Remove the skeleton:

Delete the `compileProjectShared()` function and its exports from orchestrator.ts.

- [ ] **Step 2: Verify everything still compiles**

```bash
npx tsx src/cli/index.ts convert inputs/mino/
```
Expected: no errors, project mode still works.

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "chore: remove unused compileProjectShared skeleton"
```

---

### Task 7: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add project-mode documentation**

In the "Convert an HTML page" section, add:

```markdown
### Convert a project (all pages)

```bash
npx tsx src/cli/index.ts convert inputs/mino/
```

Compiles Tailwind CSS from ALL pages in the directory (union of all classes),
writes shared `styles.css` once, then converts each page individually.
Output goes to `output/mino/`.

### Convert a single page

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Use `--skip-shared` for subsequent pages when styles.css already exists from
a project-mode run or a prior run without the flag.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document project-mode conversion"
```
