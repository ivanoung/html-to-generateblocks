// ── CSS Splitter ───────────────────────────────────────────
//
// Parses compiled CSS and splits into:
// - globalStyles: structural + typography class rules (editor preview fidelity)
// - uniqueCss: backgrounds, effects, colors, preflight, element selectors, keyframes
//
// Classification is property-based. Any rule with a UC-only property
// goes entirely to uniqueCss. Rules with only GS-eligible properties
// and a single-class selector become Global Style entries.
// @media blocks are recursed into so responsive variants get
// individual classification with their media wrapper preserved.
// Unrecognized properties default to UC (safe fallback).

import css from "css";
import { GS_ELIGIBLE_PROPERTIES, UC_ONLY_PROPERTIES } from "./types.js";

export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}

export interface CssSplitResult {
  globalStyles: GlobalStyleEntry[];
  uniqueCss: string;
}

// ── Selector helpers (unchanged from original) ──────────────

/**
 * Check if a CSS selector is a single class selector.
 * Matches: .foo, .foo\:bar, .foo\:bar:hover
 * Does NOT match: tag selectors, pseudo-elements (::), multi-selectors (a,b),
 *   combinators (a b, a>b, a+b, a~b)
 */
function isSingleClassSelector(selector: string): boolean {
  if (/::/.test(selector)) return false;

  const withoutPseudo = selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");

  const unescaped = withoutPseudo
    .replace(/\\:/g, ":")
    .replace(/\\\//g, "/")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\\#/g, "#")
    .replace(/\\\./g, ".");

  // Reject functional pseudo-classes (parentheses), combinators, and multi-selectors.
  // Compound class selectors are caught by the second-dot check below.
  // Unescaped colons are caught by the separate colon guard.
  const baseOnly = withoutPseudo.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");
  if (/[,\s>+~()]/.test(baseOnly)) return false;
  if (baseOnly.indexOf(".", 1) !== -1) return false;
  // Reject unescaped colons in the base selector — these are pseudo-classes
  // that were not stripped (e.g., :nth-child(2), .foo:not(.bar)).
  // Escaped colons (\:) from variant class names (e.g., .md\:text-7xl) are allowed.
  if (/(?:^|[^\\]):/.test(baseOnly)) return false;

  return /^\.[^,\s>+~]+$/.test(withoutPseudo) && !withoutPseudo.includes("::");
}

/**
 * Extract the base class name (without pseudo-classes).
 */
function extractBaseSelector(selector: string): string {
  return selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");
}

/**
 * Get the unescaped class name (no dot, no escapes).
 */
function getClassName(selector: string): string {
  const base = extractBaseSelector(selector);
  return base
    .replace(/^\./, "")
    .replace(/\\(.)/g, "$1");
}

/**
 * Convert a kebab-case class name to Title Case.
 */
function classNameToName(className: string): string {
  const clean = className.replace(/^\./, "").replace(/(:[a-zA-Z-]+)+$/, "");
  return clean
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── WordPress-safe selector conversion ──────────────────────

/**
 * Convert a CSS-escaped class selector to a WordPress-safe format.
 * Uses [class~="..."] attribute selectors to avoid backslash characters
 * that WordPress wp_unslash() strips from post meta.
 *
 * Only converts selectors that actually contain CSS escapes.
 * Pseudo-classes are split and placed outside the attribute selector.
 * Non-class selectors (elements, pseudo-elements) are returned unchanged.
 */
function toSafeCssSelector(selector: string): string {
  // Only convert class selectors that have CSS escapes
  if (!selector.startsWith(".") || !/[\\:\[\]\/]/.test(selector)) {
    return selector;
  }

  // Use existing helper to split pseudo-classes from the base selector.
  // extractBaseSelector correctly handles CSS-escaped colons (e.g. .md\:flex)
  // and only strips real pseudo-classes at the END of the selector.
  const base = extractBaseSelector(selector);
  const pseudo = selector.slice(base.length);

  // Unescape the class portion: strip leading dot, then remove backslash escapes
  const rawClass = base
    .replace(/^\./, "")
    .replace(/\\(.)/g, "$1");

  // Sanitize internal double quotes (shouldn't exist, but safe)
  const safeClass = rawClass.replace(/"/g, '\\"');

  return `[class~="${safeClass}"]${pseudo}`;
}

/**
 * Sanitize a CSS selector for the WordPress admin label (gb_style_selector).
 * Replaces CSS escape sequences with hyphens since WordPress strips backslashes.
 * Only used for the selector field in GlobalStyleEntry — not for actual CSS.
 */
function sanitizeSelector(selector: string): string {
  return selector
    .replace(/\\:/g, "-")
    .replace(/\\\[/g, "-")
    .replace(/\\\]/g, "")
    .replace(/\\\//g, "-")
    .replace(/\\%/g, "%");
}

// ── CSS serialization ───────────────────────────────────────

/**
 * Serialize a CSS rule AST node back to a CSS string.
 */
function serializeRule(rule: css.Rule | css.Media, safe = false): string {
  if (rule.type === "media") {
    const media = rule as css.Media;
    const innerCss = (media.rules || [])
      .map((r) => serializeRule(r as css.Rule, safe))
      .join("");
    return `@media ${media.media}{${innerCss}}`;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selector = (r.selectors || [])
      .map((s) => safe ? toSafeCssSelector(s) : s)
      .join(",");
    const declarations = (r.declarations || [])
      .map((d) => `${d.property}:${d.value}`)
      .join(";");
    return `${selector}{${declarations}${declarations ? ";" : ""}}`;
  }

  if (rule.type === "keyframes") {
    const kf = rule as css.KeyFrames;
    const keyframesCss = (kf.keyframes || [])
      .map((k) => {
        const decs = (k.declarations || [])
          .map((d) => `${d.property}:${d.value}`)
          .join(";");
        return `${k.values.join(",")}{${decs}${decs ? ";" : ""}}`;
      })
      .join("");
    return `@keyframes ${kf.name}{${keyframesCss}}`;
  }

  if (rule.type === "font-face") {
    const ff = rule as css.FontFace;
    const declarations = (ff.declarations || [])
      .map((d) => `${d.property}:${d.value}`)
      .join(";");
    return `@font-face{${declarations}${declarations ? ";" : ""}}`;
  }

  if (rule.type === "supports") {
    const sup = rule as css.Supports;
    const innerCss = (sup.rules || [])
      .map((r) => serializeRule(r as css.Rule))
      .join("");
    return `@supports ${sup.supports}{${innerCss}}`;
  }

  // Other at-rules: charset, import, namespace, page, etc.
  // Return empty string — these are typically stripped during preprocessing
  // and should not appear in compiled Tailwind output.
  return "";
}

// ── Property classification ─────────────────────────────────

/**
 * Classify a rule's declarations. Returns "uc" if ANY declaration
 * has a UC-only property or an unrecognized property. Returns "gs"
 * only if ALL properties are in the GS-eligible set.
 * Empty rules (no declarations) default to UC to avoid noise.
 */
function classifyDeclarations(declarations: css.Declaration[]): "gs" | "uc" {
  if (declarations.length === 0) return "uc";

  for (const decl of declarations) {
    if (!decl.property) continue;
    const prop = decl.property.toLowerCase().trim();

    if (UC_ONLY_PROPERTIES.has(prop)) return "uc";
    if (GS_ELIGIBLE_PROPERTIES.has(prop)) continue;

    // Unrecognized property → safe fallback to UC
    return "uc";
  }
  return "gs";
}

// ── Rule walking ────────────────────────────────────────────

/**
 * Walk a CSS rule and classify it.
 *
 * Logic:
 * - Pseudo-elements (::) → UC regardless of properties
 * - @media blocks → recurse into children, classify each individually
 * - Custom class name (from style blocks) + single class → GS (priority bypass)
 * - All declarations GS-eligible + single class selector → GS
 * - Everything else → UC
 */
function walkRule(
  rule: css.Rule | css.Media,
  globalStyles: GlobalStyleEntry[],
  uniqueCssParts: string[],
  customClassNames: Set<string>,
): void {
  if (rule.type === "media") {
    // Recurse into @media children. Each child is classified individually.
    // GS-eligible children get the @media wrapper in their css field.
    // UC children get the @media wrapper in uniqueCssParts.
    const media = rule as css.Media;
    const children = media.rules || [];

    const gsChildren: css.Rule[] = [];
    const ucChildren: css.Rule[] = [];

    for (const child of children) {
      if (child.type === "rule") {
        const r = child as css.Rule;

        // Pseudo-elements always UC
        if ((r.selectors || []).some((s) => s.includes("::"))) {
          ucChildren.push(r);
          continue;
        }

        // Custom class names from style blocks get priority — skip property check
        if (
          (r.selectors || []).length === 1 &&
          isSingleClassSelector(r.selectors![0]) &&
          customClassNames.has(getClassName(r.selectors![0]))
        ) {
          gsChildren.push(r);
          continue;
        }

        const classification = classifyDeclarations(
          (r.declarations || []) as css.Declaration[],
        );

        if (classification === "gs") {
          gsChildren.push(r);
        } else {
          ucChildren.push(r);
        }
      } else {
        // Nested @media, keyframes, etc. → serialize and treat as UC
        ucChildren.push(child as css.Rule);
      }
    }

    // Serialize UC children with @media wrapper
    if (ucChildren.length > 0) {
      const wrappedMedia: css.Media = { ...media, rules: ucChildren };
      uniqueCssParts.push(serializeRule(wrappedMedia));
    }

    // Create GS entries for GS children with @media wrapper
    for (const child of gsChildren) {
      const selectors = child.selectors || [];
      if (selectors.length === 1 && isSingleClassSelector(selectors[0])) {
        const wrappedMedia: css.Media = { ...media, rules: [child] };
        const selector = selectors[0];
        const baseSelector = extractBaseSelector(selector);
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: sanitizeSelector(baseSelector),
          css: serializeRule(wrappedMedia, true),
        });
      } else {
        // Multi-selector or non-class inside @media → UC
        const wrappedMedia: css.Media = { ...media, rules: [child] };
        uniqueCssParts.push(serializeRule(wrappedMedia));
      }
    }
    return;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selectors = r.selectors || [];

    // Pseudo-elements always UC
    if (selectors.some((s) => s.includes("::"))) {
      uniqueCssParts.push(serializeRule(r));
      return;
    }

    // Custom class names from style blocks get priority — skip property check
    if (
      selectors.length === 1 &&
      isSingleClassSelector(selectors[0]) &&
      customClassNames.has(getClassName(selectors[0]))
    ) {
      const selector = selectors[0];
      const baseSelector = extractBaseSelector(selector);
      globalStyles.push({
        name: classNameToName(baseSelector),
        selector: sanitizeSelector(baseSelector),
        css: serializeRule(r, true),
      });
      return;
    }

    // Property-based classification
    const classification = classifyDeclarations(
      (r.declarations || []) as css.Declaration[],
    );

    if (
      classification === "gs" &&
      selectors.length === 1 &&
      isSingleClassSelector(selectors[0])
    ) {
      const selector = selectors[0];
      const baseSelector = extractBaseSelector(selector);
      globalStyles.push({
        name: classNameToName(baseSelector),
        selector: sanitizeSelector(baseSelector),
        css: serializeRule(r, true),
      });
    } else {
      uniqueCssParts.push(serializeRule(r));
    }
    return;
  }

  // Other types: keyframes, font-face, charset, etc. — always unique
  uniqueCssParts.push(serializeRule(rule));
}

// ── Main entry point ────────────────────────────────────────

/**
 * Split compiled CSS into globalStyles (structural + typography classes)
 * and uniqueCss (backgrounds, effects, colors, preflight, keyframes, etc.).
 *
 * @param compiledCss     The full compiled CSS
 * @param customClassNames Set of unescaped class names (no dot) that are
 *                         custom design tokens from source style blocks.
 *                         These bypass property checks and always go to GS
 *                         if they are a single class selector.
 */
export function splitCss(
  compiledCss: string,
  customClassNames?: Set<string>,
): CssSplitResult {
  const globalStyles: GlobalStyleEntry[] = [];
  const uniqueCssParts: string[] = [];
  const customSet = customClassNames ?? new Set<string>();

  if (!compiledCss.trim()) {
    return { globalStyles: [], uniqueCss: "" };
  }

  try {
    const ast = css.parse(compiledCss, { silent: true });
    const rules = ast.stylesheet?.rules || [];

    for (const rule of rules) {
      walkRule(rule as css.Rule | css.Media, globalStyles, uniqueCssParts, customSet);
    }
  } catch {
    return { globalStyles: [], uniqueCss: compiledCss };
  }

  // Deduplicate: merge entries with the same selector
  const merged = new Map<string, GlobalStyleEntry>();
  for (const entry of globalStyles) {
    const existing = merged.get(entry.selector);
    if (existing) {
      existing.css += entry.css;
    } else {
      merged.set(entry.selector, { ...entry });
    }
  }

  return {
    globalStyles: [...merged.values()],
    uniqueCss: uniqueCssParts.join(""),
  };
}
