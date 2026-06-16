// ── Global Styles Data Generator ────────────────────────────
//
// Parses compiled CSS via the PostCSS AST pipeline (CssClassifier)
// and generates structured gb_style_data objects matching the
// gblocks_styles post type format (GB Pro 1.9+).
//
// All classification and canonicalization is delegated to
// CssClassifier. This module is a thin adapter that formats the
// classifier output into the global-styles.json manifest schema.

import { CssClassifier } from "./css-classifier.js";

// ── Types ────────────────────────────────────────────────

export interface GbStyleDataEntry {
  selector: string;         // CSS selector for this style, e.g. ".pt-32"
  name: string;             // Human-readable name, e.g. "Pt 32"
  styles: Record<string, unknown>;  // gb_style_data structured object
  raw?: boolean;            // true if this class uses unsupported properties
}

export interface GlobalStylesManifest {
  version: string;
  styles: GbStyleDataEntry[];
}

// ── Main Generator ──────────────────────────────────────

/**
 * Generate structured gb_style_data using the canonicalized
 * PostCSS AST pipeline with --tw-*-opacity resolution.
 */
export function generateGlobalStylesData(compiledCss: string): {
  editable: GbStyleDataEntry[];
  raw: GbStyleDataEntry[];
  rejectionJson: string;
} {
  const result = CssClassifier.classify(compiledCss);

  const editable: GbStyleDataEntry[] = result.structuredStyles.map((s) => ({
    selector: s.selector,
    name: s.name,
    styles: s.styles,
  }));

  const raw: GbStyleDataEntry[] = [];
  const rawSelectors = new Set<string>();
  const selectorMatches = result.rawCss.matchAll(/^([.#][^\s{]+)\s*\{/gm);
  for (const m of selectorMatches) {
    rawSelectors.add(m[1]);
  }
  for (const sel of rawSelectors) {
    raw.push({ selector: sel, name: sel.replace(/^\./, ""), styles: {}, raw: true });
  }

  const totalRules = editable.length + raw.length;
  return {
    editable,
    raw,
    rejectionJson: result.rejectionLog.toJSON(totalRules),
  };
}

// ── Manifest Builder ────────────────────────────────────

/**
 * Serialize the full global-styles.json manifest including
 * structured gb_style_data entries and raw CSS class entries.
 */
export function buildGlobalStylesManifest(
  editable: GbStyleDataEntry[],
  raw: GbStyleDataEntry[],
  rawCssEntries: Array<{ selector: string; css: string }>,
): GlobalStylesManifest {
  return {
    version: "1.0",
    styles: [
      ...editable.map((e) => ({
        selector: e.selector,
        name: e.name,
        styles: e.styles,
        raw: false,
      })),
      ...raw.map((e) => ({
        selector: e.selector,
        name: e.name,
        styles: e.styles,
        raw: true,
      })),
    ],
  };
}
