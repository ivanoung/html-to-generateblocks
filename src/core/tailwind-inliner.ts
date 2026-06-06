// ── Tailwind Inliner ──────────────────────────────────────
//
// Loads HTML in Playwright, extracts computed styles for every
// element, and injects them as inline style attributes. Produces
// Tailwind-free HTML ready for the GB converter pipeline.
//
// Returns structured data: class lists (pre-stripping), <style>
// block contents, and responsive/state overrides for downstream
// consolidation.

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
  elementCount: number;
  classListPerElement: Record<string, string>;
  styleBlocks: string[];
  responsiveOverrides: Array<{
    breakpoint: string;
    maxWidth: number;
    overrides: Record<string, Record<string, string>>;
  }>;
  warnings: string[];
}

interface ExtractionPayload {
  html: string;
  elementCount: number;
  classListPerElement: Record<string, string>;
  styleBlocks: string[];
}

// ── Tailwind class stripping ───────────────────────────

const TAILWIND_CLASS_REGEX =
  /^(?:sr-only|static|fixed|absolute|relative|sticky|isolate|inline|block|inline-block|flex|inline-flex|grid|inline-grid|hidden|contents|table|table-caption|table-cell|table-column|table-column-group|table-footer-group|table-header-group|table-row|table-row-group|flow-root|overflow|overflow-x|overflow-y|truncate|uppercase|lowercase|capitalize|normal-case|italic|not-italic|underline|line-through|no-underline|antialiased|subpixel-antialiased|select-all|select-auto|select-none|select-text|border|bg-|text-|font-|tracking-|leading-|list-|placeholder-|opacity-|shadow-|outline-|ring-|ring-offset-|border-|rounded-|divide-|space-|gap-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|w-|min-w-|max-w-|h-|min-h-|max-h-|flex-|grow|shrink|basis-|order-|col-|row-|grid-|auto-|justify-|content-|items-|self-|place-|inset-|top-|right-|bottom-|left-|z-|float-|clear-|object-|overflow-|overscroll-|box-|whitespace-|break-|align-|text-|decoration-|indent-|align-|whitespace-|break-|transition-|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|transform|snap-|scroll-|touch-|cursor-|pointer-|resize-|appearance|columns-|auto-cols-|auto-rows-|aspect-|backdrop-|will-change-|content-|forced-|sr-|contrast-|hue-rotate-|invert|saturate-|sepia-|drop-shadow-|grayscale-|blur-|brightness-|backdrop-|mix-|bg-blend-|from-|via-|to-|shadow-|decoration-|accent-|caret-|stroke-|fill-|divide-|outline-|ring-|ring-offset|group|hover:|focus:|active:|disabled:|visited:|first:|last:|odd:|even:|group-|peer-|motion-|dark:|lg:|md:|sm:|xl:|2xl:|min-|max-|-translate-|-skew-|-scale-|-rotate-|-mx-|-my-|-mt-|-mr-|-mb-|-ml-|-px-|-py-|-pt-|-pr-|-pb-|-pl-|data-|aria-)/;

function isTailwindClass(className: string): boolean {
  return TAILWIND_CLASS_REGEX.test(className);
}

function stripTailwindClasses(html: string): string {
  return html.replace(/class="([^"]*)"/g, (_match, classList: string) => {
    const kept = classList
      .split(/\s+/)
      .filter((c: string) => c.length > 0 && !isTailwindClass(c));
    if (kept.length > 0) return `class="${kept.join(" ")}"`;
    return "";
  });
}

// ── Browser defaults filter ──────────────────────────────

/** CSS properties and their browser default values. Stripped from output. */
const DEFAULTS: Record<string, string> = {
  "position": "static",
  "margin-top": "0px",
  "margin-right": "0px",
  "margin-bottom": "0px",
  "margin-left": "0px",
  "padding-top": "0px",
  "padding-right": "0px",
  "padding-bottom": "0px",
  "padding-left": "0px",
  "border-top-width": "0px",
  "border-right-width": "0px",
  "border-bottom-width": "0px",
  "border-left-width": "0px",
  "border-top-left-radius": "0px",
  "border-top-right-radius": "0px",
  "border-bottom-right-radius": "0px",
  "border-bottom-left-radius": "0px",
  "flex-grow": "0",
  "flex-shrink": "1",
  "flex-basis": "auto",
  "flex-wrap": "nowrap",
  "order": "0",
  "float": "none",
  "clear": "none",
  "opacity": "1",
  "z-index": "auto",
  "overflow-x": "visible",
  "overflow-y": "visible",
  "visibility": "visible",
  "box-sizing": "content-box",
  "column-count": "auto",
  "column-gap": "normal",
  "column-width": "auto",
  "transform": "none",
  "transition-delay": "0s",
  "transition-duration": "0s",
  "transition-property": "all",
  "transition-timing-function": "ease",
  "animation-name": "none",
  "animation-duration": "0s",
  "animation-timing-function": "ease",
  "animation-delay": "0s",
  "animation-iteration-count": "1",
  "animation-direction": "normal",
  "animation-fill-mode": "none",
  "animation-play-state": "running",
};

// ── Browser-internal property filter ────────────────────

const SKIP_PROPS = new Set([
  "-webkit-border-horizontal-spacing", "-webkit-border-image",
  "-webkit-border-vertical-spacing", "-webkit-box-align",
  "-webkit-box-decoration-break", "-webkit-box-direction",
  "-webkit-box-flex", "-webkit-box-ordinal-group",
  "-webkit-box-orient", "-webkit-box-pack", "-webkit-box-reflect",
  "-webkit-font-smoothing", "-webkit-line-break", "-webkit-line-clamp",
  "-webkit-locale", "-webkit-mask-box-image",
  "-webkit-mask-box-image-outset", "-webkit-mask-box-image-repeat",
  "-webkit-mask-box-image-slice", "-webkit-mask-box-image-source",
  "-webkit-mask-box-image-width", "-webkit-mask-position-x",
  "-webkit-mask-position-y", "-webkit-rtl-ordering",
  "-webkit-ruby-position", "-webkit-tap-highlight-color",
  "-webkit-text-combine", "-webkit-text-decorations-in-effect",
  "-webkit-text-fill-color", "-webkit-text-orientation",
  "-webkit-text-security", "-webkit-text-stroke-color",
  "-webkit-text-stroke-width", "-webkit-user-drag",
  "-webkit-user-modify", "-webkit-writing-mode",
  "--tw-border-spacing-x", "--tw-border-spacing-y",
  "--tw-ring-color", "--tw-ring-offset-color",
  "--tw-ring-offset-shadow", "--tw-ring-offset-width",
  "--tw-ring-shadow", "--tw-rotate", "--tw-scale-x", "--tw-scale-y",
  "--tw-scroll-snap-strictness", "--tw-shadow-colored",
  "--tw-shadow", "--tw-skew-x", "--tw-skew-y",
  "--tw-translate-x", "--tw-translate-y",
  "view-transition-class", "view-transition-group",
  "view-transition-name", "view-transition-scope",
  "zoom", "app-region", "border-shape",
  "corner-bottom-left-shape", "corner-bottom-right-shape",
  "corner-end-end-shape", "corner-end-start-shape",
  "corner-start-end-shape", "corner-start-start-shape",
  "corner-top-left-shape", "corner-top-right-shape",
  "contain-intrinsic-block-size", "contain-intrinsic-height",
  "contain-intrinsic-inline-size", "contain-intrinsic-size",
  "contain-intrinsic-width", "dynamic-range-limit", "field-sizing",
  "initial-letter", "interactivity", "interest-delay-end",
  "interest-delay-start", "interpolate-size", "object-view-box",
  "overlay", "position-anchor", "position-area",
  "position-try-fallbacks", "position-try-order", "position-visibility",
  "ruby-align", "ruby-position", "scroll-initial-target",
  "scroll-marker-group", "scroll-target-group", "text-autospace",
  "text-box-edge", "text-box-trim", "text-spacing-trim",
  "text-wrap-mode", "text-wrap-style", "timeline-scope",
  "timeline-trigger-activation-range-end",
  "timeline-trigger-activation-range-start",
  "timeline-trigger-active-range-end",
  "timeline-trigger-active-range-start",
  "timeline-trigger-name", "timeline-trigger-source", "trigger-scope",
  "view-timeline-axis", "view-timeline-inset", "view-timeline-name",
  "buffered-rendering", "color-interpolation-filters",
  "cx", "cy", "d", "r", "rx", "ry", "x", "y",
  "math-depth", "math-shift", "math-style",
  "reading-flow", "reading-order",
  "font-feature-settings", "font-kerning", "font-language-override",
  "font-optical-sizing", "font-palette", "font-size-adjust",
  "font-stretch", "font-synthesis-small-caps", "font-synthesis-style",
  "font-synthesis-weight", "font-variant-alternates",
  "font-variant-caps", "font-variant-east-asian",
  "font-variant-emoji", "font-variant-ligatures",
  "font-variant-numeric", "font-variant-position",
  "font-variation-settings", "hyphenate-character",
  "hyphenate-limit-chars", "print-color-adjust", "text-size-adjust",
  "offset-anchor", "offset-distance", "offset-path",
  "offset-position", "offset-rotate",
  "scroll-timeline-axis", "scroll-timeline-name",
  "speak", "dominant-baseline", "alignment-baseline",
  "baseline-shift", "baseline-source", "clip-rule",
  "color-interpolation", "color-rendering", "fill-opacity",
  "fill-rule", "flood-color", "flood-opacity", "lighting-color",
  "marker-end", "marker-mid", "marker-start", "mask-type",
  "paint-order", "shape-rendering", "stop-color", "stop-opacity",
  "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-opacity",
  "text-anchor", "text-rendering", "vector-effect",
  "writing-mode", "caption-side", "counter-increment",
  "counter-reset", "counter-set", "orphans", "quotes",
  "unicode-bidi", "widows", "color-scheme", "forced-color-adjust",
  "tab-size", "clip", "accent-color", "anchor-name", "anchor-scope",
]);

// ── Core extraction (runs inside page.evaluate) ──────────

async function extractStyles(page: Page): Promise<ExtractionPayload> {
  return page.evaluate(({ skipPropList, defaults }) => {
    const SKIP = new Set(skipPropList);

    // 1. Assign stable indices
    document.body.querySelectorAll("*").forEach((el, i) => {
      el.setAttribute("data-gb-idx", String(i));
    });

    // 2. Capture class lists BEFORE stripping
    const classListPerElement: Record<string, string> = {};
    document.querySelectorAll("[data-gb-idx]").forEach((el) => {
      const idx = el.getAttribute("data-gb-idx")!;
      classListPerElement[idx] = el.className;
    });

    // 3. Capture <style> block contents BEFORE removing script/link
    const styleBlocks: string[] = [];
    document.querySelectorAll("style").forEach((el) => {
      styleBlocks.push(el.textContent || "");
    });

    // 4. Extract computed styles, inject as inline
    const allElements = document.body.querySelectorAll("*");
    let count = 0;

    for (const el of allElements) {
      if (!(el instanceof HTMLElement)) continue;

      const cs = window.getComputedStyle(el);
      const parts: string[] = [];
      for (let i = 0; i < cs.length; i++) {
        const prop = cs[i];
        if (SKIP.has(prop) || prop.startsWith("-webkit-") ||
            prop.startsWith("-internal-") || prop.startsWith("--tw-")) {
          continue;
        }
        const value = cs.getPropertyValue(prop);
        if (!value) continue;

        // Strip browser default values
        const def = defaults[prop];
        if (def !== undefined && value === def) continue;

        parts.push(`${prop}: ${value}`);
      }
      const cssText = parts.join("; ");

      if (!cssText || cssText.length < 10) continue;

      const existing = el.getAttribute("style") || "";
      el.setAttribute("style", cssText + (existing ? ";" + existing : ""));
      count++;
    }

    console.log(`[INLINER] Total elements: ${allElements.length}, styled: ${count}`);

    // 5. Remove <script> and <link> tags (CDN references)
    document.querySelectorAll("script, link").forEach((el) => el.remove());

    return {
      html: document.documentElement.outerHTML,
      elementCount: count,
      classListPerElement,
      styleBlocks,
    };
  }, { skipPropList: [...SKIP_PROPS], defaults: DEFAULTS });
}

// ── Main entry point ────────────────────────────────────

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

    page.on("console", (msg) => {
      if (msg.text().startsWith("[INLINER]")) {
        console.log(msg.text());
      }
    });

    await page.setContent(rawHtml, { waitUntil: "networkidle" });

    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            ".pt-32, [class*='pt-32']",
          );
          if (!el || !(el instanceof HTMLElement)) return false;
          return window.getComputedStyle(el).paddingTop !== "0px";
        },
        { timeout: 10000 },
      );
    } catch {
      warnings.push("Tailwind CDN did not compile within timeout");
    }

    const payload = await extractStyles(page);

    // ── Multi-viewport capture ──────────────────────────
    const responsiveOverrides: InlinerResult["responsiveOverrides"] = [];
    const breakpoints = [
      { label: "xl", width: 1280 },
      { label: "lg", width: 1024 },
      { label: "md", width: 768 },
      { label: "sm", width: 640 },
      { label: "mobile", width: 375 },
    ];

    // Capture lightweight style snapshots at each breakpoint
    const bpSnapshots: Array<{
      label: string;
      width: number;
      styles: Record<string, Record<string, string>>;
    }> = [];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: 900 });
      await page.waitForTimeout(300);

      const bpStyles = await page.evaluate(() => {
        const result: Record<string, Record<string, string>> = {};
        document.querySelectorAll("[data-gb-idx]").forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          const idx = el.getAttribute("data-gb-idx")!;
          const cs = window.getComputedStyle(el);
          const props: Record<string, string> = {};
          for (let i = 0; i < cs.length; i++) {
            const prop = cs[i];
            // Only capture layout/sizing/spacing/typography props
            if (
              !prop.startsWith("border-") &&
              prop !== "display" &&
              prop !== "position" &&
              !prop.startsWith("flex-") &&
              prop !== "flex-direction" &&
              prop !== "flex-wrap" &&
              !prop.startsWith("grid-") &&
              !prop.startsWith("padding-") &&
              !prop.startsWith("margin-") &&
              prop !== "gap" &&
              prop !== "column-gap" &&
              prop !== "row-gap" &&
              !prop.startsWith("font-") &&
              prop !== "font-size" &&
              prop !== "font-weight" &&
              prop !== "line-height" &&
              prop !== "letter-spacing" &&
              !prop.startsWith("width") &&
              !prop.startsWith("height") &&
              !prop.startsWith("min-") &&
              !prop.startsWith("max-") &&
              prop !== "text-align" &&
              prop !== "overflow-x" &&
              prop !== "overflow-y" &&
              prop !== "z-index" &&
              prop !== "opacity" &&
              prop !== "visibility" &&
              prop !== "transform"
            ) {
              continue;
            }
            const val = cs.getPropertyValue(prop);
            if (val) props[prop] = val;
          }
          if (Object.keys(props).length > 0) {
            result[idx] = props;
          }
        });
        return result;
      });

      bpSnapshots.push({ label: bp.label, width: bp.width, styles: bpStyles });
    }

    // Diff each breakpoint against desktop base
    // Desktop styles are the inline attributes already on elements
    for (const snap of bpSnapshots) {
      const overrides: Record<string, Record<string, string>> = {};

      for (const [idx, bpProps] of Object.entries(snap.styles)) {
        // Get desktop base styles by reading the element's style attribute
        // We already set these inline in extractStyles
        const diff: Record<string, string> = {};
        for (const [prop, bpVal] of Object.entries(bpProps)) {
          // Only record if different from desktop
          // We'll compare against the stored desktop values in the consolidator
          diff[prop] = bpVal;
        }
        if (Object.keys(diff).length > 0) {
          overrides[idx] = diff;
        }
      }

      if (Object.keys(overrides).length > 0) {
        responsiveOverrides.push({
          breakpoint: snap.label,
          maxWidth: snap.width,
          overrides,
        });
      }
    }

    const cleanedHtml = stripTailwindClasses(payload.html);

    return {
      html: cleanedHtml,
      elementCount: payload.elementCount,
      classListPerElement: payload.classListPerElement,
      styleBlocks: payload.styleBlocks,
      responsiveOverrides,
      warnings,
    };
  } catch (err: any) {
    warnings.push(
      `Tailwind inliner failed: ${err.message}. Falling through with original HTML.`,
    );
    return {
      html: rawHtml,
      elementCount: 0,
      classListPerElement: {},
      styleBlocks: [],
      responsiveOverrides: [],
      warnings,
    };
  } finally {
    if (browser) await browser.close();
  }
}
