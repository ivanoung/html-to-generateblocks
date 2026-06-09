# Property-Based CSS Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `css-splitter.ts` to classify CSS rules by their declaration properties (structural + typography → Global Styles; backgrounds, effects, colors → styles-unique.css) instead of by selector pattern, enabling editor preview fidelity.

**Architecture:** Two hardcoded property sets (`GS_ELIGIBLE_PROPERTIES`, `UC_ONLY_PROPERTIES`) drive classification. Each CSS rule's declarations are inspected; if any property is UC-only, the entire rule goes to `styles-unique.css`. `@media` blocks are recursed into so responsive classes get individual classification with their media query wrapper preserved. Unrecognized properties default to UC as a safety net.

**Tech Stack:** TypeScript, `css` npm package (v3.0.0), Node.js built-in test runner (`node:test` + `node:assert`)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/core/types.ts` | Modify | Add `GS_ELIGIBLE_PROPERTIES` and `UC_ONLY_PROPERTIES` constants |
| `src/core/css-splitter.ts` | Rewrite | Property-based classification, @media recursion, fallback handling |
| `tests/css-splitter.test.ts` | Rewrite | All tests updated for new classification behavior |

---

## Property Sets

The two sets are the authoritative classification. Any property not in either set defaults to UC.

### GS_ELIGIBLE_PROPERTIES (exhaustive list)

```
display, flex-direction, flex-wrap, align-items, align-content, align-self,
justify-content, justify-items, justify-self, gap, column-gap, row-gap,
place-items, place-content, place-self, position, z-index,
overflow, overflow-x, overflow-y, visibility,
width, height, min-width, max-width, min-height, max-height, aspect-ratio,
flex, flex-grow, flex-shrink, flex-basis, order,
grid-template-columns, grid-template-rows, grid-column, grid-row, grid-area,
grid-auto-columns, grid-auto-rows, grid-auto-flow,
padding, padding-top, padding-right, padding-bottom, padding-left,
margin, margin-top, margin-right, margin-bottom, margin-left,
box-sizing,
border, border-top, border-right, border-bottom, border-left,
border-width, border-top-width, border-right-width, border-bottom-width, border-left-width,
border-style, border-top-style, border-right-style, border-bottom-style, border-left-style,
border-radius, border-top-left-radius, border-top-right-radius,
border-bottom-left-radius, border-bottom-right-radius,
top, right, bottom, left, inset, inset-block, inset-inline,
float, clear,
object-fit, object-position,
font-family, font-size, font-weight, font-style, font-variant,
line-height, letter-spacing, word-spacing,
text-align, text-align-last, text-transform, text-decoration, text-decoration-line,
text-indent, white-space, word-break, overflow-wrap, vertical-align,
direction, writing-mode,
color,
container-type, container-name,
outline, outline-width, outline-style, outline-offset
```

### UC_ONLY_PROPERTIES (exhaustive list)

```
background-color, background, background-image, background-size,
background-position, background-position-x, background-position-y,
background-repeat, background-attachment, background-clip, background-origin,
background-blend-mode,
transform, transform-origin, transform-style,
filter, backdrop-filter, opacity,
box-shadow, text-shadow, mix-blend-mode, clip-path,
mask, mask-image, mask-size, mask-position, mask-repeat, mask-composite, mask-mode,
transition, transition-delay, transition-duration, transition-property,
transition-timing-function, transition-behavior,
animation, animation-name, animation-duration, animation-timing-function,
animation-delay, animation-iteration-count, animation-direction,
animation-fill-mode, animation-play-state,
cursor, pointer-events, user-select,
scroll-behavior, scroll-snap-type, scroll-snap-align,
resize, touch-action,
will-change, perspective, perspective-origin, backface-visibility,
border-color, border-top-color, border-right-color, border-bottom-color, border-left-color,
outline-color, accent-color, caret-color, text-decoration-color, column-rule-color,
content, isolation
```

---

### Task 1: Add property constants to types.ts

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add property set constants**

Add after the existing `GlobalStylesPayload` type (end of file):

```typescript
/** CSS properties that qualify a rule for Global Styles (when all declarations are GS-eligible). */
export const GS_ELIGIBLE_PROPERTIES: ReadonlySet<string> = new Set([
  "display",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "gap",
  "column-gap",
  "row-gap",
  "place-items",
  "place-content",
  "place-self",
  "position",
  "z-index",
  "overflow",
  "overflow-x",
  "overflow-y",
  "visibility",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "aspect-ratio",
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "grid-area",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-auto-flow",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "box-sizing",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-inline",
  "float",
  "clear",
  "object-fit",
  "object-position",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-align-last",
  "text-transform",
  "text-decoration",
  "text-decoration-line",
  "text-indent",
  "white-space",
  "word-break",
  "overflow-wrap",
  "vertical-align",
  "direction",
  "writing-mode",
  "color",
  "container-type",
  "container-name",
  "outline",
  "outline-width",
  "outline-style",
  "outline-offset",
]);

/** CSS properties that force a rule into styles-unique.css (if ANY declaration uses one). */
export const UC_ONLY_PROPERTIES: ReadonlySet<string> = new Set([
  "background-color",
  "background",
  "background-image",
  "background-size",
  "background-position",
  "background-position-x",
  "background-position-y",
  "background-repeat",
  "background-attachment",
  "background-clip",
  "background-origin",
  "background-blend-mode",
  "transform",
  "transform-origin",
  "transform-style",
  "filter",
  "backdrop-filter",
  "opacity",
  "box-shadow",
  "text-shadow",
  "mix-blend-mode",
  "clip-path",
  "mask",
  "mask-image",
  "mask-size",
  "mask-position",
  "mask-repeat",
  "mask-composite",
  "mask-mode",
  "transition",
  "transition-delay",
  "transition-duration",
  "transition-property",
  "transition-timing-function",
  "transition-behavior",
  "animation",
  "animation-name",
  "animation-duration",
  "animation-timing-function",
  "animation-delay",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-play-state",
  "cursor",
  "pointer-events",
  "user-select",
  "scroll-behavior",
  "scroll-snap-type",
  "scroll-snap-align",
  "resize",
  "touch-action",
  "will-change",
  "perspective",
  "perspective-origin",
  "backface-visibility",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "accent-color",
  "caret-color",
  "text-decoration-color",
  "column-rule-color",
  "content",
  "isolation",
]);
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit src/core/types.ts
```
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: add GS_ELIGIBLE_PROPERTIES and UC_ONLY_PROPERTIES constants"
```

---

### Task 2: Rewrite css-splitter.ts with property-based classification

**Files:**
- Modify: `src/core/css-splitter.ts`

This is a complete rewrite. The existing helper functions (`isSingleClassSelector`, `extractBaseSelector`, `getClassName`, `classNameToName`, `serializeRule`) are preserved. The core logic (`walkRule`, `splitCss`) is replaced.

- [ ] **Step 1: Write the complete new css-splitter.ts**

Replace the entire file content:

```typescript
// ── CSS Splitter ───────────────────────────────────────────
//
// Parses compiled CSS and splits into:
// - globalStyles: structural + typography class rules (editor preview fidelity)
// - uniqueCss: backgrounds, effects, colors, preflight, element selectors, keyframes
//
// Classification is property-based. Any rule with a UC-only property
// goes entirely to uniqueCss. Rules with only GS-eligible properties
// and a single-class selector become Global Style entries.
// @media blocks are recursed into so responsive variants get
// individual classification with their media wrapper preserved.
// Unrecognized properties default to UC (safe fallback).

import css from "css";
import { GS_ELIGIBLE_PROPERTIES, UC_ONLY_PROPERTIES } from "./types.js";

export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}

export interface CssSplitResult {
  globalStyles: GlobalStyleEntry[];
  uniqueCss: string;
}

// ── Selector helpers (unchanged from original) ──────────────

/**
 * Check if a CSS selector is a single class selector.
 * Matches: .foo, .foo\:bar, .foo\:bar:hover
 * Does NOT match: tag selectors, pseudo-elements (::), multi-selectors (a,b),
 *   combinators (a b, a>b, a+b, a~b)
 */
function isSingleClassSelector(selector: string): boolean {
  if (/::/.test(selector)) return false;

  const withoutPseudo = selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");

  const unescaped = withoutPseudo
    .replace(/\\:/g, ":")
    .replace(/\\\//g, "/")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\\#/g, "#")
    .replace(/\\\./g, ".");

  if (/[,\s>+~]/.test(unescaped)) return false;

  return /^\.[^,\s>+~]+$/.test(withoutPseudo) && !withoutPseudo.includes("::");
}

/**
 * Extract the base class name (without pseudo-classes).
 */
function extractBaseSelector(selector: string): string {
  return selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");
}

/**
 * Get the unescaped class name (no dot, no escapes).
 */
function getClassName(selector: string): string {
  const base = extractBaseSelector(selector);
  return base
    .replace(/^\./, "")
    .replace(/\\(.)/g, "$1");
}

/**
 * Convert a kebab-case class name to Title Case.
 */
function classNameToName(className: string): string {
  const clean = className.replace(/^\./, "").replace(/(:[a-zA-Z-]+)+$/, "");
  return clean
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── CSS serialization ───────────────────────────────────────

/**
 * Serialize a CSS rule AST node back to a CSS string.
 */
function serializeRule(rule: css.Rule | css.Media): string {
  if (rule.type === "media") {
    const media = rule as css.Media;
    const innerCss = (media.rules || [])
      .map((r) => serializeRule(r as css.Rule))
      .join("");
    return `@media ${media.media}{${innerCss}}`;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selector = (r.selectors || []).join(",");
    const declarations = (r.declarations || [])
      .map((d) => `${d.property}:${d.value}`)
      .join(";");
    return `${selector}{${declarations}${declarations ? ";" : ""}}`;
  }

  if (rule.type === "keyframes") {
    const kf = rule as css.KeyFrames;
    const keyframesCss = (kf.keyframes || [])
      .map((k) => {
        const decs = (k.declarations || [])
          .map((d) => `${d.property}:${d.value}`)
          .join(";");
        return `${k.values.join(",")}{${decs}${decs ? ";" : ""}}`;
      })
      .join("");
    return `@keyframes ${kf.name}{${keyframesCss}}`;
  }

  return "";
}

// ── Property classification ─────────────────────────────────

/**
 * Classify a rule's declarations. Returns "uc" if ANY declaration
 * has a UC-only property or an unrecognized property. Returns "gs"
 * only if ALL properties are in the GS-eligible set.
 */
function classifyDeclarations(declarations: css.Declaration[]): "gs" | "uc" {
  for (const decl of declarations) {
    if (!decl.property) continue;
    const prop = decl.property.toLowerCase().trim();

    if (UC_ONLY_PROPERTIES.has(prop)) return "uc";
    if (GS_ELIGIBLE_PROPERTIES.has(prop)) continue;

    // Unrecognized property → safe fallback to UC
    return "uc";
  }
  return "gs";
}

// ── Rule walking ────────────────────────────────────────────

/**
 * Walk a CSS rule and classify it.
 *
 * Logic:
 * - Pseudo-elements (::) → UC regardless of properties
 * - @media blocks → recurse into children, classify each individually
 * - Custom class name (from <style> blocks) + single class → GS (priority bypass)
 * - All declarations GS-eligible + single class selector → GS
 * - Everything else → UC
 */
function walkRule(
  rule: css.Rule | css.Media,
  globalStyles: GlobalStyleEntry[],
  uniqueCssParts: string[],
  customClassNames: Set<string>,
): void {
  if (rule.type === "media") {
    // Recurse into @media children. Each child is classified individually.
    // GS-eligible children get the @media wrapper in their css field.
    // UC children get the @media wrapper in uniqueCssParts.
    const media = rule as css.Media;
    const children = media.rules || [];

    const gsChildren: css.Rule[] = [];
    const ucChildren: css.Rule[] = [];

    for (const child of children) {
      if (child.type === "rule") {
        const r = child as css.Rule;

        // Pseudo-elements always UC
        if ((r.selectors || []).some((s) => s.includes("::"))) {
          ucChildren.push(r);
          continue;
        }

        const classification = classifyDeclarations(
          (r.declarations || []) as css.Declaration[],
        );

        if (classification === "gs") {
          gsChildren.push(r);
        } else {
          ucChildren.push(r);
        }
      } else {
        // Nested @media, keyframes, etc. → serialize and treat as UC
        ucChildren.push(child as css.Rule);
      }
    }

    // Serialize UC children with @media wrapper
    if (ucChildren.length > 0) {
      const wrappedMedia: css.Media = { ...media, rules: ucChildren };
      uniqueCssParts.push(serializeRule(wrappedMedia));
    }

    // Create GS entries for GS children with @media wrapper
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
      } else {
        // Multi-selector or non-class inside @media → UC
        const wrappedMedia: css.Media = { ...media, rules: [child] };
        uniqueCssParts.push(serializeRule(wrappedMedia));
      }
    }
    return;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selectors = r.selectors || [];

    // Pseudo-elements always UC
    if (selectors.some((s) => s.includes("::"))) {
      uniqueCssParts.push(serializeRule(r));
      return;
    }

    // Custom class names from <style> blocks get priority — skip property check
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

    // Property-based classification
    const classification = classifyDeclarations(
      (r.declarations || []) as css.Declaration[],
    );

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
    } else {
      uniqueCssParts.push(serializeRule(r));
    }
    return;
  }

  // Other types: keyframes, font-face, charset, etc. — always unique
  uniqueCssParts.push(serializeRule(rule));
}

// ── Main entry point ────────────────────────────────────────

/**
 * Split compiled CSS into globalStyles (structural + typography classes)
 * and uniqueCss (backgrounds, effects, colors, preflight, keyframes, etc.).
 *
 * @param compiledCss     The full compiled CSS
 * @param customClassNames Set of unescaped class names (no dot) that are
 *                         custom design tokens from source <style> blocks.
 *                         These bypass property checks and always go to GS
 *                         if they are a single class selector.
 */
export function splitCss(
  compiledCss: string,
  customClassNames?: Set<string>,
): CssSplitResult {
  const globalStyles: GlobalStyleEntry[] = [];
  const uniqueCssParts: string[] = [];
  const customSet = customClassNames ?? new Set<string>();

  if (!compiledCss.trim()) {
    return { globalStyles: [], uniqueCss: "" };
  }

  try {
    const ast = css.parse(compiledCss, { silent: true });
    const rules = ast.stylesheet?.rules || [];

    for (const rule of rules) {
      walkRule(rule as css.Rule | css.Media, globalStyles, uniqueCssParts, customSet);
    }
  } catch {
    return { globalStyles: [], uniqueCss: compiledCss };
  }

  // Deduplicate: merge entries with the same selector
  const merged = new Map<string, GlobalStyleEntry>();
  for (const entry of globalStyles) {
    const existing = merged.get(entry.selector);
    if (existing) {
      existing.css += entry.css;
    } else {
      merged.set(entry.selector, { ...entry });
    }
  }

  return {
    globalStyles: [...merged.values()],
    uniqueCss: uniqueCssParts.join(""),
  };
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit src/core/css-splitter.ts
```
Expected: exit 0, no errors. If there are type errors from the `css` package types, fix by adding type assertions where needed.

- [ ] **Step 3: Commit**

```bash
git add src/core/css-splitter.ts
git commit -m "feat: rewrite css-splitter with property-based classification"
```

---

### Task 3: Rewrite tests for new classification behavior

**Files:**
- Modify: `tests/css-splitter.test.ts`

The existing tests assume selector-pattern-based classification (custom classes → GS, utilities → UC). All tests must be rewritten for the new property-based behavior.

- [ ] **Step 1: Write the new test file**

Replace the entire file content:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { splitCss } from "../src/core/css-splitter.js";

describe("splitCss — property-based classification", () => {
  // ── GS-eligible: structural ────────────────────────────────

  it("structural: display → GS", () => {
    const css = ".flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".flex");
    assert.strictEqual(result.globalStyles[0].css, ".flex{display:flex}");
    assert.strictEqual(result.uniqueCss, "");
  });

  it("structural: sizing → GS", () => {
    const css = ".w-full{width:100%}.h-screen{height:100vh}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: spacing → GS", () => {
    const css = ".pt-32{padding-top:8rem}.m-4{margin:1rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: flex/grid → GS", () => {
    const css = ".flex-col{flex-direction:column}.grid-cols-2{grid-template-columns:repeat(2,1fr)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: borders → GS", () => {
    const css = ".rounded-lg{border-radius:0.5rem}.border{border-width:1px;border-style:solid}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: positioning → GS", () => {
    const css = ".absolute{position:absolute}.top-0{top:0}.z-10{z-index:10}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 3);
  });

  // ── GS-eligible: typography ────────────────────────────────

  it("typography → GS", () => {
    const css = ".text-lg{font-size:1.125rem;line-height:1.75rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".text-lg");
  });

  it("text color → GS", () => {
    const css = ".text-primary{color:var(--primary)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".text-primary");
  });

  // ── UC-only: background-color ──────────────────────────────

  it("background-color → UC", () => {
    const css = ".bg-primary{background-color:var(--primary)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("bg-primary"));
  });

  it("background shorthand → UC", () => {
    const css = ".bg-white{background:#fff}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("bg-white"));
  });

  // ── UC-only: backgrounds ───────────────────────────────────

  it("background-image → UC", () => {
    const css = ".bg-gradient-to-r{background-image:linear-gradient(to right,red,blue)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("bg-gradient-to-r"));
  });

  // ── UC-only: effects ───────────────────────────────────────

  it("effects → UC", () => {
    const css = ".shadow{box-shadow:0 1px 3px rgba(0,0,0,0.1)}.opacity-50{opacity:0.5}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("shadow"));
    assert.ok(result.uniqueCss.includes("opacity-50"));
  });

  it("transforms → UC", () => {
    const css = ".rotate-45{transform:rotate(45deg)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("rotate-45"));
  });

  // ── UC-only: transitions & animations ──────────────────────

  it("transitions → UC", () => {
    const css = ".transition{transition:0.3s}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("transition"));
  });

  it("animations → UC", () => {
    const css = ".animate-spin{animation:spin 1s linear infinite}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("animate-spin"));
  });

  // ── Mixed properties (any UC → entire rule to UC) ──────────

  it("mixed: structural + transition → UC", () => {
    const css = ".btn{padding:1rem;transition:0.3s}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("btn"));
  });

  it("mixed: typography + box-shadow → UC", () => {
    const css = ".card{font-size:1rem;padding:1rem;box-shadow:0 2px 4px rgba(0,0,0,0.1)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("card"));
  });

  // ── @media (responsive) handling ───────────────────────────

  it("responsive structural → GS with @media wrapper", () => {
    const css = "@media(min-width:768px){.md\\:flex{display:flex}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md\\:flex");
    assert.ok(result.globalStyles[0].css.includes("@media"));
    assert.ok(result.globalStyles[0].css.includes("display:flex"));
  });

  it("responsive typography → GS with @media wrapper", () => {
    const css = "@media(min-width:768px){.md\\:text-7xl{font-size:4.5rem;line-height:1}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md\\:text-7xl");
    assert.ok(result.globalStyles[0].css.includes("@media"));
  });

  it("responsive background-color stays in UC", () => {
    const css = "@media(min-width:768px){.md\\:bg-primary{background-color:var(--primary)}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("@media"));
    assert.ok(result.uniqueCss.includes("md\\:bg-primary"));
  });

  it("mixed @media children: GS + UC coexist", () => {
    const css = "@media(min-width:768px){.md\\:flex{display:flex}.md\\:shadow{box-shadow:0 2px 4px rgba(0,0,0,0.1)}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md\\:flex");
    assert.ok(result.uniqueCss.includes("md\\:shadow"));
  });

  // ── Non-class selectors ────────────────────────────────────

  it("element selector → UC", () => {
    const css = "body{margin:0}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("body"));
  });

  it("multi-selector → UC", () => {
    const css = "h1,h2,h3{font-weight:bold}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("h1,h2,h3"));
  });

  it("pseudo-element → UC (even with GS properties)", () => {
    const css = ".foo::before{display:block;content:\"\"}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("foo"));
  });

  it("combinator (descendant) → UC", () => {
    const css = ".group:hover .group-hover\\:flex{display:flex}";
    const result = splitCss(css);
    // Even though display:flex is GS-eligible, the selector has a combinator
    // which fails isSingleClassSelector → UC
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("group-hover"));
  });

  // ── Keyframes ──────────────────────────────────────────────

  it("keyframes → UC", () => {
    const css = "@keyframes spin{to{transform:rotate(360deg)}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("@keyframes"));
  });

  // ── Preflight ──────────────────────────────────────────────

  it("preflight reset → UC", () => {
    const css = "*,::after,::before{box-sizing:border-box}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("box-sizing"));
  });

  // ── Custom class priority ──────────────────────────────────

  it("custom class bypasses property check → GS", () => {
    // .blueprint-bg has background shorthand which is UC-only,
    // but it's a custom design token from <style> blocks → GS
    const css = ".blueprint-bg{background:#0a0a0a}";
    const custom = new Set(["blueprint-bg"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".blueprint-bg");
  });

  it("custom class with UC-only but still goes to GS", () => {
    const css = ".custom-glow{box-shadow:0 0 10px blue}";
    const custom = new Set(["custom-glow"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".custom-glow");
  });

  // ── Fallback: unclassified properties ──────────────────────

  it("unclassified property → UC (safe fallback)", () => {
    // scroll-margin-top is not in either set
    const css = ".snap-start{scroll-margin-top:1rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("snap-start"));
  });

  // ── Edge cases ─────────────────────────────────────────────

  it("empty input → empty results", () => {
    const result = splitCss("");
    assert.strictEqual(result.globalStyles.length, 0);
    assert.strictEqual(result.uniqueCss, "");
  });

  it("malformed CSS → returns empty globalStyles, original as uniqueCss", () => {
    const result = splitCss("not valid css {{{");
    assert.strictEqual(result.globalStyles.length, 0);
  });

  it("deduplicates entries with the same selector", () => {
    const css = ".my-class{display:flex}.my-class{width:100%}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".my-class");
    assert.ok(result.globalStyles[0].css.includes("display:flex"));
    assert.ok(result.globalStyles[0].css.includes("width:100%"));
  });

  it("generates Title Case names from class names", () => {
    const css = ".pt-32{padding-top:8rem}.md\\:text-7xl{font-size:4.5rem}";
    const result = splitCss(css);
    const names = result.globalStyles.map((s) => s.name);
    assert.ok(names.includes("Pt 32"));
    assert.ok(names.includes("Md Text 7xl"));
  });
});
```

- [ ] **Step 2: Run the tests and verify they pass**

```bash
node --import tsx --test tests/css-splitter.test.ts
```
Expected: all tests pass (exit 0).

If any tests fail, fix the implementation in `css-splitter.ts` before proceeding.

- [ ] **Step 3: Commit**

```bash
git add tests/css-splitter.test.ts
git commit -m "test: rewrite css-splitter tests for property-based classification"
```

---

### Task 4: Run existing fixture tests and full project conversion

**Files:** None modified. Verification only.

- [ ] **Step 1: Run fixture tests**

```bash
npx tsx src/runner/run-fixture.ts
```
Expected: all existing fixtures pass. Check for regressions in output.

- [ ] **Step 2: Run a full project conversion to verify output structure**

```bash
npx tsx src/cli/index.ts convert inputs/mino/
```
Expected: 
- `output/mino/setup/global-styles.json` now contains structural + typography classes (not just ~5 custom tokens)
- `output/mino/setup/styles-unique.css` contains backgrounds, effects, colors, preflight, keyframes
- `output/mino/pages/styles.css` is unchanged (master fallback)

- [ ] **Step 3: Spot-check global-styles.json content**

```bash
cat output/mino/setup/global-styles.json | head -50
```
Expected: entries like `.flex`, `.pt-32`, `.w-full`, `.text-lg`, `.md\:flex` with correct CSS.

- [ ] **Step 4: Spot-check styles-unique.css content**

```bash
cat output/mino/setup/styles-unique.css | head -50
```
Expected: preflight resets, element selectors, keyframes, background utilities, effect utilities. No structural/typography utilities.

- [ ] **Step 5: Commit any output changes (if outputs are tracked)**

```bash
git status
```
If fixtures/output has changes, commit them:
```bash
git add -A
git commit -m "test: update fixture outputs for property-based CSS split"
```

---

### Task 5: Update manual-steps.txt to document WPCodeBox load order

**Files:**
- Modify: `src/core/manual-steps.ts`

- [ ] **Step 1: Add WPCodeBox load order guidance**

In the `generateManualStepsReport()` function, add a section about CSS files and their required load order. Append after the existing output.

```typescript
// After the existing report content, add:

  parts.push("--- CSS LOAD ORDER ---");
  parts.push("");
  parts.push("For correct frontend specificity, load CSS in this order:");
  parts.push("");
  parts.push("1. styles-unique.css → WPCodeBox snippet, wp_head, priority 10");
  parts.push("   Contains: backgrounds, effects, colors, preflight, keyframes");
  parts.push("2. global-styles.json → Import via GB Pro > Global Styles > Import");
  parts.push("   Contains: structural layout + typography classes");
  parts.push("   WordPress loads these at priority 20 automatically");
  parts.push("3. styles.css → Keep as master fallback (paste into Additional CSS)");
  parts.push("");
```

- [ ] **Step 2: Verify the report generates correctly**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
cat output/mino/setup/manual-steps.txt | tail -15
```
Expected: CSS load order section appears at the end.

- [ ] **Step 3: Commit**

```bash
git add src/core/manual-steps.ts
git commit -m "docs: add WPCodeBox CSS load order guidance to manual-steps"
```

---

## Self-Review

1. **Spec coverage:**
   - Property constants → Task 1 ✓
   - Property-based classification → Task 2 ✓
   - @media recursion → Task 2 (walkRule) ✓
   - background shorthand → Task 2 (in UC_ONLY set) ✓
   - Fallback for unclassified → Task 2 (classifyDeclarations) + Task 3 (test) ✓
   - Custom class priority → Task 2 + Task 3 (test) ✓
   - Pseudo-element gate → Task 2 + Task 3 (test) ✓
   - Load order documentation → Task 5 ✓
   - Tests → Task 3 ✓
   - Fixture regression → Task 4 ✓

2. **Placeholder scan:** No TBD, TODO, or vague references. All code is complete.

3. **Type consistency:** `splitCss()` signature matches original (backward compatible). `GlobalStyleEntry` matches existing interface. Property sets are `ReadonlySet<string>` — `classifyDeclarations` uses `.has()`.
