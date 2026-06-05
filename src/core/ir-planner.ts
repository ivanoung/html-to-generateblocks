// ── IR Planner ─────────────────────────────────────────────────
//
// Converts IRNode tree into Block[] for serialization.
// The "plan-blocks" step in the M2 pipeline.
//
// Covers: section, container, heading, paragraph, span, button-link.
// Other IR types stub with errors for later phases.

import type { Block, BlockStyles } from "./types.js";
import type { IRNode } from "./ir-node.js";
import { nextId } from "./id-generator.js";
import { parseStyleString } from "./style-parser.js";

export interface PlanResult {
  blocks: Block[];
  errors: string[];
}

/**
 * Convert an IRNode tree into a flat Block array.
 * `reject` fallback produces an error and no blocks.
 * Unknown node types produce an error and no blocks.
 */
export function planBlocks(node: IRNode): PlanResult {
  const errors: string[] = [];

  if (node.fallbackPolicy === "reject") {
    const tag = node.tagName ?? node.nodeType;
    errors.push(`UNSUPPORTED: "${tag}" rejected by fallbackPolicy (type: ${node.nodeType})`);
    return { blocks: [], errors };
  }

  switch (node.nodeType) {
    case "section":
    case "container":
      return planContainer(node, errors);
    case "heading":
    case "paragraph":
    case "span":
      return planText(node, errors);
    case "button-link":
      return planButtonLink(node, errors);
    case "image":
      return planImage(node, errors);
    case "list":
      return planList(node, errors);
    case "quote":
      return planQuote(node, errors);
    case "icon":
      return planIcon(node, errors);
    default:
      errors.push(`UNKNOWN: IR node type "${(node as any).nodeType}"`);
      return { blocks: [], errors };
  }
}

// ── Container (section/container → generateblocks/element) ─────

function planContainer(node: IRNode, errors: string[]): PlanResult {
  // Route core/html embeds: containers with fallbackPolicy "core" and html payload
  if (node.fallbackPolicy === "core" && node.html) {
    return planCoreHtml(node, errors);
  }

  const tag = node.tagName ?? "div";
  const rawStyle = styleIntentToString(node.styleIntent);
  const { styles: baseStyles, css: baseCss } = parseStyleString(rawStyle);
  const htmlAttributes = { ...node.attributes };
  const blockId = nextId("elem");
  const blockName = "generateblocks/element";

  const { styles, css } = buildResponsive(
    blockId, blockName, baseStyles, baseCss, node.responsiveIntent,
  );

  const innerBlocks: Block[] = [];
  for (const child of node.children) {
    const r = planBlocks(child);
    innerBlocks.push(...r.blocks);
    errors.push(...r.errors);
  }

  return {
    blocks: [{
      blockName,
      uniqueId: blockId,
      tagName: tag,
      styles,
      css,
      globalClasses: [],
      htmlAttributes: Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
      innerBlocks,
      idGenType: "elem",
    }],
    errors,
  };
}

// ── Core/HTML embed ───────────────────────────────────────────

function planCoreHtml(node: IRNode, errors: string[]): PlanResult {
  // Collect HTML from self and direct children with html payloads
  const htmlFragments: string[] = [];
  if (node.html) htmlFragments.push(node.html);
  for (const child of node.children) {
    if (child.html) htmlFragments.push(child.html);
  }

  return {
    blocks: [{
      blockName: "core/html",
      uniqueId: nextId("core"),
      html: htmlFragments.join("\n"),
      styles: {},
      css: "",
      innerBlocks: [],
      idGenType: "core",
    }],
    errors,
  };
}

// ── Text (heading/paragraph/span → generateblocks/text) ────────

function planText(node: IRNode, errors: string[]): PlanResult {
  const tag =
    node.tagName ||
    (node.nodeType === "heading" ? "h2" : "p");
  const rawStyle = styleIntentToString(node.styleIntent);
  const { styles: baseStyles, css: baseCss } = parseStyleString(rawStyle);
  const blockId = nextId("text");
  const blockName = "generateblocks/text";

  const { styles, css } = buildResponsive(
    blockId, blockName, baseStyles, baseCss, node.responsiveIntent,
  );

  return {
    blocks: [{
      blockName,
      uniqueId: blockId,
      tagName: tag,
      content: node.textContent,
      styles,
      css,
      globalClasses: [],
      innerBlocks: [],
      idGenType: "text",
    }],
    errors,
  };
}

// ── Button-link (generateblocks/text with tagName:"a") ─────────

function planButtonLink(node: IRNode, errors: string[]): PlanResult {
  const rawStyle = styleIntentToString(node.styleIntent);
  const { styles, css } = parseStyleString(rawStyle);
  const htmlAttributes = { ...node.attributes };

  // Text content from children (span/paragraph) or direct textContent
  const fromChildren = node.children
    .filter((c) => c.nodeType === "span" || c.nodeType === "paragraph")
    .map((c) => c.textContent ?? "")
    .join("");
  const textContent = fromChildren || node.textContent || "";

  return {
    blocks: [{
      blockName: "generateblocks/text",
      uniqueId: nextId("text"),
      tagName: "a",
      content: textContent,
      styles,
      css,
      globalClasses: [],
      htmlAttributes: Object.keys(htmlAttributes).length > 0 ? htmlAttributes : undefined,
      innerBlocks: [],
      idGenType: "text",
    }],
    errors,
  };
}

// ── Image → core/image or generateblocks/media ─────────────────

function planImage(node: IRNode, errors: string[]): PlanResult {
  const rawStyle = styleIntentToString(node.styleIntent);
  const { styles: baseStyles, css: baseCss } = parseStyleString(rawStyle);
  const alt = node.attributes?.alt ?? "";
  const src = node.attributes?.src ?? "";
  const caption = node.attributes?.caption;

  if (caption) {
    return {
      blocks: [{
        blockName: "image",
        uniqueId: nextId("core"),
        url: src,
        alt,
        caption,
        styles: baseStyles,
        css: baseCss,
        innerBlocks: [],
        idGenType: "core",
      }],
      errors,
    };
  }

  const blockId = nextId("img");
  const blockName = "generateblocks/media";
  const { styles, css } = buildResponsive(
    blockId, blockName, baseStyles, baseCss, node.responsiveIntent,
  );

  return {
    blocks: [{
      blockName,
      uniqueId: blockId,
      tagName: "img",
      styles,
      css,
      globalClasses: [],
      htmlAttributes: { src, alt },
      mediaId: 0,
      innerBlocks: [],
      idGenType: "img",
    }],
    errors,
  };
}

// ── List → core/list ───────────────────────────────────────────

function planList(node: IRNode, errors: string[]): PlanResult {
  if (node.fallbackPolicy === "core") {
    const ordered = node.attributes?.ordered === "true";
    const items = node.children
      .filter((c) => c.textContent)
      .map((c) => `<li>${c.textContent ?? ""}</li>`)
      .join("");

    return {
      blocks: [{
        blockName: "core/list",
        uniqueId: nextId("core"),
        styles: {},
        css: "",
        innerBlocks: [],
        idGenType: "core",
        // Store list values as html for serializer
        html: items,
        // Pass ordered flag via tagName convention
        tagName: ordered ? "ol" : "ul",
      }],
      errors,
    };
  }

  errors.push(`List block requires fallbackPolicy "core"`);
  return { blocks: [], errors };
}

// ── Quote → core/quote ─────────────────────────────────────────

function planQuote(node: IRNode, errors: string[]): PlanResult {
  if (node.fallbackPolicy === "core") {
    const block: Block = {
      blockName: "core/quote",
      uniqueId: nextId("core"),
      content: node.textContent ?? "",
      styles: {},
      css: "",
      globalClasses: [],
      innerBlocks: [],
      idGenType: "core",
      htmlAttributes: {},
    };
    // Store citation in htmlAttributes
    if (node.attributes?.citation) {
      block.htmlAttributes = { citation: node.attributes.citation };
    }
    return { blocks: [block], errors };
  }

  errors.push(`Quote block requires fallbackPolicy "core"`);
  return { blocks: [], errors };
}

// ── Icon → generateblocks/shape ────────────────────────────────

function planIcon(node: IRNode, errors: string[]): PlanResult {
  const id = nextId("shape");

  const rawStyle = styleIntentToString(node.styleIntent);
  const { styles } = parseStyleString(rawStyle);

  // Build SVG CSS: .gb-shape-{id} svg{...}
  const svgCss = node.styleIntent
    ? Object.entries(node.styleIntent)
        .filter(([k]) => k.startsWith("svg:"))
        .map(([k, v]) => `${k.slice(4)}:${v}`)
        .sort()
        .join(";")
    : "";

  // Base CSS from non-svg properties — already sorted
  const baseCss = Object.entries(node.styleIntent || {})
    .filter(([k]) => !k.startsWith("svg:"))
    .map(([k, v]) => `${k}:${v}`)
    .sort()
    .join(";");

  // SVG styling in styles.svg
  const svgStyleObj: Record<string, string> = {};
  if (node.styleIntent) {
    for (const [k, v] of Object.entries(node.styleIntent)) {
      if (k.startsWith("svg:")) {
        svgStyleObj[k.slice(4)] = v;
      }
    }
  }

  const shapeStyles: BlockStyles = { ...styles };
  if (Object.keys(svgStyleObj).length > 0) {
    shapeStyles.svg = svgStyleObj;
  }

  // Construct full CSS with correct id
  const fullCss = baseCss
    ? `.gb-shape-${id}{${baseCss}}` + (svgCss ? `.gb-shape-${id} svg{${svgCss}}` : "")
    : "";

  return {
    blocks: [{
      blockName: "generateblocks/shape",
      uniqueId: id,
      html: node.html ?? node.attributes?.html ?? "",
      styles: shapeStyles,
      css: fullCss,
      globalClasses: [],
      innerBlocks: [],
      idGenType: "shape",
    }],
    errors,
  };
}

// ── Helpers ────────────────────────────────────────────────────

/** Convert IR styleIntent to raw CSS string for parseStyleString. */
function styleIntentToString(si?: Record<string, string>): string {
  if (!si || Object.keys(si).length === 0) return "";
  return Object.entries(si)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/** Build responsive styles and CSS from base + responsiveIntent. */
function buildResponsive(
  blockId: string,
  blockName: string,
  baseStyles: Record<string, unknown>,
  baseCss: string,
  responsiveIntent?: Record<string, Record<string, string>>,
): { styles: Record<string, unknown>; css: string } {
  const styles: Record<string, unknown> = { ...baseStyles };

  if (!responsiveIntent || Object.keys(responsiveIntent).length === 0) {
    return { styles, css: baseCss };
  }

  const prefix = blockName.replace("generateblocks/", "gb-");
  // Build full CSS with selector: .gb-element-{id}{base}@media(...){selector{override}}
  let fullCss = `.${prefix}-${blockId}{${baseCss}}`;

  for (const [bp, overrides] of Object.entries(responsiveIntent)) {
    const mq = `@media (max-width:${bp}px)`;

    const overrideStyles: Record<string, string> = {};
    const overrideCss: string[] = [];

    for (const [k, v] of Object.entries(overrides)) {
      const camel = toCamelCase(k);
      overrideStyles[camel] = v;
      overrideCss.push(`${k}:${v}`);
    }

    styles[mq] = overrideStyles;
    if (overrideCss.length > 0) {
      fullCss += `@media(max-width:${bp}px){.${prefix}-${blockId}{${overrideCss.sort().join(";")}}}`;
    }
  }

  return { styles, css: fullCss };
}

/** Convert kebab-case to camelCase. */
function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
