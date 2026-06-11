// ── Screenshotter ─────────────────────────────────────────────
//
// Takes full-page screenshots of HTML pages using Playwright.
// Handles wait strategy, scrollbar normalization, and error reporting.

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

export interface ScreenshotResult {
  width: number;
  height: number;
  status: "ok" | "error";
  error?: string;
  warnings?: Array<{ code: string; url: string; count: number }>;
}

export interface ScreenshotOptions {
  width: number;
  height: number;
  waitMs?: number;
}

/**
 * Capture a full-page screenshot of an HTML file.
 *
 * Wait strategy:
 * 1. networkidle (built-in)
 * 2. document.fonts.ready
 * 3. All <img> loaded
 * 4. Extra settle timeout (default 500ms)
 *
 * Injects overflow-y: scroll on <html> to normalize scrollbar presence.
 */
export async function captureFullPage(
  htmlPath: string,
  outputPath: string,
  options: ScreenshotOptions,
): Promise<ScreenshotResult> {
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    const page: Page = await context.newPage();

    // Track 404 images
    const image404s: Array<{ url: string }> = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "image" && response.status() === 404) {
        image404s.push({ url: response.url() });
      }
    });

    // Load the page
    const fileUrl = `file://${htmlPath}`;
    await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for fonts
    await page.evaluate(() => document.fonts.ready);

    // Wait for all images to load
    await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve(); // resolve even on error
              }
            }),
        ),
      );
    });

    // Inject scrollbar normalization
    await page.addStyleTag({ content: "html { overflow-y: scroll !important; }" });

    // Settle timeout
    const settleMs = options.waitMs ?? 500;
    await page.waitForTimeout(settleMs);

    // Capture full-page screenshot
    await page.screenshot({ path: outputPath, fullPage: true });

    const viewportSize = page.viewportSize();
    const warnings = image404s.length > 0
      ? [{ code: "IMAGE_404", url: image404s.map(i => i.url).join(", "), count: image404s.length }]
      : undefined;

    await context.close();

    return {
      width: viewportSize?.width ?? options.width,
      height: viewportSize?.height ?? options.height,
      status: "ok",
      warnings,
    };
  } catch (err) {
    return {
      width: 0,
      height: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) await browser.close();
  }
}
