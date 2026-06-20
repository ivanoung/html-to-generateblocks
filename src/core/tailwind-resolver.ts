// ── Tailwind Resolver ──────────────────────────────────────
//
// Extracts tailwind.config from HTML <script> blocks and compiles
// Tailwind CSS offline via the Tailwind v3 CLI (no headless browser).

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TailwindCompileResult {
  css: string;
  error?: string;
}

export interface ConfigWarning {
  type: "single_value_color";
  color: string;
  missingClasses: string[];
}

/**
 * Compile Tailwind CSS offline using the Tailwind v3 CLI.
 * No headless browser — fast, scalable to any page count.
 */
export function compileTailwindOffline(
  configJson: string,
  contentFiles: string[],
  workDir: string,
): TailwindCompileResult {
  const tmpDir = resolve(workDir, "output", ".tw-cache");
  mkdirSync(tmpDir, { recursive: true });

  // Write tailwind config
  const configPath = resolve(tmpDir, "tailwind.config.cjs");
  writeFileSync(configPath, `module.exports = ${configJson};\n`, "utf-8");

  // Write input CSS
  const inputCssPath = resolve(tmpDir, "input.css");
  writeFileSync(
    inputCssPath,
    "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
    "utf-8",
  );

  // Output CSS path
  const outputCssPath = resolve(tmpDir, "output.css");

  // Build --content argument: space-separated quoted file paths
  const contentArg = contentFiles.map((f) => `"${f}"`).join(" ");

  try {
    execSync(
      `npx tailwindcss@3 -i "${inputCssPath}" -o "${outputCssPath}" --config "${configPath}" --content ${contentArg} --minify`,
      { cwd: workDir, timeout: 60000, stdio: "pipe" },
    );
    const css = readFileSync(outputCssPath, "utf-8");
    return { css };
  } catch (e: any) {
    return {
      css: "",
      error: e.stderr?.toString() || e.message || "Tailwind compilation failed",
    };
  }
}

/**
 * Extract tailwind.config = {...} from raw HTML.
 * Returns the config object string, or null if not found.
 */
export function extractTailwindConfig(rawHtml: string): string | null {
  const startMatch = rawHtml.match(/tailwind\.config\s*=\s*/);
  if (!startMatch) return null;

  // Parse balanced braces starting from the opening {
  let startIdx = (startMatch.index || 0) + startMatch[0].length;
  if (rawHtml[startIdx] !== "{") return null;

  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < rawHtml.length; i++) {
    if (rawHtml[i] === "{") depth++;
    else if (rawHtml[i] === "}") {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

  let config = rawHtml.substring(startIdx, endIdx);
  // Remove trailing commas (invalid in CJS module.exports)
  config = config.replace(/,(\s*[}\]])/g, "$1");
  return config;
}

/**
 * Convert a hex color to HSL components.
 * Returns { h, s, l } where h is 0-360, s/l are 0-100.
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  // Remove hash
  let h = hex.replace(/^#/, "");
  // Expand shorthand: #abc → #aabbcc
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  
  let hue = 0;
  let s = 0;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: hue = ((b - r) / d + 2) / 6; break;
      case b: hue = ((r - g) / d + 4) / 6; break;
    }
  }
  
  return {
    h: Math.round(hue * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL back to hex.
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Tailwind shade lightness values (approximate, matches Tailwind v3 defaults).
 * Shade 50 is lightest, 950 is darkest.
 */
const SHADE_LIGHTNESS: Record<number, number> = {
  50: 97, 100: 94, 200: 86, 300: 76, 400: 62,
  500: 50, 600: 40, 700: 30, 800: 22, 900: 14, 950: 8,
};

/**
 * Auto-expand single-value Tailwind colors into full shade palettes (50-950).
 * Uses the original value as shade 500 and generates lighter/darker variants
 * using HSL lightness steps while preserving the hue and saturation.
 *
 * Only expands user-defined colors that appear as single hex values in the
 * theme.extend.colors block. Built-in Tailwind colors are left untouched.
 */
/** Tailwind v3 default color palette names — skip shade expansion for these. */
const TW_DEFAULT_COLORS = new Set([
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime",
  "green", "emerald", "teal", "cyan", "sky",
  "blue", "indigo", "violet", "purple", "fuchsia",
  "pink", "rose",
  "white", "black",
  "transparent", "current", "inherit",
]);

export function expandColorPalettes(configJson: string): string {
  // Find all single-value hex colors anywhere in the config.
  // Pattern: colorName: "#hex" or colorName: '#hex' 
  // But NOT: colorName: { ... } (already an object with shades)
  // We detect single values by checking that the value is a quoted hex
  // NOT followed by an opening brace (which means it's already expanded).
  
  // Match: word: "#hex" or word: '#hex' — not followed by { or another word:
  const singleHexRegex = /(\w+)\s*:\s*["'](#[a-fA-F0-9]{3,8})["']\s*(?=[,}\n])/g;
  
  let result = configJson;
  let match;
  const expanded = new Set<string>();
  
  while ((match = singleHexRegex.exec(configJson)) !== null) {
    const colorName = match[1];
    const hexColor = match[2];
    
    // Skip Tailwind default colors — don't generate shades for them.
    // If the original config set slate as a single value, respect that —
    // the CDN will compile without shade classes. This matches the
    // original page's behavior exactly.
    if (TW_DEFAULT_COLORS.has(colorName)) continue;
    
    // Skip if already processed (regex can match overlapping entries)
    if (expanded.has(colorName)) continue;
    expanded.add(colorName);
    
    const hsl = hexToHsl(hexColor);
    const shades: string[] = [];
    
    for (const [shade, targetL] of Object.entries(SHADE_LIGHTNESS)) {
      const adjustedL = Math.max(0, Math.min(100, Math.round(targetL)));
      const shadeHex = hslToHex(hsl.h, hsl.s, adjustedL);
      shades.push(`${shade}: "${shadeHex}"`);
    }
    // Add DEFAULT key so bare class names (e.g. text-orange) still resolve
    // after single-hex expansion to a shade palette
    shades.push(`DEFAULT: "${hexColor}"`);
    
    const expandedColor = `${colorName}: { ${shades.join(", ")} }`;
    
    // Replace ONLY the single hex value for this color (not entries inside objects)
    // Match: colorName: "#hex" or colorName: '#hex' followed by comma, }, or newline
    const singlePattern = new RegExp(
      colorName + "\\s*:\\s*[\"']" + hexColor + "[\"']\\s*(?=[,}\\n])",
      "g",
    );
    result = result.replace(singlePattern, expandedColor);
  }
  
  return result;
}

/**
 * Validate a tailwind config for patterns known to cause missing CSS.
 * Returns warnings for colors defined as single values where the HTML
 * uses shade variants (e.g., slate: "#334155" but HTML has bg-slate-100).
 */
export function validateTailwindConfig(
  configJson: string,
  allClassNames: string[],
): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  // Extract colors from config using regex (config is JS, not strict JSON)
  // Match patterns like: colorName: "#hex" or colorName: '#hex'
  const colorMatches = configJson.matchAll(
    /(\w+)\s*:\s*["'](#[a-fA-F0-9]{3,8})["']\s*[,}]/g,
  );

  for (const m of colorMatches) {
    const colorName = m[1];

    // Skip Tailwind default colors — they have full palettes from the CDN
    if (TW_DEFAULT_COLORS.has(colorName)) continue;

    // Check if any HTML class references a shade variant of this color
    const shadePattern = new RegExp(
      `(?:bg|text|border|ring|outline|placeholder|caret|accent|fill|stroke|shadow|decoration|divide|from|via|to)-${colorName}-\\d+`,
    );
    const missing = allClassNames.filter((c) => shadePattern.test(c));

    if (missing.length > 0) {
      warnings.push({
        type: "single_value_color",
        color: colorName,
        missingClasses: [...new Set(missing)].slice(0, 20),
      });
    }
  }

  return warnings;
}

/**
 * Inject corePlugins: { preflight: false } into a tailwind config JSON string.
 * Handles existing corePlugins objects by merging. Suppresses Tailwind's
 * massive normalize/reset block (*, ::before, ::after { --tw-*:... }) at the
 * CDN source so it never enters styles.css downstream.
 */
export function disablePreflight(configJson: string): string {
  // If config already has corePlugins, merge preflight:false into it
  if (/corePlugins\s*:/.test(configJson)) {
    return configJson.replace(
      /(corePlugins\s*:\s*\{)/,
      '$1"preflight":false,',
    );
  }

  // Inject corePlugins right after the opening brace
  return configJson.replace(
    /^(\s*\{)/,
    '$1"corePlugins":{"preflight":false},',
  );
}
