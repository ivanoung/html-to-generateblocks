import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Renderer ──────────────────────────────────────────────────
//
// Parses GB block markup, derives inline CSS from promoted GB
// attributes, strips delimiters, and injects CSS to produce a
// standalone, self-contained HTML page.

export interface ParsedBlock {
  blockName: string;
  attrs: Record<string, unknown>;
  rawJson: string;
  innerHtml: string;
  fullMatch: string;
}

/**
 * Parse all block delimiters from GB block output.
 * Extracts block JSON attributes and inner HTML.
 * Uses the same delimiter pattern as the validator.
 */
export function parseBlockDelimiters(raw: string): ParsedBlock[] {
  const results: ParsedBlock[] = [];
  // Match <!-- wp:blockname {json} -->
  const openerRegex = /<!--\s*wp:([a-z]+\/[a-z-]+)\s+(\{.*?\})\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = openerRegex.exec(raw)) !== null) {
    const blockName = match[1];
    let rawJson = match[2];
    let attrs: Record<string, unknown>;

    try {
      attrs = JSON.parse(rawJson);
    } catch {
      attrs = {};
    }

    // Find the closing delimiter
    const closeTag = `<!-- /wp:${blockName} -->`;
    const closeIdx = raw.indexOf(closeTag, match.index + match[0].length);
    const innerHtml = closeIdx !== -1
      ? raw.slice(match.index + match[0].length, closeIdx)
      : "";

    results.push({
      blockName,
      attrs,
      rawJson,
      innerHtml,
      fullMatch: closeIdx !== -1
        ? raw.slice(match.index, closeIdx + closeTag.length)
        : match[0],
    });
  }

  return results;
}

/** Properties that may appear in the css string (kebab-case patterns to check) */
const CSS_PROPERTY_CHECK: Record<string, RegExp> = {
  backgroundColor: /background-color\s*:/,
  backgroundImage: /background-image\s*:/,
  color: /(?<!\w)color\s*:/,
  backgroundSize: /background-size\s*:/,
  textColor: /(?<!\w)color\s*:/,
};

/**
 * Derive CSS properties from promoted GB attributes when they're
 * missing from the `css` string. Prevents the "magically appears"
 * problem where WordPress renders styles from attributes but a
 * standalone page would not.
 */
export function deriveCssFromAttrs(attrs: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  const cssStr = (attrs.css as string) || "";
  const styles = (attrs.styles as Record<string, unknown>) || {};

  // Merge top-level attrs with nested styles — top-level wins (GB promotion)
  const merged: Record<string, unknown> = { ...styles, ...attrs };

  // Map GB attribute → CSS property
  const mappings: Array<{ attr: string; cssProp: string }> = [
    { attr: "backgroundColor", cssProp: "backgroundColor" },
    { attr: "textColor", cssProp: "color" },
    { attr: "bgImageSize", cssProp: "backgroundSize" },
  ];

  for (const { attr, cssProp } of mappings) {
    const checkKey = attr in CSS_PROPERTY_CHECK ? attr : "";
    const pattern = checkKey ? CSS_PROPERTY_CHECK[checkKey] : null;
    const alreadyInCss = pattern ? pattern.test(cssStr) : false;
    if (!alreadyInCss && merged[attr] !== undefined && merged[attr] !== "" && merged[attr] !== null) {
      result[cssProp] = String(merged[attr]);
    }
  }

  // Handle bgImage specially (needs url() wrapper)
  if (merged.bgImage && typeof merged.bgImage === "string" && merged.bgImage.length > 0) {
    const checkPattern = CSS_PROPERTY_CHECK.backgroundImage;
    if (!checkPattern.test(cssStr)) {
      result.backgroundImage = `url(${merged.bgImage})`;
    }
  }

  // Handle gradient attributes
  if (merged.gradient && !cssStr.includes("linear-gradient") && !cssStr.includes("radial-gradient")) {
    const direction = (merged.gradientDirection as string) || "";
    const color1 = (merged.gradientColorOne as string) || "";
    const color2 = (merged.gradientColorTwo as string) || "";
    if (color1 && color2) {
      const gradParts = [merged.gradient, direction, color1, color2].filter(Boolean);
      result.background = `${gradParts[0]}(${gradParts.slice(1).join(",")})`;
    }
  }

  return result;
}

/**
 * Expand global-styles.json entries into CSS.
 * Each entry has {name, selector, css}.
 */
export function expandGlobalStyles(jsonPath: string): string {
  if (!existsSync(jsonPath)) return "";
  const raw = readFileSync(jsonPath, "utf-8");
  let entries: Array<{ name: string; selector: string; css: string }>;
  try {
    entries = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!Array.isArray(entries)) return "";
  return entries
    .map((e) => `${e.selector} { ${e.css} }`)
    .join("\n");
}

/**
 * Build a style attribute string from a property dictionary.
 */
function buildStyleAttr(styles: Record<string, string>): string {
  const entries = Object.entries(styles).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${v}`)
    .join(";");
}

/**
 * Extract font <link> tags from source HTML for injection into rendered page.
 */
function extractFontLinks(sourceHtml: string): string {
  const regex = /<link[^>]*fonts\.googleapis\.com[^>]*>/gi;
  const matches = sourceHtml.match(regex);
  return matches ? matches.join("\n") : "";
}

/**
 * Render a GB block output page as standalone HTML.
 *
 * @param outputDir - Path to output/<project>/ directory
 * @param pageName - Page name without extension (e.g., "index")
 * @param sourceHtml - Optional source HTML for font link extraction
 * @param injectJs - Whether to inject global.js (default false)
 */
export function renderStandalone(
  outputDir: string,
  pageName: string,
  sourceHtml?: string,
  injectJs = false,
): string {
  const pagesDir = resolve(outputDir, "pages");
  const setupDir = resolve(outputDir, "setup");

  // Read GB block output
  const blockPath = resolve(pagesDir, `${pageName}.html`);
  if (!existsSync(blockPath)) {
    throw new Error(`Block output not found: ${blockPath}`);
  }
  const rawBlocks = readFileSync(blockPath, "utf-8");

  // Read CSS files
  const stylesCss = existsSync(resolve(pagesDir, "styles.css"))
    ? readFileSync(resolve(pagesDir, "styles.css"), "utf-8") : "";
  const uniqueCss = existsSync(resolve(setupDir, "styles-unique.css"))
    ? readFileSync(resolve(setupDir, "styles-unique.css"), "utf-8") : "";
  const globalStylesCss = expandGlobalStyles(resolve(setupDir, "global-styles.json"));

  // Parse blocks
  const blocks = parseBlockDelimiters(rawBlocks);

  // Build rendered HTML: replace each block delimiter with the inner HTML,
  // injecting derived inline styles
  let rendered = rawBlocks;
  for (const block of blocks) {
    const derived = deriveCssFromAttrs(block.attrs);

    // If css string is non-empty, we inject it as a <style> tag (not inline)
    // For now, derived styles go on the element itself
    if (Object.keys(derived).length > 0) {
      const styleStr = buildStyleAttr(derived);
      if (styleStr) {
        // Insert style attribute into the first HTML tag in innerHtml
        const tagMatch = block.innerHtml.match(/<(\w+)([^>]*)>/);
        if (tagMatch) {
          const tagName = tagMatch[1];
          const existingAttrs = tagMatch[2];
          const hasStyle = /style\s*=\s*["']/.test(existingAttrs);
          let newAttrs: string;
          if (hasStyle) {
            newAttrs = existingAttrs.replace(/(style\s*=\s*["'])([^"']*)(["'])/, (_, prefix, val, suffix) => {
              return `${prefix}${val};${styleStr}${suffix}`;
            });
          } else {
            newAttrs = `${existingAttrs} style="${styleStr}"`;
          }
          const newTag = `<${tagName}${newAttrs}>`;
          block.innerHtml = block.innerHtml.replace(tagMatch[0], newTag);
        }
      }
    }

    // Replace the full block match (delimiter + innerHTML + closing delimiter) with just innerHTML
    rendered = rendered.replace(block.fullMatch, block.innerHtml);
  }

  // Extract font links if source provided
  const fontLinks = sourceHtml ? extractFontLinks(sourceHtml) : "";

  // Inject JS if requested
  const jsScript = injectJs && existsSync(resolve(setupDir, "global.js"))
    ? `<script>\n${readFileSync(resolve(setupDir, "global.js"), "utf-8")}\n</script>`
    : "";

  // Assemble full document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${fontLinks}
  <style>
/* ── Global Styles (from global-styles.json) ── */
${globalStylesCss}

/* ── Unique Styles (backgrounds, effects, colors) ── */
${uniqueCss}

/* ── Master Styles (compiled Tailwind CDN output) ── */
${stylesCss}
  </style>
</head>
<body>
${rendered}
${jsScript}
</body>
</html>`;
}
