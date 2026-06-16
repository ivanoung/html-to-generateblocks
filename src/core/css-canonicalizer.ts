import type postcss from "postcss";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CanonicalizerConfig {
  version: string;
  framework: string;
  frameworkVersion: string;
  patterns: {
    opacityVariable: {
      declarationPattern: string;
      usagePattern: string;
      colorFunctions: Record<string, { channels: string[]; separator: string }>;
      outputFormat: { "1": string; other: string };
    };
  };
  skipIfContains: string[];
}

let _config: CanonicalizerConfig | null = null;

function loadConfig(): CanonicalizerConfig {
  if (_config) return _config;
  const configPath = resolve(__dirname, "../../config/canonicalizer-tailwind-v3.json");
  _config = JSON.parse(readFileSync(configPath, "utf-8"));
  return _config!;
}

export interface CanonicalizeResult {
  warnings: string[];
  skipped: boolean;
}

/**
 * Canonicalize a single PostCSS Rule: resolve --tw-*-opacity variables
 * in color functions, strip variable declarations. Mutates the rule in place.
 */
export function canonicalizeRule(rule: postcss.Rule): CanonicalizeResult {
  const config = loadConfig();
  const warnings: string[] = [];

  // Check skipIfContains
  const ruleCss = rule.toString();
  for (const pattern of config.skipIfContains) {
    if (ruleCss.includes(pattern)) {
      return { warnings: [], skipped: true };
    }
  }

  // Collect opacity variable declarations
  const opacityDeclarations: Array<{ node: postcss.Declaration; name: string; value: number }> = [];
  for (const node of rule.nodes) {
    if (node.type !== "decl") continue;
    const decl = node as postcss.Declaration;
    const match = decl.prop.match(/^--tw-(\w+)-opacity$/);
    if (match) {
      const numVal = parseFloat(decl.value);
      if (!isNaN(numVal)) {
        opacityDeclarations.push({ node: decl, name: match[1], value: numVal });
      }
    }
  }

  if (opacityDeclarations.length === 0) {
    return { warnings: [], skipped: false };
  }

  // Process each opacity declaration
  for (const { node: opacityDecl, name, value: opacityValue } of opacityDeclarations) {
    const usageRegex = new RegExp(`var\\(--tw-${name}-opacity,\\s*[\\d.]+\\)`);

    for (const node of rule.nodes) {
      if (node.type !== "decl") continue;
      const decl = node as postcss.Declaration;

      if (!usageRegex.test(decl.value)) continue;

      // Cross-variable mismatch check
      const otherVarMatch = decl.value.match(/var\(--tw-(\w+)-opacity,\s*[\d.]+\)/);
      if (otherVarMatch && otherVarMatch[1] !== name) {
        warnings.push(
          `CROSS_VARIABLE_MISMATCH: declared --tw-${name}-opacity but var() references --tw-${otherVarMatch[1]}-opacity`,
        );
        continue;
      }

      try {
        decl.value = resolveColorFunction(decl.prop, decl.value, opacityValue);
      } catch (err: any) {
        warnings.push(`CANONICALIZE_ERROR: ${err.message}`);
      }
    }

    opacityDecl.remove();
  }

  // After stripping all matched declarations, check for leftover
  // var(--tw-*-opacity) references in color values — this means
  // a color references an opacity variable that was never declared
  // (cross-variable mismatch)
  for (const node of rule.nodes) {
    if (node.type !== "decl") continue;
    const decl = node as postcss.Declaration;
    const leftoverMatch = decl.value.match(/var\(--tw-(\w+)-opacity,\s*[\d.]+\)/);
    if (leftoverMatch) {
      warnings.push(
        `CROSS_VARIABLE_MISMATCH: color value references --tw-${leftoverMatch[1]}-opacity but no matching declaration found`,
      );
    }
  }

  return { warnings, skipped: false };
}

function resolveColorFunction(
  _property: string,
  value: string,
  opacity: number,
): string {
  // Modern rgb(R G B / var(...))
  const modernMatch = value.match(
    /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*var\(--tw-\w+-opacity,\s*[\d.]+\)\s*\)$/,
  );
  if (modernMatch) {
    const [, r, g, b] = modernMatch;
    if (opacity === 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  // Legacy rgba(R, G, B, var(...))
  const legacyMatch = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*var\(--tw-\w+-opacity,\s*[\d.]+\)\s*\)$/,
  );
  if (legacyMatch) {
    const [, r, g, b] = legacyMatch;
    if (opacity === 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  throw new Error(`Unsupported color function format: ${value}`);
}
