// ── Customizer Settings Generator ──────────────────────────
//
// Generates GeneratePress Customizer import JSON from a
// DesignDossier extracted from the live rendered page.
// Uses deterministic heuristics by default.
// Supports manual override via config/customizer-overrides.json.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DesignDossier } from "./design-dossier.js";
import type { MappedTokens } from "./token-mapper.js";
import { mapTokensHeuristic } from "./token-mapper.js";

export interface CustomizerExport {
  modules: Record<string, string>;
  mods: Record<string, unknown>;
  options: Record<string, unknown>;
}

const OVERRIDES_PATH = resolve(process.cwd(), "config", "customizer-overrides.json");

function loadOverrides(): Record<string, unknown> | null {
  try {
    if (existsSync(OVERRIDES_PATH)) {
      return JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8"));
    }
  } catch { /* ignore broken overrides */ }
  return null;
}

export function generateCustomizerSettings(dossier: DesignDossier): CustomizerExport | null {
  if (!dossier?.extracted) return null;
  const tokens = mapTokensHeuristic(dossier);

  // Apply manual overrides
  const overrides = loadOverrides();
  if (overrides) {
    if (overrides.container_width != null) tokens.containerWidth = overrides.container_width as number;
    if (overrides.background_color != null) tokens.backgroundColor = overrides.background_color as string;
    if (overrides.link_color != null) tokens.linkColor = overrides.link_color as string;
    if (overrides.link_color_hover != null) tokens.linkColorHover = overrides.link_color_hover as string;
    if (overrides.global_colors != null) tokens.globalColors = overrides.global_colors as typeof tokens.globalColors;
    if (overrides.typography != null) tokens.typography = overrides.typography as typeof tokens.typography;
    tokens.notes.push("Manual overrides applied from config/customizer-overrides.json");
  }

  return buildCustomizerJson(tokens);
}

export function buildCustomizerJson(tokens: MappedTokens): CustomizerExport {
  return {
    modules: {
      Backgrounds: "generate_package_backgrounds",
      Blog: "generate_package_blog",
      Copyright: "generate_package_copyright",
      "Menu Plus": "generate_package_menu_plus",
      Spacing: "generate_package_spacing",
    },
    mods: { generate_copyright: false },
    options: {
      generate_settings: {
        container_width: tokens.containerWidth,
        content_layout_setting: "one-container",
        underline_links: "never",
        smooth_scroll: true,
        container_alignment: "boxes",
        global_colors: tokens.globalColors,
        typography: tokens.typography,
        background_color: tokens.backgroundColor,
        hide_title: true,
        hide_tagline: true,
        back_to_top: "enable",
        link_color: tokens.linkColor,
        link_color_hover: tokens.linkColorHover,
      },
      generate_background_settings: false,
      generate_blog_settings: {
        masonry: false, post_image: true, date: true, author: true,
        categories: true, tags: true, comments: true,
        single_date: true, single_author: true, single_categories: true, single_tags: true,
      },
      generate_spacing_settings: {
        separator: 0, content_element_separator: 0,
        header_right: 32, header_left: 32, content_right: 32, content_left: 32,
        header_top: 20, header_bottom: 20, menu_item_height: 50,
      },
      generate_menu_plus_settings: { sticky_menu: "false" },
    },
  };
}
