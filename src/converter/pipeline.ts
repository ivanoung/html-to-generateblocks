// ── Pipeline Orchestrator ──────────────────────────────────────
//
// Runs the full conversion pipeline in order:
//   Phase 2 → Phase 3 (agent output) → Phase 1 → Phase 4 → Phase 5

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseStructure, type ParseStructureResult } from "./structure-parser.js";
import { validateManifest, applyOverrides, type ManifestOverride } from "./manifest-validator.js";
import { resolveStyles } from "./style-resolver.js";
import { htmlToIR } from "./html-to-ir.js";
import { planBlocks } from "../core/ir-planner.js";
import { serializeBlocks, countBlocks } from "../core/serializer.js";
import { validateBlocks } from "../core/validator.js";
import { resetIds } from "../core/id-generator.js";
import type {
  SectionManifest, PageManifest, PageMeta, SectionSnippet,
} from "../types/manifest.js";
import type { IRNode } from "../core/ir-node.js";
import type { Block } from "../core/types.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface PipelineInput {
  /** Raw HTML page (full document). */
  rawHtml: string;
  /** Page name for output files. */
  pageName: string;
  /** Agent-provided manifests per section. */
  manifests: SectionManifest[];
  /** Optional manifest overrides. */
  overrides?: ManifestOverride[];
}

export interface SectionOutput {
  sectionId: string;
  kind: string;
  blockCount: number;
  html: string;
  warnings: string[];
  errors: string[];
}

export interface PipelineOutput {
  pageName: string;
  combinedHtml: string;
  sections: SectionOutput[];
  report: {
    page: string;
    sectionCount: number;
    sections: Array<{
      sectionId: string;
      kind: string;
      mode: string;
      coverage: number;
      selectorsMatched: number;
      selectorsTotal: number;
      blockCount: number;
      hardFails: string[];
      warnings: string[];
    }>;
    overallStatus: "pass" | "partial" | "fail";
    patternConversionRate: number;
  };
  errors: string[];
}

export function runPipeline(input: PipelineInput): PipelineOutput {
  const { rawHtml, pageName, manifests, overrides } = input;
  const errors: string[] = [];
  const sectionOutputs: SectionOutput[] = [];

  // Apply overrides to manifests
  const finalManifests = overrides
    ? manifests.map((m) => applyOverrides(m, overrides))
    : manifests;

  // Phase 2: Structural parse
  const structure: ParseStructureResult = parseStructure(rawHtml);
  if (structure.snippets.length === 0) {
    return {
      pageName,
      combinedHtml: "",
      sections: [],
      report: {
        page: pageName,
        sectionCount: 0,
        sections: [],
        overallStatus: "fail" as const,
        patternConversionRate: 0,
      },
      errors: ["No sections detected in page"],
    };
  }

  // Phase 1: Style resolution (once per page)
  const resolvedSectionHtmls: Record<string, string> = {};
  // Keep original HTML for manifest validation (selectors need class attributes)
  const originalSectionHtmls: Record<string, string> = {};

  for (const snippet of structure.snippets) {
    originalSectionHtmls[snippet.sectionId] = snippet.html;
    const result = resolveStyles(snippet.html, rawHtml);
    resolvedSectionHtmls[snippet.sectionId] = result.resolvedHtml;
  }

  // Phase 3 is done by the agent — manifests are provided

  // Phase 4: HTML + Manifest → IR
  // Phase 5: IR → Blocks → Serialize → Validate
  resetIds();

  const allBlocksHtml: string[] = [];
  const reportSections: PipelineOutput["report"]["sections"] = [];

  for (const manifest of finalManifests) {
    const originalHtml = originalSectionHtmls[manifest.sectionId];
    const resolvedHtml = resolvedSectionHtmls[manifest.sectionId];
    if (!resolvedHtml) {
      errors.push(`No resolved HTML for section: ${manifest.sectionId}`);
      continue;
    }

    // Validate manifest against ORIGINAL HTML (with classes for selector matching)
    const validation = validateManifest(manifest, originalHtml || resolvedHtml);
    if (!validation.valid) {
      errors.push(...validation.errors.map((e) => `${manifest.sectionId}: ${e}`));
    }

    // Convert against RESOLVED HTML (with inline styles)
    const irResult = htmlToIR(manifest, resolvedHtml);
    const allWarnings = [...validation.warnings, ...irResult.warnings];

    let sectionHtmlOutput = "";
    let blockCount = 0;
    try {
      const { blocks, errors: planningErrors } = planBlocks(irResult.nodes[0]);
      const html = serializeBlocks(blocks);
      blockCount = countBlocks(blocks);
      const { hardFails, warnings: valWarnings } = validateBlocks(blocks, html);

      sectionHtmlOutput = html;
      allWarnings.push(
        ...planningErrors,
        ...valWarnings.map((w) => w.message),
      );

      const selectorCount = manifest.elements.length +
        (manifest.groups?.length || 0) +
        (manifest.templates?.length || 0);
      const matchedCount = selectorCount - validation.missedSelectors.length;

      reportSections.push({
        sectionId: manifest.sectionId,
        kind: manifest.kind,
        mode: manifest.kind === "generic" ? "generic" : "pattern",
        coverage: manifest.coverage,
        selectorsMatched: matchedCount,
        selectorsTotal: selectorCount,
        blockCount,
        hardFails: hardFails.map((f) => f.code),
        warnings: allWarnings,
      });
    } catch (e: any) {
      errors.push(`${manifest.sectionId}: Phase 4/5 failed — ${e.message}`);
      sectionHtmlOutput = `<!-- Conversion failed for section: ${manifest.sectionId} -->\n<!-- ${e.message} -->\n`;
    }

    sectionOutputs.push({
      sectionId: manifest.sectionId,
      kind: manifest.kind,
      blockCount,
      html: sectionHtmlOutput,
      warnings: allWarnings,
      errors: [],
    });

    if (sectionHtmlOutput) {
      allBlocksHtml.push(sectionHtmlOutput);
    }
  }

  // Combine all section HTML
  const combinedHtml = allBlocksHtml.join("\n");

  // Determine overall status
  const patternSections = reportSections.filter((s) => s.mode === "pattern");
  const patternRate = reportSections.length > 0
    ? patternSections.length / reportSections.length
    : 0;
  const hasHardFails = reportSections.some((s) => s.hardFails.length > 0);
  const overallStatus: "pass" | "partial" | "fail" = errors.length > 0
    ? "fail"
    : hasHardFails ? "partial" : "pass";

  // Write output files
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, `${pageName}.html`), combinedHtml, "utf-8");

  const pageManifest: PageManifest = {
    page: pageName,
    sections: finalManifests,
    pageMeta: structure.pageMeta,
  };
  writeFileSync(
    resolve(OUTPUT_DIR, `${pageName}-manifest.json`),
    JSON.stringify(pageManifest, null, 2) + "\n",
    "utf-8",
  );

  const report = {
    page: pageName,
    sectionCount: reportSections.length,
    sections: reportSections,
    overallStatus,
    patternConversionRate: Math.round(patternRate * 100) / 100,
  };
  writeFileSync(
    resolve(OUTPUT_DIR, `${pageName}.report.json`),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  return {
    pageName,
    combinedHtml,
    sections: sectionOutputs,
    report,
    errors,
  };
}
