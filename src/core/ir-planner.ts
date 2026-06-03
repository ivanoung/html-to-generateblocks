// ── IR Planner ─────────────────────────────────────────────────
//
// Converts IRNode tree into Block[] for serialization.
// The "plan-blocks" step in the M2 pipeline.
//
// Covers: section, container, heading, paragraph, span, button-link.
// Other IR types stub with errors for later phases.

import type { Block } from "./types.js";
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
    case "icon":
      errors.push(`DEFERRED: IR type "${node.nodeType}" not implemented in Phase 2`);
      return { blocks: [], errors };
    default:
      errors.push(`UNKNOWN: IR node type "${(node as any).nodeType}"`);
      return { blocks: [], errors };
  }
}

// ── Container (section/container → generateblocks/element) ─────

function planContainer(node: IRNode, errors: string[]): PlanResult {
  const tag = node.tagName ?? "div";
  const rawStyle = styleIntentToString(node.styleIntent);
  const { styles, css } = parseStyleString(rawStyle);
  const htmlAttributes = { ...node.attributes };

  const innerBlocks: Block[] = [];
  for (const child of node.children) {
    const r = planBlocks(child);
    innerBlocks.push(...r.blocks);
    errors.push(...r.errors);
  }

  return {
    blocks: [{
      blockName: "generateblocks/element",
      uniqueId: nextId("elem"),
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

// ── Text (heading/paragraph/span → generateblocks/text) ────────

function planText(node: IRNode, errors: string[]): PlanResult {
  const tag =
    node.tagName ||
    (node.nodeType === "heading" ? "h2" : "p");
  const rawStyle = styleIntentToString(node.styleIntent);
  const { styles, css } = parseStyleString(rawStyle);

  return {
    blocks: [{
      blockName: "generateblocks/text",
      uniqueId: nextId("text"),
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
  const { styles, css } = parseStyleString(rawStyle);
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
        styles,
        css,
        innerBlocks: [],
        idGenType: "core",
      }],
      errors,
    };
  }

  return {
    blocks: [{
      blockName: "generateblocks/media",
      uniqueId: nextId("img"),
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

// ── Helpers ────────────────────────────────────────────────────

/** Convert IR styleIntent to raw CSS string for parseStyleString. */
function styleIntentToString(si?: Record<string, string>): string {
  if (!si || Object.keys(si).length === 0) return "";
  return Object.entries(si)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
