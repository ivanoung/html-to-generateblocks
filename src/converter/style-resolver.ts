// ── Style Resolver (Phase 1) ───────────────────────────────────
//
// Resolves Tailwind utility classes + custom <style> blocks to
// inline styles. Produces clean HTML with no CSS classes.
// Uses the real Tailwind CLI for utility resolution.

import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import * as cheerio from "cheerio";
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
  // Try script-scoped extraction first (captures full config to </script>)
  let configMatch = fullPageHtml.match(
    /<script[^>]*>\s*tailwind\.config\s*=\s*(\{[^<]+\})/s,
  );
  if (!configMatch) {
    // Fallback: config at page level (no <script> wrapper)
    configMatch = fullPageHtml.match(
      /tailwind\.config\s*=\s*(\{[\s\S]*?\n\s*\})/,
    );
  }
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

    // Step 3: Run Tailwind v3 CLI (pinned via npm alias tailwindcss3)
    const twCli = resolve(process.cwd(), "node_modules/tailwindcss3/lib/cli.js");
    execSync(
      `node "${twCli}" -i "${inputCssPath}" -o "${outputCssPath}" --content "${contentPath}" --minify`,
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
 * Resolve Tailwind CSS variable references in a style value.
 * - "rgb(30 41 59/var(--tw-text-opacity,1))" → "rgb(30 41 59/1)"
 * - "var(--tw-ring-offset-shadow,0 0 #0000)" → "0 0 #0000"
 * - "var(--tw-shadow)" → stripped (no fallback available)
 */
function resolveCssVariables(value: string): string {
  // Pass 1: replace var(--tw-*,<fallback>) with fallback
  let resolved = value.replace(
    /var\(--tw-[a-z-]+,\s*([^)]+)\)/g,
    (_, fallback) => fallback.trim(),
  );
  // Pass 2: strip var(--tw-*) with no fallback
  resolved = resolved.replace(
    /,\s*var\(--tw-[a-z-]+\)/g,
    "",
  ).replace(
    /var\(--tw-[a-z-]+\)/g,
    "",
  );
  return resolved;
}

/**
 * Apply resolved class → declarations map to HTML elements.
 * Adds inline styles alongside existing class attributes (does NOT strip classes).
 * This preserves CSS selectors for manifest-based element lookup in Phase 4.
 */
function applyClassMap(
  html: string,
  classMap: Record<string, Record<string, string>>,
  warnings: string[],
): string {
  const $ = cheerio.load(`<div>${html}</div>`);
  // Breakpoint widths for inversion (Tailwind min-width → GB max-width)
  const BP_ORDER = ["xl", "lg", "md", "sm"]; // largest first
  const BP_MAX: Record<string, number> = { xl: 1279, lg: 1023, md: 767, sm: 639 };

  $("[class]").each((_, el) => {
    const $el = $(el);
    const classStr = $el.attr("class") || "";
    const classes = classStr.split(/\s+/).filter(Boolean);
    const baseStyles: Record<string, string> = {};
    // Per-breakpoint declarations (before inversion)
    const bpStyles: Record<string, Record<string, string>> = {};

    for (const cls of classes) {
      const respMatch = cls.match(/^(sm|md|lg|xl):(.+)$/);
      if (respMatch) {
        const bp = respMatch[1];
        const coreClass = respMatch[2];
        // Try core class first, then escaped full class (Tailwind may purge standalone)
        const decls = classMap[coreClass] || classMap[cls.replace(/:/g, "\\:")];
        if (decls) {
          if (!bpStyles[bp]) bpStyles[bp] = {};
          Object.assign(bpStyles[bp], decls);
        } else if (cls.includes("hover:")) {
          warnings.push(`Unsupported pseudo-class: "${cls}"`);
        }
        continue;
      }
      if (cls.startsWith("hover:")) {
        const coreClass = cls.slice(6);
        if (classMap[coreClass]) Object.assign(baseStyles, classMap[coreClass]);
        continue;
      }
      if (classMap[cls]) {
        Object.assign(baseStyles, classMap[cls]);
      }
    }

    // Invert responsive declarations: desktop-first
    // The largest breakpoint's value becomes base; smaller ones cascade as overrides
    const invertedBase: Record<string, string> = { ...baseStyles };
    const invertedResp: Record<string, Record<string, string>> = {};

    // Collect all responsive values per property, ordered largest→smallest
    const propOverrides: Record<string, { bp: string; val: string }[]> = {};
    for (const bp of BP_ORDER) {
      const decls = bpStyles[bp];
      if (!decls) continue;
      for (const [prop, val] of Object.entries(decls)) {
        if (!propOverrides[prop]) propOverrides[prop] = [];
        propOverrides[prop].push({ bp, val });
      }
    }

    // For each property: largest bp → base, smaller bps → cascading overrides
    for (const [prop, overrides] of Object.entries(propOverrides)) {
      // Largest bp value becomes final base
      invertedBase[prop] = overrides[0].val;
      // Each smaller bp's value becomes override at the PREVIOUS (larger) bp's max-width
      for (let i = 1; i < overrides.length; i++) {
        const prevBp = overrides[i - 1].bp;
        const maxBp = String(BP_MAX[prevBp]);
        if (!invertedResp[maxBp]) invertedResp[maxBp] = {};
        invertedResp[maxBp][prop] = overrides[i].val;
      }
      // Original base value becomes override at the SMALLEST responsive bp's max-width
      if (baseStyles[prop] !== undefined) {
        const smallest = overrides[overrides.length - 1];
        const maxBp = String(BP_MAX[smallest.bp]);
        if (!invertedResp[maxBp]) invertedResp[maxBp] = {};
        invertedResp[maxBp][prop] = baseStyles[prop];
      }
    }

    if (Object.keys(invertedBase).length === 0) return;

    // Merge with existing style attribute
    const existingStyle = $el.attr("style") || "";
    const newStyles = Object.entries(invertedBase)
      .map(([k, v]) => `${k}:${resolveCssVariables(v)}`)
      .join(";");
    const merged = existingStyle ? `${existingStyle};${newStyles}` : newStyles;
    $el.attr("style", merged);

    // Store responsive overrides as data attribute for Phase 4
    if (Object.keys(invertedResp).length > 0) {
      $el.attr("data-gb-resp", JSON.stringify(invertedResp));
    }
  });

  // Return inner HTML, unwrapping our temporary <div>
  const result = $.html($("body > div").first()) || html;
  return result.replace(/^<div>/, "").replace(/<\/div>$/, "");
}
