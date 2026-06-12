import { createHash } from "node:crypto";

export interface CustomizerOutput {
  colors: Record<string, string>;
  bodyFont: string;
  headingFont: string;
  baseFontSize: string;
}

export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}

export interface ClassifiedStyles {
  customizer: CustomizerOutput;
  globalStyles: GlobalStyleEntry[];
  inlineStyles: Record<string, Record<string, string>>;
}

function flattenConfigColors(
  colors: Record<string, unknown> | undefined,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!colors) return result;
  for (const [key, val] of Object.entries(colors)) {
    if (typeof val === "string") {
      const name = prefix ? `${prefix}-${key}` : key;
      result[name] = val;
    } else if (typeof val === "object" && val !== null) {
      const nestedPrefix = prefix ? `${prefix}-${key}` : key;
      Object.assign(result, flattenConfigColors(val as Record<string, unknown>, nestedPrefix));
    }
  }
  return result;
}

/** Convert hex color to rgb(r, g, b) string for matching against computed styles */
function hexToRgb(hex: string): string | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
}

function hashProp(k: string, v: string): string {
  return createHash("sha256").update(`${k}:${v}`).digest("hex").slice(0, 8);
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

export function classifyStyles(
  computedStyles: Record<string, Record<string, string>>,
  tailwindConfig: Record<string, unknown> | null,
  frequencyThreshold = 3,
): ClassifiedStyles {
  // ── Customizer: colors ──
  const configColors = tailwindConfig
    ? flattenConfigColors(
        (tailwindConfig as any)?.theme?.extend?.colors ||
        (tailwindConfig as any)?.theme?.colors,
      )
    : {};

  const usedColors: Record<string, string> = {};
  for (const [tokenName, hex] of Object.entries(configColors)) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    for (const props of Object.values(computedStyles)) {
      const bg = (props.backgroundColor || "").replace(/\s/g, "");
      const fg = (props.color || "").replace(/\s/g, "");
      if (bg.includes(rgb.replace(/\s/g, "")) || fg.includes(rgb.replace(/\s/g, ""))) {
        usedColors[tokenName] = hex;
        break;
      }
    }
  }

  // ── Customizer: fonts ──
  let bodyFont = "";
  let headingFont = "";
  let baseFontSize = "";

  for (const [path, props] of Object.entries(computedStyles)) {
    if (props.fontFamily && !bodyFont) {
      bodyFont = props.fontFamily.split(",")[0].replace(/"/g, "").trim();
    }
    if (props.fontSize && !baseFontSize && (path.includes("p:") || path.includes("body"))) {
      baseFontSize = props.fontSize;
    }
    if (props.fontFamily && (path.includes("h1") || path.includes("h2") || path.includes("h3"))) {
      headingFont = props.fontFamily.split(",")[0].replace(/"/g, "").trim();
    }
  }

  // ── Global Styles vs Inline: per-property frequency-based ──
  // Count occurrences of each property:value pair across all elements
  const propCounts: Record<string, number> = {};
  const propToKv: Record<string, { k: string; v: string }> = {};

  for (const props of Object.values(computedStyles)) {
    for (const [k, v] of Object.entries(props)) {
      if (!v || v === "0px" || v === "normal" || v === "none" || v === "rgba(0, 0, 0, 0)") continue;
      const hash = hashProp(k, v);
      propCounts[hash] = (propCounts[hash] || 0) + 1;
      propToKv[hash] = { k, v };
    }
  }

  // Global Styles: property:value pairs appearing >= threshold times
  const sharedHashes = new Set<string>();
  const globalStyles: GlobalStyleEntry[] = [];
  let gsIdx = 0;

  for (const [hash, count] of Object.entries(propCounts)) {
    if (count >= frequencyThreshold) {
      sharedHashes.add(hash);
      const { k, v } = propToKv[hash];
      globalStyles.push({
        name: `Shared ${camelToKebab(k)}`,
        selector: `.gb-s-${gsIdx.toString(36)}`,
        css: `${camelToKebab(k)}:${v}`,
      });
      gsIdx++;
    }
  }

  // Inline styles: properties NOT in shared set
  const inlineStyles: Record<string, Record<string, string>> = {};
  for (const [path, props] of Object.entries(computedStyles)) {
    const uniqueProps: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      if (!v || v === "0px" || v === "normal" || v === "none" || v === "rgba(0, 0, 0, 0)") continue;
      const hash = hashProp(k, v);
      if (!sharedHashes.has(hash)) {
        uniqueProps[k] = v;
      }
    }
    if (Object.keys(uniqueProps).length > 0) {
      inlineStyles[path] = uniqueProps;
    }
  }

  return {
    customizer: {
      colors: usedColors,
      bodyFont,
      headingFont,
      baseFontSize,
    },
    globalStyles,
    inlineStyles,
  };
}
