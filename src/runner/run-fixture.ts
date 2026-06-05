// ── Runner ─────────────────────────────────────────────────────
//
// Orchestrates the full pipeline for a single fixture.
// Supports two modes:
//   M1 (FixtureNode via mapNode) — regression-safe, all M1 fixtures
//   Fidelity (HTML via convert) — new fidelity-first pipeline

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Fixture, FixtureReport, ReportStatus, HardFail, Warning } from "../core/types.js";
import { resetIds } from "../core/id-generator.js";
import { mapNode } from "../core/mapper.js";
import { serializeBlocks, countBlocks } from "../core/serializer.js";
import { validateBlocks } from "../core/validator.js";
import { convert } from "../core/orchestrator.js";
import type { ConversionOutput } from "../core/orchestrator.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface RunResult {
  fixture: Fixture | FidelityFixture;
  report: FixtureReport;
  html: string;
}

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

// ── Fixture loading ───────────────────────────────────────────

export function loadFixture(fixturePath: string): Fixture {
  const raw = readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw);
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

// ── Output writing ────────────────────────────────────────────

export function writeOutput(fixtureName: string, html: string, report: FixtureReport): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.html`), html, "utf-8");
  writeFileSync(resolve(OUTPUT_DIR, `${fixtureName}.report.json`), JSON.stringify(report, null, 2) + "\n", "utf-8");
}

// ── Fidelity fixture runner ──────────────────────────────────

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
