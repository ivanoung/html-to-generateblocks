// ── Mapper ────────────────────────────────────────────────────
//
// Converts a FixtureNode tree into an array of Block representations.
// Handles all routing rules from the spec: element→elem, text→text,
// CTA→elem<a>+text<span>, image→core/image or media, embed, fallback.

import type { Block, FixtureNode, BlockStyles } from "./types.js";
import { nextId } from "./id-generator.js";
import { parseStyleString } from "./style-parser.js";

// ── Mapping options ───────────────────────────────────────────

export interface MappingResult {
  blocks: Block[];
  warnings: string[];
}

// ── Node type detection ───────────────────────────────────────

/** Container/layout tags map to generateblocks/element. */
const CONTAINER_TAGS = new Set([
  "div", "section", "article", "aside", "header", "footer",
  "nav", "main", "figure", "ul", "ol", "li", "dl", "dt", "dd",
]);

/** Check if a node contains only text leaf children. */
function hasOnlyTextChildren(node: FixtureNode): boolean {
  if (node.nodeType !== "element") return false;
  return node.children.length > 0 && node.children.every(
    (c) => c.nodeType === "text"
  );
}

// ── Main mapping function ─────────────────────────────────────

/**
 * Map a single FixtureNode to an array of Blocks.
 * Returns array because one node may produce multiple blocks
 * (e.g., element<a> + nested text<span> are two blocks).
 */
export function mapNode(node: FixtureNode): MappingResult {
  const warnings: string[] = [];

  switch (node.nodeType) {
    case "element":
      return mapElementNode(node, warnings);
    case "text":
      return { blocks: [mapTextNode(node)], warnings };
    case "image":
      return mapImageNode(node, warnings);
    case "embed":
      return mapEmbedNode(node, warnings);
    case "html":
      return { blocks: [mapHtmlNode(node)], warnings };
    default:
      warnings.push(`Unknown node type, falling back to core/html`);
      return {
        blocks: [{
          blockName: "core/html",
          uniqueId: nextId("core"),
          styles: {},
          css: "",
          innerBlocks: [],
          html: `<div>Unsupported content</div>`,
        }],
        warnings,
      };
  }
}

// ── Element node handling ─────────────────────────────────────

function mapElementNode(
  node: import("./types.js").ElementNode,
  warnings: string[]
): MappingResult {
  const tag = node.tagName.toLowerCase();

  // Special case: element <a> with text children → use CTA pattern
  if (tag === "a" && hasOnlyTextChildren(node)) {
    return mapCtaLink(node, warnings);
  }

  // The text inside element <a> can have non-text mixed, we still allow 
  // element treatment but flag it
  if (tag === "a" && node.children.length > 0) {
    const nonTextChildren = node.children.filter(c => c.nodeType !== "text");
    if (nonTextChildren.length > 0 && node.children.some(c => c.nodeType === "text")) {
      warnings.push("Element <a> has mixed text and non-text children; text children dropped");
    }
  }

  // Parse style
  const { styles, css, warnings: styleWarnings } = parseStyleString(node.style);
  warnings.push(...styleWarnings);

  // Build htmlAttributes from element's attributes
  const htmlAttributes: Record<string, string> = { ...node.attributes };

  // Recursively map children
  const innerBlocks: Block[] = [];
  for (const child of node.children) {
    const { blocks, warnings: childWarnings } = mapNode(child);
    innerBlocks.push(...blocks);
    warnings.push(...childWarnings.map((w) => `[child] ${w}`));
  }

  const block: Block = {
    blockName: "generateblocks/element",
    uniqueId: nextId("elem"),
    tagName: tag,
    styles,
    css,
    globalClasses: [],
    htmlAttributes: Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
    innerBlocks,
    idGenType: "elem",
  };

  return { blocks: [block], warnings };
}

// ── CTA link pattern ──────────────────────────────────────────
//
// element <a> with text children → outer element<a> + inner text<span> child blocks

function mapCtaLink(
  node: import("./types.js").ElementNode,
  warnings: string[]
): MappingResult {
  // Parse style for the outer element
  const { styles, css, warnings: styleWarnings } = parseStyleString(node.style);
  warnings.push(...styleWarnings);

  // Build htmlAttributes from element attributes
  const htmlAttributes: Record<string, string> = { ...node.attributes };

  // Map text children to inner text blocks
  const innerBlocks: Block[] = [];
  for (const child of node.children) {
    if (child.nodeType === "text") {
      const { styles: childStyles, css: childCss } = parseStyleString(child.style);
      const textBlock: Block = {
        blockName: "generateblocks/text",
        uniqueId: nextId("text"),
        tagName: child.tagName.toLowerCase(),
        content: child.text,
        styles: childStyles,
        css: childCss,
        globalClasses: [],
        innerBlocks: [],
        idGenType: "text",
      };
      innerBlocks.push(textBlock);
    }
  }

  const elementBlock: Block = {
    blockName: "generateblocks/element",
    uniqueId: nextId("elem"),
    tagName: "a",
    styles,
    css,
    globalClasses: [],
    htmlAttributes: Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
    innerBlocks,
    idGenType: "elem",
  };

  return { blocks: [elementBlock], warnings };
}

// ── Text node handling ────────────────────────────────────────

function mapTextNode(node: import("./types.js").TextNode): Block {
  const { styles, css, warnings: _warnings } = parseStyleString(node.style);

  return {
    blockName: "generateblocks/text",
    uniqueId: nextId("text"),
    tagName: node.tagName.toLowerCase(),
    content: node.text,
    styles,
    css,
    globalClasses: [],
    innerBlocks: [],
    idGenType: "text",
  };
}

// ── Image node handling ───────────────────────────────────────

function mapImageNode(
  node: import("./types.js").ImageNode,
  warnings: string[]
): MappingResult {
  const hasCaption = Boolean(node.caption && node.caption.trim().length > 0);

  if (hasCaption) {
    // Route to core/image
    const { styles, css, warnings: styleWarnings } = parseStyleString(node.style);
    warnings.push(...styleWarnings);

    // For core/image, we store style info to be applied as inline style
    // on the rendered img tag
    const block: Block = {
      blockName: "image",
      uniqueId: nextId("core"),
      url: node.src,
      alt: node.alt,
      width: node.width,
      height: node.height,
      caption: node.caption,
      tagName: "figure",
      styles,
      css,
      innerBlocks: [],
      idGenType: "core",
    };

    // Warning: core/image doesn't use GB styles — only CSS is relevant
    if (Object.keys(styles).length > 0) {
      warnings.push("core/image received styles; only css string is applicable (inline style)");
    }

    return { blocks: [block], warnings };
  }

  // Route to generateblocks/media
  const { styles, css, warnings: styleWarnings } = parseStyleString(node.style);
  warnings.push(...styleWarnings);

  const htmlAttributes: Record<string, string> = {
    src: node.src,
    alt: node.alt,
  };
  if (node.width !== undefined) htmlAttributes.width = String(node.width);
  if (node.height !== undefined) htmlAttributes.height = String(node.height);

  const block: Block = {
    blockName: "generateblocks/media",
    uniqueId: nextId("img"),
    tagName: "img",
    styles,
    css,
    globalClasses: [],
    htmlAttributes,
    mediaId: 0,
    innerBlocks: [],
    idGenType: "img",
  };

  return { blocks: [block], warnings };
}

// ── Embed node handling ───────────────────────────────────────

function mapEmbedNode(
  node: import("./types.js").EmbedNode,
  warnings: string[]
): MappingResult {
  // Try core/embed
  const knownProviders = new Set(["youtube", "vimeo", "twitter", "x", "instagram", "tiktok", "soundcloud", "spotify", "twitch"]);
  const provider = node.provider.toLowerCase();

  if (knownProviders.has(provider)) {
    const providerMap: Record<string, string> = {
      "x": "twitter",
    };
    const providerNameSlug = providerMap[provider] ?? provider;

    warnings.push({
      code: "downgraded-to-core-block",
      message: `Node mapped to core/embed (${provider}) instead of GB block`,
    } as any);

    const block: Block = {
      blockName: "core/embed",
      uniqueId: nextId("core"),
      url: node.url,
      providerNameSlug,
      responsive: true,
      type: "video",
      styles: {},
      css: "",
      innerBlocks: [],
      idGenType: "core",
    };

    return { blocks: [block], warnings };
  }

  // Unknown provider → core/html fallback
  warnings.push({
    code: "downgraded-to-core-block",
    message: `Unknown embed provider "${node.provider}", falling back to core/html`,
  } as any);

  const fallbackHtml = `<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><a href="${escapeHtml(node.url)}">${escapeHtml(node.url)}</a></div></figure>`;

  const block: Block = {
    blockName: "core/html",
    uniqueId: nextId("core"),
    html: fallbackHtml,
    styles: {},
    css: "",
    innerBlocks: [],
    idGenType: "core",
  };

  return { blocks: [block], warnings };
}

// ── HTML fallback node ────────────────────────────────────────

function mapHtmlNode(node: import("./types.js").HtmlNode): Block {
  return {
    blockName: "core/html",
    uniqueId: nextId("core"),
    html: node.html,
    styles: {},
    css: "",
    innerBlocks: [],
    idGenType: "core",
  };
}

// ── Helpers ───────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
