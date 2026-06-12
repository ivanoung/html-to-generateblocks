# Global Styles `data` Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `data` field to `global-styles.json` entries produced by `css-splitter.ts`, gated so only fully GB-editor-editable classes become Global Styles.

**Architecture:** New `generateStyleData()` function parses CSS declarations, expands shorthands, converts to camelCase, and checks against a `GB_DATA_PROPERTIES` allowlist. `walkRule()` calls it before promoting a rule — gate failure demotes the rule to `styles-unique.css`.

**Tech Stack:** TypeScript, `css` npm package (v3.0.0, already a dependency)

---

### Task 1: Create test fixture HTML

**Files:**
- Create: `output/global-style-investigation/source.html`

- [ ] **Step 1: Write the test fixture HTML**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Global Style Investigation</title>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50: '#f0f4ff', 500: '#3b5de7', 700: '#1e3ba0' },
            surface: '#ffffff',
          }
        }
      }
    }
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 font-sans">
  <div class="max-w-6xl mx-auto px-4 py-16">
    <!-- Outer wrapper -->
    <div class="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
      <!-- Inner container with two-column grid -->
      <div class="grid grid-cols-2 gap-8">
        <!-- Box 1 -->
        <div class="bg-brand-50 rounded-xl p-6">
          <h2 class="text-2xl font-bold text-brand-700 mb-3">First Column</h2>
          <p class="text-gray-600 text-base leading-relaxed">This is the first paragraph. It describes something interesting in the left column.</p>
        </div>
        <!-- Box 2 -->
        <div class="bg-brand-50 rounded-xl p-6">
          <h2 class="text-2xl font-bold text-brand-700 mb-3">Second Column</h2>
          <p class="text-gray-600 text-base leading-relaxed">This is the second paragraph. It describes something equally interesting in the right column.</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add output/global-style-investigation/source.html
git commit -m "test: add global-style-investigation fixture HTML"
```

---

### Task 2: Add `GB_DATA_PROPERTIES` constant

**Files:**
- Modify: `src/core/css-splitter.ts` — after the `UC_ONLY_PROPERTIES` class that currently ends at `"isolation"`

- [ ] **Step 1: Add the GB_DATA_PROPERTIES constant**

Insert after the existing imports and before the `GlobalStyleEntry` interface:

```typescript
// ── GB Editor Panel Property Allowlist ──────────────────────
//
// These are the camelCase property keys that GenerateBlocks'
// editor panels read from gb_style_data. Only properties in
// this set can survive editor round-trips. Any CSS declaration
// that maps to a key outside this set causes the entire rule
// to be demoted to styles-unique.css.

const GB_DATA_PROPERTIES: ReadonlySet<string> = new Set([
  // Layout & sizing
  "display", "position", "zIndex", "overflow", "overflowX", "overflowY",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "aspectRatio",
  // Flex
  "flexDirection", "flexWrap", "flexGrow", "flexShrink", "flexBasis",
  "alignItems", "alignSelf", "alignContent",
  "justifyContent", "justifyItems", "justifySelf", "order",
  // Grid
  "gridTemplateColumns", "gridTemplateRows", "gridAutoColumns", "gridAutoRows", "gridAutoFlow",
  // Spacing
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "gap", "columnGap", "rowGap",
  // Borders (sides + styles + colors)
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
  // Typography
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "textTransform",
  "textDecoration", "lineHeight", "letterSpacing", "textAlign", "color",
  // Backgrounds
  "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat",
  // Effects
  "boxShadow", "textShadow", "opacity", "transform",
  // Positioning
  "top", "right", "bottom", "left",
  // Object
  "objectFit", "objectPosition",
]);
```

- [ ] **Step 2: Commit**

```bash
git add src/core/css-splitter.ts
git commit -m "feat: add GB_DATA_PROPERTIES allowlist constant"
```

---

### Task 3: Add `expandShorthand()` and `toCamelCase()` helpers

**Files:**
- Modify: `src/core/css-splitter.ts` — after the `GB_DATA_PROPERTIES` constant

- [ ] **Step 1: Add the two helper functions**

```typescript
// ── CSS property helpers ────────────────────────────────────

/** Convert kebab-case CSS property to camelCase. */
function toCamelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Expand CSS shorthand property:value pairs into individual
 * longhand entries. Returns an array of [camelCaseKey, value] tuples.
 * Unrecognized shorthands are returned as-is (single entry).
 */
function expandShorthand(prop: string, value: string): Array<[string, string]> {
  const parts = value.split(/\s+/);
  const sides = ["Top", "Right", "Bottom", "Left"] as const;

  switch (prop) {
    case "padding":
    case "margin": {
      const prefix = prop; // "padding" or "margin"
      if (parts.length === 1) {
        return sides.map((s) => [`${prefix}${s}`, parts[0]] as [string, string]);
      }
      if (parts.length === 2) {
        return [
          [`${prefix}Top`, parts[0]],
          [`${prefix}Bottom`, parts[0]],
          [`${prefix}Right`, parts[1]],
          [`${prefix}Left`, parts[1]],
        ];
      }
      if (parts.length === 4) {
        return sides.map((s, i) => [`${prefix}${s}`, parts[i]] as [string, string]);
      }
      // 3-value: top, right/left, bottom
      return [
        [`${prefix}Top`, parts[0]],
        [`${prefix}Right`, parts[1]],
        [`${prefix}Bottom`, parts[2]],
        [`${prefix}Left`, parts[1]],
      ];
    }

    case "border": {
      // border: [width] [style] [color] — parse out each sub-component
      const widthParts = parts.filter((p) => /^\d/.test(p) || p === "thin" || p === "medium" || p === "thick");
      const styleParts = parts.filter((p) => ["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"].includes(p.toLowerCase()));
      const colorParts = parts.filter((p) => !widthParts.includes(p) && !styleParts.includes(p));

      const result: Array<[string, string]> = [];
      if (widthParts.length > 0) {
        for (const s of sides) result.push([`border${s}Width`, widthParts[0]]);
      }
      if (styleParts.length > 0) {
        for (const s of sides) result.push([`border${s}Style`, styleParts[0]]);
      }
      for (const c of colorParts) {
        for (const s of sides) result.push([`border${s}Color`, c]);
      }
      return result;
    }

    case "border-width": {
      if (parts.length === 1) return sides.map((s) => [`border${s}Width`, parts[0]] as [string, string]);
      if (parts.length === 2) return [
        ["borderTopWidth", parts[0]], ["borderBottomWidth", parts[0]],
        ["borderRightWidth", parts[1]], ["borderLeftWidth", parts[1]],
      ];
      return sides.map((s, i) => [`border${s}Width`, parts[i] ?? parts[0]] as [string, string]);
    }

    case "border-style": {
      return sides.map((s) => [`border${s}Style`, value] as [string, string]);
    }

    case "border-color": {
      return sides.map((s) => [`border${s}Color`, value] as [string, string]);
    }

    case "border-radius": {
      if (parts.length === 1) return [["borderTopLeftRadius", parts[0]], ["borderTopRightRadius", parts[0]], ["borderBottomRightRadius", parts[0]], ["borderBottomLeftRadius", parts[0]]];
      if (parts.length === 2) return [["borderTopLeftRadius", parts[0]], ["borderTopRightRadius", parts[1]], ["borderBottomRightRadius", parts[0]], ["borderBottomLeftRadius", parts[1]]];
      return [["borderTopLeftRadius", parts[0] ?? "0"], ["borderTopRightRadius", parts[1] ?? "0"], ["borderBottomRightRadius", parts[2] ?? "0"], ["borderBottomLeftRadius", parts[3] ?? "0"]];
    }

    case "flex": {
      // flex: [grow] [shrink] [basis]
      const result: Array<[string, string]> = [];
      if (parts.length >= 1) result.push(["flexGrow", parts[0]]);
      if (parts.length >= 2) result.push(["flexShrink", parts[1]]);
      if (parts.length >= 3) result.push(["flexBasis", parts[2]]);
      return result;
    }

    case "gap": {
      if (parts.length >= 2) return [["rowGap", parts[0]], ["columnGap", parts[1]]];
      return [["rowGap", parts[0]], ["columnGap", parts[0]]];
    }

    case "inset": {
      if (parts.length === 1) return sides.map((s) => [s.toLowerCase(), parts[0]] as [string, string]);
      if (parts.length === 2) return [["top", parts[0]], ["bottom", parts[0]], ["right", parts[1]], ["left", parts[1]]];
      return sides.map((s, i) => [s.toLowerCase(), parts[i] ?? parts[0]] as [string, string]);
    }

    case "overflow": {
      if (parts.length >= 2) return [["overflowX", parts[0]], ["overflowY", parts[1]]];
      return [["overflowX", parts[0]], ["overflowY", parts[0]]];
    }

    default:
      // Not a recognized shorthand — return as-is with camelCase key
      return [[toCamelCase(prop), value]];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/css-splitter.ts
git commit -m "feat: add expandShorthand and toCamelCase helpers"
```

---

### Task 4: Add `generateStyleData()` function

**Files:**
- Modify: `src/core/css-splitter.ts` — after the helper functions, before `walkRule()`

- [ ] **Step 1: Add the `generateStyleData()` function**

```typescript
// ── Style Data Generation (Gate Check) ──────────────────────

/**
 * Generate the `data` field for a GB Global Style entry from CSS
 * declarations. Expands shorthands, converts to camelCase, and
 * checks every property against GB_DATA_PROPERTIES.
 *
 * Returns the data object if ALL properties pass the gate.
 * Returns null if ANY property fails (rule should be demoted
 * to styles-unique.css).
 */
function generateStyleData(declarations: css.Declaration[]): Record<string, string> | null {
  if (!declarations || declarations.length === 0) return null;

  const data: Record<string, string> = {};

  for (const decl of declarations) {
    if (!decl.property || decl.value === undefined) continue;
    const prop = decl.property.toLowerCase().trim();
    const value = (decl.value || "").trim();
    if (!prop || !value) continue;

    // Expand shorthand → array of [camelCaseKey, value]
    const expanded = expandShorthand(prop, value);

    for (const [camelKey, val] of expanded) {
      // Gate check: must be in GB's recognized property set
      if (!GB_DATA_PROPERTIES.has(camelKey)) {
        return null; // gate failed — demote entire rule
      }
      data[camelKey] = val;
    }
  }

  return Object.keys(data).length > 0 ? data : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/css-splitter.ts
git commit -m "feat: add generateStyleData() with gate check against GB_DATA_PROPERTIES"
```

---

### Task 5: Update `GlobalStyleEntry` interface and wire into `walkRule()`

**Files:**
- Modify: `src/core/css-splitter.ts` — the existing `GlobalStyleEntry` interface and `walkRule()`

- [ ] **Step 1: Add optional `data` field to the local `GlobalStyleEntry` interface**

Find the existing interface (around the top of the file):

```typescript
export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}
```

Replace with:

```typescript
export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
  data?: Record<string, unknown>;
}
```

- [ ] **Step 2: Modify `walkRule()` to gate-check before promoting to Global Styles**

Find the two places in `walkRule()` where `globalStyles.push({...})` is called (one for `@media` children, one for top-level rules). In each place, replace the push with a gate-checked version.

**Location 1 — `@media` GS children block** (inside `if (rule.type === "media")`, the `for (const child of gsChildren)` loop):

Current code:
```typescript
    for (const child of gsChildren) {
      const selectors = child.selectors || [];
      if (selectors.length === 1 && isSingleClassSelector(selectors[0])) {
        const wrappedMedia: css.Media = { ...media, rules: [child] };
        const selector = selectors[0];
        const baseSelector = extractBaseSelector(selector);
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: sanitizeSelector(baseSelector),
          css: serializeRule(wrappedMedia, true),
        });
      } else {
        // Multi-selector or non-class inside @media → UC
        const wrappedMedia: css.Media = { ...media, rules: [child] };
        uniqueCssParts.push(serializeRule(wrappedMedia));
      }
    }
```

Replace with:
```typescript
    for (const child of gsChildren) {
      const selectors = child.selectors || [];
      if (selectors.length === 1 && isSingleClassSelector(selectors[0])) {
        const data = generateStyleData((child.declarations || []) as css.Declaration[]);
        if (data !== null) {
          const wrappedMedia: css.Media = { ...media, rules: [child] };
          const selector = selectors[0];
          const baseSelector = extractBaseSelector(selector);
          globalStyles.push({
            name: classNameToName(baseSelector),
            selector: sanitizeSelector(baseSelector),
            css: serializeRule(wrappedMedia, true),
            data,
          });
        } else {
          // Gate failed → demote to UC
          const wrappedMedia: css.Media = { ...media, rules: [child] };
          uniqueCssParts.push(serializeRule(wrappedMedia));
        }
      } else {
        // Multi-selector or non-class inside @media → UC
        const wrappedMedia: css.Media = { ...media, rules: [child] };
        uniqueCssParts.push(serializeRule(wrappedMedia));
      }
    }
```

**Location 2 — top-level rule GS block** (inside `if (rule.type === "rule")`, where the property-based classification succeeds):

Current code:
```typescript
    if (
      classification === "gs" &&
      selectors.length === 1 &&
      isSingleClassSelector(selectors[0])
    ) {
      const selector = selectors[0];
      const baseSelector = extractBaseSelector(selector);
      globalStyles.push({
        name: classNameToName(baseSelector),
        selector: sanitizeSelector(baseSelector),
        css: serializeRule(r, true),
      });
    } else {
```

Replace with:
```typescript
    if (
      classification === "gs" &&
      selectors.length === 1 &&
      isSingleClassSelector(selectors[0])
    ) {
      const data = generateStyleData((r.declarations || []) as css.Declaration[]);
      if (data !== null) {
        const selector = selectors[0];
        const baseSelector = extractBaseSelector(selector);
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: sanitizeSelector(baseSelector),
          css: serializeRule(r, true),
          data,
        });
      } else {
        // Gate failed → demote to UC
        uniqueCssParts.push(serializeRule(r));
      }
    } else {
```

**Location 3 — custom class names block** (the custom class name priority path, also in `walkRule()`, appears in two places: top-level and `@media`):

For each place where a custom class name causes `globalStyles.push({...})`, apply the same gate check pattern:
1. Call `generateStyleData()` on the declarations
2. If `data !== null` → push with `data` field
3. If `data === null` → demote by pushing to `uniqueCssParts` instead

The custom class name block in the `@media` section (inside the `for (const child of children)` loop):

Current code:
```typescript
        if (
          (r.selectors || []).length === 1 &&
          isSingleClassSelector(r.selectors![0]) &&
          customClassNames.has(getClassName(r.selectors![0]))
        ) {
          gsChildren.push(r);
          continue;
        }
```

Replace with:
```typescript
        if (
          (r.selectors || []).length === 1 &&
          isSingleClassSelector(r.selectors![0]) &&
          customClassNames.has(getClassName(r.selectors![0]))
        ) {
          // Custom class name — still gate-check before promoting
          const data = generateStyleData((r.declarations || []) as css.Declaration[]);
          if (data !== null) {
            gsChildren.push(r);
          } else {
            ucChildren.push(r);
          }
          continue;
        }
```

The custom class name block in the top-level (non-`@media`) section:

Current code:
```typescript
    if (
      selectors.length === 1 &&
      isSingleClassSelector(selectors[0]) &&
      customClassNames.has(getClassName(selectors[0]))
    ) {
      const selector = selectors[0];
      const baseSelector = extractBaseSelector(selector);
      globalStyles.push({
        name: classNameToName(baseSelector),
        selector: sanitizeSelector(baseSelector),
        css: serializeRule(r, true),
      });
      return;
    }
```

Replace with:
```typescript
    if (
      selectors.length === 1 &&
      isSingleClassSelector(selectors[0]) &&
      customClassNames.has(getClassName(selectors[0]))
    ) {
      const data = generateStyleData((r.declarations || []) as css.Declaration[]);
      if (data !== null) {
        const selector = selectors[0];
        const baseSelector = extractBaseSelector(selector);
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: sanitizeSelector(baseSelector),
          css: serializeRule(r, true),
          data,
        });
      } else {
        uniqueCssParts.push(serializeRule(r));
      }
      return;
    }
```

- [ ] **Step 3: Update the deduplication merge logic to preserve `data`**

Find the deduplication section at the end of `splitCss()`:

Current code:
```typescript
  const merged = new Map<string, GlobalStyleEntry>();
  for (const entry of globalStyles) {
    const existing = merged.get(entry.selector);
    if (existing) {
      existing.css += entry.css;
    } else {
      merged.set(entry.selector, { ...entry });
    }
  }
```

Replace with:
```typescript
  const merged = new Map<string, GlobalStyleEntry>();
  for (const entry of globalStyles) {
    const existing = merged.get(entry.selector);
    if (existing) {
      existing.css += entry.css;
      // Merge data: later entry wins on key conflicts
      if (entry.data) {
        existing.data = { ...existing.data, ...entry.data };
      }
    } else {
      merged.set(entry.selector, { ...entry });
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/core/css-splitter.ts
git commit -m "feat: wire generateStyleData gate check into walkRule, update dedup"
```

---

### Task 6: Run the test fixture and validate output

**Files:**
- No code changes — validation only

- [ ] **Step 1: Run the pipeline on the test fixture**

```bash
cd /home/ivanoung/projects/gb-converter
npx tsx src/cli/index.ts convert output/global-style-investigation/source.html
```

Expected: No errors. Produces:
- `output/global-style-investigation/pages/index.html`
- `output/global-style-investigation/pages/index.report.json`

- [ ] **Step 2: Run project:setup to generate global-styles.json**

```bash
npx tsx src/cli/index.ts project:setup output/global-style-investigation/
```

Expected: Produces:
- `output/global-style-investigation/setup/global-styles.json`
- `output/global-style-investigation/setup/styles-unique.css`

- [ ] **Step 3: Inspect global-styles.json for `data` fields**

```bash
cat output/global-style-investigation/setup/global-styles.json | head -60
```

Expected: Each entry should include a `data` field with camelCase expanded property keys. Example:

```json
{
  "name": "Grid Cols 2",
  "selector": ".grid-cols-2",
  "css": ".grid-cols-2{grid-template-columns:repeat(2, minmax(0, 1fr))}",
  "data": {
    "gridTemplateColumns": "repeat(2, minmax(0, 1fr))"
  }
}
```

- [ ] **Step 4: Verify gate rejection — check that no entry has non-GB properties**

```bash
# Count entries (should be fewer than before the change, since some are demoted)
cat output/global-style-investigation/setup/global-styles.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d)} entries')"

# Verify no entry has data with unknown keys
cat output/global-style-investigation/setup/global-styles.json | python3 -c "
import json, sys
entries = json.load(sys.stdin)
gb_props = {'display','position','zIndex','overflow','overflowX','overflowY','width','height','minWidth','maxWidth','minHeight','maxHeight','aspectRatio','flexDirection','flexWrap','flexGrow','flexShrink','flexBasis','alignItems','alignSelf','alignContent','justifyContent','justifyItems','justifySelf','order','gridTemplateColumns','gridTemplateRows','gridAutoColumns','gridAutoRows','gridAutoFlow','marginTop','marginRight','marginBottom','marginLeft','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','columnGap','rowGap','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius','fontFamily','fontSize','fontWeight','fontStyle','textTransform','textDecoration','lineHeight','letterSpacing','textAlign','color','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat','boxShadow','textShadow','opacity','transform','top','right','bottom','left','objectFit','objectPosition'}
for e in entries:
    if 'data' in e:
        for k in e['data']:
            if k not in gb_props:
                print(f'UNKNOWN KEY: {k} in {e[\"selector\"]}')
            else:
                pass
print('Validation complete')
"
```

Expected: `Validation complete` with no "UNKNOWN KEY" output.

- [ ] **Step 5: Check types compile**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 6: Commit validation report**

```bash
git add output/global-style-investigation/
git commit -m "test: add global-style-investigation generated output with data fields"
```

---

### Task 7: Run existing test suite to check for regressions

**Files:**
- No code changes — regression check only

- [ ] **Step 1: Run M1 regression**

```bash
cd /home/ivanoung/projects/gb-converter
npx tsx src/cli/index.ts regression
```

Expected: All M1 fixtures match snapshots.

- [ ] **Step 2: Run fixtures:run-all**

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: Existing fixtures still pass. If any fixture previously relied on specific global-styles.json contents, those may now differ (fewer entries with `data` fields added) — that's expected.

- [ ] **Step 3: If any fixture fails, investigate and update**

If a fixture's hard-fail count increased, check whether the difference is related to the new gate check. Update the fixture if the change is intentional.

---

### Task 8: Optional — Run against existing project (hkvc) and compare

**Files:**
- No code changes — comparison only

- [ ] **Step 1: Re-convert the hkvc project**

```bash
npx tsx src/cli/index.ts project:setup inputs/hkvc/
```

Expected: `global-styles.json` now has `data` fields but fewer entries than before.

- [ ] **Step 2: Compare rendered output**

```bash
npx tsx src/cli/index.ts render output/hkvc/
npx tsx src/cli/index.ts compare inputs/hkvc/index.html output/hkvc/
```

Expected: Mismatch may decrease slightly (demoted classes still render through styles-unique.css). No regression in render fidelity.

---
