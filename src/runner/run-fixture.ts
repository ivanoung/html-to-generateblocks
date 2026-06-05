// ── Runner ─────────────────────────────────────────────────────
//
// Orchestrates the full pipeline for a single fixture.
// Supports two modes:
//   M1 (FixtureNode via mapNode) — regression-safe, all M1 fixtures
//   M2 (IRNode via planBlocks) — new phase 1+ fixtures

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Fixture, FixtureReport, ReportStatus, HardFail } from "../core/types.js";
import type { IRNode } from "../core/ir-node.js";
import { resetIds } from "../core/id-generator.js";
import { mapNode } from "../core/mapper.js";
import { planBlocks } from "../core/ir-planner.js";
import { serializeBlocks, countBlocks } from "../core/serializer.js";
import { validateBlocks } from "../core/validator.js";
import { convertHero } from "../core/hero-converter.js";
import type { HeroConverterOptions, HeroReport } from "../core/hero-converter.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface RunResult {
  fixture: Fixture | IRFixture;
  report: FixtureReport;
  html: string;
}

export interface IRFixture {
  name: string;
  description: string;
  input: IRNode;
  expect: {
    shouldPass: boolean;
    hardFailCount: number;
    warningCodes: string[];
  };
}

// ── Fixture loading ───────────────────────────────────────────

/**
 * Load a fixture JSON file. Detects M1 vs M2 format by checking
 * whether the top-level `input` uses FixtureNode (has `nodeType`)
 * or IRNode (has `nodeType` with IR type values).
 */
export function loadFixture(fixturePath: string): Fixture | IRFixture {
  const raw = readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Detect whether a parsed fixture is M1 (FixtureNode) or M2 (IRNode) format.
 * M1 fixtures have `input.nodeType` with values like "element", "text", "image".
 * M2 fixtures have `input.nodeType` with values like "section", "container", etc.
 */
export function isIRFixture(f: Fixture | IRFixture): boolean {
  const input = (f as any).input;
  if (!input || !input.nodeType) return false;
  const irTypes = ["section", "container", "heading", "paragraph",
    "button-link", "span", "image", "list", "quote", "icon"];
  return irTypes.includes(input.nodeType);
}

// ── M1 runner (preserved) ─────────────────────────────────────

export function runFixture(fixture: Fixture): RunResult {
  resetIds();
  const { blocks, warnings: mappingWarnings } = mapNode(fixture.input);
  const html = serializeBlocks(blocks);
  const blockCount = countBlocks(blocks);
  const { hardFails, warnings: validationWarnings } = validateBlocks(blocks, html);

  const allWarnings = [
    ...mappingWarnings.map((w) => typeof w === "string"
      ? { code: "MAPPING_WARNING", message: w }
      : { code: (w as any).code ?? "WARNING", message: (w as any).message ?? String(w) }
    ),
    ...validationWarnings,
  ];

  const shouldPass = fixture.expect.shouldPass;
  const hasHardFails = hardFails.length > 0;
  const status: ReportStatus = (shouldPass && hasHardFails) ? "validator_fail" : "validator_pass";

  const report: FixtureReport = {
    fixture: fixture.name,
    status,
    blockCount,
    hardFails,
    warnings: allWarnings,
    manualVerification: { wordpressPasted: false, savedWithoutRecovery: null, notes: "" },
  };

  return { fixture, report, html };
}

// ── M2 runner (IR-based) ──────────────────────────────────────

export function runIRFixture(fixture: IRFixture): RunResult {
  resetIds();

  const { blocks, errors: planningErrors } = planBlocks(fixture.input);

  // Reject policy: no blocks produced → emit explicit failure
  if (planningErrors.length > 0 && blocks.length === 0) {
    const hardFails: HardFail[] = planningErrors.map(e => ({
      code: "PLANNING_REJECTED",
      message: e,
    }));

    const report: FixtureReport = {
      fixture: fixture.name,
      status: "rejected_unsupported",
      blockCount: 0,
      hardFails,
      warnings: [],
      manualVerification: { wordpressPasted: false, savedWithoutRecovery: null, notes: "" },
    };

    return { fixture, report, html: "" };
  }

  const html = serializeBlocks(blocks);
  const blockCount = countBlocks(blocks);
  const { hardFails, warnings: validationWarnings } = validateBlocks(blocks, html);

  const warnings = [
    ...planningErrors.map(e => ({ code: "PLANNING_WARNING", message: e })),
    ...validationWarnings,
  ];

  const status: ReportStatus = hardFails.length > 0 ? "validator_fail" : "validator_pass";

  const report: FixtureReport = {
    fixture: fixture.name,
    status,
    blockCount,
    hardFails,
    warnings,
    manualVerification: { wordpressPasted: false, savedWithoutRecovery: null, notes: "" },
  };

  return { fixture, report, html };
}

// ── Output writing ────────────────────────────────────────────

export function runHeroFixture(fixture: IRFixture, options?: HeroConverterOptions): { html: string; report: HeroReport } {
  return convertHero(fixture.name, fixture.input, options);
}

export function writeHeroOutput(fixtureName: string, html: string, report: HeroReport): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.html`), html, "utf-8");
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.report.json`), JSON.stringify(report, null, 2) + "\n", "utf-8");
}

export function writeOutput(fixtureName: string, html: string, report: FixtureReport): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.html`), html, "utf-8");
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.report.json`), JSON.stringify(report, null, 2) + "\n", "utf-8");
}

// ── Fidelity fixture runner ──────────────────────────────────

export interface FidelityFixture {
  name: string;
  description: string;
  inputHtml: string;
  expect: {
    shouldPass: boolean;
    hardFailCount: number;
    blockCount?: number;
  };
}

import { convert } from "../core/orchestrator.js";
import type { ConversionOutput } from "../core/orchestrator.js";

export function runFidelityFixture(fixture: FidelityFixture): RunResult {
  const output: ConversionOutput = convert({
    rawHtml: fixture.inputHtml,
    pageName: fixture.name,
  });

  const hardFails: HardFail[] =
    (output.report.hardFails as any[])?.map((f: any) => ({
      code: f.code || "UNKNOWN",
      message: f.message || "",
    })) || [];

  const warnings: Warning[] =
    (output.report.warnings as any[])?.map((w: any) => ({
      code: w.code || "WARNING",
      message: w.message || "",
    })) || [];

  const blockCount = (output.report.blockCount as number) || 0;
  const status: ReportStatus =
    hardFails.length > 0 ? "validator_fail" : "validator_pass";

  const report: FixtureReport = {
    fixture: fixture.name,
    status,
    blockCount,
    hardFails,
    warnings,
    manualVerification: {
      wordpressPasted: false,
      savedWithoutRecovery: null,
      notes: "",
    },
  };

  writeOutput(fixture.name, output.blockHtml, report);

  if (
    output.globalStyles &&
    (output.globalStyles as any).classes?.length > 0
  ) {
    writeFileSync(
      resolve(OUTPUT_DIR, `${fixture.name}-global-styles.json`),
      JSON.stringify(output.globalStyles, null, 2) + "\n",
      "utf-8",
    );
  }
  if (output.customCss?.length > 0) {
    writeFileSync(
      resolve(OUTPUT_DIR, `${fixture.name}-custom.css`),
      output.customCss + "\n",
      "utf-8",
    );
  }

  return { fixture, report, html: output.blockHtml };
}

export function isFidelityFixture(f: any): boolean {
  return typeof f.inputHtml === "string";
}
