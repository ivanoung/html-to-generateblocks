# Inline Style → GB Attribute Promotion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map inline `style="..."` properties (background-color, background-image, background-size/position/repeat/attachment, color, and gradients) from the flat `styles` object into GB's dedicated top-level attributes so they populate the editor UI panels.

**Architecture:** One new pure-function module (`gb-attribute-mapper.ts`) that extracts GB attributes from a `BlockStyles` object and returns promoted attributes + remaining styles. The serializer's `buildElementAttrs()` calls it before assembling block JSON. No changes to parsing, DOM walking, or CSS splitting.

**Tech Stack:** TypeScript + ESM, existing project conventions

---

### Task 1: Create the GB attribute mapper

**Files:**
- Create: `src/core/gb-attribute-mapper.ts`
- Create: `tests/gb-attribute-mapper.test.ts`

- [ ] **Step 1: Write the test file with all test cases**

```typescript
// tests/gb-attribute-mapper.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { mapStylesToGbAttributes } from "../src/core/gb-attribute-mapper.js";

describe("mapStylesToGbAttributes", () => {
  it("promotes backgroundColor to top-level attribute", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundColor: "#ffffff",
    });
    assert.strictEqual(gbAttrs.backgroundColor, "#ffffff");
    assert.strictEqual("backgroundColor" in remainingStyles, false);
  });

  it("promotes backgroundImage to bgImage + bgImageSize", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundImage: 'url("hero.jpg")',
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "hero.jpg" });
    assert.strictEqual(gbAttrs.bgImageSize, "full");
    assert.strictEqual("backgroundImage" in remainingStyles, false);
  });

  it("extracts URL from single-quoted backgroundImage", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: "url('image.png')",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "image.png" });
  });

  it("extracts URL from unquoted backgroundImage", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: "url(image.png)",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "image.png" });
  });

  it("promotes backgroundOptions to bgOptions with defaults", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    });
    assert.deepStrictEqual(gbAttrs.bgOptions, {
      selector: "element",
      opacity: 1,
      overlay: false,
      size: "cover",
      position: "center",
      repeat: "no-repeat",
    });
    assert.strictEqual("backgroundSize" in remainingStyles, false);
    assert.strictEqual("backgroundPosition" in remainingStyles, false);
    assert.strictEqual("backgroundRepeat" in remainingStyles, false);
  });

  it("promotes backgroundAttachment into bgOptions", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundAttachment: "fixed",
    });
    assert.deepStrictEqual(gbAttrs.bgOptions, {
      selector: "element",
      opacity: 1,
      overlay: false,
      attachment: "fixed",
    });
  });

  it("promotes color to textColor", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      color: "#111111",
    });
    assert.strictEqual(gbAttrs.textColor, "#111111");
    assert.strictEqual("color" in remainingStyles, false);
  });

  it("parses linear-gradient from background shorthand", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      background: "linear-gradient(135deg, #ffffff, #000000)",
    });
    assert.strictEqual(gbAttrs.gradient, true);
    assert.strictEqual(gbAttrs.gradientDirection, 135);
    assert.strictEqual(gbAttrs.gradientColorOne, "#ffffff");
    assert.strictEqual(gbAttrs.gradientColorTwo, "#000000");
    assert.strictEqual("background" in remainingStyles, false);
  });

  it("leaves spacing properties in remainingStyles", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundColor: "#fff",
      paddingTop: "64px",
      marginBottom: "24px",
    });
    assert.strictEqual(gbAttrs.backgroundColor, "#fff");
    assert.strictEqual(remainingStyles.paddingTop, "64px");
    assert.strictEqual(remainingStyles.marginBottom, "24px");
    assert.strictEqual("backgroundColor" in remainingStyles, false);
  });

  it("leaves layout properties in remainingStyles", () => {
    const { remainingStyles } = mapStylesToGbAttributes({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    });
    assert.strictEqual(remainingStyles.display, "flex");
    assert.strictEqual(remainingStyles.flexDirection, "column");
    assert.strictEqual(remainingStyles.alignItems, "center");
  });

  it("returns empty gbAttrs and empty remainingStyles for empty input", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({});
    assert.deepStrictEqual(gbAttrs, {});
    assert.deepStrictEqual(remainingStyles, {});
  });

  it("returns everything in remainingStyles when nothing is mappable", () => {
    const input = { paddingTop: "16px", display: "flex" };
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes(input);
    assert.deepStrictEqual(gbAttrs, {});
    assert.deepStrictEqual(remainingStyles, input);
  });

  it("leaves unparseable background-image URL in remainingStyles", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundImage: "not-a-url",
    });
    assert.strictEqual("bgImage" in gbAttrs, false);
    assert.strictEqual(remainingStyles.backgroundImage, "not-a-url");
  });

  it("leaves unparseable gradient in remainingStyles", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      background: "radial-gradient(circle, #fff, #000)",
    });
    assert.strictEqual("gradient" in gbAttrs, false);
    assert.strictEqual(remainingStyles.background, "radial-gradient(circle, #fff, #000)");
  });

  it("handles graceful fallback to url() URLs in background-image", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: "url(hero.jpg)",
      backgroundSize: "cover",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "hero.jpg" });
    assert.strictEqual(gbAttrs.bgImageSize, "full");
  });

  it("sets bgOptions only when at least one background option is present", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: 'url("bg.jpg")',
    });
    // bgImage is set but bgOptions is not — GB will use its own defaults
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "bg.jpg" });
    assert.strictEqual("bgOptions" in gbAttrs, false);
  });
  
  it("does not mutate the input object", () => {
    const input = { backgroundColor: "#fff", paddingTop: "64px" };
    const inputCopy = { ...input };
    mapStylesToGbAttributes(input);
    assert.deepStrictEqual(input, inputCopy);
  });
  
  it("handles all background properties together", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundImage: 'url("hero.jpg")',
      backgroundSize: "cover",
      backgroundPosition: "center center",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "scroll",
      paddingTop: "64px",
      display: "flex",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "hero.jpg" });
    assert.strictEqual(gbAttrs.bgImageSize, "full");
    assert.deepStrictEqual(gbAttrs.bgOptions, {
      selector: "element",
      opacity: 1,
      overlay: false,
      size: "cover",
      position: "center center",
      repeat: "no-repeat",
      attachment: "scroll",
    });
    assert.strictEqual(remainingStyles.paddingTop, "64px");
    assert.strictEqual(remainingStyles.display, "flex");
  });
});
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
npx tsx --test tests/gb-attribute-mapper.test.ts
```
Expected: All 17 tests FAIL with "Cannot find module '../src/core/gb-attribute-mapper.js'"

- [ ] **Step 3: Create the mapper module with the minimal implementation to pass all tests**

```typescript
// src/core/gb-attribute-mapper.ts
import type { BlockStyles } from "./types.js";

export interface GbAttributeMapping {
  gbAttrs: Record<string, unknown>;
  remainingStyles: BlockStyles;
}

/**
 * Extract GenerateBlocks top-level attributes from a flat styles object.
 * Promoted properties are removed from remainingStyles.
 * Unmappable properties stay in remainingStyles — no warnings, no errors.
 */
export function mapStylesToGbAttributes(styles: BlockStyles): GbAttributeMapping {
  const remaining: BlockStyles = { ...styles };
  const attrs: Record<string, unknown> = {};
  const bgOptions: Record<string, unknown> = {};

  // --- backgroundColor ---
  if ("backgroundColor" in remaining) {
    attrs.backgroundColor = remaining.backgroundColor;
    delete remaining.backgroundColor;
  }

  // --- backgroundImage → bgImage + bgImageSize ---
  if ("backgroundImage" in remaining) {
    const url = extractUrl(remaining.backgroundImage as string);
    if (url) {
      attrs.bgImage = { url };
      attrs.bgImageSize = "full";
    }
    delete remaining.backgroundImage;
  }

  // --- backgroundSize → bgOptions.size ---
  if ("backgroundSize" in remaining) {
    bgOptions.size = remaining.backgroundSize;
    delete remaining.backgroundSize;
  }

  // --- backgroundPosition → bgOptions.position ---
  if ("backgroundPosition" in remaining) {
    bgOptions.position = remaining.backgroundPosition;
    delete remaining.backgroundPosition;
  }

  // --- backgroundRepeat → bgOptions.repeat ---
  if ("backgroundRepeat" in remaining) {
    bgOptions.repeat = remaining.backgroundRepeat;
    delete remaining.backgroundRepeat;
  }

  // --- backgroundAttachment → bgOptions.attachment ---
  if ("backgroundAttachment" in remaining) {
    bgOptions.attachment = remaining.backgroundAttachment;
    delete remaining.backgroundAttachment;
  }

  // Set bgOptions with defaults only if at least one option was present
  if (Object.keys(bgOptions).length > 0) {
    attrs.bgOptions = {
      selector: "element",
      opacity: 1,
      overlay: false,
      ...bgOptions,
    };
  }

  // --- color → textColor ---
  if ("color" in remaining) {
    attrs.textColor = remaining.color;
    delete remaining.color;
  }

  // --- background (gradient shorthand) → gradient + colors ---
  if ("background" in remaining) {
    const gradient = parseGradient(remaining.background as string);
    if (gradient) {
      attrs.gradient = true;
      attrs.gradientDirection = gradient.direction;
      attrs.gradientColorOne = gradient.color1;
      attrs.gradientColorTwo = gradient.color2;
    }
    delete remaining.background;
  }

  return { gbAttrs: attrs, remainingStyles: remaining };
}

/** Extract URL from url("..."), url('...'), or url(...) */
function extractUrl(value: string): string | null {
  const match = value.match(/url\(["']?([^"')]+)["']?\)/);
  return match ? match[1] : null;
}

/** Parse linear-gradient(angle, color1, color2). Returns null for non-matching values. */
function parseGradient(value: string): { direction: number; color1: string; color2: string } | null {
  const match = value.match(/linear-gradient\((\d+)deg,\s*([^,]+),\s*([^)]+)\)/);
  if (!match) return null;
  return {
    direction: parseInt(match[1], 10),
    color1: match[2].trim(),
    color2: match[3].trim(),
  };
}
```

- [ ] **Step 4: Run tests to verify they all pass**

```bash
npx tsx --test tests/gb-attribute-mapper.test.ts
```
Expected: All 17 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/gb-attribute-mapper.ts tests/gb-attribute-mapper.test.ts
git commit -m "feat: add GB attribute mapper for backgrounds and colors"
```

---

### Task 2: Wire mapper into element block serializer

**Files:**
- Modify: `src/core/serializer.ts` (lines 67-74 in `buildElementAttrs`)

- [ ] **Step 1: Add the import**

In `src/core/serializer.ts`, add the import at the top (after existing imports):

```typescript
import { mapStylesToGbAttributes } from "./gb-attribute-mapper.js";
```

- [ ] **Step 2: Modify `buildElementAttrs()` to call the mapper**

Replace the existing styles assembly in `buildElementAttrs()`:

**Current code (lines 67-74):**
```typescript
function buildElementAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.uniqueId = block.uniqueId;
  attrs.tagName = block.tagName ?? "div";

  const stylesEmpty = !block.styles || Object.keys(block.styles).length === 0;
  attrs.styles = stylesEmpty ? {} : block.styles;
  attrs.css = formatCss(block, block.css || "");
```

**Replace with:**
```typescript
function buildElementAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.uniqueId = block.uniqueId;
  attrs.tagName = block.tagName ?? "div";

  // Promote inline styles to GB top-level attributes (backgrounds, colors, gradients)
  const { gbAttrs, remainingStyles } = mapStylesToGbAttributes(block.styles || {});
  Object.assign(attrs, gbAttrs);

  const stylesEmpty = !remainingStyles || Object.keys(remainingStyles).length === 0;
  attrs.styles = stylesEmpty ? {} : remainingStyles;
  attrs.css = formatCss(block, block.css || "");
```

- [ ] **Step 3: Run the full test suite to verify nothing is broken**

```bash
npx tsx --test tests/*.test.ts
```
Expected: All existing tests still pass (59 tests). The mapper only affects element blocks during serialization; existing fixtures don't exercise background promotion on elements.

- [ ] **Step 4: Run a quick convert to verify the output contains promoted attributes**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Inspect `output/mino/pages/index.html` — element blocks with inline background styles should now have `backgroundColor`, `bgImage`, `bgOptions`, `textColor` as top-level attributes instead of only inside `styles`.

Expected output snippet for an element with inline background:
```
<!-- wp:generateblocks/element {"uniqueId":"elem001","tagName":"section","backgroundColor":"#ffffff","bgImage":{"url":"hero.jpg"},"bgImageSize":"full","bgOptions":{"selector":"element","opacity":1,"overlay":false,"size":"cover","position":"center"},"styles":{"paddingTop":"64px"}, ...
```

Instead of the old output:
```
<!-- wp:generateblocks/element {"uniqueId":"elem001","tagName":"section","styles":{"backgroundColor":"#ffffff","backgroundImage":"url(hero.jpg)","backgroundSize":"cover","backgroundPosition":"center","paddingTop":"64px"}, ...
```

- [ ] **Step 5: Commit**

```bash
git add src/core/serializer.ts
git commit -m "feat: wire GB attribute mapper into element block serializer"
```
