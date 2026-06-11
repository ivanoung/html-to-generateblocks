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

  // Map GB attribute → CSS property, with optional value transform
  const mappings: Array<{ attr: string; cssProp: string }> = [
    { attr: "backgroundColor", cssProp: "backgroundColor" },
    { attr: "textColor", cssProp: "color" },
    { attr: "bgImageSize", cssProp: "backgroundSize" },
  ];

  for (const { attr, cssProp } of mappings) {
    const checkKey = attr in CSS_PROPERTY_CHECK ? attr : "";
    const pattern = checkKey ? CSS_PROPERTY_CHECK[checkKey] : null;
    const alreadyInCss = pattern ? pattern.test(cssStr) : false;
    if (!alreadyInCss && attrs[attr] !== undefined && attrs[attr] !== "" && attrs[attr] !== null) {
      result[cssProp] = String(attrs[attr]);
    }
  }

  // Handle bgImage specially (needs url() wrapper)
  if (attrs.bgImage && typeof attrs.bgImage === "string" && attrs.bgImage.length > 0) {
    const checkPattern = CSS_PROPERTY_CHECK.backgroundImage;
    if (!checkPattern.test(cssStr)) {
      result.backgroundImage = `url(${attrs.bgImage})`;
    }
  }

  // Handle gradient attributes
  if (attrs.gradient && !cssStr.includes("linear-gradient") && !cssStr.includes("radial-gradient")) {
    const direction = (attrs.gradientDirection as string) || "";
    const color1 = (attrs.gradientColorOne as string) || "";
    const color2 = (attrs.gradientColorTwo as string) || "";
    if (color1 && color2) {
      const gradParts = [attrs.gradient, direction, color1, color2].filter(Boolean);
      result.background = `${gradParts[0]}(${gradParts.slice(1).join(",")})`;
    }
  }

  return result;
}
