# Gradual Class-to-Inline Transfer Plan

**Status:** Draft  
**Date:** 2026-06-20  
**Goal:** Transfer every Tailwind utility class into GenerateBlocks inline `styles`, eliminating redundancy between `globalClasses` + `tailwind-utilities.css` and GB's native attributes. Step by step, with guaranteed `styles.css` fallback at every milestone.

---

## Ultimate Goal

```
Before:  Block renders with class="flex items-center gap-4 bg-white rounded-lg px-6 z-50"
         Editor sees nothing (styles: {})

After:   Block renders with class="bg-white rounded-lg px-6 z-50"
         styles: { display: "flex", alignItems: "center", columnGap: "16px", rowGap: "16px" }
         Editor sees flex layout with gap and alignment
```

Every class the mapper handles is **removed from globalClasses** and **removed from tailwind-utilities.css**. The mapper-produced `styles` + `css` replaces them. Classes not yet mapped stay as-is (unchanged behavior).

---

## Invariant: `styles.css` Always Exists

`styles.css` is the full Tailwind compilation of ALL classes. It is:

- Generated at conversion time (existing behavior)
- Not imported under normal WordPress workflow
- Available as a **one-step emergency rollback** — import it and the page is pixel-perfect with zero dependence on GB's inline styles
- Must never be altered or reduced by the mapper

This guarantees: if any milestone breaks something, revert the mapper changes and re-import `styles.css`. Zero data loss.

---

## Milestone Map

| Step | Classes transferred | Complexity | Risk |
|---|---|---|---|
| **M1** (now) | Layout: display, flex, grid, gap, alignment, overflow, aspect-ratio, visibility, order, grid span, place/justify | Medium | Medium |
| **M2** | Spacing: padding, margin | Low | Low |
| **M3** | Sizing: width, height, min/max | Low | Low |
| **M4** | Positioning: absolute, fixed, relative, top/left/right/bottom/inset | Medium | Medium |
| **M5** | Z-index, borders, border-radius, opacity | Low | Low |
| **M6** | Typography: font-size, font-weight, text-align, line-height, letter-spacing | Medium | Medium |
| **M7** | Colors: text color, background, border-color (static only) | High | High |
| **M8** | Effects: box-shadow, backdrop-blur, transforms, transitions | High | High |
| **M9** | State modifiers: hover, focus, group-hover, responsive of all above | Very High | Very High |

Each milestone:
1. Updates the mapper to handle new class categories
2. Updates tests
3. Verifies `styles.css` is unchanged
4. Runs full conversion against mino + hkvc — checks the output HTML has pixel-parity
5. Commits with clear milestone tag

---

## M1: Layout Classes (Current)

**Classes transferred to GB `styles`:**

Display, flex-direction, flex-wrap, align-items, justify-content, align-content, align-self, justify-items, justify-self, place-content, place-items, place-self, flex (shorthand), flex-grow, flex-shrink, flex-basis, order, gap, row-gap, column-gap, grid-template-columns, grid-template-rows, grid-column, grid-row, grid-column-start/end, grid-row-start/end, grid-auto-flow, grid-auto-columns, grid-auto-rows, overflow, aspect-ratio, visibility, isolation.

Plus all responsive variants (`md:flex`, `lg:grid-cols-4`, etc.) via V3 cascade.

**Files touched:**
- `src/core/dom-walker.ts` — integrate `tailwindLayoutToGbAttributes()` into `extractGlobalClasses()`
- `src/core/css-splitter.ts` — filter mapped layout classes from `tailwind-utilities.css`
- `tests/` — add integration tests for the full pipeline

**Success criteria:**
- Block `styles` contains layout properties, `globalClasses` excludes them
- `tailwind-utilities.css` excludes layout utilities
- `styles.css` unchanged
- Mino + hkvc conversion output passes pixel-parity
- All 66 tests pass

**Rollback:** Revert mapper integration commit. `styles.css` covers everything.

---

## Future Milestones (M2–M9)

**M2: Spacing** — `p-*`, `m-*`, `px-*`, `py-*`, space-between. GB has native padding/margin controls in the Spacing panel.

**M3: Sizing** — `w-*`, `h-*`, `min-w-*`, `max-w-*`. GB has Width/Height controls in the Sizing panel.

**M4: Positioning** — `absolute`, `fixed`, `top-*`, `left-*`, `inset-*`. GB supports position in the Layout panel.

**M5: Borders/Opacity/Z** — `border`, `rounded-*`, `opacity-*`, `z-*`. All have native GB controls.

**M6: Typography** — `text-*`, `font-*`, `leading-*`, `tracking-*`. GB Typography panel covers all of these.

**M7: Colors** — `text-{color}`, `bg-{color}`, `border-{color}`. GB Colors panel. High risk because color values may differ (Tailwind palette vs GB palette).

**M8: Effects** — `shadow-*`, `backdrop-blur-*`, `rotate-*`, `scale-*`. GB supports some but not all.

**M9: State modifiers** — `hover:`, `focus:`, `group-hover:`, responsive of M2–M8 properties. GB has limited pseudo-class support.

---

## Pipeline Architecture (M1)

```
DOM Walk → extractGlobalClasses()
  1. Read class attribute
  2. Call tailwindLayoutToGbAttributes(classString)
  3. Merge returned styles → block.styles
  4. leftoverClasses → block.globalClasses
  5. mappedClasses → piped to css-splitter for tailwind-utilities.css exclusion
  
CSS Splitter
  1. Classify all CSS rules
  2. Exclude rules whose selector matches mapped layout classes
  3. Output: tailwind-utilities.css (reduced), global-styles-import.json (unchanged), styles-unique.css (unchanged)
```

---

## Verification at Every Milestone

1. `styles.css` — MD5 hash unchanged (or diff shows zero layout-related changes)
2. Block output — `styles` field populated, `globalClasses` excludes mapped classes
3. `tailwind-utilities.css` — excludes mapped layout classes, includes only non-layout utilities
4. Pixel-parity test — page renders identically in browser
5. GB editor import — blocks show layout visually

**If any check fails → revert milestone. `styles.css` is the safety net.**
