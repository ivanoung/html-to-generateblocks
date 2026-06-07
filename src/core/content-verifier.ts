// ── Content-Loss Verifier ────────────────────────────────────
//
// Compares source HTML text content against output block body content.
// Flags >5% loss as a warning — silent data loss (empty core/html,
// dropped inline elements) goes undetected until someone views the
// page in WordPress.

import * as cheerio from "cheerio";

export interface LossCheck {
  sourceTextLen: number;
  outputTextLen: number;
  lossPercent: number;
  warning: string | null; // null = no significant loss
}

const LOSS_THRESHOLD = 0.05; // 5%

/** Tags stripped from source before counting (not convertible content). */
const STRIP_TAGS = new Set([
  "nav", "footer", "script", "style", "link", "head", "title", "meta",
]);

export function checkContentLoss(sourceHtml: string, blockHtml: string): LossCheck {
  // 1. Strip known-removable elements from source
  const $source = cheerio.load(sourceHtml);
  for (const tag of STRIP_TAGS) {
    $source(tag).remove();
  }

  // Remove HTML comments from source
  let sourceText = $source("body").text() || $source.root().text() || "";
  sourceText = sourceText.replace(/<!--[\s\S]*?-->/g, "");
  sourceText = sourceText.replace(/\s+/g, " ").trim();
  const sourceLen = sourceText.length;

  // 2. Count text content of output blocks (excluding GB delimiters)
  let outputText = blockHtml
    .replace(/<!--\s*wp:[a-z]+\/[a-z-]+\s*\{[^}]*\}\s*-->/g, "")  // opener delim
    .replace(/<!--\s*\/wp:[a-z]+\/[a-z-]+\s*-->/g, "")              // closer delim
    .replace(/<!--[\s\S]*?-->/g, "")                                  // any remaining comments
    .replace(/<[^>]+>/g, " ")                                         // HTML tags → space
    .replace(/\s+/g, " ")
    .trim();
  const outputLen = outputText.length;

  // 3. Compare
  if (sourceLen === 0) {
    return { sourceTextLen: 0, outputTextLen: outputLen, lossPercent: 0, warning: null };
  }

  const lossPercent = Math.max(0, (sourceLen - outputLen) / sourceLen);

  const warning = lossPercent > LOSS_THRESHOLD
    ? `Page lost ~${Math.round(lossPercent * 100)}% of text content during conversion — check for missing elements`
    : null;

  return {
    sourceTextLen: sourceLen,
    outputTextLen: outputLen,
    lossPercent: Math.round(lossPercent * 10000) / 100,
    warning,
  };
}
