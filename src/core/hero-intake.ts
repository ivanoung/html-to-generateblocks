// ── Hero Intake Normalizer ────────────────────────────────────
//
// Converts a raw HTML hero section into the IR format expected by
// the hero converter pipeline. Three structural paths:
//   PATH A: real multi-column hero (explicit grid/flex column split)
//   PATH B: centered constrained single-column hero
//   PATH C: fallback generic parsing
//
// Preserves source-derived structure and styleIntent; does not
// synthesize a full visual design during normalization.
//
// For centered heroes, the IR is:
//   section → child constrained container → ordered content children
//   (eyebrow / heading / paragraph / CTA row / stats row).
//
// Output: IRNode tree with nodeType, tagName, textContent,
//   styleIntent, layoutIntent, children, fallbackPolicy.

import type { IRNode, StyleIntent, LayoutIntent } from "./ir-node.js";

/** Result of normalizing a hero HTML snippet. */
export interface NormalizedHero {
  root: IRNode;
  warnings: string[];
}

// ── Module-level CSS rules (set per conversion) ───────────────

interface CssRules {
  [className: string]: Record<string, string>;
}
let _cssRules: CssRules = {};

function extractCssRules(html: string): CssRules {
  const rules: CssRules = {};
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleMatch) return rules;
  const css = styleMatch[1];
  const ruleRegex = /\.([a-zA-Z][\w-]*)\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(css)) !== null) {
    const styles: Record<string, string> = {};
    for (const prop of m[2].split(";").filter(s => s.trim())) {
      const [k, ...vParts] = prop.split(":");
      if (k && vParts.length > 0) styles[k.trim()] = vParts.join(":").trim();
    }
    if (Object.keys(styles).length > 0) rules[m[1]] = styles;
  }
  return rules;
}

/** Lookup styles by class names + inline style. */
function classStyles(attrStr: string): StyleIntent {
  const styles: StyleIntent = {};
  const classMatch = attrStr.match(/class="([^"]+)"/i);
  if (!classMatch) return extractStyle(attrStr);
  for (const cls of classMatch[1].split(/\s+/)) {
    if (_cssRules[cls]) Object.assign(styles, _cssRules[cls]);
  }
  Object.assign(styles, extractStyle(attrStr));
  return styles;
}

/**
 * Normalize a raw HTML hero section into an IR tree.
 */
export function normalizeHeroHtml(html: string): NormalizedHero {
  const warnings: string[] = [];
  const trimmed = html.trim();

  // Extract CSS rules from <style> blocks (stored globally for lookup)
  _cssRules = extractCssRules(trimmed);

  const sectionMatch = trimmed.match(/<section[^>]*>([\s\S]*)<\/section>/i);
  if (!sectionMatch) {
    warnings.push("No <section> wrapper found; wrapping in default section");
    return { root: makeSection(trimmed, {}, [], warnings), warnings };
  }

  const sectionAttrs = sectionMatch[0].match(/<section([^>]*)>/i);
  const sectionStyles = classStyles(sectionAttrs?.[1] ?? "");
  const innerContent = sectionMatch[1];

  // ── CLASSIFY: real multi-column vs centered vs fallback ─────
  const innerDivMatch = innerContent.match(/<div[^>]*>([\s\S]*)<\/div>/i);
  if (innerDivMatch) {
    const innerAttrs = innerDivMatch[0].match(/<div([^>]*)>/i)?.[1] ?? "";
    const innerStyles = classStyles(innerAttrs);
    const innerHtml = innerDivMatch[1];

    // PATH A: Explicit multi-column grid
    // Only triggers when the inner wrapper has explicit column-splitting behavior:
    //   - grid-template-columns with repeat(2+, ...) or explicit 2+ column tracks
    //   - OR display:flex with children that have clear column structure
    const hasExplicitGrid = isMultiColumnGrid(innerStyles);
    const columnChildren = hasExplicitGrid ? findColumnChildren(innerHtml) : [];

    if (columnChildren.length >= 2) {
      const columnNodes = columnChildren.map((childHtml) => {
        const childAttrs = childHtml.match(/<div\b([^>]*)>/i)?.[1] ?? "";
        const childStyles = classStyles(childAttrs);
        // Only capture structural style properties from child columns
        const columnStyle: StyleIntent = {};
        if (childStyles["display"]) columnStyle["display"] = childStyles["display"];
        if (childStyles["flex"]) columnStyle["flex"] = childStyles["flex"];
        if (childStyles["flex-grow"]) columnStyle["flex-grow"] = childStyles["flex-grow"];
        if (childStyles["grid-column"]) columnStyle["grid-column"] = childStyles["grid-column"];
        if (childStyles["grid-row"]) columnStyle["grid-row"] = childStyles["grid-row"];

        const childInner = childHtml.replace(/<div\b[^>]*>/i, "").replace(/<\/div>$/i, "");
        const childNodes = parseInlineElements(childInner, warnings);
        return {
          nodeType: "container" as const,
          tagName: "div",
          styleIntent: childStyles,
          layoutIntent: "stack" as const,
          children: childNodes,
          fallbackPolicy: "generateblocks" as const,
        };
      });

      return {
        root: {
          nodeType: "section", tagName: "section",
          styleIntent: sectionStyles,
          layoutIntent: "wrapper",
          children: [{
            nodeType: "container", tagName: "div",
            styleIntent: innerStyles,
            layoutIntent: "grid",
            children: columnNodes,
            fallbackPolicy: "generateblocks",
          }],
          fallbackPolicy: "generateblocks",
        },
        warnings,
      };
    }

    // PATH B: Centered constrained single-column hero
    // Triggered by constraining wrapper (max-width + auto margins) OR centered text,
    // but ONLY when not already classified as multi-column grid.
    const hasConstrained = !!innerStyles["max-width"] &&
      innerStyles["margin-left"] === "auto" && innerStyles["margin-right"] === "auto";
    const isCentered = innerStyles["text-align"] === "center" ||
      innerStyles["justify-content"] === "center";

    if (hasConstrained || isCentered) {
      const innerStyle: StyleIntent = {};
      if (innerStyles["max-width"]) {
        innerStyle["max-width"] = innerStyles["max-width"];
        innerStyle["margin-left"] = "auto";
        innerStyle["margin-right"] = "auto";
      }
      if (innerStyles["padding"]) innerStyle["padding"] = innerStyles["padding"];
      if (isCentered) innerStyle["text-align"] = "center";

      const children = parseCenteredChildren(innerHtml, warnings);

      return {
        root: {
          nodeType: "section", tagName: "section",
          styleIntent: sectionStyles,
          layoutIntent: "wrapper",
          children: [{
            nodeType: "container", tagName: "div",
            styleIntent: innerStyle,
            layoutIntent: "constrained",
            children,
            fallbackPolicy: "generateblocks",
          }],
          fallbackPolicy: "generateblocks",
        },
        warnings,
      };
    }
  }

  // PATH C: Fallback
  const root = makeSection(innerContent, {}, [], warnings);
  return { root, warnings };
}

// ── Column detection ──────────────────────────────────────────

/**
 * Detect explicit multi-column grid behavior from style intent.
 *
 * Only returns true when the inner wrapper has explicit column-splitting:
 *   - grid-template-columns with repeat(2+, ...) or explicit 2+ track values
 *   - display:flex with flex-direction:row (not column) as a signal to check children
 *
 * A bare display:flex or display:grid without column tracks is NOT enough —
 * it could be a CTA row or centered stack, not a multi-column hero.
 */
function isMultiColumnGrid(styles: StyleIntent): boolean {
  const gtCols = styles["grid-template-columns"];
  if (gtCols) {
    // Match repeat(N, ...) where N >= 2
    const repeatMatch = gtCols.match(/repeat\(\s*(\d+)\s*,/);
    if (repeatMatch && parseInt(repeatMatch[1]) >= 2) return true;
    // Match explicit multi-track: "1fr 1fr", "minmax(0,1fr) minmax(0,1fr)", etc.
    // Split by whitespace, filter out repeat() groups, count remaining tracks
    const cols = gtCols.split(/\s+/).filter(s => s.trim() && !s.startsWith("repeat"));
    if (cols.length >= 2) return true;
  }

  // display:flex with flex-direction:row (default) MAY be multi-column
  // The caller will verify via findColumnChildren before proceeding to PATH A
  if (styles["display"] === "flex") {
    const flexDir = styles["flex-direction"];
    if (flexDir === "column" || flexDir === "column-reverse") return false;
    // Defer to caller — flex row could be multi-column or a CTA row
    return true;
  }

  return false;
}

/**
 * Find direct div children that look like layout columns.
 *
 * A column child must:
 *   1. Contain heading (h1-h6), paragraph (p), image (img), or pre descendants
 *   2. NOT be a pure link/button wrapper (only <a> children without content)
 *
 * Rejects rows of link-only wrappers — those are CTA groups, not columns.
 *
 * Conservative: if fewer than 2 clear content columns are found, returns [].
 */
function findColumnChildren(html: string): string[] {
  const cols: string[] = [];

  const divRegex = /<div\b[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = divRegex.exec(html)) !== null) {
    const childInner = m[1];
    const hasContent = /<(h[1-6]|p|img|pre)\b/i.test(childInner);
    const isLinkWrapper = isLinkOnlyWrapper(childInner);

    // A column must have real content AND not just be a link/button wrapper
    if (hasContent && !isLinkWrapper) {
      // Additional structural check: if the child has display:flex and contains
      // only links/buttons, treat it as a row, not a column
      const colAttrs = m[0].match(/<div\b([^>]*)>/i)?.[1] ?? "";
      const colStyles = classStyles(colAttrs);
      const isFlexRow = colStyles["display"] === "flex" && !colStyles["flex-direction"];
      const isLinkRow = isFlexRow && (/<a\b/i.test(childInner)) &&
        !(/<(h[1-6]|p|img|pre)\b/i.test(childInner));
      if (isLinkRow) continue;

      cols.push(m[0]);
    }
  }

  // Conservative: only accept if 2+ clear content columns
  if (cols.length < 2) return [];
  return cols;
}

// ── Centered children parsing ─────────────────────────────────

/**
 * Parse children of a centered/constrained single-column hero.
 *
 * Structure-first approach:
 *   1. Parse all elements in document order
 *   2. Group repeated stat-shaped items into a stats-row container
 *   3. Group adjacent CTA links/buttons into a CTA row
 *   4. Avoid substring-only heuristics (e.g. includes("stat")) unless
 *      combined with child-shape checks
 *
 * Stat detection: a stat item has 2 child text elements where the first
 * looks like a metric (starts with digit, < 15 chars) and the second is
 * a label (< 40 chars). Class-based confirmation (includes "stat",
 * "number", "metric") is secondary.
 */
function parseCenteredChildren(html: string, warnings: string[]): IRNode[] {
  const inner = html.trim();
  const tagRegex = /<(h[1-6]|p|a|img|button|div)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const raw: { tag: string; html: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(inner)) !== null) {
    raw.push({ tag: m[1].toLowerCase(), html: m[0] });
  }

  // Structure-first: classify each element
  //   - Stat candidates: div containers whose children form metric+label pairs
  //   - Content elements: heading, paragraph, image, link
  const statsCandidates: typeof raw = [];
  const regular: typeof raw = [];

  for (const r of raw) {
    if (r.tag === "div") {
      const attrs = r.html.match(/<[a-z]+([^>]*)>/i)?.[1] ?? "";
      const cls = attrs.match(/class="([^"]+)"/i)?.[1] ?? "";
      const childTexts = extractTextChildren(r.html);

      // Primary: child-shape check — 2 text elements, first starts with digit
      const hasStatShape = childTexts.length === 2 &&
        childTexts.every(t => t.length < 40) &&
        /^\d/.test(childTexts[0]) &&
        childTexts[0].length < 15; // metric is short and numeric

      // Secondary: class-based confirmation (stat, number, metric)
      const hasStatClass = cls.includes("stat") || cls.includes("number") || cls.includes("metric");

      // Only accept as stat if shape matches; class alone is not enough
      if (hasStatShape) {
        statsCandidates.push(r);
      } else if (hasStatClass) {
        // Class but no shape — could be a false positive; still accept but warn
        // Only if there are 2+ text children at all
        if (childTexts.length >= 2) {
          statsCandidates.push(r);
        } else {
          regular.push(r);
        }
      } else {
        // Not a stat — parse as a regular element
        const node = parseInlineElement(r.tag, r.html);
        if (node) regular.push(r); // push raw for later parsing
        else regular.push(r); // preserve order even if unparseable
      }
    } else {
      regular.push(r);
    }
  }

  // Only group if 2+ stat candidates (shape-confirmed)
  const hasStatGroup = statsCandidates.length >= 2;

  // Parse regular elements in order
  const nodes: IRNode[] = [];
  for (const r of regular) {
    const node = parseInlineElement(r.tag, r.html);
    if (node) nodes.push(node);
  }

  // CTA grouping: group adjacent button-link nodes into a row container
  const grouped: IRNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    if (nodes[i].nodeType === "button-link") {
      const ctas: IRNode[] = [];
      while (i < nodes.length && nodes[i].nodeType === "button-link") {
        ctas.push(nodes[i]);
        i++;
      }
      if (ctas.length >= 2) {
        grouped.push({
          nodeType: "container", tagName: "div",
          layoutIntent: "row",
          children: ctas,
          fallbackPolicy: "generateblocks",
        });
      } else {
        grouped.push(...ctas);
      }
    } else {
      grouped.push(nodes[i]);
      i++;
    }
  }

  // Append stats row if 2+ stat-shaped wrappers detected
  // Each stat item: container with 2 paragraphs (metric + label)
  if (hasStatGroup) {
    const statContainers: IRNode[] = [];
    for (const sw of statsCandidates) {
      const texts = extractTextChildren(sw.html);
      if (texts.length >= 2) {
        statContainers.push({
          nodeType: "container", tagName: "div",
          styleIntent: { "text-align": "center" },
          children: [
            { nodeType: "paragraph", tagName: "p", textContent: texts[0], styleIntent: {}, children: [], fallbackPolicy: "generateblocks" },
            { nodeType: "paragraph", tagName: "p", textContent: texts[1], styleIntent: {}, children: [], fallbackPolicy: "generateblocks" },
          ],
          layoutIntent: "stack",
          fallbackPolicy: "generateblocks",
        });
      }
    }
    if (statContainers.length >= 2) {
      grouped.push({
        nodeType: "container", tagName: "div",
        layoutIntent: "row",
        children: statContainers,
        fallbackPolicy: "generateblocks",
      });
    }
  }

  return grouped;
}

function parseInlineElement(tag: string, html: string): IRNode | null {
  switch (tag) {
    case "h1": case "h2": case "h3": return parseHeading(tag, html);
    case "p": return parseParagraph(html);
    case "a": return parseButtonLink(html);
    case "img": return parseImageTag(html);
    default: return null;
  }
}

/**
 * Extract text content from child <span>, <p>, <strong> elements.
 */
function extractTextChildren(html: string): string[] {
  const texts: string[] = [];
  const re = /<(span|p|strong)\b[^>]*>(.*?)<\/\1>/gi;
  let m2: RegExpExecArray | null;
  while ((m2 = re.exec(html)) !== null) {
    const t = m2[2].replace(/<[^>]+>/g, "").trim();
    if (t) texts.push(t);
  }
  return texts;
}

/**
 * Check if a div contains only <a> links with no content elements.
 * Used to distinguish CTA row wrappers from real layout columns.
 */
function isLinkOnlyWrapper(html: string): boolean {
  const hasContent = /<(h[1-6]|p|img|pre)\b/i.test(html);
  return !hasContent && /<a\b/i.test(html);
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

  // Post-processing: group adjacent CTA links into row containers
  return groupAdjacentCTAs(nodes);
}

/**
 * Group consecutive button-link nodes into a row container.
 */
function groupAdjacentCTAs(nodes: IRNode[]): IRNode[] {
  const result: IRNode[] = [];
  for (const n of nodes) {
    if (n.nodeType === "button-link" && result.length > 0 &&
        result[result.length - 1].nodeType === "button-link") {
      // Merge into row
      const prev = result.pop()!;
      result.push({
        nodeType: "container", tagName: "div",
        layoutIntent: "row",
        children: [prev, n],
        fallbackPolicy: "generateblocks",
      });
    } else {
      result.push(n);
    }
  }
  return result;
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
  const styles = classStyles(attrs);

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
  const styles = classStyles(attrs);
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
  const styles = classStyles(attrs);
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
  const styles = classStyles(attrs);
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
  const styles = classStyles(attrs);
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
  const styles = classStyles(html.match(/<img([^>]*)\/?>/i)?.[1] ?? "");

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
