// ── Orchestrator ───────────────────────────────────────────
//
// Ties the full pipeline together:
//   preprocess → DOM walk → serialize → validate → output files

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preprocess } from "./preprocessor.js";
import { walkDom } from "./dom-walker.js";
import { GlobalStylesCollector } from "./global-styles-collector.js";
import { serializeBlocks, countBlocks } from "./serializer.js";
import { validateBlocks } from "./validator.js";
import { resetIds } from "./id-generator.js";
import { usesTailwind, inlineTailwindStyles } from "./tailwind-inliner.js";
import { resolveIconifyIcons } from "./iconify-resolver.js";
import { analyzeSource, generateManualStepsReport } from "./manual-steps.js";
import { generateCustomizerSettings } from "./customizer-generator.js";
import type { InlinerResult } from "./tailwind-inliner.js";
import { checkContentLoss } from "./content-verifier.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface ConversionInput {
  rawHtml: string;
  pageName: string;
  projectDir?: string;
  resolveCss?: boolean;
  skipShared?: boolean;  // skip styles.css, customizer, manual-steps
  skipInliner?: boolean; // skip Tailwind inliner + iconify resolver (CSS already compiled)
}

export interface ConversionOutput {
  pageName: string;
  blockHtml: string;
  report: Record<string, unknown>;
  globalStyles: Record<string, unknown>;
  customCss: string;
  tailwindCss: string;
}

export async function convert(
  input: ConversionInput,
): Promise<ConversionOutput> {
  resetIds();

  // Stage 0: Compile Tailwind CSS (if present)
  let rawHtml = input.rawHtml;
  const inlinerWarnings: { code: string; message: string }[] = [];
  let compiledCss = "";
  let outputCss = "";

  if (!input.skipInliner && usesTailwind(rawHtml)) {
    const compiled = await inlineTailwindStyles(rawHtml);
    if (compiled.warnings.length > 0) {
      inlinerWarnings.push(
        ...compiled.warnings.map((m) => ({ code: "INLINER", message: m })),
      );
    }
    compiledCss = compiled.stylesCss;
  }

  // Stage 0.5: Resolve <iconify-icon> to inline SVG (always run)
  const iconifyResult = await resolveIconifyIcons(rawHtml);
  rawHtml = iconifyResult.html;
  if (iconifyResult.failed.length > 0) {
    inlinerWarnings.push({
      code: "ICONIFY",
      message: `Could not resolve ${iconifyResult.failed.length} icon(s): ${iconifyResult.failed.join(", ")}`,
    });
  }

  // Stage 1: Preprocess
  const prepResult = preprocess(rawHtml);

  // Stage 2: Register class definitions in collector
  const collector = new GlobalStylesCollector(input.pageName);
  prepResult.classNameToProperties.forEach((styles, className) => {
    collector.registerDefinition(className, styles);
  });

  // Stage 3: DOM walk
  const walkResult = walkDom(
    prepResult.html,
    prepResult.classNameToProperties,
    collector,
  );

  // Collect all warnings
  const allWarnings = [
    ...inlinerWarnings,
    ...prepResult.warnings.map((w) => ({ code: "PREPROCESS", message: w })),
    ...walkResult.warnings.map((w) => ({ code: "WALK", message: w })),
  ];

  // Stage 4: Serialize
  const html = serializeBlocks(walkResult.blocks);
  const blockCount = countBlocks(walkResult.blocks);

  // Stage 4.5: Content-loss check
  const lossCheck = checkContentLoss(input.rawHtml, html);
  if (lossCheck.warning) {
    allWarnings.push({ code: "LOSS", message: lossCheck.warning });
  }

  // Stage 5: Validate
  const { hardFails: validatorHardFails, warnings: valWarnings } = validateBlocks(
    walkResult.blocks,
    html,
  );

  // Merge walker hard fails with validator hard fails
  const hardFails = [
    ...validatorHardFails,
    ...walkResult.hardFails,
  ];

  // Build report
  const report = {
    page: input.pageName,
    blockCount,
    hardFails: hardFails.map((f) => ({ code: f.code, message: f.message })),
    warnings: [
      ...allWarnings,
      ...valWarnings.map((w) => ({ code: w.code, message: w.message })),
    ],
    overallStatus: hardFails.length > 0 ? "partial" : "pass",
    customCssRequired: prepResult.customCss.length > 0,
    globalClassesExtracted: collector
      .toManifest()
      .classes.map((c) => c.slug),
    strippedElements: prepResult.warnings
      .filter((w) => w.startsWith("Stripped"))
      .map((w) => w.replace("Stripped ", "").replace(" element(s)", "")),
  };

  // Write output files — use project subfolder if specified
  const outDir = input.projectDir
    ? resolve(OUTPUT_DIR, input.projectDir)
    : OUTPUT_DIR;
  mkdirSync(outDir, { recursive: true });

  // Page outputs go into pages/ subfolder
  const pagesDir = resolve(outDir, "pages");
  mkdirSync(pagesDir, { recursive: true });

  // Block markup
  writeFileSync(
    resolve(pagesDir, `${input.pageName}.html`),
    html,
    "utf-8",
  );

  // Report
  writeFileSync(
    resolve(pagesDir, `${input.pageName}.report.json`),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  // Single styles.css: compiled Tailwind CSS + custom CSS
  const combinedCss = [compiledCss, prepResult.customCss]
    .filter(Boolean).join("\n");
  if (!input.skipShared) {
    if (combinedCss.trim()) {
      writeFileSync(
        resolve(outDir, "styles.css"),
        combinedCss + "\n",
        "utf-8",
      );
    }

    // customizer-import.json — GeneratePress Customizer settings
    const customizer = generateCustomizerSettings(input.rawHtml);
    if (customizer) {
      writeFileSync(
        resolve(outDir, "customizer-import.json"),
        JSON.stringify(customizer, null, 2) + "\n",
        "utf-8",
      );
    }

    // manual-steps.md — categorized setup instructions
    const manualSteps = analyzeSource(input.rawHtml);
    writeFileSync(
      resolve(outDir, "manual-steps.md"),
      generateManualStepsReport(manualSteps) + "\n",
      "utf-8",
    );
  }

  return {
    pageName: input.pageName,
    blockHtml: html,
    report,
    globalStyles: {} as Record<string, unknown>,
    customCss: combinedCss,
    tailwindCss: "",
  };
}
