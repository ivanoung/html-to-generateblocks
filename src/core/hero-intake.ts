// ── Hero Intake Normalizer ────────────────────────────────────
//
// Converts a raw HTML hero section into the IR format expected by
// the hero converter pipeline. Focused on hero sections only —
// handles headings, paragraphs, links, images, containers.
//
// Output: IRNode tree with nodeType, tagName, textContent,
//   styleIntent, layoutIntent, children, fallbackPolicy.

import type { IRNode, StyleIntent, LayoutIntent } from "./ir-node.js";

/** Result of normalizing a hero HTML snippet. */
export interface NormalizedHero {
  root: IRNode;
  warnings: string[];
}

/**
 * Normalize a raw HTML hero section into an IR tree.
 */
export function normalizeHeroHtml(html: string): NormalizedHero {
  const warnings: string[] = [];
  const trimmed = html.trim();

  const sectionMatch = trimmed.match(/<section[^>]*>([\s\S]*)<\/section>/i);
  if (!sectionMatch) {
    warnings.push("No <section> wrapper found; wrapping in default section");
    return { root: makeSection(trimmed, {}, [], warnings), warnings };
  }

  const sectionAttrs = sectionMatch[0].match(/<section([^>]*)>/i);
  const sectionStyles = extractStyle(sectionAttrs?.[1] ?? "");
  const innerContent = sectionMatch[1];

  // Detect inner wrapper and flatten if needed
  const innerDivMatch = innerContent.match(/<div[^>]*>([\s\S]*)<\/div>/i);
  if (innerDivMatch) {
    const innerAttrs = innerDivMatch[0].match(/<div([^>]*)>/i)?.[1] ?? "";
    const innerStyles = extractStyle(innerAttrs);

    // Check if inner has layout properties (flex, grid, max-width)
    const hasLayout = innerStyles["display"] === "flex" ||
      innerStyles["display"] === "grid" ||
      innerStyles["max-width"];

    if (hasLayout) {
      // Merge inner layout with section styles — section IS the grid
      const mergedStyles = {
        padding: sectionStyles["padding"] || "100px 24px",
        "background-color": sectionStyles["background-color"] || "#0a0a0a",
      };
      if (innerStyles["max-width"]) mergedStyles["max-width"] = innerStyles["max-width"];
      if (innerStyles["margin-left"] === "auto") mergedStyles["margin-left"] = "auto";
      if (innerStyles["margin-right"] === "auto") mergedStyles["margin-right"] = "auto";
      if (innerStyles["display"]) mergedStyles["display"] = innerStyles["display"];
      if (innerStyles["gap"]) mergedStyles["gap"] = innerStyles["gap"];
      if (innerStyles["align-items"]) mergedStyles["align-items"] = innerStyles["align-items"];

      // Use grid by default for two-column hero
      mergedStyles["display"] = "grid";
      mergedStyles["grid-template-columns"] = "minmax(0,1fr) minmax(0,1fr)";
      mergedStyles["column-gap"] = innerStyles["gap"] || "48px";
      mergedStyles["row-gap"] = "32px";
      mergedStyles["max-width"] = innerStyles["max-width"] || "1200px";
      mergedStyles["margin-left"] = "auto";
      mergedStyles["margin-right"] = "auto";
      mergedStyles["align-items"] = innerStyles["align-items"] || "center";

      // Parse children inside the inner wrapper directly as section children
      const children = parseTopLevelChildren(innerDivMatch[1], warnings);

      const responsive: Record<string, Record<string, string>> = {
        "1024": { "grid-template-columns": "1fr" },
      };

      return {
        root: {
          nodeType: "section",
          tagName: "section",
          styleIntent: mergedStyles,
          layoutIntent: "wrapper",
          children,
          fallbackPolicy: "generateblocks",
          responsiveIntent: responsive,
        },
        warnings,
      };
    }
  }

  // Fallback: simple container parsing
  const root = makeSection(innerContent, {}, [], warnings);
  return { root, warnings };
}

function makeSection(inner: string, styles: Record<string, string>, children: IRNode[], warnings: string[]): IRNode {
  return {
    nodeType: "section",
    tagName: "section",
    styleIntent: { padding: "80px 24px", "background-color": "#ffffff", ...styles },
    layoutIntent: "wrapper",
    children: children.length > 0 ? children : parseChildren(inner, warnings),
    fallbackPolicy: "generateblocks",
  };
}

/** Parse top-level children — divs become sibling columns, inline elements parsed directly. */
function parseTopLevelChildren(html: string, warnings: string[]): IRNode[] {
  const nodes: IRNode[] = [];
  const divRegex = /<div[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;

  while ((m = divRegex.exec(html)) !== null) {
    const divHtml = m[0];
    const inner = m[1];
    const attrs = divHtml.match(/<div([^>]*)>/i)?.[1] ?? "";
    const styles = extractStyle(attrs);

    // Check for pre/code block
    const preMatch = inner.match(/<pre[^>]*>([\s\S]*)<\/pre>/i);
    if (preMatch) {
      const preText = preMatch[1].trim();
      styles["padding"] = styles["padding"] || "32px";
      styles["background-color"] = styles["background-color"] || "#151515";
      styles["border"] = styles["border"] || "1px solid #333";
      styles["border-radius"] = styles["border-radius"] || "12px";
      styles["width"] = "100%";

      nodes.push({
        nodeType: "container",
        tagName: "div",
        styleIntent: styles,
        layoutIntent: "stack",
        children: [{
          nodeType: "paragraph",
          tagName: "p",
          textContent: preText,
          styleIntent: {
            "font-family": "monospace",
            "font-size": "0.9rem",
            color: "#10b981",
            "line-height": "1.6",
            "background-color": "#0d0d0d",
            padding: "20px",
            "border-radius": "8px",
          },
          children: [],
          fallbackPolicy: "generateblocks",
        }],
        fallbackPolicy: "generateblocks",
      });
      continue;
    }

    // Plain container with width:100% and gap
    styles["width"] = styles["width"] || "100%";
    styles["gap"] = styles["gap"] || "48px";

    const children = parseInlineElements(inner, warnings);
    nodes.push({
      nodeType: "container",
      tagName: "div",
      styleIntent: styles,
      layoutIntent: "stack",
      children,
      fallbackPolicy: "generateblocks",
    });
  }

  // Fallback to inline parsing
  if (nodes.length === 0) {
    return parseInlineElements(html, warnings);
  }

  return nodes;
}

// ── Child parsing ─────────────────────────────────────────────

function parseChildren(html: string, warnings: string[]): IRNode[] {
  const nodes: IRNode[] = [];
  const inner = html.trim();

  // Try to find major containers/columns
  const containers = extractContainers(inner);

  if (containers.length > 0) {
    for (const c of containers) {
      nodes.push(parseContainer(c, warnings));
    }
  } else {
    // No containers found — parse inline elements directly
    const elements = parseInlineElements(inner, warnings);
    nodes.push(...elements);
  }

  return nodes;
}

function extractContainers(html: string): string[] {
  const containers: string[] = [];
  const regex = /<div[^>]*class="[^"]*[a-z]"[\s\S]*?<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    containers.push(m[0]);
  }
  if (containers.length === 0) {
    // Try just div tags
    const divRegex = /<div[^>]*>([\s\S]*?)<\/div>/gi;
    while ((m = divRegex.exec(html)) !== null) {
      containers.push(m[0]);
    }
  }
  return containers;
}

function parseContainer(html: string, warnings: string[]): IRNode {
  const tagMatch = html.match(/<(div|section|article|header|footer)[^>]*>/i);
  const tag = tagMatch?.[1].toLowerCase() ?? "div";
  const attrs = tagMatch?.[0] ?? "";
  const styles = extractStyle(attrs);

  // Detect layout from classes or styles
  let layoutIntent: LayoutIntent = "stack";
  if (attrs.includes("grid") || styles["display"] === "grid") {
    layoutIntent = "grid";
  } else if (attrs.includes("flex") || styles["display"] === "flex") {
    layoutIntent = "row";
  } else if (attrs.includes("column") || styles["flex-direction"] === "column") {
    layoutIntent = "stack";
  } else if (attrs.includes("max-w-") || styles["max-width"]) {
    layoutIntent = "constrained";
  }

  // Extract inner content
  const inner = html.replace(/<[^>]+>/, "").replace(/<\/[^>]+>$/, "");

  // Parse children inside this container
  const children = parseInlineElements(inner, warnings);

  return {
    nodeType: "container",
    tagName: tag,
    styleIntent: styles,
    layoutIntent,
    children,
    fallbackPolicy: "generateblocks",
  };
}

// ── Inline element parsing ────────────────────────────────────

function parseInlineElements(html: string, warnings: string[]): IRNode[] {
  const nodes: IRNode[] = [];

  // Match heading, paragraph, image, link elements
  const tagRegex = /<(h[1-6]|p|img|a|span|strong|em|small|br|pre)[^>]*>[\s\S]*?<\/\1>|<(h[1-6]|p|img|a|span|strong|em|small|br|pre)[^>]*\/?>/gi;
  let m: RegExpExecArray | null;

  while ((m = tagRegex.exec(html)) !== null) {
    const fullTag = m[0];
    const tagName = m[1]?.toLowerCase() ?? m[2]?.toLowerCase() ?? "span";

    if (tagName === "img") {
      nodes.push(parseImageTag(fullTag));
    } else if (tagName === "a" && isCTA(fullTag)) {
      nodes.push(parseButtonLink(fullTag));
    } else if (tagName === "a") {
      // Inline link — handled as part of text content
      continue;
    } else if (tagName.startsWith("h")) {
      nodes.push(parseHeading(tagName, fullTag));
    } else if (tagName === "p") {
      nodes.push(parseParagraph(fullTag));
    } else if (tagName === "pre") {
      nodes.push(parsePreBlock(fullTag));
    } else if (tagName === "br") {
      // Skip line breaks in normalizer
      continue;
    }
  }

  // If no structured elements found, treat remaining text as paragraph
  const remaining = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  if (remaining && nodes.length === 0) {
    nodes.push({
      nodeType: "paragraph",
      tagName: "p",
      textContent: remaining,
      children: [],
      fallbackPolicy: "generateblocks",
    });
  }

  return nodes;
}

// ── Element-specific parsers ──────────────────────────────────

function parseHeading(tag: string, html: string): IRNode {
  const attrs = html.match(/<h[1-6]([^>]*)>/i)?.[1] ?? "";
  const styles = extractStyle(attrs);
  const text = stripTags(html);
  return {
    nodeType: "heading",
    tagName: tag,
    textContent: text,
    // Extract styles OVERRIDE defaults (inline styles take priority)
    styleIntent: { ...defaultHeadingStyles(tag), ...styles },
    children: [],
    fallbackPolicy: "generateblocks",
  };
}

function parseParagraph(html: string): IRNode {
  const attrs = html.match(/<p([^>]*)>/i)?.[1] ?? "";
  const styles = extractStyle(attrs);
  // Strip outer <p> wrapper, then extract inner HTML with anchors preserved
  const inner = html.replace(/<p[^>]*>/i, "").replace(/<\/p>/i, "");
  const text = stripTagsKeepAnchors(inner);
  return {
    nodeType: "paragraph",
    tagName: "p",
    textContent: text,
    styleIntent: { ...defaultParagraphStyles(), ...styles },
    children: [],
    fallbackPolicy: "generateblocks",
  };
}

function parsePreBlock(html: string): IRNode {
  const attrs = html.match(/<pre([^>]*)>/i)?.[1] ?? "";
  const styles = extractStyle(attrs);
  const inner = html.replace(/<pre[^>]*>/i, "").replace(/<\/pre>/i, "");
  const text = inner.trim();

  return {
    nodeType: "paragraph",
    tagName: "p",
    textContent: text,
    styleIntent: {
      "font-family": "monospace",
      "font-size": "0.9rem",
      color: "#10b981",
      "line-height": "1.6",
      "background-color": "#0d0d0d",
      padding: "20px",
      "border-radius": "8px",
      ...styles,
    },
    children: [],
    fallbackPolicy: "generateblocks",
  };
}

function parseButtonLink(html: string): IRNode {
  const attrs = html.match(/<a([^>]*)>/i)?.[1] ?? "";
  const href = attrs.match(/href="([^"]+)"/i)?.[1] ?? "#";
  const target = attrs.match(/target="([^"]+)"/i)?.[1];
  const styles = extractStyle(attrs);
  const text = stripTags(html);

  return {
    nodeType: "button-link",
    tagName: "a",
    textContent: text,
    attributes: {
      href,
      ...(target ? { target } : {}),
      ...(target === "_blank" ? { rel: "noopener" } : {}),
    },
    styleIntent: { ...defaultButtonStyles(), ...styles },
    children: [],
    fallbackPolicy: "generateblocks",
  };
}

function parseImageTag(html: string): IRNode {
  const src = html.match(/src="([^"]+)"/i)?.[1] ?? "";
  const alt = html.match(/alt="([^"]+)"/i)?.[1] ?? "";
  const styles = extractStyle(html.match(/<img([^>]*)\/?>/i)?.[1] ?? "");

  return {
    nodeType: "image",
    tagName: "img",
    attributes: { src, alt },
    styleIntent: { ...styles, "max-width": "100%" },
    children: [],
    fallbackPolicy: "core",
  };
}

// ── Style extraction ──────────────────────────────────────────

function extractStyle(attrStr: string): StyleIntent {
  const styles: StyleIntent = {};
  const styleMatch = attrStr.match(/style="([^"]+)"/i);
  if (styleMatch) {
    const parts = styleMatch[1].split(";");
    for (const part of parts) {
      const [k, v] = part.split(":").map(s => s.trim());
      if (k && v) styles[k] = v;
    }
  }

  // Extract common Tailwind-like classes
  if (attrStr.includes("bg-")) {
    const bgMatch = attrStr.match(/bg-(?:\[([^\]]+)\]|(\w+))/i);
    // Simplified — skip complex class parsing for now
  }

  return styles;
}

function isCTA(html: string): boolean {
  return html.toLowerCase().includes("btn") ||
    html.toLowerCase().includes("cta") ||
    html.toLowerCase().includes("button");
}

// ── Text extraction ───────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "<br>").replace(/<(?!br\b)[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function stripTagsKeepAnchors(html: string): string {
  // Convert <a> tags to inline markup, preserve hrefs
  let result = html;
  result = result.replace(/<a\s+([^>]*)>/gi, (_, attrs: string) => {
    const href = attrs.match(/href="([^"]+)"/i)?.[1] ?? "";
    const target = attrs.includes("_blank") ? ' target="_blank"' : "";
    return `<a href="${href}"${target}>`;
  });
  result = result.replace(/<\/a>/gi, "</a>");
  result = result.replace(/<strong>/gi, "<strong>").replace(/<\/strong>/gi, "</strong>");
  result = result.replace(/<small>/gi, "<small>").replace(/<\/small>/gi, "</small>");
  result = result.replace(/&nbsp;/g, " ");
  result = result.replace(/<br\s*\/?>/gi, "");
  return result.trim();
}

// ── Default style presets ─────────────────────────────────────

function defaultSectionStyles(): StyleIntent {
  return {
    padding: "80px 24px",
    "background-color": "#ffffff",
  };
}

function defaultHeadingStyles(tag: string): StyleIntent {
  if (tag === "h1") {
    return {
      "font-size": "3rem",
      "font-weight": "800",
      color: "#111",
      "margin-bottom": "16px",
      "line-height": "1.1",
    };
  }
  return {
    "font-size": "2rem",
    "font-weight": "700",
    color: "#111",
    "margin-bottom": "12px",
  };
}

function defaultParagraphStyles(): StyleIntent {
  return {
    "font-size": "1.125rem",
    "line-height": "1.7",
    color: "#555",
    "margin-bottom": "20px",
  };
}

function defaultButtonStyles(): StyleIntent {
  return {
    display: "inline-flex",
    "align-items": "center",
    padding: "12px 24px",
    "background-color": "#111",
    color: "#fff",
    "text-decoration": "none",
    "border-radius": "999px",
    "font-size": "1rem",
    "font-weight": "600",
  };
}
