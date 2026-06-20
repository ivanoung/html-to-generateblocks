# Spec: @media CSS Sync for Frontend Responsiveness

**Date**: 2025-06-21 | **Status**: Approved
**Root cause**: `mergeCssIntoLazyStyles()` skips `@media` keys when rebuilding `css`. Editor reads `styles` (has them → works), frontend reads `css` (missing → broken). 85 blocks affected.

---

## Current State

```js
// mergeCssIntoLazyStyles — the bug:
for (const [camel, val] of Object.entries(styles)) {
    if (camel.startsWith("@media")) continue;  // BUG: responsive rules discarded
    ...
}
```

Block `elem004` has `@media(max-width:1023px){paddingLeft:24px}` in styles → completely absent in css → no responsive padding on frontend.

---

## Target State

```css
.gb-element-elem004{
  align-items:center;display:flex;height:64px;...padding-left:48px;padding-right:48px;
}
@media (max-width: 1023px) {
  .gb-element-elem004 {
    padding-left:24px;padding-right:24px;
  }
}
```

---

## Algorithm (revised per fusion review)

```
function buildSyncedCss(styles: BlockStyles, selector: string): string {
  flat: [string, string][] = []     // [kebab, val] pairs
  mediaBlocks: [string, string][] = []  // [query, innerCss]

  for each (key, val) in styles:
    if key.startsWith("@media") and val is a non-empty object:
      inner = []
      for each (innerKey, innerVal) in val:
        inner.push(`${kebab(innerKey)}:${innerVal}`)
      if inner.length > 0:
        inner.sort()
        mediaBlocks.push([key, `${selector}{${inner.join(";")}}`])
    else if key is not @media:
      flat.push([kebab(key), String(val)])

  // Sort flat alphabetically by property name
  flat.sort((a, b) => a[0].localeCompare(b[0]))
  flatCss = `${selector}{${flat.map(([k, v]) => `${k}:${v}`).join(";")}}`

  // Sort media blocks by px descending (largest breakpoint first)
  mediaBlocks.sort((a, b) => {
    pxA = extractPx(a[0])  // parse px from "max-width: Npx" or "min-width: Npx"
    pxB = extractPx(b[0])
    if (pxA === pxB) return a[0].localeCompare(b[0])  // tiebreaker: string sort
    return pxB - pxA  // descending
  })
  mediaCss = mediaBlocks.map(([query, body]) => `${query}{${body}}`).join("")

  return flatCss + mediaCss
}
```

### Key design decisions

1. **Single-pass iterative** — not recursive. Nesting is one level deep (GB `styles` only supports `@media` with flat properties inside). A guard rejects unexpected deeper nesting.
2. **Self-contained selectors** — each @media block wraps its own `selector{...}` internally. Combined output starts with `.` → `formatCss` pass-through → no double-wrapping.
3. **Sorting**: flat properties alphabetically, @media blocks by px descending with string tiebreaker.
4. **Values pass through unchanged** — `!important`, `!` flags, complex values preserved as-is.
5. **Empty @media bodies skipped** — no output for `@media(max-width:767px): {}`.

### formatCss interaction

`buildSyncedCss()` returns a complete CSS string starting with `.gb-element-elem004{...}`. `formatCss` checks:
```js
if (rawCss.trim().startsWith(".") || rawCss.trim().startsWith("@")) return rawCss;
```
→ Passes through unchanged. No double-wrapping.

### Edge cases

| Input | Behavior |
|---|---|
| No @media keys | Flat CSS only, no @media blocks |
| One @media with properties | One @media block with its own selector |
| Multiple @media | Multiple blocks sorted by px descending |
| @media with empty nested object | Skipped, no output |
| Deeply nested @media (@media inside @media) | Guard: skip nested key, emit warning |
| Non-standard query (min-width, screen, orientation) | Preserved verbatim, sorted alphabetically after px-sorted ones |
| `!important` in value | Preserved as-is in value string |
| Props from `block.css` + props from mapper in `styles` | Merged first (existing logic), then built into CSS |

---

## Files Changed

1. `src/core/serializer.ts`:
   - Replace CSS rebuild loop in `mergeCssIntoLazyStyles()` with `buildSyncedCss(styles, selector)`
   - Add `buildSyncedCss()` helper function
   - Add `extractPx()` helper for @media sort

---

## Implementation Plan

### Task 1: Implement `buildSyncedCss` + helpers
- Write `buildSyncedCss(styles, selector)` — iterative, single-pass
- Write `extractPx(query)` — parse px from max-width/min-width queries
- Wire into `mergeCssIntoLazyStyles` replacing the flat loop
- Guard against deep nesting (>1 level)

**File**: `src/core/serializer.ts`

### Task 2: Add test cases
- Flat styles only → correct CSS
- Single @media → @media block in output
- Multiple @media → sorted by px descending
- @media with empty body → skipped
- Non-standard queries → preserved verbatim
- @media with `!important` values → preserved
- End-to-end: block with both flat + @media styles → full CSS output
- Interaction with formatCss → no double-wrapping

**File**: `tests/serializer.test.ts` (existing)

### Task 3: Validate
- Re-convert mino → 85 blocks now have @media in css (was 0)
- Run full test suite (216+ new tests)
- Verifier: 0 discrepancies
- Spot-check: `elem004`, `text003`, `text010` css output has @media blocks
- Manual: check px sorting order (largest breakpoint first)

### Task 4: Re-convert all projects
- mino, hkvc, TTN → all verifiers pass
- Push
