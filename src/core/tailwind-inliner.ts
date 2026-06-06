// ── Tailwind CSS Compiler ──────────────────────────────
//
// Loads the HTML page in Playwright, waits for Tailwind CDN to
// compile, then extracts ALL <style> block contents (compiled
// Tailwind CSS + custom CSS) into a single CSS string.
//
// Does NOT convert, resolve, or modify any styles. Classes
// pass through to blocks as-is.

import { chromium, type Browser, type Page } from "playwright";

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
  const warnings: string[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.setContent(rawHtml, { waitUntil: "networkidle" });

    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector(".pt-32, [class*='pt-32']");
          if (!el || !(el instanceof HTMLElement)) return false;
          return window.getComputedStyle(el).paddingTop !== "0px";
        },
        { timeout: 10000 },
      );
    } catch {
      warnings.push("Tailwind CDN did not compile within timeout");
    }

    // Extract all <style> block contents (compiled Tailwind + custom CSS)
    const payload = await page.evaluate(() => {
      const cssParts: string[] = [];
      document.querySelectorAll("style").forEach((el) => {
        const text = el.textContent || "";
        if (text.trim()) cssParts.push(text);
      });

      // Collect all class names used on elements
      const classNames = new Set<string>();
      document.querySelectorAll("[class]").forEach((el) => {
        const cls = (el as Element).className;
        if (typeof cls === "string") {
          cls.split(/\s+/).filter(c => c.length > 0).forEach(c => classNames.add(c));
        }
      });

      return {
        css: cssParts.join("\n"),
        classNames: [...classNames],
      };
    });

    return {
      html: rawHtml,  // Return original HTML unchanged
      stylesCss: payload.css,
      classNames: payload.classNames,
      warnings,
    };
  } catch (err: any) {
    warnings.push(`Tailwind compiler failed: ${err.message}`);
    return { html: rawHtml, stylesCss: "", classNames: [], warnings };
  } finally {
    if (browser) await browser.close();
  }
}
