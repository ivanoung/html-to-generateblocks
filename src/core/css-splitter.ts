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
  data?: Record<string, unknown>;
}

export interface CssSplitResult {
  globalStyles: GlobalStyleEntry[];
  uniqueCss: string;
}

// ── GB Editor Panel Property Allowlist ──────────────────────
//
// These are the camelCase property keys that GenerateBlocks'
// editor panels read from gb_style_data. Only properties in
// this set can survive editor round-trips. Any CSS declaration
// that maps to a key outside this set causes the entire rule
// to be demoted to styles-unique.css.

const GB_DATA_PROPERTIES: ReadonlySet<string> = new Set([
  // Layout & sizing
  "display", "position", "zIndex", "overflow", "overflowX", "overflowY",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "aspectRatio",
  // Flex
  "flexDirection", "flexWrap", "flexGrow", "flexShrink", "flexBasis",
  "alignItems", "alignSelf", "alignContent",
  "justifyContent", "justifyItems", "justifySelf", "order",
  // Grid
  "gridTemplateColumns", "gridTemplateRows", "gridAutoColumns", "gridAutoRows", "gridAutoFlow",
  // Spacing
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "gap", "columnGap", "rowGap",
  // Borders
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
  // Typography
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "textTransform",
  "textDecoration", "lineHeight", "letterSpacing", "textAlign", "color",
  // Backgrounds
  "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat",
  // Effects
  "boxShadow", "textShadow", "opacity", "transform",
  // Positioning
  "top", "right", "bottom", "left",
  // Object
  "objectFit", "objectPosition",
]);

// ── CSS property helpers ────────────────────────────────────

/** Convert kebab-case CSS property to camelCase. */
function toCamelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Split a CSS value on top-level whitespace only, keeping
 * parentheses-enclosed expressions (calc, rgb, var, etc.) intact.
 */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") { depth++; current += ch; }
    else if (ch === ")") { depth--; current += ch; }
    else if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Expand CSS shorthand property:value pairs into individual
 * longhand entries. Returns an array of [camelCaseKey, value] tuples.
 * Unrecognized shorthands are returned as-is (single entry).
 */
function expandShorthand(prop: string, value: string): Array<[string, string]> {
  const parts = splitTopLevel(value);
  const sides = ["Top", "Right", "Bottom", "Left"] as const;

  switch (prop) {
    case "padding":
    case "margin": {
      const prefix = prop; // "padding" or "margin"
      if (parts.length === 1) {
        return sides.map((s) => [`${prefix}${s}`, parts[0]] as [string, string]);
      }
      if (parts.length === 2) {
        return [
          [`${prefix}Top`, parts[0]],
          [`${prefix}Bottom`, parts[0]],
          [`${prefix}Right`, parts[1]],
          [`${prefix}Left`, parts[1]],
        ];
      }
      if (parts.length === 4) {
        return sides.map((s, i) => [`${prefix}${s}`, parts[i]] as [string, string]);
      }
      // 3-value: top, right/left, bottom
      return [
        [`${prefix}Top`, parts[0]],
        [`${prefix}Right`, parts[1]],
        [`${prefix}Bottom`, parts[2]],
        [`${prefix}Left`, parts[1]],
      ];
    }

    case "border": {
      // border: [width] [style] [color]
      const widthParts = parts.filter((p) =>
        /^\d/.test(p) || ["thin", "medium", "thick"].includes(p.toLowerCase())
      );
      const styleParts = parts.filter((p) =>
        ["none", "hidden", "dotted", "dashed", "solid", "double",
         "groove", "ridge", "inset", "outset"].includes(p.toLowerCase())
      );
      const colorParts = parts.filter((p) =>
        !widthParts.includes(p) && !styleParts.includes(p)
      );

      const result: Array<[string, string]> = [];
      if (widthParts.length > 0) {
        for (const s of sides) result.push([`border${s}Width`, widthParts[0]]);
      }
      if (styleParts.length > 0) {
        for (const s of sides) result.push([`border${s}Style`, styleParts[0]]);
      }
      for (const c of colorParts) {
        for (const s of sides) result.push([`border${s}Color`, c]);
      }
      return result;
    }

    case "border-width": {
      if (parts.length === 1)
        return sides.map((s) => [`border${s}Width`, parts[0]] as [string, string]);
      if (parts.length === 2) return [
        ["borderTopWidth", parts[0]], ["borderBottomWidth", parts[0]],
        ["borderRightWidth", parts[1]], ["borderLeftWidth", parts[1]],
      ];
      if (parts.length === 3) return [
        ["borderTopWidth", parts[0]],
        ["borderRightWidth", parts[1]],
        ["borderBottomWidth", parts[2]],
        ["borderLeftWidth", parts[1]],
      ];
      return sides.map((s, i) =>
        [`border${s}Width`, parts[i] ?? parts[0]] as [string, string]
      );
    }

    case "border-style": {
      return sides.map((s) => [`border${s}Style`, value] as [string, string]);
    }

    case "border-color": {
      return sides.map((s) => [`border${s}Color`, value] as [string, string]);
    }

    case "border-radius": {
      if (parts.length === 1) return [
        ["borderTopLeftRadius", parts[0]], ["borderTopRightRadius", parts[0]],
        ["borderBottomRightRadius", parts[0]], ["borderBottomLeftRadius", parts[0]],
      ];
      if (parts.length === 2) return [
        ["borderTopLeftRadius", parts[0]], ["borderTopRightRadius", parts[1]],
        ["borderBottomRightRadius", parts[0]], ["borderBottomLeftRadius", parts[1]],
      ];
      if (parts.length === 3) return [
        ["borderTopLeftRadius", parts[0]], ["borderTopRightRadius", parts[1]],
        ["borderBottomRightRadius", parts[2]], ["borderBottomLeftRadius", parts[1]],
      ];
      return [
        ["borderTopLeftRadius", parts[0] ?? "0"],
        ["borderTopRightRadius", parts[1] ?? "0"],
        ["borderBottomRightRadius", parts[2] ?? "0"],
        ["borderBottomLeftRadius", parts[3] ?? "0"],
      ];
    }

    case "flex": {
      const result: Array<[string, string]> = [];
      if (parts.length >= 1) result.push(["flexGrow", parts[0]]);
      if (parts.length >= 2) result.push(["flexShrink", parts[1]]);
      if (parts.length >= 3) result.push(["flexBasis", parts[2]]);
      return result;
    }

    case "gap": {
      if (parts.length >= 2) return [["rowGap", parts[0]], ["columnGap", parts[1]]];
      return [["rowGap", parts[0]], ["columnGap", parts[0]]];
    }

    case "inset": {
      if (parts.length === 1)
        return sides.map((s) => [s.toLowerCase(), parts[0]] as [string, string]);
      if (parts.length === 2) return [
        ["top", parts[0]], ["bottom", parts[0]],
        ["right", parts[1]], ["left", parts[1]],
      ];
      if (parts.length === 3) return [
        ["top", parts[0]], ["right", parts[1]],
        ["bottom", parts[2]], ["left", parts[1]],
      ];
      return sides.map((s, i) =>
        [s.toLowerCase(), parts[i] ?? parts[0]] as [string, string]
      );
    }

    case "overflow": {
      if (parts.length >= 2) return [["overflowX", parts[0]], ["overflowY", parts[1]]];
      return [["overflowX", parts[0]], ["overflowY", parts[0]]];
    }

    default:
      return [[toCamelCase(prop), value]];
  }
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

// ── Style Data Generation (Gate Check) ──────────────────────

/**
 * Generate the `data` field for a GB Global Style entry from CSS
 * declarations. Expands shorthands, converts to camelCase, and
 * checks every property against GB_DATA_PROPERTIES.
 *
 * Returns the data object if ALL properties pass the gate.
 * Returns null if ANY property fails (rule should be demoted
 * to styles-unique.css).
 */
function generateStyleData(declarations: css.Declaration[]): Record<string, string> | null {
  if (!declarations || declarations.length === 0) return null;

  const data: Record<string, string> = {};

  for (const decl of declarations) {
    if (!decl.property || decl.value === undefined) continue;
    const prop = decl.property.toLowerCase().trim();
    const value = (decl.value || "").trim();
    if (!prop || !value) continue;

    // Expand shorthand → array of [camelCaseKey, value]
    const expanded = expandShorthand(prop, value);

    for (const [camelKey, val] of expanded) {
      // Gate check: must be in GB's recognized property set
      if (!GB_DATA_PROPERTIES.has(camelKey)) {
        return null; // gate failed — demote entire rule
      }
      data[camelKey] = val;
    }
  }

  return Object.keys(data).length > 0 ? data : null;
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
          // Custom class name — still gate-check before promoting
          const data = generateStyleData((r.declarations || []) as css.Declaration[]);
          if (data !== null) {
            gsChildren.push(r);
          } else {
            ucChildren.push(r);
          }
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
        const data = generateStyleData((child.declarations || []) as css.Declaration[]);
        if (data !== null) {
          const wrappedMedia: css.Media = { ...media, rules: [child] };
          const selector = selectors[0];
          const baseSelector = extractBaseSelector(selector);
          globalStyles.push({
            name: classNameToName(baseSelector),
            selector: sanitizeSelector(baseSelector),
            css: serializeRule(wrappedMedia, true),
            data,
          });
        } else {
          // Gate failed → demote to UC
          const wrappedMedia: css.Media = { ...media, rules: [child] };
          uniqueCssParts.push(serializeRule(wrappedMedia));
        }
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
      const data = generateStyleData((r.declarations || []) as css.Declaration[]);
      if (data !== null) {
        const selector = selectors[0];
        const baseSelector = extractBaseSelector(selector);
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: sanitizeSelector(baseSelector),
          css: serializeRule(r, true),
          data,
        });
      } else {
        uniqueCssParts.push(serializeRule(r));
      }
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
      const data = generateStyleData((r.declarations || []) as css.Declaration[]);
      if (data !== null) {
        const selector = selectors[0];
        const baseSelector = extractBaseSelector(selector);
        globalStyles.push({
          name: classNameToName(baseSelector),
          selector: sanitizeSelector(baseSelector),
          css: serializeRule(r, true),
          data,
        });
      } else {
        // Gate failed → demote to UC
        uniqueCssParts.push(serializeRule(r));
      }
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

  // Strip @import rules before parsing — the css npm package cannot handle
  // url() values containing semicolons or ampersands (common in Google Fonts
  // URLs). The parser splits them into malformed rules that leak garbage text.
  // Matches: @import url(...); @import url('...'); @import url("..."); @import "...";
  const sanitized = compiledCss.replace(/@import\s+(?:url\(["']?[^"')]+["']?\)|["'][^"']+["'])\s*;?/gi, "");

  try {
    const ast = css.parse(sanitized, { silent: true });
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
      // Merge data: later entry wins on key conflicts
      if (entry.data) {
        existing.data = { ...existing.data, ...entry.data };
      }
    } else {
      merged.set(entry.selector, { ...entry });
    }
  }

  return {
    globalStyles: [...merged.values()],
    uniqueCss: uniqueCssParts.join(""),
  };
}
