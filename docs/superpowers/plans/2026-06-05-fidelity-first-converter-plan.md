# Fidelity-First Converter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pattern-recognition-first HTML-to-GB pipeline with a fidelity-first DOM walker that preserves source HTML structure and only normalizes where required for WordPress compatibility.

**Architecture:** Three stages — preprocess (strip/wrap, scan `<head>` styles), DOM walk (classify children, map tags to blocks, extract styles), serialize & validate (existing pipeline, unchanged). Four outputs: GB block markup, validation report, global styles manifest, custom CSS file.

**Tech Stack:** TypeScript + tsx, cheerio (DOM parsing), existing style-parser, serializer, validator, id-generator.

---

## File Structure

### New Files

| File | Purpose |
|---|---|
| `src/core/dom-walker.ts` | Recursive DOM traversal → Block[] conversion |
| `src/core/preprocessor.ts` | Strip nav/footer/scripts, wrap forms/styles/icons, scan `<head>` CSS |
| `src/core/global-styles-collector.ts` | Collect reusable class definitions from classNameToProperties |
| `src/core/orchestrator.ts` | Tie preprocessor → walker → serializer → 4 output files |

### Modified Files

| File | Change |
|---|---|
| `src/core/style-parser.ts` | Add `background-size`, `background-position`, `background-repeat`, `background-attachment` to STYLES_PROPERTIES |

### Removed Files

| File | Reason |
|---|---|
| `src/converter/structure-parser.ts` | No section detection needed |
| `src/converter/manifest-validator.ts` | No manifests |
| `src/converter/style-resolver.ts` | Decoupled |
| `src/converter/html-to-ir.ts` | No IR layer |
| `src/converter/role-mapper.ts` | No semantic roles |
| `src/converter/pipeline.ts` | Replaced by orchestrator |
| `src/core/ir-node.ts` | No IR types |
| `src/core/ir-planner.ts` | Walker produces Block[] directly |
| `src/core/mapper.ts` | Replaced by dom-walker |
| `src/core/hero-scorer.ts` | No hero detection |
| `src/core/hero-converter.ts` | No hero conversion |
| `src/types/manifest.ts` | No manifests |

### Unchanged Files

`src/core/types.ts`, `src/core/id-generator.ts`, `src/core/serializer.ts`, `src/core/validator.ts`

---

### Task 1: Add Missing Background Properties to style-parser

**Files:**
- Modify: `src/core/style-parser.ts`
- Verify: `snapshots/m1/text-stack.html` (existing regression)

- [ ] **Step 1: Add properties and verify existing tests still pass**

Add to the `STYLES_PROPERTIES` Set (after `"object-position"`):

```typescript
  // object-fit (for media)
  "object-fit",
  "object-position",

  // background (from GB bgOptions panel)
  "background-size",
  "background-position",
  "background-repeat",
  "background-attachment",
]);
```

- [ ] **Step 2: Run existing regression to confirm no breakage**

```bash
npx tsx src/cli/index.ts regression
```

Expected: All 5 M1 fixtures pass regression (they don't use these properties, so no change).

- [ ] **Step 3: Commit**

```bash
git add src/core/style-parser.ts
git commit -m "feat: add background-size/position/repeat/attachment to style-parser STYLES_PROPERTIES"
```

---

### Task 2: Global Styles Collector

**Files:**
- Create: `src/core/global-styles-collector.ts`
- Fixture: `fixtures/global-class-ref.json`

- [ ] **Step 1: Create the fixture**

```json
{
  "name": "global-class-ref",
  "description": "Three buttons with clip-hex class → globalClasses references + manifest entry",
  "inputHtml": "<html><head><style>.clip-hex{clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}</style></head><body><main><section><button class=\"clip-hex\">Btn 1</button><button class=\"clip-hex\">Btn 2</button><button class=\"clip-hex\">Btn 3</button></section></main></body></html>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "globalClassesCount": 1,
    "globalClassSlugs": ["clip-hex"]
  }
}
```

- [ ] **Step 2: Write the module**

```typescript
// ── Global Styles Collector ─────────────────────────────────
//
// Tracks reusable class definitions extracted from <head> <style>
// blocks. Classes used on 2+ elements are promoted to GB globalClasses
// references and included in the page-global-styles.json output.

import type { BlockStyles } from "./types.js";

export interface GlobalClassEntry {
  slug: string;
  name: string;
  styles: BlockStyles;
}

export interface GlobalStylesManifest {
  page: string;
  classes: GlobalClassEntry[];
}

export class GlobalStylesCollector {
  private classUsageCount = new Map<string, number>();
  private classDefinitions = new Map<string, BlockStyles>();
  private pageName: string;

  constructor(pageName: string) {
    this.pageName = pageName;
  }

  /**
   * Register a class definition from classNameToProperties.
   * Called once per class found in <head> <style>.
   */
  registerDefinition(className: string, styles: BlockStyles): void {
    this.classDefinitions.set(className, styles);
  }

  /**
   * Record usage of a class on an element.
   * Returns true if this class should be added to the block's globalClasses array
   * (i.e., it has been used on 2+ elements).
   */
  recordUsage(className: string): boolean {
    const count = (this.classUsageCount.get(className) || 0) + 1;
    this.classUsageCount.set(className, count);
    return count >= 2;
  }

  /**
   * Return the globalClasses array for a block, given its class names.
   * Only includes classes that have been used on 2+ elements.
   */
  getGlobalClassesForElement(classNames: string[]): string[] {
    return classNames.filter((c) => {
      const count = this.classUsageCount.get(c) || 0;
      return count >= 2 && this.classDefinitions.has(c);
    });
  }

  /**
   * Produce the global styles manifest for output.
   */
  toManifest(): GlobalStylesManifest {
    const classes: GlobalClassEntry[] = [];
    for (const [slug, styles] of this.classDefinitions) {
      const count = this.classUsageCount.get(slug) || 0;
      if (count >= 2) {
        classes.push({
          slug,
          name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          styles,
        });
      }
    }
    return { page: this.pageName, classes };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add fixtures/global-class-ref.json src/core/global-styles-collector.ts
git commit -m "feat: add global styles collector for reusable class definitions"
```

---

### Task 3: Preprocessor

**Files:**
- Create: `src/core/preprocessor.ts`
- Fixture: `fixtures/preprocess-basic.json`

- [ ] **Step 1: Create the fixture**

```json
{
  "name": "preprocess-basic",
  "description": "Preprocessor strips nav/footer/scripts, wraps forms and style blocks",
  "inputHtml": "<html><head><style>.blue{color:blue}</style></head><body><nav>skip</nav><main><section id=\"hero\"><h1>Title</h1></section><section><style>@keyframes slide{from{}to{}}</style><div class=\"blue\">text</div></section></main><footer>skip</footer></body></html>",
  "expect": {
    "shouldPass": true,
    "sectionsFound": 2,
    "navStripped": true,
    "footerStripped": true,
    "classNameToPropertiesSize": 1,
    "customCssNotEmpty": true
  }
}
```

- [ ] **Step 2: Write the module**

```typescript
// ── Preprocessor ───────────────────────────────────────────
//
// Prepares raw HTML for the DOM walker:
//   1. Strip <nav>, <footer>, <script>, <link>
//   2. Wrap <form>, body <style>, standalone <iconify-icon> in
//      <div data-gb-wrap="core-html"> markers
//   3. Scan <head> <style> blocks → classNameToProperties map
//      + customCss string (pseudo-classes, keyframes, vendor prefixes)

import * as cheerio from "cheerio";
import type { BlockStyles } from "./types.js";
import { parseStyleString } from "./style-parser.js";

export interface PreprocessResult {
  html: string;
  classNameToProperties: Map<string, BlockStyles>;
  customCss: string;
  warnings: string[];
}

// Tags to strip entirely
const STRIP_TAGS = new Set(["nav", "footer", "script", "link"]);

// Elements to wrap in core-html markers
const WRAP_TAGS = new Set(["form"]);

// Inline tags — iconify-icon wrapped only when standalone (direct child
// of block-level parent, not inside an inline parent)
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "br", "cite", "code", "data", "del", "dfn",
  "em", "i", "iconify-icon", "ins", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

// Properties forbidden in GB styles objects (pseudo-classes, vendor prefixes, keyframes)
const FORBIDDEN_CSS_PATTERNS = [
  /:hover/, /:focus/, /:active/, /:visited/, /:first-child/, /:last-child/,
  /:nth-child/, /:not\(/, /:is\(/, /:where\(/,
  /::before/, /::after/, /::placeholder/, /::selection/,
  /::-webkit-/, /::-moz-/, /::-ms-/,
  /@keyframes/, /@media/,
];

function isCssCompatible(ruleSelector: string, ruleProperties: string): boolean {
  for (const pattern of FORBIDDEN_CSS_PATTERNS) {
    if (pattern.test(ruleSelector) || pattern.test(ruleProperties)) {
      return false;
    }
  }
  return true;
}

/**
 * Parse <head> <style> blocks into:
 * - classNameToProperties: simple class definitions suitable for GB globalClasses
 * - customCss: everything else (pseudo-classes, keyframes, vendor prefixes)
 */
function scanHeadStyles($: cheerio.CheerioAPI): {
  classNameToProperties: Map<string, BlockStyles>;
  customCss: string;
} {
  const classNameToProperties = new Map<string, BlockStyles>();
  const customCssParts: string[] = [];

  $("head style").each((_, el) => {
    const cssText = $(el).text().trim();
    if (!cssText) return;

    // Crude rule-by-rule parser — splits on } and looks for { selector { properties }
    const rules = cssText.split("}").filter((r) => r.trim());
    for (const rule of rules) {
      const braceIdx = rule.indexOf("{");
      if (braceIdx === -1) continue;
      const selector = rule.substring(0, braceIdx).trim();
      const properties = rule.substring(braceIdx + 1).trim();
      if (!selector || !properties) continue;

      // Only handle simple class selectors (no combinators, no pseudo, no vendor prefix)
      const simpleClassMatch = selector.match(/^\.([a-zA-Z_-][\w-]*)$/);
      if (simpleClassMatch && isCssCompatible(selector, properties)) {
        const className = simpleClassMatch[1];
        // Convert CSS string to styles object via parseStyleString
        // Wrap in a fake style attr for the parser
        const fakeStyle = properties.replace(/;+/g, ";");
        const parsed = parseStyleString(fakeStyle);
        if (Object.keys(parsed.styles).length > 0 || parsed.css) {
          classNameToProperties.set(className, parsed.styles);
        }
      } else {
        // Incompatible — goes to customCss
        customCssParts.push(`${selector}{${properties}}`);
      }
    }
  });

  return {
    classNameToProperties,
    customCss: customCssParts.join("\n"),
  };
}

/**
 * Check if an <iconify-icon> element is standalone (direct child of
 * a block-level element, NOT nested inside an inline parent).
 */
function isStandaloneIcon($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): boolean {
  const parentTag = ($el.parent().prop("tagName") || "").toLowerCase();
  // Standalone if parent is a block element or root
  return !INLINE_TAGS.has(parentTag) && parentTag !== "";
}

export function preprocess(rawHtml: string): PreprocessResult {
  const warnings: string[] = [];
  const $ = cheerio.load(rawHtml);

  // 1. Strip nav, footer, script, link
  for (const tag of STRIP_TAGS) {
    const count = $(tag).length;
    if (count > 0) {
      warnings.push(`Stripped ${count} <${tag}> element(s)`);
      $(tag).remove();
    }
  }

  // 2. Scan <head> styles BEFORE we modify the body
  const { classNameToProperties, customCss } = scanHeadStyles($);

  // 3. Wrap <form>, <style> blocks in core-html markers
  for (const tag of WRAP_TAGS) {
    $(tag).each((_, el) => {
      const $el = $(el);
      const outer = $.html($el);
      $el.replaceWith(`<div data-gb-wrap="core-html">${outer}</div>`);
    });
  }

  // Wrap body-level <style> blocks
  $("body style").each((_, el) => {
    const $el = $(el);
    const outer = $.html($el);
    $el.replaceWith(`<div data-gb-wrap="core-html">${outer}</div>`);
  });

  // 4. Wrap standalone <iconify-icon> elements
  $("iconify-icon").each((_, el) => {
    const $el = $(el);
    if (isStandaloneIcon($el, $)) {
      const outer = $.html($el);
      $el.replaceWith(`<div data-gb-wrap="core-html">${outer}</div>`);
    }
  });

  // 5. Extract cleaned HTML (just the body contents)
  const bodyHtml = $("body").html() || "";

  return {
    html: bodyHtml,
    classNameToProperties,
    customCss,
    warnings,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add fixtures/preprocess-basic.json src/core/preprocessor.ts
git commit -m "feat: add preprocessor — strips nav/footer/scripts, wraps forms/styles/icons, scans head CSS"
```

---

### Task 4: DOM Walker

**Files:**
- Create: `src/core/dom-walker.ts`
- Fixture: `fixtures/dom-walk-text-only.json`, `fixtures/dom-walk-nested.json`, `fixtures/dom-walk-mixed.json`

- [ ] **Step 1: Create the fixtures**

`fixtures/dom-walk-text-only.json`:
```json
{
  "name": "dom-walk-text-only",
  "description": "Div with only text → text block with tagName:div, not element block",
  "inputHtml": "<main><div style=\"color:red\">Plain text content</div></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 1,
    "firstBlockType": "generateblocks/text",
    "firstBlockTagName": "div",
    "firstBlockContent": "Plain text content"
  }
}
```

`fixtures/dom-walk-nested.json`:
```json
{
  "name": "dom-walk-nested",
  "description": "Nested divs with block children → nesting preserved",
  "inputHtml": "<main><section><div><h1>Title</h1><p>Text</p></div></section></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 4,
    "nestingLevels": 4
  }
}
```

`fixtures/dom-walk-mixed.json`:
```json
{
  "name": "dom-walk-mixed",
  "description": "Div with mixed text + block children → core/html fallback",
  "inputHtml": "<main><div>text<h2>heading</h2>more text</div></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 1,
    "firstBlockType": "core/html"
  }
}
```

- [ ] **Step 2: Run fixtures to confirm they fail**

```bash
npx tsx src/cli/index.ts fixtures:run dom-walk-text-only
npx tsx src/cli/index.ts fixtures:run dom-walk-nested
npx tsx src/cli/index.ts fixtures:run dom-walk-mixed
```

Expected: All fail — walker doesn't exist yet (or returns errors).

- [ ] **Step 3: Write the DOM walker module**

```typescript
// ── DOM Walker ─────────────────────────────────────────────
//
// Depth-first DOM traversal that preserves source HTML structure.
// For each element:
//   1. Check for core-html wrapper → produce core/html block
//   2. Classify children (inline-only, block-only, mixed, empty)
//   3. Map tag → block type
//   4. Extract styles, htmlAttributes, globalClasses
//   5. Recurse into block-level children

import * as cheerio from "cheerio";
import type { Block, BlockStyles } from "./types.js";
import { nextId } from "./id-generator.js";
import { parseStyleString } from "./style-parser.js";
import type { GlobalStylesCollector } from "./global-styles-collector.js";

// ── Tag classification ────────────────────────────────────

/** Tags that stay as raw HTML in parent's content, never become blocks. */
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "br", "cite", "code", "data", "del", "dfn",
  "em", "i", "iconify-icon", "ins", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

/** Container tags that produce generateblocks/element when they have block children. */
const CONTAINER_TAGS = new Set([
  "div", "section", "article", "aside", "header", "main",
  "ul", "ol", "li", "dl", "dt", "dd", "figure",
]);

/** Tags that produce generateblocks/text. */
const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "pre",
]);

/** Tags that produce core/html (preserved verbatim). */
const CORE_HTML_TAGS = new Set([
  "iframe", "video", "audio", "canvas", "picture", "table",
]);

interface WalkerOptions {
  classNameToProperties: Map<string, BlockStyles>;
  collector: GlobalStylesCollector;
  warnings: string[];
}

// ── Core walker ────────────────────────────────────────────

export function walkElement(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  opts: WalkerOptions,
): Block[] {
  // 1. Core-html wrapper → produce single core/html block, no recursion
  if ($el.attr("data-gb-wrap") === "core-html") {
    return [makeCoreHtmlBlock($el, $)];
  }

  // 2. Classify children
  const childNodes = $el.contents().toArray();
  let hasMeaningfulText = false;
  let hasInlineOnly = true;    // starts true, set false if a block child found
  let hasBlockChildren = false;

  for (const node of childNodes) {
    if (node.type === "text") {
      const text = ($(node).text() || "").trim();
      if (text.length > 0) {
        hasMeaningfulText = true;
      }
      // text nodes don't affect hasInlineOnly or hasBlockChildren
    } else if (node.type === "tag") {
      const tagName = (node as any).name?.toLowerCase() || "";
      const $child = $(node);

      // Skip core-html wrapped children — they're block children
      if ($child.attr("data-gb-wrap") === "core-html") {
        hasBlockChildren = true;
        hasInlineOnly = false;
        continue;
      }

      if (INLINE_TAGS.has(tagName)) {
        // Inline child — stays in parent content
        // Only counts as "content" if tagName is an inline tag
      } else {
        hasBlockChildren = true;
        hasInlineOnly = false;
      }
    }
  }

  // 3. Mixed content → core/html fallback
  if (hasBlockChildren && (hasMeaningfulText || hasInlineOnly !== hasBlockChildren)) {
    // Recheck: block children AND text/inline → mixed
    if (hasMeaningfulText || $el.find(Array.from(INLINE_TAGS).join(",")).length > 0) {
      // Actually, we need to be more precise:
      // "mixed" means: has at least one block child AND at least one
      // text node or inline element child
      const hasTextOrInline = childNodes.some((node) => {
        if (node.type === "text") return ($(node).text() || "").trim().length > 0;
        if (node.type === "tag") {
          const tag = (node as any).name?.toLowerCase() || "";
          const $n = $(node);
          return INLINE_TAGS.has(tag) && !$n.attr("data-gb-wrap");
        }
        return false;
      });
      if (hasTextOrInline) {
        opts.warnings.push(`Mixed content element <${$el.prop("tagName")}> → core/html fallback`);
        return [makeCoreHtmlBlock($el, $)];
      }
    }
  }

  // 4. All inline/text → text block (even for container tags)
  if (!hasBlockChildren && (hasMeaningfulText || $el.children().length === 0 || $el.find(Array.from(INLINE_TAGS).join(",")).length > 0)) {
    // Element has only text/inline/empty → text block
    return [makeTextBlock($el, $, opts)];
  }

  // 5. Determine block type from tag
  const tag = ($el.prop("tagName") || "").toLowerCase();

  // Check for special patterns before generic tag mapping
  const block = makeBlockByTag($el, $, tag, opts);
  if (!block) {
    // Unrecognized → core/html
    opts.warnings.push(`Unrecognized tag <${tag}> → core/html`);
    return [makeCoreHtmlBlock($el, $)];
  }

  // 6. Recurse into block-level children (skip inline)
  if (block.innerBlocks !== undefined && hasBlockChildren) {
    $el.children().each((_, child) => {
      if (child.type !== "tag") return;
      const childTag = (child as any).name?.toLowerCase() || "";
      const $child = $(child);

      // Skip core-html markers (they're handled by the child's own walk call)
      if ($child.attr("data-gb-wrap") === "core-html") {
        block.innerBlocks!.push(...walkElement($child, $, opts));
        return;
      }

      if (!INLINE_TAGS.has(childTag)) {
        block.innerBlocks!.push(...walkElement($child, $, opts));
      }
    });
  }

  // 7. Warn about class-only styling
  if (Object.keys(block.styles || {}).length === 0 && (!block.css || block.css === "")) {
    const classAttr = ($el.attr("class") || "").trim();
    if (classAttr.length > 0) {
      opts.warnings.push(`CLASS_ONLY_STYLING: <${tag} class="${classAttr}"> — element has class-only styling, may appear unstyled`);
    }
  }

  return [block];
}

// ── Block factories ────────────────────────────────────────

function makeCoreHtmlBlock($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): Block {
  return {
    blockName: "core/html",
    uniqueId: nextId("core"),
    styles: {},
    css: "",
    innerBlocks: [],
    html: $.html($el),
  };
}

function makeTextBlock(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  opts: WalkerOptions,
): Block {
  const tag = ($el.prop("tagName") || "div").toLowerCase();
  const styleAttr = $el.attr("style") || "";
  const { styles, css, warnings: styleWarnings } = parseStyleString(styleAttr);
  opts.warnings.push(...styleWarnings);

  const htmlAttributes = extractHtmlAttributes($el);
  const globalClasses = extractGlobalClasses($el, opts);

  // Content is innerHTML (preserves inline formatting)
  const content = $el.html() || $el.text() || "";

  const block: Block = {
    blockName: "generateblocks/text",
    uniqueId: nextId("text"),
    tagName: tag,
    content,
    styles,
    css,
    globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
    htmlAttributes: Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
    innerBlocks: [],
  };

  return block;
}

function makeElementBlock(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  tag: string,
  opts: WalkerOptions,
): Block {
  const styleAttr = $el.attr("style") || "";
  const { styles, css, warnings: styleWarnings } = parseStyleString(styleAttr);
  opts.warnings.push(...styleWarnings);

  const htmlAttributes = extractHtmlAttributes($el);
  const globalClasses = extractGlobalClasses($el, opts);

  return {
    blockName: "generateblocks/element",
    uniqueId: nextId("elem"),
    tagName: tag,
    styles,
    css,
    globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
    htmlAttributes: Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
    innerBlocks: [],
  };
}

function makeMediaBlock(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  opts: WalkerOptions,
): Block {
  const styleAttr = $el.attr("style") || "";
  const { styles, css, warnings: styleWarnings } = parseStyleString(styleAttr);
  opts.warnings.push(...styleWarnings);

  const src = $el.attr("src") || "";
  const alt = $el.attr("alt") || "";

  const htmlAttributes: Record<string, string> = { src, alt };
  const width = $el.attr("width");
  const height = $el.attr("height");
  if (width) htmlAttributes.width = width;
  if (height) htmlAttributes.height = height;

  return {
    blockName: "generateblocks/media",
    uniqueId: nextId("img"),
    tagName: "img",
    styles,
    css,
    htmlAttributes,
    mediaId: 0,
    innerBlocks: [],
  };
}

function makeCoreImageBlock(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
): Block {
  const $img = $el.find("img").first();
  const src = $img.attr("src") || "";
  const alt = $img.attr("alt") || "";
  const caption = $el.find("figcaption").first().text().trim() || undefined;

  return {
    blockName: "core/image",
    uniqueId: nextId("core"),
    url: src,
    alt,
    caption,
    tagName: "figure",
    styles: {},
    css: "",
    innerBlocks: [],
  };
}

function makeShapeBlock(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  opts: WalkerOptions,
): Block {
  const styleAttr = $el.attr("style") || "";
  const { styles, css, warnings: styleWarnings } = parseStyleString(styleAttr);
  opts.warnings.push(...styleWarnings);

  return {
    blockName: "generateblocks/shape",
    uniqueId: nextId("shape"),
    html: $.html($el),
    styles,
    css,
    innerBlocks: [],
  };
}

// ── Tag → block type router ────────────────────────────────

function makeBlockByTag(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  tag: string,
  opts: WalkerOptions,
): Block | null {
  // <a> with block children → element block
  // <a> with only inline → text block (handled by classification earlier)

  if (tag === "svg") {
    return makeShapeBlock($el, $, opts);
  }

  if (tag === "img") {
    // Check if parent is <figure> with <figcaption> → handled by figure branch
    const parentTag = ($el.parent().prop("tagName") || "").toLowerCase();
    if (parentTag === "figure" && $el.parent().find("figcaption").length > 0) {
      // Captioned image — handled by the figure element above
      return null; // skip, parent figure handles it
    }
    return makeMediaBlock($el, $, opts);
  }

  if (tag === "figure") {
    const hasCaption = $el.find("figcaption").length > 0;
    const hasImg = $el.find("img").length > 0;
    if (hasCaption && hasImg) {
      return makeCoreImageBlock($el, $);
    }
    return makeElementBlock($el, $, tag, opts);
  }

  if (CORE_HTML_TAGS.has(tag)) {
    return makeCoreHtmlBlock($el, $);
  }

  if (tag === "button") {
    return makeTextBlock($el, $, opts);
  }

  if (TEXT_TAGS.has(tag)) {
    return makeTextBlock($el, $, opts);
  }

  if (CONTAINER_TAGS.has(tag)) {
    return makeElementBlock($el, $, tag, opts);
  }

  return null; // unrecognized
}

// ── Helpers ────────────────────────────────────────────────

function extractHtmlAttributes($el: cheerio.Cheerio<any>): Record<string, string> {
  const attrs: Record<string, string> = {};
  const allowedAttrs = new Set([
    "id", "href", "src", "alt", "target", "rel", "type", "name",
    "role", "aria-label", "aria-labelledby", "aria-expanded",
    "aria-haspopup", "aria-hidden", "aria-current",
    "data-gb-resp",
  ]);

  const elAttrs = ($el as any)[0]?.attribs || {};
  for (const [key, value] of Object.entries(elAttrs)) {
    if (key === "style") continue;
    if (key === "class") continue;
    if (key === "data-gb-wrap") continue;

    // Allow aria-* and data-* prefixes, plus specific allowed attrs
    if (allowedAttrs.has(key) || key.startsWith("aria-") || key.startsWith("data-")) {
      attrs[key] = value as string;
    }
  }

  return attrs;
}

function extractGlobalClasses(
  $el: cheerio.Cheerio<any>,
  opts: WalkerOptions,
): string[] {
  const classAttr = ($el.attr("class") || "").trim();
  if (!classAttr) return [];

  const classNames = classAttr.split(/\s+/).filter((c) => c.length > 0);
  const result: string[] = [];

  for (const className of classNames) {
    if (opts.classNameToProperties.has(className)) {
      const isReusable = opts.collector.recordUsage(className);
      if (isReusable) {
        result.push(className);
      }
    }
  }

  return result;
}

// ── Entry point ────────────────────────────────────────────

export interface WalkResult {
  blocks: Block[];
  warnings: string[];
}

export function walkDom(
  html: string,
  classNameToProperties: Map<string, BlockStyles>,
  collector: GlobalStylesCollector,
): WalkResult {
  const warnings: string[] = [];
  const $ = cheerio.load(`<div>${html}</div>`);

  const opts: WalkerOptions = { classNameToProperties, collector, warnings };
  const blocks: Block[] = [];

  // Walk direct children of the root wrapper
  $("body > *, div > *").each((_, el) => {
    const tag = (el as any).name?.toLowerCase() || "";
    if (tag === "nav" || tag === "footer" || tag === "script" || tag === "style") return;

    const $el = $(el);
    if ($el.attr("data-gb-wrap") === "core-html") {
      blocks.push(makeCoreHtmlBlock($el, $));
      return;
    }

    blocks.push(...walkElement($el, $, opts));
  });

  return { blocks, warnings };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/core/dom-walker.ts fixtures/dom-walk-text-only.json fixtures/dom-walk-nested.json fixtures/dom-walk-mixed.json
git commit -m "feat: add dom-walker — recursive DOM traversal to Block[] with inline/block classification"
```

---

### Task 5: Orchestrator

**Files:**
- Create: `src/core/orchestrator.ts`

- [ ] **Step 1: Write the orchestrator**

```typescript
// ── Orchestrator ───────────────────────────────────────────
//
// Ties the full pipeline together:
//   preprocess → DOM walk → serialize → validate → output files

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preprocess } from "./preprocessor.js";
import { walkDom } from "./dom-walker.js";
import { GlobalStylesCollector } from "./global-styles-collector.js";
import { serializeBlocks, countBlocks } from "./serializer.js";
import { validateBlocks } from "./validator.js";
import { resetIds } from "./id-generator.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface ConversionInput {
  rawHtml: string;
  pageName: string;
}

export interface ConversionOutput {
  pageName: string;
  blockHtml: string;
  report: Record<string, unknown>;
  globalStyles: Record<string, unknown>;
  customCss: string;
}

export function convert(input: ConversionInput): ConversionOutput {
  resetIds();

  // Stage 1: Preprocess
  const prepResult = preprocess(input.rawHtml);

  // Stage 2: Register class definitions in collector
  const collector = new GlobalStylesCollector(input.pageName);
  for (const [className, styles] of prepResult.classNameToProperties) {
    collector.registerDefinition(className, styles);
  }

  // Stage 3: DOM walk
  const walkResult = walkDom(prepResult.html, prepResult.classNameToProperties, collector);

  // Collect all warnings
  const allWarnings = [
    ...prepResult.warnings.map((w) => ({ code: "PREPROCESS", message: w })),
    ...walkResult.warnings.map((w) => ({ code: "WALK", message: w })),
  ];

  // Stage 4: Serialize
  const html = serializeBlocks(walkResult.blocks);
  const blockCount = countBlocks(walkResult.blocks);

  // Stage 5: Validate
  const { hardFails, warnings: valWarnings } = validateBlocks(walkResult.blocks, html);

  // Build report
  const report = {
    page: input.pageName,
    blockCount,
    hardFails: hardFails.map((f) => ({ code: f.code, message: f.message })),
    warnings: [
      ...allWarnings,
      ...valWarnings.map((w) => ({ code: w.code, message: w.message })),
    ],
    overallStatus: hardFails.length > 0 ? "partial" : "pass",
    customCssRequired: prepResult.customCss.length > 0,
    globalClassesExtracted: collector.toManifest().classes.map((c) => c.slug),
    strippedElements: prepResult.warnings
      .filter((w) => w.startsWith("Stripped"))
      .map((w) => w.replace("Stripped ", "").replace(" element(s)", "")),
  };

  // Write output files
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Block markup
  writeFileSync(resolve(OUTPUT_DIR, `${input.pageName}.html`), html, "utf-8");

  // Report
  writeFileSync(
    resolve(OUTPUT_DIR, `${input.pageName}.report.json`),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  // Global styles manifest
  const globalStylesManifest = collector.toManifest();
  if (globalStylesManifest.classes.length > 0) {
    writeFileSync(
      resolve(OUTPUT_DIR, `${input.pageName}-global-styles.json`),
      JSON.stringify(globalStylesManifest, null, 2) + "\n",
      "utf-8",
    );
  }

  // Custom CSS
  if (prepResult.customCss.length > 0) {
    writeFileSync(
      resolve(OUTPUT_DIR, `${input.pageName}-custom.css`),
      prepResult.customCss + "\n",
      "utf-8",
    );
  }

  return {
    pageName: input.pageName,
    blockHtml: html,
    report,
    globalStyles: globalStylesManifest,
    customCss: prepResult.customCss,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: add orchestrator — ties preprocess → walk → serialize → validate → output"
```

---

### Task 6: New Fixture Format — HTML Input Support

**Files:**
- Create: `fixtures/fidelity-flat-section.json`
- Create: `fixtures/fidelity-inline-formatting.json`
- Create: `fixtures/fidelity-cta-link.json`
- Create: `fixtures/fidelity-svg-icon.json`
- Create: `fixtures/fidelity-form-fallback.json`
- Create: `fixtures/fidelity-captioned-image.json`
- Modify: `src/runner/run-fixture.ts` (new runner for fidelity fixtures)
- Modify: `src/cli/index.ts` (new command `convert`)

- [ ] **Step 1: Create the fidelity fixtures (6 files)**

`fixtures/fidelity-flat-section.json`:
```json
{
  "name": "fidelity-flat-section",
  "description": "Section with heading and paragraph — fidelity-first, tag-driven",
  "inputHtml": "<main><section id=\"hero\"><h1 style=\"font-size:2rem;color:#111\">Title</h1><p style=\"font-size:1rem;color:#444\">Body text</p></section></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 3
  }
}
```

`fixtures/fidelity-inline-formatting.json`:
```json
{
  "name": "fidelity-inline-formatting",
  "description": "Paragraph with inline formatting preserved as rich text",
  "inputHtml": "<main><p style=\"color:#333\">Some <strong>bold</strong> text with <a href=\"https://example.com\">link</a></p></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 1
  }
}
```

`fixtures/fidelity-cta-link.json`:
```json
{
  "name": "fidelity-cta-link",
  "description": "Standalone <a> → text block with tagName:a and htmlAttributes.href",
  "inputHtml": "<main><a href=\"https://example.com\" style=\"display:inline-flex;padding:12px 24px;background:#111;color:#fff;text-decoration:none\">Click me</a></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 1
  }
}
```

`fixtures/fidelity-svg-icon.json`:
```json
{
  "name": "fidelity-svg-icon",
  "description": "Inline SVG → shape block, no recursion into SVG children",
  "inputHtml": "<main><div><h2>Title</h2><svg viewBox=\"0 0 24 24\" style=\"width:24px;height:24px\"><path d=\"M12 2l...\"/></svg></div></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 2
  }
}
```

`fixtures/fidelity-form-fallback.json`:
```json
{
  "name": "fidelity-form-fallback",
  "description": "Form element → single core/html block, no recursion",
  "inputHtml": "<main><section><h2>Contact</h2><form><input type=\"text\" name=\"email\"/><button type=\"submit\">Send</button></form></section></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 3
  }
}
```

`fixtures/fidelity-captioned-image.json`:
```json
{
  "name": "fidelity-captioned-image",
  "description": "figure > img + figcaption → core/image",
  "inputHtml": "<main><figure><img src=\"https://example.com/photo.jpg\" alt=\"Photo\"/><figcaption>Caption text</figcaption></figure></main>",
  "expect": {
    "shouldPass": true,
    "hardFailCount": 0,
    "blockCount": 1
  }
}
```

- [ ] **Step 2: Commit the fixtures**

```bash
git add fixtures/fidelity-*.json
git commit -m "test: add fidelity-first fixtures covering flat, inline, cta, svg, form, captioned-image"
```

---

### Task 7: Update Runner and CLI

**Files:**
- Modify: `src/runner/run-fixture.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add fidelity fixture runner to run-fixture.ts**

At the end of `src/runner/run-fixture.ts`, add:

```typescript
// ── Fidelity fixture runner ──────────────────────────────────

export interface FidelityFixture {
  name: string;
  description: string;
  inputHtml: string;
  expect: {
    shouldPass: boolean;
    hardFailCount: number;
    blockCount?: number;
  };
}

import { convert } from "../core/orchestrator.js";
import type { ConversionOutput } from "../core/orchestrator.js";

export function runFidelityFixture(fixture: FidelityFixture): RunResult {
  const output: ConversionOutput = convert({
    rawHtml: fixture.inputHtml,
    pageName: fixture.name,
  });

  const hardFails: HardFail[] = (output.report.hardFails as any[])?.map((f: any) => ({
    code: f.code || "UNKNOWN",
    message: f.message || "",
  })) || [];

  const warnings: Warning[] = (output.report.warnings as any[])?.map((w: any) => ({
    code: w.code || "WARNING",
    message: w.message || "",
  })) || [];

  const blockCount = (output.report.blockCount as number) || 0;
  const status: ReportStatus = hardFails.length > 0 ? "validator_fail" : "validator_pass";

  const report: FixtureReport = {
    fixture: fixture.name,
    status,
    blockCount,
    hardFails,
    warnings,
    manualVerification: { wordpressPasted: false, savedWithoutRecovery: null, notes: "" },
  };

  writeOutput(fixture.name, output.blockHtml, report);

  // Write global styles and custom CSS if present
  if (output.globalStyles && (output.globalStyles as any).classes?.length > 0) {
    writeFileSync(
      resolve(OUTPUT_DIR, `${fixture.name}-global-styles.json`),
      JSON.stringify(output.globalStyles, null, 2) + "\n",
      "utf-8",
    );
  }
  if (output.customCss?.length > 0) {
    writeFileSync(
      resolve(OUTPUT_DIR, `${fixture.name}-custom.css`),
      output.customCss + "\n",
      "utf-8",
    );
  }

  return { fixture, report, html: output.blockHtml };
}

export function isFidelityFixture(f: any): boolean {
  return typeof f.inputHtml === "string";
}
```

- [ ] **Step 2: Add `convert` command to CLI**

In `src/cli/index.ts`, add the `convert` command before the unknown command handler. After the `hero:convert` block:

```typescript
  // ── convert ──────────────────────────────────────────────
  if (cmd === "convert") {
    const inputPath = args[1];
    if (!inputPath) {
      console.error("Usage: convert <input.html>");
      process.exit(1);
    }

    const fullPath = resolve(process.cwd(), inputPath);
    if (!existsSync(fullPath)) {
      console.error(`File not found: ${fullPath}`);
      process.exit(1);
    }

    const rawHtml = readFileSync(fullPath, "utf-8");
    const pageName = basename(fullPath, extname(fullPath));

    const { convert } = await import("../core/orchestrator.js");
    const output = convert({ rawHtml, pageName });

    console.log(`\nConverted: ${pageName}`);
    console.log(`  Output: output/${pageName}.html`);
    console.log(`  Report: output/${pageName}.report.json`);
    console.log(`  Blocks: ${output.report.blockCount}`);
    console.log(`  Status: ${output.report.overallStatus}`);

    const warnings = (output.report.warnings as any[]) || [];
    if (warnings.length > 0) {
      console.log(`  Warnings: ${warnings.length}`);
      for (const w of warnings.slice(0, 5)) {
        console.log(`    [${w.code}] ${w.message}`);
      }
      if (warnings.length > 5) console.log(`    ... and ${warnings.length - 5} more`);
    }

    if (output.customCss) {
      console.log(`  Custom CSS: output/${pageName}-custom.css (${output.customCss.split("\n").length} rules)`);
    }
    console.log("");
    return;
  }
```

Note: The CLI uses `await import()` because orchestrator may use ESM imports. Actually, since the CLI already uses top-level imports, use a regular import at the top. Add to the imports:

```typescript
import { convert } from "../core/orchestrator.js";
```

Then update the CLI help text:

```typescript
    console.log("  fixtures:list              List all fixtures");
    console.log("  fixtures:run <name>        Run single fixture");
    console.log("  fixtures:run-all           Run all fixtures");
    console.log("  convert <input.html>       Convert HTML page to GB blocks");
    console.log("  regression                 Check M1 vs snapshots");
```

- [ ] **Step 3: Also add fidelity fixture support to fixtures:run**

In the `fixtures:run` handler, after loading the fixture, add fidelity fixture detection:

```typescript
    // After: const raw = loadFixture(fp);
    if (isFidelityFixture(raw)) {
      const { report } = runFidelityFixture(raw as FidelityFixture);
      printResults([report]);
      if (report.status === "validator_fail") process.exit(1);
      return;
    }
```

Import `runFidelityFixture, isFidelityFixture, type FidelityFixture` at the top of the CLI.

- [ ] **Step 4: Run M1 regression tests to confirm no breakage**

```bash
npx tsx src/cli/index.ts regression
```

Expected: All 5 M1 fixtures pass.

- [ ] **Step 5: Run fidelity fixtures**

```bash
npx tsx src/cli/index.ts fixtures:run fidelity-flat-section
npx tsx src/cli/index.ts fixtures:run fidelity-inline-formatting
npx tsx src/cli/index.ts fixtures:run fidelity-cta-link
npx tsx src/cli/index.ts fixtures:run fidelity-svg-icon
npx tsx src/cli/index.ts fixtures:run fidelity-form-fallback
npx tsx src/cli/index.ts fixtures:run fidelity-captioned-image
```

Expected: All 6 pass validation.

- [ ] **Step 6: Commit**

```bash
git add src/runner/run-fixture.ts src/cli/index.ts
git commit -m "feat: add convert command and fidelity fixture runner"
```

---

### Task 8: Remove Deprecated Files

**Files:**
- Remove: 12 files (see File Structure above)

- [ ] **Step 1: Remove the old converter and IR files**

```bash
rm -rf src/converter/
rm src/core/ir-node.ts
rm src/core/ir-planner.ts
rm src/core/mapper.ts
rm src/core/hero-scorer.ts
rm src/core/hero-converter.ts
rm src/types/manifest.ts
```

- [ ] **Step 2: Remove old hero/IR fixtures**

```bash
rm fixtures/hero-*.json fixtures/two-col-responsive.json fixtures/card-grid-responsive.json fixtures/stats-row-responsive.json fixtures/media-text-split-responsive.json
```

- [ ] **Step 3: Clean up CLI — remove hero:convert command and IR-related code**

In `src/cli/index.ts`, remove:
- The `hero:convert` command handler block
- The `collectInputFiles` and `walkDir` functions
- The imports for hero-related modules (`normalizeHeroHtml`, `convertHero`, `DEFAULT_OPTIONS`, `HeroConverterOptions`)

- [ ] **Step 4: Clean up run-fixture.ts — remove IR runner and hero runner**

In `src/runner/run-fixture.ts`, remove:
- `runIRFixture` function
- `runHeroFixture` function
- `writeHeroOutput` function
- `isIRFixture` function
- `IRFixture` interface
- Imports for `IRNode`, `planBlocks`, hero modules

- [ ] **Step 5: Clean up CLI — simplify fixtures:run-all**

Remove the IR fixture routing. The `fixtures:run-all` should only handle M1 fixtures (existing) and fidelity fixtures (new). Remove hero fixture handling. Keep the regression check at the start.

- [ ] **Step 6: Verify nothing is broken**

```bash
npx tsx src/cli/index.ts regression
npx tsx src/cli/index.ts fixtures:run fidelity-flat-section
```

Expected: Both pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove pattern-recognition pipeline — converter/, ir-node, ir-planner, mapper, hero-scorer/converter, manifest types"
```

---

### Task 9: Integration Test — Convert Mino Page

**Files:**
- Input: `inputs/mino/index.html`

- [ ] **Step 1: Run the full conversion**

```bash
npx tsx src/cli/index.ts convert inputs/mino/index.html
```

Expected: Output files created:
- `output/mino.html` — paste-ready GB blocks
- `output/mino.report.json` — validation report
- `output/mino-global-styles.json` — reusable classes
- `output/mino-custom.css` — custom CSS for manual import

- [ ] **Step 2: Check block count and status**

```bash
cat output/mino.report.json | head -20
```

Expected: `overallStatus: "pass"` or `"partial"` (likely partial due to class-only styling warnings).

- [ ] **Step 3: Verify output contains expected block types**

```bash
grep -c "wp:generateblocks/element" output/mino.html
grep -c "wp:generateblocks/text" output/mino.html
grep -c "wp:generateblocks/media" output/mino.html
grep -c "wp:generateblocks/shape" output/mino.html
grep -c "wp:core/html" output/mino.html
grep -c "wp:image" output/mino.html
```

Expected: All counts > 0 (Mino has all block types).

- [ ] **Step 4: Check for expected warnings**

```bash
grep "CLASS_ONLY_STYLING" output/mino.report.json
grep "Stripped" output/mino.report.json
grep "customCssRequired" output/mino.report.json
```

Expected: All found — Mino has class-only elements, nav/footer stripped, custom CSS from `<head>` style blocks.

- [ ] **Step 5: Verify global styles manifest**

```bash
cat output/mino-global-styles.json
```

Expected: Contains `clip-hex`, `blueprint-bg`, possibly `ruler-x` if detected.

- [ ] **Step 6: Verify custom CSS**

```bash
wc -l output/mino-custom.css
```

Expected: > 0 lines — contains pseudo-class and keyframe rules.

- [ ] **Step 7: Commit the output for reference**

```bash
git add output/mino.html output/mino.report.json output/mino-global-styles.json output/mino-custom.css
git commit -m "test: Mino conversion output — fidelity-first converter initial run"
```

---

### Task 10: Run All Fixtures — Final Verification

- [ ] **Step 1: Run M1 regression**

```bash
npx tsx src/cli/index.ts regression
```

Expected: All 5 M1 fixtures pass.

- [ ] **Step 2: Run all fidelity fixtures**

```bash
for f in fixtures/fidelity-*.json; do
  name=$(basename "$f" .json)
  echo "=== $name ==="
  npx tsx src/cli/index.ts fixtures:run "$name"
done
```

Expected: All 6 fidelity fixtures pass validation.

- [ ] **Step 3: Run fixtures:run-all (skip hero fixtures which are removed)**

The remaining M1 fixtures (5) + fidelity fixtures (6) + legacy fixtures that don't depend on removed code.
Manually skip the removed hero/IR fixtures.

```bash
npx tsx src/cli/index.ts fixtures:run-all
```

Expected: No hard failures. Warnings are acceptable.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test: all fixtures pass — fidelity-first converter verified"
```
