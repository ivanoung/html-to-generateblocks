# Post-Inliner Refinements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make converter output responsive, structurally clean (outer/inner section pattern), and class-consolidated (Global Styles JSON instead of inline bloat), with hover/focus/group-hover state preservation.

**Architecture:** Enhance the inliner with multi-viewport capture, browser defaults stripping, relative-value reconstruction, class-list capture, and CSSOM state extraction. Add a class consolidator that hashes structural properties into reusable Global Style classes. Add section wrapper logic to the DOM walker.

**Tech Stack:** TypeScript, Playwright (Chromium headless), Cheerio (existing)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/core/tailwind-inliner.ts` | **Rewrite** | Multi-viewport capture, defaults filter, relative-value recon, class capture, style extraction, state extraction |
| `src/core/class-consolidator.ts` | **Create** | Structural hashing, grouping, responsive delta extraction, global-styles.json generation |
| `src/core/dom-walker.ts` | **Modify** | Section wrapper logic (outer/inner container pattern) |
| `src/core/orchestrator.ts` | **Modify** | Wire consolidator between inliner and preprocess |
| `src/cli/index.ts` | **Modify** | Pre-flight check for `<section>` presence |
| `src/core/types.ts` | **Modify** | Add `elementClassList` to pipeline context |

**Deferred:** `metadata` attribute on blocks (not in GB schema — use uniqueId prefix only).

---

### Task 1: Extract browser defaults and class-list capture from inliner

**Files:**
- Refactor: `src/core/tailwind-inliner.ts`

Break the monolithic `inlineTailwindStyles()` into smaller, testable functions. No behavior change yet — just restructuring.

- [ ] **Step 1: Extract the `page.evaluate` logic into a helper, returning structured data**

Replace the single `page.evaluate` callback with a structured return:

```ts
interface ExtractionPayload {
  html: string;
  elementCount: number;
  classListPerElement: Record<string, string>; // data-gb-idx → original className
  styleBlocks: string[];                        // <style> element contents
}

async function extractStyles(page: Page): Promise<ExtractionPayload> {
  return page.evaluate(() => {
    // 1. Assign stable indices
    document.body.querySelectorAll("*").forEach((el, i) => {
      el.setAttribute("data-gb-idx", String(i));
    });

    // 2. Capture class lists BEFORE stripping
    const classListPerElement: Record<string, string> = {};
    document.querySelectorAll("[data-gb-idx]").forEach((el) => {
      const idx = el.getAttribute("data-gb-idx")!;
      classListPerElement[idx] = el.className;
    });

    // 3. Capture <style> block contents BEFORE removing script/link
    const styleBlocks: string[] = [];
    document.querySelectorAll("style").forEach((el) => {
      styleBlocks.push(el.textContent || "");
    });

    // 4. Extract computed styles (existing logic — strip browser internals)
    const allElements = document.body.querySelectorAll("*");
    let count = 0;
    const SKIP_PROPS = /* ... existing filter list ... */;

    for (const el of allElements) {
      if (!(el instanceof HTMLElement)) continue;
      const cs = window.getComputedStyle(el);
      const parts: string[] = [];
      for (let i = 0; i < cs.length; i++) {
        const prop = cs[i];
        if (SKIP_PROPS.has(prop)) continue;
        const value = cs.getPropertyValue(prop);
        if (value) parts.push(`${prop}: ${value}`);
      }
      const cssText = parts.join("; ");
      if (!cssText || cssText.length < 10) continue;
      const existing = el.getAttribute("style") || "";
      el.setAttribute("style", cssText + (existing ? ";" + existing : ""));
      count++;
    }

    // 5. Remove <script> and <link> tags
    document.querySelectorAll("script, link").forEach((el) => el.remove());

    return {
      html: document.documentElement.outerHTML,
      elementCount: count,
      classListPerElement,
      styleBlocks,
    };
  });
}
```

- [ ] **Step 2: Wrap the extraction in the main `inlineTailwindStyles` using the new helper**

```ts
export async function inlineTailwindStyles(rawHtml: string): Promise<InlinerResult> {
  // ... browser setup, page load, CDN wait (unchanged) ...

  const payload = await extractStyles(page);
  const cleanedHtml = stripTailwindClasses(payload.html);
  
  return {
    html: cleanedHtml,
    elementCount: payload.elementCount,
    classListPerElement: payload.classListPerElement,
    styleBlocks: payload.styleBlocks,
    warnings,
  };
}
```

Update `InlinerResult`:

```ts
export interface InlinerResult {
  html: string;
  elementCount: number;
  classListPerElement: Record<string, string>;
  styleBlocks: string[];
  warnings: string[];
}
```

- [ ] **Step 3: Run the Mino conversion to verify no regression**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Expected: same 311 blocks, 0 hard fails, output unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "refactor: extract inliner evaluate logic into structured payload

- Returns classListPerElement (class names before stripping)
- Returns styleBlocks (<style> contents before script removal)
- Uses data-gb-idx for stable element identification"
```

---

### Task 2: Browser defaults filter

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Add a browser defaults filter map**

In the `extractStyles` page.evaluate callback, after building the properties array, filter out properties whose values match browser defaults:

```ts
// Default CSS values per property — strip these
const DEFAULTS = new Map<string, string | string[]>([
  ["display", "inline"],           // default for span/a/etc — kept for block elements
  ["position", "static"],
  ["margin-top", "0px"],
  ["margin-right", "0px"],
  ["margin-bottom", "0px"],
  ["margin-left", "0px"],
  ["padding-top", "0px"],
  ["padding-right", "0px"],
  ["padding-bottom", "0px"],
  ["padding-left", "0px"],
  ["border-top-width", "0px"],
  ["border-right-width", "0px"],
  ["border-bottom-width", "0px"],
  ["border-left-width", "0px"],
  ["border-top-left-radius", "0px"],
  ["border-top-right-radius", "0px"],
  ["border-bottom-right-radius", "0px"],
  ["border-bottom-left-radius", "0px"],
  ["flex-grow", "0"],
  ["flex-shrink", "1"],
  ["flex-basis", "auto"],
  ["flex-wrap", "nowrap"],
  ["order", "0"],
  ["float", "none"],
  ["clear", "none"],
  ["opacity", "1"],
  ["z-index", "auto"],
  ["box-sizing", "content-box"],
  ["overflow-x", "visible"],
  ["overflow-y", "visible"],
  ["visibility", "visible"],
  ["text-decoration", "none solid rgb(51, 65, 85)"],
  ["word-spacing", "0px"],
  ["letter-spacing", "normal"],
  ["text-indent", "0px"],
  ["line-height", "normal"],
  ["column-count", "auto"],
  ["column-gap", "normal"],
  ["column-width", "auto"],
  ["transform", "none"],
  ["transition-delay", "0s"],
  ["transition-duration", "0s"],
  ["transition-property", "all"],
  ["transition-timing-function", "ease"],
]);
```

- [ ] **Step 2: Filter defaults during extraction**

In the properties loop, after getting the value, check against defaults:

```ts
const value = cs.getPropertyValue(prop);
if (!value) continue;

// Strip browser default values
const def = DEFAULTS.get(prop);
if (def !== undefined) {
  if (typeof def === "string" && value === def) continue;
  if (Array.isArray(def) && def.includes(value)) continue;
}

parts.push(`${prop}: ${value}`);
```

- [ ] **Step 3: Run conversion and verify warnings drop**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Expected: warnings drop from ~4159 to significantly fewer. Same blocks, same pass status.

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: strip browser default CSS values from computed styles"
```

---

### Task 3: Multi-viewport capture + responsive diff

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Parse breakpoints from Tailwind config**

Add to `tailwind-inliner.ts`:

```ts
function parseBreakpoints(tailwindConfig: string | null): Record<string, number> {
  if (!tailwindConfig) {
    // Tailwind defaults
    return { sm: 640, md: 768, lg: 1024, xl: 1280 };
  }
  try {
    const obj = JSON.parse(tailwindConfig);
    if (obj?.theme?.screens && typeof obj.theme.screens === "object") {
      return obj.theme.screens as Record<string, number>;
    }
  } catch { /* use defaults */ }
  return { sm: 640, md: 768, lg: 1024, xl: 1280 };
}
```

- [ ] **Step 2: Capture at each breakpoint**

After desktop (1440px) extraction, loop through breakpoints from largest to smallest:

```ts
const breakpoints = parseBreakpoints(configJson);
const viewportData: Array<{ label: string; width: number; styles: Record<string, Record<string, string>> }> = [];

// Desktop already captured at 1440px — this is the base
const desktopStyles = new Map<string, Record<string, string>>();

// For each breakpoint (xl → lg → md → sm → mobile):
for (const [label, width] of Object.entries(breakpoints).sort((a, b) => b[1] - a[1])) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(300);
  
  const bpStyles = await page.evaluate(() => {
    const result: Record<string, Record<string, string>> = {};
    document.querySelectorAll("[data-gb-idx]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const idx = el.getAttribute("data-gb-idx")!;
      const cs = window.getComputedStyle(el);
      const props: Record<string, string> = {};
      for (let i = 0; i < cs.length; i++) {
        const prop = cs[i];
        // Only capture Tailwind-relevant properties (layout, sizing, spacing, typography)
        if (!isRelevantProperty(prop)) continue;
        const val = cs.getPropertyValue(prop);
        if (val) props[prop] = val;
      }
      result[idx] = props;
    });
    return result;
  });
  
  viewportData.push({ label, width, styles: bpStyles });
}
```

- [ ] **Step 3: Diff breakpoint styles against desktop, produce media query overrides**

```ts
function diffResponsive(
  baseStyles: Record<string, Record<string, string>>,
  bpStyles: Record<string, Record<string, string>>,
  breakpoint: { label: string; width: number },
): Record<string, Record<string, string>> {
  const overrides: Record<string, Record<string, string>> = {};
  
  for (const [idx, props] of Object.entries(bpStyles)) {
    const base = baseStyles[idx];
    if (!base) continue;
    
    const diff: Record<string, string> = {};
    for (const [prop, value] of Object.entries(props)) {
      if (base[prop] !== value) {
        diff[prop] = value;
      }
    }
    if (Object.keys(diff).length > 0) {
      overrides[idx] = diff;
    }
  }
  
  return overrides;
}
```

- [ ] **Step 4: Store responsive overrides in the extraction payload**

Add `responsiveOverrides` to `ExtractionPayload`:

```ts
interface ExtractionPayload {
  // ... existing ...
  responsiveOverrides: Array<{
    breakpoint: string;  // "1024", "768", "640", "375"
    maxWidth: number;
    overrides: Record<string, Record<string, string>>; // idx → prop → value
  }>;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: multi-viewport capture with responsive diffing"
```

---

### Task 4: Relative value reconstruction

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Map Tailwind grid-column classes to `repeat()` form**

After extraction, for each element with `grid-template-columns` in its styles:

```ts
function reconstructGridColumns(
  styles: Record<string, string>,
  classList: string,
): Record<string, string> {
  const cols = styles["grid-template-columns"];
  if (!cols) return styles;

  // Check if element had grid-cols-N in original class list
  const match = classList.match(/(?:^|\s)(?:lg:|md:|sm:)?grid-cols-(\d+)(?:\s|$)/);
  if (!match) return styles;

  const count = parseInt(match[1]);
  const values = cols.split(/\s+/).filter(v => v.endsWith("px"));
  
  // If all values are equal (within 1px tolerance), it's likely repeat(N, 1fr)
  if (values.length === count) {
    const first = parseFloat(values[0]);
    const allEqual = values.every(v => Math.abs(parseFloat(v) - first) < 1);
    if (allEqual) {
      styles["grid-template-columns"] = `repeat(${count}, minmax(0, 1fr))`;
    }
  }

  return styles;
}
```

- [ ] **Step 2: Reconstruct viewport units and percentages**

```ts
function reconstructRelativeValues(
  styles: Record<string, string>,
  classList: string,
): Record<string, string> {
  const result = { ...styles };

  // min-height: 100vh / 90vh → vh values
  const vhMatch = classList.match(/min-h-\[(\d+)vh\]|min-h-screen/);
  if (vhMatch) {
    result["min-height"] = vhMatch[1] ? `${vhMatch[1]}vh` : "100vh";
  }

  // w-full → 100%
  if (/\bw-full\b/.test(classList)) {
    result["width"] = "100%";
  }

  // w-1/2, w-1/3, etc. → percentage
  const fracMatch = classList.match(/\bw-(\d+)\/(\d+)\b/);
  if (fracMatch) {
    const pct = (parseInt(fracMatch[1]) / parseInt(fracMatch[2]) * 100);
    result["width"] = `${pct}%`;
  }

  return result;
}
```

- [ ] **Step 3: Apply reconstruction to all extracted styles**

In `extractStyles`, after computing each element's properties:

```ts
// After building the parts array and before setting el.style:
const classList = classListPerElement[idx] || "";
let finalProps = buildPropMap(parts);
finalProps = reconstructGridColumns(finalProps, classList);
finalProps = reconstructRelativeValues(finalProps, classList);
```

- [ ] **Step 4: Run conversion, verify grid columns become `repeat()`**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
grep -o 'gridTemplateColumns":"[^"]*"' output/mino/index.html | sort -u
```

Expected: `repeat(12, minmax(0, 1fr))` instead of `82.6562px 82.6562px...`.

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: reconstruct relative values from original Tailwind classes"
```

---

### Task 5: State style extraction (CSSOM)

**Files:**
- Modify: `src/core/tailwind-inliner.ts`

- [ ] **Step 1: Add CSSOM scan to extract hover/focus/active rules**

Add a new `page.evaluate` call BEFORE the class stripping:

```ts
const stateStyles = await page.evaluate(() => {
  const result: Record<string, Array<{ state: string; props: Record<string, string> }>> = {};

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const sel = rule.selectorText;

        // Detect state type
        let state: string | null = null;
        if (sel.includes(":focus-visible")) state = "&:focus-visible";
        else if (sel.includes(":focus")) state = "&:focus";
        else if (sel.includes(":active")) state = "&:active";
        else if (sel.includes(":hover")) state = "&:hover";
        if (!state) continue;

        // Find matching elements
        const testSel = sel.replace(/:hover|:focus-visible|:focus|:active/g, "");
        const matches = document.querySelectorAll(testSel);
        
        for (const el of matches) {
          const idx = (el as HTMLElement).getAttribute("data-gb-idx");
          if (!idx) continue;

          const props: Record<string, string> = {};
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            props[prop] = rule.style.getPropertyValue(prop);
          }

          if (!result[idx]) result[idx] = [];
          result[idx].push({ state, props });
        }
      }
    } catch { /* cross-origin sheet */ }
  }

  return result;
});
```

- [ ] **Step 2: Add state styles to the extraction payload**

```ts
interface ExtractionPayload {
  // ... existing ...
  stateStyles: Record<string, Array<{ state: string; props: Record<string, string> }>>;
}
```

- [ ] **Step 3: Pass state styles through InlinerResult to the consolidator**

```ts
export interface InlinerResult {
  // ... existing ...
  stateStyles: Record<string, Array<{ state: string; props: Record<string, string> }>>;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-inliner.ts
git commit -m "feat: extract hover/focus/active state styles from CSSOM"
```

---

### Task 6: Class consolidator

**Files:**
- Create: `src/core/class-consolidator.ts`

- [ ] **Step 1: Define the consolidator interface and structural property set**

```ts
// ── Class Consolidator ──────────────────────────────────
//
// Groups elements by structural style fingerprints, generates
// reusable Global Style classes, and replaces inline structural
// styles with globalClasses references.

export interface ConsolidatedOutput {
  /** Modified HTML with globalClasses references replacing inline structural styles */
  html: string;
  /** WordPress Global Styles JSON payload */
  globalStyles: GlobalStyleEntry[];
  /** Remaining inline decorative styles per element */
  decorativeStyles: Record<string, Record<string, string>>;
}

export interface GlobalStyleEntry {
  selector: string;
  name: string;
  css: string;
  data: Record<string, unknown>;
}

const STRUCTURAL_PROPS = new Set([
  "display", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink",
  "flex-basis", "justify-content", "align-items", "align-content",
  "align-self", "gap", "column-gap", "row-gap", "grid-template-columns",
  "grid-template-rows", "grid-column", "grid-row", "grid-auto-columns",
  "grid-auto-rows", "grid-auto-flow", "padding-top", "padding-right",
  "padding-bottom", "padding-left", "margin-top", "margin-right",
  "margin-bottom", "margin-left", "border-top-width", "border-right-width",
  "border-bottom-width", "border-left-width", "border-top-left-radius",
  "border-top-right-radius", "border-bottom-right-radius",
  "border-bottom-left-radius", "border-style", "border-color",
  "position", "overflow-x", "overflow-y", "z-index", "order",
  "max-width", "max-height", "min-width", "min-height",
]);
```

- [ ] **Step 2: Implement the consolidation logic**

```ts
import { createHash } from "node:crypto";

function hashProps(props: Record<string, string>): string {
  const sorted = Object.keys(props).sort().map(k => `${k}:${props[k]}`);
  return createHash("sha256").update(sorted.join(";")).digest("hex").substring(0, 8);
}

export function consolidateStyles(
  html: string,
  classListPerElement: Record<string, string>,
  responsiveOverrides: Array<{
    breakpoint: string;
    maxWidth: number;
    overrides: Record<string, Record<string, string>>;
  }>,
  stateStyles: Record<string, Array<{ state: string; props: Record<string, string> }>>,
): ConsolidatedOutput {
  // 1. Parse HTML, extract inline styles per element
  // 2. Split each element's styles into structural vs decorative
  // 3. Hash structural subset → group into classes
  // 4. For each class, collect responsive overrides + state styles from members
  // 5. Generate global-styles.json entries
  // 6. Rewrite HTML: replace inline structural styles with class="gb-s-{hash}"
  // 7. Keep decorative styles inline

  // ... implementation ...
}
```

- [ ] **Step 3: Generate global-styles.json entries with responsive + state blocks**

```ts
function buildClassEntry(
  hash: string,
  structuralProps: Record<string, string>,
  responsiveOverridesForClass: Record<string, Record<string, string>>,
  stateStylesForClass: Record<string, Record<string, string>>,
): GlobalStyleEntry {
  const cssParts: string[] = [];
  const data: Record<string, unknown> = {};

  // Base styles
  const baseEntries = Object.entries(structuralProps).sort(([a], [b]) => a.localeCompare(b));
  const baseCss = baseEntries.map(([k, v]) => `${k}:${v}`).join(";");
  cssParts.push(`.gb-s-${hash}{${baseCss}}`);
  Object.assign(data, Object.fromEntries(baseEntries));

  // Responsive overrides (max-width breakpoints)
  for (const [bp, props] of Object.entries(responsiveOverridesForClass)) {
    const bpCss = Object.entries(props).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`).join(";");
    cssParts.push(`@media(max-width:${bp}px){.gb-s-${hash}{${bpCss}}}`);
    data[`@media (max-width: ${bp}px)`] = props;
  }

  // State styles
  for (const [state, props] of Object.entries(stateStylesForClass)) {
    const stateCss = Object.entries(props).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`).join(";");
    cssParts.push(`.gb-s-${hash}${state.replace("&", "")}{${stateCss}}`);
    data[state] = props;
  }

  return {
    selector: `.gb-s-${hash}`,
    name: `Generated ${hash}`,
    css: cssParts.join(""),
    data,
  };
}
```

- [ ] **Step 4: Write a unit test with a minimal fixture**

Create `fixtures/consolidator-basic.json` with a simple HTML + class list + responsive overrides. Verify the output has the correct `global-styles.json` structure.

- [ ] **Step 5: Commit**

```bash
git add src/core/class-consolidator.ts fixtures/consolidator-basic.json
git commit -m "feat: class consolidator with structural hashing and global-styles.json"
```

---

### Task 7: Section wrapper in DOM walker

**Files:**
- Modify: `src/core/dom-walker.ts`

- [ ] **Step 1: Add section detection and wrapper creation**

In the walker, when encountering a `<section>` tag:

```ts
function makeSectionWrapper(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  opts: WalkerOptions,
): Block[] {
  const styleAttr = $el.attr("style") || "";
  const { styles: allStyles, css: allCss } = parseStyleString(styleAttr);

  // Split: background-* → outer, rest → inner
  const outerStyles: Record<string, string> = {};
  const outerCssProps: string[] = [];
  const innerStyles: Record<string, string> = {};
  const innerCssProps: string[] = [];

  for (const [prop, value] of Object.entries(allStyles)) {
    if (prop.startsWith("background") || prop === "background") {
      outerStyles[prop] = value;
    } else {
      innerStyles[prop] = value;
    }
  }

  // Parse css string similarly
  const cssProps = allCss.split(";").filter(Boolean);
  for (const decl of cssProps) {
    const [prop] = decl.split(":");
    if (prop && (prop.trim().startsWith("background"))) {
      outerCssProps.push(decl);
    } else {
      innerCssProps.push(decl);
    }
  }

  // Inner always gets max-width: var(--gb-container-width) + auto margins
  innerStyles["max-width"] = "var(--gb-container-width)";
  innerStyles["margin-left"] = "auto";
  innerStyles["margin-right"] = "auto";

  const outerId = nextId("outer");
  const innerId = nextId("inner");

  const outer: Block = {
    blockName: "generateblocks/element",
    uniqueId: outerId,
    tagName: "section",
    styles: outerStyles,
    css: outerCssProps.join(";") + (outerCssProps.length > 0 ? ";" : ""),
    globalClasses: undefined,
    htmlAttributes: extractHtmlAttributes($el),
    innerBlocks: [],
  };

  const inner: Block = {
    blockName: "generateblocks/element",
    uniqueId: innerId,
    tagName: "div",
    styles: innerStyles,
    css: formatInnerCss(innerId, innerCssProps.join(";") + (innerCssProps.length > 0 ? ";" : "")),
    globalClasses: extractGlobalClasses($el, opts),
    htmlAttributes: undefined,
    innerBlocks: [],
  };

  outer.innerBlocks = [inner];
  return [outer];
}
```

- [ ] **Step 2: Wire section detection into the main walk loop**

In `walkElement`, before the normal element block creation:

```ts
const tag = ($el.prop("tagName") || "").toLowerCase();
if (tag === "section") {
  const wrapper = makeSectionWrapper($el, $, opts);
  // Walk children and add to inner block
  // ... proceed with child recursion ...
  return wrapper;
}
```

- [ ] **Step 3: Run conversion, verify outer/inner structure**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
grep -c 'uniqueId":"outer' output/mino/index.html
grep -c 'uniqueId":"inner' output/mino/index.html
```

Expected: equal counts of outer/inner pairs, matching the 10 `<section>` tags.

- [ ] **Step 4: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "feat: section wrapper — outer/inner container pattern"
```

---

### Task 8: Orchestrator integration

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Wire consolidator between inliner and preprocess**

In `convert()`, after the inliner call:

```ts
if (usesTailwind(rawHtml)) {
  const inlined = await inlineTailwindStyles(rawHtml);
  if (inlined.elementCount > 0) {
    rawHtml = inlined.html;
    
    // Consolidate structural styles into global classes
    const consolidated = consolidateStyles(
      rawHtml,
      inlined.classListPerElement,
      inlined.responsiveOverrides || [],
      inlined.stateStyles || {},
    );
    rawHtml = consolidated.html;
    
    // Store global styles for output
    consolidatedGlobalStyles = consolidated.globalStyles;
  }
}
```

- [ ] **Step 2: Write global-styles.json output file**

```ts
if (consolidatedGlobalStyles && consolidatedGlobalStyles.length > 0) {
  writeFileSync(
    resolve(outDir, "global-styles.json"),
    JSON.stringify(consolidatedGlobalStyles, null, 2) + "\n",
    "utf-8",
  );
}
```

- [ ] **Step 3: Update report to reflect consolidation**

```ts
const report = {
  // ... existing ...
  globalClassesConsolidated: consolidatedGlobalStyles?.length || 0,
};
```

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: wire class consolidator into orchestrator pipeline"
```

---

### Task 9: Pre-flight check in CLI

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add section tag scanner**

In the `convert` command handler, before calling `convert()`:

```ts
const sectionCount = (rawHtml.match(/<section[\s>]/g) || []).length;
if (sectionCount === 0) {
  console.log("\n⚠ Pre-flight: No <section> tags found in the HTML.");
  console.log("  Each content block should be wrapped in a <section> for proper");
  console.log("  Outer/Content container structure.");
  console.log("  Add <section> wrappers and re-run for optimal output.\n");
}
```

- [ ] **Step 2: Run conversion on Mino page, verify warning**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Expected: No warning — Mino has 10 `<section>` tags.

- [ ] **Step 3: Test with a section-less fixture, verify warning fires**

Create a temp HTML with no sections and run `convert`. Verify the warning appears.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: pre-flight check warning if input has no <section> tags"
```

---

### Task 10: End-to-end Mino page verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full pipeline**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

- [ ] **Step 2: Verify structural output**

```bash
# Sections wrapped
grep -c '"uniqueId":"outer' output/mino/index.html
# Should match section count (10)

# No browser defaults in output
grep -c '"flexGrow":"0"' output/mino/index.html
# Should be 0 (defaults stripped)

# Relative values reconstructed
grep -o 'repeat(12, minmax(0, 1fr))' output/mino/index.html | head -1
# Should find the grid column declaration

# No Tailwind classes
grep -oP 'globalClasses":\[[^\]]*\]' output/mino/index.html | grep -c 'pt-32\|text-5xl\|flex\|grid-cols'
# Should be 0

# global-styles.json exists
test -f output/mino/global-styles.json && echo "EXISTS" || echo "MISSING"
```

- [ ] **Step 3: Verify global-styles.json contents**

```bash
node -e "
const gs = require('./output/mino/global-styles.json');
console.log('Total classes:', gs.length);
console.log('Has state styles:', gs.some(c => c.data['&:hover'] || c.data['&:focus']));
console.log('Has responsive:', gs.some(c => c.data['@media (max-width: 1023px)']));
console.log('Has original names:', JSON.stringify(gs.filter(c => !c.selector.startsWith('.gb-s-')).map(c=>c.selector)));
"
```

Expected: multiple classes, state styles present, responsive overrides present, original CSS class names (`.blueprint-bg`, `.clip-hex`, `.hover-shadow-md`) preserved.

- [ ] **Step 4: Verify report**

```bash
node -e "
const r = require('./output/mino/index.report.json');
console.log('Status:', r.overallStatus);
console.log('Hard fails:', r.hardFails.length);
console.log('globalClassesConsolidated:', r.globalClassesConsolidated);
console.log('customCssRequired:', r.customCssRequired);
"
```

Expected: status `pass`, 0 hard fails, consolidated classes > 0.

- [ ] **Step 5: Commit with final verification results**

```bash
git add -A
git commit -m "verify: end-to-end Mino page with all refinements applied"
```
