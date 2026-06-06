// ── Global Styles Generator ──────────────────────────────
//
// Parses compiled Tailwind CSS into a structured JSON payload
// suitable for import into GenerateBlocks Pro Global Styles
// (gblocks_styles CPT via the admin page snippet).

import type { GlobalStyleEntry } from "./types.js";
import { STYLES_PROPERTIES, CUSTOM_CAMEL_MAP } from "./style-parser.js";

// ── CSS Rule ──────────────────────────────────────────────

interface CssRule {
  selector: string;
  declarations: Record<string, string>;
  mediaQueries: Record<string, Record<string, string>>;
}

// ── Main Export ───────────────────────────────────────────

/**
 * Scan compiled Tailwind CSS and extract rules as GlobalStyleEntry[].
 */
export function generateGlobalStyles(css: string): GlobalStyleEntry[] {
  const entries: GlobalStyleEntry[] = [];
  const rules = parseCssRules(css);

  for (const rule of rules) {
    const selectors = rule.selector.split(",").map(s => s.trim());

    for (const sel of selectors) {
      if (!sel.startsWith(".")) continue;
      const entry = buildEntry(sel, rule);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

// ── CSS Parser ────────────────────────────────────────────

function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;

  function skipWhitespace() {
    while (i < css.length && (css[i] === " " || css[i] === "\n" || css[i] === "\r" || css[i] === "\t")) {
      i++;
    }
  }

  function peek(n = 1): string {
    return css.substring(i, i + n);
  }

  function readSelector(): string {
    let sel = "";
    let depth = 0;
    while (i < css.length) {
      if (css[i] === "{" && depth === 0) break;
      if (css[i] === "(") depth++;
      if (css[i] === ")") depth--;
      sel += css[i];
      i++;
    }
    return sel.trim();
  }

  function readBlock(): string {
    let block = "";
    let depth = 0;
    while (i < css.length) {
      block += css[i];
      if (css[i] === "{") depth++;
      if (css[i] === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    return block;
  }

  function parseDeclarations(block: string): Record<string, string> {
    const decls: Record<string, string> = {};
    let inner = block.trim();
    if (inner.startsWith("{")) inner = inner.slice(1);
    if (inner.endsWith("}")) inner = inner.slice(0, -1);

    const parts = inner.split(";");
    for (const part of parts) {
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) continue;
      const prop = part.substring(0, colonIdx).trim();
      const val = part.substring(colonIdx + 1).trim();
      if (prop && val) {
        decls[prop] = val;
      }
    }
    return decls;
  }

  function parseRule(): CssRule | null {
    const selector = readSelector();
    if (!selector) return null;
    if (i >= css.length || css[i] !== "{") return null;

    const block = readBlock();
    const declarations = parseDeclarations(block);

    if (Object.keys(declarations).length === 0) return null;

    return { selector, declarations, mediaQueries: {} };
  }

  function parseMediaBlock(): CssRule | null {
    let query = "";
    while (i < css.length && css[i] !== "{") {
      query += css[i];
      i++;
    }
    query = query.trim();
    if (i >= css.length) return null;

    const body = readBlock();
    const inner = body.trim().slice(1, -1).trim();

    let j = 0;
    const mediaDecls: Record<string, Record<string, string>> = {};
    const inlineDecls: Record<string, string> = {};
    let combinedSelector = query; // use media query as the selector

    while (j < inner.length) {
      while (j < inner.length && (inner[j] === " " || inner[j] === "\n" || inner[j] === "\r" || inner[j] === "\t")) j++;
      if (j >= inner.length) break;

      // Read selector inside media block
      let sel = "";
      while (j < inner.length && inner[j] !== "{") {
        sel += inner[j];
        j++;
      }
      sel = sel.trim();
      if (j >= inner.length) break;

      j++; // skip {
      let depth = 1;
      let declBlock = "";
      while (j < inner.length && depth > 0) {
        if (inner[j] === "{") depth++;
        if (inner[j] === "}") {
          depth--;
          if (depth === 0) { j++; break; }
        }
        declBlock += inner[j];
        j++;
      }

      const parsed = parseDeclarations("{" + declBlock + "}");
      if (Object.keys(parsed).length > 0) {
        mediaDecls[query] = { ...(mediaDecls[query] || {}), ...parsed };
      }
      combinedSelector = sel;
    }

    return { selector: combinedSelector, declarations: inlineDecls, mediaQueries: mediaDecls };
  }

  while (i < css.length) {
    skipWhitespace();

    if (peek(6) === "@media") {
      const mediaRule = parseMediaBlock();
      if (mediaRule) rules.push(mediaRule);
      continue;
    }

    if (peek() === "." || peek() === "#" || /[a-zA-Z_*-]/.test(peek())) {
      const rule = parseRule();
      if (rule) rules.push(rule);
      continue;
    }

    i++;
  }

  return rules;
}

// ── Entry Builder ─────────────────────────────────────────

function toCamelCase(prop: string): string {
  return CUSTOM_CAMEL_MAP[prop] || prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function buildEntry(selector: string, rule: CssRule): GlobalStyleEntry | null {
  const data: Record<string, unknown> = {};
  const cssParts: string[] = [];

  for (const [prop, value] of Object.entries(rule.declarations)) {
    cssParts.push(`${prop}:${value}`);
    if (STYLES_PROPERTIES.has(prop)) {
      data[toCamelCase(prop)] = value;
    }
  }

  for (const [query, decls] of Object.entries(rule.mediaQueries)) {
    const mqParts: string[] = [];
    for (const [prop, value] of Object.entries(decls)) {
      mqParts.push(`${prop}:${value}`);
    }
    cssParts.push(`${query}{${mqParts.join(";")}}`);
  }

  if (cssParts.length === 0) return null;

  const css = `${selector}{${cssParts.join(";")}}`;

  return { selector, css, data };
}
