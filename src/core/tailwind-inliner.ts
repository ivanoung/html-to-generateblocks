// ── Tailwind Inliner ──────────────────────────────────────
//
// Loads HTML in Playwright, extracts computed styles for every
// element, and injects them as inline style attributes. Produces
// Tailwind-free HTML ready for the GB converter pipeline.

/** Check if the HTML contains an inline Tailwind config script. */
export function hasTailwindConfig(html: string): boolean {
  return /tailwind\.config\s*=\s*/.test(html);
}

/** Check if the HTML uses Tailwind utility classes in class attributes. */
export function hasTailwindClasses(html: string): boolean {
  return /class\s*=\s*"[^"]*(?:pt-\d+|pb-\d+|px-\d+|py-\d+|p-\d+|mt-\d+|mb-\d+|mx-\d+|my-\d+|m-\d+|w-(?:full|\d+\/|\[)|h-(?:full|\d+\/|\[)|flex|grid|inline-flex|relative|absolute|fixed|sticky|text-(?:xs|sm|base|lg|xl|\[)|font-(?:sans|serif|mono|display|script)|bg-\[|hover:|focus:|active:|group-|peer-|lg:|md:|sm:|xl:)/.test(html);
}

export function usesTailwind(html: string): boolean {
  return hasTailwindConfig(html) || hasTailwindClasses(html);
}

// ── Inliner ────────────────────────────────────────────

import { chromium, type Browser } from "playwright";

export interface InlinerResult {
  html: string;
  elementCount: number;
  warnings: string[];
}

const TAILWIND_CLASS_REGEX =
  /^(?:sr-only|static|fixed|absolute|relative|sticky|isolate|inline|block|inline-block|flex|inline-flex|grid|inline-grid|hidden|contents|table|table-caption|table-cell|table-column|table-column-group|table-footer-group|table-header-group|table-row|table-row-group|flow-root|overflow|overflow-x|overflow-y|truncate|uppercase|lowercase|capitalize|normal-case|italic|not-italic|underline|line-through|no-underline|antialiased|subpixel-antialiased|select-all|select-auto|select-none|select-text|border|bg-|text-|font-|tracking-|leading-|list-|placeholder-|opacity-|shadow-|outline-|ring-|ring-offset-|border-|rounded-|divide-|space-|gap-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|w-|min-w-|max-w-|h-|min-h-|max-h-|flex-|grow|shrink|basis-|order-|col-|row-|grid-|auto-|justify-|content-|items-|self-|place-|inset-|top-|right-|bottom-|left-|z-|float-|clear-|object-|overflow-|overscroll-|box-|whitespace-|break-|align-|text-|decoration-|indent-|align-|whitespace-|break-|transition-|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|transform|snap-|scroll-|touch-|cursor-|pointer-|resize-|appearance|columns-|auto-cols-|auto-rows-|aspect-|backdrop-|will-change-|content-|forced-|sr-|contrast-|hue-rotate-|invert|saturate-|sepia-|drop-shadow-|grayscale-|blur-|brightness-|backdrop-|mix-|bg-blend-|from-|via-|to-|shadow-|decoration-|accent-|caret-|stroke-|fill-|divide-|outline-|ring-|ring-offset|group|hover:|focus:|active:|disabled:|visited:|first:|last:|odd:|even:|group-|peer-|motion-|dark:|lg:|md:|sm:|xl:|2xl:|min-|max-|-translate-|-skew-|-scale-|-rotate-|-mx-|-my-|-mt-|-mr-|-mb-|-ml-|-px-|-py-|-pt-|-pr-|-pb-|-pl-|data-|aria-)/;

function isTailwindClass(className: string): boolean {
  return TAILWIND_CLASS_REGEX.test(className);
}

export async function inlineTailwindStyles(
  rawHtml: string,
): Promise<InlinerResult> {
  const warnings: string[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // Capture browser console for debugging
    page.on("console", (msg) => {
      if (msg.text().startsWith("[INLINER]")) {
        console.log(msg.text());
      }
    });

    // Load the page and wait for Tailwind CDN to compile
    await page.setContent(rawHtml, { waitUntil: "networkidle" });
    // Wait for Tailwind CDN to apply styles — poll for a known class
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

    // Extract computed styles and inject as inline styles
    const inlinedHtml = await page.evaluate(() => {
      const allElements = document.body.querySelectorAll("*");
      let count = 0;

      for (const el of allElements) {
        if (!(el instanceof HTMLElement)) continue;

        const cs = window.getComputedStyle(el);
        // computedStyle.cssText is empty in Chromium — build manually
        const parts: string[] = [];
        for (let i = 0; i < cs.length; i++) {
          const prop = cs[i];
          // Skip browser-internal and non-standard properties
          if (prop.startsWith("-webkit-") ||
              prop.startsWith("-internal-") ||
              prop.startsWith("view-transition-") ||
              prop.startsWith("--tw-") ||
              prop === "zoom" ||
              prop === "-webkit-locale" ||
              prop === "app-region" ||
              prop === "border-shape" ||
              prop === "corner-bottom-left-shape" ||
              prop === "corner-bottom-right-shape" ||
              prop === "corner-end-end-shape" ||
              prop === "corner-end-start-shape" ||
              prop === "corner-start-end-shape" ||
              prop === "corner-start-start-shape" ||
              prop === "corner-top-left-shape" ||
              prop === "corner-top-right-shape" ||
              prop === "contain-intrinsic-block-size" ||
              prop === "contain-intrinsic-height" ||
              prop === "contain-intrinsic-inline-size" ||
              prop === "contain-intrinsic-size" ||
              prop === "contain-intrinsic-width" ||
              prop === "dynamic-range-limit" ||
              prop === "field-sizing" ||
              prop === "initial-letter" ||
              prop === "interactivity" ||
              prop === "interest-delay-end" ||
              prop === "interest-delay-start" ||
              prop === "interpolate-size" ||
              prop === "object-view-box" ||
              prop === "overlay" ||
              prop === "position-anchor" ||
              prop === "position-area" ||
              prop === "position-try-fallbacks" ||
              prop === "position-try-order" ||
              prop === "position-visibility" ||
              prop === "ruby-align" ||
              prop === "ruby-position" ||
              prop === "scroll-initial-target" ||
              prop === "scroll-marker-group" ||
              prop === "scroll-target-group" ||
              prop === "text-autospace" ||
              prop === "text-box-edge" ||
              prop === "text-box-trim" ||
              prop === "text-spacing-trim" ||
              prop === "text-wrap-mode" ||
              prop === "text-wrap-style" ||
              prop === "timeline-scope" ||
              prop === "timeline-trigger-activation-range-end" ||
              prop === "timeline-trigger-activation-range-start" ||
              prop === "timeline-trigger-active-range-end" ||
              prop === "timeline-trigger-active-range-start" ||
              prop === "timeline-trigger-name" ||
              prop === "timeline-trigger-source" ||
              prop === "trigger-scope" ||
              prop === "view-timeline-axis" ||
              prop === "view-timeline-inset" ||
              prop === "view-timeline-name" ||
              prop === "buffered-rendering" ||
              prop === "color-interpolation-filters" ||
              prop === "cx" ||
              prop === "cy" ||
              prop === "d" ||
              prop === "r" ||
              prop === "rx" ||
              prop === "ry" ||
              prop === "x" ||
              prop === "y" ||
              prop === "math-depth" ||
              prop === "math-shift" ||
              prop === "math-style" ||
              prop === "reading-flow" ||
              prop === "reading-order" ||
              prop === "font-feature-settings" ||
              prop === "font-kerning" ||
              prop === "font-language-override" ||
              prop === "font-optical-sizing" ||
              prop === "font-palette" ||
              prop === "font-size-adjust" ||
              prop === "font-stretch" ||
              prop === "font-synthesis-small-caps" ||
              prop === "font-synthesis-style" ||
              prop === "font-synthesis-weight" ||
              prop === "font-variant-alternates" ||
              prop === "font-variant-caps" ||
              prop === "font-variant-east-asian" ||
              prop === "font-variant-emoji" ||
              prop === "font-variant-ligatures" ||
              prop === "font-variant-numeric" ||
              prop === "font-variant-position" ||
              prop === "font-variation-settings" ||
              prop === "hyphenate-character" ||
              prop === "hyphenate-limit-chars" ||
              prop === "print-color-adjust" ||
              prop === "text-size-adjust" ||
              prop === "offset-anchor" ||
              prop === "offset-distance" ||
              prop === "offset-path" ||
              prop === "offset-position" ||
              prop === "offset-rotate" ||
              prop === "scroll-timeline-axis" ||
              prop === "scroll-timeline-name" ||
              prop === "speak" ||
              prop === "dominant-baseline" ||
              prop === "alignment-baseline" ||
              prop === "baseline-shift" ||
              prop === "baseline-source" ||
              prop === "clip-rule" ||
              prop === "color-interpolation" ||
              prop === "color-rendering" ||
              prop === "fill-opacity" ||
              prop === "fill-rule" ||
              prop === "flood-color" ||
              prop === "flood-opacity" ||
              prop === "lighting-color" ||
              prop === "marker-end" ||
              prop === "marker-mid" ||
              prop === "marker-start" ||
              prop === "mask-type" ||
              prop === "paint-order" ||
              prop === "shape-rendering" ||
              prop === "stop-color" ||
              prop === "stop-opacity" ||
              prop === "stroke-dasharray" ||
              prop === "stroke-dashoffset" ||
              prop === "stroke-linecap" ||
              prop === "stroke-linejoin" ||
              prop === "stroke-miterlimit" ||
              prop === "stroke-opacity" ||
              prop === "text-anchor" ||
              prop === "text-rendering" ||
              prop === "vector-effect" ||
              prop === "writing-mode" ||
              prop === "caption-side" ||
              prop === "counter-increment" ||
              prop === "counter-reset" ||
              prop === "counter-set" ||
              prop === "orphans" ||
              prop === "quotes" ||
              prop === "unicode-bidi" ||
              prop === "widows" ||
              prop === "color-scheme" ||
              prop === "forced-color-adjust" ||
              prop === "tab-size" ||
              prop === "clip" ||
              prop === "accent-color" ||
              prop === "anchor-name" ||
              prop === "anchor-scope") {
            continue;
          }
          const value = cs.getPropertyValue(prop);
          if (value) parts.push(`${prop}: ${value}`);
        }
        const cssText = parts.join("; ");

        // Skip elements with no meaningful computed styles
        if (!cssText || cssText.length < 10) continue;

        // Merge with existing style attribute (existing wins for conflicts)
        const existing = el.getAttribute("style") || "";
        el.setAttribute("style", cssText + (existing ? ";" + existing : ""));
        count++;
      }

      console.log(`[INLINER] Total elements: ${allElements.length}, styled: ${count}`);

      // Remove <script> and <link> tags (CDN references)
      document.querySelectorAll("script, link").forEach((el) => el.remove());

      return { html: document.documentElement.outerHTML, count };
    });

    // Strip Tailwind classes from elements, keep non-Tailwind classes
    const cleanedHtml = stripTailwindClasses(inlinedHtml.html);

    return { html: cleanedHtml, elementCount: inlinedHtml.count, warnings };
  } catch (err: any) {
    warnings.push(
      `Tailwind inliner failed: ${err.message}. Falling through with original HTML.`,
    );
    return { html: rawHtml, elementCount: 0, warnings };
  } finally {
    if (browser) await browser.close();
  }
}

/** Remove Tailwind class tokens from class attributes, keeping custom classes. */
function stripTailwindClasses(html: string): string {
  return html.replace(/class="([^"]*)"/g, (_match, classList: string) => {
    const kept = classList
      .split(/\s+/)
      .filter((c: string) => c.length > 0 && !isTailwindClass(c));
    if (kept.length > 0) {
      return `class="${kept.join(" ")}"`;
    }
    return "";
  });
}
