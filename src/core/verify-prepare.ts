// src/core/verify-prepare.ts
// ── Verify Prepare ──────────────────────────────────────────
//
// Reads converted project output and builds data payloads
// for the agent to upload via Novamira MCP.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { VerifySession } from "./verify-session.js";

export interface PagePayload {
  slug: string;
  postTitle: string;
  blockMarkup: string;
  report: Record<string, unknown>;
}

export interface VerifyPrepareResult {
  pages: PagePayload[];
  cssPayload: string;
  cssSource: string; // "styles.css" or "split CSS"
  warnings: string[];
}

/**
 * Prepare verification data from a converted project.
 * Reads pages/*.html block markup and styles.css from output/<projectDir>/.
 * For pass 2, also reads setup/global-styles.json and setup/styles-unique.css.
 */
export function prepareVerification(
  session: VerifySession,
): VerifyPrepareResult {
  const outDir = resolve(process.cwd(), "output", session.projectDir);
  const pagesDir = resolve(outDir, "pages");
  const warnings: string[] = [];

  // Collect page markup
  const pages: PagePayload[] = [];
  if (!existsSync(pagesDir)) {
    throw new Error(`Pages directory not found: ${pagesDir}. Run conversion first.`);
  }

  const htmlFiles = readdirSync(pagesDir)
    .filter((f: string) => f.endsWith(".html"))
    .sort();

  for (const file of htmlFiles) {
    const slug = basename(file, ".html");

    // Skip setup pseudo-page if present
    if (slug === "_setup") continue;

    const blockMarkup = readFileSync(resolve(pagesDir, file), "utf-8");
    const reportPath = resolve(pagesDir, `${slug}.report.json`);

    let report: Record<string, unknown> = {};
    if (existsSync(reportPath)) {
      try {
        report = JSON.parse(readFileSync(reportPath, "utf-8"));
      } catch {
        warnings.push(`Could not parse report for ${slug}`);
      }
    }

    // Check for hard fails
    const hardFails = (report.hardFails as unknown[]) || [];
    if (hardFails.length > 0) {
      warnings.push(`${slug}: ${hardFails.length} hard fail(s) — block markup may not render correctly`);
    }

    pages.push({
      slug,
      postTitle: `${session.projectDir} — ${slug} [verify ${session.runId}]`,
      blockMarkup,
      report,
    });
  }

  if (pages.length === 0) {
    throw new Error(`No .html pages found in ${pagesDir}`);
  }

  // Collect CSS based on pass
  let cssPayload = "";
  let cssSource = "";

  if (session.pass === 1) {
    // Pass 1: styles.css (master fallback)
    const cssPath = resolve(outDir, "styles.css");
    if (!existsSync(cssPath)) {
      throw new Error(`styles.css not found: ${cssPath}`);
    }
    cssPayload = readFileSync(cssPath, "utf-8");
    cssSource = "styles.css";

    // Warn about relative URLs
    if (/url\(\s*['"]?(?!https?:|\/\/|data:)/.test(cssPayload)) {
      warnings.push("styles.css contains relative url() references — these may not resolve when injected as inline CSS");
    }
  } else {
    // Pass 2: combined global-styles.json CSS + styles-unique.css
    const setupDir = resolve(outDir, "setup");

    // Read global-styles.json and extract CSS from structured entries
    const gsPath = resolve(setupDir, "global-styles.json");
    const uniquePath = resolve(setupDir, "styles-unique.css");

    if (!existsSync(gsPath)) {
      throw new Error(`global-styles.json not found: ${gsPath}. Run Phase 2 first.`);
    }
    if (!existsSync(uniquePath)) {
      throw new Error(`styles-unique.css not found: ${uniquePath}. Run Phase 2 first.`);
    }

    // Build CSS from global-styles.json entries (structured gb_style_data)
    // For verification we convert the structured data back to flat CSS
    const gsData = JSON.parse(readFileSync(gsPath, "utf-8"));
    const styleEntries = gsData.styles || [];
    const gsCssParts: string[] = [];

    for (const entry of styleEntries) {
      if (!entry.selector || !entry.styles) continue;
      const rules = stylesToCss(entry.styles as Record<string, unknown>);
      if (rules) {
        gsCssParts.push(`${entry.selector} { ${rules} }`);
      }
    }

    const uniqueCss = readFileSync(uniquePath, "utf-8");
    cssPayload = gsCssParts.join("\n") + "\n" + uniqueCss;
    cssSource = "global-styles.json + styles-unique.css";
  }

  return { pages, cssPayload, cssSource, warnings };
}

/**
 * Convert a gb_style_data styles object to a CSS declarations string.
 * Handles nested @media and :pseudo rules.
 */
function stylesToCss(
  styles: Record<string, unknown>,
): string {
  const declarations: string[] = [];
  const nested: string[] = [];

  for (const [key, value] of Object.entries(styles)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // Nested rule: @media or :pseudo
      const inner = stylesToCss(value as Record<string, unknown>);
      if (inner) {
        nested.push(`${key} { ${inner} }`);
      }
    } else if (value !== null && value !== undefined && value !== "") {
      // kebab-case the camelCase property
      const cssProp = key.replace(/[A-Z]/g, (m: string) => "-" + m.toLowerCase());
      declarations.push(`${cssProp}: ${value}`);
    }
  }

  const result = declarations.join("; ") + (declarations.length > 0 ? ";" : "");
  if (nested.length > 0) {
    return result + " " + nested.join(" ");
  }
  return result;
}
