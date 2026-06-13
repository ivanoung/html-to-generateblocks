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

// ── Helpers ────────────────────────────────────────────────

/** Extract first 60 chars of text from element for error messages */
function textPreview($el: cheerio.Cheerio<any>): string {
  const text = ($el.text() || "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? text.substring(0, 60) + "…" : text;
}

// ── Tag classification ────────────────────────────────────

/** Tags that stay as raw HTML in parent's content, never become blocks. */
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "br", "cite", "code", "data", "del", "dfn",
  "em", "i", "iconify-icon", "ins", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "svg", "time", "u", "var", "wbr",
]);

/** Container tags that produce generateblocks/element when they have block children. */
const CONTAINER_TAGS = new Set([
  "div", "section", "article", "aside", "header", "main",
  "ul", "ol", "li", "dl", "dt", "dd", "figure", "nav", "footer",
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
  hardFails: { code: string; message: string }[];
  inlineStyles?: Record<string, Record<string, string>>;
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

  // Buttons with mixed content → text block, strip icons
  if (tag === "button" && hasTextOrInline) {
    return [makeTextBlock($el, $, opts)];
  }

  // Note: only raw text nodes (hasMeaningfulText) trigger FIX_SOURCE here.
  // Tagged inline elements (<a>, <span>, etc.) are convertible to text blocks
  // and should NOT block decomposition of their parent.
  if (hasBlockChildren && hasMeaningfulText) {
    // Raw text mixed with block children → hard fail (user must fix source)
    if (tag === "div") {
      opts.hardFails.push({
        code: "FIX_SOURCE",
        message: `<div> contains raw text mixed with block children. Wrap bare text in <span> or <p>. "${textPreview($el)}"`,
      });
      return []; // skip the element — produce no blocks
    }
    return makeCoreHtmlFallback($el, $, opts.warnings, tag);
  }

  // 4. All inline/text → text block (only for non-container tags)
  //    Container tags always stay as element blocks (they're semantic wrappers)
  if (!hasBlockChildren && (hasMeaningfulText || hasInlineElements)) {
    if (SEMANTIC_CONTAINER_TAGS.has(tag)) {
      // Hard-fail only for raw text (e.g. <section>Hello</section>).
      // Inline elements like standalone <a> are valid — they produce text blocks.
      if (hasMeaningfulText) {
        opts.hardFails.push({
          code: "FIX_SOURCE",
          message: `<${tag}> contains raw text without a block wrapper. Wrap text in <p> or other block tag. "${textPreview($el)}"`,
        });
        return []; // skip the element — produce no blocks
      }
      // Inline elements only — produce text block from the container
      return [makeTextBlock($el, $, opts)];
    }
    return [makeTextBlock($el, $, opts)];
  }

  // 5. Determine block type from tag
  const block = makeBlockByTag($el, $, tag, opts);

  if (!block) {
    // Unrecognized → core/html
    opts.warnings.push(`Unrecognized tag <${tag}> → core/html`);
    return [makeCoreHtmlBlock($el, $)];
  }

  // 6. Recurse into all tag children (inline → text blocks, block → element blocks)
  if (block.innerBlocks !== undefined) {
    $el.children().each((_, child) => {
      if (child.type !== "tag") return;
      const childTag = (child as any).name?.toLowerCase() || "";
      const $child = $(child);

      // core-html wrappers stay as raw HTML
      if ($child.attr("data-gb-wrap") === "core-html") {
        block.innerBlocks!.push(...walkElement($child, $, opts));
        return;
      }

      // All tagged children are processed — inline elements become
      // text blocks, block elements become element/shape/media blocks.
      // HTML comments are skipped (child.type !== "tag" guard above).
      block.innerBlocks!.push(...walkElement($child, $, opts));
    });
  }

  return [block];
}

// ── Block factories ────────────────────────────────────────

function makeCoreHtmlBlock(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
): Block {
  // Preserve the entire wrapper element as raw HTML, including its own
  // attributes (style, class, etc.). Strip the data-gb-wrap marker.
  const $clone = $el.clone();
  $clone.removeAttr("data-gb-wrap");
  return {
    blockName: "core/html",
    uniqueId: nextId("core"),
    styles: {},
    css: "",
    innerBlocks: [],
    html: stripHtmlComments($.html($clone)) || "",
  };
}

/** Strip HTML comment nodes from a string of innerHTML/outerHTML. */
function stripHtmlComments(html: string | null): string {
  if (!html) return "";
  return html.replace(/<!--[\s\S]*?-->/g, "");
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

  // Query computed styles from the classifier and remove path attr before extraction
  const textPath = $el.attr("data-gb-path");
  $el.removeAttr("data-gb-path");
  if (textPath && opts.inlineStyles?.[textPath]) {
    Object.assign(styles, opts.inlineStyles[textPath]);
  }

  const htmlAttributes = extractHtmlAttributes($el);
  const globalClasses = extractGlobalClasses($el, opts);

  // Content is innerHTML (preserves inline formatting, strips comments)
  const content = stripHtmlComments($el.html()) || $el.text() || "";

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

  // Query computed styles from the classifier and remove path attr before extraction
  const elemPath = $el.attr("data-gb-path");
  $el.removeAttr("data-gb-path");
  if (elemPath && opts.inlineStyles?.[elemPath]) {
    Object.assign(styles, opts.inlineStyles[elemPath]);
  }

  const htmlAttributes = extractHtmlAttributes($el);
  const globalClasses = extractGlobalClasses($el, opts);

  // Query computed styles from the classifier (direct lookup, no HTML round-trip)
  const path = $el.attr("data-gb-path");
  if (path && opts.inlineStyles?.[path]) {
    Object.assign(styles, opts.inlineStyles[path]);
  }
  // Remove data-gb-path (internal marker, don't leak into output)
  $el.removeAttr("data-gb-path");

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

  const globalClasses = extractGlobalClasses($el, opts);

  // Query computed styles from the classifier
  const path = $el.attr("data-gb-path");
  if (path && opts.inlineStyles?.[path]) {
    Object.assign(styles, opts.inlineStyles[path]);
  }
  $el.removeAttr("data-gb-path");

  return {
    blockName: "generateblocks/media",
    uniqueId: nextId("img"),
    tagName: "img",
    styles,
    css,
    globalClasses: globalClasses.length > 0 ? globalClasses : undefined,
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

  // Query computed styles from the classifier
  const path = $el.attr("data-gb-path");
  if (path && opts.inlineStyles?.[path]) {
    Object.assign(styles, opts.inlineStyles[path]);
  }
  $el.removeAttr("data-gb-path");

  return {
    blockName: "generateblocks/shape",
    uniqueId: nextId("shape"),
    html: stripHtmlComments($.html($el)),
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
    // Map nav and footer to section for WordPress compatibility
    const outputTag = (tag === "nav" || tag === "footer") ? "section" : tag;
    return makeElementBlock($el, $, outputTag, opts);
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
    // Track reusable classes from <head> styles for global-styles manifest
    if (opts.classNameToProperties.has(className)) {
      opts.collector.recordUsage(className);
    }
    // Preserve ALL class tokens in globalClasses
    result.push(className);
  });

  return result;
}

// ── Entry point ────────────────────────────────────────────

export interface WalkResult {
  blocks: Block[];
  warnings: string[];
  hardFails: { code: string; message: string }[];
}

export function walkDom(
  html: string,
  classNameToProperties: Map<string, BlockStyles>,
  collector: GlobalStylesCollector,
  allowNavFooter?: boolean,
  inlineStyles?: Record<string, Record<string, string>>,
): WalkResult {
  const warnings: string[] = [];
  const hardFails: { code: string; message: string }[] = [];
  const $ = cheerio.load(`<div>${html}</div>`);

  const opts: WalkerOptions = { classNameToProperties, collector, warnings, hardFails, inlineStyles };
  const blocks: Block[] = [];

  // Walk top-level children of the wrapper div only
  const $wrapper = $("body > div, div").first();
  if ($wrapper.length > 0) {
    $wrapper.children().each((_, el) => {
      const tag = (el as any).name?.toLowerCase() || "";
      if (!allowNavFooter && (tag === "nav" || tag === "footer")) return;
      if (tag === "script" || tag === "style") return;

      const $el = $(el);
      blocks.push(...walkElement($el, $, opts));
    });
  }

  return { blocks, warnings, hardFails };
}
