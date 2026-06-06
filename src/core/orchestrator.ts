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
import type { InlinerResult } from "./tailwind-inliner.js";
import { consolidateStyles } from "./class-consolidator.js";
import type { GlobalStyleEntry } from "./class-consolidator.js";
import type { GlobalStyleEntry } from "./class-consolidator.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export interface ConversionInput {
  rawHtml: string;
  pageName: string;
  projectDir?: string;   // e.g. "mino" or "mino/services"
  resolveCss?: boolean;
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

  // Stage 0: Resolve Tailwind to inline CSS (if present)
  let rawHtml = input.rawHtml;
  const inlinerWarnings: { code: string; message: string }[] = [];
  let consolidatedGlobalStyles: GlobalStyleEntry[] | undefined;
  let inlined: InlinerResult | undefined;

  if (usesTailwind(rawHtml)) {
    inlined = await inlineTailwindStyles(rawHtml);
    if (inlined.warnings.length > 0) {
      inlinerWarnings.push(
        ...inlined.warnings.map((m) => ({ code: "INLINER", message: m })),
      );
    }
    // Only use inlined output if it actually produced results
    if (inlined.elementCount > 0) {
      rawHtml = inlined.html;

      // Consolidate styles into global classes
      consolidatedGlobalStyles = consolidateStyles(
        inlined.desktopFirstStyles,
      );
    }
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

  // Stage 5: Validate
  const { hardFails, warnings: valWarnings } = validateBlocks(
    walkResult.blocks,
    html,
  );

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

  // Block markup
  writeFileSync(
    resolve(outDir, `${input.pageName}.html`),
    html,
    "utf-8",
  );

  // Report
  writeFileSync(
    resolve(outDir, `${input.pageName}.report.json`),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  // Consolidated global-styles.json (WordPress Global Styles format)
  if (consolidatedGlobalStyles && consolidatedGlobalStyles.length > 0) {
    writeFileSync(
      resolve(outDir, "global-styles.json"),
      JSON.stringify(consolidatedGlobalStyles, null, 2) + "\n",
      "utf-8",
    );
  }

  // Custom CSS (from inliner: preflight + @keyframes + ::-webkit-*)
  if (inlined?.customCss) {
    writeFileSync(
      resolve(outDir, "custom.css"),
      inlined.customCss + "\n",
      "utf-8",
    );
  }

  // Custom CSS (from inliner: preflight + @keyframes + ::-webkit-*)
  if (inlined?.customCss) {
    writeFileSync(
      resolve(outDir, "custom.css"),
      inlined.customCss + "\n",
      "utf-8",
    );
  }

  return {
    pageName: input.pageName,
    blockHtml: html,
    report,
    globalStyles: {} as Record<string, unknown>,
    customCss: inlined?.customCss || prepResult.customCss,
    tailwindCss: "",
  };
}
