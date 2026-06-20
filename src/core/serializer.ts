// ── Serializer ─────────────────────────────────────────────────
//
// Converts Block array into WordPress paste-ready block markup.
// Canonical key ordering, 4 JSON escapes, block delimiters,
// rendered HTML with correct class patterns.

import type { Block } from "./types.js";

// ── CSS formatting ────────────────────────────────────────────

/**
 * Format raw property:value pairs into a full CSS rule with the
 * correct selector prefix for each block type.
 * Example: `.gb-element-elem001{color:#111;font-size:2rem}`
 */
function formatCss(block: Block, rawCss: string): string {
  if (!rawCss || rawCss.trim() === "") return "";

  // If CSS already starts with a selector or @-rule, pass through unchanged
  if (rawCss.trim().startsWith(".") || rawCss.trim().startsWith("@")) {
    return rawCss;
  }

  const id = block.uniqueId;
  let selector: string;

  switch (block.blockName) {
    case "generateblocks/element":
      selector = `.gb-element-${id}`;
      break;
    case "generateblocks/text":
      selector = `.gb-text-${id}`;
      break;
    case "generateblocks/media":
      selector = `.gb-media-${id}`;
      break;
    case "generateblocks/shape":
      selector = `.gb-shape-${id}`;
      break;
    default:
      return rawCss; // core blocks use raw css
  }

  // Remove trailing semicolon for consistency, add clean closing
  const clean = rawCss.replace(/;+$/, "");
  return `${selector}{${clean}}`;
}

// ── Build canonical attribute objects ─────────────────────────

/**
 * Build the attributes object in CANONICAL KEY ORDER for each block type.
 * Keys not present are omitted (unchanged from default).
 */

function buildElementAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.uniqueId = block.uniqueId;
  attrs.tagName = block.tagName ?? "div";

  const stylesEmpty = !block.styles || Object.keys(block.styles).length === 0;
  attrs.styles = stylesEmpty ? {} : block.styles;
  attrs.css = formatCss(block, block.css || "");

  if (block.globalClasses && block.globalClasses.length > 0) {
    attrs.globalClasses = block.globalClasses;
  }
  if (block.htmlAttributes && Object.keys(block.htmlAttributes).length > 0) {
    attrs.htmlAttributes = block.htmlAttributes;
  }
  if (block.align) {
    attrs.align = block.align;
  }

  return attrs;
}

function buildTextAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.uniqueId = block.uniqueId;
  attrs.tagName = block.tagName ?? "p";
  // content is a rich-text sourced attribute — WordPress extracts it from the
  // HTML body via the .gb-text selector. Including it in JSON causes WordPress
  // to strip it on save → string diff → recovery. Do NOT emit content here.
  // attrs.content = block.content ?? "";  // ← REMOVED per WP round-trip test

  const stylesEmpty = !block.styles || Object.keys(block.styles).length === 0;
  attrs.styles = stylesEmpty ? {} : block.styles;
  attrs.css = formatCss(block, block.css || "");

  if (block.globalClasses && block.globalClasses.length > 0) {
    attrs.globalClasses = block.globalClasses;
  }
  if (block.htmlAttributes && Object.keys(block.htmlAttributes).length > 0) {
    attrs.htmlAttributes = block.htmlAttributes;
  }
  if (block.icon) attrs.icon = block.icon;
  if (block.iconLocation && block.iconLocation !== "before") attrs.iconLocation = block.iconLocation;
  if (block.iconOnly) attrs.iconOnly = block.iconOnly;

  return attrs;
}

function buildMediaAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.uniqueId = block.uniqueId;
  attrs.tagName = block.tagName ?? "img";

  const stylesEmpty = !block.styles || Object.keys(block.styles).length === 0;
  attrs.styles = stylesEmpty ? {} : block.styles;
  attrs.css = formatCss(block, block.css || "");

  if (block.globalClasses && block.globalClasses.length > 0) {
    attrs.globalClasses = block.globalClasses;
  }
  if (block.htmlAttributes && Object.keys(block.htmlAttributes).length > 0) {
    attrs.htmlAttributes = block.htmlAttributes;
  }
  if (block.mediaId !== undefined && block.mediaId > 0) {
    attrs.mediaId = block.mediaId;
  }
  if (block.linkHtmlAttributes && Object.keys(block.linkHtmlAttributes).length > 0) {
    attrs.linkHtmlAttributes = block.linkHtmlAttributes;
  }

  return attrs;
}

function buildCoreImageAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  // WordPress core/image stores src and alt in the rendered HTML only,
  // not as block attributes. The key attributes are sizeSlug and linkDestination.
  attrs.sizeSlug = "full";
  attrs.linkDestination = "none";
  return attrs;
}

function buildShapeAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.uniqueId = block.uniqueId;
  attrs.html = block.html ?? "";
  const stylesEmpty = !block.styles || Object.keys(block.styles).length === 0;
  attrs.styles = stylesEmpty ? {} : block.styles;
  attrs.css = block.css || "";
  if (block.globalClasses?.length) attrs.globalClasses = block.globalClasses;
  if (block.htmlAttributes && Object.keys(block.htmlAttributes).length > 0) {
    attrs.htmlAttributes = block.htmlAttributes;
  }
  return attrs;
}

function buildCoreQuoteAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.value = block.content ?? "";
  attrs.citation = block.htmlAttributes?.citation ?? "";
  return attrs;
}

function buildCoreListAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  attrs.ordered = block.tagName === "ol";
  attrs.values = block.html ?? "";
  return attrs;
}

function buildCoreEmbedAttrs(block: Block): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (block.url) attrs.url = block.url;
  if (block.providerNameSlug) attrs.providerNameSlug = block.providerNameSlug;
  attrs.responsive = true;
  attrs.type = block.type ?? "video";
  return attrs;
}

// ── JSON serialization with escaping ──────────────────────────

function serializeAttributes(attrs: Record<string, unknown>): string {
  // WordPress serialization order: JSON.stringify FIRST, then substitute
  // special characters on the JSON string. Doing it the other way around
  // causes double-escaping: \u0026 → \\u0026 via JSON.stringify.
  const json = JSON.stringify(attrs, null, 0); // compact, no whitespace
  // Apply the four WordPress-safe substitutions to the JSON string
  return json
    .replace(/--/g, "\\u002d\\u002d")
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

// ── HTML escaping for RENDERED HTML context ───────────────────

function htmlAttrEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHtmlAttributes(attrs?: Record<string, string>): string {
  if (!attrs || Object.keys(attrs).length === 0) return "";
  return " " + Object.entries(attrs)
    .map(([k, v]) => `${k}="${htmlAttrEncode(v)}"`)
    .join(" ");
}

// ── Rendered HTML generation ──────────────────────────────────

function renderElementHtml(block: Block): string {
  const tag = block.tagName ?? "div";
  const gbClasses = `gb-element-${block.uniqueId} gb-element`;
  const globalClasses = (block.globalClasses || []).join(" ");
  const classes = globalClasses
    ? `${gbClasses} ${globalClasses}`
    : gbClasses;
  const attrs = renderHtmlAttributes(block.htmlAttributes);
  const alignClass = block.align ? ` ${block.align === "full" ? "alignfull" : block.align}` : "";

  return `<${tag} class="${classes}${alignClass}"${attrs}>`;
}

function renderTextHtml(block: Block): string {
  const tag = block.tagName ?? "p";
  const hasStyles = block.styles && Object.keys(block.styles).length > 0;
  // Text uses base-first pattern: gb-text gb-text-{id} (always emitted)
  const gbClasses = `gb-text gb-text-${block.uniqueId}`;
  const globalClasses = (block.globalClasses || []).join(" ");
  const classes = globalClasses
    ? `${gbClasses} ${globalClasses}`
    : gbClasses;

  // htmlAttributes on text blocks (used for <a> links: href, target, rel)
  const attrs = renderHtmlAttributes(block.htmlAttributes);

  const content = block.content ?? "";
  return `<${tag} class="${classes}"${attrs}>${content}</${tag}>`;
}

function renderMediaHtml(block: Block): string {
  const gbClasses = `gb-media-${block.uniqueId} gb-media`;
  const globalClasses = (block.globalClasses || []).join(" ");
  const classes = globalClasses
    ? `${gbClasses} ${globalClasses}`
    : gbClasses;
  const attrs = renderHtmlAttributes(block.htmlAttributes);

  const imgTag = `<img class="${classes}"${attrs} />`;

  // Check if linked
  if (block.linkHtmlAttributes && Object.keys(block.linkHtmlAttributes).length > 0) {
    const linkAttrs = renderHtmlAttributes(block.linkHtmlAttributes);
    return `<a${linkAttrs}>${imgTag}</a>`;
  }

  return imgTag;
}

function renderCoreImageHtml(block: Block): string {
  // Core/image stores src and alt in the rendered HTML only.
  // No width/height on the img tag (WordPress derives from attachment metadata).
  // No inline style (core/image doesn't support GB-style inline styles).
  const attrs: Record<string, string> = {};
  if (block.url) attrs.src = block.url;
  if (block.alt) attrs.alt = block.alt;

  const imgAttrs = Object.entries(attrs)
    .map(([k, v]) => `${k}="${htmlAttrEncode(v)}"`)
    .join(" ");

  const caption = block.caption
    ? `<figcaption class="wp-element-caption">${htmlAttrEncode(block.caption)}</figcaption>`
    : "";

  return `<figure class="wp-block-image size-full"><img ${imgAttrs}/>${caption}</figure>`;
}

function renderCoreEmbedHtml(block: Block): string {
  const provider = block.providerNameSlug ?? "unknown";
  const type = block.type ?? "video";
  const url = block.url ?? "";

  return `<figure class="wp-block-embed is-type-${type} is-provider-${provider} wp-block-embed-${provider}"><div class="wp-block-embed__wrapper">${htmlAttrEncode(url)}</div></figure>`;
}

function renderShapeHtml(block: Block): string {
  const gbClasses = `gb-shape gb-shape-${block.uniqueId}`;
  const globalClasses = (block.globalClasses || []).join(" ");
  const classes = globalClasses
    ? `${gbClasses} ${globalClasses}`
    : gbClasses;
  const svg = block.html ?? "";
  return `<span class="${classes}">${svg}</span>`;
}

function renderCoreQuoteHtml(block: Block): string {
  const value = block.content ?? "";
  const citation = block.htmlAttributes?.citation ?? "";
  const citeHtml = citation ? `<cite>${citation}</cite>` : "";
  return `<blockquote class="wp-block-quote"><p>${value}</p>${citeHtml}</blockquote>`;
}

function renderCoreListHtml(block: Block): string {
  const tag = block.tagName === "ol" ? "ol" : "ul";
  const items = block.html ?? "";
  return `<${tag}>${items}</${tag}>`;
}

function renderCoreHtmlHtml(block: Block): string {
  return block.html ?? "";
}

// ── Block serialization (single block, recursive) ─────────────

interface SerializedBlock {
  opener: string;   // <!-- wp:... -->
  html: string;     // rendered HTML (leaf: full element; container: opening tag only)
  closer: string;   // <!-- /wp:... -->
  closeTag: string; // closing HTML tag for container blocks (e.g., "</section>"), empty for leaf
  inner: SerializedBlock[];
}

function serializeSingleBlock(block: Block): SerializedBlock {
  const name = block.blockName;
  let attrs: Record<string, unknown> = {};
  let html = "";
  let closeTag = "";
  let inner: SerializedBlock[] = [];

  switch (name) {
    case "generateblocks/element":
      attrs = buildElementAttrs(block);
      html = renderElementHtml(block);
      closeTag = `</${block.tagName ?? "div"}>`;
      inner = block.innerBlocks.map(serializeSingleBlock);
      break;

    case "generateblocks/text":
      attrs = buildTextAttrs(block);
      html = renderTextHtml(block);
      inner = []; // text is leaf
      break;

    case "generateblocks/media":
      attrs = buildMediaAttrs(block);
      html = renderMediaHtml(block);
      inner = [];
      break;

    case "core/image":
    case "image":
      attrs = buildCoreImageAttrs(block);
      html = renderCoreImageHtml(block);
      inner = [];
      break;

    case "core/embed":
      attrs = buildCoreEmbedAttrs(block);
      html = renderCoreEmbedHtml(block);
      inner = [];
      break;

    case "core/list":
      attrs = buildCoreListAttrs(block);
      html = renderCoreListHtml(block);
      inner = [];
      break;

    case "generateblocks/shape":
      attrs = buildShapeAttrs(block);
      html = renderShapeHtml(block);
      inner = [];
      break;

    case "core/quote":
      attrs = buildCoreQuoteAttrs(block);
      html = renderCoreQuoteHtml(block);
      inner = [];
      break;

    case "core/html":
      html = renderCoreHtmlHtml(block);
      inner = [];
      // core/html has no JSON attrs in the delimiter
      break;

    default:
      // Fallback to core/html
      attrs = {};
      html = block.html ?? `<div>Unknown block: ${name}</div>`;
      inner = [];
  }

  const jsonStr = serializeAttributes(attrs);
  const opener = name === "core/html" && !jsonStr
    ? `<!-- wp:${name} -->`
    : `<!-- wp:${name} ${jsonStr} -->`;
  const closer = `<!-- /wp:${name} -->`;

  return { opener, html, closer, closeTag, inner };
}

// ── Output assembly ───────────────────────────────────────────

function renderBlockToLines(sb: SerializedBlock, indent: string): string[] {
  const lines: string[] = [];

  lines.push(`${indent}${sb.opener}`);

  if (sb.inner.length > 0) {
    // Container with children: open tag, children, closing HTML tag, closer
    lines.push(`${indent}${sb.html}`);
    for (const child of sb.inner) {
      lines.push(...renderBlockToLines(child, indent + "    "));
    }
    if (sb.closeTag) {
      lines.push(`${indent}${sb.closeTag}`);
    }
    lines.push(`${indent}${sb.closer}`);
  } else if (sb.closeTag) {
    // Leaf container (empty element): open tag + close tag on same line, then closer
    lines.push(`${indent}${sb.html}${sb.closeTag}`);
    lines.push(`${indent}${sb.closer}`);
  } else {
    // True leaf block: opener, HTML content, closer — each on its own line
    lines.push(`${indent}${sb.html}`);
    lines.push(`${indent}${sb.closer}`);
  }

  return lines;
}

// ── Main serializer entry point ───────────────────────────────

export function serializeBlocks(blocks: Block[]): string {
  const sbArray = blocks.map(serializeSingleBlock);
  const resultLines: string[] = [];

  for (const sb of sbArray) {
    resultLines.push(...renderBlockToLines(sb, ""));
  }

  return resultLines.join("\n") + "\n";
}

/**
 * Count total blocks including nested (for report blockCount).
 */
export function countBlocks(blocks: Block[]): number {
  let count = 0;
  for (const b of blocks) {
    count += 1 + countBlocks(b.innerBlocks);
  }
  return count;
}
