// ── Fixture schema ────────────────────────────────────────────

export interface FixtureExpect {
  shouldPass: boolean;
  hardFailCount: number;
  warningCodes: string[];
}

export interface Fixture {
  name: string;
  description: string;
  input: FixtureNode;
  expect: FixtureExpect;
}

// ── Input node types (from fixture JSON) ──────────────────────

export interface ElementNode {
  nodeType: "element";
  tagName: string;
  attributes: Record<string, string>;
  style?: string;
  children: FixtureNode[];
}

export interface TextNode {
  nodeType: "text";
  tagName: string;
  text: string;
  style?: string;
}

export interface ImageNode {
  nodeType: "image";
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
  style?: string;
}

export interface EmbedNode {
  nodeType: "embed";
  provider: string;
  url: string;
}

export interface HtmlNode {
  nodeType: "html";
  html: string;
}

export type FixtureNode = ElementNode | TextNode | ImageNode | EmbedNode | HtmlNode;

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

// ── Output report ─────────────────────────────────────────────

export type ReportStatus =
  | "generated"
  | "validator_pass"
  | "validator_fail"
  | "wordpress_verified_pass"
  | "wordpress_verified_fail"
  | "rejected_unsupported";

export interface ManualVerification {
  wordpressPasted: boolean;
  savedWithoutRecovery: boolean | null;
  notes: string;
}

export interface FixtureReport {
  fixture: string;
  status: ReportStatus;
  blockCount: number;
  hardFails: HardFail[];
  warnings: Warning[];
  manualVerification: ManualVerification;
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

// ── CSS Splitter property classification ────────────────────

/** CSS properties that qualify a rule for Global Styles (when all declarations are GS-eligible). */
export const GS_ELIGIBLE_PROPERTIES: ReadonlySet<string> = new Set([
  "display",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "gap",
  "column-gap",
  "row-gap",
  "place-items",
  "place-content",
  "place-self",
  "position",
  "z-index",
  "overflow",
  "overflow-x",
  "overflow-y",
  "visibility",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "aspect-ratio",
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "grid-area",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-auto-flow",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "box-sizing",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-inline",
  "float",
  "clear",
  "object-fit",
  "object-position",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-align-last",
  "text-transform",
  "text-decoration",
  "text-decoration-line",
  "text-indent",
  "white-space",
  "word-break",
  "overflow-wrap",
  "vertical-align",
  "direction",
  "writing-mode",
  "color",
  "container-type",
  "container-name",
  "outline",
  "outline-width",
  "outline-style",
  "outline-offset",
]);

/** CSS properties that force a rule into styles-unique.css (if ANY declaration uses one). */
export const UC_ONLY_PROPERTIES: ReadonlySet<string> = new Set([
  "background-color",
  "background",
  "background-image",
  "background-size",
  "background-position",
  "background-position-x",
  "background-position-y",
  "background-repeat",
  "background-attachment",
  "background-clip",
  "background-origin",
  "background-blend-mode",
  "transform",
  "transform-origin",
  "transform-style",
  "filter",
  "backdrop-filter",
  "opacity",
  "box-shadow",
  "text-shadow",
  "mix-blend-mode",
  "clip-path",
  "mask",
  "mask-image",
  "mask-size",
  "mask-position",
  "mask-repeat",
  "mask-composite",
  "mask-mode",
  "transition",
  "transition-delay",
  "transition-duration",
  "transition-property",
  "transition-timing-function",
  "transition-behavior",
  "animation",
  "animation-name",
  "animation-duration",
  "animation-timing-function",
  "animation-delay",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-play-state",
  "cursor",
  "pointer-events",
  "user-select",
  "scroll-behavior",
  "scroll-snap-type",
  "scroll-snap-align",
  "resize",
  "touch-action",
  "will-change",
  "perspective",
  "perspective-origin",
  "backface-visibility",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "accent-color",
  "caret-color",
  "text-decoration-color",
  "column-rule-color",
  "content",
  "isolation",
]);
