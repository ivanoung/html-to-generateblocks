// ── HTML-to-IR Converter (Phase 4) ─────────────────────────────
//
// Takes resolved HTML (inline styles only) + SectionManifest and
// produces IRNode[] ready for ir-planner.ts.

import * as cheerio from "cheerio";
import type { IRNode, LayoutIntent } from "../core/ir-node.js";
import type {
  SectionManifest, ManifestElement, ManifestGroup, ManifestTemplate,
} from "../types/manifest.js";
import { parseStyleString, type ParsedStyles } from "../core/style-parser.js";
import {
  ELEMENT_ROLE_MAP, GROUP_LAYOUT_MAP, sectionLayoutToIntent,
} from "./role-mapper.js";

export interface HtmlToIRResult {
  nodes: IRNode[];
  warnings: string[];
}

export function htmlToIR(
  manifest: SectionManifest,
  resolvedHtml: string,
): HtmlToIRResult {
  const warnings: string[] = [];
  const $ = cheerio.load(`<div>${resolvedHtml}</div>`);

  const sectionLayout: LayoutIntent = sectionLayoutToIntent(manifest.layout);

  // Create section wrapper
  const sectionNode: IRNode = {
    nodeType: "section",
    tagName: "section",
    layoutIntent: sectionLayout,
    fallbackPolicy: "generateblocks",
    children: [],
    sourceMeta: manifest.sectionId,
  };

  // Process flat elements
  for (const el of manifest.elements) {
    if (el.role === "decoration") continue;

    const $el = $(el.selector);
    if ($el.length === 0) {
      warnings.push(`Element not found: "${el.selector}"`);
      continue;
    }

    const irNode = elementToIR($, $el.first(), el, warnings);
    if (irNode) {
      sectionNode.children.push(irNode);
    }
  }

  // Process groups
  if (manifest.groups) {
    for (const group of manifest.groups) {
      const groupNode = groupToIR($, group, warnings);
      if (groupNode) {
        sectionNode.children.push(groupNode);
      }
    }
  }

  // Process templates
  if (manifest.templates) {
    for (const tmpl of manifest.templates) {
      const templateNodes = templateToIR($, tmpl, manifest.exceptions, warnings);
      sectionNode.children.push(...templateNodes);
    }
  }

  // Process exceptions as standalone elements (embeds, wide cards, etc.)
  if (manifest.exceptions) {
    for (const exc of manifest.exceptions) {
      if (exc.role === "decoration") continue;
      const $el = $(exc.selector);
      if ($el.length === 0) {
        warnings.push(`Exception element not found: "${exc.selector}"`);
        continue;
      }
      const irNode = elementToIR($, $el.first(), exc, warnings);
      if (irNode) {
        sectionNode.children.push(irNode);
      }
    }
  }

  return { nodes: [sectionNode], warnings };
}

function elementToIR(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
  el: ManifestElement,
  warnings: string[],
): IRNode | null {
  const mapping = ELEMENT_ROLE_MAP[el.role];
  if (!mapping) {
    warnings.push(`No mapping for role: "${el.role}"`);
    return null;
  }

  if (mapping.useCoreHtml) {
    // Wrap raw HTML in a core/html block
    const html = $.html($el);
    return {
      nodeType: mapping.coreHtmlNodeType || "container",
      layoutIntent: mapping.layoutIntent,
      fallbackPolicy: "core",
      children: [{
        nodeType: "container",
        fallbackPolicy: "core",
        children: [],
        html,
        sourceMeta: `embed:${el.role}`,
      }],
      sourceMeta: `embed:${el.role}`,
    };
  }

  const tagName = $el.prop("tagName")?.toLowerCase() || undefined;
  const textContent = $el.text().trim() || undefined;
  const styleAttr = $el.attr("style") || "";

  const attributes: Record<string, string> = {};
  const href = $el.attr("href");
  const src = $el.attr("src");
  const alt = $el.attr("alt");
  const id = $el.attr("id");

  if (href) attributes.href = href;
  if (src) attributes.src = src;
  if (alt) attributes.alt = alt;
  if (id) attributes.id = id;

  const parsed: ParsedStyles = parseStyleString(styleAttr);
  const styleIntent: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.styles)) {
    styleIntent[key] = String(value);
  }

  return {
    nodeType: mapping.nodeType,
    tagName: tagName || (mapping.nodeType === "heading" ? "h2" : undefined),
    textContent,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    styleIntent: Object.keys(styleIntent).length > 0 ? styleIntent : undefined,
    layoutIntent: mapping.layoutIntent,
    fallbackPolicy: mapping.fallbackPolicy,
    children: [],
    sourceMeta: el.selector,
  };
}

function groupToIR(
  $: cheerio.CheerioAPI,
  group: ManifestGroup,
  warnings: string[],
): IRNode | null {
  const $container = $(group.selector);
  if ($container.length === 0) {
    warnings.push(`Group container not found: "${group.selector}"`);
    return null;
  }

  const layoutIntent = GROUP_LAYOUT_MAP[group.role];
  const styleAttr = $container.first().attr("style") || "";
  const parsed = parseStyleString(styleAttr);
  const styleIntent: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.styles)) {
    styleIntent[key] = String(value);
  }
  // Remove layout-specific styles that GB manages via layoutIntent
  delete styleIntent.display;
  delete styleIntent.flexDirection;
  delete styleIntent.flexWrap;
  delete styleIntent.alignItems;
  delete styleIntent.justifyContent;

  const children: IRNode[] = [];
  for (const el of group.elements) {
    if (el.role === "decoration") continue;
    const $el = $(el.selector);
    if ($el.length === 0) {
      warnings.push(`Group element not found: "${el.selector}"`);
      continue;
    }
    const irNode = elementToIR($, $el.first(), el, warnings);
    if (irNode) children.push(irNode);
  }

  return {
    nodeType: "container",
    tagName: "div",
    styleIntent: Object.keys(styleIntent).length > 0 ? styleIntent : undefined,
    layoutIntent,
    fallbackPolicy: "generateblocks",
    children,
    sourceMeta: group.selector,
  };
}

function templateToIR(
  $: cheerio.CheerioAPI,
  tmpl: ManifestTemplate,
  exceptions: ManifestElement[] | undefined,
  warnings: string[],
): IRNode[] {
  const $first = $(tmpl.selector);
  if ($first.length === 0) {
    warnings.push(`Template first element not found: "${tmpl.selector}"`);
    return [];
  }

  // Find all siblings with the same structure as the first element
  const $parent = $first.parent();
  const $siblings = $parent.children();

  // Simple heuristic: all direct children that look similar
  const nodes: IRNode[] = [];
  $siblings.each((_, child) => {
    const $child = $(child);

    // Check if this child matches an exception
    const isException = exceptions?.some((exc) => {
      try {
        return $(exc.selector).is($child);
      } catch { return false; }
    });

    if (isException) return; // Skip, exceptions handled separately

    // Apply template roles to this child
    const cardNode: IRNode = {
      nodeType: "container",
      tagName: "div",
      layoutIntent: "stack",
      fallbackPolicy: "generateblocks",
      children: [],
      sourceMeta: tmpl.selector,
    };

    const styleAttr = $child.attr("style") || "";
    const parsed = parseStyleString(styleAttr);
    const styleIntent: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.styles)) {
      styleIntent[key] = String(value);
    }
    delete styleIntent.display;
    delete styleIntent.flexDirection;
    cardNode.styleIntent = Object.keys(styleIntent).length > 0 ? styleIntent : undefined;

    for (const el of tmpl.elements) {
      if (el.role === "decoration") continue;
      const $childEl = $child.find(el.selector).first();
      if ($childEl.length === 0) {
        warnings.push(`Template child element not found: "${el.selector}" in template "${tmpl.selector}"`);
        continue;
      }
      const irNode = elementToIR($, $childEl, el, warnings);
      if (irNode) cardNode.children.push(irNode);
    }

    nodes.push(cardNode);
  });

  return nodes;
}
