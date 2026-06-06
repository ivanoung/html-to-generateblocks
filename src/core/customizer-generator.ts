// ── Customizer Settings Generator ──────────────────────
//
// Extracts Tailwind config from source HTML and generates
// a GeneratePress Customizer import JSON with:
// - Global colors (from Tailwind theme.extend.colors)
// - Typography (from Tailwind theme.extend.fontFamily)
// - Container width (from Tailwind theme.extend.maxWidth.container)
// - Background color (from body styles)

export interface CustomizerExport {
  modules: Record<string, string>;
  mods: Record<string, unknown>;
  options: Record<string, unknown>;
}

export function generateCustomizerSettings(
  rawHtml: string,
  bodyBackgroundColor?: string,
): CustomizerExport | null {
  const config = extractTailwindConfig(rawHtml);
  if (!config) return null;

  const colors = extractColors(config);
  const fonts = extractFonts(config);
  const containerWidth = extractContainerWidth(config);
  const bgColor = bodyBackgroundColor || colors.find((c) => c.slug === "background")?.color || "#ffffff";

  return {
    modules: {
      Backgrounds: "generate_package_backgrounds",
      Blog: "generate_package_blog",
      Copyright: "generate_package_copyright",
      "Menu Plus": "generate_package_menu_plus",
      Spacing: "generate_package_spacing",
    },
    mods: {
      generate_copyright: false,
    },
    options: {
      generate_settings: {
        container_width: containerWidth,
        content_layout_setting: "one-container",
        underline_links: "never",
        smooth_scroll: true,
        container_alignment: "boxes",
        global_colors: colors,
        typography: fonts,
        background_color: bgColor,
        hide_title: true,
        hide_tagline: true,
        back_to_top: "enable",
        link_color: colors.find((c) => c.slug === "primary")?.color || "",
        link_color_hover: "",
      },
      generate_background_settings: false,
      generate_blog_settings: {
        masonry: false,
        post_image: true,
        date: true,
        author: true,
        categories: true,
        tags: true,
        comments: true,
        single_date: true,
        single_author: true,
        single_categories: true,
        single_tags: true,
      },
      generate_spacing_settings: {
        separator: 0,
        content_element_separator: 0,
        header_right: 32,
        header_left: 32,
        content_right: 32,
        content_left: 32,
        header_top: 20,
        header_bottom: 20,
        menu_item_height: 50,
      },
      generate_menu_plus_settings: {
        sticky_menu: "false",
      },
    },
  };
}

interface TailwindConfig {
  colors?: Record<string, string>;
  fontFamily?: Record<string, string[]>;
  maxWidth?: Record<string, string>;
}

function extractTailwindConfig(html: string): TailwindConfig | null {
  const match = html.match(/tailwind\.config\s*=\s*/);
  if (!match) return null;

  let depth = 0;
  let startIdx = (match.index || 0) + match[0].length;
  let endIdx = startIdx;
  for (let i = startIdx; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }

  const configStr = html.substring(startIdx, endIdx)
    .replace(/,(\s*[}\]])/g, "$1")  // trailing commas
    .replace(/(['"])?([a-zA-Z0-9_-]+)(['"])?\s*:/g, '"$2":'); // quote keys

  // Extract only the extend block values
  const colors: Record<string, string> = {};
  const fontFamily: Record<string, string[]> = {};
  const maxWidth: Record<string, string> = {};

  // Parse colors: "colorname": "#hexvalue"
  const colorBlock = configStr.match(/"colors"\s*:\s*\{([^}]+)\}/);
  if (colorBlock) {
    const colorPairs = colorBlock[1].matchAll(/"(\w+)"\s*:\s*"([^"]+)"/g);
    for (const [, name, value] of colorPairs) {
      colors[name] = value;
    }
  }

  // Parse fontFamily
  const fontBlock = configStr.match(/"fontFamily"\s*:\s*\{([^}]+)\}/);
  if (fontBlock) {
    const fontPairs = fontBlock[1].matchAll(/"(\w+)"\s*:\s*\[([^\]]+)\]/g);
    for (const [, name, value] of fontPairs) {
      fontFamily[name] = value.split(",").map((s) => s.trim().replace(/['"]/g, ""));
    }
  }

  // Parse maxWidth
  const mwBlock = configStr.match(/"maxWidth"\s*:\s*\{([^}]+)\}/);
  if (mwBlock) {
    const mwPairs = mwBlock[1].matchAll(/"(\w+)"\s*:\s*"([^"]+)"/g);
    for (const [, name, value] of mwPairs) {
      maxWidth[name] = value;
    }
  }

  return { colors, fontFamily, maxWidth };
}

function extractContainerWidth(config: TailwindConfig): number {
  const val = config.maxWidth?.container || "1600";
  return parseInt(val) || 1600;
}

function extractColors(config: TailwindConfig): Array<{ name: string; slug: string; color: string }> {
  const result: Array<{ name: string; slug: string; color: string }> = [];

  // Add essential colors first
  if (config.colors?.background) {
    result.push({ name: "Background", slug: "background", color: config.colors.background });
  }
  if (config.colors?.surface) {
    result.push({ name: "Surface", slug: "surface", color: config.colors.surface });
  }
  if (config.colors?.primary) {
    result.push({ name: "Primary", slug: "primary", color: config.colors.primary });
  }
  if (config.colors?.secondary) {
    result.push({ name: "Secondary", slug: "secondary", color: config.colors.secondary });
  }

  // Add accent
  result.push({ name: "Accent", slug: "accent", color: config.colors?.primary || "#1e73be" });

  // Add remaining colors
  if (config.colors) {
    for (const [name, color] of Object.entries(config.colors)) {
      if (!result.some((c) => c.slug === name)) {
        result.push({ name: name.charAt(0).toUpperCase() + name.slice(1), slug: name, color });
      }
    }
  }

  return result;
}

function extractFonts(config: TailwindConfig): Array<Record<string, unknown>> {
  const fonts: Array<Record<string, unknown>> = [];

  // Body font
  if (config.fontFamily?.sans) {
    fonts.push({
      selector: "body",
      customSelector: "",
      fontFamily: config.fontFamily.sans.join(", "),
      fontWeight: "",
      textTransform: "",
      fontSize: "16px",
      module: "core",
      group: "base",
    });
  }

  // Headings font
  if (config.fontFamily?.display) {
    fonts.push({
      selector: "all-headings",
      customSelector: "",
      fontFamily: config.fontFamily.display.join(", "),
      fontWeight: "600",
      textTransform: "",
      module: "core",
      group: "content",
    });
  }

  return fonts;
}
