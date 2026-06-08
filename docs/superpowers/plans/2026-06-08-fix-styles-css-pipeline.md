# Fix styles.css Pipeline Gaps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure `styles.css` output from project-mode conversion covers all classes used across all pages, including custom CSS defined in source `<style>` blocks.

**Architecture:** The pipeline has two Tailwind compilation paths: a CDN-based inliner (Playwright, per-page) and an offline CLI compiler (project mode, multi-page). Project mode was recently implemented but has a critical bug: simple class CSS definitions from `<head>` `<style>` blocks are captured in `classNameToProperties` for GenerateBlocks globalClasses but never written to the CSS file. Additionally, some source config issues and custom class gaps cause ~30% of HTML classes to lack CSS coverage.

**Tech Stack:** TypeScript, cheerio, Tailwind CSS v3.4 CLI, Node.js fs

---

### Task 1: Output simple class CSS rules to customCss

**Files:**
- Modify: `src/core/preprocessor.ts` — `scanHeadStyles()` and `preprocess()`

**Context:** The `scanHeadStyles()` function splits `<head>` `<style>` block rules into two buckets: simple classes (no combinators/pseudo) → `classNameToProperties`, everything else → `customCss`. In single-page CDN mode, all style rules were also captured by Playwright and written to styles.css. But in project mode (`skipInliner: true`), only `customCss` gets written — so simple classes like `.clip-hex`, `.blueprint-bg`, `.blueprint-bg-dark`, `.ruler-x` are stripped from the output CSS.

**Fix:** Also emit simple class CSS to `customCss` (or a separate field that gets merged). Keep them in `classNameToProperties` too — GB globalClasses references need the property mapping.

- [ ] **Step 1: Write the failing test**

Create `tests/preprocessor-custom-css.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { preprocess } from "../src/core/preprocessor.js";

describe("preprocess customCss output", () => {
  it("includes simple class CSS rules in customCss", () => {
    const html = `<!DOCTYPE html><html><head>
      <style>
        body { background: #fff; }
        .clip-hex { clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
        .blueprint-bg { background-size: 40px 40px; background-image: linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px); }
        .hover-shadow-md:hover { box-shadow: 0 0 0 1px rgba(0,0,0,0.06); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      </style>
    </head><body><div class="clip-hex">test</div></body></html>`;

    const result = preprocess(html);

    // Simple class CSS should appear in customCss
    assert.ok(result.customCss.includes("clip-hex"), "clip-hex should be in customCss");
    assert.ok(result.customCss.includes("blueprint-bg"), "blueprint-bg should be in customCss");

    // Pseudo-class rules should still be in customCss
    assert.ok(result.customCss.includes("hover-shadow-md"), "hover-shadow-md should be in customCss");
    assert.ok(result.customCss.includes("no-scrollbar"), "no-scrollbar should be in customCss");

    // Non-class rules should still be in customCss
    assert.ok(result.customCss.includes("body"), "body rule should be in customCss");

    // Simple classes should ALSO be in classNameToProperties for GB globalClasses
    assert.ok(result.classNameToProperties.has("clip-hex"), "clip-hex should be in classNameToProperties");
  });

  it("does not duplicate customCss entries", () => {
    const html = `<!DOCTYPE html><html><head>
      <style>
        .simple { color: red; }
      </style>
    </head><body></body></html>`;

    const result = preprocess(html);
    const occurrences = (result.customCss.match(/\.simple/g) || []).length;
    assert.strictEqual(occurrences, 1, ".simple should appear exactly once in customCss");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/preprocessor-custom-css.test.ts
```
Expected: FAIL — `clip-hex should be in customCss` assertion fails.

- [ ] **Step 3: Fix scanHeadStyles() to emit simple classes to customCss**

In `src/core/preprocessor.ts`, modify `scanHeadStyles()`:

```typescript
function scanHeadStyles($: cheerio.CheerioAPI): {
  classNameToProperties: Map<string, BlockStyles>;
  customCss: string;
} {
  const classNameToProperties = new Map<string, BlockStyles>();
  const customCssParts: string[] = [];

  $("head style").each((_, el) => {
    const cssText = $(el).text().trim();
    if (!cssText) return;

    const rules = cssText.split("}").filter((r) => r.trim());
    for (const rule of rules) {
      const braceIdx = rule.indexOf("{");
      if (braceIdx === -1) continue;
      const selector = rule.substring(0, braceIdx).trim();
      const properties = rule.substring(braceIdx + 1).trim();
      if (!selector || !properties) continue;

      const simpleClassMatch = selector.match(/^\.([a-zA-Z_-][\w-]*)$/);
      if (simpleClassMatch && isCssCompatible(selector, properties)) {
        const className = simpleClassMatch[1];
        const fakeStyle = properties.replace(/;+/g, ";");
        const parsed = parseStyleString(fakeStyle);
        if (Object.keys(parsed.styles).length > 0 || parsed.css) {
          classNameToProperties.set(className, parsed.styles);
        }
        // ALSO emit as CSS rule so it lands in styles.css
        customCssParts.push(`${selector}{${properties}}`);
      } else {
        customCssParts.push(`${selector}{${properties}}`);
      }
    }
  });

  return {
    classNameToProperties,
    customCss: customCssParts.join("\n"),
  };
}
```

The only change: add `customCssParts.push(...)` inside the `if (simpleClassMatch && ...)` branch.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/preprocessor-custom-css.test.ts
```
Expected: PASS

- [ ] **Step 5: Run existing tests to check for regressions**

```bash
npx tsx --test tests/*.test.ts 2>/dev/null || echo "No existing test runner configured — verify with: npx tsx src/cli/index.ts fixtures:run-all"
```

- [ ] **Step 6: Commit**

```bash
git add src/core/preprocessor.ts tests/preprocessor-custom-css.test.ts
git commit -m "fix(preprocessor): emit simple class CSS to customCss so it reaches styles.css in project mode"
```

---

### Task 2: Re-run mino project conversion with project mode

**Files:**
- None modified (this is a command execution)

**Context:** The current `output/mino/styles.css` was generated before project mode existed. Project mode is already implemented in `src/cli/index.ts` (the `if (statSync(fullPath).isDirectory())` branch). We need to re-convert to get the fixed `styles.css`.

- [ ] **Step 1: Verify inputs exist and are clean**

```bash
ls /home/ivanoung/projects/gb-converter/inputs/mino/*.html
```

- [ ] **Step 2: Remove old output**

```bash
rm -rf /home/ivanoung/projects/gb-converter/output/mino
```

- [ ] **Step 3: Run project-mode conversion**

```bash
cd /home/ivanoung/projects/gb-converter && npx tsx src/cli/index.ts convert inputs/mino/
```

Expected: Compiles Tailwind CSS from all 10 pages via CLI, then converts each page. Output should show coverage for all pages.

- [ ] **Step 4: Verify styles.css size and coverage**

```bash
wc -l /home/ivanoung/projects/gb-converter/output/mino/styles.css
python3 << 'PYEOF'
import re, os

minodir = "/home/ivanoung/projects/gb-converter/output/mino"

# Read CSS classes
with open(f"{minodir}/styles.css") as f:
    css = f.read()
css_classes = set()
for m in re.finditer(r'\.([a-zA-Z0-9_\\\/\[\]\-\.:,]+)\s*\{', css):
    name = m.group(1).replace('\\:', ':').replace('\\[', '[').replace('\\]', ']').replace('\\/', '/').replace('\\.', '.')
    if not name.startswith('--tw-'):
        css_classes.add(name)

# Per-page coverage
for fn in sorted(os.listdir(minodir)):
    if fn.endswith('.html'):
        with open(f"{minodir}/{fn}") as f:
            html = f.read()
        page_classes = set()
        for m in re.finditer(r'class="([^"]*)"', html):
            page_classes.update(m.group(1).split())
        covered = page_classes & css_classes
        pct = 100 * len(covered) / len(page_classes) if page_classes else 0
        print(f"  {fn:30s}  total: {len(page_classes):4d}  covered: {len(covered):4d}  coverage: {pct:.0f}%")

PYEOF
```

Expected: Coverage should be significantly higher than before (previously 70-91%, should be closer to 90-98%). Lower coverage only for classes that truly have no definition (like `gb-element`, `gb-text`, `gb-media` which are WordPress plugin classes).

- [ ] **Step 5: Check custom classes are present**

```bash
echo "=== Checking custom classes in new styles.css ==="
for cls in "clip-hex" "blueprint-bg" "blueprint-bg-dark" "ruler-x" "hover-shadow-md" "no-scrollbar"; do
  count=$(grep -c "$cls" /home/ivanoung/projects/gb-converter/output/mino/styles.css 2>/dev/null)
  echo "  $cls: $count occurrence(s)"
done
```

Expected: All should have ≥1 occurrence.

- [ ] **Step 6: Commit the regenerated output**

```bash
git add output/mino/
git commit -m "chore: regenerate mino output with project-mode + customCss fix"
```

---

### Task 3: Strip Tailwind v4 CSS variable reset from output

**Files:**
- Modify: `src/core/tailwind-resolver.ts` — or the orchestrator where CSS is written

**Context:** The CDN-based inliner captures Tailwind v4's `--tw-*` CSS variable reset (110 lines) from the CDN script. The offline CLI compiler (`tailwindcss@3`) should NOT produce these, but let's verify and add a safety filter.

- [ ] **Step 1: Check if offline compiler produces v4 reset**

```bash
grep -c "\-\-tw-" /home/ivanoung/projects/gb-converter/output/mino/styles.css
```

Expected: 0 (offline v3 compiler shouldn't produce v4 vars). If >0, we need the filter below.

- [ ] **Step 2: (Conditional) Add v4 reset filter to styles.css writer**

If Step 1 showed v4 variables present, add a filter in `src/cli/index.ts` in the project-mode section after `inlinerCss` is set:

```typescript
// Strip vestigial Tailwind v4 CSS variable reset
inlinerCss = inlinerCss
  .replace(/^\s*\*,\s*:after,\s*:before\s*\{[^}]*--tw-[^}]*\}[\s\n]*/g, "")
  .replace(/^\s*::backdrop\s*\{[^}]*--tw-[^}]*\}[\s\n]*/g, "")
  .replace(/\/\*!\s*tailwindcss\s*v4[^*]*\*\/[\s\n]*/g, "");
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "fix: strip Tailwind v4 CSS variable reset from output"
```

---

### Task 4: Add warning for missing slate color shades

**Files:**
- Modify: `src/core/tailwind-resolver.ts`

**Context:** The source tailwind config defines `slate: "#334155"` as a single hex value. Pages reference shade variants like `bg-slate-100`, `text-slate-400`, `border-slate-200`, etc. Tailwind v3 JIT compiler won't generate these because `slate` isn't an object with shade keys. The classes remain in the HTML but have no CSS rules — they render with browser defaults.

This is fundamentally a source config issue, so we add a warning rather than silently missing them.

- [ ] **Step 1: Add config validation to tailwind-resolver.ts**

In `src/core/tailwind-resolver.ts`, add a new exported function:

```typescript
export interface ConfigWarning {
  type: "single_color_no_shades";
  color: string;
  missingClasses: string[];
}

/**
 * Check a tailwind config object for patterns known to cause missing CSS.
 * Returns warnings for colors defined as single hex values where the HTML
 * uses shade variants (e.g., slate: "#334155" but HTML has bg-slate-100).
 */
export function validateTailwindConfig(
  configJson: string,
  allClassNames: string[],
): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  try {
    const config = JSON.parse(configJson);
    const colors = config?.theme?.extend?.colors;
    if (!colors || typeof colors !== "object") return warnings;

    for (const [colorName, colorValue] of Object.entries(colors)) {
      // Only flag single-value colors (not shade objects)
      if (typeof colorValue !== "string") continue;

      // Check if any HTML class references a shade variant of this color
      const shadePattern = new RegExp(
        `(?:bg|text|border|ring|outline|placeholder|caret|accent|fill|stroke|shadow|decoration|divide|from|via|to)-${colorName}-\\d+`,
      );
      const missing = allClassNames.filter((c) => shadePattern.test(c));

      if (missing.length > 0) {
        warnings.push({
          type: "single_color_no_shades",
          color: colorName,
          missingClasses: [...new Set(missing)].slice(0, 20), // cap at 20
        });
      }
    }
  } catch {
    // Config parse error — skip validation
  }

  return warnings;
}
```

- [ ] **Step 2: Wire the warning into project-mode CLI**

In `src/cli/index.ts`, in the project-mode section after collecting page contents, add:

```typescript
// Validate config for known patterns
if (tailwindConfig) {
  const allClasses = new Set<string>();
  for (const pc of pageContents) {
    const classMatches = pc.html.match(/class="([^"]*)"/g) || [];
    for (const m of classMatches) {
      m.replace(/class="([^"]*)"/, "$1").split(/\s+/).forEach(c => allClasses.add(c));
    }
  }
  const configWarnings = validateTailwindConfig(tailwindConfig, [...allClasses]);
  for (const w of configWarnings) {
    if (w.type === "single_color_no_shades") {
      console.log(`    [WARN] Color "${w.color}" is a single hex value but ${w.missingClasses.length} shade variant classes are used (e.g., ${w.missingClasses.slice(0, 3).join(", ")})`);
      console.log(`           → Define "${w.color}" as an object with shades (50-950) instead of a single hex value`);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/tailwind-resolver.ts src/cli/index.ts
git commit -m "feat: warn when single-value tailwind colors have missing shade variants"
```

---

### Task 5: Update MEMORY.md

**Files:**
- Modify: `MEMORY.md`

- [ ] **Step 1: Mark the planned item as done and add new notes**

Replace the "Planned: project-level Tailwind compilation" section in MEMORY.md:

```markdown
### ✅ Project-level Tailwind compilation (implemented 2026-06-08)

Project mode is implemented in CLI. Pass a directory to `convert`:
```
npx tsx src/cli/index.ts convert inputs/mino/
```
This concatenates all .html files, runs Tailwind v3 CLI once on the combined
content, writes one `styles.css`, then converts each page individually.

### ✅ Simple class CSS in styles.css (fixed 2026-06-08)

The preprocessor's `scanHeadStyles()` previously only captured simple class
definitions for `classNameToProperties` (GB globalClasses) but did NOT emit
their CSS to `customCss`. In project mode (skipInliner), this meant classes
like `.clip-hex`, `.blueprint-bg-dark` were silently dropped from styles.css.
Fixed by pushing simple class rules to `customCssParts` in addition to the
classNameToProperties map.

### Known limitation: single-value tailwind colors

The tailwind config sometimes defines colors as single hex values (e.g.,
`slate: "#334155"`). When the HTML uses shade variants like `bg-slate-100`,
Tailwind v3 JIT won't generate them. A config validation warning is emitted
in project mode. The fix is to define the color as an object with shades.
```

- [ ] **Step 2: Commit**

```bash
git add MEMORY.md
git commit -m "docs: update MEMORY.md for completed styles.css pipeline fixes"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Simple class CSS lost in project mode → Task 1
- ✅ Re-run mino conversion → Task 2
- ✅ Tailwind v4 reset bloat → Task 3
- ✅ Slate shade variants missing → Task 4 (warning, not auto-fix — source config issue)
- ✅ Documentation → Task 5

**2. Placeholder scan:** No TBDs, TODOs, or "add later" patterns.

**3. Type consistency:** `validateTailwindConfig` signature consistent between definition and call site.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-fix-styles-css-pipeline.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
