// ── Style Resolver (Phase 1) ───────────────────────────────────
//
// Resolves Tailwind utility classes + custom <style> blocks to
// inline styles. Produces clean HTML with no CSS classes.
// Uses the real Tailwind CLI for utility resolution.

import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

/** Breakpoints used by Tailwind for responsive inversion. */
const BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
};

export interface StyleResolveResult {
  resolvedHtml: string;
  warnings: string[];
}

/**
 * Attempt to resolve Tailwind classes using the Tailwind CLI.
 * Creates temp files, runs `npx tailwindcss`, parses output.
 * Falls back gracefully if CLI is unavailable or config is missing.
 */
export function resolveStyles(sectionHtml: string, fullPageHtml: string): StyleResolveResult {
  const warnings: string[] = [];

  // Step 1: Extract tailwind.config from <script> block
  const configMatch = fullPageHtml.match(
    /tailwind\.config\s*=\s*(\{[\s\S]*?\});/,
  );
  if (!configMatch) {
    warnings.push("No tailwind.config found in page. Skipping Tailwind resolution.");
    return { resolvedHtml: sectionHtml, warnings };
  }

  const configStr = configMatch[1];

  // Step 2: Create temp files
  const hash = createHash("md5").update(sectionHtml).digest("hex").slice(0, 8);
  const tmpDir = join(tmpdir(), `gb-resolve-${hash}`);
  mkdirSync(tmpDir, { recursive: true });

  const configPath = join(tmpDir, "tailwind.config.cjs");
  const inputCssPath = join(tmpDir, "input.css");
  const outputCssPath = join(tmpDir, "output.css");
  const contentPath = join(tmpDir, "content.html");

  try {
    // Write tailwind config as CommonJS
    writeFileSync(configPath, `module.exports = ${configStr};\n`, "utf-8");

    // Write input CSS
    writeFileSync(
      inputCssPath,
      "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
      "utf-8",
    );

    // Write HTML content
    writeFileSync(contentPath, sectionHtml, "utf-8");

    // Step 3: Run Tailwind CLI
    execSync(
      `npx tailwindcss -i "${inputCssPath}" -o "${outputCssPath}" --content "${contentPath}" --minify`,
      { cwd: tmpDir, timeout: 30000, stdio: "pipe" },
    );

    if (!existsSync(outputCssPath)) {
      warnings.push("Tailwind CLI did not produce output CSS.");
      return { resolvedHtml: sectionHtml, warnings };
    }

    const outputCss = readFileSync(outputCssPath, "utf-8");

    // Step 4: Parse <style> blocks from section HTML
    const customCssMap = parseStyleBlocks(sectionHtml);

    // Step 5: Build class → declarations map from both sources
    const classMap = parseTailwindOutput(outputCss);

    // Merge custom styles (they override Tailwind)
    for (const [cls, decls] of Object.entries(customCssMap)) {
      if (classMap[cls]) {
        classMap[cls] = { ...classMap[cls], ...decls };
      } else {
        classMap[cls] = decls;
      }
    }

    // Step 6: Apply resolved styles to each element
    const resolvedHtml = applyClassMap(sectionHtml, classMap, warnings);

    return { resolvedHtml, warnings };
  } catch (e: any) {
    if (e.message?.includes("tailwindcss")) {
      warnings.push(
        "Tailwind CLI not available. Install with: npm install -D tailwindcss @tailwindcss/cli",
      );
    } else {
      warnings.push(`Style resolution failed: ${e.message}`);
    }
    return { resolvedHtml: sectionHtml, warnings };
  } finally {
    // Cleanup temp files
    try {
      if (existsSync(configPath)) unlinkSync(configPath);
      if (existsSync(inputCssPath)) unlinkSync(inputCssPath);
      if (existsSync(outputCssPath)) unlinkSync(outputCssPath);
      if (existsSync(contentPath)) unlinkSync(contentPath);
    } catch { /* cleanup is best-effort */ }
  }
}

/** Parse <style> blocks into class → declarations map. */
function parseStyleBlocks(html: string): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;

  while ((match = styleRegex.exec(html)) !== null) {
    const css = match[1];
    // Parse simple .classname { prop: value; } rules
    const ruleRegex = /\.([a-zA-Z_][\w-]*(?:\\.[\w-]+)*)\s*\{([^}]+)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRegex.exec(css)) !== null) {
      const className = ruleMatch[1];
      const declarations: Record<string, string> = {};
      const body = ruleMatch[2];
      const declRegex = /([a-zA-Z-]+)\s*:\s*([^;]+)/g;
      let declMatch: RegExpExecArray | null;
      while ((declMatch = declRegex.exec(body)) !== null) {
        declarations[declMatch[1].trim()] = declMatch[2].trim();
      }
      if (map[className]) {
        map[className] = { ...map[className], ...declarations };
      } else {
        map[className] = declarations;
      }
    }
  }

  return map;
}

/** Parse Tailwind CLI output into class → declarations map. */
function parseTailwindOutput(css: string): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  const ruleRegex = /\.([a-zA-Z_][\w-]*(?:\\.[\w-]+)*)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(css)) !== null) {
    const className = match[1];
    const declarations: Record<string, string> = {};
    const body = match[2];
    const declRegex = /([a-zA-Z-]+)\s*:\s*([^;]+)/g;
    let declMatch: RegExpExecArray | null;
    while ((declMatch = declRegex.exec(body)) !== null) {
      declarations[declMatch[1].trim()] = declMatch[2].trim();
    }
    map[className] = declarations;
  }

  return map;
}

/**
 * Apply resolved class → declarations map to HTML elements.
 * Replaces class attributes with inline style attributes.
 */
function applyClassMap(
  html: string,
  classMap: Record<string, Record<string, string>>,
  warnings: string[],
): string {
  const classRegex = /class="([^"]*)"/g;

  return html.replace(classRegex, (_full: string, classStr: string) => {
    const classes = classStr.split(/\s+/).filter(Boolean);
    const baseStyles: Record<string, string> = {};

    for (const cls of classes) {
      // Check for responsive prefix
      const respMatch = cls.match(/^(sm|md|lg|xl):(.+)$/);
      if (respMatch) {
        const bp = respMatch[1];
        const coreClass = respMatch[2];
        if (classMap[coreClass]) {
          // Responsive: apply as base style (desktop-first inversion)
          // The base (small-screen) value would be the non-responsive equivalent
          Object.assign(baseStyles, classMap[coreClass]);
        } else {
          if (cls.includes("hover:")) {
            warnings.push(`Unsupported pseudo-class: "${cls}" — hover partially supported`);
          }
        }
        continue;
      }

      // Handle hover prefixes
      if (cls.startsWith("hover:")) {
        const coreClass = cls.slice(6);
        if (classMap[coreClass]) {
          Object.assign(baseStyles, classMap[coreClass]);
        }
        continue;
      }

      // Non-responsive class
      if (classMap[cls]) {
        Object.assign(baseStyles, classMap[cls]);
      }
    }

    // Build inline style string
    const styleParts = Object.entries(baseStyles).map(
      ([k, v]) => `${k}:${v}`,
    );

    if (styleParts.length === 0) {
      return ""; // Remove class attribute entirely
    }

    return `style="${styleParts.join(";")}"`;
  });
}
