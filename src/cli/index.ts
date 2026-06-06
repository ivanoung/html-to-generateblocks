// ── CLI Entry Point ────────────────────────────────────────────
//
// Commands:
//   fixtures:list              List all available fixtures
//   fixtures:run <name>        Run single fixture (M1 or fidelity)
//   fixtures:run-all           Run all fixtures
//   convert <input.html>       Convert HTML page to GB blocks
//   validate <name>            Validate specific fixture output
//   report:update <name>       Update manual verification in report
//   regression                 Check M1 fixtures against snapshots

import { resolve, basename, extname } from "node:path";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import {
  runFixture, loadFixture, writeOutput,
  runFidelityFixture, isFidelityFixture,
  type FidelityFixture,
} from "../runner/run-fixture.js";
import type { Fixture, FixtureReport, ReportStatus } from "../core/types.js";
import { convert } from "../core/orchestrator.js";

const FIXTURES_DIR = resolve(process.cwd(), "fixtures");
const SNAPSHOTS_DIR = resolve(process.cwd(), "snapshots/m1");

// ── Fixture listing ───────────────────────────────────────────

function getAllFixtureFiles(): string[] {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json") && !f.includes("Zone.Identifier"))
    .map((f) => resolve(FIXTURES_DIR, f))
    .sort();
}

// ── Print results ─────────────────────────────────────────────

function printResults(reports: FixtureReport[]): void {
  let passed = 0;
  let failed = 0;
  let rejected = 0;

  for (const r of reports) {
    const icon = r.status === "validator_pass" || r.status === "wordpress_verified_pass"
      ? "✓" : r.status === "rejected_unsupported"
      ? "⊘" : "✗";
    console.log(`  ${icon} ${r.fixture} (${r.blockCount} blocks) — ${r.status}`);

    if (r.hardFails.length > 0) {
      for (const hf of r.hardFails) {
        console.log(`      • [${hf.code}] ${hf.message}`);
      }
    }
    if (r.warnings.length > 0) {
      const codes = [...new Set(r.warnings.map((w) => w.code))];
      console.log(`      Warnings: ${codes.join(", ")}`);
    }

    if (r.status === "validator_pass" || r.status === "wordpress_verified_pass") passed++;
    else if (r.status === "rejected_unsupported") rejected++;
    else failed++;
  }

  console.log(`\n  ${passed} passed, ${failed} failed, ${rejected} rejected, ${reports.length} total\n`);
}

// ── Process a single fixture ──────────────────────────────────

function processFixture(name: string, fixPath: string): FixtureReport {
  console.log(`\nProcessing: ${name}`);

  const raw = loadFixture(fixPath);

  // Fidelity fixtures use the new fidelity-first pipeline
  if (isFidelityFixture(raw)) {
    const result = runFidelityFixture(raw as FidelityFixture);
    console.log(`  Output: output/${name}.html`);
    console.log(`  Report: output/${name}.report.json`);
    return result.report;
  }

  let result: { report: FixtureReport; html: string };

  result = runFixture(raw as Fixture);

  writeOutput(name, result.html, result.report);
  console.log(`  Output: output/${name}.html`);
  console.log(`  Report: output/${name}.report.json`);

  return result.report;
}

// ── M1 regression check ───────────────────────────────────────

function regressionCheck(): boolean {
  console.log("\n=== M1 Regression Check ===\n");
  const m1Names = ["button-link", "captioned-image", "embed-fallback", "text-stack", "two-col"];
  let allOk = true;

  for (const name of m1Names) {
    const fp = resolve(FIXTURES_DIR, `${name}.json`);

    const fixture = loadFixture(fp) as Fixture;
    const { html } = runFixture(fixture);

    const snap = resolve(SNAPSHOTS_DIR, `${name}.html`);
    if (!existsSync(snap)) {
      console.log(`  ? ${name}: no snapshot (${snap})`);
      continue;
    }

    const snapshot = readFileSync(snap, "utf-8");
    if (html === snapshot) {
      console.log(`  ✓ ${name}: matches snapshot`);
    } else {
      console.log(`  ✗ ${name}: MISMATCH`);
      allOk = false;
    }
  }

  console.log(allOk ? "\n  All M1 fixtures passed regression." : "\n  REGRESSION DETECTED — outputs differ from snapshots");
  return allOk;
}

// ── Main CLI ──────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Default: run all fixtures
    console.log("Usage: npx tsx src/cli/index.ts <command>");
    console.log("");
    console.log("  fixtures:list              List all fixtures");
    console.log("  fixtures:run <name>        Run single fixture");
    console.log("  fixtures:run-all           Run all fixtures");
    console.log("  convert <input.html>       Convert HTML page to GB blocks");
    console.log("  regression                 Check M1 vs snapshots");
    process.exit(0);
  }

  const cmd = args[0];

  // ── fixtures:list ─────────────────────────────────────────
  if (cmd === "fixtures:list") {
    const files = getAllFixtureFiles();
    console.log("\nAvailable fixtures:");
    for (const fp of files) {
      const name = basename(fp, extname(fp));
      console.log(`  ${name}`);
    }
    console.log(`\n${files.length} total\n`);
    return;
  }

  // ── regression ────────────────────────────────────────────
  if (cmd === "regression") {
    const ok = regressionCheck();
    process.exit(ok ? 0 : 1);
  }

  // ── fixtures:run-all ──────────────────────────────────────
  if (cmd === "fixtures:run-all") {
    if (!regressionCheck()) process.exit(1);

    const files = getAllFixtureFiles();
    const reports: FixtureReport[] = [];
    let hasFailure = false;

    for (const fp of files) {
      const name = basename(fp, extname(fp));
      const report = processFixture(name, fp);
      reports.push(report);
      if (report.status === "validator_fail") hasFailure = true;
    }

    console.log("\n=== Results ===");
    printResults(reports);
    if (hasFailure) process.exit(1);
    return;
  }

  // ── fixtures:run <name> ───────────────────────────────────
  if (cmd === "fixtures:run") {
    const name = args[1];
    if (!name) { console.error("Usage: fixtures:run <name>"); process.exit(1); }

    const fp = resolve(FIXTURES_DIR, `${name}.json`);
    if (!existsSync(fp)) {
      console.error(`Fixture not found: ${fp}`);
      process.exit(1);
    }

    const report = processFixture(name, fp);
    printResults([report]);
    if (report.status === "validator_fail") process.exit(1);
    return;
  }

  // ── validate ──────────────────────────────────────────────
  if (cmd === "validate") {
    const name = args[1];
    if (!name) { console.error("Usage: validate <name>"); process.exit(1); }

    const htmlPath = resolve(process.cwd(), "output", `${name}.html`);
    if (!existsSync(htmlPath)) {
      console.error(`File not found: ${htmlPath}`);
      process.exit(1);
    }

    // Regenerate and compare with existing output
    console.log(`\nRe-validating: ${name}\n`);
    const fp = resolve(FIXTURES_DIR, `${name}.json`);
    if (!existsSync(fp)) {
      console.error(`Fixture not found: ${fp}`);
      process.exit(1);
    }

    const raw = loadFixture(fp);
    let result: { report: FixtureReport; html: string };

    if (isIRFixture(raw as any)) {
      result = runIRFixture(raw as IRFixture);
    } else {
      result = runFixture(raw as Fixture);
    }

    const r = result.report;
    console.log(`  Status: ${r.status}`);
    console.log(`  Blocks: ${r.blockCount}`);
    console.log(`  Hard fails: ${r.hardFails.length}`);
    for (const hf of r.hardFails) {
      console.log(`    [${hf.code}] ${hf.message}`);
    }
    console.log(`  Warnings: ${r.warnings.length}`);
    for (const w of r.warnings) {
      console.log(`    [${w.code}] ${w.message}`);
    }

    if (r.status === "validator_fail" || r.status === "rejected_unsupported") process.exit(1);
    return;
  }

  // ── report:update ─────────────────────────────────────────
  if (cmd === "report:update") {
    const name = args[1];
    if (!name) { console.error("Usage: report:update <name> --pasted true --saved true --notes \"...\""); process.exit(1); }

    const reportPath = resolve(process.cwd(), "output", `${name}.report.json`);
    if (!existsSync(reportPath)) {
      console.error(`Report not found: ${reportPath}`);
      process.exit(1);
    }

    const report: FixtureReport = JSON.parse(readFileSync(reportPath, "utf-8"));

    const pastedIdx = args.indexOf("--pasted");
    const savedIdx = args.indexOf("--saved");
    const notesIdx = args.indexOf("--notes");

    if (pastedIdx >= 0 && args[pastedIdx + 1]) {
      report.manualVerification.wordpressPasted = args[pastedIdx + 1] === "true";
    }
    if (savedIdx >= 0 && args[savedIdx + 1]) {
      report.manualVerification.savedWithoutRecovery = args[savedIdx + 1] === "true" ? true : args[savedIdx + 1] === "false" ? false : null;
    }
    if (notesIdx >= 0 && args[notesIdx + 1]) {
      report.manualVerification.notes = args[notesIdx + 1];
    }

    // Update status if wordpress verified
    if (report.manualVerification.wordpressPasted && report.manualVerification.savedWithoutRecovery) {
      report.status = "wordpress_verified_pass";
    } else if (report.manualVerification.wordpressPasted && report.manualVerification.savedWithoutRecovery === false) {
      report.status = "wordpress_verified_fail";
    }

    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
    console.log(`Updated: ${reportPath}`);
    console.log(`  Status: ${report.status}`);
    return;
  }

  // ── convert ─────────────────────────────────────────────
  if (cmd === "convert") {
    const inputPath = args[1];
    if (!inputPath) {
      console.error("Usage: convert <input.html>");
      process.exit(1);
    }

    const fullPath = resolve(process.cwd(), inputPath);
    if (!existsSync(fullPath)) {
      console.error(`File not found: ${fullPath}`);
      process.exit(1);
    }

    const rawHtml = readFileSync(fullPath, "utf-8");

    // Derive project dir and page name from input path
    // inputs/mino/index.html        → projectDir = "mino", pageName = "index"
    // inputs/mino/services/a.html   → projectDir = "mino/services", pageName = "a"
    const relPath = fullPath.replace(process.cwd() + "/", "");
    const inputsPrefix = "inputs/";
    let projectDir: string | undefined;
    let pageName: string;

    if (relPath.startsWith(inputsPrefix)) {
      const afterInputs = relPath.slice(inputsPrefix.length);
      const lastSlash = afterInputs.lastIndexOf("/");
      if (lastSlash >= 0) {
        projectDir = afterInputs.substring(0, lastSlash);
        pageName = basename(afterInputs, extname(afterInputs));
      } else {
        pageName = basename(afterInputs, extname(afterInputs));
      }
    } else {
      pageName = basename(fullPath, extname(fullPath));
    }

    const output = convert({ rawHtml, pageName, projectDir, resolveCss: args.includes("--resolve-css") });

    const outputPrefix = projectDir ? `output/${projectDir}/` : "output/";
    console.log(`\nConverted: ${projectDir ? projectDir + "/" : ""}${pageName}`);
    console.log(`  Output: ${outputPrefix}${pageName}.html`);
    console.log(`  Report: ${outputPrefix}${pageName}.report.json`);
    console.log(`  Blocks: ${output.report.blockCount}`);
    console.log(`  Status: ${output.report.overallStatus}`);

    const warnings = (output.report.warnings as any[]) || [];
    if (warnings.length > 0) {
      console.log(`  Warnings: ${warnings.length}`);
      const shown = Math.min(warnings.length, 5);
      for (let i = 0; i < shown; i++) {
        console.log(`    [${warnings[i].code}] ${warnings[i].message}`);
      }
      if (warnings.length > 5) console.log(`    ... and ${warnings.length - 5} more`);
    }

    if (output.customCss) {
      const lines = output.customCss.split("\n").filter(l => l.trim()).length;
      console.log(`  Custom CSS: ${outputPrefix}${pageName}-custom.css (${lines} rules)`);
    }
    if (output.tailwindCss) {
      console.log(`  Tailwind CSS: ${outputPrefix}tailwind.css`);
    }
    const gs = output.globalStyles as any;
    if (gs?.classes?.length > 0) {
      console.log(`  Global Styles: ${outputPrefix}${pageName}-global-styles.json (${gs.classes.length} classes)`);
    }
    console.log("");
    return;
  }

  // ── Unknown command ───────────────────────────────────────
  console.error(`Unknown command: ${cmd}`);
  console.error("Available: fixtures:list, fixtures:run, fixtures:run-all, convert, validate, report:update, regression");
  process.exit(1);
}

main();
