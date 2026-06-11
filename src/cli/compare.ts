import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { captureFullPage } from "../core/screenshotter.js";
import { renderStandalone } from "../core/renderer.js";
import { compareImages } from "../core/pixel-differ.js";
import type { ScreenshotResult } from "../core/screenshotter.js";

export interface CompareOptions {
  sourcePath: string;
  outputDir: string;
  viewport?: { width: number; height: number };
  waitMs?: number;
  threshold?: number;
  golden?: boolean;
}

export interface CompareReport {
  page: string;
  timestamp: string;
  iteration: number;
  source: {
    file: string;
    viewport: { width: number; height: number };
    dimensions: { width: number; height: number };
    status: string;
    error?: string;
  };
  rendered: {
    file: string;
    dimensions: { width: number; height: number };
    status: string;
    error?: string;
    warnings?: Array<{ code: string; url: string; count: number }>;
  };
  diff: {
    mismatchPct: number;
    mismatchPixels: number;
    totalPixels: number;
    threshold: number;
    band: string;
  } | null;
  errors: Array<{ code: string; message: string }>;
}

export async function runCompare(opts: CompareOptions): Promise<void> {
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  const verifyDir = resolve(opts.outputDir, "verify");
  mkdirSync(verifyDir, { recursive: true });

  const sourceHtml = readFileSync(opts.sourcePath, "utf-8");
  const pageName = basename(opts.sourcePath, extname(opts.sourcePath));

  const errors: Array<{ code: string; message: string }> = [];
  const report: CompareReport = {
    page: pageName,
    timestamp: new Date().toISOString(),
    iteration: 1,
    source: {
      file: opts.sourcePath,
      viewport: { ...viewport },
      dimensions: { width: 0, height: 0 },
      status: "pending",
    },
    rendered: {
      file: "",
      dimensions: { width: 0, height: 0 },
      status: "pending",
    },
    diff: null,
    errors: [],
  };

  // Golden mode: compare against saved golden screenshot
  if (opts.golden) {
    const goldenSource = resolve(verifyDir, "golden-source.png");
    const goldenRendered = resolve(verifyDir, "golden-rendered.png");

    if (!existsSync(goldenSource) || !existsSync(goldenRendered)) {
      // First run: save golden files and exit
      console.log("No golden files found. Saving current screenshots as golden...");
      await captureFullPage(opts.sourcePath, goldenSource, { width: viewport.width, height: viewport.height, waitMs: opts.waitMs });
      // Render and screenshot
      const renderedPath = resolve(opts.outputDir, "pages", `${pageName}.rendered.html`);
      const renderedHtml = renderStandalone(opts.outputDir, pageName, sourceHtml, false);
      writeFileSync(renderedPath, renderedHtml, "utf-8");
      await captureFullPage(renderedPath, goldenRendered, { width: viewport.width, height: viewport.height, waitMs: opts.waitMs });
      console.log(`Golden files saved to ${verifyDir}/`);
      return;
    }

    // Compare current screenshots against golden
    const currentSource = resolve(verifyDir, "current-source.png");
    const currentRendered = resolve(verifyDir, "current-rendered.png");
    await captureFullPage(opts.sourcePath, currentSource, { width: viewport.width, height: viewport.height, waitMs: opts.waitMs });

    const renderedPath = resolve(opts.outputDir, "pages", `${pageName}.rendered.html`);
    const renderedHtml = renderStandalone(opts.outputDir, pageName, sourceHtml, false);
    writeFileSync(renderedPath, renderedHtml, "utf-8");
    await captureFullPage(renderedPath, currentRendered, { width: viewport.width, height: viewport.height, waitMs: opts.waitMs });

    const diffOutPath = resolve(verifyDir, "golden-diff.png");
    const result = await compareImages(goldenRendered, currentRendered, diffOutPath, { threshold: opts.threshold });
    if (result.band === "pass") {
      console.log(`Golden check: PASS (${result.mismatchPct}% mismatch)`);
    } else {
      console.error(`Golden check: FAIL — ${result.mismatchPct}% mismatch (threshold: ${opts.threshold ?? 0.1})`);
      process.exitCode = 1;
    }
    return;
  }

  // Step 1: Screenshot source
  const sourceOutPath = resolve(verifyDir, "source.png");
  const sourceResult: ScreenshotResult = await captureFullPage(opts.sourcePath, sourceOutPath, {
    width: viewport.width,
    height: viewport.height,
    waitMs: opts.waitMs,
  });

  report.source.status = sourceResult.status;
  report.source.dimensions = { width: sourceResult.width, height: sourceResult.height };
  if (sourceResult.error) {
    errors.push({ code: "SOURCE_SCREENSHOT_FAILED", message: sourceResult.error });
  }

  // Step 2: Render GB output
  const renderedPath = resolve(opts.outputDir, "pages", `${pageName}.rendered.html`);
  try {
    const renderedHtml = renderStandalone(opts.outputDir, pageName, sourceHtml, false);
    writeFileSync(renderedPath, renderedHtml, "utf-8");
    report.rendered.file = renderedPath;
  } catch (err) {
    errors.push({
      code: "RENDER_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
    report.rendered.status = "error";
    report.rendered.error = err instanceof Error ? err.message : String(err);
  }

  // Step 3: Screenshot rendered output
  if (report.rendered.status !== "error") {
    const renderedOutPath = resolve(verifyDir, "rendered.png");
    const renderedResult = await captureFullPage(renderedPath, renderedOutPath, {
      width: viewport.width,
      height: viewport.height,
      waitMs: opts.waitMs,
    });

    report.rendered.status = renderedResult.status;
    report.rendered.dimensions = { width: renderedResult.width, height: renderedResult.height };
    report.rendered.warnings = renderedResult.warnings;

    if (renderedResult.error) {
      errors.push({ code: "RENDERED_SCREENSHOT_FAILED", message: renderedResult.error });
    }

    // Step 4: Diff
    if (sourceResult.status === "ok" && renderedResult.status === "ok") {
      const diffOutPath = resolve(verifyDir, "diff.png");
      const diffResult = await compareImages(sourceOutPath, renderedOutPath, diffOutPath, {
        threshold: opts.threshold,
      });
      report.diff = {
        mismatchPct: diffResult.mismatchPct,
        mismatchPixels: diffResult.mismatchPixels,
        totalPixels: diffResult.totalPixels,
        threshold: diffResult.threshold,
        band: diffResult.band,
      };
    }
  }

  report.errors = errors;

  // Write report
  const reportPath = resolve(verifyDir, "compare-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

  console.log(`Compare complete: ${verifyDir}/`);
  if (report.diff) {
    console.log(`  Mismatch: ${report.diff.mismatchPct}% (${report.diff.band})`);
  }
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
    for (const e of errors) {
      console.log(`    [${e.code}] ${e.message}`);
    }
  }
}
