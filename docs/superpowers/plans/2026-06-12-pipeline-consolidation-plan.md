# Pipeline Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the Cheerio inline-style round-trip, move `data-gb-path` injection into the Playwright session, and have the DOM walker query computed styles directly — reducing the pipeline from 23 to 20 modules with 3 fewer transformation steps.

**Architecture:** Three surgical changes: (1) remove ~40 lines of Cheerio injection from orchestrator, (2) inject paths via `page.evaluate()` inside `tailwind-inliner.ts`, (3) pass computed styles as a parameter to `walkDom()` for direct block population.

**Tech Stack:** TypeScript, Playwright (existing), Cheerio (existing).

---

## File Structure

```
src/core/
├── orchestrator.ts       # MODIFY: remove Cheerio injector, pass computedStyles to walker
├── tailwind-inliner.ts   # MODIFY: add page.evaluate() for data-gb-path injection
├── tailwind-cleaner.ts   # MODIFY: remove path injection, keep bare-text warnings
├── dom-walker.ts         # MODIFY: accept computedStyles parameter, query when building blocks

tests/
├── dom-walker.test.ts    # NEW or MODIFY: test computedStyles integration
```

---

### Task 1: Move data-gb-path injection into Playwright session

**Files:**
- Modify: `src/core/tailwind-inliner.ts`
- Modify: `src/core/tailwind-cleaner.ts`

- [ ] **Step 1: Inject paths inside the Playwright page**

In `src/core/tailwind-inliner.ts`, inside `compileWithPlaywright()`, add path injection AFTER `page.setContent()` and BEFORE capturing computed styles:

```typescript
// After page.setContent(), add:
// Inject data-gb-path on elements the DOM walker will process
await page.evaluate(() => {
  const WALKER_TAGS = ["section", "div", "header", "footer", "nav", "main", "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "img", "svg"];
  const counters: Record<string, number> = {};
  
  WALKER_TAGS.forEach(tag => {
    document.querySelectorAll(tag).forEach((el: Element) => {
      const id = el.id;
      const classes = el.className;
      let path: string;
      if (id) {
        path = `${tag}#${id}`;
      } else if (typeof classes === "string" && classes.trim()) {
        const firstClass = classes.trim().split(/\s+/)[0];
        const key = `${tag}.${firstClass}`;
        counters[key] = (counters[key] || 0) + 1;
        path = `${tag}.${firstClass}.${counters[key] - 1}`;
      } else {
        counters[tag] = (counters[tag] || 0) + 1;
        path = `${tag}:nth-of-type(${counters[tag]})`;
      }
      (el as HTMLElement).setAttribute("data-gb-path", path);
    });
  });
});
```

- [ ] **Step 2: Remove path injection from tailwind-cleaner**

In `src/core/tailwind-cleaner.ts`, remove the Step 1 code that injects `data-gb-path` attributes. Keep only the bare-text warnings (Step 2) and empty div warnings (Step 3).

Replace the entire function with:

```typescript
export function cleanTailwindSource(rawHtml: string): CleanResult {
  const warnings: string[] = [];
  const $ = cheerio.load(rawHtml, { decodeEntities: false, xmlMode: false });

  // Detect bare text nodes (WARNING only, no DOM change)
  $("*").each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase();
    if (!tag || !BLOCK_TAGS.has(tag)) return;
    const childNodes = (el as any).childNodes || [];
    for (const child of childNodes) {
      if (child.type === "text") {
        const text = ((child as any).data || "").trim();
        if (text.length === 0) continue;
        warnings.push(`Bare text in <${tag}>: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}" — consider wrapping in <p> or <span>`);
      }
    }
  });

  // Detect empty divs (WARNING only, no removal)
  $("div").each((_, el) => {
    const $el = $(el);
    const html = $el.html();
    if (!html || html.trim().length === 0) {
      warnings.push(`Empty <div> detected — consider removing from source`);
    }
  });

  return { html: rawHtml, warnings };  // Return rawHtml unchanged
}
```

Note: the cleaner now returns `rawHtml` unchanged (no path injection, no DOM modification).

- [ ] **Step 3: Verify tests pass**

```bash
npx tsx --test tests/tailwind-cleaner.test.ts
```

Update test expectations to reflect that `cleanTailwindSource` no longer injects `data-gb-path` — it only produces warnings.

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-inliner.ts src/core/tailwind-cleaner.ts tests/tailwind-cleaner.test.ts
git commit -m "refactor: move data-gb-path injection into Playwright session, reduce cleaner to warnings only"
```

---

### Task 2: Remove Cheerio inline-style injector from orchestrator

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Remove the Cheerio injection code**

In `src/core/orchestrator.ts`, remove the entire Cheerio injection block (~40 lines) that:
1. Loads the processed HTML into Cheerio
2. Iterates `[data-gb-path]` elements
3. Applies classified inline styles as `style="..."` attributes
4. Removes `data-gb-path` attributes
5. Extracts body content from Cheerio's full document output

Replace with: simply pass `classifiedInlineStyles` to `walkDom()`.

Before:
```typescript
// Apply classified inline styles as style="..." attributes before DOM walk
let processedHtml = prepResult.html;
if (classifiedInlineStyles && Object.keys(classifiedInlineStyles).length > 0) {
  const $ = cheerio.load(processedHtml, ...);
  // ... ~40 lines of Cheerio manipulation ...
  processedHtml = $.html();
  const bodyMatch = processedHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) processedHtml = bodyMatch[1];
}

// Stage 3: DOM walk
const walkResult = walkDom(
  processedHtml,
  prepResult.classNameToProperties,
  collector,
  input.skipStripNavFooter,
);
```

After:
```typescript
// Stage 3: DOM walk — computed styles passed directly (no HTML round-trip)
const walkResult = walkDom(
  prepResult.html,
  prepResult.classNameToProperties,
  collector,
  input.skipStripNavFooter,
  classifiedInlineStyles,  // NEW: direct lookup table
);
```

Also remove the `import * as cheerio` at the top of orchestrator.ts (no longer needed for injection).

- [ ] **Step 2: Verify existing tests pass**

```bash
npx tsx --test tests/*.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "refactor: remove Cheerio inline-style injector, pass computed styles directly to DOM walker"
```

---

### Task 3: Modify DOM walker to accept computed styles

**Files:**
- Modify: `src/core/dom-walker.ts`

- [ ] **Step 1: Add computedStyles parameter to walkDom**

Update the function signature:

```typescript
export function walkDom(
  html: string,
  classNameToProps: Map<string, Record<string, string>>,
  collector: GlobalStylesCollector,
  skipStripNavFooter?: boolean,
  computedStyles?: Record<string, Record<string, string>>,  // NEW
): WalkResult {
```

- [ ] **Step 2: Query computed styles when building blocks**

In the block-building functions (where `block.styles` is initially set), add a lookup:

```typescript
// In makeElementBlock, makeTextBlock, etc.:
// After setting initial block.styles from the element's inline style attribute:
if (computedStyles) {
  const path = $el.attr("data-gb-path");
  if (path && computedStyles[path]) {
    // Merge computed styles into block.styles
    // Computed styles use camelCase keys matching the GB styles object format
    block.styles = { ...block.styles, ...computedStyles[path] };
  }
}
```

- [ ] **Step 3: Remove data-gb-path from output**

After querying, strip `data-gb-path` from the element's attributes so it doesn't leak into `htmlAttributes`:

```typescript
$el.removeAttr("data-gb-path");
```

- [ ] **Step 4: Verify with existing and new tests**

```bash
npx tsx --test tests/*.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "feat: DOM walker accepts computed styles directly, queries by data-gb-path to populate block.styles"
```

---

### Task 4: Integration test — HKVC conversion

**Files:**
- None (verification only)

- [ ] **Step 1: Convert HKVC and verify**

```bash
rm -rf output/hkvc
npx tsx src/cli/index.ts convert inputs/hkvc/
```

- [ ] **Step 2: Check that blocks have promoted styles**

```bash
echo "Blocks with non-empty styles:"
grep -o '"styles":{[^}]*}' output/hkvc/pages/index.html | grep -v '"styles":{}' | wc -l
echo "Blocks with backgroundColor:"
grep -c '"backgroundColor"' output/hkvc/pages/index.html
```

Expected: similar or better numbers than before consolidation (was 117 blocks with styles, 35 with backgroundColor).

- [ ] **Step 3: Check no data-gb-path leaks**

```bash
grep -c 'data-gb-path' output/hkvc/pages/index.html
```

Expected: 0 (no path attributes in output).

- [ ] **Step 4: Check validator passes**

```bash
cat output/hkvc/pages/index.report.json | grep overallStatus
```

Expected: `"overallStatus": "pass"`

- [ ] **Step 5: Commit verification**

```bash
git add output/hkvc/
git commit -m "verify: HKVC conversion after consolidation — styles preserved, no path leakage"
```

---

### Task 5: Run all tests and finalize

- [ ] **Step 1: Run full test suite**

```bash
npx tsx --test tests/*.test.ts
```
Expected: All tests pass.

- [ ] **Step 2: Commit final changes**

```bash
git add -A
git commit -m "chore: finalize pipeline consolidation — all tests passing"
```
