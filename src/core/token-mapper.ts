// ── Design Token Mapper ────────────────────────────────────
//
// Maps a DesignDossier to GeneratePress Customizer tokens
// using deterministic heuristics. Priority system per token:
//   1. CSS custom property (--primary, --background, etc.)
//   2. Computed style from semantic element (body-bg, button, heading)
//   3. tailwind.config value (from HTML <script> parser)
//   4. Hardcoded default

import type { DesignDossier, FontCandidate } from "./design-dossier.js";
import type { GpColorEntry, GpTypographyEntry } from "./types.js";

export interface MappedTokens {
  globalColors: GpColorEntry[];
  typography: GpTypographyEntry[];
  backgroundColor: string;
  containerWidth: number;
  linkColor: string;
  linkColorHover: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

/**
 * Map a dossier to Customizer tokens using deterministic heuristics.
 * Always available — no external API needed.
 */
export function mapTokensHeuristic(dossier: DesignDossier): MappedTokens {
  const notes: string[] = [...dossier.warnings];

  // ── Background Color ─────────────────────────────────────
  let backgroundColor = selectColor(dossier, ["--background", "--color-background"], "body-bg", "background");

  // ── Primary Color ────────────────────────────────────────
  let primaryColor = selectColor(dossier, ["--primary", "--color-primary", "--tw-primary"], "button", "primary");

  // ── Secondary Color ──────────────────────────────────────
  let secondaryColor = selectColor(dossier, ["--secondary", "--color-secondary"], "generic", "secondary");

  // Fallback for secondary: second most-used non-primary, non-bg color
  if (secondaryColor === "#3a3a3a") {
    const others = dossier.colors.filter(
      (c) => c.hex !== primaryColor && c.hex !== backgroundColor && !c.roles.includes("body-bg")
    );
    others.sort((a, b) => b.usageCount - a.usageCount);
    if (others.length > 0) {
      secondaryColor = others[0].hex;
      notes.push(`Secondary inferred from usage (${others[0].usageCount} uses): ${secondaryColor}`);
    }
  }

  // ── Assemble global colors ───────────────────────────────
  const globalColors: GpColorEntry[] = [];

  function addColor(name: string, slug: string, color: string) {
    if (color && !globalColors.some((c) => c.slug === slug)) {
      globalColors.push({ name, slug, color });
    }
  }

  addColor("Background", "background", backgroundColor);
  addColor("Primary", "primary", primaryColor);
  addColor("Secondary", "secondary", secondaryColor);
  addColor("Accent", "accent", primaryColor);

  // Add significant remaining colors (≥5 uses, ≤8 extras)
  const existingHexes = new Set(globalColors.map((c) => c.color));
  const remaining = dossier.colors
    .filter((c) => c.usageCount >= 5 && !existingHexes.has(c.hex))
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 8);

  for (const c of remaining) {
    const slug = c.configName || c.roles.find((r) => r !== "generic") || `color-${globalColors.length}`;
    const name = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
    if (!globalColors.some((gc) => gc.slug === slug)) {
      globalColors.push({ name, slug, color: c.hex });
    }
  }

  // ── Typography ───────────────────────────────────────────
  const typography: GpTypographyEntry[] = [];

  const bodySample = dossier.typographySamples.find((s) => s.tagName === "body");
  const bodyFont = pickFont(dossier, ["body", "p"]);
  if (bodyFont) {
    typography.push(makeTypographyEntry("body", bodyFont, bodySample!, "base"));
    notes.push(`Body font: ${bodyFont.fontFamily}`);
  }

  const h1Sample = dossier.typographySamples.find((s) => s.tagName === "h1");
  const headingFont = pickFont(dossier, ["h1", "h2", "h3"]);
  if (headingFont) {
    typography.push(makeTypographyEntry("all-headings", headingFont, h1Sample!, "content"));
    notes.push(`Heading font: ${headingFont.fontFamily}`);
  }

  // ── Container Width ──────────────────────────────────────
  let containerWidth = 1600;
  const sortedContainers = dossier.containers
    .filter((c) => c.source === "computed")
    .sort((a, b) => b.px - a.px);
  const best = sortedContainers.find((c) => c.px <= 2000);
  if (best) {
    containerWidth = best.px;
    notes.push(`Container width from computed style (${best.selector}): ${containerWidth}px`);
  } else if (dossier.tailwindConfig?.maxWidth?.container) {
    const parsed = parseInt(dossier.tailwindConfig.maxWidth.container);
    if (parsed > 0) { containerWidth = parsed; notes.push(`Container width from tailwind.config: ${containerWidth}px`); }
  }

  // ── Link Color ──────────────────────────────────────────
  const linkColor = primaryColor;
  const linkColorHover = "";

  // ── Confidence ───────────────────────────────────────────
  const hasFallbacks = notes.some((n) => n.startsWith("Secondary inferred") || n.includes("inferred"));
  const hasDefaults = notes.some((n) => n.includes("default"));
  const confidence = hasDefaults ? "low" : hasFallbacks ? "medium" : "high";

  return { globalColors, typography, backgroundColor, containerWidth, linkColor, linkColorHover, confidence, notes };
}

// ── Helpers ────────────────────────────────────────────────

function selectColor(dossier: DesignDossier, cssVarNames: string[], role: string, configKey: string): string {
  // 1. CSS custom property
  const prop = dossier.customProperties.find((p) => cssVarNames.includes(p.name));
  if (prop?.value) {
    const hex = tryHex(prop.value);
    if (hex) return hex;
  }

  // 2. Computed styles (by role)
  const byRole = dossier.colors.filter((c) => c.roles.includes(role));
  byRole.sort((a, b) => b.usageCount - a.usageCount);
  if (byRole.length > 0) return byRole[0].hex;

  // 3. tailwind.config
  if (dossier.tailwindConfig?.colors?.[configKey]) {
    const hex = tryHex(dossier.tailwindConfig.colors[configKey]);
    if (hex) return hex;
  }

  // 4. Hardcoded defaults
  const defaults: Record<string, string> = {
    body_bg: "#ffffff", background: "#ffffff",
    button: "#1e73be", primary: "#1e73be",
    generic: "#3a3a3a", secondary: "#3a3a3a",
  };
  return defaults[configKey] || defaults[role] || "#000000";
}

function tryHex(value: string): string | null {
  const hex = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex.toLowerCase() : null;
}

function pickFont(dossier: DesignDossier, roles: string[]): FontCandidate | undefined {
  for (const role of roles) {
    const match = dossier.fonts.find((f) => f.roles.includes(role));
    if (match) return match;
  }
  if (roles.includes("body") && dossier.tailwindConfig?.fontFamily?.sans) {
    return { fontFamily: dossier.tailwindConfig.fontFamily.sans.join(", "), roles: ["body"], configName: "sans" };
  }
  if (roles.some((r) => r.startsWith("h")) && dossier.tailwindConfig?.fontFamily?.display) {
    return { fontFamily: dossier.tailwindConfig.fontFamily.display.join(", "), roles: ["h1"], configName: "display" };
  }
  return dossier.fonts[0];
}

function makeTypographyEntry(
  selector: string,
  font: FontCandidate,
  sample: { fontSize?: string; fontWeight?: string; lineHeight?: string; textTransform?: string; letterSpacing?: string } | undefined,
  group: string,
): GpTypographyEntry {
  return {
    selector,
    customSelector: "",
    fontFamily: font.fontFamily,
    fontWeight: sample?.fontWeight || (selector === "body" ? "" : "600"),
    textTransform: sample?.textTransform || "",
    textDecoration: "",
    fontStyle: "",
    fontSize: selector === "body" ? (sample?.fontSize || "16px") : "",
    fontSizeTablet: "", fontSizeMobile: "",
    lineHeight: selector === "body" ? (sample?.lineHeight || "") : "",
    lineHeightTablet: "", lineHeightMobile: "",
    letterSpacing: sample?.letterSpacing || "",
    letterSpacingTablet: "", letterSpacingMobile: "",
    marginBottom: "", marginBottomTablet: "", marginBottomMobile: "", marginBottomUnit: "px",
    module: "core", group,
  };
}
