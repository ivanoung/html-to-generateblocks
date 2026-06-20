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

import { resolve, basename, extname } from "node:path";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import {
  runFixture, loadFixture, writeOutput,
  runFidelityFixture, isFidelityFixture,
  type FidelityFixture,
} from "../runner/run-fixture.js";
import type { Fixture, FixtureReport, ReportStatus } from "../core/types.js";
import { convert } from "../core/orchestrator.js";
import { inlineTailwindStyles, usesTailwind, inlineTailwindMultiPage } from "../core/tailwind-inliner.js";
import { resolveIconifyIcons } from "../core/iconify-resolver.js";
import { checkContentLoss } from "../core/content-verifier.js";
import { compileTailwindOffline, extractTailwindConfig, validateTailwindConfig, expandColorPalettes } from "../core/tailwind-resolver.js";
import { buildGlobalStylesManifest } from "../core/global-styles-data.js";
import { CssClassifier, generateGbImportFormat } from "../core/css-classifier.js";
import { extractScripts, deduplicateScripts, formatGlobalJs } from "../core/script-extractor.js";
import { createSession, readSession, updateSession, deleteSession, hasActiveSession, validateEnv, checkStagingUrl } from "../core/verify-session.js";
import { prepareVerification } from "../core/verify-prepare.js";

const FIXTURES_DIR = resolve(process.cwd(), "fixtures");
const SNAPSHOTS_DIR = resolve(process.cwd(), "snapshots/m1");

// ── CSS Utility Filter ──────────────────────────────────────

/**
 * Remove CSS rules from utilityCss whose selectors match any class
 * that was converted to GB inline styles (no longer needed as CSS).
 */
function filterUtilityCss(utilityCss: string, mappedClasses: Set<string>): string {
  if (mappedClasses.size === 0) return utilityCss;
  
  // Split into individual rules — each starts with a selector on its own line
  const rules = utilityCss.split(/\n(?=[.#@])/);
  return rules.filter(rule => {
    for (const cls of mappedClasses) {
      const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match class selector: .flex{ or .flex, or .flex 
      if (new RegExp(`\\.${escaped}([\\s,\\{:]|$)`).test(rule)) {
        return false;
      }
    }
    return true;
  }).join("");
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
    console.log("    --skip-shared            Skip shared files (styles.css, manual-steps)");
    console.log("    --split                  Also generate setup/ (global-styles.json + tailwind-utilities.css + styles-unique.css + rejected.json)");
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
    let sharedDossier = undefined;
    if (tailwindConfig) {
      const expandedConfig = expandColorPalettes(tailwindConfig);
      console.log(`  Compiling Tailwind CSS from ${pageContents.length} page(s) via CDN...`);
      const compiled = await inlineTailwindMultiPage(
        pageContents.map((pc) => pc.html),
        pageContents.map((pc) => pc.name),
        fullDir,
        expandedConfig,
      );
      tailwindCss = compiled.stylesCss;
      sharedDossier = compiled.dossier;
      console.log(`    ✓ Compiled (${(compiled.stylesCss.length / 1024).toFixed(1)} KB)`);
    }

    // Convert first page to generate shared files (skip inliner — already compiled)
    await convert({
      rawHtml: firstHtml,
      pageName: "_setup",
      projectDir,
      isFirstPage: true,
      cssAlreadyCompiled: true,
      dossier: sharedDossier,
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

      // Stage 2: Compile Tailwind CSS via CDN (Playwright, live DOM)
      let inlinerCss = "";
      const tailwindConfig = extractTailwindConfig(pageContents[0]?.html || "");
      let sharedDossier = undefined;

      if (tailwindConfig) {
        const expandedConfig = expandColorPalettes(tailwindConfig);
        console.log(`  Compiling Tailwind CSS from ${files.length} page(s) via CDN...`);
        const compiled = await inlineTailwindMultiPage(
          pageContents.map((pc) => pc.html),
          pageContents.map((pc) => pc.name),
          fullPath,
          expandedConfig,
        );
        if (compiled.warnings.length > 0) {
          for (const w of compiled.warnings) console.log(`    [WARN] ${w}`);
        }
        inlinerCss = compiled.stylesCss;
        sharedDossier = compiled.dossier;
        console.log(`    ✓ Compiled (${(compiled.stylesCss.length / 1024).toFixed(1)} KB)`);

        // Validate config for known patterns
        const allPageClasses = new Set<string>();
        for (const pc of pageContents) {
          const classMatches = pc.html.match(/class="([^"]*)"/g) || [];
          for (const m of classMatches) {
            const cls = m.replace(/class="([^"]*)"/, "$1");
            cls.split(/\s+/).forEach((c) => c && allPageClasses.add(c));
          }
        }
        const configWarnings = validateTailwindConfig(expandedConfig, [...allPageClasses]);
        for (const w of configWarnings) {
          if (w.type === "single_value_color") {
            console.log(`    [WARN] Color "${w.color}" is a single hex value but ${w.missingClasses.length} shade variant classes are used`);
            console.log(`           → Define "${w.color}" as an object with shades (50-950) instead of a single hex`);
          }
        }
      } else {
        console.log("  No tailwind.config found — skipping CSS compilation");
      }

      // Write shared styles.css (combined Tailwind + custom CSS from all pages)
      // The first page's convert with skipInliner produces the custom CSS portion.
      // We'll write the Tailwind CSS now and let the first page append custom CSS.
      const outDir = resolve(process.cwd(), outputDir);
      if (!existsSync(outDir)) {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(outDir, { recursive: true });
      }

      // Stage 4: Convert each page with skipInliner=true
      let firstPage = true;
      const allMappedClasses = new Set<string>();
      for (const pc of pageContents) {
        const output = await convert({
          rawHtml: pc.html,
          pageName: pc.name,
          projectDir,
          isFirstPage: firstPage,  // shared files only from first page
          cssAlreadyCompiled: true, // CSS already compiled once for all pages
          dossier: sharedDossier,
        });

        // On first page: prepend Tailwind CSS to styles.css
        if (firstPage && inlinerCss) {
          const cssPath = resolve(outDir, "styles.css");
          const existing = existsSync(cssPath) ? readFileSync(cssPath, "utf-8") : "";
          writeFileSync(cssPath, inlinerCss + "\n" + existing, "utf-8");
        }

        const lossCheck = checkContentLoss(pc.html, output.blockHtml);
        const lossFlag = lossCheck.warning ? ` ⚠ LOSS ${Math.round(lossCheck.lossPercent)}%` : "";
        console.log(`  ${output.report.overallStatus === "pass" ? "✓" : "✗"} ${pc.name}: ${output.report.blockCount} blocks, ${output.report.overallStatus}${lossFlag}`);
        if (lossCheck.warning) {
          console.log(`    [LOSS] ${lossCheck.warning}`);
        }

        // Collect layout classes that were mapped to GB styles (for CSS filter)
        if (output.report.mappedClasses) {
          for (const cls of output.report.mappedClasses) {
            allMappedClasses.add(cls);
          }
        }

        firstPage = false;
      }

      // Generate manual-steps.md with global selector inventory
      const cssPath = resolve(outDir, "styles.css");
      const { analyzeSource, generateManualStepsReport } = await import("../core/manual-steps.js");
      const { inventoryGlobalSelectors } = await import("../core/global-selector-inventory.js");
      const src = analyzeSource(pageContents[0].html);
      const inventory = inventoryGlobalSelectors(
        existsSync(cssPath) ? readFileSync(cssPath, "utf-8") : "",
      );
      const ctx = {
        fonts: src.fonts,
        externalImages: src.externalImages,
        hasNav: src.hasNav,
        hasIconify: src.hasIconify,
        inventory: inventory.rules.length > 0 ? inventory : undefined,
        customizerExists: existsSync(resolve(outDir, "customizer-import.json")),
        appJsExists: uniqueScripts.length > 0,
      };
      writeFileSync(
        resolve(outDir, "manual-steps.md"),
        generateManualStepsReport(ctx) + "\n",
        "utf-8",
      );

      // Phase 2: Split styles.css into three layers:
      //   - global-styles.json / global-styles-import.json
      //   - tailwind-utilities.css (static Tailwind utilities)
      //   - styles-unique.css (non-utility raw CSS)
      // Only runs when --split flag is passed. Monolithic styles.css at
      // project root is always the canonical pixel-perfect fallback.
      const doSplit = args.includes("--split");
      const setupDir = resolve(outDir, "setup");

      if (existsSync(cssPath) && doSplit) {
        mkdirSync(setupDir, { recursive: true });

        const fullCss = readFileSync(cssPath, "utf-8");

        const result = CssClassifier.classify(fullCss);

        // Filter Tailwind utilities: remove CSS rules for classes mapped to GB inline styles
        let utilityCss = result.utilityCss;
        if (allMappedClasses.size > 0) {
          utilityCss = filterUtilityCss(utilityCss, allMappedClasses);
        }

        const structuredStyles = result.structuredStyles.map((s) => ({
          selector: s.selector,
          name: s.name,
          styles: s.styles,
        }));

        // Unique (non-utility) raw CSS only — utilities live in their own file
        const rawSelectors = [...new Set(
          [...result.uniqueCss.matchAll(/^([.#][^\s{]+)\s*\{/gm)].map((m) => m[1])
        )];
        const rawEntries = rawSelectors.map((sel) => ({
          selector: sel,
          name: sel.replace(/^\./, ""),
          styles: {} as Record<string, unknown>,
          raw: true,
        }));

        const manifest = buildGlobalStylesManifest(structuredStyles, rawEntries, []);
        writeFileSync(resolve(setupDir, "global-styles.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
        writeFileSync(resolve(setupDir, "tailwind-utilities.css"), utilityCss, "utf-8");
        writeFileSync(resolve(setupDir, "styles-unique.css"), result.uniqueCss, "utf-8");

        const totalRules =
          structuredStyles.length +
          rawEntries.length +
          (utilityCss.match(/\{/g) || []).length;
        writeFileSync(resolve(setupDir, "rejected.json"), result.rejectionLog.toJSON(totalRules), "utf-8");

        // GB-importable format: flat array of {selector, css, data}
        const importFormat = generateGbImportFormat(result.structuredStyles);
        writeFileSync(
          resolve(setupDir, "global-styles-import.json"),
          JSON.stringify(importFormat, null, 2) + "\n",
          "utf-8",
        );

        console.log(`  Global Styles: ${structuredStyles.length} structured (editable), ${rawEntries.length} raw (CSS-only)`);
        console.log(`  Tailwind CSS:  setup/tailwind-utilities.css`);
        console.log(`  Unique CSS:    setup/styles-unique.css`);
        console.log(`  Rejections:    setup/rejected.json`);
        console.log(`  Import:        setup/global-styles-import.json`);
      }

      // Write app.js at project root with all scripts
      if (uniqueScripts.length > 0) {
        writeFileSync(resolve(outDir, "app.js"), formatGlobalJs(uniqueScripts), "utf-8");
      }

      // Copy non-HTML assets (images, favicons, fonts) verbatim into mirrored output
      const assetFiles = readdirSync(fullPath).filter((f) => {
        const ext = f.split(".").pop()?.toLowerCase() || "";
        return !f.endsWith(".html") && !f.endsWith(".css") && !f.endsWith(".js")
          && !f.startsWith(".");
      });
      for (const asset of assetFiles) {
        const srcAsset = resolve(fullPath, asset);
        const destAsset = resolve(outDir, asset);
        if (statSync(srcAsset).isFile()) {
          copyFileSync(srcAsset, destAsset);
          console.log(`  Asset copied: ${asset}`);
        }
      }

      console.log(`\n  Done. ${pageContents.length} page(s) converted.`);
      console.log(`  Pages:       ${outputDir}pages/`);
      if (doSplit) {
        console.log(`  Setup:       ${outputDir}setup/`);
      }
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

    const output = await convert({ rawHtml, pageName, projectDir, isFirstPage: !skipShared });

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

  // ── verify:prepare ──────────────────────────────────────
  if (cmd === "verify:prepare") {
    const inputPath = args[1];
    if (!inputPath) {
      console.error("Usage: verify:prepare <inputs/project/> [--pass 2]");
      process.exit(1);
    }

    const envError = validateEnv();
    if (envError) {
      console.error(`ERROR: ${envError}`);
      process.exit(1);
    }

    const stagingWarning = checkStagingUrl();
    if (stagingWarning) console.log(stagingWarning);

    if (hasActiveSession()) {
      console.log("An active verification session exists. Run 'verify:cleanup' first or 'verify:status' to inspect.");
      process.exit(1);
    }

    const passNum = args.includes("--pass") && args[args.indexOf("--pass") + 1] === "2" ? 2 : 1;
    const wpUrl = process.env.GB_WP_URL!;
    const projectDir = inputPath.replace(/^inputs\//, "").replace(/\/$/, "");
    const session = createSession(wpUrl, passNum as 1 | 2, projectDir);

    const outDir = `output/${projectDir}`;
    if (!existsSync(resolve(process.cwd(), outDir, "pages"))) {
      console.log(`No output found for ${projectDir}. Run conversion first.`);
      deleteSession();
      process.exit(1);
    }

    console.log(`Preparing Pass ${passNum} verification for ${projectDir}...`);

    let prepResult;
    try {
      prepResult = prepareVerification(session);
    } catch (err: any) {
      console.error(`ERROR: ${err.message}`);
      deleteSession();
      process.exit(1);
    }

    if (prepResult.warnings.length > 0) {
      console.log("\nWarnings:");
      for (const w of prepResult.warnings) console.log(`  ⚠ ${w}`);
    }

    const sessionPosts = prepResult.pages.map((p) => ({
      slug: p.slug,
      status: "pending" as const,
    }));
    updateSession({ createdPosts: sessionPosts, status: "awaiting_review" });

    const output = {
      session_file: "output/.verify-session.json",
      run_id: session.runId,
      wp_url: wpUrl,
      pass: passNum,
      css_source: prepResult.cssSource,
      css_size: prepResult.cssPayload.length,
      pages: prepResult.pages.map((p) => ({
        slug: p.slug,
        title: p.postTitle,
        block_size: p.blockMarkup.length,
        hard_fails: ((p.report.hardFails as unknown[]) || []).length,
      })),
      instructions: [
        "1. Read output/.verify-session.json for run_id",
        "2. Upload sandbox loader: write-file to novamira-sandbox/gb-verify-{run_id}.php",
        "3. Enable sandbox loader: enable-file",
        "4. For each page: execute-php wp_insert_post() with block markup",
        "5. Update session file with post IDs",
        "6. Set CSS transient: execute-php set_transient()",
        "7. Generate nonce: execute-php wp_create_nonce()",
        "8. Report URLs to user with ?gb_verify={run_id}&_nonce={nonce}",
      ],
    };

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // ── verify:status ─────────────────────────────────────
  if (cmd === "verify:status") {
    const session = readSession();
    if (!session) {
      console.log("No active verification session.");
      process.exit(0);
    }
    console.log(`Session: ${session.runId}`);
    console.log(`Status:  ${session.status}`);
    console.log(`Pass:    ${session.pass}`);
    console.log(`Project: ${session.projectDir}`);
    console.log(`Started: ${session.startedAt}`);
    console.log(`\nPages (${session.createdPosts.length}):`);
    for (const p of session.createdPosts) {
      const icon = p.status === "created" ? "✓" : p.status === "failed" ? "✗" : "◌";
      console.log(`  ${icon} ${p.slug}${p.url ? ` → ${p.url}` : ""}${p.error ? ` (${p.error})` : ""}`);
    }
    return;
  }

  // ── verify:cleanup ────────────────────────────────────
  if (cmd === "verify:cleanup") {
    const session = readSession();
    if (!session) {
      console.log("No session to clean up.");
      process.exit(0);
    }
    console.log(`Cleaning up session ${session.runId}...`);
    console.log(`  ${session.createdPosts.length} post(s) to delete`);
    console.log(`  Sandbox file: ${session.sandboxFile}`);
    console.log(`  Transient: gb_verify_css_${session.runId}`);
    console.log(JSON.stringify({
      cleanup_steps: [
        { step: "delete_posts", postIds: session.createdPosts.filter(p => p.postId).map(p => p.postId) },
        { step: "delete_transient", key: `gb_verify_css_${session.runId}` },
        { step: "disable_file", path: session.sandboxFile },
        { step: "delete_file", path: session.sandboxFile },
        { step: "delete_session", file: "output/.verify-session.json" },
      ],
    }, null, 2));
    return;
  }

  // ── Unknown command ───────────────────────────────────────
  console.error(`Unknown command: ${cmd}`);
  console.error("Available: fixtures:list, fixtures:run, fixtures:run-all, convert, validate, report:update, regression");
  process.exit(1);
}

main();
