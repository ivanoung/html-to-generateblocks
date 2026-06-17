// ── Design Token Mapper ────────────────────────────────────
//
// Maps a DesignDossier to GeneratePress Customizer tokens
// using deterministic heuristics with tiered priorities:
//   1. tailwind.config declarations (ground truth from designer)
//   2. Semantic class frequency (bg-primary: 87x → intent signal)
//   3. Computed styles from live DOM (conflict resolution, filling gaps)
//   4. Hardcoded defaults (safety net)

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

export function mapTokensHeuristic(dossier: DesignDossier): MappedTokens {
  const notes: string[] = [...dossier.warnings];
  const freq = dossier.classFrequency || {};

  // ── Colors: config-declared first, then backfill from class freq + computed ──
  const globalColors = buildColorPalette(dossier, freq, notes);

  // ── Background Color ─────────────────────────────────────
  const backgroundColor = pickBackground(dossier, globalColors, notes);

  // ── Primary & Link Color ─────────────────────────────────
  const primaryColor = pickPrimary(dossier, globalColors, freq, notes);
  const linkColor = primaryColor;
  const linkColorHover = "";

  // ── Typography: config-declared fonts first ──────────────
  const typography = buildTypography(dossier, freq, notes);

  // ── Container Width ──────────────────────────────────────
  const containerWidth = pickContainer(dossier, notes);

  // ── Confidence ───────────────────────────────────────────
  const hasFallbacks = notes.some((n) => n.includes("inferred") || n.includes("usage"));
  const hasDefaults = notes.some((n) => n.includes("default"));
  const confidence = hasDefaults ? "low" : hasFallbacks ? "medium" : "high";

  return { globalColors, typography, backgroundColor, containerWidth, linkColor, linkColorHover, confidence, notes };
}

// ── Color Palette Builder ──────────────────────────────────

function buildColorPalette(
  dossier: DesignDossier,
  freq: Record<string, number>,
  notes: string[],
): GpColorEntry[] {
  const palette: GpColorEntry[] = [];
  const seenHexes = new Set<string>();
  const seenSlugs = new Set<string>();

  function add(name: string, slug: string, color: string, note?: string) {
    if (!color) return;
    const hex = tryHex(color);
    if (!hex) return;
    if (seenSlugs.has(slug)) return;
    if (seenHexes.has(hex)) return;
    seenSlugs.add(slug);
    seenHexes.add(hex);
    palette.push({ name, slug, color: hex });
    if (note) notes.push(note);
  }

  // ── Tier 1: tailwind.config colors (ground truth) ────────
  const configColors = dossier.tailwindConfig?.colors;
  if (configColors) {
    // background and primary first (they're special)
    if (configColors.background) add("Background", "background", configColors.background, `Background from tailwind.config: ${configColors.background}`);
    if (configColors.primary) add("Primary", "primary", configColors.primary, `Primary from tailwind.config: ${configColors.primary}`);
    if (configColors.secondary) add("Secondary", "secondary", configColors.secondary, `Secondary from tailwind.config: ${configColors.secondary}`);

    // All remaining config colors
    for (const [key, value] of Object.entries(configColors)) {
      add(capitalize(key), key, value);
    }
  }

  // ── Tier 2: High-frequency semantic classes (≥10 uses) ───
  const colorClassPattern = /^(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-(\w[\w-]*?)(?:-\d+)?$/;
  const classColorFreq = new Map<string, { freq: number; colorName: string }>();
  for (const [cls, count] of Object.entries(freq)) {
    const m = cls.match(colorClassPattern);
    if (!m) continue;
    const colorName = m[1];
    // Skip known Tailwind built-in names (white, black, transparent, current, inherit)
    if (["white", "black", "transparent", "current", "inherit"].includes(colorName)) continue;
    const entry = classColorFreq.get(colorName) || { freq: 0, colorName };
    entry.freq += count;
    classColorFreq.set(colorName, entry);
  }

  const sortedByFreq = [...classColorFreq.entries()]
    .filter(([, v]) => v.freq >= 10)
    .sort(([, a], [, b]) => b.freq - a.freq);

  for (const [colorName, info] of sortedByFreq) {
    if (seenSlugs.has(colorName)) continue;
    // Find the hex for this color name
    const configHex = configColors?.[colorName];
    const computedMatch = dossier.colors.find((c) => c.configName === colorName);
    const hex = configHex || computedMatch?.hex;
    if (hex) {
      add(capitalize(colorName), colorName, hex, `Color "${colorName}" from class usage (${info.freq}x): ${hex}`);
    }
  }

  // ── Tier 3: Computed colors with significant usage and config names only ─
  // (limit: 6 additional beyond config + class-frequency colors)
  let addedFromComputed = 0;
  const MAX_COMPUTED = 6;
  const MAX_TOTAL = 16;

  for (const c of dossier.colors) {
    if (palette.length >= MAX_TOTAL) break;
    if (c.usageCount < 10) continue;
    if (seenHexes.has(c.hex)) continue;
    // Only include computed colors that have a meaningful name (from config or class-freq)
    // or have very high usage (>50) suggesting they're intentional
    if (!c.configName && c.usageCount < 50) continue;
    if (addedFromComputed >= MAX_COMPUTED) break;
    const slug = c.configName || c.roles.find((r) => r !== "generic") || `color-${palette.length}`;
    add(capitalize(slug), slug, c.hex, `Color from computed usage (${c.usageCount}x): ${c.hex}`);
    addedFromComputed++;
  }

  // ── Always include accent = primary (same hex is intentional) ──
  const primaryEntry = palette.find((c) => c.slug === "primary");
  if (primaryEntry && !seenSlugs.has("accent")) {
    palette.push({ name: "Accent", slug: "accent", color: primaryEntry.color });
    seenSlugs.add("accent");
  } else if (!primaryEntry && palette.length === 0) {
    // Bare minimum fallback: add accent with GP default
    palette.push({ name: "Accent", slug: "accent", color: "#1e73be" });
  }

  return palette;
}

// ── Background Color ───────────────────────────────────────

function pickBackground(dossier: DesignDossier, palette: GpColorEntry[], notes: string[]): string {
  // 1. tailwind.config background
  if (dossier.tailwindConfig?.colors?.background) {
    const hex = tryHex(dossier.tailwindConfig.colors.background);
    if (hex) return hex;
  }

  // 2. Computed body-bg
  const bodyBg = dossier.colors.find((c) => c.roles.includes("body-bg"));
  if (bodyBg) {
    notes.push(`Background from body computed style: ${bodyBg.hex}`);
    return bodyBg.hex;
  }

  // 3. Palette background entry
  const paletteBg = palette.find((c) => c.slug === "background");
  if (paletteBg) return paletteBg.color;

  // 4. Default
  notes.push("Background defaulting to #ffffff");
  return "#ffffff";
}

// ── Primary Color ──────────────────────────────────────────

function pickPrimary(dossier: DesignDossier, palette: GpColorEntry[], freq: Record<string, number>, notes: string[]): string {
  // 1. tailwind.config primary
  if (dossier.tailwindConfig?.colors?.primary) {
    const hex = tryHex(dossier.tailwindConfig.colors.primary);
    if (hex) return hex;
  }

  // 2. Most-used semantic class color (bg-*, text-*)
  const classColors = new Map<string, number>();
  for (const [cls, count] of Object.entries(freq)) {
    const m = cls.match(/^(?:bg|text)-(\w[\w-]*?)(?:-\d+)?$/);
    if (!m) continue;
    const name = m[1];
    if (["white", "black", "transparent", "current", "inherit", "background", "surface"].includes(name)) continue;
    classColors.set(name, (classColors.get(name) || 0) + count);
  }
  const sorted = [...classColors.entries()].sort(([, a], [, b]) => b - a);
  if (sorted.length > 0) {
    const topName = sorted[0][0];
    const configHex = dossier.tailwindConfig?.colors?.[topName];
    const computedMatch = dossier.colors.find((c) => c.roles.includes("button") || c.roles.includes("link"));
    if (configHex) return configHex;
    if (computedMatch) return computedMatch.hex;
  }

  // 3. Computed button/link color
  const buttonColor = dossier.colors.find((c) => c.roles.includes("button") || c.roles.includes("link"));
  if (buttonColor) {
    notes.push(`Primary inferred from button/link: ${buttonColor.hex}`);
    return buttonColor.hex;
  }

  // 4. Default
  notes.push("Primary defaulting to #1e73be");
  return "#1e73be";
}

// ── Typography ─────────────────────────────────────────────

function buildTypography(dossier: DesignDossier, freq: Record<string, number>, notes: string[]): GpTypographyEntry[] {
  const entries: GpTypographyEntry[] = [];
  const configFonts = dossier.tailwindConfig?.fontFamily;

  // ── Body font ────────────────────────────────────────────
  const bodySample = dossier.typographySamples.find((s) => s.tagName === "body");
  const bodyFont = pickFontByRole(dossier, ["body", "p"]);
  if (bodyFont) {
    entries.push(makeTypographyEntry("body", bodyFont, bodySample, "base"));
    notes.push(`Body font: ${bodyFont.fontFamily}`);
  }

  // ── Heading font ─────────────────────────────────────────
  const h1Sample = dossier.typographySamples.find((s) => s.tagName === "h1");
  const headingFont = pickFontByRole(dossier, ["h1", "h2", "h3"]);
  if (headingFont) {
    entries.push(makeTypographyEntry("all-headings", headingFont, h1Sample, "content"));
    notes.push(`Heading font: ${headingFont.fontFamily}`);
  }

  // ── Additional config-declared fonts ─────────────────────
  if (configFonts) {
    // mono → buttons, code
    if (configFonts.mono && !entries.some((e) => e.fontFamily === configFonts.mono!.join(", "))) {
      const monoFont = dossier.fonts.find((f) => f.roles.includes("button") && f.configName === "mono")
        || { fontFamily: configFonts.mono.join(", "), roles: ["button"], configName: "mono" };
      entries.push(makeTypographyEntry("button", monoFont as FontCandidate, dossier.typographySamples.find((s) => s.tagName === "button"), "content"));
      notes.push(`Mono font: ${monoFont.fontFamily}`);
    }

    // script → blockquote or custom
    if (configFonts.script && !entries.some((e) => e.fontFamily === configFonts.script!.join(", "))) {
      const scriptFont = { fontFamily: configFonts.script.join(", "), roles: ["generic"], configName: "script" };
      entries.push(makeTypographyEntry("blockquote", scriptFont as FontCandidate, undefined, "content"));
      notes.push(`Script font: ${scriptFont.fontFamily}`);
    }

    // serif → if declared
    if (configFonts.serif && !entries.some((e) => e.fontFamily === configFonts.serif!.join(", "))) {
      const serifFont = { fontFamily: configFonts.serif.join(", "), roles: ["generic"], configName: "serif" };
      entries.push(makeTypographyEntry("blockquote", serifFont as FontCandidate, undefined, "content"));
      notes.push(`Serif font: ${serifFont.fontFamily}`);
    }
  }

  return entries;
}

// ── Container Width ────────────────────────────────────────

function pickContainer(dossier: DesignDossier, notes: string[]): number {
  // 1. tailwind.config
  if (dossier.tailwindConfig?.maxWidth?.container) {
    const parsed = parseInt(dossier.tailwindConfig.maxWidth.container);
    if (parsed > 0) {
      notes.push(`Container width from tailwind.config: ${parsed}px`);
      return parsed;
    }
  }

  // 2. Computed
  const sorted = dossier.containers
    .filter((c) => c.source === "computed")
    .sort((a, b) => b.px - a.px);
  const best = sorted.find((c) => c.px <= 2000);
  if (best) {
    notes.push(`Container width from computed style (${best.selector}): ${best.px}px`);
    return best.px;
  }

  // 3. Default
  return 1600;
}

// ── Helpers ────────────────────────────────────────────────

function tryHex(value: string): string | null {
  const hex = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex.toLowerCase() : null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
}

function pickFontByRole(dossier: DesignDossier, roles: string[]): FontCandidate | undefined {
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
  const isBody = selector === "body";
  return {
    selector,
    customSelector: "",
    fontFamily: font.fontFamily,
    fontWeight: sample?.fontWeight || (isBody ? "" : "600"),
    textTransform: sample?.textTransform || "",
    textDecoration: "",
    fontStyle: "",
    fontSize: isBody ? (sample?.fontSize || "16px") : "",
    fontSizeTablet: "", fontSizeMobile: "",
    lineHeight: isBody ? (sample?.lineHeight || "") : "",
    lineHeightTablet: "", lineHeightMobile: "",
    letterSpacing: sample?.letterSpacing || "",
    letterSpacingTablet: "", letterSpacingMobile: "",
    marginBottom: "", marginBottomTablet: "", marginBottomMobile: "", marginBottomUnit: "px",
    module: "core", group,
  };
}
