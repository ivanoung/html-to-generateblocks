// ── CLI Entry Point ────────────────────────────────────────────
//
// Usage:
//   npx tsx src/cli/index.ts          # Run all fixtures
//   npx tsx src/cli/index.ts button-link  # Run single fixture

import { resolve, basename, extname } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { runFixture, loadFixture, writeOutput } from "../runner/run-fixture.js";
import type { FixtureReport, HardFail } from "../core/types.js";

const FIXTURES_DIR = resolve(process.cwd(), "fixtures");

function getAllFixturePaths(): string[] {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const entries = readdirSync(FIXTURES_DIR);
  return entries
    .filter((f) => f.endsWith(".json") && !f.includes("Zone.Identifier"))
    .map((f) => resolve(FIXTURES_DIR, f))
    .sort();
}

function printResults(reports: FixtureReport[]): void {
  console.log("\n=== GenerateBlocks Converter — Results ===\n");

  let passed = 0;
  let failed = 0;

  for (const r of reports) {
    const icon = r.status === "pass" ? "✓" : "✗";
    console.log(`  ${icon} ${r.fixture} (${r.blockCount} blocks) — ${r.status}`);

    if (r.hardFails.length > 0) {
      console.log(`      Hard fails: ${r.hardFails.length}`);
      for (const hf of r.hardFails) {
        console.log(`        • [${hf.code}] ${hf.message}`);
      }
    }

    if (r.warnings.length > 0) {
      console.log(`      Warnings: ${r.warnings.length}`);
      // Show unique warning codes only for summary
      const codes = [...new Set(r.warnings.map((w) => w.code))];
      console.log(`        Codes: ${codes.join(", ")}`);
    }

    if (r.status === "pass") {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n  Summary: ${passed} passed, ${failed} failed, ${reports.length} total\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  const singleFixture = args[0]?.toLowerCase();
  const fixturePaths: string[] = [];

  if (singleFixture) {
    // Check if the name matches a fixture file
    const path = resolve(FIXTURES_DIR, `${singleFixture}.json`);
    if (!existsSync(path)) {
      console.error(`Fixture not found: "${singleFixture}"`);
      console.error(`Expected file: fixtures/${singleFixture}.json`);
      process.exit(1);
    }
    fixturePaths.push(path);
  } else {
    fixturePaths.push(...getAllFixturePaths());
  }

  const reports: FixtureReport[] = [];
  let hasUnexpectedFail = false;

  for (const fp of fixturePaths) {
    const name = basename(fp, extname(fp));
    console.log(`\nProcessing: ${name}`);

    try {
      const fixture = loadFixture(fp);
      const { report, html } = runFixture(fixture);
      writeOutput(name, html, report);
      reports.push(report);

      console.log(`  Output: output/${name}.html`);
      console.log(`  Report: output/${name}.report.json`);

      // Check if there's an unexpected failure (shouldPass=true but hard fails)
      if (fixture.expect.shouldPass && report.hardFails.length > 0) {
        hasUnexpectedFail = true;
      }
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  printResults(reports);

  if (hasUnexpectedFail) {
    process.exit(1);
  }
}

main();
