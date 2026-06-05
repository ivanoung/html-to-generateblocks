// ── Role Mapper (Phase 4) ──────────────────────────────────────
//
// Maps manifest element/group roles to IR node types.
// Pure data module — no logic, just lookup tables.

import type { IRNodeType, LayoutIntent, FallbackPolicy } from "../core/ir-node.js";
import type { ElementRole, GroupRole } from "../types/manifest.js";

export interface RoleMapping {
  nodeType: IRNodeType;
  layoutIntent?: LayoutIntent;
  fallbackPolicy: FallbackPolicy;
  /** If true, wraps element HTML in a core/html block. */
  useCoreHtml?: boolean;
  /** IRNodeType to use when core/html wrapping is active. */
  coreHtmlNodeType?: IRNodeType;
}

/** Map of element role → IR conversion rules. */
export const ELEMENT_ROLE_MAP: Record<ElementRole, RoleMapping> = {
  "heading": { nodeType: "heading", fallbackPolicy: "generateblocks" },
  "eyebrow": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "section-label": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "body": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "cta-button": { nodeType: "button-link", fallbackPolicy: "generateblocks" },
  "cta-link": { nodeType: "button-link", fallbackPolicy: "generateblocks" },
  "image": { nodeType: "image", fallbackPolicy: "core" },
  "icon": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "iconify": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "avatar": { nodeType: "image", fallbackPolicy: "core" },
  "avatar-stack": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "star-rating": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "social-proof": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "card": { nodeType: "container", layoutIntent: "stack", fallbackPolicy: "generateblocks" },
  "card-heading": { nodeType: "heading", fallbackPolicy: "generateblocks" },
  "card-body": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "card-footer": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "card-step-label": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "checklist-item": { nodeType: "container", layoutIntent: "row", fallbackPolicy: "generateblocks" },
  "testimonial": { nodeType: "container", layoutIntent: "stack", fallbackPolicy: "generateblocks" },
  "testimonial-quote": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "testimonial-name": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "testimonial-title": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "testimonial-company": { nodeType: "paragraph", fallbackPolicy: "generateblocks" },
  "form-field": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "form-radio-group": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "form-textarea": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "form-submit": { nodeType: "button-link", fallbackPolicy: "generateblocks" },
  "embed": { nodeType: "container", fallbackPolicy: "core", useCoreHtml: true },
  "decoration": { nodeType: "container", fallbackPolicy: "reject" },
};

/** Map of group role → container layout intent. */
export const GROUP_LAYOUT_MAP: Record<GroupRole, LayoutIntent> = {
  "cta-row": "row",
  "checklist": "stack",
  "card-grid": "grid",
  "feature-card-grid": "grid",
  "testimonial-grid": "grid",
  "social-proof-group": "row",
  "avatar-row": "row",
  "star-row": "row",
};

/**
 * Manifest section layout → IR container layoutIntent.
 */
export function sectionLayoutToIntent(
  layout: string,
): LayoutIntent {
  switch (layout) {
    case "two-column": return "grid";
    case "grid": return "grid";
    case "flex-row": return "row";
    case "form": return "stack";
    case "single-column":
    default: return "constrained";
  }
}
