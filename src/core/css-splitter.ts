// ── CSS Splitter ───────────────────────────────────────────
//
// Parses compiled CSS and splits into:
// - globalStyles: only custom CSS classes (from <style> blocks) — design tokens
// - uniqueCss: everything else (all Tailwind utilities, preflight, keyframes, etc.)

import css from "css";

export interface GlobalStyleEntry {
  name: string;
  selector: string;
  css: string;
}

export interface CssSplitResult {
  globalStyles: GlobalStyleEntry[];
  uniqueCss: string;
}

/**
 * Check if a CSS selector is a single class selector.
 * Matches: .foo, .foo\:bar, .foo\:bar:hover
 * Does NOT match: tag selectors, pseudo-elements (::), multi-selectors (a,b),
 *   combinators (a b, a>b, a+b, a~b)
 */
function isSingleClassSelector(selector: string): boolean {
  if (/::/.test(selector)) return false;

  const withoutPseudo = selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");

  const unescaped = withoutPseudo
    .replace(/\\:/g, ":")
    .replace(/\\\//g, "/")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\\#/g, "#")
    .replace(/\\\./g, ".");

  if (/[,\s>+~]/.test(unescaped)) return false;

  return /^\.[^,\s>+~]+$/.test(withoutPseudo) && !withoutPseudo.includes("::");
}

/**
 * Extract the base class name (without pseudo-classes).
 */
function extractBaseSelector(selector: string): string {
  return selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");
}

/**
 * Get the unescaped class name (no dot, no escapes).
 * .py-2\\.5 → py-2\\.5 (keeping the backslash for the CSS escape)
 * Actually we want the raw name: .blueprint-bg → blueprint-bg
 */
function getClassName(selector: string): string {
  const base = extractBaseSelector(selector);
  // Remove leading dot and unescape CSS special chars
  return base
    .replace(/^\./, "")
    .replace(/\\(.)/g, "$1");
}

/**
 * Convert a kebab-case class name to Title Case.
 */
function classNameToName(className: string): string {
  const clean = className.replace(/^\./, "").replace(/(:[a-zA-Z-]+)+$/, "");
  return clean
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Serialize a CSS rule AST node back to a CSS string.
 */
function serializeRule(rule: css.Rule | css.Media): string {
  if (rule.type === "media") {
    const media = rule as css.Media;
    const innerCss = (media.rules || [])
      .map((r) => serializeRule(r as css.Rule))
      .join("");
    return `@media ${media.media}{${innerCss}}`;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selector = (r.selectors || []).join(",");
    const declarations = (r.declarations || [])
      .map((d) => `${d.property}:${d.value}`)
      .join(";");
    return `${selector}{${declarations}${declarations ? ";" : ""}}`;
  }

  if (rule.type === "keyframes") {
    const kf = rule as css.KeyFrames;
    const keyframesCss = (kf.keyframes || [])
      .map((k) => {
        const decs = (k.declarations || [])
          .map((d) => `${d.property}:${d.value}`)
          .join(";");
        return `${k.values.join(",")}{${decs}${decs ? ";" : ""}}`;
      })
      .join("");
    return `@keyframes ${kf.name}{${keyframesCss}}`;
  }

  return "";
}

/**
 * Walk a CSS rule and classify it.
 * Custom classes (from <style> blocks) → globalStyles.
 * Everything else → uniqueCss.
 */
function walkRule(
  rule: css.Rule | css.Media,
  globalStyles: GlobalStyleEntry[],
  uniqueCssParts: string[],
  customClassNames: Set<string>,
): void {
  if (rule.type === "media") {
    // Media blocks always go to uniqueCss (responsive variants
    // need their @media wrapper)
    uniqueCssParts.push(serializeRule(rule));
    return;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selectors = r.selectors || [];

    if (
      selectors.length === 1 &&
      isSingleClassSelector(selectors[0]) &&
      customClassNames.has(getClassName(selectors[0]))
    ) {
      const selector = selectors[0];
      const baseSelector = extractBaseSelector(selector);
      const ruleCss = serializeRule(r);
      globalStyles.push({
        name: classNameToName(baseSelector),
        selector: baseSelector,
        css: ruleCss,
      });
    } else {
      // Everything else goes to uniqueCss
      uniqueCssParts.push(serializeRule(r));
    }
    return;
  }

  // Other types: keyframes, font-face, charset, etc. — always unique
  uniqueCssParts.push(serializeRule(rule));
}

/**
 * Split compiled CSS into globalStyles (custom classes only) and uniqueCss (everything else).
 *
 * @param compiledCss   The full compiled CSS
 * @param customClassNames  Set of unescaped class names (no dot) that are custom
 *                          design tokens from the source <style> blocks.
 */
export function splitCss(
  compiledCss: string,
  customClassNames?: Set<string>,
): CssSplitResult {
  const globalStyles: GlobalStyleEntry[] = [];
  const uniqueCssParts: string[] = [];
  const customSet = customClassNames ?? new Set<string>();

  if (!compiledCss.trim()) {
    return { globalStyles: [], uniqueCss: "" };
  }

  try {
    const ast = css.parse(compiledCss, { silent: true });
    const rules = ast.stylesheet?.rules || [];

    for (const rule of rules) {
      walkRule(rule as css.Rule | css.Media, globalStyles, uniqueCssParts, customSet);
    }
  } catch {
    return { globalStyles: [], uniqueCss: compiledCss };
  }

  // Deduplicate: merge entries with the same selector
  const merged = new Map<string, GlobalStyleEntry>();
  for (const entry of globalStyles) {
    const existing = merged.get(entry.selector);
    if (existing) {
      existing.css += entry.css;
    } else {
      merged.set(entry.selector, { ...entry });
    }
  }

  return {
    globalStyles: [...merged.values()],
    uniqueCss: uniqueCssParts.join(""),
  };
}
