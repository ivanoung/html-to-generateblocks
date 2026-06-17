import postcss from "postcss";
import { canonicalizeRule } from "./css-canonicalizer.js";
import { isGbSupported } from "./gb-whitelist.js";
import { RejectionLog } from "./rejection-log.js";

// Re-export for convenience (tests import both from here)
export { disablePreflight } from "./tailwind-resolver.js";

// ── Tailwind Utility Detection ────────────────────────────
//
// Detects Tailwind v3 utility classes by naming pattern so they can be
// routed to static CSS instead of editable GB Global Styles. Utilities are
// generic atomic classes (.mt-4, .flex, .hover\:opacity-80) with zero
// design value as editable tokens. Custom design component classes
// (.blueprint-bg, .ruler-x, .hover-shadow-md) do NOT match these patterns.

/** Variant prefix chain: hover:, focus:, sm:, dark:, group-hover:, etc. */
const VARIANT =
  "(?:hover|focus|active|focus-within|focus-visible|group-hover|group-focus|" +
  "peer-checked|peer-hover|peer-focus|peer-invalid|peer-required|peer-disabled|" +
  "first|last|odd|even|visited|target|disabled|enabled|" +
  "checked|indeterminate|required|valid|invalid|autofill|placeholder-shown|" +
  "open|close|in-range|out-of-range|read-only|" +
  "selection|placeholder|file|marker|backdrop|before|after|" +
  "details|default|" +
  "motion-safe|motion-reduce|dark|rtl|ltr|" +
  "sm|md|lg|xl|2xl|" +
  "min-\\[[^\\]]+\\]|max-\\[[^\\]]+\\]|portrait|landscape|contrast-more|" +
  "contrast-less|supports-\\[[^\\]]+\\]|aria-\\[[^\\]]+\\]|data-\\[[^\\]]+\\])";
const VARIANT_CHAIN = `(?:${VARIANT}:)*`;

/** Compile a utility pattern with variant prefix support */
function utility(...suffixes: string[]): RegExp {
  return new RegExp(`^${VARIANT_CHAIN}(?:${suffixes.join("|")})`, "i");
}

const UTILITY_PATTERNS: RegExp[] = [
  // Spacing (negative values handled in isTailwindUtility)
  utility("[mp][tblrxy]?-", "space-[xy]?-", "gap-", "inset-[xy]?-"),
  // Sizing
  utility("[wh]-(?:auto|full|screen|min|max|fit|px|\\d|\\[)", "min-[wh]-", "max-[wh]-", "size-"),
  // Typography
  utility(
    "text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis|\\[)",
    "font-(?:sans|serif|mono|display|script|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\\[)",
    "tracking-", "leading-", "whitespace-", "break-", "truncate", "indent-",
    "align-", "list-", "decoration-", "underline", "overline", "line-through",
    "no-underline", "uppercase", "lowercase", "capitalize", "normal-case",
  ),
  // Colors
  utility("(?:bg|text|border|ring|ring-offset|outline|fill|stroke|placeholder|caret|accent|decoration|divide|shadow|from|via|to)-"),
  // Layout
  utility(
    "block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid",
    "hidden", "contents", "flow-root", "table", "table-row", "table-cell", "container",
  ),
  // Position
  utility("static", "fixed", "absolute", "relative", "sticky"),
  // Flex/Grid
  utility(
    "flex-(?:row|col|wrap|nowrap|1|auto|initial|none|shrink|grow)",
    "shrink", "grow",
    "items-", "justify-(?:start|end|center|between|around|evenly|normal|stretch)",
    "justify-items-", "justify-self-", "place-(?:content|items|self)-", "self-",
    "content-", "order-", "grid-cols-", "grid-rows-", "col-", "row-",
    "auto-cols-", "auto-rows-",
  ),
  // Overflow
  utility("overflow-"),
  // Effects / Borders
  utility(
    "opacity-", "shadow-", "rounded(?:-[tblr][lrb]?)?", "blur-", "brightness-",
    "contrast-", "grayscale", "invert", "sepia", "saturate-", "hue-rotate-",
    "drop-shadow-", "backdrop-", "mix-blend-", "bg-blend-",
    "border(?:-[tblrxy](?:-[0-9]+)?|-[0-9]+)?$", "divide-[xy]-",
  ),
  // Transforms
  utility("scale-", "rotate-", "translate-[xy]-", "skew-[xy]-", "origin-"),
  // Transitions/Animation
  utility("transition-", "duration-", "ease-", "delay-", "animate-"),
  // Interactivity
  utility(
    "cursor-", "select-", "resize", "scroll-", "sr-only", "not-sr-only",
    "pointer-events-", "appearance-",
  ),
  // SVG
  utility("(?:fill|stroke)-(?:current|none|inherit|transparent|\\[)", "stroke-\\d"),
  // Misc
  utility("forced-color-", "z-", "object-", "aspect-", "columns-", "box-decoration-", "box-(?:border|content)"),
  // Arbitrary values: w-[300px], text-[#fff], [&_>*]:block
  new RegExp(`^${VARIANT_CHAIN}\\[`, "i"),
];

/**
 * Detect Tailwind utility classes by naming pattern.
 * Returns true for atomic utilities (.mt-4, .flex, .hover\:opacity-80) that
 * should be routed to static CSS. Returns false for custom design component
 * classes (.blueprint-bg, .ruler-x) and BEM/semantic names.
 */
export function isTailwindUtility(className: string): boolean {
  // Strip leading dot and unescape CSS selector escaping (\: → :, \[ → [, etc.)
  // Tailwind class names in compiled CSS have escaped special chars:
  //   .hover\:opacity-80  →  hover:opacity-80
  //   .w-\[300px\]        →  w-[300px]
  const c = className.replace(/^\./, "").replace(/\\([:\[\]\(\)\#\%\>\<\{\}\$\&\*\@\!\+\,\.\/\'])/g, "$1");

  // Check explicit patterns
  for (const pattern of UTILITY_PATTERNS) {
    if (pattern.test(c)) return true;
  }

  // Tailwind negative values: -mx-4, -translate-x-4, -rotate-45, -space-x-4
  // Strip a single leading minus and re-test the rest.
  if (c.startsWith("-") && c.length > 1) {
    const positive = c.slice(1);
    for (const pattern of UTILITY_PATTERNS) {
      if (pattern.test(positive)) return true;
    }
  }

  // Note: we intentionally do NOT use a catch-all for lowercase hyphenated
  // names — it would false-positive on custom design classes like
  // .blueprint-bg, .ruler-x, .hover-shadow-md. The explicit patterns above
  // cover all Tailwind v3 default utilities. Custom utilities defined via
  // theme.extend may need a manual override (config/global-style-classes.json).

  return false;
}

export interface StructuredStyle {
  selector: string;
  name: string;
  styles: Record<string, unknown>;
  canonicalizedCss: string;
}

export interface ClassificationResult {
  structuredStyles: StructuredStyle[];
  /** Non-utility raw CSS: element selectors, @rules, unsupported props, compound selectors */
  uniqueCss: string;
  /** Tailwind utility classes routed to static CSS */
  utilityCss: string;
  rejectionLog: RejectionLog;
}

function classNameToName(className: string): string {
  return className
    .replace(/^\./, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ── Shorthand Expander ────────────────────────────────

/**
 * Expand CSS shorthand properties to longhands.
 * GB's data format uses longhands exclusively.
 */
function expandShorthands(decls: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...decls };

  // margin: X → marginTop/Right/Bottom/Left
  if (result.margin) {
    const parts = result.margin.split(/\s+/);
    delete result.margin;
    if (parts.length === 1) {
      result.marginTop = result.marginRight = result.marginBottom = result.marginLeft = parts[0];
    } else if (parts.length === 2) {
      result.marginTop = result.marginBottom = parts[0];
      result.marginRight = result.marginLeft = parts[1];
    } else if (parts.length === 3) {
      result.marginTop = parts[0];
      result.marginRight = result.marginLeft = parts[1];
      result.marginBottom = parts[2];
    } else if (parts.length === 4) {
      result.marginTop = parts[0];
      result.marginRight = parts[1];
      result.marginBottom = parts[2];
      result.marginLeft = parts[3];
    }
  }

  // padding: X → paddingTop/Right/Bottom/Left
  if (result.padding) {
    const parts = result.padding.split(/\s+/);
    delete result.padding;
    if (parts.length === 1) {
      result.paddingTop = result.paddingRight = result.paddingBottom = result.paddingLeft = parts[0];
    } else if (parts.length === 2) {
      result.paddingTop = result.paddingBottom = parts[0];
      result.paddingRight = result.paddingLeft = parts[1];
    } else if (parts.length === 3) {
      result.paddingTop = parts[0];
      result.paddingRight = result.paddingLeft = parts[1];
      result.paddingBottom = parts[2];
    } else if (parts.length === 4) {
      result.paddingTop = parts[0];
      result.paddingRight = parts[1];
      result.paddingBottom = parts[2];
      result.paddingLeft = parts[3];
    }
  }

  // border: Npx style color → borderWidth/Style/Color
  if (result.border) {
    const parts = result.border.split(/\s+/);
    delete result.border;
    if (parts.length >= 1) {
      result.borderTopWidth = result.borderRightWidth = result.borderBottomWidth = result.borderLeftWidth = parts[0];
    }
    if (parts.length >= 2) {
      result.borderTopStyle = result.borderRightStyle = result.borderBottomStyle = result.borderLeftStyle = parts[1];
    }
    if (parts.length >= 3) {
      result.borderTopColor = result.borderRightColor = result.borderBottomColor = result.borderLeftColor = parts[2];
    }
  }

  // border-radius: X → borderTopLeftRadius etc.
  if (result.borderRadius) {
    const parts = result.borderRadius.split(/\s+/);
    delete result.borderRadius;
    if (parts.length === 1) {
      result.borderTopLeftRadius = result.borderTopRightRadius = result.borderBottomLeftRadius = result.borderBottomRightRadius = parts[0];
    } else if (parts.length === 2) {
      result.borderTopLeftRadius = result.borderBottomRightRadius = parts[0];
      result.borderTopRightRadius = result.borderBottomLeftRadius = parts[1];
    } else if (parts.length === 3) {
      result.borderTopLeftRadius = parts[0];
      result.borderTopRightRadius = result.borderBottomLeftRadius = parts[1];
      result.borderBottomRightRadius = parts[2];
    } else if (parts.length === 4) {
      result.borderTopLeftRadius = parts[0];
      result.borderTopRightRadius = parts[1];
      result.borderBottomRightRadius = parts[2];
      result.borderBottomLeftRadius = parts[3];
    }
  }

  return result;
}

// ── GB Import Format Generator ─────────────────────────

export class CssClassifier {
  static classify(css: string): ClassificationResult {
    const root = postcss.parse(css, { from: undefined });
    const structured: StructuredStyle[] = [];
    const uniqueParts: string[] = [];
    const utilityParts: string[] = [];
    const rejectionLog = new RejectionLog();
    const seenRawSelectors = new Set<string>();

    // Process root-level children only (skip @media internals — those go to unique CSS wholesale)
    function processNodes(nodes: any[]) {
      for (const node of nodes) {
        if (node.type === "rule") {
          processRule(node as postcss.Rule);
        } else if (node.type === "atrule") {
          const atRule = node as postcss.AtRule;
          // @media, @supports, @layer, @container, @import: entire block → unique CSS
          uniqueParts.push(atRule.toString());
          if (atRule.name === "keyframes") {
            rejectionLog.add(`@keyframes ${atRule.params}`, "ATRULE_KEYFRAMES", undefined, "expected");
          }
        }
      }
    }

    function processRule(rule: postcss.Rule) {
      const selector = rule.selector.trim();

      // Route non-class selectors to unique CSS (element selectors like body, h1, html)
      if (!selector.startsWith(".")) {
        uniqueParts.push(rule.toString());
        rejectionLog.add(selector, "NON_CLASS_SELECTOR", undefined, "expected");
        return;
      }

      // Route compound selectors to unique CSS (.foo .bar, .foo > .bar)
      if (/\s/.test(selector) || />|~|\+|,/.test(selector)) {
        uniqueParts.push(rule.toString());
        rejectionLog.add(selector, "COMPOUND_SELECTOR", undefined, "expected");
        return;
      }

      // Route Tailwind utility classes to their own static CSS file — they're
      // atomic classes with zero design value as editable GB Global Styles.
      // Only custom design component classes proceed to GB canonicalization.
      if (isTailwindUtility(selector)) {
        utilityParts.push(rule.toString());
        rejectionLog.add(selector, "TAILWIND_UTILITY", undefined, "expected", "tailwind-utilities.css");
        return;
      }

      // Canonicalize
      const canonResult = canonicalizeRule(rule);
      if (canonResult.skipped) {
        uniqueParts.push(rule.toString());
        rejectionLog.add(selector, "CANONICALIZE_SKIPPED", undefined, "expected");
        return;
      }
      for (const w of canonResult.warnings) {
        rejectionLog.add(selector, w, undefined, "warning");
      }

      // Split declarations: GB-compatible → structured, rest → raw CSS
      const structuredDecls: Record<string, string> = {};
      const rawDecls: string[] = [];

      for (const node of rule.nodes) {
        if (node.type !== "decl") continue;
        const decl = node as postcss.Declaration;
        const camelProp = kebabToCamel(decl.prop);

        if (decl.prop.startsWith("--")) {
          rawDecls.push(`${decl.prop}: ${decl.value}`);
          continue;
        }

        if (isGbSupported(camelProp, decl.value)) {
          structuredDecls[camelProp] = decl.value;
        } else {
          rawDecls.push(`${decl.prop}: ${decl.value}`);
          rejectionLog.add(selector, "UNSUPPORTED_PROPERTY", camelProp, "expected");
        }
      }

      // Capture canonicalized CSS string for the import format
      const canonicalizedCss = rule.toString();

      // If structured declarations exist, add to structured styles
      if (Object.keys(structuredDecls).length > 0) {
        structured.push({
          selector,
          name: classNameToName(selector),
          styles: expandShorthands(structuredDecls),
          canonicalizedCss,
        });
      }

      // If raw declarations exist, add a rule with only raw decls to unique CSS
      if (rawDecls.length > 0) {
        const rawRule = `${selector} {\n  ${rawDecls.join(";\n  ")};\n}`;
        uniqueParts.push(rawRule);
      }
    }

    // Process root-level nodes
    processNodes(root.nodes);

    // Merge duplicate selectors: same class from <style> blocks + CDN compilation.
    // Later properties override earlier ones (CSS cascade semantics).
    const merged = new Map<string, StructuredStyle>();
    for (const s of structured) {
      const existing = merged.get(s.selector);
      if (existing) {
        Object.assign(existing.styles, s.styles);
        existing.canonicalizedCss = s.canonicalizedCss;
      } else {
        merged.set(s.selector, { ...s });
      }
    }

    return {
      structuredStyles: [...merged.values()],
      uniqueCss: uniqueParts.join("\n\n") + "\n",
      utilityCss: utilityParts.join("\n\n") + "\n",
      rejectionLog,
    };
  }
}

// ── GB Import Format Generator ─────────────────────────

/**
 * Generate GB's native import format: a flat array of
 * {selector, css, data} objects suitable for direct import
 * into GenerateBlocks → Global Styles.
 */
export function generateGbImportFormat(
  structuredStyles: StructuredStyle[],
): Array<{ selector: string; css: string; data: Record<string, unknown> }> {
  // Merge duplicates by selector with cascade semantics
  const seen = new Map<string, { selector: string; css: string; data: Record<string, unknown> }>();
  for (const s of structuredStyles) {
    const existing = seen.get(s.selector);
    if (existing) {
      Object.assign(existing.data, s.styles);
      existing.css = s.canonicalizedCss;
    } else {
      seen.set(s.selector, {
        selector: s.selector,
        css: s.canonicalizedCss,
        data: { ...s.styles },
      });
    }
  }
  return [...seen.values()];
}
