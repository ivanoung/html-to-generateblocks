// ── Preprocessor ───────────────────────────────────────────
//
// Prepares raw HTML for the DOM walker:
//   1. Strip <nav>, <footer>, <script>, <link>
//   2. Wrap <form>, body <style>, standalone <iconify-icon> in
//      <div data-gb-wrap="core-html"> markers
//   3. Scan <head> <style> blocks → classNameToProperties map
//      + customCss string (pseudo-classes, keyframes, vendor prefixes)

import * as cheerio from "cheerio";
import type { BlockStyles } from "./types.js";
import { parseStyleString } from "./style-parser.js";
import { extractTailwindConfig } from "./tailwind-resolver.js";

export interface PreprocessResult {
  html: string;
  classNameToProperties: Map<string, BlockStyles>;
  customCss: string;
  tailwindConfig: string | null;
  warnings: string[];
}

// Tags to strip entirely
const STRIP_TAGS = new Set(["nav", "footer", "script", "link"]);

// Elements to wrap in core-html markers
const WRAP_TAGS = new Set(["form"]);

// Inline tags — iconify-icon wrapped only when standalone
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "br", "cite", "code", "data", "del", "dfn",
  "em", "i", "iconify-icon", "ins", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

// Properties forbidden in GB styles objects
const FORBIDDEN_CSS_PATTERNS: RegExp[] = [
  /:hover/, /:focus/, /:active/, /:visited/, /:first-child/, /:last-child/,
  /:nth-child/, /:not\(/, /:is\(/, /:where\(/,
  /::before/, /::after/, /::placeholder/, /::selection/,
  /::-webkit-/, /::-moz-/, /::-ms-/,
  /@keyframes/, /@media/,
];

function isCssCompatible(ruleSelector: string, ruleProperties: string): boolean {
  for (const pattern of FORBIDDEN_CSS_PATTERNS) {
    if (pattern.test(ruleSelector) || pattern.test(ruleProperties)) {
      return false;
    }
  }
  return true;
}

/**
 * Parse <head> <style> blocks into:
 * - classNameToProperties: simple class definitions suitable for GB globalClasses
 * - customCss: everything else
 */
function scanHeadStyles($: cheerio.CheerioAPI): {
  classNameToProperties: Map<string, BlockStyles>;
  customCss: string;
} {
  const classNameToProperties = new Map<string, BlockStyles>();
  const customCssParts: string[] = [];

  $("head style").each((_, el) => {
    const cssText = $(el).text().trim();
    if (!cssText) return;

    // Split on } and look for selector { properties }
    const rules = cssText.split("}").filter((r) => r.trim());
    for (const rule of rules) {
      const braceIdx = rule.indexOf("{");
      if (braceIdx === -1) continue;
      const selector = rule.substring(0, braceIdx).trim();
      const properties = rule.substring(braceIdx + 1).trim();
      if (!selector || !properties) continue;

      // Only simple class selectors (no combinators, no pseudo)
      const simpleClassMatch = selector.match(/^\.([a-zA-Z_-][\w-]*)$/);
      if (simpleClassMatch && isCssCompatible(selector, properties)) {
        const className = simpleClassMatch[1];
        const fakeStyle = properties.replace(/;+/g, ";");
        const parsed = parseStyleString(fakeStyle);
        if (Object.keys(parsed.styles).length > 0 || parsed.css) {
          classNameToProperties.set(className, parsed.styles);
        }
      } else {
        customCssParts.push(`${selector}{${properties}}`);
      }
    }
  });

  return {
    classNameToProperties,
    customCss: customCssParts.join("\n"),
  };
}

/**
 * Check if an <iconify-icon> element is standalone (direct child of
 * a block-level element, NOT nested inside an inline parent).
 */
function isStandaloneIcon($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): boolean {
  const parentTag = ($el.parent().prop("tagName") || "").toLowerCase();
  return !INLINE_TAGS.has(parentTag) && parentTag !== "";
}

export function preprocess(rawHtml: string): PreprocessResult {
  const warnings: string[] = [];

  // 0. Extract tailwind config BEFORE cheerio strips <script>
  const tailwindConfig = extractTailwindConfig(rawHtml);

  const $ = cheerio.load(rawHtml);

  // 1. Strip nav, footer, script, link
  STRIP_TAGS.forEach((tag) => {
    const count = $(tag).length;
    if (count > 0) {
      warnings.push(`Stripped ${count} <${tag}> element(s)`);
      $(tag).remove();
    }
  });

  // 2. Scan <head> styles BEFORE modifying the body
  const { classNameToProperties, customCss } = scanHeadStyles($);

  // 3. Wrap <form> in core-html markers
  WRAP_TAGS.forEach((tag) => {
    $(tag).each((_, el) => {
      const $el = $(el);
      const outer = $.html($el);
      $el.replaceWith(`<div data-gb-wrap="core-html">${outer}</div>`);
    });
  });

  // Wrap body-level <style> blocks
  $("body style").each((_, el) => {
    const $el = $(el);
    const outer = $.html($el);
    $el.replaceWith(`<div data-gb-wrap="core-html">${outer}</div>`);
  });

  // 4. Wrap standalone <iconify-icon> elements
  $("iconify-icon").each((_, el) => {
    const $el = $(el);
    if (isStandaloneIcon($el, $)) {
      const outer = $.html($el);
      $el.replaceWith(`<div data-gb-wrap="core-html">${outer}</div>`);
    }
  });

  // 5. Extract cleaned HTML (body contents)
  const bodyHtml = $("body").html() || "";

  return {
    html: bodyHtml,
    classNameToProperties,
    customCss,
    tailwindConfig,
    warnings,
  };
}
