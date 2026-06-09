// ── CSS Splitter ───────────────────────────────────────────
//
// Parses compiled CSS and splits into:
// - globalStyles: single-class rules suitable for GB Global Styles import
// - uniqueCss: everything else (preflight, element selectors, keyframes, etc.)

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
  // Check for pseudo-elements (::before, ::after, ::-webkit-*, etc.)
  if (/::/.test(selector)) return false;

  // Strip trailing pseudo-classes (:hover, :focus, :active, :first-child, etc.)
  // but only if the colon is NOT CSS-escaped (not preceded by backslash)
  const withoutPseudo = selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");

  // Remove CSS escaping for combinator detection — replace escapes with
  // the actual characters they represent (e.g., \: → :, \/ → /)
  const unescaped = withoutPseudo
    .replace(/\\:/g, ":")
    .replace(/\\\//g, "/")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\\#/g, "#")
    .replace(/\\\./g, ".");

  // Check for combinators or multiple selectors (commas, spaces, >, +, ~)
  if (/[,\s>+~]/.test(unescaped)) return false;

  // Must be a class selector: starts with ., no combinators, no pseudo-elements
  return /^\.[^,\s>+~]+$/.test(withoutPseudo) && !withoutPseudo.includes("::");
}

/**
 * Extract the base class name (without pseudo-classes) for the selector field.
 * .hover\:bg-seafoam:hover → .hover\:bg-seafoam
 */
function extractBaseSelector(selector: string): string {
  // Only strip pseudo-classes NOT CSS-escaped
  return selector.replace(/([^\\]|^)(:[a-zA-Z-]+)+$/, "$1");
}

/**
 * Convert a kebab-case class name to Title Case for human-readable name.
 * pt-32 → Pt 32, bg-primary → Bg Primary
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

  // keyframes, font-face, etc.
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
 * Check if a CSS selector is a "plain" single class selector —
 * no pseudo-classes, no opacity modifiers, no arbitrary values.
 * These are the safest entries for GB Global Styles import.
 */
function isPlainClassSelector(selector: string): boolean {
  if (!isSingleClassSelector(selector)) return false;

  // No opacity modifiers (slash in selector — e.g., .text-seafoam\/80)
  if (/\//.test(selector)) return false;

  // No arbitrary values (brackets — e.g., .text-\[#e2e8f0\])
  if (/\[/.test(selector)) return false;

  // No pseudo-classes (:hover, :focus, :active, :checked, etc.)
  // Check for a non-escaped colon before a pseudo-class name
  if (/[^\\]:/.test(selector)) return false;

  return true;
}

/**
 * Walk a CSS rule and classify it.
 */
function walkRule(
  rule: css.Rule | css.Media,
  parentMediaQuery: string | null,
  globalStyles: GlobalStyleEntry[],
  uniqueCssParts: string[],
): void {
  if (rule.type === "media") {
    const media = rule as css.Media;
    // Media blocks stay intact in uniqueCss (responsive variants
    // need their @media wrapper and can't go into global-styles.json)
    uniqueCssParts.push(serializeRule(rule));
    return;
  }

  if (rule.type === "rule") {
    const r = rule as css.Rule;
    const selectors = r.selectors || [];

    if (selectors.length === 1 && isPlainClassSelector(selectors[0])) {
      const selector = selectors[0];
      const baseSelector = extractBaseSelector(selector);
      const ruleCss = serializeRule(r);
      globalStyles.push({
        name: classNameToName(baseSelector),
        selector: baseSelector,
        css: ruleCss,
      });
    } else {
      // Everything else goes to uniqueCss (pseudo-classes, combinators,
      // multi-selectors, pseudo-elements, opacity modifiers, arbitrary values)
      uniqueCssParts.push(serializeRule(r));
    }
    return;
  }

  // Other types: keyframes, font-face, charset, etc. — always unique
  uniqueCssParts.push(serializeRule(rule));
}

/**
 * Split compiled CSS into globalStyles (single-class rules) and uniqueCss (everything else).
 */
export function splitCss(compiledCss: string): CssSplitResult {
  const globalStyles: GlobalStyleEntry[] = [];
  const uniqueCssParts: string[] = [];

  if (!compiledCss.trim()) {
    return { globalStyles: [], uniqueCss: "" };
  }

  try {
    const ast = css.parse(compiledCss, { silent: true });
    const rules = ast.stylesheet?.rules || [];

    for (const rule of rules) {
      walkRule(rule as css.Rule | css.Media, null, globalStyles, uniqueCssParts);
    }
  } catch {
    return { globalStyles: [], uniqueCss: compiledCss };
  }

  // Deduplicate: merge entries with the same selector (e.g., .container
  // appears at top-level and inside multiple @media breakpoints)
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
