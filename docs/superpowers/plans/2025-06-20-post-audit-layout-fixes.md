# Spec: Post-Audit Layout Fixes

**Date**: 2025-06-20 | **Status**: Draft  
**Based on**: Live WordPress audit at minodigital-2tcd.1wp.site + fusion second opinion

---

## Phase A: V3 Cascade Precedence — Base-Exclusive Property Wins

### Problem
`leading-[0.9]` (base class) sets `lineHeight: 0.9`. `lg:text-8xl` sets `lineHeight: 96px` as a side effect. The cascade takes the lg value for All Screens → `96px`, not `0.9`.

### Root Cause
The V3 cascade treats all property values equally, picking the largest-breakpoint value for All Screens. It doesn't distinguish between:
- **Base-exclusive class**: sets property at base only, no bp-prefixed variants exist (`leading-[0.9]`)
- **Breakpoint-scaling class**: same class family at multiple breakpoints (`text-5xl md:text-7xl lg:text-8xl`)

In Tailwind CSS, source order determines precedence. `leading-[0.9]` (base) compiles AFTER `lg:text-8xl` (responsive) in the CSS file, so it wins. Our mapper needs to replicate this.

### Decision Rule
A property set at the base breakpoint wins at **All Screens** if:
1. The base value comes from a class that has **no breakpoint-prefixed siblings** in the class list; OR
2. The base class appears **after** any conflicting breakpoint-prefixed class in source order (later token wins)

Rule #2 is the general rule. Rule #1 is an optimization of #2 for the common case.

For `leading-[0.9]`:
- Class family: `leading-*`
- No `sm:leading-*`, `md:leading-*`, `lg:leading-*` in class list
- → Base-exclusive → base wins at all breakpoints

For `text-5xl md:text-7xl lg:text-8xl`:
- Class family: `text-*`
- Has bp-prefixed siblings (`md:text-7xl`, `lg:text-8xl`)
- → Breakpoint-scaling → standard cascade, lg value → All Screens

For `p-4 md:p-8`:
- Class family: `p-*`
- Has bp sibling `md:p-8`
- → Breakpoint-scaling → standard cascade, md value → All Screens

### Algorithm

```
function resolveBaseExclusiveCascade(
  perBp: Map<string, Record<string, string>>,
  allTokens: Map<string, string[]>,  // bp → tokens (with class origins)
): Map<string, Record<string, string>> {

  // 1. Standard cascade (carry forward base→sm→md→lg→xl→2xl)
  const byProperty = groupByProperty(perBp);
  const resolved = new Map<string, Map<string, string>>();
  for (const [prop, perBpVals] of byProperty) {
    resolved.set(prop, resolveCascade(perBpVals));
  }

  // 2. Build class-family → breakpoints index from all tokens
  const familyBps = buildFamilyBreakpointIndex(allTokens);
  // e.g., { "text": ["", "md", "lg"], "leading": [""], "p": ["", "md"] }

  // 3. For each property, check base-exclusive wins
  for (const [prop, cascaded] of resolved) {
    const baseVal = perBp.get("")?.[prop];
    if (baseVal === undefined) continue; // No base value → standard cascade

    // Which class family produced the base value?
    const baseFamily = getFamilyForProperty(allTokens.get("") || [], prop);
    if (!baseFamily) continue;

    // Does this family have bp-prefixed entries?
    const bpEntries = familyBps.get(baseFamily) || [];
    const hasBpSiblings = bpEntries.some(bp => bp !== "");

    if (!hasBpSiblings) {
      // Base-exclusive → base value wins at all breakpoints
      for (const bp of BREAKPOINTS) {
        cascaded.set(bp, baseVal);
      }
    }
  }

  return resolved;
}
```

### Files changed
- `src/core/tailwind-layout-mapper.ts`: `mapTokens()` tracks class-family origins; `groupByProperty()` and cascade logic updated

### Tests
- `leading-[0.9]` + `text-5xl md:text-7xl lg:text-8xl` → lineHeight=0.9 at all breakpoints, fontSize cascades normally
- `text-5xl md:text-7xl lg:text-8xl` (no leading) → standard cascade unchanged
- `p-4 md:p-8` → md value at All Screens, base reset at max-width:767px
- `font-thin md:font-bold` → base-exclusive? No — has md sibling → md wins at All Screens (but wait: `font-thin` and `md:font-bold` are BOTH in the `font-*` family → NOT base-exclusive → standard cascade)

---

## Phase B: Fix CSS Over-Filtering — DOM-Presence-Based Filter

### Problem
`filterUtilityCss()` removes CSS for classes in `mappedClasses` (classes that were mapped to inline styles on GB blocks). But these same classes may still be needed:
- As child elements inside GB blocks (inner-HTML spans, form inputs, SVG wrappers)
- In core-html blocks (illustrations, forms) that have class attributes but no GB wrapper
- In JS-injected or dynamically-rendered content

### Current Code
```
// In css-splitter.ts:
function filterUtilityCss(utilityCss: string, mappedClasses: string[]): string {
  // Remove CSS rules for classes that were mapped to inline styles
  // ... strips .className{...} rules from utilityCss
}
```

The `mappedClasses` set is populated during `walkDom()` — it's the union of all classes that were successfully mapped to inline styles across all GB blocks.

### Target Behavior
After ALL blocks are assembled (including inner HTML), collect the complete set of Tailwind class references from the final HTML. Only strip CSS for classes that appear **nowhere** in any DOM context.

### Algorithm

```
function filterUtilityCssWithDomCheck(
  utilityCss: string,
  mappedClasses: string[],
  finalHtml: string,            // Complete assembled HTML of ALL blocks
): string {
  // 1. Extract all class references from final HTML DOM
  const domClasses = extractAllClassesFromHtml(finalHtml);
  // This includes: GB block class attributes, inner HTML elements,
  // core-html block class attributes, SVG class attrs, etc.

  // 2. A class is safe to strip ONLY if:
  //    - It was mapped (in mappedClasses)
  //    - AND it appears NOWHERE in the DOM
  const safeToStrip = new Set(mappedClasses.filter(c => !domClasses.has(c)));

  // 3. Remove only safe-to-strip classes from CSS
  return removeCssRules(utilityCss, safeToStrip);
}
```

### Where to wire in
`extractAllClassesFromHtml()` runs on the serialized HTML output. This happens in the orchestrator's conversion pipeline, after `walkDom` + serialize. Pass the assembled HTML to the CSS splitter/filter step.

### Files changed
- `src/core/css-splitter.ts` or `src/core/css-classifier.ts`: `filterUtilityCss()` signature updated
- `src/core/orchestrator.ts`: Pass final assembled HTML to filter function
- New utility in `src/core/dom-walker.ts` or a new `src/core/dom-class-collector.ts`: `extractAllClassesFromHtml(html: string): Set<string>`

### Edge Cases
- Classes in JS-generated content (after page load): won't be in static HTML → kept by default since we can't know they exist
- Classes in GB `css` field (raw CSS): not in HTML class attributes → need separate handling
- Classes with `:` (hover/focus/etc.): these are pseudo-class variants → extract both the base and variant forms

---

## Phase C: Color-Dependent Classes — Accept & Document

### Problem
Classes like `bg-slate`, `text-surface`, `border-seafoam/40`, `hover:bg-seafoam` rely on `--tw-*` CSS variables. These CANNOT map to GB inline styles because:
- GB inline styles don't support CSS custom properties in the `styles` field
- Colors with opacity (`/40`, `/50`) require `rgb()` + alpha syntax GB doesn't emit
- Hover/focus/active states require pseudo-class selectors (no GB equivalent)

### Decision
**Do not attempt to inline color classes.** Accept that they remain as classes requiring CSS support from `tailwind-utilities.css`.

Phase B's DOM-presence-based filter already handles this: if `bg-slate` appears in the HTML (in any context), its CSS stays in `tailwind-utilities.css`.

### Documentation
Add to README:
> **Color classes** (background, text, border colors) remain as Tailwind utility classes and require the accompanying `tailwind-utilities.css` stylesheet. This is by design — GenerateBlocks inline styles don't support CSS custom properties (`--tw-*`) or opacity modifiers (`/50`).

### Future (out of scope for this plan)
- Convert color values to GB Global Styles (requires GB theme.json integration)
- Map opacity modifiers to `opacity` CSS property

---

## Phase D: Auditable CSS Coverage Verification

### Problem
No tool currently reports which classes appear in the HTML DOM but lack CSS support in `tailwind-utilities.css`.

### Target
Extend `src/cli/verify.ts` to add a **CSS coverage report**:

```
$ npx tsx src/cli/verify.ts --coverage

=== CSS Coverage Report ===
Pages verified: 10
Classes in DOM:       312
Classes with CSS:     289 (92.6%)
Classes MISSING CSS:   23

Missing classes:
  blueprint-bg           (appears 1 time, no CSS rule found)
  clip-hex               (appears 43 times, custom class — add to CSS?)
  group/nav              (appears 5 times, parent selector variant)
  group/dropdown         (appears 11 times, parent selector variant)
  hover:bg-[#10b981]/10  (appears 3 times, state + arbitrary value)
  ...
```

### Algorithm

```
function cssCoverageReport(
  pageHtmls: string[],          // All processed page HTMLs
  tailwindUtilitiesCss: string, // Filtered CSS
): CoverageReport {
  const domClasses = new Set<string>();
  for (const html of pageHtmls) {
    for (const cls of extractAllClassesFromHtml(html)) {
      domClasses.add(cls);
    }
  }

  // Parse CSS to find all defined class selectors
  const cssClasses = parseCssClassSelectors(tailwindUtilitiesCss);

  const missing = [...domClasses].filter(c => !cssClasses.has(c));
  const present = [...domClasses].filter(c => cssClasses.has(c));

  return {
    totalDom: domClasses.size,
    totalCss: cssClasses.size,
    covered: present.length,
    missing,
    coverage: present.length / domClasses.size,
  };
}
```

### Output
- Console summary
- `output/mino/verify-coverage.json` — full report with per-class occurrence counts
- Exit code 0 even if missing classes found (warnings, not errors)

### Files changed
- `src/cli/verify.ts`: Add `--coverage` flag and coverage mode

---

## Implementation Plan

### Task 1: Phase A — Base-exclusive cascade fix
- [ ] Add `trackClassFamily()` utility to record which class family each property value came from
- [ ] After `resolveCascade`, apply base-exclusive override for properties without bp siblings
- [ ] Add 6+ test cases to `tests/tailwind-layout-mapper.test.ts`
- [ ] Re-convert mino, verify `gb-text-text010` → `line-height:0.9` at all screens
- [ ] Run verifier: 0 new discrepancies

**Files**: `src/core/tailwind-layout-mapper.ts`, tests

### Task 2: Phase B — DOM-presence-based CSS filter
- [ ] Extract `extractAllClassesFromHtml()` into a shared utility
- [ ] Update `filterUtilityCss()` signature to accept `domClassSet: Set<string>`
- [ ] Wire assembled HTML into orchestrator pipeline before CSS split
- [ ] Add test: class mapped on GB block but used in inner HTML → CSS preserved
- [ ] Re-convert mino, verify form inputs/browser mockup children have CSS

**Files**: `src/core/css-splitter.ts`, `src/core/orchestrator.ts`, new utility file

### Task 3: Phase A+B validation
- [ ] Re-convert mino + hkvc
- [ ] Run verifier: 0 discrepancies
- [ ] Run full test suite: 216+ tests
- [ ] Manual check: live WordPress reproduction

### Task 4: Phase C — Document color limitation
- [ ] Add color class documentation to README
- [ ] No code changes

**Files**: `README.md`

### Task 5: Phase D — CSS coverage command
- [ ] Add `--coverage` flag to `verify.ts`
- [ ] Implement `extractAllClassesFromHtml()` if not already done in Phase B
- [ ] Parse `tailwind-utilities.css` for class selectors
- [ ] Report coverage % and missing classes
- [ ] Write `verify-coverage.json`

**Files**: `src/cli/verify.ts`
