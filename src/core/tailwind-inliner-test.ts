// ── Tailwind Inliner PoC Test ───────────────────────────────
//
// Proves the headless browser approach:
//   1. Load Mino HTML with Tailwind classes
//   2. Extract computed styles → plain inline CSS
//   3. Compare visual fidelity: original = resolved
//
// Run: npx tsx src/core/tailwind-inliner-test.ts

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const INPUT = resolve(process.cwd(), "inputs/mino/index.html");
const OUTPUT = resolve(process.cwd(), "output/mino/index-inlined-test.html");

async function main() {
  const rawHtml = readFileSync(INPUT, "utf-8");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Load the HTML
  await page.setContent(rawHtml, { waitUntil: "networkidle" });
  // Give Tailwind CDN time to compile and apply
  await page.waitForTimeout(2000);

  // ── Test 1: Extract computed styles from key elements ──────

  // Hero heading — has Tailwind classes: font-display font-semibold text-5xl md:text-7xl lg:text-8xl ...
  const heroHeading = await page.$("#hero-heading");
  if (heroHeading) {
    const styles = await heroHeading.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontSize: cs.fontSize,
        color: cs.color,
        lineHeight: cs.lineHeight,
        textTransform: cs.textTransform,
        letterSpacing: cs.letterSpacing,
        marginBottom: cs.marginBottom,
      };
    });
    console.log("\n=== Hero Heading (1440px viewport) ===");
    console.log(JSON.stringify(styles, null, 2));
  }

  // "Initialize Build" CTA button — has bg-primary text-surface etc.
  const ctaBtn = await page.$("#hero-primary-cta");
  if (ctaBtn) {
    const styles = await ctaBtn.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        textTransform: cs.textTransform,
        padding: cs.padding,
        width: cs.width,
        height: cs.height,
      };
    });
    console.log("\n=== CTA Button ===");
    console.log(JSON.stringify(styles, null, 2));
  }

  // Dropdown mega menu element (has group-hover/dropdown:opacity-100 etc.)
  const dropdown = await page.$(".group\\/dropdown .opacity-0.invisible");
  if (dropdown) {
    const styles = await dropdown.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        opacity: cs.opacity,
        visibility: cs.visibility,
        transform: cs.transform,
        position: cs.position,
      };
    });
    console.log("\n=== Dropdown (not hovered — should be hidden) ===");
    console.log(JSON.stringify(styles, null, 2));

    // Now hover the parent to test group-hover resolution
    const parentGroup = await page.$(".group\\/dropdown");
    if (parentGroup) {
      await parentGroup.hover();
      await page.waitForTimeout(300); // transition duration

      const hoveredStyles = await dropdown.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return {
          opacity: cs.opacity,
          visibility: cs.visibility,
          transform: cs.transform,
        };
      });
      console.log("\n=== Dropdown (hovered — Tailwind says opacity:1, visible, translate-y-0) ===");
      console.log(JSON.stringify(hoveredStyles, null, 2));
    }
  }

  // ── Test 2: Responsive breakpoints ─────────────────────────

  // Resize to mobile
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);

  const heroHeadingMobile = await page.$("#hero-heading");
  if (heroHeadingMobile) {
    const styles = await heroHeadingMobile.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    });
    console.log("\n=== Hero Heading (375px mobile viewport) ===");
    console.log(JSON.stringify(styles, null, 2));
  }

  // ── Test 3: Full-page inline style extraction ──────────────

  // Go back to desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // Extract computed styles for ALL visual elements and inject as inline styles
  const inlinedHtml = await page.evaluate(() => {
    const allElements = document.body.querySelectorAll("*");
    let count = 0;

    for (const el of allElements) {
      if (!(el instanceof HTMLElement)) continue;

      const cs = window.getComputedStyle(el);
      const cssText = cs.cssText;

      // Skip elements with no meaningful styles
      if (!cssText || cssText.length < 10) continue;

      // Merge with existing style attribute
      const existing = el.getAttribute("style") || "";
      el.setAttribute("style", cssText + (existing ? ";" + existing : ""));
      count++;
    }

    // Remove <script> and <link> tags
    document.querySelectorAll("script, link").forEach((el) => el.remove());

    // Remove Tailwind classes (keep only non-Tailwind classes)
    const twClassRegex = /^(sr-only|static|fixed|absolute|relative|sticky|isolate|inline|block|inline-block|flex|inline-flex|grid|inline-grid|hidden|contents|table|table-caption|table-cell|table-column|table-column-group|table-footer-group|table-header-group|table-row|table-row-group|flow-root|overflow|overflow-x|overflow-y|truncate|uppercase|lowercase|capitalize|normal-case|italic|not-italic|underline|line-through|no-underline|antialiased|subpixel-antialiased|select|bg-|text-|font-|tracking-|leading-|list-|placeholder-|opacity-|shadow-|outline-|ring-|ring-offset-|border-|rounded-|divide-|space-|gap-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|w-|min-w-|max-w-|h-|min-h-|max-h-|flex-|grow|shrink|basis-|order-|col-|row-|grid-|auto-|justify-|content-|items-|self-|place-|inset-|top-|right-|bottom-|left-|z-|float-|clear-|object-|overflow-|overscroll-|box-|whitespace-|break-|align-|text-|decoration-|indent-|align-|whitespace-|break-|transition-|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|transform|snap-|scroll-|touch-|cursor-|pointer-|resize-|appearance|columns-|auto-cols-|auto-rows-|aspect-|backdrop-|will-change-|content-|forced-|sr-|contrast-|hue-rotate-|invert|saturate-|sepia-|drop-shadow-|grayscale-|blur-|brightness-|backdrop-|mix-|bg-blend-|from-|via-|to-|shadow-|decoration-|accent-|caret-|stroke-|fill-|divide-|outline-|ring-|ring-offset|group|hover:|focus:|active:|disabled:|visited:|first:|last:|odd:|even:|group-|peer-|motion-|dark:|lg:|md:|sm:|xl:|2xl:|min-|max-)/;

    document.querySelectorAll("[class]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const classes = el.className.split(/\s+/).filter((c) => c.length > 0);
      const kept = classes.filter((c) => !twClassRegex.test(c));
      if (kept.length > 0) {
        el.setAttribute("class", kept.join(" "));
      } else {
        el.removeAttribute("class");
      }
    });

    return { html: document.documentElement.outerHTML, elementCount: count };
  });

  console.log(`\n=== Full-Page Inlining ===`);
  console.log(`  Elements styled: ${inlinedHtml.elementCount}`);

  // Write the output
  writeFileSync(OUTPUT, inlinedHtml.html, "utf-8");
  console.log(`  Output: ${OUTPUT}`);

  // ── Test 4: Verify fidelity — screenshot comparison ────────

  // Take screenshots of both original and inlined versions
  const originalPage = await context.newPage();
  await originalPage.setContent(rawHtml, { waitUntil: "networkidle" });
  await originalPage.waitForTimeout(2000);
  await originalPage.screenshot({
    path: resolve(process.cwd(), "output/mino/original-screenshot.png"),
    fullPage: true,
  });
  console.log(`  Screenshot (original): output/mino/original-screenshot.png`);

  // Now load the inlined version and screenshot
  const inlinedPage = await context.newPage();
  // For the inlined version, we need to load it without Tailwind CDN
  // Strip the CDN references first
  const inlinedNoTw = inlinedHtml.html
    .replace(/<script[^>]*tailwindcss[^<]*<\/script>/gi, "")
    .replace(/<link[^>]*>/gi, "");
  await inlinedPage.setContent(inlinedNoTw, { waitUntil: "load" });
  await inlinedPage.waitForTimeout(500);
  await inlinedPage.screenshot({
    path: resolve(process.cwd(), "output/mino/inlined-screenshot.png"),
    fullPage: true,
  });
  console.log(`  Screenshot (inlined): output/mino/inlined-screenshot.png`);

  console.log("\n✅ PoC complete. Compare the two screenshots.");

  await browser.close();
}

main().catch((err) => {
  console.error("PoC failed:", err);
  process.exit(1);
});
