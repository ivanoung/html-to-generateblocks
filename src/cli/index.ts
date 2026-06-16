// ── CLI Entry Point ────────────────────────────────────────────
//
// Commands:
//   fixtures:list              List all available fixtures
//   fixtures:run <name>        Run single fixture (M1 or fidelity)
//   fixtures:run-all           Run all fixtures
//   convert <input.html|dir/>  Convert HTML page(s) to GB blocks
//   validate <name>            Validate specific fixture output
//   report:update <name>       Update manual verification in report
//   regression                 Check M1 fixtures against snapshots

import { resolve, basename, extname, dirname } from "node:path";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync, statSync, mkdirSync, rmdirSync } from "node:fs";
import {
  runFixture, loadFixture, writeOutput,
  runFidelityFixture, isFidelityFixture,
  type FidelityFixture,
} from "../runner/run-fixture.js";
import type { Fixture, FixtureReport, ReportStatus } from "../core/types.js";
import { convert } from "../core/orchestrator.js";
import { resolveIconifyIcons } from "../core/iconify-resolver.js";
import { checkContentLoss } from "../core/content-verifier.js";
import { splitCss } from "../core/css-splitter.js";
import { extractScripts, deduplicateScripts, formatGlobalJs } from "../core/script-extractor.js";

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

async function processFixture(name: string, fixPath: string): Promise<FixtureReport> {
  console.log(`\nProcessing: ${name}`);

  const raw = loadFixture(fixPath);

  // Fidelity fixtures use the new fidelity-first pipeline
  if (isFidelityFixture(raw)) {
    const result = await runFidelityFixture(raw as FidelityFixture);
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Default: run all fixtures
    console.log("Usage: npx tsx src/cli/index.ts <command>");
    console.log("");
    console.log("  fixtures:list              List all fixtures");
    console.log("  fixtures:run <name>        Run single fixture");
    console.log("  fixtures:run-all           Run all fixtures");
    console.log("  convert <input.html|dir/>  Convert HTML page(s) to GB blocks");
    console.log("  render <output-dir|file>   Render GB output as standalone HTML");
    console.log("  compare <src> <out-dir>    Screenshot diff source vs rendered");
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
      const report = await processFixture(name, fp);
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

    const report = await processFixture(name, fp);
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

    result = runFixture(raw as Fixture);

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
  if (cmd === "project:setup") {
    const projectPath = args[1];
    if (!projectPath) {
      console.error("Usage: project:setup <inputs/project/>");
      process.exit(1);
    }

    const fullDir = resolve(process.cwd(), projectPath);
    if (!existsSync(fullDir)) {
      console.error(`Directory not found: ${fullDir}`);
      process.exit(1);
    }

    const htmlFiles = readdirSync(fullDir).filter((f) => f.endsWith(".html"));
    if (htmlFiles.length === 0) {
      console.error(`No .html files found in ${fullDir}`);
      process.exit(1);
    }

    console.log(`\nSetting up project from ${htmlFiles.length} page(s)...\n`);

    // Collect all pages and compile Tailwind from all of them
    const projectDir = projectPath.replace(/^inputs\//, "").replace(/\/$/, "");
    const pageContents: { name: string; html: string }[] = [];
    for (const f of htmlFiles) {
      pageContents.push({
        name: f.replace(".html", ""),
        html: readFileSync(resolve(fullDir, f), "utf-8"),
      });
    }

    // Compile Tailwind CSS from ALL pages via CDN (Playwright)
    let tailwindCss = "";
    const firstHtml = pageContents[0].html;
    const tailwindConfig = extractTailwindConfig(firstHtml);
    if (tailwindConfig) {
      console.log(`  Compiling Tailwind CSS from ${pageContents.length} page(s) via CDN...`);
      const compiled = await inlineTailwindMultiPage(
        pageContents.map((pc) => pc.html),
        pageContents.map((pc) => pc.name),
      );
      tailwindCss = compiled.stylesCss;
      console.log(`    ✓ Compiled (${(compiled.stylesCss.length / 1024).toFixed(1)} KB)`);
    }

    // Convert first page to generate shared files (skip inliner — already compiled)
    await convert({
      rawHtml: firstHtml,
      pageName: "_setup",
      projectDir,
      skipShared: false,
      skipInliner: true,
    });

    // Prepend compiled Tailwind CSS to styles.css

    const outDir = projectDir ? `output/${projectDir}/` : "output/";
    const absOutDir = resolve(process.cwd(), outDir);
    if (tailwindCss) {
      const cssPath = resolve(absOutDir, "styles.css");
      const existing = existsSync(cssPath) ? readFileSync(cssPath, "utf-8") : "";
      writeFileSync(cssPath, tailwindCss + "\n" + existing, "utf-8");
    }

    // Clean up throwaway setup blocks
    try { unlinkSync(resolve(absOutDir, "pages", "_setup.html")); } catch {}
    try { unlinkSync(resolve(absOutDir, "pages", "_setup.report.json")); } catch {}
    console.log(`  styles.css:         ${outDir}styles.css`);
    console.log(`  manual-steps:       ${outDir}manual-steps.txt`);
    console.log("");
    console.log("Now run individual pages:");
    htmlFiles.forEach((f) => {
      console.log(`  npx tsx src/cli/index.ts convert ${projectPath}${f} --skip-shared`);
    });
    console.log("");
    return;
  }

  // ── convert ─────────────────────────────────────────────
  if (cmd === "convert") {
    const inputPath = args[1];
    if (!inputPath) {
      console.error("Usage: convert <input.html|dir/> [--skip-shared]");
      process.exit(1);
    }

    const skipShared = args.includes("--skip-shared");
    const fullPath = resolve(process.cwd(), inputPath);
    if (!existsSync(fullPath)) {
      console.error(`File or directory not found: ${fullPath}`);
      process.exit(1);
    }

    // ── Project mode (directory) ──────────────────────────
    if (statSync(fullPath).isDirectory()) {
      const files = readdirSync(fullPath).filter((f) => f.endsWith(".html")).sort();
      if (files.length === 0) {
        console.error(`No .html files found in ${fullPath}`);
        process.exit(1);
      }

      // Derive project dir from input path
      const relPath = fullPath.replace(process.cwd() + "/", "");
      const inputsPrefix = "inputs/";
      let projectDir: string | undefined;
      if (relPath.startsWith(inputsPrefix)) {
        projectDir = relPath.slice(inputsPrefix.length).replace(/\/$/, "");
      }
      const outputDir = projectDir ? `output/${projectDir}/` : "output/";

      console.log(`\nProject mode: ${files.length} page(s) in ${projectDir || "."}/\n`);

      // Stage 1: Concatenate all pages for shared Tailwind compilation
      let combinedHtml = "";
      const pageContents: { name: string; html: string }[] = [];
      for (const f of files) {
        const html = readFileSync(resolve(fullPath, f), "utf-8");
        const name = basename(f, extname(f));
        pageContents.push({ name, html });
        combinedHtml += `<!-- page:${name} -->\n${html}\n`;
      }

      // Stage 1.5: Extract all scripts for global.js
      const allScripts = [];
      for (const pc of pageContents) {
        allScripts.push(...extractScripts(pc.html, pc.name));
      }
      const uniqueScripts = deduplicateScripts(allScripts);

      // Write shared global.js
      const outDir = resolve(process.cwd(), outputDir);
      const globalJs = formatGlobalJs(uniqueScripts);
      if (globalJs.trim()) {
        mkdirSync(resolve(outDir, "setup"), { recursive: true });
        writeFileSync(resolve(outDir, "setup", "global.js"), globalJs, "utf-8");
      }

      // Convert each page
      let firstPage = true;
      for (const pc of pageContents) {
        const output = await convert({
          rawHtml: pc.html,
          pageName: pc.name,
          projectDir,
          skipShared: !firstPage,
        });

        const lossCheck = checkContentLoss(pc.html, output.blockHtml);
        const lossFlag = lossCheck.warning ? ` ⚠ LOSS ${Math.round(lossCheck.lossPercent)}%` : "";
        console.log(`  ${output.report.overallStatus === "pass" ? "✓" : "✗"} ${pc.name}: ${output.report.blockCount} blocks, ${output.report.overallStatus}${lossFlag}`);
        if (lossCheck.warning) {
          console.log(`    [LOSS] ${lossCheck.warning}`);
        }

        firstPage = false;
      }

      // After all pages: split styles.css into setup/ folder
      const cssPath = resolve(outDir, "styles.css");
      const setupDir = resolve(outDir, "setup");
      const pagesDir = resolve(outDir, "pages");
      if (existsSync(cssPath)) {
        mkdirSync(setupDir, { recursive: true });

        const fullCss = readFileSync(cssPath, "utf-8");

        // Collect custom class names from the source <style> blocks
        const { extractCustomClassNames } = await import("../core/preprocessor.js");
        const customClassNames = extractCustomClassNames(pageContents[0].html);
        for (let i = 1; i < pageContents.length; i++) {
          const names = extractCustomClassNames(pageContents[i].html);
          names.forEach((n) => customClassNames.add(n));
        }

        const split = splitCss(fullCss, customClassNames);
        writeFileSync(resolve(setupDir, "global-styles.json"), JSON.stringify(split.globalStyles, null, 2) + "\n", "utf-8");
        writeFileSync(resolve(setupDir, "styles-unique.css"), split.uniqueCss + "\n", "utf-8");

        // Move manual-steps.txt into setup/
        const srcManual = resolve(outDir, "manual-steps.txt");
        if (existsSync(srcManual)) {
          writeFileSync(resolve(setupDir, "manual-steps.txt"), readFileSync(srcManual, "utf-8"));
          unlinkSync(srcManual);
        }

        // styles.css stays at project root (shared across all pages)
      }

      // Write global.js with all scripts
      if (uniqueScripts.length > 0) {
        writeFileSync(resolve(setupDir, "global.js"), formatGlobalJs(uniqueScripts), "utf-8");
      }

      // Convert nav and footer components from the index page
      const firstPageHtml = pageContents[0]?.html || "";
      const { preprocess } = await import("../core/preprocessor.js");
      const prepResult = preprocess(firstPageHtml, true);

      if (prepResult.navHtml) {
        console.log(`  Converting nav component...`);
        const navDir = resolve(outDir, "components", "nav");
        mkdirSync(navDir, { recursive: true });
        const navDoc = `<!DOCTYPE html><html><head></head><body>${prepResult.navHtml}</body></html>`;
        await convert({
          rawHtml: navDoc,
          pageName: "nav",
          projectDir: projectDir ? `${projectDir}/components/nav` : undefined,
          skipShared: true,
          skipStripNavFooter: true,
        });
        // Flatten: components/nav/pages/nav.html → components/nav/nav.html
        const nestedPages = resolve(navDir, "pages");
        if (existsSync(nestedPages)) {
          for (const f of readdirSync(nestedPages)) {
            writeFileSync(resolve(navDir, f), readFileSync(resolve(nestedPages, f)));
            unlinkSync(resolve(nestedPages, f));
          }
          rmdirSync(nestedPages);
        }
        console.log(`    ✓ nav converted`);
      }

      if (prepResult.footerHtml) {
        console.log(`  Converting footer component...`);
        const footerDir = resolve(outDir, "components", "footer");
        mkdirSync(footerDir, { recursive: true });
        const footerDoc = `<!DOCTYPE html><html><head></head><body>${prepResult.footerHtml}</body></html>`;
        await convert({
          rawHtml: footerDoc,
          pageName: "footer",
          projectDir: projectDir ? `${projectDir}/components/footer` : undefined,
          skipShared: true,
          skipStripNavFooter: true,
        });
        const nestedPages = resolve(footerDir, "pages");
        if (existsSync(nestedPages)) {
          for (const f of readdirSync(nestedPages)) {
            writeFileSync(resolve(footerDir, f), readFileSync(resolve(nestedPages, f)));
            unlinkSync(resolve(nestedPages, f));
          }
          rmdirSync(nestedPages);
        }
        console.log(`    ✓ footer converted`);
      }

      console.log(`\n  Done. ${pageContents.length} page(s) converted.`);
      console.log(`  Pages:       ${outputDir}pages/`);
      console.log(`  Setup:       ${outputDir}setup/`);
      console.log("");
      return;
    }

    // ── Single-page mode ──────────────────────────────────
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

    const output = await convert({ rawHtml, pageName, projectDir, resolveCss: args.includes("--resolve-css"), skipShared });

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
      console.log(`  Styles CSS: ${outputPrefix}styles.css (${lines} rules)`);
    }
    console.log("");
    return;
  }

  // ── render ─────────────────────────────────────────────
  if (cmd === "render") {
    const { renderStandalone } = await import("../core/renderer.js");
    const targetPath = resolve(process.cwd(), args[1] || "output/");
    const sourceIdx = args.indexOf("--source");
    const sourcePath = sourceIdx >= 0 && args[sourceIdx + 1]
      ? resolve(process.cwd(), args[sourceIdx + 1]) : undefined;
    const noJs = args.includes("--no-js");
    const sourceHtml = sourcePath && existsSync(sourcePath) ? readFileSync(sourcePath, "utf-8") : undefined;

    if (existsSync(targetPath) && statSync(targetPath).isFile() && targetPath.endsWith(".html")) {
      // Single page render
      const pageName = basename(targetPath, ".html");
      const projectDir = resolve(dirname(targetPath), "..");
      const html = renderStandalone(projectDir, pageName, sourceHtml, !noJs);
      const outPath = resolve(dirname(targetPath), `${pageName}.rendered.html`);
      writeFileSync(outPath, html, "utf-8");
      console.log(`Rendered: ${outPath}`);
    } else if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
      // Directory: render all pages
      const pagesDir = resolve(targetPath, "pages");
      if (!existsSync(pagesDir)) {
        console.error(`No pages/ directory found in ${targetPath}`);
        process.exit(1);
      }
      const pageFiles = readdirSync(pagesDir).filter(f =>
        f.endsWith(".html") && !f.endsWith(".rendered.html")
      );
      for (const file of pageFiles) {
        const pageName = basename(file, ".html");
        const html = renderStandalone(targetPath, pageName, sourceHtml, !noJs);
        const outPath = resolve(pagesDir, `${pageName}.rendered.html`);
        writeFileSync(outPath, html, "utf-8");
        console.log(`Rendered: ${outPath}`);
      }
    } else {
      console.error(`Target not found: ${targetPath}`);
      process.exit(1);
    }
    return;
  }

  // ── compare ─────────────────────────────────────────────
  if (cmd === "compare") {
    const { runCompare } = await import("./compare.js");
    const sourcePath = resolve(process.cwd(), args[1] || "");
    const outputDir = resolve(process.cwd(), args[2] || "");
    const viewportArg = args.includes("--viewport") ? args[args.indexOf("--viewport") + 1] : "1440x900";
    const waitArg = args.includes("--wait") ? parseInt(args[args.indexOf("--wait") + 1]) : undefined;
    const thresholdArg = args.includes("--threshold") ? parseFloat(args[args.indexOf("--threshold") + 1]) : undefined;
    const golden = args.includes("--golden");
    const viewportParts = viewportArg.split("x");

    if (!sourcePath || !outputDir) {
      console.error("Usage: compare <source.html> <output-dir> [--viewport WxH] [--wait N] [--threshold N] [--golden]");
      process.exit(1);
    }

    await runCompare({
      sourcePath,
      outputDir,
      viewport: { width: parseInt(viewportParts[0]), height: parseInt(viewportParts[1]) },
      waitMs: waitArg,
      threshold: thresholdArg,
      golden,
    });
    return;
  }

  // ── Unknown command ───────────────────────────────────────
  console.error(`Unknown command: ${cmd}`);
  console.error("Available: fixtures:list, fixtures:run, fixtures:run-all, convert, validate, report:update, regression");
  process.exit(1);
}

main();
