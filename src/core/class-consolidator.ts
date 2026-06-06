// ── Class Consolidator ──────────────────────────────────
//
// Groups elements by style fingerprints, generates reusable
// Global Style classes for WordPress Global Styles JSON.
//
// Takes DesktopFirstStyles from the inliner, hashes the desktop
// properties (after stripping CSS initial values), and promotes
// shared sets to .gb-s-{hash} classes. Original CSS class names
// (.blueprint-bg, .clip-hex, .hover-shadow-md) are preserved.

import { createHash } from "node:crypto";

export interface GlobalStyleEntry {
  selector: string;
  name: string;
  css: string;
  data: Record<string, unknown>;
}

interface DesktopFirstStyles {
  desktop: Record<string, string>;
  overrides: Array<{ maxWidth: number; props: Record<string, string> }>;
}

const ORIGINAL_CLASS_NAMES = new Set([
  "blueprint-bg", "blueprint-bg-dark", "clip-hex",
  "hover-shadow-md", "ruler-x", "no-scrollbar",
]);

export function consolidateStyles(
  elementStyles: Map<string, DesktopFirstStyles>,
): GlobalStyleEntry[] {
  const hashToIdxs = new Map<string, string[]>();
  const hashToProps = new Map<string, Record<string, string>>();
  const hashToOverrides = new Map<
    string,
    Array<{ maxWidth: number; props: Record<string, string> }>
  >();

  for (const [idx, styles] of elementStyles) {
    if (Object.keys(styles.desktop).length === 0) continue;

    const hash = hashProps(styles.desktop);
    if (!hashToIdxs.has(hash)) {
      hashToIdxs.set(hash, []);
      hashToProps.set(hash, styles.desktop);
      hashToOverrides.set(hash, []);
    }
    hashToIdxs.get(hash)!.push(idx);

    // Collect responsive overrides
    const existing = hashToOverrides.get(hash)!;
    for (const ov of styles.overrides) {
      const match = existing.find((e) => e.maxWidth === ov.maxWidth);
      if (match) {
        Object.assign(match.props, ov.props);
      } else {
        existing.push({ maxWidth: ov.maxWidth, props: { ...ov.props } });
      }
    }
  }

  const entries: GlobalStyleEntry[] = [];
  for (const [hash, idxs] of hashToIdxs) {
    if (idxs.length < 2) continue;
    const className = `gb-s-${hash}`;
    const desktop = hashToProps.get(hash)!;
    const overrides = hashToOverrides.get(hash)!;
    entries.push(buildClassEntry(className, desktop, overrides));
  }

  return entries;
}

function hashProps(props: Record<string, string>): string {
  const sorted = Object.keys(props)
    .sort()
    .map((k) => `${k}:${props[k]}`);
  return createHash("sha256").update(sorted.join(";")).digest("hex").substring(0, 8);
}

function kebabCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

function buildClassEntry(
  className: string,
  desktop: Record<string, string>,
  overrides: Array<{ maxWidth: number; props: Record<string, string> }>,
): GlobalStyleEntry {
  const selector = `.${className}`;
  const parts: string[] = [];
  const data: Record<string, unknown> = { ...desktop };

  const baseCss = Object.entries(desktop)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${kebabCase(k)}:${v}`)
    .join(";");
  parts.push(`${selector}{${baseCss}}`);

  for (const ov of overrides) {
    const ovCss = Object.entries(ov.props)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${kebabCase(k)}:${v}`)
      .join(";");
    parts.push(`@media(max-width:${ov.maxWidth}px){${selector}{${ovCss}}}`);
    data[`@media (max-width: ${ov.maxWidth}px)`] = ov.props;
  }

  return { selector, name: className, css: parts.join(""), data };
}
