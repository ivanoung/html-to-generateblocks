// ── Manifest Validator (Phase 3) ───────────────────────────────
//
// Validates a SectionManifest produced by the coding agent.
// Checks schema correctness, selector validity, and coverage.

import * as cheerio from "cheerio";
import {
  SECTION_KINDS, GROUP_ROLES, ELEMENT_ROLES,
  type SectionManifest, type ManifestElement,
} from "../types/manifest.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Selectors that failed to match any element in the HTML. */
  missedSelectors: string[];
}

export function validateManifest(
  manifest: SectionManifest,
  sectionHtml: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missedSelectors: string[] = [];

  // Schema validation
  if (!manifest.sectionId || typeof manifest.sectionId !== "string") {
    errors.push("Missing or invalid sectionId");
  }
  if (!SECTION_KINDS.includes(manifest.kind as any)) {
    errors.push(`Invalid kind: "${manifest.kind}". Must be one of: ${SECTION_KINDS.join(", ")}`);
  }
  if (!Array.isArray(manifest.elements)) {
    errors.push("elements must be an array");
  }
  if (typeof manifest.coverage !== "number" || manifest.coverage < 0 || manifest.coverage > 100) {
    errors.push("coverage must be a number 0-100");
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, missedSelectors };
  }

  const $ = cheerio.load(`<div>${sectionHtml}</div>`);
  const selectorsToCheck: string[] = [];

  // Collect all selectors
  const collectSelectors = (els: ManifestElement[]) => {
    for (const el of els) {
      if (!ELEMENT_ROLES.includes(el.role as any)) {
        errors.push(`Invalid element role: "${el.role}"`);
      }
      selectorsToCheck.push(el.selector);
    }
  };

  collectSelectors(manifest.elements);

  if (manifest.groups) {
    for (const group of manifest.groups) {
      if (!GROUP_ROLES.includes(group.role as any)) {
        errors.push(`Invalid group role: "${group.role}"`);
      }
      selectorsToCheck.push(group.selector);
      collectSelectors(group.elements);
    }
  }

  if (manifest.templates) {
    for (const tmpl of manifest.templates) {
      selectorsToCheck.push(tmpl.selector);
      collectSelectors(tmpl.elements);
    }
  }

  if (manifest.exceptions) {
    for (const exc of manifest.exceptions) {
      selectorsToCheck.push(exc.selector);
    }
  }

  // Check each selector against the HTML
  for (const sel of selectorsToCheck) {
    try {
      const matches = $(sel);
      if (matches.length === 0) {
        missedSelectors.push(sel);
        errors.push(`Selector not found in HTML: "${sel}"`);
      } else if (matches.length > 1) {
        warnings.push(`Selector matches ${matches.length} elements: "${sel}" — using first`);
      }
    } catch (e: any) {
      errors.push(`Invalid selector: "${sel}" — ${e.message}`);
    }
  }

  // Coverage check
  if (manifest.coverage < 70) {
    warnings.push(`Low coverage (${manifest.coverage}%). Section may need manual review.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missedSelectors,
  };
}

/**
 * Merge manifest overrides from a JSON file.
 * Overrides replace matching sections by sectionId, or add new ones.
 */
export interface ManifestOverride {
  sectionId: string;
  kind?: string;
  layout?: string;
  elements?: ManifestElement[];
  groups?: any[];
  templates?: any[];
  exceptions?: any[];
  coverage?: number;
  _add?: ManifestElement[];
}

export function applyOverrides(
  manifest: SectionManifest,
  overrides: ManifestOverride[],
): SectionManifest {
  const override = overrides.find((o) => o.sectionId === manifest.sectionId);
  if (!override) return manifest;

  const result = { ...manifest };

  if (override.kind) result.kind = override.kind as any;
  if (override.layout) result.layout = override.layout as any;
  if (override.elements) result.elements = override.elements;
  if (override.groups) result.groups = override.groups as any;
  if (override.templates) result.templates = override.templates as any;
  if (override.exceptions) result.exceptions = override.exceptions as any;
  if (override.coverage !== undefined) result.coverage = override.coverage;

  if (override._add) {
    result.elements = [...result.elements, ...override._add];
  }

  return result;
}
