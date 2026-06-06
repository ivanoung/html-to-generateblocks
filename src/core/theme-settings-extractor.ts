// ── Theme Settings Extractor ──────────────────────────────
//
// Generates a structured prompt for an LLM to map a tailwind.config
// into GeneratePress settings JSON. Also provides a validation +
// save function for the LLM's output.

import type { ThemeSettingsOutput, ThemeSettingsExport, GpColorEntry } from "./types.js";

export interface TailwindConfigTheme {
  extend?: {
    colors?: Record<string, string | Record<string, string>>;
    fontFamily?: Record<string, string[]>;
    screens?: Record<string, string>;
    maxWidth?: Record<string, string>;
  };
}

export interface TailwindConfig {
  theme?: TailwindConfigTheme;
}

export interface PromptPayload {
  prompt: string;
  config: TailwindConfig;
}

const MAPPING_PROMPT = `You are a GeneratePress theme settings converter. Given a tailwind.config object, produce a JSON object in this exact format:

{
  "options": {
    "generate_settings": {
      "container_width": <number>,
      "global_colors": [
        { "name": "<human-readable>", "slug": "<kebab-case>", "color": "<hex>" }
      ],
      "typography": [
        {
          "selector": "body" | "all-headings" | "primary-menu-items",
          "customSelector": "",
          "fontFamily": "<font stack or var(--gp-font--name)>",
          "fontWeight": "<number or empty>",
          "textTransform": "",
          "textDecoration": "",
          "fontStyle": "",
          "fontSize": "<number+unit>",
          "fontSizeTablet": "",
          "fontSizeMobile": "",
          "lineHeight": "",
          "lineHeightTablet": "",
          "lineHeightMobile": "",
          "letterSpacing": "",
          "letterSpacingTablet": "",
          "letterSpacingMobile": "",
          "marginBottom": "",
          "marginBottomTablet": "",
          "marginBottomMobile": "",
          "marginBottomUnit": "",
          "module": "core",
          "group": "base" | "content" | "primaryNavigation"
        }
      ],
      "background_color": "var(--<color-slug>)" | null,
      "link_color": "var(--<color-slug>)" | null,
      "link_color_hover": "<hex>" | null
    }
  }
}

Rules:
- Map tailwind.config.theme.extend.colors.* to global_colors entries. Omit nested color objects (e.g., { "50": "#...", "100": "#..." }) — only map flat color keys.
- Map tailwind.config.theme.extend.fontFamily.display to typography[selector=all-headings].fontFamily.
- Map tailwind.config.theme.extend.fontFamily.sans or the first sans-serif stack to typography[selector=body].fontFamily.
- Map tailwind.config.theme.extend.fontFamily.mono — if body is already set, skip it. If nothing else, set it as body.
- Set container_width to the largest value from theme.extend.maxWidth or theme.screens, or 1200 if neither exists.
- Color names: use the Tailwind key as the slug (kebab-case). Derive a human-readable name by capitalizing words.
- Omit any top-level keys (background_color, link_color, link_color_hover) if you can't determine a sensible default from the config. Do NOT guess.
- All string fields that have no value must use "" (empty string), NOT null.
- Output ONLY valid JSON, no markdown fences, no explanation text.`;

/**
 * Generate an LLM prompt from a tailwind.config object.
 * Returns the prompt + the original config for the LLM to reference.
 */
export function generateThemeSettingsPrompt(config: TailwindConfig): PromptPayload {
  return {
    prompt: MAPPING_PROMPT,
    config,
  };
}

/**
 * Validate a raw string claimed to be GP settings JSON from the LLM.
 * Returns structured output or a list of validation errors.
 */
export function validateThemeSettingsOutput(raw: string): { valid: true; output: ThemeSettingsExport } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, errors: ["Invalid JSON: could not parse the LLM output"] };
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { valid: false, errors: ["Root must be a JSON object with 'options.generate_settings'"] };
  }

  const options = obj.options as Record<string, unknown> | undefined;
  if (!options || typeof options !== "object") {
    return { valid: false, errors: ["Missing 'options' key at root"] };
  }

  const settings = options.generate_settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== "object") {
    return { valid: false, errors: ["Missing 'options.generate_settings' key"] };
  }

  // Validate container_width
  if (settings.container_width !== undefined && (typeof settings.container_width !== "number" || (settings.container_width as number) <= 0)) {
    errors.push("container_width must be a positive number");
  }

  // Validate global_colors
  if (settings.global_colors !== undefined) {
    if (!Array.isArray(settings.global_colors)) {
      errors.push("global_colors must be an array");
    } else {
      const colors = settings.global_colors as unknown[];
      colors.forEach((c, i) => {
        const color = c as Record<string, unknown>;
        if (!color || typeof color !== "object") {
          errors.push(`global_colors[${i}]: must be an object`);
          return;
        }
        if (typeof color.name !== "string" || !color.name) errors.push(`global_colors[${i}]: missing 'name'`);
        if (typeof color.slug !== "string" || !color.slug) errors.push(`global_colors[${i}]: missing 'slug'`);
        if (typeof color.color !== "string" || !(color.color as string).startsWith("#")) errors.push(`global_colors[${i}]: 'color' must be a hex string`);
      });
    }
  }

  // Validate typography
  if (settings.typography !== undefined) {
    if (!Array.isArray(settings.typography)) {
      errors.push("typography must be an array");
    } else {
      const validSelectors = ["body", "all-headings", "primary-menu-items"];
      const typos = settings.typography as unknown[];
      typos.forEach((t, i) => {
        const typo = t as Record<string, unknown>;
        if (!typo || typeof typo !== "object") {
          errors.push(`typography[${i}]: must be an object`);
          return;
        }
        if (!validSelectors.includes(typo.selector as string)) errors.push(`typography[${i}]: invalid selector "${typo.selector}"`);
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, output: parsed as ThemeSettingsExport };
}

/**
 * Flatten nested Tailwind color objects into flat entries.
 * e.g. { primary: { 50: "#...", 100: "#..." } } → skipped (only flat keys mapped).
 * Returns only the flat color keys.
 */
export function extractFlatColors(colors: Record<string, string | Record<string, string>> | undefined): GpColorEntry[] {
  if (!colors) return [];
  const entries: GpColorEntry[] = [];
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === "string" && value.startsWith("#")) {
      entries.push({
        name: key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        slug: key,
        color: value,
      });
    }
  }
  return entries;
}
