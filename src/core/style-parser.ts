// ── Style Parser ──────────────────────────────────────────────
//
// Pipeline: raw inline style string → normalized entries → split
// into `styles` object (camelCase) and `css` string (kebab-case,
// sorted, minified, no-function-spaces, no-transition, no-hover).

import type { BlockStyles, StyleEntry } from "./types.js";

// ── Property maps ─────────────────────────────────────────────

/** Properties that have a style panel equivalent in GB and should
 *  appear in BOTH `styles` (camelCase) and `css` (kebab-case). */
const STYLES_PROPERTIES = new Set([
  "display",
  "position",
  "z-index",

  // flex/grid
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "gap",
  "column-gap",
  "row-gap",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "grid-area",

  // spacing
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",

  // sizing
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",

  // typography
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "font-style",

  // colors
  "color",
  "background-color",
  "background",

  // borders
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-color",
  "border-style",
  "border-width",

  // overflow
  "overflow",
  "overflow-x",
  "overflow-y",

  // object-fit (for media)
  "object-fit",
  "object-position",
]);

// ── Conversion helpers ────────────────────────────────────────

/** Convert kebab-case CSS prop to camelCase. */
function toCamelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Check if a property is a GB styles-aware property. */
function hasStylesEquivalent(prop: string): boolean {
  return STYLES_PROPERTIES.has(prop);
}

/** Check if property is forbidden in `css` (transition, hover). */
function isCssForbidden(prop: string): boolean {
  const p = prop.toLowerCase();
  return p === "transition" ||
    p.startsWith("transition-") ||
    p === "animation" ||
    p.startsWith("animation-");
}

/** Check if value contains a hover selector (e.g., :hover). */
function isHoverRule(prop: string): boolean {
  return prop.includes(":hover");
}

/** Expand shorthand CSS properties to their granular equivalents for GB styles. */
function expandShorthands(entries: StyleEntry[]): StyleEntry[] {
  const result: StyleEntry[] = [];
  for (const entry of entries) {
    const expanded = expandShorthand(entry);
    result.push(...expanded);
  }
  return result;
}

function expandShorthand(entry: StyleEntry): StyleEntry[] {
  const v = entry.value.trim();
  const parts = v.split(/\s+/);

  switch (entry.property) {
    case "padding":
      return expandBox("padding", parts, entry);
    case "margin":
      return expandBox("margin", parts, entry);
    case "border-radius":
      return expandRadius(parts, entry);
    default:
      return [entry];
  }
}

const BOX_SIDES = ["top", "right", "bottom", "left"];

function expandBox(prop: string, parts: string[], orig: StyleEntry): StyleEntry[] {
  let values: string[];
  if (parts.length === 1) {
    values = [parts[0], parts[0], parts[0], parts[0]];
  } else if (parts.length === 2) {
    values = [parts[0], parts[1], parts[0], parts[1]];
  } else if (parts.length === 3) {
    values = [parts[0], parts[1], parts[2], parts[1]];
  } else if (parts.length === 4) {
    values = parts;
  } else {
    return [orig];
  }

  return BOX_SIDES.map((side, i) => {
    const kebab = `${prop}-${side}`;
    return { property: kebab, value: values[i], camelCase: toCamelCase(kebab) };
  });
}

const RADIUS_CORNERS = [
  ["top-left", "TopLeft"],
  ["top-right", "TopRight"],
  ["bottom-right", "BottomRight"],
  ["bottom-left", "BottomLeft"],
];

function expandRadius(parts: string[], orig: StyleEntry): StyleEntry[] {
  let values: string[];
  if (parts.length === 1) {
    values = [parts[0], parts[0], parts[0], parts[0]];
  } else if (parts.length === 2) {
    values = [parts[0], parts[1], parts[0], parts[1]];
  } else if (parts.length === 3) {
    values = [parts[0], parts[1], parts[2], parts[1]];
  } else if (parts.length === 4) {
    values = parts;
  } else {
    return [orig];
  }

  return RADIUS_CORNERS.map(([kebabSuffix, camelSuffix], i) => ({
    property: `border-${kebabSuffix}-radius`,
    value: values[i],
    camelCase: `border${camelSuffix}Radius`,
  }));
}

/** Check if a CSS background value is a simple color (not a gradient, image, or multi-value). */
function isSimpleColor(value: string): boolean {
  const v = value.trim();
  // Color keywords (including hex, rgb, rgba, hsl, named colors)
  // Not a gradient (no "gradient"), not a URL (no "url("), not multi-value (no commas)
  if (v.includes("url(")) return false;
  if (v.includes("linear-gradient")) return false;
  if (v.includes("radial-gradient")) return false;
  if (v.includes("conic-gradient")) return false;
  if (v.includes("repeating-")) return false;
  if (v.includes(",")) return false;
  // If it's a hex, rgb, hsl, or simple value, treat as color
  if (v.startsWith("#")) return true;
  if (v.startsWith("rgb")) return true;
  if (v.startsWith("hsl")) return true;
  // Otherwise assume it might be a color keyword or simple value
  return true;
}

// ── Main parser ───────────────────────────────────────────────

export interface ParsedStyles {
  styles: BlockStyles;
  css: string;
  warnings: string[];
}

/**
 * Parse a raw inline style string and return:
 * - `styles` — camelCase properties suitable for the block's `styles` JSON object
 * - `css` — single-line, minified, alphabetically-sorted CSS string
 * - `warnings` — any issues found during parsing
 */
export function parseStyleString(raw: string | undefined | null): ParsedStyles {
  const warnings: string[] = [];

  if (!raw || raw.trim() === "") {
    return { styles: {}, css: "", warnings };
  }

  // 1. Split into individual declarations
  const entries: StyleEntry[] = [];
  const declarations = raw.split(";").filter((d) => d.trim().length > 0);

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) {
      warnings.push(`Malformed declaration: "${decl.trim()}"`);
      continue;
    }

    const property = decl.substring(0, colonIdx).trim();
    let value = decl.substring(colonIdx + 1).trim();

    if (!property || !value) {
      warnings.push(`Empty property or value in: "${decl.trim()}"`);
      continue;
    }

    // Normalize function argument spaces: minmax(0, 1fr) → minmax(0,1fr)
    value = value.replace(/,\s+/g, ",");

    // Normalize property name
    const propLower = property.toLowerCase();

    // Skip forbidden CSS properties
    if (isCssForbidden(propLower)) {
      warnings.push(`Forbidden CSS property skipped: "${propLower}"`);
      continue;
    }

    // Skip hover rules
    if (isHoverRule(propLower)) {
      warnings.push(`Hover rule skipped: "${propLower}" — use styles object instead`);
      continue;
    }

    // Normalize `background` → `background-color` when value is a simple color
    // (GB skill examples consistently use backgroundColor/background-color)
    let normalizedProp = propLower;
    let normalizedCamel = toCamelCase(propLower);
    if (propLower === "background" && isSimpleColor(value)) {
      normalizedProp = "background-color";
      normalizedCamel = "backgroundColor";
    }

    entries.push({
      property: normalizedProp,
      value: value,
      camelCase: normalizedCamel,
    });
  }

  // 2. Expand shorthand properties for styles (GB uses granular keys like
  //    paddingTop/paddingBottom). CSS keeps the shorthand form for compactness.
  const expanded = expandShorthands(entries);

  // 3. Build styles object from expanded/granular entries
  const styles: BlockStyles = {};
  let partialMappingWarning = false;

  for (const entry of expanded) {
    if (hasStylesEquivalent(entry.property)) {
      styles[entry.camelCase] = entry.value;
    } else {
      partialMappingWarning = true;
    }
  }

  if (partialMappingWarning) {
    warnings.push("Some inline style properties had no GB styles equivalent; placed in css only");
  }

  // 4. Build CSS string from ORIGINAL entries (shorthand form is canonical in CSS)
  const cssEntries = entries
    .map((e) => `${e.property}:${e.value}`)
    .sort();
  const css = cssEntries.join(";") + (cssEntries.length > 0 ? ";" : "");

  return { styles, css, warnings };
}

/**
 * Property-to-styles key mapping reference.
 * For properties where the camelCase key differs from a naive conversion.
 */
export const CUSTOM_CAMEL_MAP: Record<string, string> = {
  "background-color": "backgroundColor",
  "border-radius": "borderRadius",
  "border-top-left-radius": "borderTopLeftRadius",
  "border-top-right-radius": "borderTopRightRadius",
  "border-bottom-left-radius": "borderBottomLeftRadius",
  "border-bottom-right-radius": "borderBottomRightRadius",
  "object-fit": "objectFit",
  "object-position": "objectPosition",
  "z-index": "zIndex",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "line-height": "lineHeight",
  "letter-spacing": "letterSpacing",
  "text-align": "textAlign",
  "text-transform": "textTransform",
  "text-decoration": "textDecoration",
  "font-style": "fontStyle",
  "min-width": "minWidth",
  "max-width": "maxWidth",
  "min-height": "minHeight",
  "max-height": "maxHeight",
  "margin-top": "marginTop",
  "margin-right": "marginRight",
  "margin-bottom": "marginBottom",
  "margin-left": "marginLeft",
  "padding-top": "paddingTop",
  "padding-right": "paddingRight",
  "padding-bottom": "paddingBottom",
  "padding-left": "paddingLeft",
  "overflow-x": "overflowX",
  "overflow-y": "overflowY",
  "flex-grow": "flexGrow",
  "flex-shrink": "flexShrink",
  "flex-basis": "flexBasis",
  "flex-direction": "flexDirection",
  "flex-wrap": "flexWrap",
  "align-items": "alignItems",
  "align-content": "alignContent",
  "align-self": "alignSelf",
  "justify-content": "justifyContent",
  "justify-items": "justifyItems",
  "justify-self": "justifySelf",
  "column-gap": "columnGap",
  "row-gap": "rowGap",
  "grid-template-columns": "gridTemplateColumns",
  "grid-template-rows": "gridTemplateRows",
  "grid-column": "gridColumn",
  "grid-row": "gridRow",
  "grid-area": "gridArea",
  "border-top": "borderTop",
  "border-right": "borderRight",
  "border-bottom": "borderBottom",
  "border-left": "borderLeft",
  "border-color": "borderColor",
  "border-style": "borderStyle",
  "border-width": "borderWidth",
};
