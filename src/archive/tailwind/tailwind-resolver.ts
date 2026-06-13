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

    // Skip well-known Tailwind colors that likely have full palettes
    // (we're only checking user-defined single-value overrides)

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
