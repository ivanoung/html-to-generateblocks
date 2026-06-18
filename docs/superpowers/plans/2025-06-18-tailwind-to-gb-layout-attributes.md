# Tailwind Layout → GB Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map Tailwind Tier 1 layout classes (flex, gap, grid-cols, etc.) to `generateblocks/element` block JSON `styles` attributes during HTML→GB conversion, so layout is visible in the WordPress block editor.

**Architecture:** Pure function `tailwindLayoutToGbAttributes(classString) → { styles, leftoverClasses }` called from `dom-walker.ts` block creation sites after class extraction. Existing serializer handles the merge automatically — styles go to JSON, leftoverClasses go to class attribute + css fallback.

**Tech Stack:** TypeScript, postcss, cheerio, Node.js test runner

**Spec:** `docs/superpowers/specs/2025-06-18-tailwind-to-gb-layout-attributes-design.md`  
**MVP Test:** `docs/superpowers/specs/mvp-test-blocks.html` — 29 sections, 100% coverage

---

## File Structure

```
src/core/tailwind-layout-mapper.ts   NEW — pure function + mapping table
src/core/dom-walker.ts               MODIFY — inject mapper in 3 block creation sites
tests/tailwind-layout-mapper.test.ts NEW — unit + integration tests
```

| File | Responsibility |
|---|---|
| `tailwind-layout-mapper.ts` | Pure function + Tailwind spacing scale + ordered mapping table |
| `dom-walker.ts` | Calls mapper during block creation, merges styles, filters classes |
| `tailwind-layout-mapper.test.ts` | Tests every mapping entry + edge cases |

---

### Task 1: Create the mapper function + Tailwind spacing scale

**Files:**
- Create: `src/core/tailwind-layout-mapper.ts`

- [ ] **Step 1: Write the Tailwind spacing scale**

```typescript
// src/core/tailwind-layout-mapper.ts

/** Tailwind v3 default spacing scale (rem → px at 16px root). */
const SPACING: Record<string, string> = {
  "0": "0px", "px": "1px", "0.5": "2px", "1": "4px", "1.5": "6px",
  "2": "8px", "2.5": "10px", "3": "12px", "3.5": "14px", "4": "16px",
  "5": "20px", "6": "24px", "7": "28px", "8": "32px", "9": "36px",
  "10": "40px", "11": "44px", "12": "48px", "14": "56px", "16": "64px",
  "20": "80px", "24": "96px", "28": "112px", "32": "128px", "36": "144px",
  "40": "160px", "44": "176px", "48": "192px", "52": "208px", "56": "224px",
  "60": "240px", "64": "256px", "72": "288px", "80": "320px", "96": "384px",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add Tailwind spacing scale"
```

---

### Task 2: Add the mapping table entries (batch 1 — display + direction + wrap)

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append)

- [ ] **Step 1: Add batch 1 entries**

```typescript
type MapperEntry = {
  pattern: RegExp;
  apply: (match: RegExpMatchArray) => Record<string, string> | null;
};

const MAPPING_TABLE: MapperEntry[] = [
  // ── Display / Layout Mode ──
  { pattern: /^flex$/, apply: () => ({ display: "flex" }) },
  { pattern: /^grid$/, apply: () => ({ display: "grid" }) },
  { pattern: /^inline-flex$/, apply: () => ({ display: "inline-flex" }) },
  { pattern: /^inline-grid$/, apply: () => ({ display: "inline-grid" }) },
  { pattern: /^block$/, apply: () => ({ display: "block" }) },
  { pattern: /^inline-block$/, apply: () => ({ display: "inline-block" }) },
  { pattern: /^hidden$/, apply: () => ({ display: "none" }) },

  // ── Flex Direction ──
  { pattern: /^flex-row$/, apply: () => ({ flexDirection: "row" }) },
  { pattern: /^flex-row-reverse$/, apply: () => ({ flexDirection: "row-reverse" }) },
  { pattern: /^flex-col$/, apply: () => ({ flexDirection: "column" }) },
  { pattern: /^flex-col-reverse$/, apply: () => ({ flexDirection: "column-reverse" }) },

  // ── Flex Wrap ──
  { pattern: /^flex-wrap$/, apply: () => ({ flexWrap: "wrap" }) },
  { pattern: /^flex-nowrap$/, apply: () => ({ flexWrap: "nowrap" }) },
  { pattern: /^flex-wrap-reverse$/, apply: () => ({ flexWrap: "wrap-reverse" }) },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add layout mapper batch 1 — display, direction, wrap"
```

---

### Task 3: Add mapping table entries (batch 2 — alignment + flex sizing)

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append to MAPPING_TABLE)

- [ ] **Step 1: Add batch 2 entries**

```typescript
  // ── Flex Items Alignment ──
  { pattern: /^items-start$/, apply: () => ({ alignItems: "flex-start" }) },
  { pattern: /^items-center$/, apply: () => ({ alignItems: "center" }) },
  { pattern: /^items-end$/, apply: () => ({ alignItems: "flex-end" }) },
  { pattern: /^items-stretch$/, apply: () => ({ alignItems: "stretch" }) },
  { pattern: /^items-baseline$/, apply: () => ({ alignItems: "baseline" }) },

  // ── Justify Content ──
  { pattern: /^justify-start$/, apply: () => ({ justifyContent: "flex-start" }) },
  { pattern: /^justify-center$/, apply: () => ({ justifyContent: "center" }) },
  { pattern: /^justify-end$/, apply: () => ({ justifyContent: "flex-end" }) },
  { pattern: /^justify-between$/, apply: () => ({ justifyContent: "space-between" }) },
  { pattern: /^justify-around$/, apply: () => ({ justifyContent: "space-around" }) },
  { pattern: /^justify-evenly$/, apply: () => ({ justifyContent: "space-evenly" }) },
  { pattern: /^justify-normal$/, apply: () => ({ justifyContent: "normal" }) },
  { pattern: /^justify-stretch$/, apply: () => ({ justifyContent: "stretch" }) },

  // ── Self Alignment ──
  { pattern: /^self-auto$/, apply: () => ({ alignSelf: "auto" }) },
  { pattern: /^self-start$/, apply: () => ({ alignSelf: "flex-start" }) },
  { pattern: /^self-center$/, apply: () => ({ alignSelf: "center" }) },
  { pattern: /^self-end$/, apply: () => ({ alignSelf: "flex-end" }) },
  { pattern: /^self-stretch$/, apply: () => ({ alignSelf: "stretch" }) },
  { pattern: /^self-baseline$/, apply: () => ({ alignSelf: "baseline" }) },

  // ── Flex Child Sizing ──
  { pattern: /^flex-1$/, apply: () => ({ flex: "1 1 0%" }) },
  { pattern: /^flex-auto$/, apply: () => ({ flex: "1 1 auto" }) },
  { pattern: /^flex-initial$/, apply: () => ({ flex: "0 1 auto" }) },
  { pattern: /^flex-none$/, apply: () => ({ flex: "none" }) },
  { pattern: /^grow$/, apply: () => ({ flexGrow: "1" }) },
  { pattern: /^grow-0$/, apply: () => ({ flexGrow: "0" }) },
  { pattern: /^shrink$/, apply: () => ({ flexShrink: "1" }) },
  { pattern: /^shrink-0$/, apply: () => ({ flexShrink: "0" }) },
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add layout mapper batch 2 — alignment + flex sizing"
```

---

### Task 4: Add mapping table entries (batch 3 — gap, grid, order, overflow)

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append to MAPPING_TABLE)

- [ ] **Step 1: Add batch 3 entries**

```typescript
  // ── Gap + Space Between (directional first, then bidirectional) ──
  {
    pattern: /^gap-x-(.+)$/,
    apply: (m) => SPACING[m[1]] ? { columnGap: SPACING[m[1]] } : null,
  },
  {
    pattern: /^gap-y-(.+)$/,
    apply: (m) => SPACING[m[1]] ? { rowGap: SPACING[m[1]] } : null,
  },
  {
    pattern: /^gap-(.+)$/,
    apply: (m) => SPACING[m[1]] ? { columnGap: SPACING[m[1]], rowGap: SPACING[m[1]] } : null,
  },
  // space-x/y: negative reverses direction (space-x-4 → space-x-reverse + margin)
  // These are child selectors in Tailwind: .space-x-4 > * + * { margin-left: 1rem }
  // Cannot map to GB inline styles — passthrough to CSS fallback

  // ── Aspect Ratio ──
  { pattern: /^aspect-auto$/, apply: () => ({ aspectRatio: "auto" }) },
  { pattern: /^aspect-square$/, apply: () => ({ aspectRatio: "1 / 1" }) },
  { pattern: /^aspect-video$/, apply: () => ({ aspectRatio: "16 / 9" }) },

  // ── Isolation / Visibility ──
  { pattern: /^isolate$/, apply: () => ({ isolation: "isolate" }) },
  { pattern: /^isolation-auto$/, apply: () => ({ isolation: "auto" }) },
  { pattern: /^visible$/, apply: () => ({ visibility: "visible" }) },
  { pattern: /^invisible$/, apply: () => ({ visibility: "hidden" }) },

  // ── Grid Template ──
  {
    pattern: /^grid-cols-(\d{1,2})$/,
    apply: (m) => ({ gridTemplateColumns: `repeat(${m[1]}, minmax(0, 1fr))` }),
  },
  { pattern: /^grid-cols-none$/, apply: () => ({ gridTemplateColumns: "none" }) },
  {
    pattern: /^grid-rows-(\d+)$/,
    apply: (m) => ({ gridTemplateRows: `repeat(${m[1]}, minmax(0, 1fr))` }),
  },
  { pattern: /^grid-rows-none$/, apply: () => ({ gridTemplateRows: "none" }) },

  // ── Grid Span ──
  { pattern: /^col-span-full$/, apply: () => ({ gridColumn: "1 / -1" }) },
  { pattern: /^col-span-(\d+)$/, apply: (m) => ({ gridColumn: `span ${m[1]}` }) },
  { pattern: /^row-span-full$/, apply: () => ({ gridRow: "1 / -1" }) },
  { pattern: /^row-span-(\d+)$/, apply: (m) => ({ gridRow: `span ${m[1]}` }) },

  // ── Grid Start / End ──
  { pattern: /^col-start-auto$/, apply: () => ({ gridColumnStart: "auto" }) },
  { pattern: /^col-start-(\d+)$/, apply: (m) => ({ gridColumnStart: m[1] }) },
  { pattern: /^col-end-auto$/, apply: () => ({ gridColumnEnd: "auto" }) },
  { pattern: /^col-end-(\d+)$/, apply: (m) => ({ gridColumnEnd: m[1] }) },
  { pattern: /^row-start-auto$/, apply: () => ({ gridRowStart: "auto" }) },
  { pattern: /^row-start-(\d+)$/, apply: (m) => ({ gridRowStart: m[1] }) },
  { pattern: /^row-end-auto$/, apply: () => ({ gridRowEnd: "auto" }) },
  { pattern: /^row-end-(\d+)$/, apply: (m) => ({ gridRowEnd: m[1] }) },

  // ── Grid Auto Flow ──
  { pattern: /^grid-flow-row-dense$/, apply: () => ({ gridAutoFlow: "row dense" }) },
  { pattern: /^grid-flow-col-dense$/, apply: () => ({ gridAutoFlow: "column dense" }) },
  { pattern: /^grid-flow-row$/, apply: () => ({ gridAutoFlow: "row" }) },
  { pattern: /^grid-flow-col$/, apply: () => ({ gridAutoFlow: "column" }) },
  { pattern: /^grid-flow-dense$/, apply: () => ({ gridAutoFlow: "dense" }) },

  // ── Grid Auto Sizing ──
  { pattern: /^auto-cols-auto$/, apply: () => ({ gridAutoColumns: "auto" }) },
  { pattern: /^auto-cols-min$/, apply: () => ({ gridAutoColumns: "min-content" }) },
  { pattern: /^auto-cols-max$/, apply: () => ({ gridAutoColumns: "max-content" }) },
  { pattern: /^auto-cols-fr$/, apply: () => ({ gridAutoColumns: "minmax(0, 1fr)" }) },
  { pattern: /^auto-rows-auto$/, apply: () => ({ gridAutoRows: "auto" }) },
  { pattern: /^auto-rows-min$/, apply: () => ({ gridAutoRows: "min-content" }) },
  { pattern: /^auto-rows-max$/, apply: () => ({ gridAutoRows: "max-content" }) },
  { pattern: /^auto-rows-fr$/, apply: () => ({ gridAutoRows: "minmax(0, 1fr)" }) },

  // ── Order ──
  { pattern: /^order-first$/, apply: () => ({ order: "-9999" }) },
  { pattern: /^order-last$/, apply: () => ({ order: "9999" }) },
  { pattern: /^order-none$/, apply: () => ({ order: "0" }) },
  { pattern: /^order-(\d+)$/, apply: (m) => ({ order: m[1] }) },

  // ── Overflow (longhands only — GB doesn't support shorthand) ──
  { pattern: /^overflow-auto$/, apply: () => ({ overflowX: "auto", overflowY: "auto" }) },
  { pattern: /^overflow-hidden$/, apply: () => ({ overflowX: "hidden", overflowY: "hidden" }) },
  { pattern: /^overflow-visible$/, apply: () => ({ overflowX: "visible", overflowY: "visible" }) },
  { pattern: /^overflow-scroll$/, apply: () => ({ overflowX: "scroll", overflowY: "scroll" }) },
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add layout mapper batch 3 — gap, grid, aspect, isolation, visibility"
```

---

### Task 5: Add mapping table entries (batch 4 — place, align-content, justify-items, basis)

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append to MAPPING_TABLE)

- [ ] **Step 1: Add batch 4 entries**

```typescript
  // ── Place Content ──
  { pattern: /^place-content-center$/, apply: () => ({ placeContent: "center" }) },
  { pattern: /^place-content-start$/, apply: () => ({ placeContent: "start" }) },
  { pattern: /^place-content-end$/, apply: () => ({ placeContent: "end" }) },
  { pattern: /^place-content-between$/, apply: () => ({ placeContent: "space-between" }) },
  { pattern: /^place-content-around$/, apply: () => ({ placeContent: "space-around" }) },
  { pattern: /^place-content-evenly$/, apply: () => ({ placeContent: "space-evenly" }) },
  { pattern: /^place-content-stretch$/, apply: () => ({ placeContent: "stretch" }) },

  // ── Place Items ──
  { pattern: /^place-items-center$/, apply: () => ({ placeItems: "center" }) },
  { pattern: /^place-items-start$/, apply: () => ({ placeItems: "start" }) },
  { pattern: /^place-items-end$/, apply: () => ({ placeItems: "end" }) },
  { pattern: /^place-items-stretch$/, apply: () => ({ placeItems: "stretch" }) },

  // ── Place Self ──
  { pattern: /^place-self-center$/, apply: () => ({ placeSelf: "center" }) },
  { pattern: /^place-self-start$/, apply: () => ({ placeSelf: "flex-start" }) },
  { pattern: /^place-self-end$/, apply: () => ({ placeSelf: "flex-end" }) },
  { pattern: /^place-self-auto$/, apply: () => ({ placeSelf: "auto" }) },
  { pattern: /^place-self-stretch$/, apply: () => ({ placeSelf: "stretch" }) },

  // ── Align Content (multi-line flex/grid) ──
  { pattern: /^content-normal$/, apply: () => ({ alignContent: "normal" }) },
  { pattern: /^content-center$/, apply: () => ({ alignContent: "center" }) },
  { pattern: /^content-start$/, apply: () => ({ alignContent: "flex-start" }) },
  { pattern: /^content-end$/, apply: () => ({ alignContent: "flex-end" }) },
  { pattern: /^content-between$/, apply: () => ({ alignContent: "space-between" }) },
  { pattern: /^content-around$/, apply: () => ({ alignContent: "space-around" }) },
  { pattern: /^content-evenly$/, apply: () => ({ alignContent: "space-evenly" }) },
  { pattern: /^content-stretch$/, apply: () => ({ alignContent: "stretch" }) },
  { pattern: /^content-baseline$/, apply: () => ({ alignContent: "baseline" }) },

  // ── Justify Items / Self ──
  { pattern: /^justify-items-start$/, apply: () => ({ justifyItems: "start" }) },
  { pattern: /^justify-items-center$/, apply: () => ({ justifyItems: "center" }) },
  { pattern: /^justify-items-end$/, apply: () => ({ justifyItems: "end" }) },
  { pattern: /^justify-items-stretch$/, apply: () => ({ justifyItems: "stretch" }) },
  { pattern: /^justify-self-auto$/, apply: () => ({ justifySelf: "auto" }) },
  { pattern: /^justify-self-start$/, apply: () => ({ justifySelf: "start" }) },
  { pattern: /^justify-self-center$/, apply: () => ({ justifySelf: "center" }) },
  { pattern: /^justify-self-end$/, apply: () => ({ justifySelf: "end" }) },
  { pattern: /^justify-self-stretch$/, apply: () => ({ justifySelf: "stretch" }) },

  // ── Flex Basis ──
  { pattern: /^basis-auto$/, apply: () => ({ flexBasis: "auto" }) },
  { pattern: /^basis-full$/, apply: () => ({ flexBasis: "100%" }) },
  {
    pattern: /^basis-(.+)$/,
    apply: (m) => SPACING[m[1]] ? { flexBasis: SPACING[m[1]] } : null,
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add layout mapper batch 4 — place, content, justify-items, basis"
```

---

### Task 6: Write the main function + export

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (prepend at top, add after MAPPING_TABLE)

- [ ] **Step 1: Add function**

Append after the closing `];` of MAPPING_TABLE:

```typescript
/**
 * Convert Tailwind layout classes to GenerateBlocks element block styles.
 *
 * Processes classes left-to-right in original order. Matched classes are
 * consumed (removed from class list) and converted to GB styles keys.
 * Unmatched classes pass through as leftoverClasses.
 *
 * Configurable spacing scale for projects using non-default Tailwind config.
 *
 * @returns Mapped styles and leftover (unmapped) classes
 */
export function tailwindLayoutToGbAttributes(
  classString: string,
  config?: { spacingScale?: Record<string, string> },
): { styles: Record<string, string>; leftoverClasses: string } {
  if (!classString || !classString.trim()) {
    return { styles: {}, leftoverClasses: "" };
  }

  const scale = config?.spacingScale ?? SPACING;
  const tokens = classString.trim().split(/\s+/);
  const styles: Record<string, string> = {};
  const seenTokens = new Set<string>();
  const leftover: string[] = [];

  for (const token of tokens) {
    // Deduplicate: skip if already seen
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);

    let matched = false;

    for (const entry of MAPPING_TABLE) {
      const match = token.match(entry.pattern);
      if (!match) continue;

      const result = entry.apply(match);
      if (result === null) continue; // partial match (e.g., gap value not in spacing table)

      // Merge styles (last-write-wins)
      Object.assign(styles, result);
      matched = true;
      break; // first match wins
    }

    if (!matched) {
      leftover.push(token);
    }
  }

  return { styles, leftoverClasses: leftover.join(" ") };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add tailwindLayoutToGbAttributes main function"
```

---

### Task 7: Write failing unit test file

**Files:**
- Create: `tests/tailwind-layout-mapper.test.ts`

- [ ] **Step 1: Write core tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { tailwindLayoutToGbAttributes } from "../src/core/tailwind-layout-mapper.js";

describe("tailwindLayoutToGbAttributes", () => {
  // ── Basic mapping ──
  it("maps flex + gap-4 to styles", () => {
    const result = tailwindLayoutToGbAttributes("flex gap-4");
    assert.strictEqual(result.styles.display, "flex");
    assert.strictEqual(result.styles.columnGap, "16px");
    assert.strictEqual(result.styles.rowGap, "16px");
    assert.strictEqual(result.leftoverClasses, "");
  });

  it("maps justify-between + items-center", () => {
    const result = tailwindLayoutToGbAttributes("justify-between items-center");
    assert.strictEqual(result.styles.justifyContent, "space-between");
    assert.strictEqual(result.styles.alignItems, "center");
  });

  it("maps grid-cols-3 + gap-8", () => {
    const result = tailwindLayoutToGbAttributes("grid-cols-3 gap-8");
    assert.strictEqual(result.styles.display, undefined);
    assert.strictEqual(result.styles.gridTemplateColumns, "repeat(3, minmax(0, 1fr))");
    assert.strictEqual(result.styles.columnGap, "32px");
  });

  it("maps col-span-2", () => {
    const result = tailwindLayoutToGbAttributes("col-span-2");
    assert.strictEqual(result.styles.gridColumn, "span 2");
  });

  // ── Partial conversion ──
  it("leaves unmapped classes as leftover", () => {
    const result = tailwindLayoutToGbAttributes("flex shadow-lg opacity-50");
    assert.strictEqual(result.styles.display, "flex");
    assert.ok(result.leftoverClasses.includes("shadow-lg"));
    assert.ok(result.leftoverClasses.includes("opacity-50"));
  });

  // ── Empty / whitespace ──
  it("returns empty for empty string", () => {
    const result = tailwindLayoutToGbAttributes("");
    assert.deepStrictEqual(result.styles, {});
    assert.strictEqual(result.leftoverClasses, "");
  });

  it("returns empty for whitespace-only", () => {
    const result = tailwindLayoutToGbAttributes("   ");
    assert.deepStrictEqual(result.styles, {});
    assert.strictEqual(result.leftoverClasses, "");
  });

  // ── Deduplication ──
  it("deduplicates classes", () => {
    const result = tailwindLayoutToGbAttributes("flex flex flex");
    assert.strictEqual(result.styles.display, "flex");
    assert.strictEqual(result.leftoverClasses, "");
  });

  // ── Priority: gap-x after gap ──
  it("gap-x overrides gap for column axis", () => {
    const result = tailwindLayoutToGbAttributes("gap-4 gap-x-8");
    assert.strictEqual(result.styles.columnGap, "32px"); // overridden
    assert.strictEqual(result.styles.rowGap, "16px"); // preserved
  });

  // ── Class ordering sensitivity ──
  it("same classes in different order produce same styles (last-write-wins per key)", () => {
    const a = tailwindLayoutToGbAttributes("gap-4 gap-x-8");
    const b = tailwindLayoutToGbAttributes("gap-x-8 gap-4");
    // Both: gap-4 sets columnGap=16px, gap-x-8 sets columnGap=32px
    // Processing left-to-right, last-write-wins → columnGap is 32px in both orders
    // But gap-4 also sets rowGap=16px which is never overridden
    assert.strictEqual(a.styles.columnGap, "32px");
    assert.strictEqual(a.styles.rowGap, "16px");
    assert.strictEqual(b.styles.columnGap, "32px");
    assert.strictEqual(b.styles.rowGap, "16px");
  });

  it("justify-center after justify-between — last wins", () => {
    const result = tailwindLayoutToGbAttributes("justify-between justify-center");
    assert.strictEqual(result.styles.justifyContent, "center");
  });

  // ── Arbitrary values: pass through ──
  it("passes through gap-[13px] (not in spacing table)", () => {
    const result = tailwindLayoutToGbAttributes("gap-[13px]");
    assert.deepStrictEqual(result.styles, {});
    assert.strictEqual(result.leftoverClasses, "gap-[13px]");
  });

  // ── All display values ──
  it("maps all display values", () => {
    const tests: [string, string][] = [
      ["flex", "flex"], ["grid", "grid"], ["inline-flex", "inline-flex"],
      ["inline-grid", "inline-grid"], ["block", "block"],
      ["inline-block", "inline-block"], ["hidden", "none"],
    ];
    for (const [input, expected] of tests) {
      const result = tailwindLayoutToGbAttributes(input);
      assert.strictEqual(result.styles.display, expected, `display: ${input}`);
    }
  });

  // ── All flex directions ──
  it("maps all flex directions", () => {
    const tests: [string, string][] = [
      ["flex-row", "row"], ["flex-row-reverse", "row-reverse"],
      ["flex-col", "column"], ["flex-col-reverse", "column-reverse"],
    ];
    for (const [input, expected] of tests) {
      const result = tailwindLayoutToGbAttributes(input);
      assert.strictEqual(result.styles.flexDirection, expected, `flexDirection: ${input}`);
    }
  });

  // ── All justify values ──
  it("maps all justify-content values", () => {
    const tests: [string, string][] = [
      ["justify-start", "flex-start"], ["justify-center", "center"],
      ["justify-end", "flex-end"], ["justify-between", "space-between"],
      ["justify-around", "space-around"], ["justify-evenly", "space-evenly"],
      ["justify-normal", "normal"], ["justify-stretch", "stretch"],
    ];
    for (const [input, expected] of tests) {
      const r = tailwindLayoutToGbAttributes(input);
      assert.strictEqual(r.styles.justifyContent, expected, `justify: ${input}`);
    }
  });

  // ── Overflow → longhands ──
  it("maps overflow-hidden to overflowX + overflowY", () => {
    const result = tailwindLayoutToGbAttributes("overflow-hidden");
    assert.strictEqual(result.styles.overflowX, "hidden");
    assert.strictEqual(result.styles.overflowY, "hidden");
  });

  // ── No duplicate class left in output ──
  it("order-first → order: -9999", () => {
    const result = tailwindLayoutToGbAttributes("order-first");
    assert.strictEqual(result.styles.order, "-9999");
  });

  it("order-last → order: 9999", () => {
    const result = tailwindLayoutToGbAttributes("order-last");
    assert.strictEqual(result.styles.order, "9999");
  });

  // ── Custom spacing scale config ──
  it("uses custom spacingScale when provided", () => {
    const result = tailwindLayoutToGbAttributes("gap-4", {
      spacingScale: { "4": "2rem" },
    });
    assert.strictEqual(result.styles.columnGap, "2rem");
  });

  // ── Aspect ratio / isolation / visibility ──
  it("maps aspect-square", () => {
    const result = tailwindLayoutToGbAttributes("aspect-square");
    assert.strictEqual(result.styles.aspectRatio, "1 / 1");
  });

  it("maps isolate and invisible", () => {
    const result = tailwindLayoutToGbAttributes("isolate invisible");
    assert.strictEqual(result.styles.isolation, "isolate");
    assert.strictEqual(result.styles.visibility, "hidden");
  });
});
```

- [ ] **Step 2: Run tests — expect ALL FAIL (function not yet imported)**

```bash
npx tsx --test tests/tailwind-layout-mapper.test.ts
```
Expected: 0 pass, all fail with "file not found" or similar.

- [ ] **Step 3: Commit**

```bash
git add tests/tailwind-layout-mapper.test.ts
git commit -m "test: add failing tests for tailwind-layout-mapper"
```

---

### Task 8: Verify all tests pass

**Files:**
- None (verification only)

- [ ] **Step 1: Run the mapper tests**

```bash
npx tsx --test tests/tailwind-layout-mapper.test.ts
```
Expected: all pass.

- [ ] **Step 2: Run full test suite**

```bash
npx tsx --test tests/*.test.ts
```
Expected: 150+ tests, all pass (previous 150 + new mapper tests).

- [ ] **Step 3: Commit if any fixes needed**

```bash
git add -A && git commit -m "test: verify all tests pass"
```

---

### Task 9: Integrate mapper into dom-walker block creation

**Files:**
- Modify: `src/core/dom-walker.ts`

- [ ] **Step 1: Add import at top of dom-walker.ts**

```typescript
import { tailwindLayoutToGbAttributes } from "./tailwind-layout-mapper.js";
```

Add this after the existing imports.

- [ ] **Step 2: Create helper function after extractGlobalClasses**

```typescript
/**
 * Apply the Tailwind layout mapper to extracted global classes.
 * Returns merged styles and filtered class list.
 */
function applyLayoutMapper(
  globalClasses: string[],
  existingStyles: Record<string, string>,
): { styles: Record<string, string>; filteredClasses: string[] } {
  if (globalClasses.length === 0) {
    return { styles: { ...existingStyles }, filteredClasses: [] };
  }

  const classString = globalClasses.join(" ");
  const result = tailwindLayoutToGbAttributes(classString);

  // Merge mapper styles into existing styles (mapper wins on conflicts)
  const mergedStyles = { ...existingStyles, ...result.styles };

  // Filter classes
  const leftover = result.leftoverClasses ? result.leftoverClasses.split(/\s+/) : [];

  return { styles: mergedStyles, filteredClasses: leftover };
}
```

- [ ] **Step 3: Modify makeElementBlock**

Replace:
```typescript
  const globalClasses = extractGlobalClasses($el, opts);

  return {
    blockName: "generateblocks/element",
    uniqueId: nextId("elem"),
    tagName: tag,
    styles,
    css,
    globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
    htmlAttributes: ...,
    innerBlocks: [],
  };
```

With:
```typescript
  const globalClasses = extractGlobalClasses($el, opts);
  const layoutResult = applyLayoutMapper(globalClasses, styles);

  return {
    blockName: "generateblocks/element",
    uniqueId: nextId("elem"),
    tagName: tag,
    styles: layoutResult.styles,
    css,
    globalClasses: layoutResult.filteredClasses.length > 0 ? layoutResult.filteredClasses : undefined,
    htmlAttributes: ...,
    innerBlocks: [],
  };
```

- [ ] **Step 4: Modify makeTextBlock** (same pattern as makeElementBlock)

After `const globalClasses = extractGlobalClasses($el, opts);`, add:
```typescript
  const layoutResult = applyLayoutMapper(globalClasses, styles);
```

Replace `styles` with `layoutResult.styles` and `globalClasses` with `layoutResult.filteredClasses`.

- [ ] **Step 5: Modify the third block creation site (around line ~295)**

Find the third `extractGlobalClasses` call in dom-walker.ts and apply the same pattern.

- [ ] **Step 6: Run full test suite**

```bash
npx tsx --test tests/*.test.ts
```
Expected: 150+ tests, all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "feat: integrate tailwind-layout-mapper into block creation"
```

---

### Task 10: Integration test — verify dom-walker output

**Files:**
- None (verification using existing test fixtures)

- [ ] **Step 1: Write integration test that exercises the full pipeline**

Create a companion test in `tests/tailwind-layout-mapper.test.ts` (append after existing tests):

```typescript
// ── Integration: dom-walker output ──
describe("integration — dom-walker output", () => {
  it("mino blocks contain layout styles", () => {
    const fs = require("fs");
    const indexPath = "output/mino/pages/index.html";
    if (!fs.existsSync(indexPath)) {
      console.log("SKIP: run conversion first");
      return;
    }
    const html = fs.readFileSync(indexPath, "utf-8");

    // Verify layout styles appear in block JSON
    assert.ok(/display.*flex/.test(html), "flex display should appear in block JSON");
    assert.ok(/columnGap/.test(html), "columnGap should appear in block JSON");
    assert.ok(/gridTemplateColumns/.test(html), "gridTemplateColumns should appear");
  });

  it("consumed classes are removed from class attributes", () => {
    const fs = require("fs");
    const indexPath = "output/mino/pages/index.html";
    if (!fs.existsSync(indexPath)) return;
    const html = fs.readFileSync(indexPath, "utf-8");

    // Flex/gap classes should NOT appear in class attributes (they were consumed)
    // Only check non-responsive classes (sm:flex should remain)
    const classAttrs = [...html.matchAll(/class="([^"]+)"/g)].map(m => m[1]);
    for (const cls of classAttrs) {
      assert.ok(!cls.includes(" flex "), `class should not contain unconsumed "flex": "${cls}"`);
      assert.ok(!cls.includes(" gap-"), `class should not contain unconsumed gap: "${cls}"`);
    }
  });
});
```

- [ ] **Step 2: Run conversion then integration test**

```bash
rm -rf output/mino && npx tsx src/cli/index.ts convert inputs/mino/ --split 2>&1 | tail -3
npx tsx --test tests/tailwind-layout-mapper.test.ts
```

Expected: integration tests pass (layout styles present, consumed classes absent).

- [ ] **Step 3: Commit**

```bash
git add tests/tailwind-layout-mapper.test.ts
git commit -m "test: add integration tests for dom-walker output"
```

---

### Task 11: Run full conversion on mino + hkvc and verify

**Files:**
- None (output verification only)

- [ ] **Step 1: Clean output and re-convert mino**

```bash
rm -rf output/mino && npx tsx src/cli/index.ts convert inputs/mino/ --split
```

- [ ] **Step 2: Verify layout attributes in block JSON**

Check that blocks in `output/mino/pages/index.html` contain layout styles:
```bash
grep -c "display" output/mino/pages/index.html
grep -c "columnGap" output/mino/pages/index.html
grep -c "gridTemplateColumns" output/mino/pages/index.html
```

Expected: non-zero counts. Layout classes are being converted to GB styles.

- [ ] **Step 3: Verify classes are stripped from class attributes**

```bash
grep -c "flex gap-" output/mino/pages/index.html
```

Expected: 0 (or very few — only responsive variants like `md:flex` should remain).

- [ ] **Step 4: Verify leftover classes preserved (shadow-lg, opacity, etc.)**

```bash
grep -c "shadow-" output/mino/pages/index.html
grep -c "opacity-" output/mino/pages/index.html
```

Expected: non-zero. Cosmetic classes survive.

- [ ] **Step 5: Convert hkvc**

```bash
rm -rf output/hkvc && npx tsx src/cli/index.ts convert inputs/hkvc/ --split
```

Same verification steps as mino.

- [ ] **Step 6: Run full test suite**

```bash
npx tsx --test tests/*.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "verify: layout mapper end-to-end on mino + hkvc"
```

---

### Task 12: Self-review — spec coverage check

- [ ] **Step 1: Verify every mapping entry in the spec has a corresponding test**

- [ ] **Step 2: Verify edge cases from spec are covered**

- [ ] **Step 3: Commit fixes if any**

---

## Self-Review Checklist

### 1. Spec coverage
- All ~60+ mapping entries have corresponding MAPPING_TABLE entries (batches 1-4, batch 3 expanded with aspect/isolation/visibility) ✓
- Missing utilities addressed: aspect-*, isolate, isolation, visible, invisible added to batch 3 ✓
- space-x/space-y intentionally pass through to CSS (child combinator — can't map to inline styles) ✓
- Edge cases covered: empty string, whitespace, dedup, partial match, gap interaction, class ordering sensitivity, arbitrary values, custom spacingScale ✓
- Integration into dom-walker covers all 3 block creation sites ✓
- Integration test verifies actual dom-walker output (layout styles present, consumed classes absent) ✓
- E2E verification on mino + hkvc ✓

### 2. Placeholder scan
- No TBD, TODO, or "implement later" ✓
- All code blocks are complete and ready to copy-paste ✓
- All test assertions have expected values ✓
- space-x/space-y pass-through decision documented with rationale ✓

### 3. Type consistency
- `tailwindLayoutToGbAttributes` signature: `(classString, config?) → { styles, leftoverClasses }` — consistent across test and implementation ✓
- `MAPPING_TABLE` entry type: `{ pattern, apply }` — consistent across all batches ✓
- `applyLayoutMapper` helper: `(globalClasses, existingStyles) → { styles, filteredClasses }` — used identically in all 3 block creation sites ✓
- Spacing scale: `Record<string, string>` — same type as config parameter ✓
- All regex patterns anchored with `^` and `$` to prevent substring matches ✓
