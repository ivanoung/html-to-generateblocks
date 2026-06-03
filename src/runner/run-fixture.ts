// ── Runner ─────────────────────────────────────────────────────
//
// Orchestrates the full pipeline for a single fixture:
//   load → map → serialize → validate → write output files

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Fixture, FixtureReport } from "../core/types.js";
import { resetIds } from "../core/id-generator.js";
import { mapNode } from "../core/mapper.js";
import { serializeBlocks, countBlocks } from "../core/serializer.js";
import { validateBlocks } from "../core/validator.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface RunResult {
  fixture: Fixture;
  report: FixtureReport;
  html: string;
}

/**
 * Load a fixture JSON file and process it through the pipeline.
 */
export function loadFixture(fixturePath: string): Fixture {
  const raw = readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw) as Fixture;
}

/**
 * Run the full pipeline for a single fixture.
 */
export function runFixture(fixture: Fixture): RunResult {
  // 1. Reset IDs per fixture run
  resetIds();

  // 2. Map
  const { blocks, warnings: mappingWarnings } = mapNode(fixture.input);

  // 3. Serialize
  const html = serializeBlocks(blocks);
  const blockCount = countBlocks(blocks);

  // 4. Validate
  const { hardFails, warnings: validationWarnings } = validateBlocks(blocks, html);

  // Merge mapping and validation warnings
  const allWarnings = [
    ...mappingWarnings.map((w) => typeof w === "string"
      ? { code: "MAPPING_WARNING", message: w }
      : { code: (w as any).code ?? "WARNING", message: (w as any).message ?? String(w) }
    ),
    ...validationWarnings,
  ];

  // 5. Determine status
  const shouldPass = fixture.expect.shouldPass;
  const hasHardFails = hardFails.length > 0;
  const status: "pass" | "fail" = (shouldPass && hasHardFails) ? "fail" : "pass";

  // 6. Build report
  const report: FixtureReport = {
    fixture: fixture.name,
    status,
    blockCount,
    hardFails,
    warnings: allWarnings,
    manualVerification: {
      wordpressPasted: false,
      savedWithoutRecovery: null,
      notes: "",
    },
  };

  return { fixture, report, html };
}

/**
 * Write output files to the output/ directory.
 */
export function writeOutput(fixtureName: string, html: string, report: FixtureReport): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const htmlPath = resolve(OUTPUT_DIR, `${fixtureName}.html`);
  const reportPath = resolve(OUTPUT_DIR, `${fixtureName}.report.json`);

  writeFileSync(htmlPath, html, "utf-8");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
}
