// ── Class Consolidator ──────────────────────────────────
//
// Groups elements by structural style fingerprints, generates
// reusable Global Style classes for WordPress Global Styles JSON.
//
// Structural properties are hashed and promoted to shared classes.
// Decorative properties stay inline on blocks.

import { createHash } from "node:crypto";

export interface GlobalStyleEntry {
  selector: string;
  name: string;
  css: string;
  data: Record<string, unknown>;
}

const STRUCTURAL_PROPS = new Set([
  "display", "flexDirection", "flexWrap", "flexGrow", "flexShrink",
  "flexBasis", "justifyContent", "alignItems", "alignContent", "alignSelf",
  "gap", "columnGap", "rowGap",
  "gridTemplateColumns", "gridTemplateRows", "gridColumn", "gridRow",
  "gridAutoColumns", "gridAutoRows", "gridAutoFlow",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomRightRadius", "borderBottomLeftRadius",
  "position", "overflowX", "overflowY", "zIndex", "order",
  "maxWidth", "maxHeight", "minWidth", "minHeight",
]);

interface ResponsiveBp {
  breakpoint: string;
  maxWidth: number;
  overrides: Record<string, Record<string, string>>;
}

type StateStyles = Record<string, Array<{ state: string; props: Record<string, string> }>>;

export function consolidateStyles(
  html: string,
  responsiveOverrides: ResponsiveBp[],
  stateStyles: StateStyles,
): GlobalStyleEntry[] {
  const elementStyles = extractInlineStyles(html);
  const structuralHashes = new Map<string, string[]>();
  const structuralPropsPerHash = new Map<string, Record<string, string>>();

  for (const [idx, allProps] of Object.entries(elementStyles)) {
    const structural = filterStructural(allProps);
    if (Object.keys(structural).length === 0) continue;
    const hash = hashProps(structural);
    if (!structuralHashes.has(hash)) {
      structuralHashes.set(hash, []);
      structuralPropsPerHash.set(hash, structural);
    }
    structuralHashes.get(hash)!.push(idx);
  }

  const globalStyles: GlobalStyleEntry[] = [];

  for (const [hash, idxs] of structuralHashes) {
    if (idxs.length < 2) continue;
    const className = `gb-s-${hash}`;
    const structuralProps = structuralPropsPerHash.get(hash)!;

    const responsiveForClass: Record<string, Record<string, string>> = {};
    for (const bp of responsiveOverrides) {
      const bpOverrides: Record<string, string> = {};
      for (const idx of idxs) {
        const elemOverrides = bp.overrides[idx];
        if (!elemOverrides) continue;
        for (const [prop, val] of Object.entries(elemOverrides)) {
          if (isStructural(prop)) bpOverrides[prop] = val;
        }
      }
      if (Object.keys(bpOverrides).length > 0) {
        responsiveForClass[`@media (max-width: ${bp.maxWidth}px)`] = bpOverrides;
      }
    }

    const stateForClass: Record<string, Record<string, string>> = {};
    for (const idx of idxs) {
      const elemStates = stateStyles[idx];
      if (!elemStates) continue;
      for (const { state, props } of elemStates) {
        if (!stateForClass[state]) stateForClass[state] = {};
        for (const [prop, val] of Object.entries(props)) {
          if (isStructural(prop)) stateForClass[state][prop] = val;
        }
      }
    }

    globalStyles.push(buildClassEntry(className, structuralProps, responsiveForClass, stateForClass));
  }

  return globalStyles;
}

function extractInlineStyles(html: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  const regex = /data-gb-idx="(\d+)"[^>]*style="([^"]*)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const idx = match[1];
    const style = match[2];
    const props: Record<string, string> = {};
    for (const decl of style.split(";")) {
      const ci = decl.indexOf(":");
      if (ci === -1) continue;
      const k = decl.substring(0, ci).trim();
      const v = decl.substring(ci + 1).trim();
      if (!k || !v) continue;
      props[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    if (Object.keys(props).length > 0) result[idx] = props;
  }
  return result;
}

function filterStructural(all: Record<string, string>): Record<string, string> {
  const s: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (isStructural(k)) s[k] = v;
  }
  return s;
}

function isStructural(prop: string): boolean {
  return STRUCTURAL_PROPS.has(prop) ||
    prop.startsWith("flex") || prop.startsWith("grid") ||
    prop.startsWith("padding") || prop.startsWith("margin") ||
    prop.startsWith("border");
}

function hashProps(props: Record<string, string>): string {
  const sorted = Object.keys(props).sort().map((k) => `${k}:${props[k]}`);
  return createHash("sha256").update(sorted.join(";")).digest("hex").substring(0, 8);
}

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

function buildClassEntry(
  className: string,
  structural: Record<string, string>,
  responsive: Record<string, Record<string, string>>,
  states: Record<string, Record<string, string>>,
): GlobalStyleEntry {
  const sel = `.${className}`;
  const parts: string[] = [];
  const data: Record<string, unknown> = {};

  const base = Object.entries(structural).sort(([a], [b]) => a.localeCompare(b));
  parts.push(`${sel}{${base.map(([k, v]) => `${kebab(k)}:${v}`).join(";")}}`);
  Object.assign(data, structural);

  for (const [q, p] of Object.entries(responsive)) {
    parts.push(`${q}{${sel}{${Object.entries(p).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${kebab(k)}:${v}`).join(";")}}}`);
    data[q] = p;
  }

  for (const [st, p] of Object.entries(states)) {
    parts.push(`${sel}${st.replace("&","")}{${Object.entries(p).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${kebab(k)}:${v}`).join(";")}}`);
    data[st] = p;
  }

  return { selector: sel, name: `Generated ${className}`, css: parts.join(""), data };
}
