// ── Global Styles Data Generator ────────────────────────────
//
// Parses compiled CSS and generates structured gb_style_data objects
// matching the gblocks_styles post type format (GB Pro 1.9+).
//
// Structure: { [property]: "value", "@media(...)": { ... }, ":hover": { ... } }
// - properties are camelCase CSS
// - @media atRules use named breakpoints or custom queries
// - :hover, :focus, :active, ::before, ::after → nestedRule keys
//
// Only classes using exclusively GB-supported properties become structured.
// Classes with ANY unsupported property stay raw CSS.

import css from "css";

// ── GB-Supported Properties ──────────────────────────────

// These are the CSS properties that map to GB editor UI controls.
// Property names are in camelCase (matching gb_style_data format).
const GB_SUPPORTED: Set<string> = new Set([
  // Typography
  "fontSize", "fontWeight", "fontFamily", "fontStyle",
  "textTransform", "textDecoration", "textAlign",
  "lineHeight", "letterSpacing", "wordSpacing",
  "color",

  // Spacing
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "margin", "padding",

  // Borders
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomLeftRadius", "borderBottomRightRadius",
  "borderRadius", "borderWidth", "borderStyle", "borderColor",

  // Colors
  "backgroundColor", "color", "borderColor",
  "backgroundImage", "backgroundSize", "backgroundPosition",
  "backgroundRepeat", "backgroundAttachment",

  // Layout
  "display", "position", "zIndex",
  "flexDirection", "flexWrap",
  "alignItems", "alignContent", "alignSelf",
  "justifyContent", "justifyItems",
  "gap", "columnGap", "rowGap",
  "flexGrow", "flexShrink", "flexBasis", "order",
  "overflowX", "overflowY", "overflow",

  // Sizing
  "width", "minWidth", "maxWidth",
  "height", "minHeight", "maxHeight",

  // Additional
  "opacity", "cursor", "boxShadow",
]);

// Properties that are explicitly NOT GB-supported
const UNSUPPORTED_PROPERTIES = new Set([
  "transform", "filter", "backdropFilter", "transition",
  "animation", "clipPath", "objectFit", "objectPosition",
  "pointerEvents", "visibility", "whiteSpace", "textOverflow",
  "userSelect", "scrollBehavior", "inset", "top", "right",
  "bottom", "left", "content", "fill", "stroke",
]);

// ── Helpers ──────────────────────────────────────────────

/** Convert kebab-case CSS property to camelCase */
function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Determine if a CSS property is GB-supported (maps to an editor control) */
function isGbSupported(prop: string): boolean {
  const camel = kebabToCamel(prop);
  if (GB_SUPPORTED.has(camel)) return true;
  return false;
}

/** Determine if a CSS property is explicitly unsupported */
function isUnsupported(prop: string): boolean {
  const camel = kebabToCamel(prop);
  if (UNSUPPORTED_PROPERTIES.has(camel)) return true;
  return false;
}

// ── Breakpoint Mapping ───────────────────────────────────

interface Breakpoint {
  name: string;       // "Desktop", "Tablet", "Mobile"
  atRule: string;     // "" (base), "@media (max-width: 768px)"
  maxWidth: number;
}

const BREAKPOINTS: Breakpoint[] = [
  { name: "Desktop", atRule: "", maxWidth: Infinity },
  { name: "Tablet", atRule: "@media (max-width: 1024px)", maxWidth: 1024 },
  { name: "Mobile", atRule: "@media (max-width: 768px)", maxWidth: 768 },
];

/** Try to match a CSS @media rule to a named GB breakpoint */
function matchBreakpoint(mediaRule: string): Breakpoint | null {
  const maxMatch = mediaRule.match(/max-width:\s*(\d+)px/);
  if (maxMatch) {
    const width = parseInt(maxMatch[1]);
    // Find the breakpoint whose maxWidth is closest
    return BREAKPOINTS.find(b => b.maxWidth === width) || null;
  }
  return null;
}

// ── Types ────────────────────────────────────────────────

export interface GbStyleDataEntry {
  selector: string;         // CSS selector for this style, e.g. ".pt-32"
  name: string;             // Human-readable name, e.g. "Pt 32"
  styles: Record<string, unknown>;  // gb_style_data structured object
  raw?: boolean;            // true if this class uses unsupported properties
}

export interface GlobalStylesManifest {
  version: string;
  styles: GbStyleDataEntry[];
}

// ── CSS Class Extraction ─────────────────────────────────

interface ClassRule {
  className: string;        // e.g. "pt-32" (without dot)
  selector: string;         // e.g. ".pt-32"
  declarations: Record<string, string>;  // kebab-case → value
  atRule: string;           // "" or "@media (...)"
  pseudoClass: string;      // "" or ":hover", ":focus", etc.
  hasVendorPrefix: boolean; // true if selector contains ::-webkit-* pseudo-element
}

/**
 * Extract all single-class CSS rules from compiled CSS and group by class name.
 */
function extractClassRules(compiledCss: string): Map<string, ClassRule[]> {
  const grouped = new Map<string, ClassRule[]>();

  try {
    const ast = css.parse(compiledCss, { silent: true });
    const rules = ast.stylesheet?.rules || [];

    function walk(node: css.Rule | css.Media, parentAtRule: string) {
      if (node.type === "media") {
        const media = node as css.Media;
        const atRule = `@media ${media.media}`;
        for (const r of (media.rules || [])) {
          walk(r as css.Rule, atRule);
        }
      } else if (node.type === "rule") {
        const r = node as css.Rule;
        const selectors = r.selectors || [];

        for (const sel of selectors) {
          // Match single class selectors: .class-name or .class-name:pseudo
          // Detect pseudo-ELEMENTS (::before, ::after, ::-webkit-*) — these must be raw
          const isPseudoElement = /::/.test(sel);
          
          // Match pseudo-classes: :hover, :focus, :active, :first-child, etc.
          const pseudoMatch = sel.trim().match(
            /^\.([a-zA-Z_-][\w\\:-]*?)(?:::(?:-webkit-|-moz-|-ms-)?[a-zA-Z-]+)?(?::(hover|focus|active|first-child|last-child|nth-child\(\d+\)))?$/
          );
          if (!pseudoMatch) continue;

          const className = pseudoMatch[1].replace(/\\/g, "");
          const pseudoClass = pseudoMatch[2] ? `:${pseudoMatch[2]}` : "";

          const declarations: Record<string, string> = {};
          for (const d of (r.declarations || [])) {
            if (d.type === "declaration" && d.property && d.value) {
              declarations[d.property] = d.value;
            }
          }

          if (!grouped.has(className)) {
            grouped.set(className, []);
          }
          // Vendor-prefixed pseudo-elements always mark as unsupported
          const hasVendorPrefix = isPseudoElement;
          
          grouped.get(className)!.push({
            className,
            selector: `.${className}`,
            declarations,
            atRule: parentAtRule,
            pseudoClass,
            hasVendorPrefix,
          } as ClassRule & { hasVendorPrefix?: boolean });
        }
      }
    }

    for (const rule of rules) {
      walk(rule as css.Rule | css.Media, "");
    }
  } catch {
    // CSS parse error — return empty
  }

  return grouped;
}

// ── Main Generator ──────────────────────────────────────

/**
 * Generate structured gb_style_data objects from compiled CSS.
 *
 * Returns two categories:
 * - editable: classes with only GB-supported properties (structured data)
 * - raw: classes with unsupported properties (raw CSS fallback)
 */
export function generateGlobalStylesData(compiledCss: string): {
  editable: GbStyleDataEntry[];
  raw: GbStyleDataEntry[];
} {
  const grouped = extractClassRules(compiledCss);
  const editable: GbStyleDataEntry[] = [];
  const raw: GbStyleDataEntry[] = [];

  for (const [className, rules] of grouped) {
    // Check if any rule has unsupported properties or vendor-prefixed selector
    let hasUnsupported = false;
    for (const rule of rules) {
      if (rule.hasVendorPrefix) {
        hasUnsupported = true;
        break;
      }
      for (const prop of Object.keys(rule.declarations)) {
        if (isUnsupported(prop)) {
          hasUnsupported = true;
          break;
        }
      }
      if (hasUnsupported) break;
    }

    if (hasUnsupported) {
      raw.push({
        selector: `.${className}`,
        name: classNameToName(className),
        styles: {},
        raw: true,
      });
      continue;
    }

    // Build structured gb_style_data
    const styles: Record<string, unknown> = {};

    for (const rule of rules) {
      // Convert declarations to camelCase
      const camelDecls: Record<string, string> = {};
      let allGbSupported = true;

      for (const [prop, value] of Object.entries(rule.declarations)) {
        const camel = kebabToCamel(prop);
        camelDecls[camel] = value;
        if (!isGbSupported(prop)) {
          allGbSupported = false;
        }
      }

      if (!allGbSupported) {
        // Has unsupported property — reclassify as raw
        raw.push({
          selector: `.${className}`,
          name: classNameToName(className),
          styles: {},
          raw: true,
        });
        // Remove from editable if already added
        const idx = editable.findIndex(e => e.selector === `.${className}`);
        if (idx >= 0) editable.splice(idx, 1);
        break;
      }

      // Determine the target path in the styles object
      let target: Record<string, unknown> = styles;

      // Apply atRule (breakpoint)
      if (rule.atRule) {
        const bp = matchBreakpoint(rule.atRule);
        const key = bp ? bp.atRule : rule.atRule;
        if (key) {
          if (!target[key]) target[key] = {};
          target = target[key] as Record<string, unknown>;
        }
      }

      // Apply pseudoClass (state)
      if (rule.pseudoClass) {
        if (!target[rule.pseudoClass]) target[rule.pseudoClass] = {};
        target = target[rule.pseudoClass] as Record<string, unknown>;
      }

      // Set property values
      for (const [camel, value] of Object.entries(camelDecls)) {
        target[camel] = value;
      }
    }

    // Only add if it stayed editable (not reclassified mid-loop)
    if (!raw.some(r => r.selector === `.${className}`)) {
      const idx = editable.findIndex(e => e.selector === `.${className}`);
      if (idx >= 0) {
        // Merge with existing (multiple CSS rules for same class)
        editable[idx].styles = deepMerge(
          editable[idx].styles as Record<string, unknown>,
          styles,
        );
      } else {
        editable.push({
          selector: `.${className}`,
          name: classNameToName(className),
          styles,
        });
      }
    }
  }

  return { editable, raw };
}

/** Simple deep merge for gb_style_data objects */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (
      typeof val === "object" && val !== null && !Array.isArray(val) &&
      typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}

/** Convert kebab-case class name to Title Case name */
function classNameToName(className: string): string {
  return className
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Manifest Builder ────────────────────────────────────

/**
 * Serialize the full global-styles.json manifest including
 * structured gb_style_data entries and raw CSS class entries.
 */
// ── Canonicalized Path (PostCSS AST) ──────────────────

import { CssClassifier, type StructuredStyle } from "./css-classifier.js";

/**
 * Generate structured gb_style_data using the canonicalized PostCSS pipeline.
 * Replaces regex-based extractClassRules with AST-driven classification.
 */
export function generateGlobalStylesDataCanonicalized(compiledCss: string): {
  editable: GbStyleDataEntry[];
  raw: GbStyleDataEntry[];
  rejectionJson: string;
} {
  const result = CssClassifier.classify(compiledCss);

  const editable: GbStyleDataEntry[] = result.structuredStyles.map((s: StructuredStyle) => ({
    selector: s.selector,
    name: s.name,
    styles: s.styles,
  }));

  const raw: GbStyleDataEntry[] = [];
  const rawSelectors = new Set<string>();
  const selectorMatches = result.rawCss.matchAll(/^([.#][^\s{]+)\s*\{/gm);
  for (const m of selectorMatches) {
    rawSelectors.add(m[1]);
  }
  for (const sel of rawSelectors) {
    raw.push({ selector: sel, name: sel.replace(/^\./, ""), styles: {}, raw: true });
  }

  const totalRules = result.structuredStyles.length + raw.length;
  return {
    editable,
    raw,
    rejectionJson: result.rejectionLog.toJSON(totalRules),
  };
}

export function buildGlobalStylesManifest(
  editable: GbStyleDataEntry[],
  raw: GbStyleDataEntry[],
  rawCssEntries: Array<{ selector: string; css: string }>,
): GlobalStylesManifest {
  return {
    version: "1.0",
    styles: [
      ...editable.map(e => ({
        selector: e.selector,
        name: e.name,
        styles: e.styles,
        raw: false,
      })),
      ...raw.map(e => ({
        selector: e.selector,
        name: e.name,
        styles: e.styles,
        raw: true,
      })),
    ],
  };
}
