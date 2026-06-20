/**
 * Spike: pixel-diff original vs fallback vs processed using Playwright.
 * Renders all three as separate pages, screenshots at key viewports.
 * Usage: npx tsx spike-pixel-diff.ts
 */

import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

async function screenshotPage(
  browser: any,
  htmlPath: string,
  viewport: { name: string; width: number; height: number },
  label: string,
): Promise<string> {
  const page = await browser.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  const fileUrl = `file://${htmlPath}`;
  await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 30000 });

  // Wait for any Tailwind CDN to finish
  await page.waitForTimeout(2000);

  const outDir = path.resolve("output/mino/screenshots");
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = path.join(outDir, `${label}-${viewport.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.close();
  return screenshotPath;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // Render the original
  const originalPath = path.resolve("inputs/mino/index.html");
  if (!fs.existsSync(originalPath)) {
    console.error(`Original not found: ${originalPath}`);
    await browser.close();
    return;
  }

  // Render fallback — needs styles.css served alongside
  // Problem: file:// doesn't load relative CSS for pages in subdirectories.
  // We'll need to serve via http. Let's use a quick trick.
  const fallbackDir = path.resolve("output/mino/fallback/pages");
  const processedDir = path.resolve("output/mino/processed/pages");

  console.log("=== Rendering pages ===");

  for (const vp of VIEWPORTS) {
    console.log(`\nViewport: ${vp.name} (${vp.width}x${vp.height})`);

    // 1. Original (CDN Tailwind — live)
    const origPng = await screenshotPage(
      browser,
      originalPath,
      vp,
      "original",
    );
    console.log(`  Original: ${origPng}`);

    // 2. Fallback — use the styles.css from the fallback dir
    // We need to serve fallback pages with styles.css.
    // Quick approach: read the page HTML, inject the CSS inline.
    const fbPagePath = path.join(fallbackDir, "index.html");
    if (fs.existsSync(fbPagePath)) {
      const fbHtml = fs.readFileSync(fbPagePath, "utf-8");
      const stylesCssPath = path.resolve("output/mino/fallback/styles.css");
      const stylesCss = fs.existsSync(stylesCssPath)
        ? fs.readFileSync(stylesCssPath, "utf-8")
        : "";

      // Inject styles.css inline into fallback page head
      const fbWithCss = fbHtml.replace(
        "</head>",
        `<style>${stylesCss}</style></head>`,
      );

      const fbTmpPath = `/tmp/fb-${vp.name}.html`;
      fs.writeFileSync(fbTmpPath, fbWithCss);

      const fbPng = await screenshotPage(browser, fbTmpPath, vp, "fallback");
      console.log(`  Fallback: ${fbPng}`);
    }

    // 3. Processed
    const prPagePath = path.join(processedDir, "index.html");
    if (fs.existsSync(prPagePath)) {
      const prHtml = fs.readFileSync(prPagePath, "utf-8");
      // Inject only the split CSS (tailwind-utilities.css) — NOT styles.css
      // The processed output should work without styles.css
      const setupDir = path.resolve("output/mino/processed/setup");
      const twCssPath = path.join(setupDir, "tailwind-utilities.css");
      let setupCss = "";

      if (fs.existsSync(twCssPath)) {
        setupCss += fs.readFileSync(twCssPath, "utf-8");
      }

      const prWithCss = prHtml.replace(
        "</head>",
        `<style>${setupCss}</style></head>`,
      );

      const prTmpPath = `/tmp/pr-${vp.name}.html`;
      fs.writeFileSync(prTmpPath, prWithCss);

      const prPng = await screenshotPage(browser, prTmpPath, vp, "processed");
      console.log(`  Processed: ${prPng}`);
    }
  }

  await browser.close();

  // File size comparison
  console.log("\n=== Screenshot sizes (bytes) ===");
  const scrDir = path.resolve("output/mino/screenshots");
  for (const vp of VIEWPORTS) {
    const origFile = path.join(scrDir, `original-${vp.name}.png`);
    const fbFile = path.join(scrDir, `fallback-${vp.name}.png`);
    const prFile = path.join(scrDir, `processed-${vp.name}.png`);

    if (fs.existsSync(origFile) && fs.existsSync(fbFile)) {
      const origSize = fs.statSync(origFile).size;
      const fbSize = fs.statSync(fbFile).size;
      const percentDiff = ((fbSize - origSize) / origSize * 100).toFixed(1);
      console.log(
        `  ${vp.name}: original=${(origSize/1024).toFixed(0)}KB, fallback=${(fbSize/1024).toFixed(0)}KB (${percentDiff}% diff)`,
      );
    }
    if (fs.existsSync(fbFile) && fs.existsSync(prFile)) {
      const fbSize = fs.statSync(fbFile).size;
      const prSize = fs.statSync(prFile).size;
      const percentDiff = ((prSize - fbSize) / fbSize * 100).toFixed(1);
      console.log(
        `  ${vp.name}: fallback=${(fbSize/1024).toFixed(0)}KB, processed=${(prSize/1024).toFixed(0)}KB (${percentDiff}% diff)`,
      );
    }
  }

  console.log("\nDone. Open the PNGs in output/mino/screenshots/ to compare.");
}

main().catch(console.error);
