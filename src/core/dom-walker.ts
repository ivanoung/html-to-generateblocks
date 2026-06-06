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

/** Semantic containers that MUST stay as element blocks (recovery forbidden if text). */
const SEMANTIC_CONTAINER_TAGS = new Set([
  "section", "article", "aside", "header", "main",
  "ul", "ol", "dl", "figure",
]);

/** Tags that produce generateblocks/text. */
const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "pre",
]);

/** Tags that always produce core/html (preserved verbatim). */
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
  let hasInlineElements = false;
  let hasBlockChildren = false;

  for (const node of childNodes) {
    if (node.type === "text") {
      const text = ($(node).text() || "").trim();
      if (text.length > 0) {
        hasMeaningfulText = true;
      }
    } else if (node.type === "tag") {
      const tagName = (node as any).name?.toLowerCase() || "";
      const $child = $(node);

      if ($child.attr("data-gb-wrap") === "core-html") {
        hasBlockChildren = true;
      } else if (INLINE_TAGS.has(tagName)) {
        hasInlineElements = true;
      } else {
        hasBlockChildren = true;
      }
    }
  }

  // 3. Check for mixed content (text/inline + block children)
  const tag = ($el.prop("tagName") || "").toLowerCase();
  const hasTextOrInline = hasMeaningfulText || hasInlineElements;
  if (hasBlockChildren && hasTextOrInline) {
    return makeCoreHtmlFallback($el, $, opts.warnings, tag);
  }

  // 4. All inline/text → text block (only for non-container tags)
  //    Container tags always stay as element blocks (they're semantic wrappers)
  if (!hasBlockChildren && (hasMeaningfulText || hasInlineElements)) {
    if (SEMANTIC_CONTAINER_TAGS.has(tag)) {
      // Container with only text/inline → core/html fallback (GB element blocks
      // cannot contain raw text — recovery rules §5.3)
      return makeCoreHtmlFallback($el, $, opts.warnings, tag);
    }
    return [makeTextBlock($el, $, opts)];
  }

  // 5. Determine block type from tag
  // Section wrapper: outer <section> (backgrounds) + inner <div> (content)
  if (tag === "section") {
    const wrapper = makeSectionWrapper($el, $, opts);
    // Recurse children into the inner block (second element inside outer)
    const inner = wrapper[0].innerBlocks?.[0];
    if (inner && hasBlockChildren) {
      $el.children().each((_, child) => {
        if (child.type !== "tag") return;
        const childTag = (child as any).name?.toLowerCase() || "";
        const $child = $(child);
        if ($child.attr("data-gb-wrap") === "core-html") {
          inner.innerBlocks!.push(...walkElement($child, $, opts));
          return;
        }
        if (!INLINE_TAGS.has(childTag)) {
          inner.innerBlocks!.push(...walkElement($child, $, opts));
        }
      });
    }
    return wrapper;
  }

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

      if ($child.attr("data-gb-wrap") === "core-html") {
        block.innerBlocks!.push(...walkElement($child, $, opts));
        return;
      }

      if (!INLINE_TAGS.has(childTag)) {
        block.innerBlocks!.push(...walkElement($child, $, opts));
      }
    });
  }

  return [block];
}

// ── Section wrapper (outer/inner container pattern) ─────

function makeSectionWrapper(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  opts: WalkerOptions,
): Block[] {
  const styleAttr = $el.attr("style") || "";
  const { styles: allStyles, css: allCss, warnings: styleWarnings } =
    parseStyleString(styleAttr);
  opts.warnings.push(...styleWarnings);

  // Split: background-* → outer, rest → inner
  const outerStyles: Record<string, string> = {};
  const innerStyles: Record<string, string> = {};

  for (const [prop, value] of Object.entries(allStyles)) {
    if (
      prop === "background" ||
      prop.startsWith("background") ||
      prop.startsWith("border") ||
      prop === "width" ||
      prop === "min-width" ||
      prop === "max-width"
    ) {
      outerStyles[prop] = value;
    } else {
      innerStyles[prop] = value;
    }
  }

  // Split CSS string similarly
  const cssParts = allCss.split(";").filter((p) => p.trim());
  const outerCssParts: string[] = [];
  const innerCssParts: string[] = [];
  for (const decl of cssParts) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = decl.substring(0, colonIdx).trim();
    if (
      prop === "background" ||
      prop.startsWith("background") ||
      prop.startsWith("border") ||
      prop === "width" ||
      prop === "min-width" ||
      prop === "max-width"
    ) {
      outerCssParts.push(decl);
    } else {
      innerCssParts.push(decl);
    }
  }

  // Inner always gets max-width: var(--gb-container-width) + auto margins
  innerStyles["maxWidth"] = "var(--gb-container-width)";
  innerStyles["marginLeft"] = "auto";
  innerStyles["marginRight"] = "auto";

  const outerId = nextId("outer");
  const innerId = nextId("inner");

  const htmlAttributes = extractHtmlAttributes($el);

  // Build inner CSS
  let innerCss = innerCssParts.join(";");
  if (innerCss && !innerCss.endsWith(";")) innerCss += ";";
  if (innerCss) {
    innerCss = `.gb-element-${innerId}{${innerCss}}`;
  }
  // Add max-width + margin to inner CSS
  if (!innerCss) {
    innerCss = `.gb-element-${innerId}{margin-left:auto;margin-right:auto;max-width:var(--gb-container-width)}`;
  }

  const globalClasses = extractGlobalClasses($el, opts);

  const outer: Block = {
    blockName: "generateblocks/element",
    uniqueId: outerId,
    tagName: "section",
    styles: outerStyles,
    css:
      outerCssParts.length > 0
        ? `.gb-element-${outerId}{${outerCssParts.join(";")}}`
        : "",
    globalClasses: undefined,
    htmlAttributes:
      Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
    innerBlocks: [],
  };

  const inner: Block = {
    blockName: "generateblocks/element",
    uniqueId: innerId,
    tagName: "div",
    styles: innerStyles,
    css: innerCss,
    globalClasses:
      globalClasses && globalClasses.length > 0 ? globalClasses : undefined,
    htmlAttributes: undefined,
    innerBlocks: [],
  };

  outer.innerBlocks = [inner];
  return [outer];
}

// ── Block factories ────────────────────────────────────────

function makeCoreHtmlBlock(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
): Block {
  // For wrapper divs (data-gb-wrap), return innerHTML (original wrapped element)
  return {
    blockName: "core/html",
    uniqueId: nextId("core"),
    styles: {},
    css: "",
    innerBlocks: [],
    html: $el.html() || "",
  };
}

function makeCoreHtmlFallback(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  warnings: string[],
  tag: string,
): Block[] {
  warnings.push(
    `Mixed content element <${tag}> → core/html fallback`,
  );
  // Unwrap nested data-gb-wrap markers in children before capturing outerHTML
  const $clone = $el.clone();
  $clone.find("[data-gb-wrap]").each((_, child) => {
    const $child = $(child);
    $child.replaceWith($child.html() || "");
  });
  return [{
    blockName: "core/html",
    uniqueId: nextId("core"),
    styles: {},
    css: "",
    innerBlocks: [],
    html: $.html($clone) || "",
  }];
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

  return {
    blockName: "generateblocks/text",
    uniqueId: nextId("text"),
    tagName: tag,
    content,
    styles,
    css,
    globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
    htmlAttributes:
      Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
    innerBlocks: [],
  };
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
    htmlAttributes:
      Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
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
  if (tag === "svg") {
    return makeShapeBlock($el, $, opts);
  }

  if (tag === "img") {
    const parentTag = ($el.parent().prop("tagName") || "").toLowerCase();
    if (
      parentTag === "figure" &&
      $el.parent().find("figcaption").length > 0
    ) {
      return null; // captioned — parent figure handles it
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

function extractHtmlAttributes(
  $el: cheerio.Cheerio<any>,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  const allowedAttrs = new Set([
    "id",
    "href",
    "src",
    "alt",
    "target",
    "rel",
    "type",
    "name",
    "role",
    "aria-label",
    "aria-labelledby",
    "aria-expanded",
    "aria-haspopup",
    "aria-hidden",
    "aria-current",
  ]);

  const elAttrs = ($el as any)[0]?.attribs || {};
  Object.keys(elAttrs).forEach((key) => {
    if (key === "style") return;
    if (key === "class") return;
    if (key === "data-gb-wrap") return;

    if (allowedAttrs.has(key) || key.startsWith("aria-") || key.startsWith("data-")) {
      attrs[key] = elAttrs[key];
    }
  });

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

  classNames.forEach((className) => {
    // Track classes from <head> <style> definitions + inliner-generated gb-s-* classes
    if (opts.classNameToProperties.has(className) || className.startsWith("gb-s-")) {
      opts.collector.recordUsage(className);
      result.push(className);
    }
  });

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

  // Walk top-level children of the wrapper div only
  const $wrapper = $("body > div, div").first();
  if ($wrapper.length > 0) {
    $wrapper.children().each((_, el) => {
      const tag = (el as any).name?.toLowerCase() || "";
      if (tag === "nav" || tag === "footer" || tag === "script" || tag === "style") return;

      const $el = $(el);
      blocks.push(...walkElement($el, $, opts));
    });
  }

  return { blocks, warnings };
}
