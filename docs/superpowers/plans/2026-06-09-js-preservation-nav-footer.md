# JS Preservation + Nav/Footer Isolation + Pages Folder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve all JS into `setup/global.js`, isolate nav/footer into `components/`, reorganize page outputs into `pages/`.

**Architecture:** New `script-extractor.ts` extracts and deduplicates `<script>` tags. Preprocessor captures nav/footer HTML before stripping. CLI wires the new folder structure. Orchestrator paths updated for `pages/` subfolder.

**Tech Stack:** TypeScript, cheerio, Node.js fs

---

### Task 1: Create script-extractor.ts module

**Files:**
- Create: `src/core/script-extractor.ts`
- Create: `tests/script-extractor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/script-extractor.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { extractScripts, deduplicateScripts, formatGlobalJs } from "../src/core/script-extractor.js";

describe("extractScripts", () => {
  it("extracts external and inline scripts", () => {
    const html = `<html><head>
      <script src="https://cdn.example.com/lib.js"></script>
      <script>console.log("inline");</script>
    </head><body></body></html>`;
    const result = extractScripts(html, "test");
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].type, "external");
    assert.strictEqual(result[0].src, "https://cdn.example.com/lib.js");
    assert.strictEqual(result[1].type, "inline");
    assert.ok(result[1].content.includes('console.log("inline")'));
  });

  it("skips empty inline scripts", () => {
    const html = `<script>  </script><script src="a.js"></script>`;
    const result = extractScripts(html, "test");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, "external");
  });

  it("records source page name", () => {
    const result = extractScripts(`<script>a</script>`, "index");
    assert.strictEqual(result[0].sourcePage, "index");
  });
});

describe("deduplicateScripts", () => {
  it("deduplicates external scripts by src URL", () => {
    const input = [
      { type: "external" as const, src: "https://cdn.com/a.js", content: "https://cdn.com/a.js", sourcePage: "index" },
      { type: "external" as const, src: "https://cdn.com/a.js", content: "https://cdn.com/a.js", sourcePage: "blog" },
      { type: "external" as const, src: "https://cdn.com/b.js", content: "https://cdn.com/b.js", sourcePage: "blog" },
    ];
    const result = deduplicateScripts(input);
    assert.strictEqual(result.length, 2);
  });

  it("deduplicates inline scripts by normalized content", () => {
    const input = [
      { type: "inline" as const, content: "console.log(1)", sourcePage: "index" },
      { type: "inline" as const, content: "  console.log(1)  ", sourcePage: "blog" },
      { type: "inline" as const, content: "console.log(2)", sourcePage: "blog" },
    ];
    const result = deduplicateScripts(input);
    assert.strictEqual(result.length, 2);
  });
});

describe("formatGlobalJs", () => {
  it("formats external scripts as comments with wp_enqueue_script", () => {
    const scripts = [
      { type: "external" as const, src: "https://cdn.com/a.js", content: "https://cdn.com/a.js", sourcePage: "index" },
    ];
    const output = formatGlobalJs(scripts);
    assert.ok(output.includes("External Scripts"));
    assert.ok(output.includes("cdn.com/a.js"));
    assert.ok(output.includes("wp_enqueue_script"));
  });

  it("formats inline scripts with source comment", () => {
    const scripts = [
      { type: "inline" as const, content: "console.log(1)", sourcePage: "index" },
    ];
    const output = formatGlobalJs(scripts);
    assert.ok(output.includes("Inline Scripts"));
    assert.ok(output.includes("From index.html"));
    assert.ok(output.includes("console.log(1)"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/script-extractor.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create script-extractor.ts**

Create `src/core/script-extractor.ts`:

```typescript
// ── Script Extractor ─────────────────────────────────────────
//
// Extracts all <script> tags from HTML pages and produces a single
// global.js file with external references (as enqueue comments)
// and inline content preserved.

export interface ScriptEntry {
  type: "external" | "inline";
  src?: string;
  content: string;
  sourcePage: string;
}

/**
 * Extract all <script> tags from an HTML string.
 */
export function extractScripts(
  html: string,
  pageName: string,
): ScriptEntry[] {
  const scripts: ScriptEntry[] = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const body = match[2].trim();

    const srcMatch = attrs.match(/src=["']([^"']+)["']/);
    if (srcMatch) {
      scripts.push({
        type: "external",
        src: srcMatch[1],
        content: srcMatch[1],
        sourcePage: pageName,
      });
    } else if (body.length > 0) {
      scripts.push({
        type: "inline",
        content: body,
        sourcePage: pageName,
      });
    }
  }

  return scripts;
}

/**
 * Deduplicate scripts: same src URL or same normalized inline content.
 * Preserves first occurrence order.
 */
export function deduplicateScripts(allScripts: ScriptEntry[]): ScriptEntry[] {
  const seen = new Set<string>();
  const result: ScriptEntry[] = [];

  for (const script of allScripts) {
    const key =
      script.type === "external"
        ? `ext:${script.src}`
        : `inline:${script.content.replace(/\s+/g, " ").trim()}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(script);
    }
  }

  return result;
}

/**
 * Generate a slug from a URL for wp_enqueue_script handle.
 */
function slugFromUrl(url: string): string {
  const name = url.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "-") || "script";
  return name.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Format scripts as a global.js file.
 * External scripts become enqueue comments. Inline scripts are preserved as-is.
 */
export function formatGlobalJs(scripts: ScriptEntry[]): string {
  const externals = scripts.filter((s) => s.type === "external");
  const inlines = scripts.filter((s) => s.type === "inline");

  const lines: string[] = [];

  if (externals.length > 0) {
    lines.push("// === External Scripts ===");
    lines.push(
      "// Enqueue in functions.php or add via WPCode snippet plugin:",
    );
    lines.push("//");
    for (const s of externals) {
      const handle = slugFromUrl(s.src!);
      const version = "";
      lines.push(`//   <script src="${s.src}"></script>`);
      lines.push(
        `//   wp_enqueue_script('${handle}', '${s.src}', [], ${version ? `'${version}'` : "null"}, true);`,
      );
      lines.push("//");
    }
    lines.push("");
  }

  if (inlines.length > 0) {
    lines.push("// === Inline Scripts ===");
    lines.push("");
    for (const s of inlines) {
      lines.push(`// -- From ${s.sourcePage}.html --`);
      lines.push(s.content);
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/script-extractor.test.ts
```
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/script-extractor.ts tests/script-extractor.test.ts
git commit -m "feat: script-extractor — extract, deduplicate, and format JS for global.js"
```

---

### Task 2: Extract nav/footer HTML in preprocessor

**Files:**
- Modify: `src/core/preprocessor.ts`

- [ ] **Step 1: Add navHtml and footerHtml to PreprocessResult**

Add two new fields to the `PreprocessResult` interface:

```typescript
export interface PreprocessResult {
  html: string;
  classNameToProperties: Map<string, BlockStyles>;
  customCss: string;
  tailwindConfig: string | null;
  warnings: string[];
  navHtml: string | null;      // NEW
  footerHtml: string | null;   // NEW
}
```

- [ ] **Step 2: Capture nav/footer before stripping**

In `preprocess()`, before the `STRIP_TAGS.forEach` loop that removes elements, add:

```typescript
// 0.5. Capture nav and footer HTML before stripping
const navEl = $("nav").first();
const navHtml = navEl.length > 0 ? $.html(navEl) : null;
const footerEl = $("footer").first();
const footerHtml = footerEl.length > 0 ? $.html(footerEl) : null;
```

And update the return statement to include them:

```typescript
return {
  html: bodyHtml,
  classNameToProperties,
  customCss,
  tailwindConfig,
  warnings,
  navHtml,
  footerHtml,
};
```

- [ ] **Step 3: Run fixture regression to check no breakage**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```
Expected: Same results as before (18 passed, 2 pre-existing FIX_SOURCE failures).

- [ ] **Step 4: Commit**

```bash
git add src/core/preprocessor.ts
git commit -m "feat(preprocessor): capture nav and footer HTML before stripping"
```

---

### Task 3: Reorganize output paths to pages/ folder

**Files:**
- Modify: `src/core/orchestrator.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add pages subfolder to orchestrator output paths**

In `src/core/orchestrator.ts`, change `outDir` to include a `pages` subfolder for page-level outputs:

```typescript
// Write output files — use project subfolder if specified
const outDir = input.projectDir
  ? resolve(OUTPUT_DIR, input.projectDir)
  : OUTPUT_DIR;
const pagesDir = resolve(outDir, "pages");
mkdirSync(pagesDir, { recursive: true });
```

Then update page-level writes to use `pagesDir`:

```typescript
// Block markup
writeFileSync(
  resolve(pagesDir, `${input.pageName}.html`),
  html,
  "utf-8",
);

// Report
writeFileSync(
  resolve(pagesDir, `${input.pageName}.report.json`),
  JSON.stringify(report, null, 2) + "\n",
  "utf-8",
);
```

The shared files (styles.css, customizer-import.json, manual-steps.txt) remain at `outDir` level and are later moved by the CLI.

- [ ] **Step 2: Update CLI project-mode paths**

In `src/cli/index.ts`, update the project-mode section where `styles.css` is written and where the split files go:

After the for loop, change setup/ paths to reference `outDir` (not `pagesDir`). The split and setup files write to `outDir/setup/` and `outDir/pages/styles.css`:

```typescript
// After all pages: split styles.css into setup/ folder
const cssPath = resolve(outDir, "pages", "styles.css");
if (existsSync(cssPath)) {
  // ... split logic writes to setupDir (resolve(outDir, "setup"))
}

// Write styles.css to pages/ instead of outDir root
// This is done inside the first page's convert() call,
// which now writes to pagesDir.
```

Update the console output messages:

```typescript
console.log(`\n  Done. ${pageContents.length} page(s) converted.`);
console.log(`  Pages:       ${outputDir}pages/`);
console.log(`  Setup:       ${outputDir}setup/`);
```

- [ ] **Step 3: Update CLI single-page mode paths**

In the single-page `convert` section, update the output path messages:

```typescript
const outputPrefix = projectDir ? `output/${projectDir}/pages/` : "output/pages/";
console.log(`\nConverted: ${projectDir ? projectDir + "/" : ""}${pageName}`);
console.log(`  Output: ${outputPrefix}${pageName}.html`);
```

- [ ] **Step 4: Run project-mode conversion to verify paths**

```bash
rm -rf output/mino && npx tsx src/cli/index.ts convert inputs/mino/
```
Expected: All pages converted. Check that pages are in `output/mino/pages/`.

```bash
ls output/mino/pages/
# Expected: index.html, blog.html, ..., styles.css, plus report.json files
```

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts src/cli/index.ts
git commit -m "feat: reorganize page outputs into pages/ subfolder"
```

---

### Task 4: Wire JS extraction and nav/footer conversion into CLI

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add imports**

```typescript
import { extractScripts, deduplicateScripts, formatGlobalJs } from "../core/script-extractor.js";
```

- [ ] **Step 2: Add JS extraction in project mode**

In the project-mode section, after reading all page contents and before Tailwind compilation, add script extraction:

```typescript
// Stage 0: Extract all scripts from all pages
const allScripts: ScriptEntry[] = [];
for (const pc of pageContents) {
  allScripts.push(...extractScripts(pc.html, pc.name));
}
const uniqueScripts = deduplicateScripts(allScripts);
```

After all pages are converted and the setup folder is created, write `global.js`:

```typescript
// Write global.js after setup dir exists
if (uniqueScripts.length > 0) {
  writeFileSync(
    resolve(setupDir, "global.js"),
    formatGlobalJs(uniqueScripts),
    "utf-8",
  );
}
```

- [ ] **Step 3: Add nav/footer conversion in project mode**

After page conversion loop (and before the Done message), convert nav and footer:

```typescript
// Convert nav and footer components from the first page
const firstPageHtml = pageContents[0]?.html || "";
const prepResult = preprocess(firstPageHtml);

if (prepResult.navHtml) {
  console.log(`  Converting nav component...`);
  const componentsDir = resolve(outDir, "components");
  mkdirSync(resolve(componentsDir, "nav"), { recursive: true });

  // Wrap navHtml in a minimal HTML document for the converter
  const navDoc = `<!DOCTYPE html><html><head></head><body>${prepResult.navHtml}</body></html>`;
  const navOutput = await convert({
    rawHtml: navDoc,
    pageName: "nav",
    projectDir: input.projectDir ? `${input.projectDir}/components/nav` : "components/nav",
    skipShared: true,    // reuse existing setup files
    skipInliner: true,   // CSS already compiled
  });
  console.log(`    ✓ nav: ${navOutput.report.blockCount} blocks`);
}

if (prepResult.footerHtml) {
  console.log(`  Converting footer component...`);
  const componentsDir = resolve(outDir, "components");
  mkdirSync(resolve(componentsDir, "footer"), { recursive: true });

  const footerDoc = `<!DOCTYPE html><html><head></head><body>${prepResult.footerHtml}</body></html>`;
  const footerOutput = await convert({
    rawHtml: footerDoc,
    pageName: "footer",
    projectDir: input.projectDir ? `${input.projectDir}/components/footer` : "components/footer",
    skipShared: true,
    skipInliner: true,
  });
  console.log(`    ✓ footer: ${footerOutput.report.blockCount} blocks`);
}
```

Note: After component conversion, the `.html` and `.report.json` files will be in `output/mino/components/nav/` and `output/mino/components/footer/`. The `convert()` function with `skipShared: true` writes only page files. We need to clean up any nested `pages/` subfolder that gets created inside component dirs.

- [ ] **Step 4: Clean up nested pages dirs in components**

After nav/footer conversion, the orchestrator writes to `output/mino/components/nav/pages/nav.html` because of the pages subfolder. Move them up:

```typescript
// Flatten: components/nav/pages/nav.html → components/nav/nav.html
for (const comp of ["nav", "footer"]) {
  const compDir = resolve(outDir, "components", comp);
  const nestedPages = resolve(compDir, "pages");
  if (existsSync(nestedPages)) {
    for (const f of readdirSync(nestedPages)) {
      writeFileSync(resolve(compDir, f), readFileSync(resolve(nestedPages, f)));
      unlinkSync(resolve(nestedPages, f));
    }
    rmdirSync(nestedPages);
  }
}
```

- [ ] **Step 5: Run full project-mode conversion**

```bash
rm -rf output/mino && npx tsx src/cli/index.ts convert inputs/mino/
```
Expected output:
```
Project mode: 10 page(s) in mino/

  Compiling Tailwind CSS...
    ✓ Compiled (59.5 KB)
    [WARN] ...
  Converting nav component...
    ✓ nav: XX blocks
  Converting footer component...
    ✓ footer: XX blocks
  ✓ ai-integrations: 408 blocks, pass
  ...
  Done. 10 page(s) converted.
  Pages:       output/mino/pages/
  Setup:       output/mino/setup/
```

Verify folder structure:

```bash
ls output/mino/setup/          # global.js, global-styles.json, styles-unique.css, ...
ls output/mino/components/nav/ # nav.html, nav.report.json
ls output/mino/components/footer/ # footer.html, footer.report.json
ls output/mino/pages/          # index.html, blog.html, ..., styles.css, report.jsons
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: wire JS extraction and nav/footer conversion into CLI project mode"
```

---

### Task 5: Update manual-steps template

**Files:**
- Modify: `src/core/manual-steps.ts`

- [ ] **Step 1: Update manual steps for new structure**

Change the nav/footer steps from "REBUILD" to reference component files. Add a step for `global.js`:

```typescript
// Replace:
//   "2. REBUILD NAVIGATION" and "3. REBUILD FOOTER"
// With:
lines.push("2. IMPORT NAVIGATION");
lines.push("   Open components/nav/nav.html in the WordPress Code");
lines.push("   Editor and paste into your navigation block area.");
lines.push("");

lines.push("3. IMPORT FOOTER");
lines.push("   Open components/footer/footer.html in the WordPress Code");
lines.push("   Editor and paste into your footer block area.");
lines.push("");

// Add JS step (before or after CSS steps)
lines.push(`${next}. ADD JAVASCRIPT`);
lines.push("   Add setup/global.js to your site via WPCode plugin");
lines.push("   or enqueue in functions.php with wp_enqueue_script.");
lines.push("   This preserves all interactions and animations.");
lines.push("");
```

And update the numbering for subsequent steps (CSS, Customizer, Iconify, Images).

- [ ] **Step 2: Verify manual-steps output**

```bash
cat output/mino/setup/manual-steps.txt
```
Expected: References to `components/nav/nav.html`, `components/footer/footer.html`, and `setup/global.js`.

- [ ] **Step 3: Commit**

```bash
git add src/core/manual-steps.ts
git commit -m "docs: update manual-steps for components/ and global.js"
```

---

### Task 6: Update MEMORY.md

**Files:**
- Modify: `MEMORY.md`

- [ ] **Step 1: Document new features**

```markdown
### ✅ JS preservation + global.js (implemented 2026-06-09)

All `<script>` tags from source pages are extracted, deduplicated, and written
to `setup/global.js`. External CDN scripts become `wp_enqueue_script` comments.
Inline scripts are preserved as-is. Load `global.js` on every page — zero
classification risk, zero animation loss.

### ✅ Nav/footer isolation (implemented 2026-06-09)

Nav and footer are extracted from the index page before stripping and run
through the full conversion pipeline. Output to `components/nav/` and
`components/footer/` with `.html` and `.report.json` files.

### ✅ Pages folder (implemented 2026-06-09)

All page-level outputs moved to `pages/` subfolder for cleaner project structure.
```

- [ ] **Step 2: Commit**

```bash
git add MEMORY.md
git commit -m "docs: document JS preservation, nav/footer isolation, pages folder"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Script extraction + global.js → Task 1 + Task 4
- ✅ Nav/footer isolation → Task 2 + Task 4
- ✅ Pages folder reorganization → Task 3
- ✅ Manual steps update → Task 5
- ✅ Documentation → Task 6

**2. Placeholder scan:** No TBDs or TODOs. All code blocks are complete.

**3. Type consistency:** `ScriptEntry` defined in Task 1, consumed in Task 4. `PreprocessResult.navHtml/footerHtml` added in Task 2, consumed in Task 4.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-js-preservation-nav-footer.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks

**2. Inline Execution** — Execute tasks here with executing-plans, batch execution with checkpoints

Which approach?
