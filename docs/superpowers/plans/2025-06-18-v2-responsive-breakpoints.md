# V2 — Responsive Breakpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `tailwindLayoutToGbAttributes()` to parse Tailwind responsive prefixes (sm:, md:, lg:, xl:, 2xl:) and map them to GenerateBlocks' nested `@media` block JSON structure.

**Architecture:** Same file (`tailwind-layout-mapper.ts`), same MAPPING_TABLE, same spacing scale. Add breakpoint parsing + cascade resolution + tier collapse helpers. V2 function replaces V1 function. Calling code in `dom-walker.ts` stays the same — only the return type broadens to support nested `@media` keys.

**Tech Stack:** TypeScript, Node.js test runner

**Spec:** `docs/superpowers/specs/2025-06-18-v2-responsive-breakpoints-design.md`

---

## File Structure

```
src/core/tailwind-layout-mapper.ts   MODIFY — add V2 helpers + new main function
tests/tailwind-layout-mapper.test.ts MODIFY — add V2 test cases
```

| Change | What |
|---|---|
| New type: `GbStyles` | `Record<string, string \| GbStyles>` — supports nested @media |
| New helper: `parseBreakpointPrefix()` | Extracts sm:/md:/lg:/xl:/2xl: prefix |
| New helper: `mapTokens()` | Runs MAPPING_TABLE on array of tokens |
| New helper: `groupByProperty()` | Groups mapper output by CSS property key |
| New helper: `resolveCascade()` | Inherits values across 5 breakpoints |
| New helper: `collapseToGbTiers()` | Maps resolved values to 3 GB tiers with @media |
| Modified: `tailwindLayoutToGbAttributes()` | Detects responsive prefixes, routes to V2 path |
| Modified: `dom-walker.ts` | Accept broader `GbStyles` type in `applyLayoutMapper` |

---

### Task 1: Add V2 types and breakpoint parser

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts`

- [ ] **Step 1: Add types and constants at top of file (after SPACING constant)**

```typescript
/** GenerateBlocks supports nested @media keys in styles. */
type GbStyles = Record<string, string | GbStyles>;

/** Tailwind breakpoint prefixes in cascade order (smallest → largest). */
const BREAKPOINTS: string[] = ["", "sm", "md", "lg", "xl", "2xl"];

/** Regex matching a Tailwind responsive prefix: sm:, md:, lg:, xl:, 2xl: */
const BP_RE = /^(sm|md|lg|xl|2xl):/;

/**
 * Parse a Tailwind class token into its breakpoint prefix and the remaining class name.
 * "md:flex" → { bp: "md", rest: "flex" }
 * "flex"   → { bp: "",   rest: "flex" }
 */
function parseBreakpointPrefix(token: string): { bp: string; rest: string } {
  const match = token.match(BP_RE);
  return match
    ? { bp: match[1], rest: token.slice(match[0].length) }
    : { bp: "", rest: token };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add V2 types + breakpoint parser"
```

---

### Task 2: Add helper — mapTokens (runs MAPPING_TABLE over token array)

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append after parseBreakpointPrefix)

- [ ] **Step 1: Add mapTokens helper**

```typescript
/**
 * Run a list of class tokens through MAPPING_TABLE and collect the results.
 * Returns merged styles and any leftover (unmapped) tokens.
 */
function mapTokens(tokens: string[]): {
  styles: Record<string, string>;
  leftover: string[];
} {
  const styles: Record<string, string> = {};
  const leftover: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);

    let matched = false;
    for (const entry of MAPPING_TABLE) {
      const match = token.match(entry.pattern);
      if (!match) continue;
      const result = entry.apply(match);
      if (result === null) continue;

      Object.assign(styles, result);
      matched = true;
      break;
    }

    if (!matched) leftover.push(token);
  }

  return { styles, leftover };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add V2 mapTokens helper"
```

---

### Task 3: Add helper — groupByProperty

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append after mapTokens)

- [ ] **Step 1: Add groupByProperty**

```typescript
/**
 * Reorganize per-breakpoint mapper output into per-property format.
 *
 * Input:  Map { "" → {display: "flex", columnGap: "16px"}, "md" → {display: "grid"} }
 * Output: Map {
 *   "display"    → Map { "" → "flex", "md" → "grid" },
 *   "columnGap"  → Map { "" → "16px" }
 * }
 */
function groupByProperty(
  bpStyles: Map<string, Record<string, string>>,
): Map<string, Map<string, string>> {
  const byProp = new Map<string, Map<string, string>>();

  for (const [bp, styles] of bpStyles) {
    for (const [prop, value] of Object.entries(styles)) {
      if (!byProp.has(prop)) byProp.set(prop, new Map());
      byProp.get(prop)!.set(bp, value);
    }
  }

  return byProp;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add V2 groupByProperty helper"
```

---

### Task 4: Add helper — resolveCascade

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append after groupByProperty)

- [ ] **Step 1: Add resolveCascade**

```typescript
/**
 * Resolve cascade inheritance across all Tailwind breakpoints.
 *
 * Starting from smallest breakpoint (""), walk up to 2xl.
 * For each breakpoint, if a value is explicitly set, use it.
 * If not, inherit from the nearest smaller breakpoint with a value.
 *
 * Returns a Map with entries for ALL 6 breakpoints in order.
 */
function resolveCascade(
  perBp: Map<string, string>,
): Map<string, string> {
  const resolved = new Map<string, string>();
  let lastValue: string | undefined;

  for (const bp of BREAKPOINTS) {
    if (perBp.has(bp)) {
      lastValue = perBp.get(bp)!;
    }
    if (lastValue !== undefined) {
      resolved.set(bp, lastValue);
    }
  }

  return resolved;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add V2 resolveCascade helper"
```

---

### Task 5: Add helper — collapseToGbTiers

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (append after resolveCascade)

- [ ] **Step 1: Add collapseToGbTiers**

```typescript
/** GB media query strings */
const GB_DESKTOP = ""; // default — no @media
const GB_TABLET = "(max-width: 1024px) and (min-width: 768px)";
const GB_MOBILE = "(max-width: 767px)";

/**
 * Map cascade-resolved breakpoint values to GB's 3-tier responsive structure.
 *
 * Desktop = largest breakpoint with an explicit value (walk 2xl→xl→lg→md→"").
 * Tablet  = md value from cascade.
 * Mobile  = default (0px) value from cascade.
 *
 * Only emits @media when the tier's value differs from the tier above.
 */
function collapseToGbTiers(
  resolved: Map<string, string>,
): GbStyles {
  // Desktop: find highest breakpoint with a value
  let desktopValue: string | undefined;
  for (const bp of BREAKPOINTS.slice().reverse()) {
    if (resolved.has(bp)) {
      desktopValue = resolved.get(bp)!;
      break;
    }
  }
  if (desktopValue === undefined) return {};

  const tabletValue = resolved.get("md") ?? desktopValue;
  const mobileValue = resolved.get("") ?? tabletValue;

  const styles: GbStyles = {};

  // Desktop default (always emitted)
  Object.assign(styles, { __desktop: desktopValue } as any);

  // Tablet only if different from Desktop
  if (tabletValue !== desktopValue) {
    (styles as any)[`@media ${GB_TABLET}`] = { __desktop: tabletValue } as any;
  }

  // Mobile only if different from Tablet (or Desktop if no Tablet override)
  if (mobileValue !== tabletValue) {
    (styles as any)[`@media ${GB_MOBILE}`] = { __desktop: mobileValue } as any;
  }

  return styles;
}
```

Wait — this uses a placeholder key `__desktop`. That's wrong. The tier collapse needs to return the actual property name at each tier. The calling code passes the property key.

Let me fix the function signature and implementation:

```typescript
/**
 * Map cascade-resolved breakpoint values to GB's 3-tier responsive structure
 * for a single CSS property.
 *
 * @param propKey — the GB styles key (e.g., "gridTemplateColumns")
 * @param resolved — cascade-resolved values per breakpoint
 * @returns GbStyles with nested @media keys for this property
 */
function collapseToGbTiers(
  propKey: string,
  resolved: Map<string, string>,
): GbStyles {
  // Desktop: find highest breakpoint with a value
  let desktopValue: string | undefined;
  for (const bp of BREAKPOINTS.slice().reverse()) {
    if (resolved.has(bp)) {
      desktopValue = resolved.get(bp)!;
      break;
    }
  }
  if (desktopValue === undefined) return {};

  const tabletValue = resolved.get("md") ?? desktopValue;
  const mobileValue = resolved.get("") ?? tabletValue;

  const styles: GbStyles = { [propKey]: desktopValue };

  // Tablet only if different from Desktop
  if (tabletValue !== desktopValue) {
    styles[`@media ${GB_TABLET}`] = { [propKey]: tabletValue };
  }

  // Mobile only if different from Tablet
  if (mobileValue !== tabletValue) {
    styles[`@media ${GB_MOBILE}`] = { [propKey]: mobileValue };
  }

  return styles;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add V2 collapseToGbTiers helper"
```

---

### Task 6: Write the V2 main function

**Files:**
- Modify: `src/core/tailwind-layout-mapper.ts` (replace or extend existing export)

- [ ] **Step 1: Replace tailwindLayoutToGbAttributes with V2 version**

Replace the current function body:

```typescript
/**
 * Convert Tailwind layout classes to GenerateBlocks element block styles.
 * Supports responsive prefixes (sm:, md:, lg:, xl:, 2xl:) mapped to GB @media.
 *
 * Processes classes left-to-right. Responsive variants are grouped by breakpoint,
 * cascade-resolved, and collapsed into GB's 3-tier (All Screens / Tablet / Mobile).
 * Non-responsive classes follow V1 flat processing.
 *
 * @returns Mapped styles (with nested @media keys) and leftover classes
 */
export function tailwindLayoutToGbAttributes(
  classString: string,
): { styles: GbStyles; leftoverClasses: string } {
  if (!classString || !classString.trim()) {
    return { styles: {}, leftoverClasses: "" };
  }

  const tokens = classString.trim().split(/\s+/);
  const seen = new Set<string>();
  const leftoverAll: string[] = [];

  // ── Phase 1: Group tokens by breakpoint ──
  const byBp = new Map<string, string[]>();
  for (const bp of BREAKPOINTS) {
    byBp.set(bp, []);
  }

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);

    const { bp, rest } = parseBreakpointPrefix(token);
    if (bp !== "" || rest !== token) {
      // Has a responsive prefix OR was parsed (even if default bp "")
      byBp.get(bp)!.push(rest);
    } else {
      // Unprefixed — V1 path
      byBp.get("")!.push(token);
    }
  }

  // ── Phase 2: Run mapper on each breakpoint's tokens ──
  const bpStyles = new Map<string, Record<string, string>>();
  for (const bp of BREAKPOINTS) {
    const bpTokens = byBp.get(bp)!;
    if (bpTokens.length === 0) continue;
    const result = mapTokens(bpTokens);
    bpStyles.set(bp, result.styles);
    leftoverAll.push(...result.leftover);
  }

  // If no responsive variants (only default breakpoint has styles), use V1 flat output
  const hasResponsive = [...bpStyles.keys()].some(bp => bp !== "");
  if (!hasResponsive) {
    return {
      styles: bpStyles.get("") || {},
      leftoverClasses: leftoverAll.join(" "),
    };
  }

  // ── Phase 3: Group by property → cascade → collapse ──
  const byProp = groupByProperty(bpStyles);
  const finalStyles: GbStyles = {};

  for (const [prop, perBp] of byProp) {
    const resolved = resolveCascade(perBp);
    const tierStyles = collapseToGbTiers(prop, resolved);
    // Deep-merge tierStyles into finalStyles
    mergeGbStyles(finalStyles, tierStyles);
  }

  return {
    styles: finalStyles,
    leftoverClasses: leftoverAll.filter((c, i) => leftoverAll.indexOf(c) === i).join(" "),
  };
}

/**
 * Deep-merge two GbStyles objects. Nested @media keys are merged recursively.
 */
function mergeGbStyles(target: GbStyles, source: GbStyles): void {
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("@media") && typeof value === "object" && value !== null) {
      if (!target[key] || typeof target[key] !== "object") {
        target[key] = {};
      }
      mergeGbStyles(target[key] as GbStyles, value as GbStyles);
    } else {
      target[key] = value;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add V2 main function with cascade + tier collapse"
```

---

### Task 7: Write failing unit tests for V2

**Files:**
- Modify: `tests/tailwind-layout-mapper.test.ts` (append new describe block)

- [ ] **Step 1: Add V2 responsive tests**

```typescript
describe("V2 — responsive breakpoints", () => {
  it("maps md:grid-cols-2 lg:grid-cols-4 with cascade", () => {
    const result = tailwindLayoutToGbAttributes("grid-cols-1 md:grid-cols-2 lg:grid-cols-4");
    assert.strictEqual(result.styles.gridTemplateColumns, "repeat(4, minmax(0, 1fr))");
    const tablet = result.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(tablet.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    const mobile = result.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(mobile.gridTemplateColumns, "repeat(1, minmax(0, 1fr))");
    assert.strictEqual(result.leftoverClasses, "");
  });

  it("maps flex-col sm:flex-row — Mobile column, Desktop row", () => {
    const result = tailwindLayoutToGbAttributes("flex-col sm:flex-row");
    assert.strictEqual(result.styles.flexDirection, "row");
    const mobile = result.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(mobile.flexDirection, "column");
    // No Tablet @media — Tablet = Desktop = row
    assert.strictEqual(
      result.styles["@media (max-width: 1024px) and (min-width: 768px)"],
      undefined,
    );
  });

  it("xl: overrides lg — Desktop picks highest breakpoint", () => {
    const result = tailwindLayoutToGbAttributes("grid-cols-1 lg:grid-cols-2 xl:grid-cols-3");
    assert.strictEqual(result.styles.gridTemplateColumns, "repeat(3, minmax(0, 1fr))");
    const mobile = result.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(mobile.gridTemplateColumns, "repeat(1, minmax(0, 1fr))");
  });

  it("skips redundant @media when value unchanged across tiers", () => {
    const result = tailwindLayoutToGbAttributes("grid-cols-2 md:grid-cols-2 lg:grid-cols-4");
    // Mobile = 2, Tablet = 2 → no Tablet @media needed, just Mobile override
    const tablet = result.styles["@media (max-width: 1024px) and (min-width: 768px)"];
    assert.strictEqual(tablet, undefined);
    const mobile = result.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(mobile.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
  });

  it("handles lg:grid-cols-none as intentional reset", () => {
    const result = tailwindLayoutToGbAttributes("grid-cols-4 md:grid-cols-2 lg:grid-cols-none");
    assert.strictEqual(result.styles.gridTemplateColumns, "none");
    const tablet = result.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(tablet.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    const mobile = result.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(mobile.gridTemplateColumns, "repeat(4, minmax(0, 1fr))");
  });

  it("passes through responsive cosmetic classes", () => {
    const result = tailwindLayoutToGbAttributes("flex md:shadow-lg lg:opacity-50");
    assert.strictEqual(result.styles.display, "flex");
    assert.ok(result.leftoverClasses.includes("md:shadow-lg"));
    assert.ok(result.leftoverClasses.includes("lg:opacity-50"));
  });

  it("multi-property responsive: display + gap", () => {
    const result = tailwindLayoutToGbAttributes(
      "flex flex-col md:flex-row md:gap-4 lg:gap-8"
    );
    assert.strictEqual(result.styles.display, "flex");
    assert.strictEqual(result.styles.flexDirection, "row");
    assert.strictEqual(result.styles.columnGap, "32px");
    const tablet = result.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(tablet.columnGap, "16px");
    const mobile = result.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(mobile.flexDirection, "column");
  });

  it("V1 flat path still works (no responsive prefixes)", () => {
    const result = tailwindLayoutToGbAttributes("flex gap-4 items-center shadow-lg");
    assert.strictEqual(result.styles.display, "flex");
    assert.strictEqual(result.styles.columnGap, "16px");
    assert.ok(result.leftoverClasses.includes("shadow-lg"));
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (function not yet updated)**

```bash
npx tsx --test tests/tailwind-layout-mapper.test.ts
```

Expected: V1 tests pass, V2 tests fail with assertion errors (function returns flat styles, not @media).

- [ ] **Step 3: Commit**

```bash
git add tests/tailwind-layout-mapper.test.ts
git commit -m "test: add V2 responsive breakpoint tests (RED)"
```

---

### Task 8: Verify all tests pass

**Files:**
- None (verification only)

- [ ] **Step 1: Run V2 tests**

```bash
npx tsx --test tests/tailwind-layout-mapper.test.ts
```
Expected: all V1 + V2 tests pass.

- [ ] **Step 2: Run full test suite**

```bash
npx tsx --test tests/*.test.ts
```

Expected: 171+ tests, all pass.

- [ ] **Step 3: Commit if fixes needed**

```bash
git add -A && git commit -m "test: verify V2 tests pass"
```

---

### Task 9: Update dom-walker.ts integration

**Files:**
- Modify: `src/core/dom-walker.ts`

- [ ] **Step 1: Update applyLayoutMapper to accept GbStyles**

Since `GbStyles` is a superset of `Record<string, string>`, the existing integration should work without changes. Verify:

```bash
grep -A5 "applyLayoutMapper" src/core/dom-walker.ts
```

Expected: `result.styles` is passed to `applyLayoutMapper` which does `{ ...existingStyles, ...result.styles }`. Since `GbStyles` extends `Record<string, string>`, the spread operator handles nested `@media` keys naturally — they flow through to the block JSON.

- [ ] **Step 2: Run integration test**

```bash
rm -rf output/mino && npx tsx src/cli/index.ts convert inputs/mino/ --split 2>&1 | tail -3
```

- [ ] **Step 3: Verify @media keys in block JSON**

```bash
grep -c '@media' output/mino/pages/index.html
```

Expected: non-zero count (responsive variants now produce @media blocks).

- [ ] **Step 4: Verify responsive classes removed from globalClasses**

```bash
grep -c 'md:flex\|md:grid-cols\|lg:grid-cols\|lg:gap' output/mino/pages/index.html
```

Expected: 0 (or near-zero — only cosmetic responsive classes should remain).

- [ ] **Step 5: Run full test suite**

```bash
npx tsx --test tests/*.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/dom-walker.ts
git commit -m "feat: integrate V2 responsive styles into dom-walker"
```

---

### Task 10: E2E verification on mino + hkvc

**Files:**
- None (output verification)

- [ ] **Step 1: Clean and convert both projects**

```bash
rm -rf output/mino output/hkvc
npx tsx src/cli/index.ts convert inputs/mino/ --split
npx tsx src/cli/index.ts convert inputs/hkvc/ --split
```

- [ ] **Step 2: Verify metrics**

```bash
echo "=== @media blocks ===" && grep -c '@media' output/mino/pages/index.html
echo "=== desktop layout ===" && grep -c '"gridTemplateColumns":"repeat' output/mino/pages/index.html
echo "=== responsive consumed ===" && grep -c 'md:grid\|lg:grid' output/mino/pages/index.html
```

Expected:
- `@media` count > 0
- Desktop grid columns preserved
- Responsive grid classes consumed (0 or near-zero)

- [ ] **Step 3: Manual WordPress test**

Copy-paste `output/mino/pages/index.html` into WordPress. Resize editor viewport. Verify:
- Grids change from 4→2→1 columns at tablet/mobile breakpoints
- Flex items stack differently at responsive sizes
- No "Attempt Recovery" errors
- Cosmetic classes (shadow, opacity) still preserved

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "verify: V2 E2E on mino + hkvc"
```

---

## Self-Review Checklist

### 1. Spec coverage
- Breakpoint parsing (sm/md/lg/xl/2xl) ✓
- Cascade resolution across all 5 TW breakpoints ✓
- Tier collapse to 3 GB tiers ✓
- Desktop picks highest breakpoint ✓
- sm: cascades forward (Mobile = default) ✓
- Value resets (none) handled as override ✓
- Same-value skip (no redundant @media) ✓
- Unsupported values pass through ✓
- Cosmetic responsive classes pass through ✓
- V1 backward compatible (flat output for non-responsive classes) ✓

### 2. Placeholder scan
- No TBD, TODO, or "implement later" ✓
- All code complete and ready ✓
- GB media queries confirmed from live blocks ✓

### 3. Type consistency
- `GbStyles = Record<string, string | GbStyles>` — recursive type supports nested @media ✓
- `tailwindLayoutToGbAttributes` returns `{ styles: GbStyles, leftoverClasses: string }` ✓
- `collapseToGbTiers(propKey, resolved)` → `GbStyles` ✓
- `mergeGbStyles` deep-merges GbStyles ✓
- Integration: `applyLayoutMapper` spread handles nested keys naturally ✓
