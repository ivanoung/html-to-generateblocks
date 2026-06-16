// ── CSS Splitter ───────────────────────────────────────────
//
// Splits compiled CSS into unique CSS (non-class rules: preflight,
// element selectors, @keyframes, @media, pseudo-elements, transforms,
// filters) and the structured counterpart via global-styles-data.
//
// All classification is delegated to CssClassifier. This module is
// a thin adapter for the styles-unique.css output file.

import { CssClassifier } from "./css-classifier.js";

export interface CssSplitResult {
  globalStyles: Array<{ selector: string; name: string; css: string }>;
  uniqueCss: string;
}

/**
 * Split compiled CSS using the canonicalized PostCSS classifier.
 * Returns styles-unique.css content and a rejection log string.
 */
export function splitCss(compiledCss: string): {
  uniqueCss: string;
  rejectionJson: string;
} {
  const result = CssClassifier.classify(compiledCss);
  const totalRules = result.structuredStyles.length +
    (result.rawCss.match(/\{/g) || []).length;
  return {
    uniqueCss: result.rawCss,
    rejectionJson: result.rejectionLog.toJSON(totalRules),
  };
}
