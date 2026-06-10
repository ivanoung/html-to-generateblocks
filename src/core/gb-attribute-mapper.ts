// ── GB Attribute Mapper ──────────────────────────────────
//
// Extracts GenerateBlocks top-level attributes from a flat
// BlockStyles object (camelCase keys from parseStyleString).
// Promoted properties are removed from remainingStyles.
// Unmappable properties stay in remainingStyles — no warnings.

import type { BlockStyles } from "./types.js";

export interface GbAttributeMapping {
  gbAttrs: Record<string, unknown>;
  remainingStyles: BlockStyles;
}

/**
 * Promote inline style properties that GB exposes as dedicated
 * top-level attributes. Currently handles:
 * - backgroundColor
 * - backgroundImage → bgImage + bgImageSize
 * - backgroundSize → bgOptions.size
 * - backgroundPosition → bgOptions.position
 * - backgroundRepeat → bgOptions.repeat
 * - backgroundAttachment → bgOptions.attachment
 * - color → textColor
 * - background (gradient shorthand) → gradient + direction + colors
 */
export function mapStylesToGbAttributes(styles: BlockStyles): GbAttributeMapping {
  const remaining: BlockStyles = { ...styles };
  const attrs: Record<string, unknown> = {};
  const bgOptions: Record<string, unknown> = {};

  // --- backgroundColor ---
  if ("backgroundColor" in remaining) {
    attrs.backgroundColor = remaining.backgroundColor;
    delete remaining.backgroundColor;
  }

  // --- backgroundImage → bgImage + bgImageSize ---
  if ("backgroundImage" in remaining) {
    const url = extractUrl(remaining.backgroundImage as string);
    if (url) {
      attrs.bgImage = { url };
      attrs.bgImageSize = "full";
      delete remaining.backgroundImage;
    }
  }

  // --- backgroundSize → bgOptions.size ---
  if ("backgroundSize" in remaining) {
    bgOptions.size = remaining.backgroundSize;
    delete remaining.backgroundSize;
  }

  // --- backgroundPosition → bgOptions.position ---
  if ("backgroundPosition" in remaining) {
    bgOptions.position = remaining.backgroundPosition;
    delete remaining.backgroundPosition;
  }

  // --- backgroundRepeat → bgOptions.repeat ---
  if ("backgroundRepeat" in remaining) {
    bgOptions.repeat = remaining.backgroundRepeat;
    delete remaining.backgroundRepeat;
  }

  // --- backgroundAttachment → bgOptions.attachment ---
  if ("backgroundAttachment" in remaining) {
    bgOptions.attachment = remaining.backgroundAttachment;
    delete remaining.backgroundAttachment;
  }

  // Set bgOptions with defaults only if at least one option was present
  if (Object.keys(bgOptions).length > 0) {
    attrs.bgOptions = {
      selector: "element",
      opacity: 1,
      overlay: false,
      ...bgOptions,
    };
  }

  // --- color → textColor ---
  if ("color" in remaining) {
    attrs.textColor = remaining.color;
    delete remaining.color;
  }

  // --- background (gradient shorthand) → gradient + colors ---
  if ("background" in remaining) {
    const gradient = parseGradient(remaining.background as string);
    if (gradient) {
      attrs.gradient = true;
      attrs.gradientDirection = gradient.direction;
      attrs.gradientColorOne = gradient.color1;
      attrs.gradientColorTwo = gradient.color2;
      delete remaining.background;
    }
  }

  return { gbAttrs: attrs, remainingStyles: remaining };
}

/** Extract URL from url("..."), url('...'), or url(...). */
function extractUrl(value: string): string | null {
  const match = value.match(/url\(["']?([^"')]+)["']?\)/);
  return match ? match[1] : null;
}

/** Parse linear-gradient(angle, color1, color2). Returns null for non-matching values. */
function parseGradient(
  value: string,
): { direction: number; color1: string; color2: string } | null {
  const match = value.match(/linear-gradient\((\d+)deg,\s*([^,]+),\s*([^)]+)\)/);
  if (!match) return null;
  return {
    direction: parseInt(match[1], 10),
    color1: match[2].trim(),
    color2: match[3].trim(),
  };
}
