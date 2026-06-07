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
