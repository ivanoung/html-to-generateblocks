import postcss from "postcss";
import { canonicalizeRule } from "./css-canonicalizer.js";
import { isGbSupported } from "./gb-whitelist.js";
import { RejectionLog } from "./rejection-log.js";

export interface StructuredStyle {
  selector: string;
  name: string;
  styles: Record<string, unknown>;
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

      // If structured declarations exist, add to structured styles
      if (Object.keys(structuredDecls).length > 0) {
        structured.push({
          selector,
          name: classNameToName(selector),
          styles: structuredDecls,
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
