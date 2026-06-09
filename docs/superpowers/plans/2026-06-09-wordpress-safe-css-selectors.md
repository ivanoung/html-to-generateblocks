# WordPress-Safe CSS Selectors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate CSS backslash escapes from `global-styles.json` output so WordPress `wp_unslash()` doesn't corrupt selectors, producing valid CSS that survives post meta storage.

**Architecture:** Two functions in `css-splitter.ts`: `toSafeCssSelector()` converts CSS-escaped class selectors to `[class~="..."]` attribute selectors (for the `css` field); `sanitizeSelector()` replaces escapes with hyphens (for the `selector` label field). Simple classes stay unchanged.

**Tech Stack:** TypeScript, `css` npm package (v3.0.0), Node.js built-in test runner

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/core/css-splitter.ts` | Modify | Add `toSafeCssSelector()`, `sanitizeSelector()`. Call them in `serializeRule()` and `walkRule()`. |
| `tests/css-splitter.test.ts` | Modify | Add tests for safe selector conversion and label sanitization. |

---

### Task 1: Add safe selector functions and integrate into css-splitter.ts

**Files:**
- Modify: `src/core/css-splitter.ts`

- [ ] **Step 1: Add `toSafeCssSelector()` function**

Add this function after the existing selector helpers (after `classNameToName`, before `serializeRule`):

```typescript
/**
 * Convert a CSS-escaped class selector to a WordPress-safe format.
 * Uses [class~="..."] attribute selectors to avoid backslash characters
 * that WordPress wp_unslash() strips from post meta.
 *
 * Only converts selectors that actually contain CSS escapes.
 * Pseudo-classes are split and placed outside the attribute selector.
 * Non-class selectors (elements, pseudo-elements) are returned unchanged.
 */
function toSafeCssSelector(selector: string): string {
  // Only convert class selectors that have CSS escapes
  if (!selector.startsWith(".") || !/[\\]:\[\/]/.test(selector)) {
    return selector;
  }

  // Extract pseudo-classes from the end of the selector
  // Matches trailing :pseudo chains like :hover, :focus, :nth-child(2)
  const pseudoMatch = selector.match(/^(\.[\s\S]+?)((?::[a-zA-Z-]+(?:\([^)]*\))?)+)$/);
  const base = pseudoMatch ? pseudoMatch[1] : selector;
  const pseudo = pseudoMatch ? pseudoMatch[2] : "";

  // Unescape the class portion: strip leading dot, then remove backslash escapes
  const rawClass = base
    .replace(/^\./, "")
    .replace(/\\(.)/g, "$1");

  // Sanitize internal double quotes (shouldn't exist, but safe)
  const safeClass = rawClass.replace(/"/g, '\\"');

  return `[class~="${safeClass}"]${pseudo}`;
}
```

- [ ] **Step 2: Add `sanitizeSelector()` function**

Add this function right after `toSafeCssSelector()`:

```typescript
/**
 * Sanitize a CSS selector for the WordPress admin label (gb_style_selector).
 * Replaces CSS escape sequences with hyphens since WordPress strips backslashes.
 * Only used for the selector field in GlobalStyleEntry — not for actual CSS.
 */
function sanitizeSelector(selector: string): string {
  return selector
    .replace(/\\:/g, "-")
    .replace(/\\\[/g, "-")
    .replace(/\\\]/g, "")
    .replace(/\\\//g, "-");
}
```

- [ ] **Step 3: Integrate into `serializeRule()`**

Modify the `rule.type === "rule"` branch in `serializeRule()`. Before joining selectors, apply `toSafeCssSelector()`:

Find this code:
```typescript
  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selector = (r.selectors || []).join(",");
```

Replace with:
```typescript
  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selector = (r.selectors || [])
      .map((s) => toSafeCssSelector(s))
      .join(",");
```

- [ ] **Step 4: Integrate into `walkRule()` — sanitize selector field**

In `walkRule()`, wherever `GlobalStyleEntry` is created with a `selector` field, wrap the selector with `sanitizeSelector()`:

**Location 1 — Top-level GS entry (custom class bypass):**

Find:
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
        selector: baseSelector,
        css: serializeRule(r),
      });
      return;
    }
```

Replace `selector: baseSelector` with `selector: sanitizeSelector(baseSelector)`.

**Location 2 — Top-level GS entry (property-based):**

Find:
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
        selector: baseSelector,
        css: serializeRule(r),
      });
```

Replace `selector: baseSelector` with `selector: sanitizeSelector(baseSelector)`.

**Location 3 — @media GS child:**

Find:
```typescript
    for (const child of gsChildren) {
      const selectors = child.selectors || [];
      if (selectors.length === 1 && isSingleClassSelector(selectors[0])) {
        const wrappedMedia: css.Media = { ...media, rules: [child] };
        const selector = selectors[0];
        const baseSelector = extractBaseSelector(selector);
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: baseSelector,
          css: serializeRule(wrappedMedia),
        });
```

Replace `selector: baseSelector` with `selector: sanitizeSelector(baseSelector)`.

- [ ] **Step 5: Verify compilation**

```bash
npx tsc --noEmit
```
Expected: no new errors beyond pre-existing `css` package type issues.

- [ ] **Step 6: Commit**

```bash
git add src/core/css-splitter.ts
git commit -m "feat: WordPress-safe CSS selectors — attribute selectors to avoid backslash stripping"
```

---

### Task 2: Add tests for safe selector conversion

**Files:**
- Modify: `tests/css-splitter.test.ts`

- [ ] **Step 1: Add test cases**

Add these tests to the existing describe block in `tests/css-splitter.test.ts`:

```typescript
  // ── WordPress-safe selector conversion ─────────────────────

  it("simple class: selector unchanged, css unchanged", () => {
    const css = ".flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".flex");
    assert.strictEqual(result.globalStyles[0].css, ".flex{display:flex}");
  });

  it("responsive variant: selector sanitized, css uses attribute selector", () => {
    const css = ".md\\:flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md-flex");
    assert.strictEqual(result.globalStyles[0].css, '[class~="md:flex"]{display:flex}');
  });

  it("arbitrary value brackets: selector sanitized, css uses attribute selector", () => {
    const css = ".w-\\[600px\\]{width:600px}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".w-600px");
    assert.strictEqual(result.globalStyles[0].css, '[class~="w-[600px]"]{width:600px}');
  });

  it("fraction slash: selector sanitized, css uses attribute selector", () => {
    const css = ".w-1\\/2{width:50%}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".w-1-2");
    assert.strictEqual(result.globalStyles[0].css, '[class~="w-1/2"]{width:50%}');
  });

  it("pseudo-class preserved outside attribute selector", () => {
    const css = ".hover\\:bg-seafoam:hover{background-color:#93FFD8}";
    // background-color is UC-only, so this goes to UC, not GS
    // Test with a GS-eligible property instead
    const css2 = ".hover\\:flex:hover{display:flex}";
    const result = splitCss(css2);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".hover-flex");
    assert.strictEqual(result.globalStyles[0].css, '[class~="hover:flex"]:hover{display:flex}');
  });

  it("responsive variant inside @media: selector sanitized, css uses attribute selector", () => {
    const css = "@media(min-width:768px){.lg\\:flex{display:flex}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".lg-flex");
    assert.ok(result.globalStyles[0].css.includes("@media"));
    assert.ok(result.globalStyles[0].css.includes('[class~="lg:flex"]'));
  });

  it("multiple simple classes unchanged", () => {
    const css = ".flex{display:flex}.grid{display:grid}.pt-32{padding-top:8rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 3);
    assert.strictEqual(result.globalStyles[0].selector, ".flex");
    assert.strictEqual(result.globalStyles[1].selector, ".grid");
    assert.strictEqual(result.globalStyles[2].selector, ".pt-32");
    assert.ok(result.globalStyles[0].css.startsWith(".flex{"));
    assert.ok(result.globalStyles[1].css.startsWith(".grid{"));
    assert.ok(result.globalStyles[2].css.startsWith(".pt-32{"));
  });

  it("mixed: escaped and simple classes in separate rules", () => {
    const css = ".flex{display:flex}.md\\:flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
    // Simple stays as-is
    const simple = result.globalStyles.find(s => s.selector === ".flex");
    assert.ok(simple);
    assert.strictEqual(simple.css, ".flex{display:flex}");
    // Escaped gets converted
    const escaped = result.globalStyles.find(s => s.selector === ".md-flex");
    assert.ok(escaped);
    assert.strictEqual(escaped.css, '[class~="md:flex"]{display:flex}');
  });

  it("selector field deduplication works with sanitized selectors", () => {
    const css = ".md\\:flex{display:flex}.md\\:flex{width:100%}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md-flex");
    assert.ok(result.globalStyles[0].css.includes("display:flex"));
    assert.ok(result.globalStyles[0].css.includes("width:100%"));
  });

  it("custom class with escapes: selector sanitized, css converted", () => {
    const css = ".my\\:custom{display:flex}";
    const custom = new Set(["my:custom"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".my-custom");
    assert.strictEqual(result.globalStyles[0].css, '[class~="my:custom"]{display:flex}');
  });
```

- [ ] **Step 2: Run all tests**

```bash
node --import tsx --test tests/css-splitter.test.ts
```
Expected: all tests pass. The new tests should pass alongside existing ones.

- [ ] **Step 3: Commit**

```bash
git add tests/css-splitter.test.ts
git commit -m "test: WordPress-safe selector conversion and sanitization tests"
```

---

### Task 3: Run E2E verification

**Files:** None modified. Verification only.

- [ ] **Step 1: Run clean conversion**

```bash
rm -rf output/mino/
npx tsx src/cli/index.ts convert inputs/mino/
```
Expected: 10 pages converted, all pass.

- [ ] **Step 2: Verify selector field sanitization**

```bash
cat output/mino/setup/global-styles.json | python3 -c "
import json
with open('output/mino/setup/global-styles.json') as f:
    gs = json.load(f)

# Count escaped vs safe
escaped_selectors = [e for e in gs if '\\\\' in e['selector']]
safe_selectors = [e for e in gs if '\\\\' not in e['selector']]
print(f'Selectors with backslashes: {len(escaped_selectors)} (should be 0)')
print(f'Safe selectors: {len(safe_selectors)}')

# Check attribute selectors in css field
attr_selectors = [e for e in gs if '[class~=' in e['css']]
print(f'Entries using attribute selectors: {len(attr_selectors)}')

# Verify responsive class sanitization
for e in gs:
    if 'lg-flex' in e['selector']:
        print(f'  Example: selector={e[\"selector\"]} css={e[\"css\"][:60]}')
        break
"
```
Expected: 0 selectors with backslashes. Attribute selectors present for responsive/arbitrary value classes.

- [ ] **Step 3: Verify css field is valid CSS**

```bash
python3 -c "
import json
with open('output/mino/setup/global-styles.json') as f:
    gs = json.load(f)

# Quick sanity: no bare backslashes in css field
bad = [e for e in gs if '\\\\:' in e['css'] or '\\\\[' in e['css']]
print(f'Entries with backslash-escapes in css field: {len(bad)} (should be 0)')

# Check attribute selectors are well-formed
import re
malformed = []
for e in gs:
    if '[class~=' in e['css']:
        # Check for unclosed quotes
        matches = re.findall(r'\[class~=\"([^\"]*)\"\]', e['css'])
        for m in matches:
            if not m:
                malformed.append(e['selector'])
print(f'Malformed attribute selectors: {len(malformed)}')
"
```
Expected: 0 entries with backslash escapes in css. 0 malformed attribute selectors.

- [ ] **Step 4: Commit any output changes**

```bash
git status
```
If output files changed, commit them.

---

## Self-Review

1. **Spec coverage:**
   - `toSafeCssSelector()` → Task 1 Step 1 ✓
   - `sanitizeSelector()` → Task 1 Step 2 ✓
   - Integration into `serializeRule()` → Task 1 Step 3 ✓
   - Integration into `walkRule()` → Task 1 Steps 4a-4c ✓
   - Tests → Task 2 ✓
   - E2E verification → Task 3 ✓

2. **Placeholder scan:** No TBD, TODO, or vague references. All code is complete.

3. **Type consistency:** `sanitizeSelector()` and `toSafeCssSelector()` both take and return `string`. Integration points use existing variable names (`baseSelector`, `selector`). No new types introduced.
