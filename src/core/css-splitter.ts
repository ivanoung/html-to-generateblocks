// ── CSS Splitter ───────────────────────────────────────────
//
// Splits compiled CSS into three layers:
//   1. structuredStyles  → editable GenerateBlocks Global Styles
//   2. utilityCss        → tailwind-utilities.css (static Tailwind utilities)
//   3. uniqueCss         → styles-unique.css (non-utility raw CSS:
//                          element selectors, @keyframes, @media,
//                          unsupported properties, compound selectors)
//
// All classification is delegated to CssClassifier.

import { CssClassifier } from "./css-classifier.js";

export interface CssSplitResult {
  globalStyles: Array<{ selector: string; name: string; css: string }>;
  utilityCss: string;
  uniqueCss: string;
}

/**
 * Split compiled CSS using the canonicalized PostCSS classifier.
 * Returns tailwind-utilities.css content, styles-unique.css content,
 * and a rejection log string.
 */
export function splitCss(compiledCss: string): {
  utilityCss: string;
  uniqueCss: string;
  rejectionJson: string;
} {
  const result = CssClassifier.classify(compiledCss);
  const totalRules =
    result.structuredStyles.length +
    (result.utilityCss.match(/\{/g) || []).length +
    (result.uniqueCss.match(/\{/g) || []).length;
  return {
    utilityCss: result.utilityCss,
    uniqueCss: result.uniqueCss,
    rejectionJson: result.rejectionLog.toJSON(totalRules),
  };
}
