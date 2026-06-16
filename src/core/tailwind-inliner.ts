// ── Tailwind CSS Compiler ──────────────────────────────
//
// Loads the HTML page in Playwright, waits for Tailwind CDN to
// compile, then extracts ALL <style> block contents (compiled
// Tailwind CSS + custom CSS) into a single CSS string.
//
// Does NOT convert, resolve, or modify any styles. Classes
// pass through to blocks as-is.

import { chromium, type Browser, type Page } from "playwright";
import { extractTailwindConfig } from "./tailwind-resolver.js";

// ── Detection ──────────────────────────────────────────

export function hasTailwindConfig(html: string): boolean {
  return /tailwind\.config\s*=\s*/.test(html);
}

export function hasTailwindClasses(html: string): boolean {
  return /class\s*=\s*"[^"]*(?:pt-\d+|pb-\d+|px-\d+|py-\d+|p-\d+|mt-\d+|mb-\d+|mx-\d+|my-\d+|m-\d+|w-(?:full|\d+\/|\[)|h-(?:full|\d+\/|\[)|flex|grid|inline-flex|relative|absolute|fixed|sticky|text-(?:xs|sm|base|lg|xl|\[)|font-(?:sans|serif|mono|display|script)|bg-\[|hover:|focus:|active:|group-|peer-|lg:|md:|sm:|xl:)/.test(html);
}

export function usesTailwind(html: string): boolean {
  return hasTailwindConfig(html) || hasTailwindClasses(html);
}

// ── Types ──────────────────────────────────────────────

export interface InlinerResult {
  html: string;
  stylesCss: string;
  classNames: string[];  // all class names found in the page
  warnings: string[];
}

// ── Main Entry Point ────────────────────────────────────

export async function inlineTailwindStyles(rawHtml: string): Promise<InlinerResult> {
  return compileWithPlaywright(rawHtml);
}

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Extract all unique class names from <body> tags across pages.
 * These classes would otherwise be invisible to the Tailwind CDN
 * since only body CONTENT (not the body tag itself) is compiled.
 */
export function extractBodyClasses(pageHtmls: string[]): string[] {
  const classSet = new Set<string>();
  for (const html of pageHtmls) {
    // Use word boundary + non-greedy match to ensure \sclass= is the real class attribute,
    // not a preceding attribute that happens to end in "class" (e.g. data-class="y")
    const bodyMatch = html.match(/<body\b(?:\s[^>]*?)?\sclass\s*=\s*"([^"]*)"[^>]*>/i);
    if (bodyMatch) {
      bodyMatch[1].split(/\s+/).filter(c => c.length > 0).forEach(c => classSet.add(c));
    }
  }
  return [...classSet];
}

/**
 * Extract all <link rel="stylesheet"> and <style> tags from the <head>
 * of an HTML document for inclusion in the CDN document.
 * If baseDir is provided, relative stylesheet hrefs are resolved and inlined.
 */
function extractHeadResources(html: string, baseDir?: string): string {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return "";

  const headContent = headMatch[1];
  const parts: string[] = [];

  // Extract <link rel="stylesheet"> tags and resolve relative paths
  const linkRegex = /<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*\/?>/gi;
  let match;
  while ((match = linkRegex.exec(headContent)) !== null) {
    const linkTag = match[0];
    const hrefMatch = linkTag.match(/href\s*=\s*["']([^"']+)["']/);
    if (hrefMatch && baseDir) {
      const href = hrefMatch[1];
      // Only resolve relative paths (not http://, https://, //)
      if (!/^(https?:\/\/|\/\/)/.test(href)) {
        const resolved = resolve(baseDir, href);
        if (existsSync(resolved)) {
          const css = readFileSync(resolved, "utf-8");
          parts.push(`<style>/* ${href} */\n${css}\n</style>`);
          continue;
        }
      }
    }
    // Fall back to including the link tag as-is (for absolute URLs)
    parts.push(linkTag);
  }

  // Extract <style> tags
  const styleRegex = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  while ((match = styleRegex.exec(headContent)) !== null) {
    parts.push(match[0]);
  }

  return parts.join("\n");
}

/**
 * Compile Tailwind CSS from multiple pages by concatenating body content
 * and loading in a headless browser with Tailwind CDN.
 * Includes original <link> stylesheets and <style> blocks from source heads
 * so Pattern 2 projects (external stylesheets) are fully captured.
 */
export async function inlineTailwindMultiPage(
  pageHtmls: string[],
  pageNames: string[],
  baseDir?: string,
  preExpandedConfig?: string,
): Promise<InlinerResult> {
  const warnings: string[] = [];

  // Extract body content and head resources from each page
  const bodyParts: string[] = [];
  const headResources: string[] = [];

  for (let i = 0; i < pageHtmls.length; i++) {
    const html = pageHtmls[i];
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    bodyParts.push(`<!-- page:${pageNames[i]} -->\n${body}`);
    headResources.push(extractHeadResources(html, baseDir));
  }

  const combinedBody = bodyParts.join("\n");

  // Deduplicate head resources across pages
  const uniqueHeadResources = [...new Set(headResources.filter(r => r))];
  const combinedHead = uniqueHeadResources.join("\n");

  // Use pre-expanded config if provided, otherwise extract from first page
  const configJson = preExpandedConfig || extractTailwindConfig(pageHtmls[0]) || "{}";

  // Inject hidden proxy div with all body classes so Tailwind CDN
  // compiles utilities like selection:bg-primary that only appear on <body>
  const bodyClasses = extractBodyClasses(pageHtmls);
  const proxyDiv = bodyClasses.length > 0
    ? `\n<div class="${bodyClasses.join(" ")}" style="display:none" data-gb-proxy></div>`
    : "";

  // Build CDN document with original head resources included
  const cdnDoc = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = ${configJson}</script>
${combinedHead}
</head><body>
${combinedBody}
${proxyDiv}
</body></html>`;

  return compileWithPlaywright(cdnDoc);
}

// ── Shared Playwright Compilation ──────────────────────

async function compileWithPlaywright(html: string): Promise<InlinerResult> {
  const warnings: string[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // ── Layer 1: Capture baseline inline <style> content BEFORE CDN loads ──
    await page.addInitScript(() => {
      (window as any).__gb_baselineCssLength = 0;
      const observer = new MutationObserver(() => {
        let total = 0;
        document.querySelectorAll("style").forEach((s) => {
          total += (s.textContent || "").length;
        });
        (window as any).__gb_baselineCssLength = total;
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // Capture initial state immediately
      let total = 0;
      document.querySelectorAll("style").forEach((s) => {
        total += (s.textContent || "").length;
      });
      (window as any).__gb_baselineCssLength = total;
    });

    // ── Layer 4: Inject hidden test element for orthogonal verification ──
    // Appended after CDN loads to prove it actually compiled AND applied rules

    await page.setContent(html, { waitUntil: "networkidle" });

    // Inject test element AFTER page load (so CDN sees it and compiles for it)
    await page.evaluate(() => {
      const testEl = document.createElement("div");
      testEl.id = "__gb_tailwind_test";
      testEl.className = "bg-red-500";
      testEl.style.cssText = "position:absolute;visibility:hidden;width:1px;height:1px;";
      document.body.appendChild(testEl);
    });

    // ── Layer 2: Poll until CSS stabilizes ──
    const POLL_INTERVAL_MS = 500;
    const STABILITY_WINDOW_MS = 500;
    const HARD_TIMEOUT_MS = 30000;

    let lastCssLength = 0;
    let stableSince = 0;
    const startTime = Date.now();
    let timedOut = false;

    while (true) {
      const currentLength = await page.evaluate(() => {
        let total = 0;
        document.querySelectorAll("style").forEach((s) => {
          total += (s.textContent || "").length;
        });
        return total;
      });

      if (currentLength !== lastCssLength) {
        stableSince = Date.now();
        lastCssLength = currentLength;
      }

      // Stable: no change for STABILITY_WINDOW_MS
      if (Date.now() - stableSince >= STABILITY_WINDOW_MS) {
        break;
      }

      // Hard timeout
      if (Date.now() - startTime >= HARD_TIMEOUT_MS) {
        timedOut = true;
        break;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // ── Layer 3: Two-signal verification ──
    const verification = await page.evaluate(() => {
      // Get baseline captured before CDN loaded
      const baseline = (window as any).__gb_baselineCssLength || 0;

      // Get current total inline <style> content
      let total = 0;
      let hasTailwindMarkers = false;
      document.querySelectorAll("style").forEach((s) => {
        const text = s.textContent || "";
        total += text.length;
        if (/\-\-tw-|@layer|\/\*!\s*tailwindcss/.test(text)) {
          hasTailwindMarkers = true;
        }
      });

      const growth = total - baseline;
      const growthPercent = baseline > 0 ? (growth / baseline) * 100 : (growth > 0 ? 100 : 0);

      // Check orthogonal signal: did bg-red-500 actually apply?
      const testEl = document.getElementById("__gb_tailwind_test");
      let testBgApplied = false;
      if (testEl) {
        const bg = window.getComputedStyle(testEl).backgroundColor;
        // Default transparent is "rgba(0, 0, 0, 0)" — anything else means CDN worked
        testBgApplied = bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      }

      return {
        baseline,
        total,
        growth,
        growthPercent: Math.round(growthPercent),
        hasTailwindMarkers,
        testBgApplied,
        passed: growth >= 200 && growthPercent >= 20 && hasTailwindMarkers && testBgApplied,
      };
    });

    if (timedOut || !verification.passed) {
      const reason = timedOut
        ? `CSS did not stabilize within ${HARD_TIMEOUT_MS / 1000}s`
        : [
            verification.growth < 200 ? `insufficient growth (${verification.growth} bytes, need ≥200)` : "",
            verification.growthPercent < 20 ? `insufficient growth % (${verification.growthPercent}%, need ≥20%)` : "",
            !verification.hasTailwindMarkers ? "no Tailwind markers (--tw-, @layer) found" : "",
            !verification.testBgApplied ? "bg-red-500 test element not styled by CDN" : "",
          ]
            .filter(Boolean)
            .join("; ");

      throw new Error(
        `Tailwind CDN compilation failed: ${reason}. ` +
        `Baseline CSS: ${verification.baseline}B, total: ${verification.total}B, growth: ${verification.growth}B (${verification.growthPercent}%). ` +
        `Check that the page has valid Tailwind classes and the CDN URL is reachable.`,
      );
    }

    if (verification.growth < 1000) {
      warnings.push(
        `Tailwind CDN compiled minimal CSS (${verification.growth}B growth). ` +
        `If the page uses few Tailwind classes this may be expected.`,
      );
    }

    // Extract all stylesheets: <style> blocks AND external <link> stylesheets
    const payload = await page.evaluate(() => {
      const cssParts: string[] = [];

      // 1. Capture <style> block contents (inline + CDN-compiled Tailwind)
      document.querySelectorAll("style").forEach((el) => {
        const text = el.textContent || "";
        if (text.trim()) cssParts.push(text);
      });

      // 2. Capture external stylesheet contents (Pattern 2: <link rel="stylesheet">)
      // document.styleSheets includes both <style> and <link> sheets
      for (let i = 0; i < document.styleSheets.length; i++) {
        try {
          const sheet = document.styleSheets[i];
          // Only capture <link> sheets (not <style> blocks, already captured above)
          if (sheet.ownerNode && (sheet.ownerNode as Element).tagName === "LINK") {
            const rules = sheet.cssRules || sheet.rules;
            if (rules) {
              const sheetCss: string[] = [];
              for (let j = 0; j < rules.length; j++) {
                sheetCss.push(rules[j].cssText);
              }
              if (sheetCss.length > 0) {
                cssParts.push(`/* external:${(sheet.href || "inline")} */\n` + sheetCss.join("\n"));
              }
            }
          }
        } catch {
          // Cross-origin stylesheets throw on cssRules access — skip silently
        }
      }

      // Collect all class names used on elements
      const classNames = new Set<string>();
      document.querySelectorAll("[class]").forEach((el) => {
        const cls = (el as Element).className;
        if (typeof cls === "string") {
          cls.split(/\s+/).filter((c: string) => c.length > 0).forEach((c: string) => classNames.add(c));
        }
      });

      return {
        css: cssParts.join("\n"),
        classNames: [...classNames],
      };
    });

    return {
      html,
      stylesCss: payload.css,
      classNames: payload.classNames,
      warnings,
    };
  } catch (err: any) {
    warnings.push(`Tailwind compiler failed: ${err.message}`);
    return { html, stylesCss: "", classNames: [], warnings };
  } finally {
    if (browser) await browser.close();
  }
}
