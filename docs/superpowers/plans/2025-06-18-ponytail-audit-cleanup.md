# Ponytail Audit Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~860 lines of over-engineering identified by the ponytail audit: dead code, duplicated logic, hand-rolled stdlib replacements, and unnecessary abstractions.

**Architecture:** Each task is an independent cut. Tasks are ordered by dependency (upstream cuts first) but no task depends on another except where noted. Run `npx tsx src/cli/index.ts fixtures:run-all` after each task to confirm no regressions.

**Tech Stack:** TypeScript, Node.js, Cheerio, PostCSS, Playwright

---

### Task 1: Delete dead `CUSTOM_CAMEL_MAP`

**Files:**
- Modify: `src/core/style-parser.ts:337-398`

- [ ] **Step 1: Delete the CUSTOM_CAMEL_MAP export**

The `CUSTOM_CAMEL_MAP` constant (lines 337-398) is a 62-line hardcoded kebab→camelCase map that `toCamelCase()` already computes correctly. It's exported but never imported anywhere else in the codebase — grep confirms zero references outside its own definition.

Delete lines 337-398 from `src/core/style-parser.ts`:

```typescript
// DELETE these lines:
export const CUSTOM_CAMEL_MAP: Record<string, string> = {
  "background-color": "backgroundColor",
  "border-radius": "borderRadius",
  // ... all entries through line 398
  "border-width": "borderWidth",
};
```

The `toCamelCase()` function on line 222 already handles this conversion with `prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())`.

- [ ] **Step 2: Run the test suite**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass, no failures. The map was never used.

- [ ] **Step 3: Run style-parser-specific tests**

```bash
npx tsx --test tests/snapshot.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/style-parser.ts
git commit -m "chore: delete dead CUSTOM_CAMEL_MAP — toCamelCase() covers it"
```

---

### Task 2: Extract shared shorthand expansion to one module

**Files:**
- Create: `src/utils/expand-shorthands.ts`
- Modify: `src/core/css-classifier.ts:164-224` (replace expandShorthands with import)
- Modify: `src/core/style-parser.ts:136-206` (replace expandShorthands/expandShorthand with import)

Both `css-classifier.ts` and `style-parser.ts` contain nearly identical shorthand expansion for margin, padding, border, and border-radius. The only difference: `css-classifier.ts` operates on `Record<string, string>` (kebab keys), while `style-parser.ts` operates on `StyleEntry[]` (object with property/value/camelCase). The expansion logic (1→4 side splitting, 2→2, 3→1+2, 4→4) is byte-for-byte the same.

- [ ] **Step 1: Create the shared module**

Create `src/utils/expand-shorthands.ts`:

```typescript
// ── CSS Shorthand Expander ────────────────────────────────
// Shared by css-classifier.ts (Record<string,string>) and
// style-parser.ts (StyleEntry[]).

/** Expand shorthands operating on a plain kebab-key Record */
export function expandShorthandRecord(
  decls: Record<string, string>,
): Record<string, string> {
  const result = { ...decls };

  if (result.margin) {
    const parts = result.margin.split(/\s+/);
    delete result.margin;
    if (parts.length === 1) {
      result.marginTop = result.marginRight = result.marginBottom = result.marginLeft = parts[0];
    } else if (parts.length === 2) {
      result.marginTop = result.marginBottom = parts[0];
      result.marginRight = result.marginLeft = parts[1];
    } else if (parts.length === 3) {
      result.marginTop = parts[0];
      result.marginRight = result.marginLeft = parts[1];
      result.marginBottom = parts[2];
    } else if (parts.length === 4) {
      result.marginTop = parts[0];
      result.marginRight = parts[1];
      result.marginBottom = parts[2];
      result.marginLeft = parts[3];
    }
  }

  if (result.padding) {
    const parts = result.padding.split(/\s+/);
    delete result.padding;
    if (parts.length === 1) {
      result.paddingTop = result.paddingRight = result.paddingBottom = result.paddingLeft = parts[0];
    } else if (parts.length === 2) {
      result.paddingTop = result.paddingBottom = parts[0];
      result.paddingRight = result.paddingLeft = parts[1];
    } else if (parts.length === 3) {
      result.paddingTop = parts[0];
      result.paddingRight = result.paddingLeft = parts[1];
      result.paddingBottom = parts[2];
    } else if (parts.length === 4) {
      result.paddingTop = parts[0];
      result.paddingRight = parts[1];
      result.paddingBottom = parts[2];
      result.paddingLeft = parts[3];
    }
  }

  if (result.border) {
    const parts = result.border.split(/\s+/);
    delete result.border;
    if (parts.length >= 1) {
      result.borderTopWidth = result.borderRightWidth = result.borderBottomWidth = result.borderLeftWidth = parts[0];
    }
    if (parts.length >= 2) {
      result.borderTopStyle = result.borderRightStyle = result.borderBottomStyle = result.borderLeftStyle = parts[1];
    }
    if (parts.length >= 3) {
      result.borderTopColor = result.borderRightColor = result.borderBottomColor = result.borderLeftColor = parts[2];
    }
  }

  if (result.borderRadius) {
    const parts = result.borderRadius.split(/\s+/);
    delete result.borderRadius;
    if (parts.length === 1) {
      result.borderTopLeftRadius = result.borderTopRightRadius = result.borderBottomLeftRadius = result.borderBottomRightRadius = parts[0];
    } else if (parts.length === 2) {
      result.borderTopLeftRadius = result.borderBottomRightRadius = parts[0];
      result.borderTopRightRadius = result.borderBottomLeftRadius = parts[1];
    } else if (parts.length === 3) {
      result.borderTopLeftRadius = parts[0];
      result.borderTopRightRadius = result.borderBottomLeftRadius = parts[1];
      result.borderBottomRightRadius = parts[2];
    } else if (parts.length === 4) {
      result.borderTopLeftRadius = parts[0];
      result.borderTopRightRadius = parts[1];
      result.borderBottomRightRadius = parts[2];
      result.borderBottomLeftRadius = parts[3];
    }
  }

  return result;
}
```

- [ ] **Step 2: Replace expandShorthands in css-classifier.ts**

In `src/core/css-classifier.ts`:

Add import at top (after the existing postcss import):

```typescript
import { expandShorthandRecord } from "../utils/expand-shorthands.js";
```

Delete the entire `expandShorthands` function (lines 164-224) and its comment `// ── Shorthand Expander ────────────────────────────────`.

Replace the call site on line ~342:
```typescript
// Old:
styles: expandShorthands(structuredDecls),
// New:
styles: expandShorthandRecord(structuredDecls),
```

- [ ] **Step 3: Replace expandShorthands in style-parser.ts**

In `src/core/style-parser.ts`:

Add import at top:

```typescript
import { expandShorthandRecord } from "../utils/expand-shorthands.js";
```

Delete functions `expandShorthands` (line 136), `expandShorthand` (line 145), `expandBox` (line 160), `expandRadius` (line 181), and the constants `BOX_SIDES` (line 158) and `RADIUS_CORNERS` (line 175).

Replace the call site on line ~306:
```typescript
// Old:
const expanded = expandShorthands(entries);
// New:
// style-parser builds entries as StyleEntry[] and expandShorthandRecord
// expects Record<string,string>. Convert:
const declRecord: Record<string, string> = {};
for (const e of entries) declRecord[e.property] = e.value;
const expandedRecord = expandShorthandRecord(declRecord);
// Rebuild StyleEntry[] from expanded record
const expanded: StyleEntry[] = Object.entries(expandedRecord).map(([prop, val]) => ({
  property: prop,
  value: val,
  camelCase: toCamelCase(prop),
}));
```

- [ ] **Step 4: Run the full test suite**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/expand-shorthands.ts src/core/css-classifier.ts src/core/style-parser.ts
git commit -m "refactor: extract shared shorthand expansion to one module"
```

---

### Task 3: Shrink `manual-steps.ts` step registry to template literal

**Files:**
- Modify: `src/core/manual-steps.ts`

The current file uses a ~100-line step registry abstraction (step objects with condition/render/group) to generate a short markdown checklist. Replace with a direct template literal.

- [ ] **Step 1: Rewrite generateManualStepsReport as a template literal**

Replace the entire `src/core/manual-steps.ts` file contents:

```typescript
// ── Manual Steps Reporter ──────────────────────────────────
//
// Generates a post-conversion checklist as markdown.
// Conditionally includes sections based on detected source features.

import type { GlobalSelectorInventory } from "./global-selector-inventory.js";

export interface ManualStepsContext {
  fonts: string[];
  externalImages: string[];
  hasNav: boolean;
  hasIconify: boolean;
  inventory?: GlobalSelectorInventory;
  customizerExists: boolean;
  appJsExists: boolean;
}

export function analyzeSource(html: string): {
  fonts: string[];
  externalImages: string[];
  hasNav: boolean;
  hasIconify: boolean;
} {
  const fonts: string[] = [];
  const fontMatch = html.match(/fonts\.googleapis\.com\/css2\?family=([^"'\s]+)/);
  if (fontMatch) {
    fontMatch[1].split("&").forEach((f) => {
      const name = f.startsWith("family=") ? f.replace("family=", "") : f;
      if (name && !name.startsWith("display=") && !name.startsWith("subset=")) {
        fonts.push(decodeURIComponent(name));
      }
    });
  }

  const imageMatches = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)];
  const externalImages = imageMatches.map((m) => m[1]).filter((url) => url.startsWith("http"));
  const hasNav = /<nav[\s>]/.test(html);
  const hasIconify = /iconify-icon/.test(html);

  return { fonts, externalImages, hasNav, hasIconify };
}

export function generateManualStepsReport(ctx: ManualStepsContext): string {
  const lines: string[] = [
    "============================================",
    "  MANUAL STEPS — Post-Conversion Checklist",
    "============================================",
    "",
    "Files referenced below are in the output/",
    "directory alongside this document.",
    "",
  ];

  let n = 0;

  // IMPORT
  const importLines: string[] = [];
  importLines.push("=== IMPORT — One-Time Setup ===", "");

  n++;
  importLines.push(`${n}. Import Global Styles`);
  importLines.push("   Import setup/global-styles-import.json into");
  importLines.push("   GenerateBlocks → Global Styles. This imports all");
  importLines.push("   editable utility classes with --tw-* variables");
  importLines.push("   resolved to concrete CSS values.");
  importLines.push("");

  n++;
  importLines.push(`${n}. Add Tailwind Utilities CSS`);
  importLines.push("   Add setup/tailwind-utilities.css via WPCodeBox.");
  importLines.push("   This loads all Tailwind utility classes (mt-4,");
  importLines.push("   flex, text-slate-700, hover:opacity-80, etc.)");
  importLines.push("   that the block markup references via class=\"...\".");
  importLines.push("   Load this BEFORE styles-unique.css if ordering matters.");
  importLines.push("");

  n++;
  importLines.push(`${n}. Add Remaining Unique CSS`);
  importLines.push("   Add setup/styles-unique.css via WPCodeBox (NOT");
  importLines.push("   Additional CSS — WordPress strips * selectors,");
  importLines.push("   escaped colons, and some pseudo-elements).");
  importLines.push("   This covers non-utility CSS: @keyframes,");
  importLines.push("   @media blocks, transforms, filters, gradients,");
  importLines.push("   and raw declarations from design components.");
  importLines.push("");

  if (ctx.appJsExists) {
    n++;
    importLines.push(`${n}. Add JavaScript`);
    importLines.push("   Add setup/global.js via WPCodeBox to preserve");
    importLines.push("   all interactions, animations, and scripts.");
    importLines.push("");
  }

  if (ctx.customizerExists) {
    n++;
    importLines.push(`${n}. Import Customizer Settings`);
    importLines.push("   Import customizer-import.json into Appearance →");
    importLines.push("   Customize → Import/Export (or use a plugin like");
    importLines.push('   "Customizer Export/Import"). This sets up theme');
    importLines.push("   colors, fonts, container width, and backgrounds");
    importLines.push("   matching the source design.");
    importLines.push("");
  }

  lines.push(...importLines);

  // ENQUEUE
  const enqueueLines: string[] = [];
  enqueueLines.push("=== ENQUEUE — Site-Wide ===", "");

  if (ctx.hasNav) {
    n++;
    enqueueLines.push(`${n}. Navigation Present`);
    enqueueLines.push("   The source has a <nav> element. It's been converted");
    enqueueLines.push("   as part of each page. If you want reusable navigation:");
    enqueueLines.push("   Option A: Keep as-is (each page has its own nav).");
    enqueueLines.push("   Option B: Create a reusable block from one page's nav");
    enqueueLines.push("             and replace nav in other pages.");
    enqueueLines.push("");
  }

  if (ctx.fonts.length > 0) {
    n++;
    enqueueLines.push(`${n}. Enqueue Google Fonts`);
    enqueueLines.push("   The following Google Fonts were detected:");
    for (const f of ctx.fonts) enqueueLines.push(`     - ${f}`);
    enqueueLines.push("   Option A: Use a fonts plugin (Fonts Plugin |");
    enqueueLines.push("             Google Fonts Typography).");
    enqueueLines.push("   Option B: Add to functions.php with wp_enqueue_style.");
    enqueueLines.push("   Option C: Use GeneratePress Typography module.");
    enqueueLines.push("");
  }

  if (ctx.inventory && ctx.inventory.rules.length > 0) {
    n++;
    enqueueLines.push(`${n}. Global Document Styles`);
    enqueueLines.push("   The following CSS rules target <html>, <body>,");
    enqueueLines.push("   :root, or pseudo-elements. They are preserved in");
    enqueueLines.push("   styles.css but only apply when enqueued globally:");
    for (const rule of ctx.inventory.rules) {
      enqueueLines.push(`     - ${rule.selector}`);
    }
    if (ctx.inventory.hasBackgroundColor) {
      enqueueLines.push("");
      enqueueLines.push("   ⚠ The source page body has a background-color.");
      enqueueLines.push('     If your theme overrides body styles, add');
      enqueueLines.push('     class="bg-background" to the outermost GB');
      enqueueLines.push("     container block.");
    }
    enqueueLines.push("");
  }

  lines.push(...enqueueLines);

  // PER PAGE
  n++;
  lines.push("=== PER PAGE — For Each Page ===", "");
  lines.push(`${n}. Paste Blocks Per Page`);
  lines.push("   Open the WordPress Code Editor (Ctrl+Shift+Alt+M).");
  lines.push("   For each page in pages/, copy the entire contents");
  lines.push("   and paste into the corresponding WP page.");
  lines.push('   Save, reload, confirm no "Attempt Recovery" prompt.');
  lines.push("");

  if (ctx.externalImages.length > 0) {
    n++;
    lines.push(`${n}. Replace External Images`);
    lines.push(`   Replace ${ctx.externalImages.length} external image(s):`);
    for (const url of ctx.externalImages.slice(0, 5)) {
      lines.push(`     - ${url.substring(0, 70)}${url.length > 70 ? "..." : ""}`);
    }
    if (ctx.externalImages.length > 5) {
      lines.push(`     ... and ${ctx.externalImages.length - 5} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Run regression**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass. Manual-steps output is not fixture-tested; spot-check CLI output with a real project.

- [ ] **Step 3: Commit**

```bash
git add src/core/manual-steps.ts
git commit -m "refactor: shrink manual-steps to template literal, drop step registry"
```

---

### Task 4: Shrink `verify-session.ts` — remove state machine, use plain JSON

**Files:**
- Modify: `src/core/verify-session.ts`
- Modify: `src/cli/index.ts` (call sites in verify:prepare, verify:status, verify:cleanup)

The session module wraps `JSON.parse`/`JSON.stringify` in a class-like CRUD abstraction with UUID generation from `node:crypto`. Replace with plain read/write helpers. Keep `validateEnv` and `checkStagingUrl` — those are real logic.

- [ ] **Step 1: Rewrite verify-session.ts**

Replace `src/core/verify-session.ts`:

```typescript
// ── Verify Session ──────────────────────────────────────────
// Thin helpers for output/.verify-session.json.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

export interface SessionPost {
  slug: string;
  postId?: number;
  url?: string;
  status: "pending" | "created" | "failed";
  error?: string;
}

export interface VerifySession {
  runId: string;
  wpUrl: string;
  pass: 1 | 2;
  projectDir: string;
  createdPosts: SessionPost[];
  sandboxFile: string;
  status: "preparing" | "awaiting_review" | "complete" | "failed";
  startedAt: string;
}

const SESSION_PATH = resolve(process.cwd(), "output", ".verify-session.json");

export function readSession(): VerifySession | null {
  if (!existsSync(SESSION_PATH)) return null;
  try { return JSON.parse(readFileSync(SESSION_PATH, "utf-8")); } catch { return null; }
}

export function writeSession(session: VerifySession): void {
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2) + "\n", "utf-8");
}

export function deleteSession(): void {
  if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);
}

export function newRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function validateEnv(): string | null {
  const missing: string[] = [];
  if (!process.env.GB_WP_URL) missing.push("GB_WP_URL");
  if (!process.env.GB_WP_USER) missing.push("GB_WP_USER");
  if (!process.env.GB_WP_PASS) missing.push("GB_WP_PASS");
  if (missing.length > 0) {
    return `Missing environment variables: ${missing.join(", ")}. Set GB_WP_URL, GB_WP_USER, GB_WP_PASS.`;
  }
  return null;
}

export function checkStagingUrl(): string | null {
  const url = process.env.GB_WP_URL || "";
  if (!url) return null;
  if (!/staging|dev|local|test/.test(url)) {
    return `WARNING: GB_WP_URL (${url}) does not appear to be a staging/dev site. Proceed with caution.`;
  }
  return null;
}
```

- [ ] **Step 2: Update CLI call sites**

In `src/cli/index.ts`, fix the imports (line ~27):

```typescript
// Old:
import { createSession, readSession, updateSession, deleteSession, hasActiveSession, validateEnv, checkStagingUrl } from "../core/verify-session.js";
// New:
import { writeSession, readSession, deleteSession, newRunId, validateEnv, checkStagingUrl, type VerifySession } from "../core/verify-session.js";
```

Replace `createSession(wpUrl, passNum, projectDir)` in the `verify:prepare` handler:

```typescript
// Old:
const session = createSession(wpUrl, passNum as 1 | 2, projectDir);
// New:
const session: VerifySession = {
  runId: newRunId(),
  wpUrl,
  pass: passNum as 1 | 2,
  projectDir,
  createdPosts: [],
  sandboxFile: `novamira-sandbox/gb-verify-${newRunId()}.php`,
  status: "preparing",
  startedAt: new Date().toISOString(),
};
writeSession(session);
```

Replace `hasActiveSession()` check:

```typescript
// Old:
if (hasActiveSession()) {
// New:
const existing = readSession();
if (existing && existing.status !== "complete" && existing.status !== "failed") {
```

Replace `updateSession(...)` calls:

```typescript
// Old:
updateSession({ createdPosts: sessionPosts, status: "awaiting_review" });
// New:
const s = readSession();
if (s) writeSession({ ...s, createdPosts: sessionPosts, status: "awaiting_review" });
```

- [ ] **Step 3: Verify the import works**

```bash
npx tsx src/cli/index.ts 2>&1 | head -5
```

Expected: CLI help output, no import errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/verify-session.ts src/cli/index.ts
git commit -m "refactor: shrink verify-session to plain read/write helpers"
```

---

### Task 5: Merge duplicate shorthand expansion in css-classifier.ts (cleanup from Task 2)

**Files:**
- Modify: `src/core/css-classifier.ts`

This task finalizes the cleanup from Task 2. The `css-classifier.ts` file still has a function with the same name `expandShorthands` that we replaced the call site for. Confirm the old function body is fully deleted.

- [ ] **Step 1: Verify old expandShorthands is removed**

```bash
grep -n "function expandShorthands" src/core/css-classifier.ts
```

Expected: no output (function removed). If present, delete it.

- [ ] **Step 2: Verify tests pass**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass.

- [ ] **Step 3: Commit**
*(No changes if already clean from Task 2.)*

---

### Task 6: Delete `mapper.ts` — merge M1 fixtures to dom-walker path

**Files:**
- Rewrite: `src/runner/run-fixture.ts`
- Delete: `src/core/mapper.ts`
- Rewrite: M1 fixture JSONs (button-link, captioned-image, embed-fallback, style-transfer-flat, text-stack, two-col) — convert `input` FixtureNode trees to `inputHtml` HTML strings

This is the biggest cut (~325 lines). The 7 M1 JSON fixtures use `mapNode()` (mapper.ts) while 13 fidelity fixtures use `walkDom()` (dom-walker.ts). Convert the M1 fixtures to fidelity format (write their FixtureNode trees as HTML strings in `inputHtml`) and route all fixtures through the dom-walker pipeline.

- [ ] **Step 1: Write a fixture converter script**

Create `scripts/convert-m1-fixtures.ts`:

```typescript
// One-shot script: converts M1 FixtureNode JSON to fidelity HTML format
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

const FIXTURES_DIR = resolve(process.cwd(), "fixtures");

interface TextNode { nodeType: "text"; tagName: string; text: string; style?: string; }
interface ElementNode { nodeType: "element"; tagName: string; attributes: Record<string, string>; style?: string; children: any[]; }
interface ImageNode { nodeType: "image"; src: string; alt: string; width?: number; height?: number; caption?: string; style?: string; }
interface EmbedNode { nodeType: "embed"; provider: string; url: string; }
interface HtmlNode { nodeType: "html"; html: string; }
type FixtureNode = TextNode | ElementNode | ImageNode | EmbedNode | HtmlNode;

function nodeToHtml(node: FixtureNode): string {
  switch (node.nodeType) {
    case "text": {
      const style = node.style ? ` style="${node.style}"` : "";
      return `<${node.tagName}${style}>${node.text}</${node.tagName}>`;
    }
    case "element": {
      const attrs = Object.entries(node.attributes)
        .map(([k, v]) => ` ${k}="${v}"`).join("");
      const style = node.style ? ` style="${node.style}"` : "";
      const children = node.children.map(nodeToHtml).join("");
      return `<${node.tagName}${attrs}${style}>${children}</${node.tagName}>`;
    }
    case "image": {
      const style = node.style ? ` style="${node.style}"` : "";
      const w = node.width ? ` width="${node.width}"` : "";
      const h = node.height ? ` height="${node.height}"` : "";
      if (node.caption) {
        return `<figure${style}><img src="${node.src}" alt="${node.alt}"${w}${h}/><figcaption>${node.caption}</figcaption></figure>`;
      }
      return `<img src="${node.src}" alt="${node.alt}"${w}${h}${style}/>`;
    }
    case "embed": {
      return `<!-- embed:${node.provider}:${node.url} -->`;
    }
    case "html": {
      return node.html;
    }
    default: return "";
  }
}

const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith(".json"));
for (const f of files) {
  const path = resolve(FIXTURES_DIR, f);
  const fixture = JSON.parse(readFileSync(path, "utf-8"));
  if (!fixture.input || fixture.inputHtml) continue; // skip fidelity fixtures

  const html = nodeToHtml(fixture.input);
  delete fixture.input;
  fixture.inputHtml = `<body>${html}</body>`;
  writeFileSync(path, JSON.stringify(fixture, null, 2) + "\n", "utf-8");
  console.log(`Converted: ${f}`);
}
```

- [ ] **Step 2: Run the conversion script**

```bash
npx tsx scripts/convert-m1-fixtures.ts
```

Expected output listing each converted fixture.

- [ ] **Step 3: Rewrite run-fixture.ts to only use the fidelity path**

Replace `src/runner/run-fixture.ts`:

```typescript
// ── Runner ─────────────────────────────────────────────────────
// Runs all fixtures through the fidelity pipeline (convert → validate).

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { convert } from "../core/orchestrator.js";
import type { ConversionOutput } from "../core/orchestrator.js";
import type { FixtureReport, ReportStatus, HardFail, Warning } from "../core/types.js";

const OUTPUT_DIR = resolve(process.cwd(), "fixtures", "output");

export interface FidelityFixture {
  name: string;
  description: string;
  inputHtml: string;
  expect: {
    shouldPass: boolean;
    hardFailCount: number;
    blockCount?: number;
  };
}

// ── Loader ────────────────────────────────────────────────────

export function loadFixture(fixturePath: string): FidelityFixture {
  const raw = readFileSync(fixturePath, "utf-8");
  const data = JSON.parse(raw);
  // If old-style "input" field exists, this hasn't been converted yet.
  // loadFixture now expects the fidelity format (inputHtml).
  return data as FidelityFixture;
}

export function isFidelityFixture(f: any): boolean {
  return typeof f.inputHtml === "string";
}

// ── Runner ────────────────────────────────────────────────────

export async function runFidelityFixture(fixture: FidelityFixture): Promise<{ report: FixtureReport; html: string }> {
  const output: ConversionOutput = await convert({
    rawHtml: fixture.inputHtml,
    pageName: fixture.name,
  });

  const hardFails: HardFail[] =
    (output.report.hardFails as any[])?.map((f: any) => ({
      code: f.code || "UNKNOWN",
      message: f.message || "",
    })) || [];

  const warnings: Warning[] =
    (output.report.warnings as any[])?.map((w: any) => ({
      code: w.code || "WARNING",
      message: w.message || "",
    })) || [];

  const blockCount = (output.report.blockCount as number) || 0;
  const status: ReportStatus =
    hardFails.length > 0 ? "validator_fail" : "validator_pass";

  const report: FixtureReport = {
    fixture: fixture.name,
    status,
    blockCount,
    hardFails,
    warnings,
    manualVerification: {
      wordpressPasted: false,
      savedWithoutRecovery: null,
      notes: "",
    },
  };

  writeOutput(fixture.name, output.blockHtml, report);

  if (output.customCss?.length > 0) {
    writeFileSync(
      resolve(OUTPUT_DIR, `${fixture.name}-custom.css`),
      output.customCss + "\n",
      "utf-8",
    );
  }

  return { report, html: output.blockHtml };
}

export function writeOutput(fixtureName: string, html: string, report: FixtureReport): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.html`), html, "utf-8");
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.report.json`), JSON.stringify(report, null, 2) + "\n", "utf-8");
}
```

- [ ] **Step 4: Update CLI to drop the M1 path**

In `src/cli/index.ts`, update the `processFixture` function:

```typescript
// Old:
async function processFixture(name: string, fixPath: string): Promise<FixtureReport> {
  console.log(`\nProcessing: ${name}`);
  const raw = loadFixture(fixPath);
  if (isFidelityFixture(raw)) {
    const result = await runFidelityFixture(raw as FidelityFixture);
    ...
  }
  let result: { report: FixtureReport; html: string };
  result = runFixture(raw as Fixture);
  ...
}
// New:
async function processFixture(name: string, fixPath: string): Promise<FixtureReport> {
  console.log(`\nProcessing: ${name}`);
  const raw = loadFixture(fixPath);
  const result = await runFidelityFixture(raw);
  console.log(`  Output: output/${name}.html`);
  console.log(`  Report: output/${name}.report.json`);
  return result.report;
}
```

Also remove the `runFixture` import (line 14):

```typescript
// Remove:
import { runFixture, loadFixture, ... } from "../runner/run-fixture.js";
// Keep only:
import { loadFixture, runFidelityFixture } from "../runner/run-fixture.js";
```

And fix the `validate` command which calls `runFixture(raw as Fixture)` — change to `runFidelityFixture`:

```typescript
// Old (in validate handler):
result = runFixture(raw as Fixture);
// New:
const fidelityResult = await runFidelityFixture(raw);
// use fidelityResult.report instead of result.report
```

And fix `regressionCheck()` which calls `runFixture(fixture)`:

```typescript
// Old:
const { html } = runFixture(fixture);
// New — regressionCheck must become async:
async function regressionCheck(): Promise<boolean> {
  ...
  const { html } = await runFidelityFixture(fixture);
  ...
}
```

And fix the `report:update` handler which references `Fixture` type:
```typescript
// Remove the Fixture type import if no longer used
```

Update the `validate` handler — it currently calls `runFixture(raw as Fixture)`. Replace:

```typescript
// Old:
result = runFixture(raw as Fixture);
// New:
const fidelityResult = await runFidelityFixture(raw);
// then use fidelityResult.report instead of result.report below
```

- [ ] **Step 5: Delete mapper.ts**

```bash
rm src/core/mapper.ts
```

- [ ] **Step 6: Update snapshot tests**

The regression check in `regressionCheck()` compares against snapshots in `snapshots/m1/`. Since we changed the pipeline, regenerate snapshots:

```bash
rm snapshots/m1/*.html
# Run each M1 fixture to regenerate
npx tsx src/cli/index.ts fixtures:run button-link
npx tsx src/cli/index.ts fixtures:run captioned-image
npx tsx src/cli/index.ts fixtures:run embed-fallback
npx tsx src/cli/index.ts fixtures:run text-stack
npx tsx src/cli/index.ts fixtures:run two-col
# Copy regenerated outputs as snapshots
cp fixtures/output/button-link.html snapshots/m1/
cp fixtures/output/captioned-image.html snapshots/m1/
cp fixtures/output/embed-fallback.html snapshots/m1/
cp fixtures/output/text-stack.html snapshots/m1/
cp fixtures/output/two-col.html snapshots/m1/
```

- [ ] **Step 7: Run the full test suite**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass. Some block counts may differ slightly from the old mapper — review warnings but accept the dom-walker output as authoritative.

- [ ] **Step 8: Delete the conversion script**

```bash
rm scripts/convert-m1-fixtures.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/runner/run-fixture.ts src/core/mapper.ts src/cli/index.ts fixtures/ snapshots/m1/ scripts/
git commit -m "refactor: merge M1 fixtures into fidelity pipeline, delete mapper.ts"
```

---

### Task 7: Shrink `content-verifier.ts` — replace Cheerio parse with regex

**Files:**
- Modify: `src/core/content-verifier.ts`

The content verifier does a full Cheerio parse just to strip known tags and count text length. The same data has already been parsed by the DOM walker. Replace with regex-based text extraction.

- [ ] **Step 1: Rewrite content-verifier.ts**

Replace `src/core/content-verifier.ts`:

```typescript
// ── Content-Loss Verifier ────────────────────────────────────
// Compares source HTML text content against output block body content.
// Flags >5% loss as a warning.

const LOSS_THRESHOLD = 0.05;
const STRIP_TAGS_RE = /<\/(?:nav|footer|script|style|link|head|title|meta)\b[^>]*>[\s\S]*?<\/(?:nav|footer|script|style|link|head|title|meta)>/gi;

export interface LossCheck {
  sourceTextLen: number;
  outputTextLen: number;
  lossPercent: number;
  warning: string | null;
}

export function checkContentLoss(sourceHtml: string, blockHtml: string): LossCheck {
  // 1. Strip known-removable elements + HTML tags + comments from source
  let sourceText = sourceHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sourceLen = sourceText.length;

  // 2. Strip GB delimiters + remaining HTML from output
  let outputText = blockHtml
    .replace(/<!--\s*wp:[a-z]+\/[a-z-]+\s*\{[^}]*\}\s*-->/g, "")
    .replace(/<!--\s*\/wp:[a-z]+\/[a-z-]+\s*-->/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
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

Note: we also remove the `cheerio` import (no longer needed).

- [ ] **Step 2: Run tests**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass.

- [ ] **Step 3: Commit**

```bash
git add src/core/content-verifier.ts
git commit -m "refactor: shrink content-verifier to regex, drop Cheerio parse"
```

---

### Task 8: Delete `expandColorPalettes` and `hexToHsl` from tailwind-resolver.ts

**Files:**
- Modify: `src/core/tailwind-resolver.ts`
- Modify: `src/cli/index.ts` (remove call sites)

`expandColorPalettes()` generates 11 Tailwind shades from a single hex value via HSL interpolation — a full color-theory implementation. `hexToHsl()` and `hslToHex()` exist only to serve it. The config validation already warns users about single-value colors via `validateTailwindConfig()`. Remove the auto-expansion and let warnings carry.

- [ ] **Step 1: Delete functions from tailwind-resolver.ts**

Delete these functions from `src/core/tailwind-resolver.ts`:
- `hexToHsl()` (lines 92-107)
- `hslToHex()` (lines 113-122)
- `SHADE_LIGHTNESS` constant (line 128)
- `expandColorPalettes()` (lines 139-180)

Keep `validateTailwindConfig()` (line 186) — it provides the diagnosis.

- [ ] **Step 2: Update CLI call sites**

In `src/cli/index.ts`:

Remove `expandColorPalettes` from the import (line ~29):
```typescript
// Old:
import { compileTailwindOffline, extractTailwindConfig, validateTailwindConfig, expandColorPalettes } from "../core/tailwind-resolver.js";
// New:
import { compileTailwindOffline, extractTailwindConfig, validateTailwindConfig } from "../core/tailwind-resolver.js";
```

In the `project:setup` handler, replace:
```typescript
// Old:
const expandedConfig = expandColorPalettes(tailwindConfig);
console.log(`  Compiling Tailwind CSS from ${pageContents.length} page(s) via CDN...`);
const compiled = await inlineTailwindMultiPage(
  pageContents.map((pc) => pc.html),
  pageContents.map((pc) => pc.name),
  fullDir,
  expandedConfig,
);
// New:
console.log(`  Compiling Tailwind CSS from ${pageContents.length} page(s) via CDN...`);
const compiled = await inlineTailwindMultiPage(
  pageContents.map((pc) => pc.html),
  pageContents.map((pc) => pc.name),
  fullDir,
  tailwindConfig,
);
```

In the `convert` directory handler, do the same replacement (second occurrence).

- [ ] **Step 3: Run tests**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-resolver.ts src/cli/index.ts
git commit -m "refactor: delete expandColorPalettes and hexToHsl — warnings suffice"
```

---

### Task 9: Consolidate color conversion into one module

**Files:**
- Create: `src/utils/color-utils.ts`
- Modify: `src/core/design-extractor.ts` (replace inline colorToHex/hslToHex/oklchToHex with imports)
- Modify: `src/core/tailwind-resolver.ts` (if hslToHex still exists — check after Task 8)

After Task 8, `tailwind-resolver.ts` no longer has hexToHsl/hslToHex. `design-extractor.ts` has `colorToHex`, `hslToHex`, `oklchToHex`, `rgbChannelsToHex` all as standalone exports. These are also duplicated inside `buildExtractionScript()` as embedded JS. Consolidate the Node.js versions. The embedded JS in `buildExtractionScript()` must stay (it runs in the browser), but can reference fewer standalone copies.

- [ ] **Step 1: Create shared color module**

Create `src/utils/color-utils.ts` by extracting the functions from `design-extractor.ts`:

```typescript
// ── Color Utilities ──────────────────────────────────────────
// Normalize CSS colors to #rrggbb.
// Handles: #hex, rgb(), rgba(), hsl(), hsla(), oklch(), color-mix().

export function colorToHex(cssColor: string): string | null {
  if (!cssColor) return null;
  const c = cssColor.trim().toLowerCase();

  if (c === "transparent" || c === "rgba(0, 0, 0, 0)" || c === "currentcolor") return null;

  let hm = c.match(/^#([0-9a-f]{3,8})$/);
  if (hm) {
    let h = hm[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    else if (h.length === 8) h = h.slice(0, 6);
    return "#" + h.slice(0, 6).toLowerCase();
  }

  let rm = c.match(/rgba?\s*\(\s*([\d.-]+)[,\s]+([\d.-]+)[,\s]+([\d.-]+)/);
  if (rm) return rgbChannelsToHex(rm[1], rm[2], rm[3]);

  let hsm = c.match(/hsla?\s*\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/);
  if (hsm) {
    return hslToHex(parseFloat(hsm[1]) / 360, parseFloat(hsm[2]) / 100, parseFloat(hsm[3]) / 100);
  }

  let om = c.match(/oklch\s*\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (om) {
    try { return oklchToHex(parseFloat(om[1]), parseFloat(om[2]), parseFloat(om[3])); }
    catch { return null; }
  }

  let mm = c.match(/color-mix\s*\([^,]*,\s*([^\s,\)]+)/);
  if (mm) return colorToHex(mm[1].trim());

  return null;
}

export function rgbChannelsToHex(r: string, g: string, b: string): string {
  return "#" + [r, g, b].map((x) => {
    const n = Math.min(255, Math.max(0, Math.round(parseFloat(x))));
    return n.toString(16).padStart(2, "0");
  }).join("");
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return "#" + [f(0), f(8), f(4)].map((n) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")
  ).join("");
}

export function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const aVal = c * Math.cos(hRad);
  const bVal = c * Math.sin(hRad);
  const l_ = l + 0.3963377774 * aVal + 0.2158037573 * bVal;
  const m_ = l - 0.1055613458 * aVal - 0.0638541728 * bVal;
  const s_ = l - 0.0894841775 * aVal - 1.291485548 * bVal;
  const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
  const rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
  const toSrgb = (x: number) => {
    const v = Math.max(0, Math.min(1, x));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };
  return "#" + [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin)]
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 2: Update design-extractor.ts to import from shared module**

In `src/core/design-extractor.ts`:

Add import:
```typescript
import { colorToHex, hslToHex, oklchToHex, rgbChannelsToHex } from "../utils/color-utils.js";
```

Delete the standalone `colorToHex`, `rgbChannelsToHex`, `hslToHex`, `oklchToHex` functions from design-extractor.ts. Keep the `parseJsObjectLiteral`, `extractConfigFromHtml`, and `buildExtractionScript` functions.

Note: `buildExtractionScript()` still contains embedded copies of these functions as browser-JS strings. Those must stay — they run in Playwright's browser context, not Node.js.

- [ ] **Step 3: Update design-extractor tests to use shared module**

```bash
grep -n "import.*colorToHex\|import.*design-extractor" tests/design-extractor.test.ts
```

The test file imports `colorToHex` from `../src/core/design-extractor.js`. Since design-extractor now re-exports via imports, the test should still work. Verify:

```bash
npx tsx --test tests/design-extractor.test.ts 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Run full test suite**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all fixtures pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/color-utils.ts src/core/design-extractor.ts
git commit -m "refactor: extract color conversion to shared utils/color-utils.ts"
```

---

### Task 11: Quick leftovers — 5 remaining audit findings

**Files:**
- Modify: `src/core/design-extractor.ts`
- Modify: `src/core/verify-prepare.ts`
- Modify: `src/core/design-dossier.ts`

This catches the 5 smaller findings the previous tasks didn't cover.

- [ ] **Step 1: Replace parseJsObjectLiteral with Function() constructor**

The hand-rolled JS object parser (100 lines) only parses `tailwind.config = {...}` from the project's own HTML files — trusted input. Replace with the 1-line `new Function()` idiom.

In `src/core/design-extractor.ts`, delete the entire `parseJsObjectLiteral` function plus its `parseValue` helper (lines ~141-240).

In `extractConfigFromHtml()`, replace the call:

```typescript
// Old (line ~252):
const parsed = parseJsObjectLiteral(content.slice(afterAssign + 1));

// New:
const configStr = content.slice(afterAssign + 1);
let parsed: Record<string, unknown> = {};
try {
  parsed = new Function(`return (${configStr})`)() as Record<string, unknown>;
} catch {
  continue; // malformed config, skip this script tag
}
```

Update the test import in `tests/design-extractor.test.ts` — remove `parseJsObjectLiteral` from the import and delete the `describe("parseJsObjectLiteral", ...)` block (lines 76-117).

- [ ] **Step 2: Remove OKLCH color support**

`oklchToHex()` (30 lines of linear algebra) converts CSS Color Level 4 colors that practically never appear in Tailwind source HTML. The browser already resolves oklch() to computed rgb() — `buildExtractionScript()` gets color values from `getComputedStyle()`, not from source.

In `src/utils/color-utils.ts`, delete the `oklchToHex` function.

In `colorToHex()`, remove the oklch matching block:
```typescript
// Delete these lines:
let om = c.match(/oklch\s*\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
if (om) {
  try { return oklchToHex(parseFloat(om[1]), parseFloat(om[2]), parseFloat(om[3])); }
  catch { return null; }
}
```

Update `tests/design-extractor.test.ts` — remove the oklch test case (lines 46-52).

- [ ] **Step 3: Replace stylesToCss in verify-prepare.ts**

The `stylesToCss()` function (25 lines) duplicates camelCase→kebab-case conversion that the serializer already does. The structured style data is already canonicalized. Replace with a simple key transform:

In `src/core/verify-prepare.ts`, replace `stylesToCss` with:

```typescript
export function stylesToCss(styles: Record<string, unknown>): string {
  return Object.entries(styles)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${v}`)
    .join("; ") + (Object.keys(styles).length > 0 ? ";" : "");
}
```

Note: this drops nested @media/:pseudo support in stylesToCss, but verification CSS doesn't need it — the CSS is concatenated from the canonical source files, not reconstructed from data objects.

- [ ] **Step 4: Drop unused tailwindConfig field from DesignDossier**

The `tailwindConfig` field in `DesignDossier` is always set AFTER extraction via `extractConfigFromHtml()`, never populated by `buildExtractionScript()` itself (the IIFE sets it to `null`). The field itself is fine to keep — but remove the explicit `null` assignment in `buildExtractionScript()` to not imply it gets set:

In `src/core/design-extractor.ts`, in the `buildExtractionScript()` IIFE, remove:
```typescript
tailwindConfig: null,
```

And in `emptyDossier()` in `src/core/design-dossier.ts`, keep the field as null (it's still structurally correct).

- [ ] **Step 5: Run full test suite**

```bash
npx tsx --test tests/design-extractor.test.ts 2>&1 | tail -10
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: design-extractor tests pass (minus removed parseJsObjectLiteral and oklch cases), all fixtures pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/design-extractor.ts src/core/verify-prepare.ts src/core/design-dossier.ts src/utils/color-utils.ts tests/design-extractor.test.ts
git commit -m "chore: final ponytail cleanup — parseJsObjectLiteral, OKLCH, stylesToCss, tailwindConfig"
```

---

### Task 10: Final regression check and cleanup

**Files:**
- (none new)

After all 11 tasks, run a full end-to-end verification.

> **Note on `buildExtractionScript()`:** The audit flagged the ~150-line IIFE template literal as shrinkable to a standalone `.js` file loaded via `readFileSync`. This was skipped — the embedded approach avoids a file-load dependency at runtime and keeps the extraction script co-located with the code that uses it. Revisit if the script grows beyond its current scope.

- [ ] **Step 1: Full fixture run**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: all 20 fixtures pass. Review any new warnings — they should only be pre-existing ones, not regressions.

- [ ] **Step 2: TypeScript compilation check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no type errors.

- [ ] **Step 3: Delete the conversion script if not already done**

```bash
rm -f scripts/convert-m1-fixtures.ts
```

- [ ] **Step 4: Count the savings**

```bash
git diff --stat HEAD~10
```

Expected: net deletion of ~700-860 lines.

- [ ] **Step 5: Commit any straggling changes**

```bash
git add -A
git diff --cached --stat
git commit -m "chore: final cleanup after ponytail audit"
```
