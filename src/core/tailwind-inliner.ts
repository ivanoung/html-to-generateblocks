// ── Tailwind Inliner (Intent-Based) ─────────────────────
//
// Instead of extracting computed styles (getComputedStyle),
// parses the compiled Tailwind CSS rules from document.styleSheets
// and maps them to elements by class name. Only captures properties
// Tailwind actually set (~5-8 per element vs ~300).
//
// Pipeline: CSS rule extraction → per-element assignment →
//   CSS variable resolution → normalization → desktop-first conversion
//   → return clean HTML + consolidated style data.

import { chromium, type Browser, type Page } from "playwright";
import * as cheerio from "cheerio";

const cheerioLoad = cheerio.load;

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

type RuleKind = "class-base" | "class-state" | "class-responsive" | "compound" | "element" | "keyframe" | "vendor-pseudo";

interface ParsedRule {
  kind: RuleKind;
  selector: string;
  className?: string;
  properties: Record<string, string>;
  breakpoint?: string;
  state?: string;
  index: number;
}

interface ClassRegistry {
  base: Record<string, ParsedRule>;
  responsive: Record<string, ParsedRule[]>;
  state: Record<string, ParsedRule[]>;
  compound: ParsedRule[];
}

interface ExtractionResult {
  registry: ClassRegistry;
  customCssRules: string[];
  breakpoints: Record<string, string>;
}

export interface ElementStyles {
  base: Record<string, string>;
  responsive: Record<string, Record<string, string>>;
  state: Record<string, Record<string, string>>;
}

export interface DesktopFirstStyles {
  desktop: Record<string, string>;
  overrides: Array<{ maxWidth: number; props: Record<string, string> }>;
}

export interface InlinerResult {
  html: string;
  elementCount: number;
  classListPerElement: Record<string, string>;
  styleBlocks: string[];
  customCss: string;
  desktopFirstStyles: Map<string, DesktopFirstStyles>;
  warnings: string[];
}

// ── Tailwind class stripping ───────────────────────────

const TAILWIND_CLASS_REGEX =
  /^(?:sr-only|static|fixed|absolute|relative|sticky|isolate|inline|block|inline-block|flex|inline-flex|grid|inline-grid|hidden|contents|table|table-caption|table-cell|table-column|table-column-group|table-footer-group|table-header-group|table-row|table-row-group|flow-root|overflow|overflow-x|overflow-y|truncate|uppercase|lowercase|capitalize|normal-case|italic|not-italic|underline|line-through|no-underline|antialiased|subpixel-antialiased|select-all|select-auto|select-none|select-text|border|bg-|text-|font-|tracking-|leading-|list-|placeholder-|opacity-|shadow-|outline-|ring-|ring-offset-|border-|rounded-|divide-|space-|gap-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|w-|min-w-|max-w-|h-|min-h-|max-h-|flex-|grow|shrink|basis-|order-|col-|row-|grid-|auto-|justify-|content-|items-|self-|place-|inset-|top-|right-|bottom-|left-|z-|float-|clear-|object-|overflow-|overscroll-|box-|whitespace-|break-|align-|text-|decoration-|indent-|align-|whitespace-|break-|transition-|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|transform|snap-|scroll-|touch-|cursor-|pointer-|resize-|appearance|columns-|auto-cols-|auto-rows-|aspect-|backdrop-|will-change-|content-|forced-|sr-|contrast-|hue-rotate-|invert|saturate-|sepia-|drop-shadow-|grayscale-|blur-|brightness-|backdrop-|mix-|bg-blend-|from-|via-|to-|shadow-|decoration-|accent-|caret-|stroke-|fill-|divide-|outline-|ring-|ring-offset|group|hover:|focus:|active:|disabled:|visited:|first:|last:|odd:|even:|group-|peer-|motion-|dark:|lg:|md:|sm:|xl:|2xl:|min-|max-|-translate-|-skew-|-scale-|-rotate-|-mx-|-my-|-mt-|-mr-|-mb-|-ml-|-px-|-py-|-pt-|-pr-|-pb-|-pl-|data-|aria-)/;

function isTailwindClass(className: string): boolean {
  return TAILWIND_CLASS_REGEX.test(className);
}

function stripTailwindClasses(html: string): string {
  return html.replace(/class="([^"]*)"/g, (_m, classList: string) => {
    const kept = classList.split(/\s+/).filter((c: string) => c.length > 0 && !isTailwindClass(c));
    return kept.length > 0 ? `class="${kept.join(" ")}"` : "";
  });
}

// ── Phase 1: CSS Rule Extraction ───────────────────────

async function extractCssRules(page: Page, configJson: string | null): Promise<ExtractionResult> {
  return page.evaluate((configStr) => {
    const bp = parseBreakpoints(configStr);

    const registry: ClassRegistry = { base: {}, responsive: {}, state: {}, compound: [] };
    const cssRules: string[] = [];
    let idx = 0;

    for (const sheet of document.styleSheets) {
      try { walkRules(sheet, registry, cssRules, bp, idx); } catch { /* cross-origin */ }
    }

    return {
      registry: {
        base: registry.base,
        responsive: registry.responsive,
        state: registry.state,
        compound: registry.compound,
      },
      customCssRules: cssRules,
      breakpoints: bp,
    };

    function parseBreakpoints(cfg: string | null): Record<string, string> {
      if (!cfg) return { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" };
      try {
        const o = JSON.parse(cfg);
        return o?.theme?.screens || { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" };
      } catch { return { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" }; }
    }

    function walkRules(
      sheet: CSSStyleSheet,
      reg: ClassRegistry,
      css: string[],
      bps: Record<string, string>,
      indexRef: number,
    ): void {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSStyleRule) {
          processRule(rule, null, reg, css, bps, indexRef++);
        } else if (rule instanceof CSSMediaRule) {
          const bpName = matchBp(rule.conditionText, bps);
          for (const inner of rule.cssRules) {
            if (inner instanceof CSSStyleRule) {
              processRule(inner, bpName, reg, css, bps, indexRef++);
            }
          }
        } else if (rule instanceof CSSKeyframesRule) {
          let kfText = "";
          for (const kr of rule.cssRules) {
            kfText += `${kr.keyText}{${kr.style.cssText}}`;
          }
          css.push(`@keyframes ${rule.name}{${kfText}}`);
        }
      }
    }

    function matchBp(cond: string, bps: Record<string, string>): string | null {
      const m = cond.match(/min-width:\s*(\d+)px/);
      if (!m) return null;
      for (const [k, v] of Object.entries(bps)) {
        if (v === `${m[1]}px`) return k;
      }
      return null;
    }

    function processRule(
      rule: CSSStyleRule,
      bp: string | null,
      reg: ClassRegistry,
      css: string[],
      bps: Record<string, string>,
      ruleIdx: number,
    ): void {
      const sel = rule.selectorText;

      // Element/universal selectors → custom.css
      if (!sel.trim().startsWith(".")) {
        css.push(`${sel}{${rule.style.cssText}}`);
        return;
      }

      // Vendor-prefixed → custom.css
      if (/::-webkit-|::-moz-|::-ms-/.test(sel)) {
        css.push(`${sel}{${rule.style.cssText}}`);
        return;
      }

      // Extract properties, skip --tw-* CSS variables
      const props: Record<string, string> = {};
      for (let i = 0; i < rule.style.length; i++) {
        const p = rule.style[i];
        if (p.startsWith("--tw-")) continue;
        props[p] = rule.style.getPropertyValue(p);
      }
      if (Object.keys(props).length === 0) return;

      // Simple class selector? Extract class name
      const classMatch = sel.match(/^\.([a-zA-Z0-9_-]+(?:(?::(?:hover|focus|focus-visible|active))?))/);
      let className: string | undefined;
      if (classMatch) {
        className = classMatch[1];
      } else {
        // Try unescaping: \: → :, \/ → /
        const simple = sel.replace(/\\:/g, ":").replace(/\\\//g, "/").replace(/\\\./g, ".");
        const cm2 = simple.match(/^\.([a-zA-Z0-9_-]+)/);
        if (cm2) className = cm2[1];
      }

      // Detect state
      let state: string | null = null;
      if (/:hover/.test(sel)) state = "hover";
      else if (/:focus-visible/.test(sel)) state = "focus-visible";
      else if (/:focus/.test(sel)) state = "focus";
      else if (/:active/.test(sel)) state = "active";

      // Compound? (space, >, ~, + after removing pseudo-class)
      const noPseudo = sel.replace(/:hover|:focus-visible|:focus|:active/g, "");
      const isCompound = /[\s>~+]/.test(noPseudo);

      const parsed: ParsedRule = {
        kind: "class-base",
        selector: sel,
        className,
        properties: props,
        breakpoint: bp ?? undefined,
        state: state ?? undefined,
        index: ruleIdx,
      };

      if (isCompound) {
        parsed.kind = "compound";
        reg.compound.push(parsed);
      } else if (bp) {
        parsed.kind = "class-responsive";
        const key = className || sel;
        if (!reg.responsive[key]) reg.responsive[key] = [];
        reg.responsive[key].push(parsed);
      } else if (state) {
        parsed.kind = "class-state";
        const key = className || sel;
        if (!reg.state[key]) reg.state[key] = [];
        reg.state[key].push(parsed);
      } else {
        if (className) reg.base[className] = parsed;
      }
    }
  }, configJson);
}

// ── Phase 2: Per-Element Style Assignment ──────────────

function assignStylesToElement(
  classList: string,
  registry: ClassRegistry,
): ElementStyles {
  const result: ElementStyles = { base: {}, responsive: {}, state: {} };
  const classes = classList.split(/\s+/).filter((c) => c.length > 0);

  for (const cls of classes) {
    const prefixMatch = cls.match(/^(sm|md|lg|xl|2xl):(.+)$/);
    const name = prefixMatch ? prefixMatch[2] : cls;
    const bp = prefixMatch ? prefixMatch[1] : null;

    const stateMatch = cls.match(/^(hover|focus|focus-visible|active):(.+)$/);
    if (stateMatch && !bp) {
      const rules = registry.state[stateMatch[2]];
      if (rules) {
        for (const rule of rules) {
          result.state[stateMatch[1]] ||= {};
          Object.assign(result.state[stateMatch[1]], rule.properties);
        }
      }
      continue;
    }

    if (bp) {
      const rules = registry.responsive[name];
      if (rules) {
        for (const rule of rules) {
          if (rule.breakpoint === bp) {
            result.responsive[bp] ||= {};
            Object.assign(result.responsive[bp], rule.properties);
          }
        }
      }
    } else {
      const rule = registry.base[name];
      if (rule) {
        Object.assign(result.base, rule.properties);
      }
    }
  }

  return result;
}

// ── Phase 3: CSS Variable Resolution ───────────────────

const TW_VARIABLE_DEFAULTS: Record<string, string> = {
  "--tw-translate-x": "0", "--tw-translate-y": "0",
  "--tw-rotate": "0deg", "--tw-scale-x": "1", "--tw-scale-y": "1",
  "--tw-skew-x": "0deg", "--tw-skew-y": "0deg",
};

function resolveTransform(transform: string, classList: string, registry: ClassRegistry): string {
  const vars = { ...TW_VARIABLE_DEFAULTS };

  for (const cls of classList.split(/\s+/)) {
    const name = cls.replace(/^(?:sm|md|lg|xl|2xl):/, "");
    const rule = registry.base[name];
    if (!rule) continue;
    for (const [prop, val] of Object.entries(rule.properties)) {
      if (prop.startsWith("--tw-")) vars[prop] = val;
    }
  }

  let resolved = transform;
  for (const [varName, val] of Object.entries(vars)) {
    resolved = resolved.replace(new RegExp(`var\\(${varName.replace(/-/g, "\\-")}[^)]*\\)`, "g"), val);
  }

  // Simplify identity components
  resolved = resolved.replace(/translate\(0px,\s*0px\)\s*/g, "");
  resolved = resolved.replace(/translateX\(0px\)\s*/g, "");
  resolved = resolved.replace(/translateY\(0px\)\s*/g, "");
  resolved = resolved.replace(/rotate\(0deg\)\s*/g, "");
  resolved = resolved.replace(/scaleX\(1\)\s*/g, "");
  resolved = resolved.replace(/scaleY\(1\)\s*/g, "");
  resolved = resolved.replace(/skewX\(0deg\)\s*/g, "");
  resolved = resolved.replace(/skewY\(0deg\)\s*/g, "");
  resolved = resolved.trim();

  return resolved || "none";
}

// ── Phase 4: Value Normalization ───────────────────────

function normalizeValue(value: string): string {
  const rgbMatch = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    const [r, g, b] = [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
    const hex = [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
    if (hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5]) {
      return `#${hex[0]}${hex[2]}${hex[4]}`;
    }
    return `#${hex}`;
  }
  if (value === "0px") return "0";
  return value;
}

function normalizeStyles(styles: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [prop, val] of Object.entries(styles)) {
    result[prop] = normalizeValue(val);
  }
  return result;
}

// ── Phase 5: Desktop-First Conversion ──────────────────

const CSS_INITIALS: Record<string, string> = {
  "display": "inline",
  "position": "static",
  "margin-top": "0", "margin-right": "0", "margin-bottom": "0", "margin-left": "0",
  "padding-top": "0", "padding-right": "0", "padding-bottom": "0", "padding-left": "0",
  "border-top-width": "0", "border-right-width": "0", "border-bottom-width": "0", "border-left-width": "0",
  "border-top-left-radius": "0", "border-top-right-radius": "0",
  "border-bottom-right-radius": "0", "border-bottom-left-radius": "0",
  "flex-grow": "0", "flex-shrink": "1", "flex-basis": "auto",
  "order": "0", "float": "none", "opacity": "1", "z-index": "auto",
  "overflow-x": "visible", "overflow-y": "visible",
  "visibility": "visible", "transform": "none",
};

function stripInitials(desktop: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [prop, val] of Object.entries(desktop)) {
    if (CSS_INITIALS[prop] === val) continue;
    result[prop] = val;
  }
  return result;
}

function convertToDesktopFirst(
  styles: ElementStyles,
  breakpoints: Record<string, string>,
): DesktopFirstStyles {
  const desktop = stripInitials({ ...styles.base });
  const overrides: Array<{ maxWidth: number; props: Record<string, string> }> = [];

  const sortedBps = Object.entries(breakpoints)
    .sort(([, a], [, b]) => parseInt(b) - parseInt(a));

  // First (largest) breakpoint: responsive properties become desktop base
  if (sortedBps.length > 0) {
    const largestBp = sortedBps[0][0];
    const largestProps = styles.responsive[largestBp];
    if (largestProps) {
      for (const [prop, val] of Object.entries(largestProps)) {
        desktop[prop] = normalizeValue(val);
      }
    }
  }

  // Smaller breakpoints: max-width overrides
  for (let i = 1; i < sortedBps.length; i++) {
    const [bpName] = sortedBps[i];
    const bpProps = styles.responsive[bpName];
    if (!bpProps) continue;

    const maxW = parseInt(sortedBps[i - 1][1]) - 1;
    const diff: Record<string, string> = {};
    for (const [prop, val] of Object.entries(bpProps)) {
      const nv = normalizeValue(val);
      if (desktop[prop] !== nv) diff[prop] = nv;
    }
    if (Object.keys(diff).length > 0) {
      overrides.push({ maxWidth: maxW, props: diff });
    }
  }

  // Also add base-level responsive override if base differs from desktop
  // (for properties set by base classes but not by the largest breakpoint)
  if (sortedBps.length > 1) {
    const mobileBp = sortedBps[sortedBps.length - 1][1];
    const baseDiff: Record<string, string> = {};
    for (const [prop, val] of Object.entries(desktop)) {
      if (styles.base[prop] && normalizeValue(styles.base[prop]) !== val) {
        // Only if there was an original base value that differs from desktop
      }
    }
  }

  return { desktop: stripInitials(desktop), overrides };
}

// ── Phase 8: custom.css Assembly ────────────────────────

function buildCustomCss(customCssRules: string[], styleBlocks: string[]): string {
  const parts: string[] = [];

  parts.push("/* Tailwind Preflight / Element Resets */");
  for (const rule of customCssRules) {
    parts.push(rule);
  }

  for (const block of styleBlocks) {
    const keyframes = block.match(/@keyframes\s+[\s\S]+?}(?=\s*(?:$|@|}))/g);
    if (keyframes) parts.push(...keyframes);

    const vendor = block.match(/::-webkit-[^}]+}/g);
    if (vendor) parts.push(...vendor);

    const bodyRules = block.match(/body\s*\{[^}]+\}/g);
    if (bodyRules) parts.push(...bodyRules);
  }

  return parts.filter(Boolean).join("\n");
}

// ── Main Entry Point ────────────────────────────────────

export async function inlineTailwindStyles(rawHtml: string): Promise<InlinerResult> {
  const warnings: string[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.text().startsWith("[INLINER]")) console.log(msg.text());
    });

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

    // Extract the Tailwind config for breakpoint parsing
    const configMatch = rawHtml.match(/tailwind\.config\s*=\s*/);
    let configJson: string | null = null;
    if (configMatch) {
      let depth = 0;
      let startIdx = (configMatch.index || 0) + configMatch[0].length;
      let endIdx = startIdx;
      for (let i = startIdx; i < rawHtml.length; i++) {
        if (rawHtml[i] === "{") depth++;
        else if (rawHtml[i] === "}") { depth--; if (depth === 0) { endIdx = i + 1; break; } }
      }
      configJson = rawHtml.substring(startIdx, endIdx).replace(/,(\s*[}\]])/g, "$1");
    }

    // Phase 1: Extract CSS rules + capture element data
    const extractionPayload = await page.evaluate(() => {
      document.body.querySelectorAll("*").forEach((el, i) => {
        el.setAttribute("data-gb-idx", String(i));
      });

      const classListPerElement: Record<string, string> = {};
      document.querySelectorAll("[data-gb-idx]").forEach((el) => {
        classListPerElement[el.getAttribute("data-gb-idx")!] = el.className;
      });

      const styleBlocks: string[] = [];
      document.querySelectorAll("style").forEach((el) => {
        styleBlocks.push(el.textContent || "");
      });

      const existingStyles: Record<string, string> = {};
      document.querySelectorAll("[data-gb-idx]").forEach((el) => {
        const s = (el as HTMLElement).getAttribute("style");
        if (s) existingStyles[el.getAttribute("data-gb-idx")!] = s;
      });

      document.querySelectorAll("script, link").forEach((el) => el.remove());

      return {
        html: document.documentElement.outerHTML,
        elementCount: document.querySelectorAll("[data-gb-idx]").length,
        classListPerElement,
        styleBlocks,
        existingStyles,
      };
    });

    // Phase 1: CSS rule extraction
    const { registry, customCssRules, breakpoints } = await extractCssRules(page, configJson);
    console.log(`[INLINER] Registry: ${Object.keys(registry.base).length} base, ${Object.keys(registry.responsive).length} responsive, ${Object.keys(registry.state).length} state, ${registry.compound.length} compound, ${customCssRules.length} custom`);

    // Phase 2-5: Per-element assignment + resolution + normalization + conversion
    const desktopFirstStyles = new Map<string, DesktopFirstStyles>();

    for (const [idx, classList] of Object.entries(extractionPayload.classListPerElement)) {
      const classStr = typeof classList === "string" ? classList : String(classList || "");
      const styles = assignStylesToElement(classStr, registry);

      // Resolve CSS variables in transform
      if (styles.base["transform"]) {
        styles.base["transform"] = resolveTransform(styles.base["transform"], classList, registry);
      }

      // Normalize base values
      styles.base = normalizeStyles(styles.base);

      // Merge existing inline styles (source style= overrides Tailwind)
      const existing = extractionPayload.existingStyles[idx] || "";
      if (existing) {
        for (const decl of existing.split(";")) {
          const ci = decl.indexOf(":");
          if (ci === -1) continue;
          const k = decl.substring(0, ci).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const v = decl.substring(ci + 1).trim();
          if (k && v) styles.base[k] = v;
        }
      }

      const dfs = convertToDesktopFirst(styles, breakpoints);
      desktopFirstStyles.set(idx, dfs);
    }

    // Strip Tailwind classes
    const cleanedHtml = stripTailwindClasses(extractionPayload.html);

    // Build custom.css
    const customCss = buildCustomCss(customCssRules, extractionPayload.styleBlocks);

    return {
      html: cleanedHtml,
      elementCount: extractionPayload.elementCount,
      classListPerElement: extractionPayload.classListPerElement,
      styleBlocks: extractionPayload.styleBlocks,
      customCss,
      desktopFirstStyles,
      warnings,
    };
  } catch (err: any) {
    warnings.push(`Tailwind inliner failed: ${err.message}. Falling through.`);
    return {
      html: rawHtml,
      elementCount: 0,
      classListPerElement: {},
      styleBlocks: [],
      customCss: "",
      desktopFirstStyles: new Map(),
      warnings,
    };
  } finally {
    if (browser) await browser.close();
  }
}
