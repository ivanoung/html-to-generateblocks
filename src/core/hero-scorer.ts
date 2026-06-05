// ── Hero Scorer ────────────────────────────────────────────────
//
// Scores an IRNode tree for hero pattern matching.
// Two pattern families:
//   Family A: two-column hero (section → constrained inner → grid → columns)
//   Family B: centered single-column hero (section → constrained inner → stacked content)
//
// Key distinctions:
//   hasTwoColumns — only grid/split layoutIntent at the hero-content level,
//     never a row container (CTA row or stats row). A row alone does NOT
//     mean two-column hero.
//   hasStatsRow — row container with 2+ stat-shaped children
//     (each child: container with 2 paragraphs where first starts with digit)
//   hasCenteredStack — constrained container with text-align:center or
//     justify-content:center + subtree-local heading + paragraph/CTA content

import type { IRNode } from "./ir-node.js";

export interface HeroScore {
  score: number;
  hasSection: boolean;
  hasConstrainedInner: boolean;
  hasTwoColumns: boolean;
  hasHeading: boolean;
  hasParagraph: boolean;
  hasCTA: boolean;
  hasVisual: boolean;
  hasStatsRow: boolean;
  hasCenteredStack: boolean;
  details: string[];
}

export interface HeroConverterOptions {
  mode: "auto" | "pattern-only" | "generic-only";
  minPatternScore: number;
}

export const DEFAULT_OPTIONS: HeroConverterOptions = {
  mode: "auto",
  minPatternScore: 0.75,
};

export function scoreHeroPattern(root: IRNode): HeroScore {
  const details: string[] = [];
  let hasSection = false;
  let hasConstrainedInner = false;
  let hasTwoColumns = false;
  let hasHeading = false;
  let hasParagraph = false;
  let hasCTA = false;
  let hasVisual = false;
  let hasStatsRow = false;
  let hasCenteredStack = false;

  collectFeatures(root, {
    markSection: () => { hasSection = true; },
    markConstrainedInner: () => { hasConstrainedInner = true; },
    markTwoColumns: () => { hasTwoColumns = true; },
    markHeading: () => { hasHeading = true; },
    markParagraph: () => { hasParagraph = true; },
    markCTA: () => { hasCTA = true; },
    markVisual: () => { hasVisual = true; },
    markStatsRow: () => { hasStatsRow = true; },
    markCenteredStack: () => { hasCenteredStack = true; },
    details,
  });

  // ── Pattern family detection ─────────────────────────────────
  // Family A: two-column hero — requires structural grid/split, not just any row
  const isFamilyA = hasSection && hasConstrainedInner && hasTwoColumns && hasHeading;
  // Family B: centered single-column — requires centered stack WITHOUT two columns
  const isFamilyB = hasSection && hasConstrainedInner && hasCenteredStack && hasHeading && !hasTwoColumns;

  let score = 0;

  if (isFamilyA) {
    // Two-column pattern hero
    score = 0.70;
    if (hasCTA) score += 0.08;
    if (hasParagraph) score += 0.05;
    if (hasVisual) score += 0.10;
    if (hasStatsRow) score += 0.05;
    details.push("Family A: two-column hero pattern");
  } else if (isFamilyB) {
    // Centered single-column pattern hero
    score = 0.65;
    if (hasCTA) score += 0.10;
    if (hasParagraph) score += 0.05;
    if (hasVisual) score += 0.05;
    if (hasStatsRow) score += 0.10;
    details.push("Family B: centered single-column hero pattern");
  } else {
    // Generic fallback scoring — each feature contributes independently
    if (hasSection) score += 0.15;
    if (hasConstrainedInner) score += 0.10;
    if (hasTwoColumns) score += 0.20;
    if (hasHeading) score += 0.15;
    if (hasParagraph) score += 0.05;
    if (hasCTA) score += 0.10;
    if (hasVisual) score += 0.10;
    if (hasStatsRow) score += 0.10;
    details.push("Generic fallback scoring");
  }

  details.push(`Score: ${score.toFixed(2)} (section:${hasSection} inner:${hasConstrainedInner} cols:${hasTwoColumns} h1:${hasHeading} p:${hasParagraph} cta:${hasCTA} visual:${hasVisual} stats:${hasStatsRow} centered:${hasCenteredStack})`);

  return {
    score: Math.min(score, 1.0),
    hasSection, hasConstrainedInner, hasTwoColumns,
    hasHeading, hasParagraph, hasCTA, hasVisual,
    hasStatsRow, hasCenteredStack,
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
  markStatsRow: () => void;
  markCenteredStack: () => void;
  details: string[];
}

function collectFeatures(node: IRNode, f: FeatureSetters): void {
  switch (node.nodeType) {
    case "section":
      f.markSection();
      f.details.push("Found section wrapper");
      break;

    case "container": {
      // Detection: constrained = layoutIntent "constrained" OR max-width + auto margins
      const isConstrained = node.layoutIntent === "constrained" ||
        (node.styleIntent?.["max-width"] &&
         node.styleIntent?.["margin-left"] === "auto" &&
         node.styleIntent?.["margin-right"] === "auto");
      if (isConstrained) {
        f.markConstrainedInner();
        f.details.push("Found constrained inner container");
      }

      // ── hasTwoColumns: ONLY grid/split layoutIntent, NEVER row ──
      // A row container (CTA row, stats row) is NOT a two-column layout.
      // Detection requires structural grid/split at the hero-content level.
      const isMultiColGrid = node.layoutIntent === "grid" || node.layoutIntent === "split";
      // Explicitly reject row containers — they cannot satisfy hasTwoColumns
      const isRow = node.layoutIntent === "row";
      if (isMultiColGrid && !isRow && node.children.length >= 2) {
        const childContainers = node.children.filter(
          c => c.nodeType === "container" && c.children.length > 0
        );
        if (childContainers.length >= 2) {
          f.markTwoColumns();
          f.details.push(`Found ${node.layoutIntent} layout with ${childContainers.length} columns`);
        }
      }

      // ── hasStatsRow: row with 2+ stat-shaped containers ──
      // Stat shape: container with exactly 2 paragraphs where first starts with digit
      if (isRow && node.children.length >= 2) {
        const statShaped = node.children.filter(
          c => c.nodeType === "container" &&
            c.children.length === 2 &&
            c.children.filter(cc => cc.nodeType === "paragraph").length === 2
        );
        if (statShaped.length >= 2) {
          f.markStatsRow();
          f.details.push(`Found stats row (${statShaped.length} stat items)`);
        } else {
          // Check for visual content in multi-item rows
          const hasMedia = node.children.some(
            c => containsNodeType(c, "image") || containsNodeType(c, "icon")
          );
          if (hasMedia) {
            f.markVisual();
            f.details.push("Found visual in row layout");
          }
        }
      }

      // ── hasCenteredStack: constrained + centered + has content ──
      // Subtree-local: check THIS container's own descendants for heading + content
      const isGridOrSplit = node.layoutIntent === "grid" || node.layoutIntent === "split";
      if (isConstrained && !isGridOrSplit) {
        const isCentered = node.styleIntent?.["text-align"] === "center" ||
          node.styleIntent?.["justify-content"] === "center";
        // Subtree-local checks (not global)
        const subtreeHasHeading = node.children.some(c => containsNodeType(c, "heading"));
        const subtreeHasParagraph = node.children.some(c => containsNodeType(c, "paragraph"));
        const subtreeHasCTA = node.children.some(c => containsNodeType(c, "button-link"));
        const hasContent = subtreeHasHeading && (subtreeHasParagraph || subtreeHasCTA);

        if (isCentered && hasContent) {
          f.markCenteredStack();
          f.details.push("Found centered stack with heading + CTA or paragraph");
        } else if (isConstrained && !isCentered && hasContent) {
          // Constrained but not centered — still may be a hero, but not centered stack
          f.details.push("Found constrained container (not centered) with content");
        }
      }
      break;
    }

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

  for (const child of node.children) {
    collectFeatures(child, f);
  }
}

function containsNodeType(root: IRNode, type: string): boolean {
  if (root.nodeType === type) return true;
  return root.children.some(c => containsNodeType(c, type));
}
