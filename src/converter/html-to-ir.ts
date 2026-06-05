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

  // Extract section root styles (backgrounds, borders, padding)
  const $sectionRoot = $(`#${manifest.sectionId}`);
  let sectionStyleIntent: Record<string, string> = {};
  if ($sectionRoot.length > 0) {
    const sectionStyleAttr = $sectionRoot.attr("style") || "";
    const sectionParsed = parseStyleString(sectionStyleAttr);
    // Extract ALL resolved styles (including CSS-only ones like background-image)
    for (const [key, value] of Object.entries(sectionParsed.styles)) {
      sectionStyleIntent[key] = String(value);
    }
    // Also parse CSS-only properties from the raw CSS string
    if (sectionParsed.css) {
      for (const decl of sectionParsed.css.split(";")) {
        const colonIdx = decl.indexOf(":");
        if (colonIdx === -1) continue;
        const prop = decl.substring(0, colonIdx).trim();
        const val = decl.substring(colonIdx + 1).trim();
        if (prop && val) {
          // Convert kebab to camelCase for styleIntent key
          const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          if (!sectionStyleIntent[camel]) {
            sectionStyleIntent[camel] = val;
          }
        }
      }
    }
  }

  // Create section wrapper — for two-column, override grid to 2-col ratio
  const sectionNode: IRNode = {
    nodeType: "section",
    tagName: "section",
    layoutIntent: sectionLayout,
    fallbackPolicy: "generateblocks",
    styleIntent: Object.keys(sectionStyleIntent).length > 0 ? sectionStyleIntent : undefined,
    children: [],
    sourceMeta: manifest.sectionId,
  };
  // For two-column layout, convert 12-col grid to proportional 2-col
  if (manifest.layout === "two-column" && manifest.columnSplit && sectionNode.styleIntent?.gridTemplateColumns) {
    sectionNode.styleIntent.gridTemplateColumns = "minmax(0,7fr) minmax(0,5fr)";
  }

  // Process elements — handle two-column layout if columnSplit is specified
  if (manifest.layout === "two-column" && manifest.columnSplit) {
    processTwoColumn($, manifest, sectionNode, warnings);
  } else {
    processFlatElements($, manifest, sectionNode, warnings);
    processGroups($, manifest, sectionNode, warnings);
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
    // Wrap raw HTML directly — no intermediate container
    const html = $.html($el);
    const wrapperNodeType = mapping.coreHtmlNodeType || "container";
    return {
      nodeType: wrapperNodeType,
      fallbackPolicy: "core",
      children: [],
      html,
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

  // Read responsive overrides from data attribute (set by Phase 1 style resolver)
  let responsiveIntent: Record<string, Record<string, string>> | undefined;
  const respAttr = $el.attr("data-gb-resp");
  if (respAttr) {
    try {
      responsiveIntent = JSON.parse(respAttr);
    } catch { /* ignore malformed */ }
  }

  return {
    nodeType: mapping.nodeType,
    tagName: tagName || (mapping.nodeType === "heading" ? "h2" : undefined),
    textContent,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    styleIntent: Object.keys(styleIntent).length > 0 ? styleIntent : undefined,
    responsiveIntent,
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

// ── Two-column layout ─────────────────────────────────────────

function processTwoColumn(
  $: cheerio.CheerioAPI,
  manifest: SectionManifest,
  sectionNode: IRNode,
  warnings: string[],
): void {
  const $split = $(manifest.columnSplit!);
  if ($split.length === 0) {
    warnings.push(`Column split element not found: "${manifest.columnSplit}" — falling back to flat layout`);
    processFlatElements($, manifest, sectionNode, warnings);
    processGroups($, manifest, sectionNode, warnings);
    return;
  }

  // Determine which selectors belong to left vs right column
  // Left: elements before the split element in DOM order
  // Right: split element + elements after it
  const allSelectors: { sel: string; role: string; isGroup: boolean }[] = [];
  for (const el of manifest.elements) {
    allSelectors.push({ sel: el.selector, role: el.role, isGroup: false });
  }
  if (manifest.groups) {
    for (const g of manifest.groups) {
      allSelectors.push({ sel: g.selector, role: g.role, isGroup: true });
    }
  }

  // Find the split element's position among the collected selectors
  // We do this by checking which selector matches an element before/after the split
  const leftSelectors: typeof allSelectors = [];
  const rightSelectors: typeof allSelectors = [];
  const $splitEl = $split.first();

  for (const item of allSelectors) {
    const $match = $(item.sel).first();
    if ($match.length === 0) continue;
    // Compare DOM positions using cheerio's index
    if (item.sel === manifest.columnSplit || $splitEl.is($match)) {
      rightSelectors.push(item);
    } else {
      // Determine if element comes before or after the split
      const $parent = $splitEl.parent();
      const splitIdx = $parent.children().index($splitEl);
      const matchIdx = $parent.children().index($match);
      if (matchIdx < splitIdx) {
        leftSelectors.push(item);
      } else {
        rightSelectors.push(item);
      }
    }
  }

  // Also collect exceptions that are embeds (they go to right column typically)
  const rightEmbedSelectors: ManifestElement[] = [];
  if (manifest.exceptions) {
    for (const exc of manifest.exceptions) {
      if (exc.role === "embed" && exc.selector === manifest.columnSplit) {
        rightEmbedSelectors.push(exc);
      }
    }
  }

  // Find the DOM elements that form the column wrappers
  // Left column: the sibling before the split element
  // Right column: the split element itself
  const $parent = $splitEl.parent();
  const $leftDom = $parent.children().eq($parent.children().index($splitEl) - 1);
  const $rightDom = $splitEl;

  // Create left column container
  if (leftSelectors.length > 0) {
    const leftCol: IRNode = {
      nodeType: "container",
      tagName: "div",
      fallbackPolicy: "generateblocks",
      layoutIntent: "stack",
      children: [],
      sourceMeta: "column-left",
    };
    // Extract column wrapper styles from DOM
    if ($leftDom.length > 0) {
      const colStyle = $leftDom.attr("style") || "";
      const colParsed = parseStyleString(colStyle);
      const si: Record<string, string> = {};
      for (const [k, v] of Object.entries(colParsed.styles)) {
        // Strip grid-column (GB places columns via grid template, not span)
        if (k === "gridColumn") continue;
        si[k] = String(v);
      }
      if (Object.keys(si).length > 0) leftCol.styleIntent = si;
    }
    for (const item of leftSelectors) {
      if (item.isGroup) {
        const group = manifest.groups!.find(g => g.selector === item.sel);
        if (group) {
          const gn = groupToIR($, group, warnings);
          if (gn) leftCol.children.push(gn);
        }
      } else {
        const el = manifest.elements.find(e => e.selector === item.sel);
        if (el) {
          const $el = $(el.selector).first();
          const irn = elementToIR($, $el, el, warnings);
          if (irn) leftCol.children.push(irn);
        }
      }
    }
    sectionNode.children.push(leftCol);
  }

  // Create right column container
  const rightItems = [...rightSelectors, ...rightEmbedSelectors.map(r => ({ sel: r.selector, role: r.role, isGroup: false }))];
  if (rightItems.length > 0) {
    const rightCol: IRNode = {
      nodeType: "container",
      tagName: "div",
      fallbackPolicy: "generateblocks",
      layoutIntent: "stack",
      children: [],
      sourceMeta: "column-right",
    };
    // Extract column wrapper styles from DOM
    if ($rightDom.length > 0) {
      const colStyle = $rightDom.attr("style") || "";
      const colParsed = parseStyleString(colStyle);
      const si: Record<string, string> = {};
      for (const [k, v] of Object.entries(colParsed.styles)) {
        if (k === "gridColumn") continue;
        si[k] = String(v);
      }
      if (Object.keys(si).length > 0) rightCol.styleIntent = si;
    }
    for (const item of rightItems) {
      if (item.isGroup) {
        const group = manifest.groups!.find(g => g.selector === item.sel);
        if (group) {
          const gn = groupToIR($, group, warnings);
          if (gn) rightCol.children.push(gn);
        }
      } else {
        // Check if it's an embed (exception)
        const emb = manifest.exceptions?.find(e => e.selector === item.sel);
        if (emb) {
          const $el = $(emb.selector).first();
          const irn = elementToIR($, $el, emb, warnings);
          if (irn) rightCol.children.push(irn);
        } else {
          const el = manifest.elements.find(e => e.selector === item.sel);
          if (el) {
            const $el = $(el.selector).first();
            const irn = elementToIR($, $el, el, warnings);
            if (irn) rightCol.children.push(irn);
          }
        }
      }
    }
    sectionNode.children.push(rightCol);
  }
}

function processFlatElements(
  $: cheerio.CheerioAPI,
  manifest: SectionManifest,
  sectionNode: IRNode,
  warnings: string[],
): void {
  for (const el of manifest.elements) {
    if (el.role === "decoration") continue;
    const $el = $(el.selector);
    if ($el.length === 0) {
      warnings.push(`Element not found: "${el.selector}"`);
      continue;
    }
    const irNode = elementToIR($, $el.first(), el, warnings);
    if (irNode) sectionNode.children.push(irNode);
  }
}

function processGroups(
  $: cheerio.CheerioAPI,
  manifest: SectionManifest,
  sectionNode: IRNode,
  warnings: string[],
): void {
  if (!manifest.groups) return;
  for (const group of manifest.groups) {
    const groupNode = groupToIR($, group, warnings);
    if (groupNode) sectionNode.children.push(groupNode);
  }
}
