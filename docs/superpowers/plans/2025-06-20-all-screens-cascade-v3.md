# All-Screens-Centric Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current V2 responsive cascade in `tailwind-layout-mapper.ts` with the All-Screens + downward `max-width` reset system defined in `docs/superpowers/specs/2025-06-20-all-screens-centric-cascade.md`.

**Architecture:** The new `collapseToAllScreensWithResets()` function takes a per-property cascade-resolved map of breakpoint→value, finds the largest breakpoint's value → All Screens, then walks downward emitting `@media(max-width: N−1px)` blocks for each value-change boundary. A `PROPERTY_RESETS` lookup supplies CSS initial values when a breakpoint has no value below it.

**Tech Stack:** TypeScript, Vitest, existing `GbStyles` type (`Record<string, string | GbStyles>`)

**Key files:**
- `src/core/tailwind-layout-mapper.ts` (377 lines) – core logic change
- `src/core/dom-walker.ts` (593 lines) – `mapperStylesToCss()` may need adjustment for new @media key format
- `tests/tailwind-layout-mapper.test.ts` (364 lines) – rewrite all cascade tests

---

## Task 1: Add `PROPERTY_RESETS` lookup table and helpers

**Files:** Modify: `src/core/tailwind-layout-mapper.ts`

- [ ] **Step 1: Add the reset value lookup table before the `tailwindLayoutToGbAttributes` export**

```typescript
// ── V3 All-Screens-Centric Cascade ────────────────────────

/** Breakpoints in cascade order (smallest → largest) */
const TW_BP_ORDER: { prefix: string; px: number }[] = [
  { prefix: "", px: 0 },       // default
  { prefix: "sm", px: 640 },
  { prefix: "md", px: 768 },
  { prefix: "lg", px: 1024 },
  { prefix: "xl", px: 1280 },
  { prefix: "2xl", px: 1536 },
];

/** Breakpoint px → N−1 px for max-width reset boundary */
function maxWidthBoundary(px: number): number {
  return px - 1;
}

/** CSS initial values for property resets when no breakpoint value exists below */
const PROPERTY_RESETS: Record<string, string> = {
  gridColumn: "auto",
  gridColumnStart: "auto",
  gridColumnEnd: "auto",
  gridRow: "auto",
  gridRowStart: "auto",
  gridRowEnd: "auto",
  gridTemplateColumns: "none",
  gridTemplateRows: "none",
  display: "initial",       // ⚠ resolves to 'inline' per CSS spec; for block elements this is a known limitation (rare — TW devs always set a base display class)
  flexDirection: "row",
  flexWrap: "nowrap",
  justifyContent: "flex-start",
  alignItems: "stretch",
  alignContent: "stretch",
  alignSelf: "auto",
  justifyItems: "stretch",
  justifySelf: "auto",
  placeContent: "stretch",
  placeItems: "stretch",
  placeSelf: "auto",
  gap: "0px",
  rowGap: "0px",
  columnGap: "0px",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  marginTop: "0px",
  marginRight: "0px",
  marginBottom: "0px",
  marginLeft: "0px",
  width: "auto",
  height: "auto",
  minWidth: "0px",
  minHeight: "0px",
  maxWidth: "none",
  maxHeight: "none",
  overflowX: "visible",
  overflowY: "visible",
  position: "static",
  zIndex: "auto",
  order: "0",
  flexGrow: "0",
  flexShrink: "1",
  flexBasis: "auto",
  flex: "0 1 auto",
  fontSize: "inherit",
  fontWeight: "400",
  lineHeight: "inherit",
  textAlign: "left",
  borderRadius: "0px",
  borderWidth: "0px",
  opacity: "1",
  visibility: "visible",
  isolation: "auto",
  aspectRatio: "auto",
  gridAutoFlow: "row",
  gridAutoColumns: "auto",
  gridAutoRows: "auto",
};

function getResetValue(propKey: string): string {
  if (propKey in PROPERTY_RESETS) return PROPERTY_RESETS[propKey];
  return "initial"; // fallback
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "feat: add PROPERTY_RESETS table and TW breakpoint definitions for V3 cascade"
```

---

## Task 2: Write failing tests for the new cascade (20 patterns)

**Files:** Modify: `tests/tailwind-layout-mapper.test.ts`

- [ ] **Step 1: Add test cases for all 20 patterns from the coverage matrix**

Add after the existing imports/describe block:

```typescript
describe("V3 All-Screens cascade (downward max-width resets)", () => {
  test("p-4 (default only) — All Screens only, no @media", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4");
    expect(styles).toEqual({ paddingTop: "16px", paddingRight: "16px", paddingBottom: "16px", paddingLeft: "16px" });
  });

  test("p-4 md:p-8 (default + md) — AS=32, @767=16", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 md:p-8");
    expect(styles["paddingTop"]).toBe("32px");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.paddingTop).toBe("16px");
  });

  test("p-4 md:p-8 lg:p-12 (default+md+lg) — AS=48, @1023=32, @767=16", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 md:p-8 lg:p-12");
    expect(styles["paddingTop"]).toBe("48px");
    expect((styles["@media (max-width: 1023px)"] as GbStyles)?.paddingTop).toBe("32px");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.paddingTop).toBe("16px");
  });

  test("p-4 sm:p-6 md:p-8 lg:p-12 (all 4 diff) — AS=48, @1023=32, @767=24, @639=16", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 sm:p-6 md:p-8 lg:p-12");
    expect(styles["paddingTop"]).toBe("48px");
    expect((styles["@media (max-width: 1023px)"] as GbStyles)?.paddingTop).toBe("32px");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.paddingTop).toBe("24px");
    expect((styles["@media (max-width: 639px)"] as GbStyles)?.paddingTop).toBe("16px");
  });

  test("md:col-span-7 (md only, no default) — AS=span 7, @767=auto reset", () => {
    const { styles } = tailwindLayoutToGbAttributes("md:col-span-7");
    expect(styles["gridColumn"]).toBe("span 7");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.gridColumn).toBe("auto");
  });

  test("lg:col-span-7 (lg only, no default) — AS=span 7, @1023=auto reset", () => {
    const { styles } = tailwindLayoutToGbAttributes("lg:col-span-7");
    expect(styles["gridColumn"]).toBe("span 7");
    expect((styles["@media (max-width: 1023px)"] as GbStyles)?.gridColumn).toBe("auto");
  });

  test("flex-col md:flex-row — AS=row, @767=column", () => {
    const { styles } = tailwindLayoutToGbAttributes("flex-col md:flex-row");
    expect(styles["flexDirection"]).toBe("row");
    expect(styles["display"]).toBe("flex");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.flexDirection).toBe("column");
  });

  test("grid-cols-1 md:grid-cols-2 lg:grid-cols-4 — AS=4fr, @1023=2fr, @767=1fr", () => {
    const { styles } = tailwindLayoutToGbAttributes("grid-cols-1 md:grid-cols-2 lg:grid-cols-4");
    expect(styles["gridTemplateColumns"]).toBe("repeat(4, minmax(0, 1fr))");
    expect((styles["@media (max-width: 1023px)"] as GbStyles)?.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
  });

  test("gap-2 md:gap-4 lg:gap-8 — AS=32, @1023=16, @767=8", () => {
    const { styles } = tailwindLayoutToGbAttributes("gap-2 md:gap-4 lg:gap-8");
    expect(styles["columnGap"]).toBe("32px");
    expect(styles["rowGap"]).toBe("32px");
    expect((styles["@media (max-width: 1023px)"] as GbStyles)?.columnGap).toBe("16px");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.columnGap).toBe("8px");
  });

  test("p-4 xl:p-12 (default + xl) — AS=48, @1279=16", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 xl:p-12");
    expect(styles["paddingTop"]).toBe("48px");
    expect((styles["@media (max-width: 1279px)"] as GbStyles)?.paddingTop).toBe("16px");
  });

  test("p-4 2xl:p-12 (default + 2xl) — AS=48, @1535=16", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 2xl:p-12");
    expect(styles["paddingTop"]).toBe("48px");
    expect((styles["@media (max-width: 1535px)"] as GbStyles)?.paddingTop).toBe("16px");
  });

  test("p-4 sm:p-6 (default + sm) — AS=24, @639=16", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 sm:p-6");
    expect(styles["paddingTop"]).toBe("24px");
    expect((styles["@media (max-width: 639px)"] as GbStyles)?.paddingTop).toBe("16px");
  });

  test("flex (no responsive) — AS only", () => {
    const { styles } = tailwindLayoutToGbAttributes("flex");
    expect(styles).toEqual({ display: "flex" });
  });

  test("p-4 md:p-8 xl:p-24 (default+md+xl, no lg) — AS=96, @1279=32, @767=16", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 md:p-8 xl:p-24");
    expect(styles["paddingTop"]).toBe("96px");
    expect((styles["@media (max-width: 1279px)"] as GbStyles)?.paddingTop).toBe("32px");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.paddingTop).toBe("16px");
  });

  test("xl:col-span-7 (xl only, no default) — AS=span 7, @1279=auto", () => {
    const { styles } = tailwindLayoutToGbAttributes("xl:col-span-7");
    expect(styles["gridColumn"]).toBe("span 7");
    expect((styles["@media (max-width: 1279px)"] as GbStyles)?.gridColumn).toBe("auto");
  });

  test("2xl:col-span-7 (2xl only, no default) — AS=span 7, @1535=auto", () => {
    const { styles } = tailwindLayoutToGbAttributes("2xl:col-span-7");
    expect(styles["gridColumn"]).toBe("span 7");
    expect((styles["@media (max-width: 1535px)"] as GbStyles)?.gridColumn).toBe("auto");
  });

  test("md:grid-cols-2 lg:grid-cols-4 (no default) — AS=4fr, @1023=2fr, @767=none reset", () => {
    const { styles } = tailwindLayoutToGbAttributes("md:grid-cols-2 lg:grid-cols-4");
    expect(styles["gridTemplateColumns"]).toBe("repeat(4, minmax(0, 1fr))");
    expect(styles["display"]).toBe("grid");
    expect((styles["@media (max-width: 1023px)"] as GbStyles)?.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.gridTemplateColumns).toBe("none");
  });

  test("items-center md:items-start — AS=flex-start, @767=center", () => {
    const { styles } = tailwindLayoutToGbAttributes("items-center md:items-start");
    expect(styles["alignItems"]).toBe("flex-start");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.alignItems).toBe("center");
  });
});
```

- [ ] **Step 2: Verify these tests all FAIL**

Run: `npx vitest run tests/tailwind-layout-mapper.test.ts`

Expected: new tests fail — output contains `"paddingTop"` → `"16px"` but we haven't written the V3 cascade yet (current V2 produces different output like `"48px"` in some cases).

- [ ] **Step 3: Commit**

```bash
git add tests/tailwind-layout-mapper.test.ts
git commit -m "test: add 17 V3 cascade tests (coverage matrix patterns)"
```

---

## Task 3: Implement `collapseToAllScreensWithResets()`

**Files:** Modify: `src/core/tailwind-layout-mapper.ts`

- [ ] **Step 1: Remove old V2 cascade constants and replace `collapseToGbTiers`**

Delete these constants (around lines 258-260):
```typescript
const GB_DESKTOP = "(min-width: 1025px)";
const GB_TABLET = "(max-width: 1024px)";
const GB_MOBILE = "(max-width: 767px)";
```

Replace the entire `collapseToGbTiers` function with the new V3 function:

```typescript
/**
 * V3 All-Screens-centric cascade.
 *
 * Largest Tailwind breakpoint value → All Screens.
 * Each downward value-change → @media(max-width: N−1px) override.
 * Gaps (no value at a smaller breakpoint) → reset to PROPERTY_RESETS value.
 * Blocks emitted in ascending max-width order (largest bp−1 first, smallest last)
 * so CSS source-order cascade picks the most specific match.
 */
function collapseToAllScreensWithResets(
  propKey: string,
  resolved: Map<string, string>,
): GbStyles {
  // Find the largest breakpoint with a value
  const bpEntries = [...resolved.entries()]
    .map(([bp, val]) => ({ bp, px: TW_BP_PX[bp] ?? 0, val }))
    .sort((a, b) => b.px - a.px); // largest → smallest

  if (bpEntries.length === 0) return {};

  const largest = bpEntries[0];
  const styles: GbStyles = {};

  // 1. All Screens = largest breakpoint's value
  styles[propKey] = largest.val;

  // 2. Walk downward, emit max-width resets at value-change boundaries
  for (let i = 0; i < bpEntries.length - 1; i++) {
    const current = bpEntries[i];
    const below = bpEntries[i + 1];

    // Is there a gap between current and the next value below?
    // Gap = the next breakpoint is NOT immediately adjacent in TW_BP_ORDER
    const hasGap = current.px - below.px > getTwBpStep(below.px);
    // Value differs between the two breakpoints
    const valueChanged = current.val !== below.val;

    if (valueChanged) {
      // Emit the value that applies at (current.px − 1) down to below.px
      const boundary = `@media (max-width: ${maxWidthBoundary(current.px)}px)`;
      styles[boundary] = { [propKey]: below.val };
    }

    // If there's a gap AND no value at the intermediate breakpoints,
    // the value below needs resets for every intermediate breakpoint too.
    // But since we're in a resolved cascade (all intermediate BPs carry the
    // current value), the gap case only manifests as "the next resolved
    // entry is far away" — which our loop handles naturally: each step
    // emits one max-width block at the boundary.
  }

  // 3. If the smallest breakpoint with a value is NOT the default (0px),
  //    we need a downward reset at that breakpoint's boundary
  const smallest = bpEntries[bpEntries.length - 1];
  if (smallest.px > 0) {
    const boundary = `@media (max-width: ${maxWidthBoundary(smallest.px)}px)`;
    // Only emit if we haven't already set this boundary
    if (!styles[boundary]) {
      const resetVal = getResetValue(propKey);
      styles[boundary] = { [propKey]: resetVal };
    }
  }

  // 4. Reorder: max-width blocks ascending (largest px first, smallest last)
  //    for CSS source-order correctness
  return reorderMaxWidthDescending(styles);
}

/** TW breakpoint prefix → px value */
const TW_BP_PX: Record<string, number> = {
  "": 0, "sm": 640, "md": 768, "lg": 1024, "xl": 1280, "2xl": 1536,
};

/**
 * Get the px step from a breakpoint to the next one below it.
 * This helps detect "gaps" in the breakpoint chain.
 */
function getTwBpStep(px: number): number {
  const pxValues = [0, 640, 768, 1024, 1280, 1536, Infinity];
  const idx = pxValues.indexOf(px);
  if (idx === -1) return 640; // conservative default
  if (idx === 0) return 640;  // from 0 to 640
  return pxValues[idx] - pxValues[idx - 1];
}

/**
 * Reorder @media(max-width) keys from largest px to smallest px.
 * This guarantees CSS source-order: at overlapping max-width, the
 * last (smallest) block wins.
 */
function reorderMaxWidthDescending(styles: GbStyles): GbStyles {
  const flatKeys = Object.keys(styles).filter(k => !k.startsWith("@media"));
  const mediaKeys = Object.keys(styles)
    .filter(k => k.startsWith("@media (max-width:"))
    .sort((a, b) => {
      const aPx = parseInt(a.match(/max-width:\s*(\d+)px/)![1], 10);
      const bPx = parseInt(b.match(/max-width:\s*(\d+)px/)![1], 10);
      return bPx - aPx; // descending px = largest first
    });

  const reordered: GbStyles = {};
  for (const k of flatKeys) reordered[k] = styles[k];
  for (const k of mediaKeys) reordered[k] = styles[k];
  return reordered;
}
```

- [ ] **Step 2: Update the main export to use the new function**

In `tailwindLayoutToGbAttributes`, find the line:
```typescript
mergeGbStyles(finalStyles, collapseToGbTiers(prop, resolved));
```
Replace with:
```typescript
mergeGbStyles(finalStyles, collapseToAllScreensWithResets(prop, resolved));
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/tailwind-layout-mapper.test.ts`

Expected: new V3 tests pass. Some old V2 tests may fail — that's expected since the cascade format changed.

- [ ] **Step 4: Fix any old tests affected by the format change**

Examine failing tests. The old V2 tests expected `(max-width: 1024px)` and `(max-width: 767px)` — the new format uses `(max-width: 1023px)` and `(max-width: 767px)` (for md→lg boundary). The `767px` for md→default stays the same because 768−1=767.

Key differences to fix:
- Old `(max-width: 1024px)` → new `(max-width: 1023px)` (lg boundary)
- Old `(min-width: 1025px)` → no longer exists (replaced by All Screens + downward reset)
- Old `(max-width: 1024px) and (min-width: 768px)` for Tablet → removed entirely

After fixing old tests to match new format, all tests should pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts tests/tailwind-layout-mapper.test.ts
git commit -m "feat: replace V2 GB-tier cascade with V3 All-Screens + downward max-width resets

- collapseToAllScreensWithResets() replaces collapseToGbTiers()
- Largest TW breakpoint → All Screens
- Downward value changes → @media(max-width: N−1px) overrides
- Reset values from PROPERTY_RESETS when gap exists below breakpoint
- Emit order: largest max-width first, smallest last (CSS source-order)"
```

---

## Task 4: Update `dom-walker.ts` @media format if needed

**Files:** Modify: `src/core/dom-walker.ts`

- [ ] **Step 1: Check `mapperStylesToCss()` for media query key handling**

Read the current `mapperStylesToCss()` function (around line 400-500 in dom-walker.ts). Verify it handles `@media (max-width: Npx)` keys the same way it handles `@media (max-width: Npx)` keys — which it should since the format is identical.

If the function currently only handles GB's old format `(max-width: 1024px)` and `(max-width: 767px)`, it needs no changes since the new format is the same pattern just with different px values (1023 instead of 1024).

Run the full test suite to verify:
```bash
npx vitest run
```

- [ ] **Step 2: If any dom-walker tests fail, fix them**

Expected: no failures. The @media key format hasn't changed — `@media (max-width: Npx)` is the same for both old and new.

- [ ] **Step 3: Commit (if changes needed)**

---

## Task 5: Full integration test — run against real input

**Files:** No file changes. Verification only.

- [ ] **Step 1: Run the converter against a test page**

```bash
cd /home/ivanoung/projects/gb-converter
npx tsx src/cli/index.ts -i docs/superpowers/specs/mvp-test-blocks.html -o /tmp/v3-test --split
```

- [ ] **Step 2: Inspect output for correct @media format**

Check the generated global-styles-import.json and block JSON for correct `@media(max-width)` keys with descending px values.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (target: 194+ total with new V3 tests).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: verify V3 cascade against MVP test page, full suite passes"
```

---

## Task 6: TDD self-check — edge cases and regressions

**Files:** Modify: `tests/tailwind-layout-mapper.test.ts`

- [ ] **Step 1: Add edge case tests**

```typescript
describe("V3 cascade edge cases", () => {
  test("redundant skip: values same across breakpoints emit only AS", () => {
    // p-4 md:p-4 lg:p-4 → all same value, no @media needed
    const { styles } = tailwindLayoutToGbAttributes("p-4 md:p-4 lg:p-4");
    expect(Object.keys(styles)).toEqual(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]);
    // pad has 4 keys (all 4 directions), no @media
    expect(Object.keys(styles).filter(k => k.startsWith("@media"))).toHaveLength(0);
  });

  test("redundant skip: md equals lg, only emit @767 for default", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 md:p-8 lg:p-8");
    expect(styles["paddingTop"]).toBe("32px"); // lg=md=32
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.paddingTop).toBe("16px");
    // No @1023 because lg=md — redundant
    expect(styles["@media (max-width: 1023px)"]).toBeUndefined();
  });

  test("multi-property: padding + gap coexist with different resets", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 md:p-8 gap-2 lg:gap-8");
    expect(styles["paddingTop"]).toBe("32px");
    expect(styles["columnGap"]).toBe("32px");
    expect((styles["@media (max-width: 1023px)"] as GbStyles)?.columnGap).toBe("32px");
    // padding has @767, gap also @767
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.paddingTop).toBe("16px");
    expect((styles["@media (max-width: 767px)"] as GbStyles)?.columnGap).toBe("8px");
  });

  test("emit order: max-width blocks descending px", () => {
    const { styles } = tailwindLayoutToGbAttributes("p-4 sm:p-6 md:p-8 lg:p-12 xl:p-24");
    const mediaKeys = Object.keys(styles).filter(k => k.startsWith("@media"));
    const pxVals = mediaKeys.map(k => parseInt(k.match(/(\d+)px/)![1], 10));
    // Should be descending: 1279, 1023, 767, 639
    expect(pxVals).toEqual([1279, 1023, 767, 639]);
  });

  test("leftoverClasses preserves non-mapped tokens", () => {
    const { leftoverClasses } = tailwindLayoutToGbAttributes("p-4 custom-class md:p-8 foo-bar");
    expect(leftoverClasses).toContain("custom-class");
    expect(leftoverClasses).toContain("foo-bar");
  });
});
```

- [ ] **Step 2: Run tests, fix any issues**

```bash
npx vitest run tests/tailwind-layout-mapper.test.ts
```

All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tailwind-layout-mapper.test.ts
git commit -m "test: add V3 edge cases — redundant skip, multi-property, emit order"
```

---

## Task 7: Final cleanup — remove dead code, verify doc alignment

**Files:** Modify: `src/core/tailwind-layout-mapper.ts`

- [ ] **Step 1: Remove dead code from V2**

Delete the old V2 constants if still present:
```typescript
const GB_DESKTOP = "(min-width: 1025px)";
const GB_TABLET = "(max-width: 1024px)";
const GB_MOBILE = "(max-width: 767px)";
```

- [ ] **Step 2: Verify no references to old constants remain**

```bash
rg "GB_DESKTOP|GB_TABLET|GB_MOBILE|collapseToGbTiers" src/
```

Expected: no matches.

- [ ] **Step 3: Run full test suite one final time**

```bash
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add src/core/tailwind-layout-mapper.ts
git commit -m "chore: remove dead V2 cascade constants, final cleanup"
```

---

## Completion

All tasks complete. The `tailwindLayoutToGbAttributes()` function now uses the V3 All-Screens-centric cascade with downward `max-width` resets. 20+ test patterns verify correctness. Full test suite passes.
