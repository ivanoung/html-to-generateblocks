/**
 * Spike: screenshot the live WordPress site and compare against our processed output.
 * Usage: npx tsx spike-live-compare.ts
 */

import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const LIVE_URL = "https://minodigital-2tcd.1wp.site/";

const VIEWPORT = { name: "desktop", width: 1440, height: 900 };

async function main() {
  const browser = await chromium.launch({ headless: true });
  const outDir = path.resolve("output/mino/screenshots");

  // 1. Screenshot the live WordPress site
  console.log("1. Screenshotting live WordPress site...");
  const livePage = await browser.newPage();
  await livePage.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await livePage.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await livePage.waitForTimeout(3000);
  const liveHtml = await livePage.content();
  fs.writeFileSync(path.join(outDir, "live-wordpress.html"), liveHtml);
  await livePage.screenshot({ path: path.join(outDir, "live-wordpress.png"), fullPage: true });

  // 2. Also screenshot the original (inputs/mino/index.html) 
  console.log("2. Screenshotting original CDN version...");
  const origPage = await browser.newPage();
  await origPage.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await origPage.goto(`file://${path.resolve("inputs/mino/index.html")}`, { waitUntil: "networkidle", timeout: 30000 });
  await origPage.waitForTimeout(3000);
  await origPage.screenshot({ path: path.join(outDir, "original-cdn.png"), fullPage: true });

  // 3. Screenshot our processed output
  console.log("3. Screenshotting processed output...");
  const prHtml = fs.readFileSync(path.resolve("output/mino/processed/pages/index.html"), "utf-8");
  const twCss = fs.existsSync(path.resolve("output/mino/processed/setup/tailwind-utilities.css"))
    ? fs.readFileSync(path.resolve("output/mino/processed/setup/tailwind-utilities.css"), "utf-8") : "";
  const prWithCss = prHtml.replace("</head>", `<style>${twCss}</style></head>`);
  const prTmpPath = `/tmp/pr-live-compare.html`;
  fs.writeFileSync(prTmpPath, prWithCss);
  const prPage = await browser.newPage();
  await prPage.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await prPage.goto(`file://${prTmpPath}`, { waitUntil: "networkidle", timeout: 30000 });
  await prPage.waitForTimeout(2000);
  await prPage.screenshot({ path: path.join(outDir, "processed-live-compare.png"), fullPage: true });

  await browser.close();

  // 4. Extract class-level differences from the live WordPress HTML
  console.log("\n4. Analyzing class differences...");
  const liveClasses = new Set(liveHtml.match(/class="([^"]*)"/g) || []);
  const origHtml = fs.readFileSync(path.resolve("inputs/mino/index.html"), "utf-8");
  const origClasses = new Set(origHtml.match(/class="([^"]*)"/g) || []);

  // GB generates unique class names like gb-element-elem001
  const gbGenerated = [...liveClasses].filter(c => c.includes("gb-element") || c.includes("gb-text") || c.includes("gb-media"));
  const gbTailwind = [...liveClasses].filter(c => !c.includes("gb-") && !c.includes("wp-block"));

  console.log(`Live site: ${liveClasses.size} unique class attributes`);
  console.log(`  GB-generated classes: ${gbGenerated.length}`);
  console.log(`  Tailwind/utility classes: ${gbTailwind.length}`);
  console.log(`  GB-generated examples: ${gbGenerated.slice(0, 5)}`);
  console.log(`  TW/utility examples: ${gbTailwind.slice(0, 5)}`);

  // Check: does the live GB site have styles on elements?
  const inlineStyles = (liveHtml.match(/style="([^"]*)"/g) || []);
  console.log(`  Inline style attributes: ${inlineStyles.length}`);

  // 5. File sizes
  console.log("\n=== Screenshot sizes ===");
  for (const f of ["live-wordpress.png", "original-cdn.png", "processed-live-compare.png"]) {
    const fp = path.join(outDir, f);
    if (fs.existsSync(fp)) console.log(`  ${f}: ${(fs.statSync(fp).size/1024).toFixed(0)}KB`);
  }

  console.log("\nDone. Compare screenshots in output/mino/screenshots/");
}

main().catch(console.error);
