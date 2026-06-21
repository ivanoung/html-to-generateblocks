// ── Intermediate block (after mapping, before serialization) ──

export type BlockName =
  | "generateblocks/element"
  | "generateblocks/text"
  | "generateblocks/media"
  | "generateblocks/shape"
  | "core/image"
  | "image"
  | "core/embed"
  | "core/list"
  | "core/quote"
  | "core/html";

export interface BlockStyles {
  [key: string]: unknown;
  // camelCase CSS properties
  // e.g. paddingTop, backgroundColor, fontSize
  // responsive: "@media (max-width:1024px)": { ... }
  // hover: ":hover": { ... }
}

export interface Block {
  blockName: BlockName;
  uniqueId: string;
  tagName?: string;          // omitted for shape; used for most others
  content?: string;          // text block only
  styles: BlockStyles;
  css: string;
  globalClasses?: string[];
  htmlAttributes?: Record<string, string>;
  align?: string;            // element block only
  mediaId?: number;          // media block only
  linkHtmlAttributes?: Record<string, string>; // media block only
  icon?: string;             // text block only
  iconLocation?: string;     // text block only
  iconOnly?: boolean;        // text block only
  html?: string;             // shape block only
  innerBlocks: Block[];

  // core block fields
  url?: string;              // core/image, core/embed
  alt?: string;              // core/image
  width?: number;            // core/image
  height?: number;           // core/image
  caption?: string;          // core/image
  providerNameSlug?: string; // core/embed
  responsive?: boolean;      // core/embed
  type?: string;             // core/embed

  // metadata for validation
  idGenType?: string;        // which counter was used: "elem", "text", "img", "shape"
}

// ── Style pipeline intermediate ───────────────────────────────

export interface StyleEntry {
  property: string;   // kebab-case css property name
  value: string;
  camelCase: string;  // camelCase equivalent
}

// ── Validation ────────────────────────────────────────────────

export interface HardFail {
  code: string;
  message: string;
  blockId?: string;
  blockName?: BlockName;
}

export interface Warning {
  code: string;
  message: string;
  blockId?: string;
}

export interface ValidationResult {
  hardFails: HardFail[];
  warnings: Warning[];
}

// ── Style Transfer Pipeline ──────────────────────────────────

/** Single color entry for generate_settings global_colors */
export interface GpColorEntry {
  name: string;
  slug: string;
  color: string;
}

/** Single typography entry for generate_settings typography array */
export interface GpTypographyEntry {
  selector: string;
  customSelector: string;
  fontFamily: string;
  fontWeight: string;
  textTransform: string;
  textDecoration: string;
  fontStyle: string;
  fontSize: string;
  fontSizeTablet: string;
  fontSizeMobile: string;
  lineHeight: string;
  lineHeightTablet: string;
  lineHeightMobile: string;
  letterSpacing: string;
  letterSpacingTablet: string;
  letterSpacingMobile: string;
  marginBottom: string;
  marginBottomTablet: string;
  marginBottomMobile: string;
  marginBottomUnit: string;
  module: string;
  group: string;
}

/** Complete generate_settings shape for import */
export interface ThemeSettingsOutput {
  container_width?: number;
  global_colors?: GpColorEntry[];
  typography?: GpTypographyEntry[];
  background_color?: string;
  link_color?: string;
  link_color_hover?: string;
}

/** Wrapper matching GP export format */
export interface ThemeSettingsExport {
  options: {
    generate_settings: ThemeSettingsOutput;
  };
}

/** Single global style entry for gblocks_styles import */
export interface GlobalStyleEntry {
  selector: string;
  css: string;
  data: Record<string, unknown>;
}

/** Layer 2 output file payload */
export type GlobalStylesPayload = GlobalStyleEntry[];
