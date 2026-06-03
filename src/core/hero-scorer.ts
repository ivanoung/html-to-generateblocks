// ── Hero Scorer ────────────────────────────────────────────────
//
// Scores an IRNode tree for "hero-composite" pattern matching.
// Used by the hero converter to decide pattern vs generic mode.

import type { IRNode } from "./ir-node.js";

export interface HeroScore {
  score: number;          // 0.0 – 1.0
  hasSection: boolean;
  hasConstrainedInner: boolean;
  hasTwoColumns: boolean;
  hasHeading: boolean;
  hasParagraph: boolean;
  hasCTA: boolean;
  hasVisual: boolean;
  details: string[];      // human-readable scoring details
}

export interface HeroConverterOptions {
  mode: "auto" | "pattern-only" | "generic-only";
  minPatternScore: number;  // default 0.75
}

export const DEFAULT_OPTIONS: HeroConverterOptions = {
  mode: "auto",
  minPatternScore: 0.75,
};

/**
 * Score an IR tree against the hero-composite pattern.
 */
export function scoreHeroPattern(root: IRNode): HeroScore {
  const details: string[] = [];
  let hasSection = false;
  let hasConstrainedInner = false;
  let hasTwoColumns = false;
  let hasHeading = false;
  let hasParagraph = false;
  let hasCTA = false;
  let hasVisual = false;

  // Walk the tree once to collect features
  collectFeatures(root, {
    markSection: () => { hasSection = true; },
    markConstrainedInner: () => { hasConstrainedInner = true; },
    markTwoColumns: () => { hasTwoColumns = true; },
    markHeading: () => { hasHeading = true; },
    markParagraph: () => { hasParagraph = true; },
    markCTA: () => { hasCTA = true; },
    markVisual: () => { hasVisual = true; },
    details,
  });

  // Weighted scoring
  let score = 0;
  if (hasSection) score += 0.15;
  if (hasConstrainedInner) score += 0.15;
  if (hasTwoColumns) score += 0.30;
  if (hasHeading) score += 0.10;
  if (hasParagraph) score += 0.05;
  if (hasCTA) score += 0.10;
  if (hasVisual) score += 0.15;

  details.push(`Score: ${score.toFixed(2)} (section:${hasSection} inner:${hasConstrainedInner} cols:${hasTwoColumns} h1-h2:${hasHeading} p:${hasParagraph} cta:${hasCTA} visual:${hasVisual})`);

  return {
    score: Math.min(score, 1.0),
    hasSection,
    hasConstrainedInner,
    hasTwoColumns,
    hasHeading,
    hasParagraph,
    hasCTA,
    hasVisual,
    details,
  };
}

interface FeatureSetters {
  markSection: () => void;
  markConstrainedInner: () => void;
  markTwoColumns: () => void;
  markHeading: () => void;
  markParagraph: () => void;
  markCTA: () => void;
  markVisual: () => void;
  details: string[];
}

function collectFeatures(node: IRNode, f: FeatureSetters): void {
  switch (node.nodeType) {
    case "section":
      f.markSection();
      f.details.push("Found section wrapper");
      break;
    case "container":
      // Detection: constrained = layoutIntent "constrained" OR max-width + auto margins
      const isConstrained = node.layoutIntent === "constrained" ||
        (node.styleIntent?.["max-width"] && node.styleIntent?.["margin-left"] === "auto" && node.styleIntent?.["margin-right"] === "auto");
      if (isConstrained) {
        f.markConstrainedInner();
        f.details.push("Found constrained inner container");
      }
      // Detect two-column layout
      const isMultiCol = node.layoutIntent === "split" ||
        node.layoutIntent === "row" ||
        node.layoutIntent === "grid";
      if (isMultiCol && node.children.length >= 2) {
        const nonText = node.children.filter(c =>
          c.nodeType !== "paragraph" && c.nodeType !== "span");
        if (nonText.length >= 2) {
          f.markTwoColumns();
          f.details.push(`Found ${node.layoutIntent} layout with ${nonText.length} columns`);
        }
      }
      if (isMultiCol) {
        const hasMedia = node.children.some(c =>
          containsNodeType(c, "image") || containsNodeType(c, "icon"));
        if (hasMedia) {
          f.markVisual();
          f.details.push("Found visual in multi-col layout");
        }
      }
      break;
    case "heading":
      if (node.tagName === "h1" || node.tagName === "h2") {
        f.markHeading();
        f.details.push(`Found ${node.tagName} heading`);
      }
      break;
    case "paragraph":
      f.markParagraph();
      break;
    case "button-link":
      f.markCTA();
      f.details.push("Found CTA (button-link)");
      break;
    case "image":
      f.markVisual();
      f.details.push("Found visual (image)");
      break;
  }

  // Recurse
  for (const child of node.children) {
    collectFeatures(child, f);
  }
}

function containsNodeType(root: IRNode, type: string): boolean {
  if (root.nodeType === type) return true;
  return root.children.some(c => containsNodeType(c, type));
}
