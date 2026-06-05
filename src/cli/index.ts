// ── CLI Entry Point ────────────────────────────────────────────
//
// Commands:
//   fixtures:list              List all available fixtures
//   fixtures:run <name>        Run single fixture (M1 or M2)
//   fixtures:run-all           Run all fixtures
//   validate <name>            Validate specific fixture output
//   report:update <name>       Update manual verification in report
//   regression                 Check M1 fixtures against snapshots

import { resolve, basename, extname, relative, join, dirname } from "node:path";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import {
  runFixture, runIRFixture, runHeroFixture, loadFixture, writeOutput, writeHeroOutput,
  isIRFixture, type IRFixture,
} from "../runner/run-fixture.js";
import type { Fixture, FixtureReport, ReportStatus } from "../core/types.js";
import { normalizeHeroHtml } from "../core/hero-intake.js";
import { convertHero, DEFAULT_OPTIONS } from "../core/hero-converter.js";
import type { HeroConverterOptions } from "../core/hero-converter.js";

const FIXTURES_DIR = resolve(process.cwd(), "fixtures");
const SNAPSHOTS_DIR = resolve(process.cwd(), "snapshots/m1");

interface InputFile {
  fullPath: string;
  outRel: string;
  baseName: string;
}

function collectInputFiles(inputPath: string): InputFile[] {
  const fullPath = resolve(process.cwd(), inputPath);
  if (!existsSync(fullPath)) return [];
  if (statSync(fullPath).isDirectory()) {
    const files: InputFile[] = [];
    walkDir(fullPath, inputPath, files);
    return files.sort((a, b) => a.outRel.localeCompare(b.outRel));
  }
  if (fullPath.endsWith(".html")) {
    const outRel = inputPath.replace(/^inputs\//, "").replace(/\/[^/]+\.html$/, "");
    return [{ fullPath, outRel, baseName: basename(fullPath, ".html") }];
  }
  return [];
}

function walkDir(dir: string, relDir: string, files: InputFile[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = join(relDir, entry);
    if (statSync(full).isDirectory()) {
      walkDir(full, rel, files);
    } else if (entry.endsWith(".html") && !entry.includes("Zone.Identifier")) {
      const outRel = dirname(rel.replace(/^inputs\//, ""));
      files.push({ fullPath: full, outRel, baseName: basename(entry, ".html") });
    }
  }
}

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

  // Hero fixtures use the hero converter pipeline
  if ((raw as any).kind === "hero") {
    const heroOptions = (raw as any).heroOptions;
    const { html, report: heroReport } = runHeroFixture(raw as IRFixture, heroOptions);
    writeHeroOutput(name, html, heroReport);
    console.log(`  Output: output/${name}.html`);
    console.log(`  Report: output/${name}.report.json`);
    console.log(`  Mode: ${heroReport.mode}, Score: ${heroReport.patternScore.toFixed(2)}`);

    // Return a compatible FixtureReport for display
    const status: ReportStatus = heroReport.mode === "rejected"
      ? "rejected_unsupported"
      : heroReport.hardFails.length > 0 ? "validator_fail" : "validator_pass";

    return {
      fixture: name,
      status,
      blockCount: heroReport.blockCount,
      hardFails: heroReport.hardFails.map(f => ({ code: f, message: f })),
      warnings: [],
      manualVerification: { wordpressPasted: false, savedWithoutRecovery: null, notes: "" },
    };
  }

  let result: { report: FixtureReport; html: string };

  if (isIRFixture(raw as any)) {
    result = runIRFixture(raw as IRFixture);
  } else {
    result = runFixture(raw as Fixture);
  }

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

  // ── hero:convert ─────────────────────────────────────────
  if (cmd === "hero:convert") {
    const inputPath = args[1];
    const modeIdx = args.indexOf("--mode");
    const scoreIdx = args.indexOf("--min-pattern-score");

    if (!inputPath) {
      console.error("Usage: hero:convert <path> [--mode auto|pattern|generic] [--min-pattern-score 0.75]");
      console.error("  <path>    Input file or directory (e.g. inputs/mino-2206/hero.html)");
      console.error("            Directories are recursively scanned for .html files");
      process.exit(1);
    }

    const mode = (modeIdx !== -1 ? args[modeIdx + 1] : "auto") as HeroConverterOptions["mode"];
    const minScore = scoreIdx !== -1 ? parseFloat(args[scoreIdx + 1]) : 0.75;

    // Collect input files
    const files = collectInputFiles(inputPath);
    if (files.length === 0) {
      console.error(`No .html files found in: ${inputPath}`);
      process.exit(1);
    }

    const options: HeroConverterOptions = { mode, minPatternScore: minScore };

    console.log(`\nConverting ${files.length} hero section(s)...`);
    console.log(`  Mode: ${mode}, Min score: ${minScore}\n`);

    let total = 0;
    let passed = 0;
    let rejected = 0;

    for (const { fullPath, outRel, baseName } of files) {
      console.log(`  ${outRel}/${baseName}.html ← ${fullPath}`);
      const rawHtml = readFileSync(fullPath, "utf-8");
      const { root, warnings } = normalizeHeroHtml(rawHtml);
      const result = convertHero(baseName, root, options);

      // Write to mirrored output folder
      const outDir = resolve(process.cwd(), "output", outRel);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, `${baseName}.html`), result.html, "utf-8");
      writeFileSync(resolve(outDir, `${baseName}.report.json`),
        JSON.stringify(result.report, null, 2) + "\n", "utf-8");

      console.log(`    → output/${outRel}/${baseName}.html (${result.report.mode}, ${result.report.blockCount} blocks, score ${result.report.patternScore.toFixed(2)})`);
      total++;
      if (result.report.mode === "rejected") rejected++;
      else passed++;
    }

    console.log(`\n  Done: ${total} files (${passed} converted, ${rejected} rejected)\n`);
    return;
  }

  // ── Unknown command ───────────────────────────────────────
  console.error(`Unknown command: ${cmd}`);
  console.error("Available: fixtures:list, fixtures:run, fixtures:run-all, validate, report:update, regression, hero:convert");
  process.exit(1);
}

main();
