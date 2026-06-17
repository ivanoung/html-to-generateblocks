import postcss from "postcss";
import { canonicalizeRule } from "./css-canonicalizer.js";
import { isGbSupported } from "./gb-whitelist.js";
import { RejectionLog } from "./rejection-log.js";

export interface StructuredStyle {
  selector: string;
  name: string;
  styles: Record<string, unknown>;
  canonicalizedCss: string;
}

export interface ClassificationResult {
  structuredStyles: StructuredStyle[];
  rawCss: string;
  rejectionLog: RejectionLog;
}

function classNameToName(className: string): string {
  return className
    .replace(/^\./, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ── Shorthand Expander ────────────────────────────────

/**
 * Expand CSS shorthand properties to longhands.
 * GB's data format uses longhands exclusively.
 */
function expandShorthands(decls: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...decls };

  // margin: X → marginTop/Right/Bottom/Left
  if (result.margin) {
    const parts = result.margin.split(/\s+/);
    delete result.margin;
    if (parts.length === 1) {
      result.marginTop = result.marginRight = result.marginBottom = result.marginLeft = parts[0];
    } else if (parts.length === 2) {
      result.marginTop = result.marginBottom = parts[0];
      result.marginRight = result.marginLeft = parts[1];
    } else if (parts.length === 3) {
      result.marginTop = parts[0];
      result.marginRight = result.marginLeft = parts[1];
      result.marginBottom = parts[2];
    } else if (parts.length === 4) {
      result.marginTop = parts[0];
      result.marginRight = parts[1];
      result.marginBottom = parts[2];
      result.marginLeft = parts[3];
    }
  }

  // padding: X → paddingTop/Right/Bottom/Left
  if (result.padding) {
    const parts = result.padding.split(/\s+/);
    delete result.padding;
    if (parts.length === 1) {
      result.paddingTop = result.paddingRight = result.paddingBottom = result.paddingLeft = parts[0];
    } else if (parts.length === 2) {
      result.paddingTop = result.paddingBottom = parts[0];
      result.paddingRight = result.paddingLeft = parts[1];
    } else if (parts.length === 3) {
      result.paddingTop = parts[0];
      result.paddingRight = result.paddingLeft = parts[1];
      result.paddingBottom = parts[2];
    } else if (parts.length === 4) {
      result.paddingTop = parts[0];
      result.paddingRight = parts[1];
      result.paddingBottom = parts[2];
      result.paddingLeft = parts[3];
    }
  }

  // border: Npx style color → borderWidth/Style/Color
  if (result.border) {
    const parts = result.border.split(/\s+/);
    delete result.border;
    if (parts.length >= 1) {
      result.borderTopWidth = result.borderRightWidth = result.borderBottomWidth = result.borderLeftWidth = parts[0];
    }
    if (parts.length >= 2) {
      result.borderTopStyle = result.borderRightStyle = result.borderBottomStyle = result.borderLeftStyle = parts[1];
    }
    if (parts.length >= 3) {
      result.borderTopColor = result.borderRightColor = result.borderBottomColor = result.borderLeftColor = parts[2];
    }
  }

  // border-radius: X → borderTopLeftRadius etc.
  if (result.borderRadius) {
    const parts = result.borderRadius.split(/\s+/);
    delete result.borderRadius;
    if (parts.length === 1) {
      result.borderTopLeftRadius = result.borderTopRightRadius = result.borderBottomLeftRadius = result.borderBottomRightRadius = parts[0];
    } else if (parts.length === 2) {
      result.borderTopLeftRadius = result.borderBottomRightRadius = parts[0];
      result.borderTopRightRadius = result.borderBottomLeftRadius = parts[1];
    } else if (parts.length === 3) {
      result.borderTopLeftRadius = parts[0];
      result.borderTopRightRadius = result.borderBottomLeftRadius = parts[1];
      result.borderBottomRightRadius = parts[2];
    } else if (parts.length === 4) {
      result.borderTopLeftRadius = parts[0];
      result.borderTopRightRadius = parts[1];
      result.borderBottomRightRadius = parts[2];
      result.borderBottomLeftRadius = parts[3];
    }
  }

  return result;
}

// ── GB Import Format Generator ─────────────────────────

export class CssClassifier {
  static classify(css: string): ClassificationResult {
    const root = postcss.parse(css, { from: undefined });
    const structured: StructuredStyle[] = [];
    const rawParts: string[] = [];
    const rejectionLog = new RejectionLog();

    const seenRawSelectors = new Set<string>();

    // Walk all rules
    root.walkRules((rule) => {
      const selector = rule.selector.trim();

      // Route non-class selectors to raw CSS
      if (!selector.startsWith(".")) {
        rawParts.push(rule.toString());
        rejectionLog.add(selector, "NON_CLASS_SELECTOR", undefined, "expected");
        return;
      }

      // Route compound selectors to raw CSS
      if (/\s/.test(selector) || />|~|\+|,/.test(selector)) {
        rawParts.push(rule.toString());
        rejectionLog.add(selector, "COMPOUND_SELECTOR", undefined, "expected");
        return;
      }

      // Canonicalize
      const canonResult = canonicalizeRule(rule);
      if (canonResult.skipped) {
        rawParts.push(rule.toString());
        rejectionLog.add(selector, "CANONICALIZE_SKIPPED", undefined, "expected");
        return;
      }
      for (const w of canonResult.warnings) {
        rejectionLog.add(selector, w, undefined, "warning");
      }

      // Split declarations: GB-compatible → structured, rest → raw CSS
      const structuredDecls: Record<string, string> = {};
      const rawDecls: string[] = [];

      for (const node of rule.nodes) {
        if (node.type !== "decl") continue;
        const decl = node as postcss.Declaration;
        const camelProp = kebabToCamel(decl.prop);

        // Skip custom properties (--tw-*, --brand-*, etc.)
        if (decl.prop.startsWith("--")) continue;

        if (isGbSupported(camelProp, decl.value)) {
          structuredDecls[camelProp] = decl.value;
        } else {
          rawDecls.push(`${decl.prop}: ${decl.value}`);
          rejectionLog.add(selector, "UNSUPPORTED_PROPERTY", camelProp, "expected");
        }
      }

      // Capture canonicalized CSS string for the import format (after var resolution,
      // before splitting GB-compatible from GB-incompatible declarations)
      const canonicalizedCss = rule.toString();

      // If structured declarations exist, add to structured styles
      if (Object.keys(structuredDecls).length > 0) {
        structured.push({
          selector,
          name: classNameToName(selector),
          styles: expandShorthands(structuredDecls),
          canonicalizedCss,
        });
      }

      // If raw declarations exist, add a rule with only raw decls to raw CSS
      if (rawDecls.length > 0) {
        const rawRule = `${selector} {\n  ${rawDecls.join(";\n  ")};\n}`;
        rawParts.push(rawRule);
      }
    });

    // Capture @keyframes, @layer etc. for raw CSS
    root.walk((node) => {
      if (node.type === "atrule") {
        const atRule = node as postcss.AtRule;
        if (atRule.name === "keyframes") {
          rawParts.push(atRule.toString());
          rejectionLog.add(`@keyframes ${atRule.params}`, "ATRULE_KEYFRAMES", undefined, "expected");
        }
      }
    });

    // Collect remaining non-class selectors from root (body, html, *, ::selection)
    root.walkRules((rule) => {
      const selector = rule.selector.trim();
      if (/^[a-z*]|^::/.test(selector)) {
        const ruleStr = rule.toString();
        // Dedupe — may have been captured above
        if (!seenRawSelectors.has(selector.substring(0, 50))) {
          seenRawSelectors.add(selector.substring(0, 50));
          rawParts.push(ruleStr);
        }
      }
    });

    return {
      structuredStyles: structured,
      rawCss: rawParts.join("\n\n") + "\n",
      rejectionLog,
    };
  }
}

// ── GB Import Format Generator ─────────────────────────

/**
 * Generate GB's native import format: a flat array of
 * {selector, css, data} objects suitable for direct import
 * into GenerateBlocks → Global Styles.
 */
export function generateGbImportFormat(
  structuredStyles: StructuredStyle[],
): Array<{ selector: string; css: string; data: Record<string, unknown> }> {
  return structuredStyles.map((s) => ({
    selector: s.selector,
    css: s.canonicalizedCss,
    data: s.styles,
  }));
}
