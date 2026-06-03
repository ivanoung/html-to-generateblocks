// ── Intermediate Representation ────────────────────────────────
//
// M2 IR layer between source parsing and block serialization.
// Semantic types only — no GB-specific serializer concerns.

export type IRNodeType =
  | "section"
  | "container"
  | "heading"
  | "paragraph"
  | "button-link"
  | "span"
  | "image"
  | "list"
  | "quote"
  | "icon";

export type LayoutIntent =
  | "wrapper"
  | "stack"
  | "row"
  | "grid"
  | "split"
  | "centered"
  | "constrained";

export type FallbackPolicy =
  | "generateblocks"
  | "core"
  | "reject";

/** Semantic style intent — normalized, pre-GB camelCase conversion. */
export type StyleIntent = Record<string, string>;

/** The IR node — deterministic, serializable, serializer-free. */
export interface IRNode {
  nodeType: IRNodeType;
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, string>;
  styleIntent?: StyleIntent;
  layoutIntent?: LayoutIntent;
  children: IRNode[];
  fallbackPolicy: FallbackPolicy;
  sourceMeta?: string;
  /** Raw HTML payload (used for icon/shape SVG content). */
  html?: string;
  /** Responsive style overrides keyed by breakpoint (1024, 768). */
  responsiveIntent?: Record<string, Record<string, string>>;
}

export function isValidIRType(t: string): t is IRNodeType {
  return [
    "section", "container", "heading", "paragraph",
    "button-link", "span", "image", "list", "quote", "icon",
  ].includes(t);
}

export function isValidFallbackPolicy(p: string): p is FallbackPolicy {
  return ["generateblocks", "core", "reject"].includes(p);
}
