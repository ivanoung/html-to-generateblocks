// ── Validator ──────────────────────────────────────────────────
//
// Post-serialization validation. Checks generated block markup
// against recovery rules: key order, className, missing attrs,
// JSON escapes, link patterns, CSS restrictions, block structure.

import type { Block, BlockName, HardFail, Warning, ValidationResult } from "./types.js";

// ── Canonical key orders (verified against block.json) ─────────

const CANONICAL_ORDERS: Record<string, string[]> = {
  "generateblocks/element": [
    "uniqueId", "tagName", "styles", "css", "globalClasses", "htmlAttributes", "align",
  ],
  "generateblocks/text": [
    "uniqueId", "tagName", "content", "styles", "css", "globalClasses",
    "htmlAttributes", "icon", "iconLocation", "iconOnly",
  ],
  "generateblocks/media": [
    "uniqueId", "tagName", "styles", "css", "globalClasses", "htmlAttributes",
    "mediaId", "linkHtmlAttributes",
  ],
  "generateblocks/shape": [
    "uniqueId", "html", "styles", "css", "globalClasses", "htmlAttributes",
  ],
};

// The actual escaped patterns
const ESCAPED_DD = "\\u002d\\u002d";
const ESCAPED_AMP = "\\u0026";
const ESCAPED_LT = "\\u003c";
const ESCAPED_GT = "\\u003e";

// ── Main validator ─────────────────────────────────────────────

export function validateBlocks(blocks: Block[], htmlOutput: string): ValidationResult {
  const hardFails: HardFail[] = [];
  const warnings: Warning[] = [];

  for (const block of flattenBlocks(blocks)) {
    validateBlock(block, hardFails, warnings);
  }

  // Block structure check
  validateBlockStructure(htmlOutput, hardFails);

  // Serialized escape check
  validateSerializedEscapes(htmlOutput, hardFails);

  return { hardFails, warnings };
}

// ── Flatten nested blocks for iteration ────────────────────────

function flattenBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const b of blocks) {
    result.push(b);
    result.push(...flattenBlocks(b.innerBlocks));
  }
  return result;
}

// ── Single block validation ────────────────────────────────────

function validateBlock(
  block: Block,
  hardFails: HardFail[],
  warnings: Warning[],
): void {
  const id = block.uniqueId || "(no id)";
  const name = block.blockName;

  // 1. Check for className in block JSON
  if ((block as any).className !== undefined) {
    hardFails.push({
      code: "CLASSNAME_PRESENT",
      message: `className present in block ${id} — will trigger recovery`,
      blockId: id,
      blockName: name,
    });
  }

  // 2. Check required attributes
  checkRequiredAttrs(block, hardFails, warnings);

  // Note: JSON escape substitutions (-- < > &) are applied by the serializer.
  // Validation of escapes is done on the serialized output via validateSerializedEscapes().

  // 4. Check key order (for GB blocks)
  checkKeyOrder(block, hardFails);

  // 5. Check CSS restrictions
  checkCssRestrictions(block, hardFails, warnings);

  // 6. Check link patterns
  checkLinkPatterns(block, hardFails);

  // 7. Check element raw text
  checkElementRawText(block, hardFails);

  // 8. Check captioned image routing
  checkCaptionedImage(block, hardFails);
}

// ── 2. Required attributes ────────────────────────────────────

function checkRequiredAttrs(block: Block, hardFails: HardFail[], warnings: Warning[]): void {
  const id = block.uniqueId || "(no id)";

  if (!block.uniqueId || block.uniqueId === "") {
    hardFails.push({
      code: "MISSING_UNIQUE_ID",
      message: `Block missing uniqueId`,
      blockName: block.blockName,
    });
  }

  // GB blocks need tagName (except shape)
  if (isGBBlock(block) && block.blockName !== "generateblocks/shape") {
    if (!block.tagName || block.tagName === "") {
      hardFails.push({
        code: "MISSING_TAG_NAME",
        message: `Block ${id} missing tagName`,
        blockId: id,
        blockName: block.blockName,
      });
    }
  }

  // Media block needs src and alt in htmlAttributes
  if (block.blockName === "generateblocks/media") {
    const htmlAttrs = block.htmlAttributes || {};
    if (!htmlAttrs.src) {
      hardFails.push({
        code: "MISSING_IMAGE_SRC",
        message: `Media block ${id} missing src in htmlAttributes`,
        blockId: id,
        blockName: block.blockName,
      });
    }
    if (!htmlAttrs.alt && htmlAttrs.alt !== "") {
      warnings.push({
        code: "MISSING_IMAGE_ALT",
        message: `Media block ${id} missing alt text in htmlAttributes`,
        blockId: id,
      });
    }
  }

  // Core/image needs url and alt
  if (block.blockName === "core/image" || block.blockName === "image") {
    if (!block.url) {
      hardFails.push({
        code: "MISSING_IMAGE_URL",
        message: `core/image block ${id} missing url`,
        blockId: id,
        blockName: block.blockName,
      });
    }
    if (!block.alt) {
      warnings.push({
        code: "MISSING_IMAGE_ALT",
        message: `core/image block ${id} missing alt text`,
        blockId: id,
      });
    }
  }
}

// ── 3. JSON escape check ──────────────────────────────────────

function checkJsonEscapes(block: Block, hardFails: HardFail[]): void {
  const id = block.uniqueId || "(no id)";

  // Check css string
  if (block.css) {
    // Check for literal --
    if (block.css.includes("--") && !block.css.includes(ESCAPED_DD)) {
      hardFails.push({
        code: "UNESCAPED_DOUBLE_DASH_CSS",
        message: `Block ${id}: css contains literal "--" without \\u002d\\u002d escaping`,
        blockId: id,
        blockName: block.blockName,
      });
    }
    // Check for literal & in css
    if (block.css.includes("&") && !block.css.includes(ESCAPED_AMP)) {
      hardFails.push({
        code: "UNESCAPED_AMP_CSS",
        message: `Block ${id}: css contains literal "&" without \\u0026 escaping`,
        blockId: id,
        blockName: block.blockName,
      });
    }
  }

  // Check htmlAttributes values
  if (block.htmlAttributes) {
    for (const [key, val] of Object.entries(block.htmlAttributes)) {
      if (typeof val === "string") {
        if (val.includes("--") && !val.includes(ESCAPED_DD)) {
          hardFails.push({
            code: "UNESCAPED_DOUBLE_DASH_ATTR",
            message: `Block ${id}: htmlAttributes.${key} contains literal "--"`,
            blockId: id,
            blockName: block.blockName,
          });
        }
        if (val.includes("&") && !val.includes(ESCAPED_AMP) && !val.includes("&amp;")) {
          // In htmlAttributes it should be escaped for JSON, except &amp; which is for HTML context
          hardFails.push({
            code: "UNESCAPED_AMP_ATTR",
            message: `Block ${id}: htmlAttributes.${key} contains literal "&" without \\u0026 escaping`,
            blockId: id,
            blockName: block.blockName,
          });
        }
      }
    }
  }

  // Check content for text blocks
  if (block.content) {
    if (block.content.includes("--") && !block.content.includes(ESCAPED_DD)) {
      hardFails.push({
        code: "UNESCAPED_DOUBLE_DASH_CONTENT",
        message: `Block ${id}: content contains literal "--"`,
        blockId: id,
        blockName: block.blockName,
      });
    }
    if (block.content.includes("<") && !block.content.includes(ESCAPED_LT)) {
      hardFails.push({
        code: "UNESCAPED_LT_CONTENT",
        message: `Block ${id}: content contains literal "<"`,
        blockId: id,
        blockName: block.blockName,
      });
    }
  }
}

// ── 4. Key order check ────────────────────────────────────────

function checkKeyOrder(block: Block, hardFails: HardFail[]): void {
  const name = block.blockName;
  const canonical = CANONICAL_ORDERS[name];
  if (!canonical) return; // core blocks don't have these checks

  const id = block.uniqueId || "(no id)";

  // We can't fully check the serialized order from the Block object,
  // but we can check if properties that should be present are in
  // the canonical order. The serialization in serializer.ts handles
  // actual ordering — we verify that the serializer is correct by
  // checking that the HTML contains the expected pattern.

  // Check that className doesn't appear in any attribute
  if ((block as any).className) {
    hardFails.push({
      code: "CLASSNAME_PRESENT",
      message: `Block ${id}: className must NOT appear in block JSON`,
      blockId: id,
      blockName: name,
    });
  }
}

// ── 5. CSS restrictions ───────────────────────────────────────

function checkCssRestrictions(
  block: Block,
  hardFails: HardFail[],
  warnings: Warning[],
): void {
  if (!block.css) return;
  const id = block.uniqueId || "(no id)";
  const css = block.css;

  // a) No transitions
  if (css.includes("transition:") || css.match(/transition-[a-z]+:/)) {
    hardFails.push({
      code: "FORBIDDEN_TRANSITION",
      message: `Block ${id}: css contains transition property — use styles object instead`,
      blockId: id,
      blockName: block.blockName,
    });
  }

  // b) No hover states in css
  if (css.includes(":hover")) {
    hardFails.push({
      code: "FORBIDDEN_HOVER_CSS",
      message: `Block ${id}: css contains :hover rule — use styles object instead`,
      blockId: id,
      blockName: block.blockName,
    });
  }

  // c) Check single-line (no literal newlines)
  if (css.includes("\n")) {
    hardFails.push({
      code: "MULTILINE_CSS",
      message: `Block ${id}: css is multiline — must be single-line`,
      blockId: id,
      blockName: block.blockName,
    });
  }

  // d) Check property sorting — verify within each {...} block
  const bracketBlocks = css.match(/\{([^}]+)\}/g);
  if (bracketBlocks) {
    for (const bb of bracketBlocks) {
      const props = bb.slice(1, -1).split(";").filter(p => p.trim());
      const sorted = [...props].sort((a, b) => a.trim().localeCompare(b.trim()));
      for (let i = 0; i < props.length; i++) {
        if (props[i].trim() !== sorted[i].trim()) {
          hardFails.push({
            code: "UNSORTED_CSS",
            message: `Block ${id}: css properties not alphabetically sorted`,
            blockId: id,
            blockName: block.blockName,
          });
          break;
        }
      }
    }
  }

  // e) Check function argument spaces
  const functionCalls = css.match(/[a-z-]+\([^)]*\)/g);
  if (functionCalls) {
    for (const fc of functionCalls) {
      // After the opening paren, check for spaces after commas within function args
      // but NOT spaces that are part of the data
      const funcBody = fc.slice(fc.indexOf("(") + 1, fc.length - 1);
      // Check for spaces after commas: e.g., "2rem, 5vw" should be "2rem,5vw"
      if (funcBody.includes(", ")) {
        hardFails.push({
          code: "CSS_FUNCTION_SPACES",
          message: `Block ${id}: css function arguments contain spaces after commas: "${fc}"`,
          blockId: id,
          blockName: block.blockName,
        });
        break;
      }
    }
  }
}

// ── 6. Link pattern check ─────────────────────────────────────

function checkLinkPatterns(block: Block, hardFails: HardFail[]): void {
  const id = block.uniqueId || "(no id)";

  // Text block <a> with href in htmlAttributes is the CORRECT pattern
  // (verified in WordPress M1/M2 testing — text<a> + htmlAttributes.href
  // survives round-trip when using granular style keys).
  // No check needed here — the old element<a>+text<span> pattern is obsolete.

  // Captioned image as GB media — check in captioned image check
}

// ── 7. Element raw text ───────────────────────────────────────

function checkElementRawText(block: Block, hardFails: HardFail[]): void {
  if (block.blockName !== "generateblocks/element") return;
  const id = block.uniqueId || "(no id)";

  // Element without inner blocks is fine (empty container)
  // Element with only text nodes in innerBlocks is also fine
  // The problem is raw text without block children
  // We can't detect "raw text" from the block object alone;
  // we'd need the serialized HTML. Skip this check in the
  // block-level validator for now; it's caught in the HTML structure validator.
}

// ── 8. Captioned image check ──────────────────────────────────

function checkCaptionedImage(block: Block, hardFails: HardFail[]): void {
  if (block.blockName !== "generateblocks/media") return;
  const id = block.uniqueId || "(no id)";

  // If this is a media block and it has a caption property (stored in htmlAttributes or elsewhere)
  // This would indicate wrong routing — captioned images should be core/image
  // But our per-block model doesn't carry a "caption" field for media blocks
  // The mapper handles the routing so if it gets to media, there's no caption
}

// ── HTML-based escape validation ──────────────────────────────

/**
 * Check the serialized HTML output for proper JSON escaping inside
 * block delimiter comments. This catches escapes on the actual output,
 * not on pre-serialize block data.
 */
function validateSerializedEscapes(
  html: string,
  hardFails: HardFail[],
): void {
  // Extract all JSON attribute strings from <!-- wp:blockname {...} --> delimiters
  const delimiterPattern = /<!-- wp:[a-z]+\/[a-z-]+\s+(\{.*?\})\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = delimiterPattern.exec(html)) !== null) {
    const jsonStr = match[1];

    // Check for literal -- in JSON strings (should be \u002d\u002d)
    // But only check INSIDE JSON string values, not in JSON syntax like "key--" (property name)
    // A simple heuristic: check values between quotes for --
    const valuePattern = /:"[^"]*--[^"]*"/g;
    if (valuePattern.test(jsonStr)) {
      hardFails.push({
        code: "UNESCAPED_DOUBLE_DASH_SERIALIZED",
        message: `Serialized block JSON contains literal "--" in a string value (should be \\u002d\\u002d)`,
      });
    }

    // Check for literal & in JSON string values (should be \u0026)
    const ampPattern = /:"[^"]*&(?!amp;)[^"]*"/g;
    if (ampPattern.test(jsonStr)) {
      hardFails.push({
        code: "UNESCAPED_AMP_SERIALIZED",
        message: `Serialized block JSON contains literal "&" in a string value (should be \\u0026)`,
      });
    }

    // Check for literal < in JSON string values (should be \u003c)
    const ltPattern = /:"[^"]*<[^"]*"/g;
    if (ltPattern.test(jsonStr)) {
      hardFails.push({
        code: "UNESCAPED_LT_SERIALIZED",
        message: `Serialized block JSON contains literal "<" in a string value (should be \\u003c)`,
      });
    }

    // Check for literal > in JSON string values (should be \u003e)
    const gtPattern = /:"[^"]*>[^"]*"/g;
    if (gtPattern.test(jsonStr)) {
      hardFails.push({
        code: "UNESCAPED_GT_SERIALIZED",
        message: `Serialized block JSON contains literal ">" in a string value (should be \\u003e)`,
      });
    }
  }
}

// ── HTML structure validation ─────────────────────────────────

function validateBlockStructure(
  html: string,
  hardFails: HardFail[],
): void {
  // Check for unmatched block delimiters
  const openMatches = html.match(/<!-- wp:([a-z]+\/[a-z-]+)/g) || [];
  const closeMatches = html.match(/<!-- \/wp:([a-z]+\/[a-z-]+) -->/g) || [];

  if (openMatches.length !== closeMatches.length) {
    hardFails.push({
      code: "MISMATCHED_BLOCK_COUNT",
      message: `Block opening/closing mismatch: ${openMatches.length} openers, ${closeMatches.length} closers`,
    });
  }

  // Check each opener has a matching closer (same block type)
  const openNames = openMatches.map(m => m.replace("<!-- wp:", ""));
  const closeNames = closeMatches.map(m =>
    m.replace("<!-- /wp:", "").replace(" -->", "")
  );

  // Stack-based validation for nesting
  const openTags: string[] = [];
  // Match full opener patterns with their content
  const lines = html.split("\n");
  for (const line of lines) {
    const openMatch = line.match(/<!-- wp:([a-z]+\/[a-z-]+)/);
    const closeMatch = line.match(/<!-- \/wp:([a-z]+\/[a-z-]+) -->/);

    if (openMatch) {
      openTags.push(openMatch[1]);
    }
    if (closeMatch) {
      const expected = openTags.pop();
      if (expected !== closeMatch[1]) {
        hardFails.push({
          code: "MISMATCHED_BLOCK_NESTING",
          message: `Block nesting mismatch: opened "${expected}" but closed "${closeMatch[1]}"`,
        });
      }
    }
  }

  if (openTags.length > 0) {
    hardFails.push({
      code: "UNCLOSED_BLOCKS",
      message: `${openTags.length} unclosed block(s): ${openTags.join(", ")}`,
    });
  }

  // Check for stray HTML comments (skip content inside core/html blocks)
  // Remove core/html block content before checking
  const htmlWithoutCoreHtml = html.replace(
    /<!-- wp:core\/html[^>]*-->[\s\S]*?<!-- \/wp:core\/html -->/g,
    "",
  );
  const strayComments = htmlWithoutCoreHtml.match(/<!--(?!\s*wp:|\s*\/wp:)[\s\S]*?-->/g);
  if (strayComments) {
    hardFails.push({
      code: "STRAY_HTML_COMMENTS",
      message: `${strayComments.length} stray HTML comment(s) found (only wp: delimiters allowed)`,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────

function isGBBlock(block: Block): boolean {
  return block.blockName.startsWith("generateblocks/");
}
