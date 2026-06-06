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
import { compileTailwindCss } from "./tailwind-resolver.js";
import { generateThemeSettingsPrompt } from "./theme-settings-extractor.js";
import { generateGlobalStyles } from "./global-styles-generator.js";

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

export function convert(input: ConversionInput): ConversionOutput {
  resetIds();

  // Stage 1: Preprocess
  const prepResult = preprocess(input.rawHtml);

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

  // Global styles manifest (existing format — classNameToProperties)
  const globalStylesManifest = collector.toManifest();
  if (globalStylesManifest.classes.length > 0) {
    writeFileSync(
      resolve(outDir, `${input.pageName}-global-styles.json`),
      JSON.stringify(globalStylesManifest, null, 2) + "\n",
      "utf-8",
    );
  }

  // Custom CSS
  if (prepResult.customCss.length > 0) {
    writeFileSync(
      resolve(outDir, `${input.pageName}-custom.css`),
      prepResult.customCss + "\n",
      "utf-8",
    );
  }

  // Tailwind CSS (if requested and config found)
  let tailwindCss = "";
  if (input.resolveCss && prepResult.tailwindConfig) {
    const twResult = compileTailwindCss(
      prepResult.tailwindConfig,
      input.rawHtml,
      process.cwd(),
    );
    if (twResult.css) {
      tailwindCss = twResult.css;
      // Write to project root (shared across pages in same project)
      writeFileSync(
        resolve(outDir, "tailwind.css"),
        tailwindCss,
        "utf-8",
      );
    } else if (twResult.error) {
      console.error(`Tailwind CSS compilation error: ${twResult.error}`);
    }
  }

  // ── Layer 1: Theme Settings Prompt ───────────────────
  if (prepResult.tailwindConfig) {
    let configObj: Record<string, unknown> | null = null;
    try {
      const configStr = prepResult.tailwindConfig
        .replace(/tailwind\.config\s*=\s*/, "")
        .trim();
      const jsonCompat = configStr.replace(/,(\s*[}\]])/g, "$1");
      configObj = JSON.parse(jsonCompat);
    } catch {
      console.warn("Could not parse tailwind.config for theme settings extraction");
    }

    if (configObj) {
      const promptPayload = generateThemeSettingsPrompt(configObj as any);
      writeFileSync(
        resolve(outDir, "theme-settings-prompt.json"),
        JSON.stringify(promptPayload, null, 2) + "\n",
        "utf-8",
      );
    }
  }

  // ── Layer 2: Global Styles JSON ──────────────────────
  if (tailwindCss) {
    const styles = generateGlobalStyles(tailwindCss);
    if (styles.length > 0) {
      writeFileSync(
        resolve(outDir, "global-styles.json"),
        JSON.stringify(styles, null, 2) + "\n",
        "utf-8",
      );
    }
  }

  return {
    pageName: input.pageName,
    blockHtml: html,
    report,
    globalStyles: globalStylesManifest as unknown as Record<string, unknown>,
    customCss: prepResult.customCss,
    tailwindCss,
  };
}
