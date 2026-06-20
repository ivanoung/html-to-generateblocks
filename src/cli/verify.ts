#!/usr/bin/env npx tsx
/**
 * Verification script: compare processed output against fallback for layout fidelity.
 *
 * Strategy: run the mapper on the fallback block's globalClasses and compare
 * against what the processed block has in styles. This avoids rem→px unit
 * conversion issues.
 *
 * Usage: npx tsx src/cli/verify.ts [output/path]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { tailwindLayoutToGbAttributes, TailwindLayoutConfig } from "../core/tailwind-layout-mapper.js";

// ── Types ───────────────────────────────────────────────────

interface BlockJson {
  uniqueId: string;
  tagName?: string;
  styles: Record<string, unknown>;
  globalClasses?: string[];
}

interface VerificationIssue {
  uniqueId: string;
  tagName?: string;
  type: "missing_property" | "value_mismatch" | "unused_property";
  property: string;
  expected: string;
  actual: string;
}

interface PageReport {
  page: string;
  totalBlocks: number;
  comparedBlocks: number;
  issues: VerificationIssue[];
  issueCount: number;
}

// ── Block extraction ────────────────────────────────────────

function extractBlocks(html: string): Map<string, BlockJson> {
  const blocks = new Map<string, BlockJson>();
  const re = /<!--\s*wp:generateblocks\/\w+\s+(\{(?:[^{}]|\{[^{}]*\})*\})\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const block = JSON.parse(m[1]) as BlockJson;
      if (block.uniqueId) blocks.set(block.uniqueId, block);
    } catch { /* skip unparseable */ }
  }
  return blocks;
}

// ── Comparison ──────────────────────────────────────────────

/** Properties that use CSS variables (--tw-*) — skip when comparing. */
function isTwVariable(val: string): boolean {
  return val.includes("var(--tw-") || val.includes("rgb(");
}

/** Normalize a value for comparison. */
function normalize(v: string): string {
  return v.trim().replace(/\s+/g, " ");
}

function compareBlock(
  uid: string,
  fallbackBlock: BlockJson,
  processedBlock: BlockJson,
  mapperConfig: TailwindLayoutConfig | undefined,
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const fbClasses = (fallbackBlock.globalClasses || []).join(" ");
  const prStyles = processedBlock.styles || {};

  // Run mapper on fallback class list — this gives us what the mapper SHOULD produce
  const expected = tailwindLayoutToGbAttributes(fbClasses, mapperConfig);

  // Flatten processed styles (handle @media, skip nested)
  const flatProcessed: Record<string, string> = {};
  flattenStyles(prStyles, "", flatProcessed);

  // Flatten expected styles
  const flatExpected: Record<string, string> = {};
  flattenStyles(expected.styles, "", flatExpected);

  // Compare expected → processed
  for (const [prop, expectedVal] of Object.entries(flatExpected)) {
    const prVal = flatProcessed[prop];

    if (prVal === undefined) {
      if (isTwVariable(expectedVal)) continue;
      issues.push({
        uniqueId: uid,
        tagName: processedBlock.tagName,
        type: "missing_property",
        property: prop,
        expected: expectedVal,
        actual: "(not in processed styles)",
      });
    } else if (normalize(prVal) !== normalize(expectedVal)) {
      if (isTwVariable(expectedVal) && isTwVariable(prVal)) continue;
      if (isTwVariable(expectedVal) || isTwVariable(prVal)) {
        // One side has --tw-* — skip
        continue;
      }
      issues.push({
        uniqueId: uid,
        tagName: processedBlock.tagName,
        type: "value_mismatch",
        property: prop,
        expected: expectedVal,
        actual: prVal,
      });
    }
  }

  // Check for properties in processed that mapper didn't produce
  // (could be legitimate extras — not necessarily issues)
  // We skip this to avoid noise.

  return issues;
}

function flattenStyles(
  styles: Record<string, unknown>,
  prefix: string,
  out: Record<string, string>,
  depth = 0,
): void {
  if (depth > 5) return; // safety
  for (const [key, val] of Object.entries(styles)) {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      // Skip @media keys — mapper produces same structure
      if (key.startsWith("@media")) continue;
      flattenStyles(val as Record<string, unknown>, prefix, out, depth + 1);
    } else if (typeof val === "string") {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      out[fullKey] = val;
    }
  }
}

// ── Main ────────────────────────────────────────────────────

function verifyPage(
  fallbackHtml: string,
  processedHtml: string,
  pageName: string,
  mapperConfig: TailwindLayoutConfig | undefined,
): PageReport {
  const fbBlocks = extractBlocks(fallbackHtml);
  const prBlocks = extractBlocks(processedHtml);

  const allIssues: VerificationIssue[] = [];
  let compared = 0;

  for (const [uid, prBlock] of prBlocks) {
    const fbBlock = fbBlocks.get(uid);
    if (!fbBlock) continue;
    const fbClasses = fbBlock.globalClasses || [];
    if (fbClasses.length === 0) continue;
    compared++;

    const issues = compareBlock(uid, fbBlock, prBlock, mapperConfig);
    allIssues.push(...issues);
  }

  return {
    page: pageName,
    totalBlocks: prBlocks.size,
    comparedBlocks: compared,
    issues: allIssues,
    issueCount: allIssues.length,
  };
}

// ── CLI ─────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const outputDir = args.includes("--output") && args[args.indexOf("--output") + 1]
    ? args[args.indexOf("--output") + 1]
    : "output/mino";

  const fallbackDir = path.join(outputDir, "fallback", "pages");
  const processedDir = path.join(outputDir, "processed", "pages");
  const stylesCssPath = path.join(outputDir, "fallback", "styles.css");

  if (!fs.existsSync(stylesCssPath)) {
    console.error(`ERROR: styles.css not found at ${stylesCssPath}`);
    process.exit(1);
  }

  // Try to read config for container width
  let mapperConfig: TailwindLayoutConfig | undefined;
  try {
    const customizerPath = path.join(outputDir, "customizer-import.json");
    if (fs.existsSync(customizerPath)) {
      const customizer = JSON.parse(fs.readFileSync(customizerPath, "utf-8"));
      if (customizer.containerWidth) {
        mapperConfig = { maxWidth: { container: customizer.containerWidth } };
      }
    }
  } catch { /* ignore */ }

  const pageFiles = fs.readdirSync(processedDir)
    .filter((f) => f.endsWith(".html"))
    .sort();

  const reports: PageReport[] = [];
  let totalIssues = 0;

  for (const pageFile of pageFiles) {
    const fallbackPath = path.join(fallbackDir, pageFile);
    const processedPath = path.join(processedDir, pageFile);

    if (!fs.existsSync(fallbackPath)) {
      console.warn(`WARN: No fallback for ${pageFile}, skipping`);
      continue;
    }

    const fbHtml = fs.readFileSync(fallbackPath, "utf-8");
    const prHtml = fs.readFileSync(processedPath, "utf-8");

    const report = verifyPage(fbHtml, prHtml, pageFile, mapperConfig);
    reports.push(report);
    totalIssues += report.issueCount;

    console.log(`${pageFile}: ${report.totalBlocks}B ${report.comparedBlocks}C ${report.issueCount} issues`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`${pageFiles.length} pages, ${totalIssues} total issues`);

  if (totalIssues > 0) {
    const byType: Record<string, number> = {};
    const byProp = new Map<string, number>();

    // Collect first few per page for detail
    let shown = 0;
    for (const report of reports) {
      for (const issue of report.issues) {
        byType[issue.type] = (byType[issue.type] || 0) + 1;
        byProp.set(issue.property, (byProp.get(issue.property) || 0) + 1);
        if (shown < 30) {
          console.log(`  ${issue.uniqueId} [${issue.type}] ${issue.property}: ${issue.expected} → ${issue.actual}`);
          shown++;
        }
      }
    }

    console.log(`\nBy type: ${JSON.stringify(byType)}`);
    console.log(`Top property issues:`);
    for (const [prop, count] of [...byProp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${prop}: ${count}`);
    }

    // Write detailed report
    const reportPath = path.join(outputDir, "verify-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));
    console.log(`\nFull report: ${reportPath}`);
  } else {
    const reportPath = path.join(outputDir, "verify-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));
    console.log(`Report: ${reportPath}`);
  }

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(2);
});
