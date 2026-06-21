// ── CLI Entry Point ────────────────────────────────────────────
//
// Commands:
//   convert <input.html|dir/>  Convert HTML page(s) to GB blocks
//   project:setup <dir/>       Generate project setup assets (customizer, global styles)
//   verify:prepare             Prepare WordPress verification session

import { resolve, basename, extname } from "node:path";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync, statSync, mkdirSync, copyFileSync } from "node:fs";
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

// ── Main CLI ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npx tsx src/cli/index.ts <command>");
    console.log("");
    console.log("  convert <input.html|dir/>  Convert HTML page(s) to GB blocks");
    console.log("    --skip-shared            Skip shared files (styles.css, manual-steps)");
    console.log("    --split                  Also generate setup/ (tailwind-utilities.css + styles-unique.css + rejected.json)");
    console.log("  project:setup <dir/>       Generate project setup assets (customizer, global styles)");
    console.log("  verify:prepare             Prepare WordPress verification session");
    process.exit(0);
  }

  const cmd = args[0];

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

      // Stage 4: Convert each page — two passes
      //   Pass 1: fallback (no mapper — pixel-perfect reference)
      //   Pass 2: processed (with mapper — editor-ready)
      const doSplit = args.includes("--split");
      const passes: Array<{ mode: string; skipMapper: boolean; runSplit: boolean }> = [
        { mode: "fallback", skipMapper: true, runSplit: false },
        { mode: "processed", skipMapper: false, runSplit: doSplit },
      ];

      const assetFiles = readdirSync(fullPath).filter((f) => {
        const ext = f.split(".").pop()?.toLowerCase() || "";
        return !f.endsWith(".html") && !f.endsWith(".css") && !f.endsWith(".js")
          && !f.startsWith(".");
      });

      for (const pass of passes) {
        const modeDir = resolve(outDir, pass.mode);
        mkdirSync(resolve(modeDir, "pages"), { recursive: true });

        let firstPage = true;
        const allMappedClasses = new Set<string>();
        for (const pc of pageContents) {
          const output = await convert({
            rawHtml: pc.html,
            pageName: pc.name,
            projectDir: `${projectDir ? projectDir + "/" : ""}${pass.mode}`,
            isFirstPage: firstPage,
            cssAlreadyCompiled: true,
            dossier: sharedDossier,
            skipMapper: pass.skipMapper,
            skipStylesCss: !pass.skipMapper, // skip styles.css for processed (only fallback gets it)
          });

          // On first page: prepend Tailwind CSS to styles.css (fallback pass only)
          if (firstPage && inlinerCss && pass.skipMapper) {
            const cssPath = resolve(modeDir, "styles.css");
            const existing = existsSync(cssPath) ? readFileSync(cssPath, "utf-8") : "";
            writeFileSync(cssPath, inlinerCss + "\n" + existing, "utf-8");
          }

          const lossCheck = checkContentLoss(pc.html, output.blockHtml);
          const lossFlag = lossCheck.warning ? ` ⚠ LOSS ${Math.round(lossCheck.lossPercent)}%` : "";
          console.log(`  ${pass.mode} ${output.report.overallStatus === "pass" ? "✓" : "✗"} ${pc.name}: ${output.report.blockCount} blocks, ${output.report.overallStatus}${lossFlag}`);
          if (lossCheck.warning) {
            console.log(`    [LOSS] ${lossCheck.warning}`);
          }

          if (output.report.mappedClasses) {
            for (const cls of output.report.mappedClasses as string[]) {
              allMappedClasses.add(cls);
            }
          }

          firstPage = false;
        }

        // Generate manual-steps.md
        const cssPath = resolve(modeDir, "styles.css");
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
          resolve(modeDir, "manual-steps.md"),
          generateManualStepsReport(ctx) + "\n",
          "utf-8",
        );

        // Phase 2: Split styles.css (only for processed pass when --split is set)
        const setupDir = resolve(modeDir, "setup");

        if (pass.runSplit) {
        mkdirSync(setupDir, { recursive: true });

        // Use full Tailwind CSS: from file if present, otherwise inlinerCss
        const fullCss = existsSync(cssPath)
          ? readFileSync(cssPath, "utf-8")
          : inlinerCss;

        const result = CssClassifier.classify(fullCss);

        // Filter Tailwind utilities: remove CSS rules for classes mapped to GB inline styles
        let utilityCss = result.utilityCss;
        if (allMappedClasses.size > 0) {
          utilityCss = filterUtilityCss(utilityCss, allMappedClasses);
        }

        // Merge structured styles + unique CSS into one file for easy debugging.
        // Structured styles: design component classes (e.g., .blueprint-bg, .clip-hex)
        // Unique CSS: raw non-utility CSS selectors
        let combinedCss = result.uniqueCss;
        for (const s of result.structuredStyles) {
          const props = Object.entries(s.styles)
            .map(([k, v]) => `${k}:${String(v)}`)
            .join(";");
          if (props) combinedCss += `${s.selector}{${props}}\n`;
        }

        writeFileSync(resolve(setupDir, "tailwind-utilities.css"), utilityCss, "utf-8");
        writeFileSync(resolve(setupDir, "styles-unique.css"), combinedCss, "utf-8");

        const totalRules =
          result.structuredStyles.length +
          (utilityCss.match(/\{/g) || []).length;
        writeFileSync(resolve(setupDir, "rejected.json"), result.rejectionLog.toJSON(totalRules), "utf-8");

        console.log(`  ${pass.mode} Structured: ${result.structuredStyles.length} classes merged into styles-unique.css`);
        console.log(`  ${pass.mode} Tailwind:   ${pass.mode}/setup/tailwind-utilities.css`);
        console.log(`  ${pass.mode} Unique:     ${pass.mode}/setup/styles-unique.css`);
        console.log(`  ${pass.mode} Rejections: ${pass.mode}/setup/rejected.json`);
      }

      // Write app.js into this mode folder (fallback and processed both need scripts)
      if (uniqueScripts.length > 0) {
        writeFileSync(resolve(modeDir, "app.js"), formatGlobalJs(uniqueScripts), "utf-8");
      }

      // Copy assets (images, etc.) into this mode folder
      for (const asset of assetFiles) {
        const srcAsset = resolve(fullPath, asset);
        const destAsset = resolve(modeDir, asset);
        if (statSync(srcAsset).isFile()) {
          try { copyFileSync(srcAsset, destAsset); }
          catch (e: any) { console.log(`  Asset copy failed: ${asset} — ${e.message}`); }
        }
      }
      } // end for each pass

      // Log asset copies once (they go to both mode folders)
      for (const asset of assetFiles) {
        console.log(`  Asset copied: ${asset} (fallback + processed)`);
      }

      console.log(`\n  Done. ${pageContents.length} page(s) converted.`);
      console.log(`  Fallback:    ${outputDir}fallback/pages/ — pixel-perfect reference`);
      console.log(`  Processed:   ${outputDir}processed/pages/ — editor-ready`);
      if (doSplit) {
        console.log(`  Setup:       ${outputDir}processed/setup/`);
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
  console.error("Available: convert, project:setup, verify:prepare");
  process.exit(1);
}

main();
