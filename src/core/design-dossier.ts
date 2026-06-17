// ── Design Evidence Dossier ────────────────────────────────
//
// Structured summary of a rendered page's visual design tokens,
// extracted from the live DOM via Playwright after Tailwind CDN
// compilation. Every value here is observed, not inferred.
//
// V1 scope: colors, body/heading fonts, container width.
// Known gaps (logged as warnings):
//   - :hover/:focus/:active colors are invisible to getComputedStyle
//   - dark: variant colors only visible if viewport matches
//   - Responsive font sizes captured at one viewport width only
//   - Button styles, nav typography, spacing/border-radius not captured

export interface ColorCandidate {
  /** Hex color (resolved from computed style, not source) e.g. "#1e293b" */
  hex: string;
  /** How many elements on the page use this background or text color */
  usageCount: number;
  /** Where it appears: "body-bg", "heading", "link", "button", "generic" */
  roles: string[];
  /** Specific element selectors where found (sample: max 5) */
  examples: string[];
  /** CSS custom property name if set via variable, e.g. "--tw-bg-opacity" */
  cssVar?: string;
  /** Tailwind config name if recognized, e.g. "primary", "slate-800" */
  configName?: string;
}

export interface FontCandidate {
  /** Resolved font-family from computed style e.g. '"DM Sans", sans-serif' */
  fontFamily: string;
  /** Where used: "body", "h1", "h2", "link", "button", "generic" */
  roles: string[];
  /** Tailwind config name if recognized, e.g. "sans", "display" */
  configName?: string;
  /** Computed font-size on the elements (px, sample) */
  sampleSize?: string;
  /** Computed font-weight on the elements (sample) */
  sampleWeight?: string;
}

export interface ContainerCandidate {
  /** px value of max-width */
  px: number;
  /** Source: "config" (from tailwind.config maxWidth), "computed" (from actual element), "viewport" */
  source: "config" | "computed" | "viewport";
  /** Element selector where found (if computed) */
  selector?: string;
}

export interface CssCustomProperty {
  name: string;
  value: string;
  /** Where defined: ":root", "body", "html" */
  context: string;
}

export interface GoogleFontEntry {
  family: string;
  variants: string[];
  /** Raw <link> href */
  href: string;
}

export interface TypographySample {
  selector: string;
  tagName: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  fontFamily: string;
  textTransform: string;
  letterSpacing: string;
}

export interface DesignDossier {
  /** Colors found on the page, deduplicated by hex, ranked by usage */
  colors: ColorCandidate[];
  /** Fonts found on the page, grouped by font-family */
  fonts: FontCandidate[];
  /** Container width candidates */
  containers: ContainerCandidate[];
  /** CSS custom properties from :root, body, html */
  customProperties: CssCustomProperty[];
  /** Google Fonts loaded via <link> tags in <head> */
  googleFonts: GoogleFontEntry[];
  /** Typography samples from semantic elements (body, h1-h6, a, button) */
  typographySamples: TypographySample[];
  /** tailwind.config values extracted from <script> tags via JS parser */
  tailwindConfig: {
    colors: Record<string, string>;
    fontFamily: Record<string, string[]>;
    maxWidth: Record<string, string>;
  } | null;
  /** true if extraction ran without fatal errors */
  extracted: boolean;
  /** transparency notes: what was missed, why a value was chosen */
  warnings: string[];
}

/** Empty dossier — returned when extraction is impossible */
export function emptyDossier(): DesignDossier {
  return {
    colors: [],
    fonts: [],
    containers: [],
    customProperties: [],
    googleFonts: [],
    typographySamples: [],
    tailwindConfig: null,
    extracted: false,
    warnings: [],
  };
}
