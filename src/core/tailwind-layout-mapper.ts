/** Tailwind v3 default spacing scale (rem → px at 16px root). */
const SPACING: Record<string, string> = {
  "0": "0px", "px": "1px", "0.5": "2px", "1": "4px", "1.5": "6px",
  "2": "8px", "2.5": "10px", "3": "12px", "3.5": "14px", "4": "16px",
  "5": "20px", "6": "24px", "7": "28px", "8": "32px", "9": "36px",
  "10": "40px", "11": "44px", "12": "48px", "14": "56px", "16": "64px",
  "20": "80px", "24": "96px", "28": "112px", "32": "128px", "36": "144px",
  "40": "160px", "44": "176px", "48": "192px", "52": "208px", "56": "224px",
  "60": "240px", "64": "256px", "72": "288px", "80": "320px", "96": "384px",
};

// ── M2 Spacing Helper ────────────────────────────────────

const SPACING_SUFFIX_MAP: Record<string, string> = {
  pt: "paddingTop", pr: "paddingRight", pb: "paddingBottom", pl: "paddingLeft",
  mt: "marginTop", mr: "marginRight", mb: "marginBottom", ml: "marginLeft",
  top: "top", right: "right", bottom: "bottom", left: "left",
  insetx: "left", insety: "right", // handled separately
};

function resolveSpacing(value: string, suffixes: string[]): Record<string, string> | null {
  let resolved: string | null = null;
  if (value === "auto") {
    resolved = "auto";
  } else if (SPACING[value]) {
    resolved = SPACING[value];
  } else if (/^\d+$/.test(value)) {
    resolved = `${parseInt(value) * 4}px`;
  } else if (/^\d+px$/.test(value)) {
    resolved = value;
  }
  if (!resolved) return null;
  const out: Record<string, string> = {};
  for (const s of suffixes) {
    const prop = SPACING_SUFFIX_MAP[s];
    if (prop) out[prop] = resolved;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── M3 Sizing Helper ─────────────────────────────────────

function resolveSizing(
  prop: string,
  value: string,
  config?: { maxWidth?: Record<string, string> },
): Record<string, string> | null {
  // Full/screen/auto
  if (value === "full") return { [prop]: "100%" };
  if (value === "screen") return { [prop]: prop.startsWith("min") ? "100vh" : prop.startsWith("max") ? "100vw" : "100vw" };
  if (value === "auto") return { [prop]: "auto" };
  if (value === "min") return { [prop]: "min-content" };
  if (value === "max") return { [prop]: "max-content" };
  if (value === "fit") return { [prop]: "fit-content" };
  // Max-width specials
  if (value === "none") return { [prop]: "none" };
  if (value === "container" && prop === "maxWidth") {
    // Use config's container value, fall back to 1280px default
    const containerValue = config?.maxWidth?.container;
    if (containerValue) return { [prop]: containerValue };
    // No config available — keep class in globalClasses for safety
    return null;
  }
  // Fractions: w-1/2 → 50%
  const fracMatch = value.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) return { [prop]: `${(parseInt(fracMatch[1]) / parseInt(fracMatch[2])) * 100}%` };
  // SPACING table or numeric
  if (SPACING[value]) return { [prop]: SPACING[value] };
  if (/^\d+$/.test(value)) return { [prop]: `${parseInt(value) * 4}px` };
  if (/^\d+px$/.test(value) || /^\d+%$/.test(value) || /^\d+rem$/.test(value) || /^\d+em$/.test(value)) {
    return { [prop]: value };
  }
  // Arbitrary: w-[200px]
  if (/^\[.+\]$/.test(value)) {
    const inner = value.slice(1, -1);
    return { [prop]: inner };
  }
  return null;
}

// ── V2 Responsive Types ──────────────────────────────────────

/** GenerateBlocks supports nested @media keys in styles. */
type GbStyles = Record<string, string | GbStyles>;

/** Tailwind breakpoint prefixes in cascade order (smallest → largest). */
const BREAKPOINTS: string[] = ["", "sm", "md", "lg", "xl", "2xl"];

/** Regex matching a Tailwind responsive prefix: sm:, md:, lg:, xl:, 2xl: */
const BP_RE = /^(sm|md|lg|xl|2xl):/;

type MapperEntry = {
  pattern: RegExp;
  apply: (match: RegExpMatchArray, config?: TailwindLayoutConfig) => Record<string, string> | null;
};

/** Config values needed by the layout mapper (subset of full Tailwind config). */
export interface TailwindLayoutConfig {
  maxWidth?: Record<string, string>;
}

const MAPPING_TABLE: MapperEntry[] = [
  // ── Display / Layout Mode ──
  { pattern: /^flex$/, apply: () => ({ display: "flex" }) },
  { pattern: /^grid$/, apply: () => ({ display: "grid" }) },
  { pattern: /^inline-flex$/, apply: () => ({ display: "inline-flex" }) },
  { pattern: /^inline-grid$/, apply: () => ({ display: "inline-grid" }) },
  { pattern: /^block$/, apply: () => ({ display: "block" }) },
  { pattern: /^inline-block$/, apply: () => ({ display: "inline-block" }) },
  { pattern: /^hidden$/, apply: () => ({ display: "none" }) },

  // ── Flex Direction ──
  { pattern: /^flex-row$/, apply: () => ({ flexDirection: "row" }) },
  { pattern: /^flex-row-reverse$/, apply: () => ({ flexDirection: "row-reverse" }) },
  { pattern: /^flex-col$/, apply: () => ({ flexDirection: "column" }) },
  { pattern: /^flex-col-reverse$/, apply: () => ({ flexDirection: "column-reverse" }) },

  // ── Flex Wrap ──
  { pattern: /^flex-wrap$/, apply: () => ({ flexWrap: "wrap" }) },
  { pattern: /^flex-nowrap$/, apply: () => ({ flexWrap: "nowrap" }) },
  { pattern: /^flex-wrap-reverse$/, apply: () => ({ flexWrap: "wrap-reverse" }) },

  // ── Flex Items Alignment ──
  { pattern: /^items-start$/, apply: () => ({ alignItems: "flex-start" }) },
  { pattern: /^items-center$/, apply: () => ({ alignItems: "center" }) },
  { pattern: /^items-end$/, apply: () => ({ alignItems: "flex-end" }) },
  { pattern: /^items-stretch$/, apply: () => ({ alignItems: "stretch" }) },
  { pattern: /^items-baseline$/, apply: () => ({ alignItems: "baseline" }) },

  // ── Justify Content ──
  { pattern: /^justify-start$/, apply: () => ({ justifyContent: "flex-start" }) },
  { pattern: /^justify-center$/, apply: () => ({ justifyContent: "center" }) },
  { pattern: /^justify-end$/, apply: () => ({ justifyContent: "flex-end" }) },
  { pattern: /^justify-between$/, apply: () => ({ justifyContent: "space-between" }) },
  { pattern: /^justify-around$/, apply: () => ({ justifyContent: "space-around" }) },
  { pattern: /^justify-evenly$/, apply: () => ({ justifyContent: "space-evenly" }) },
  { pattern: /^justify-normal$/, apply: () => ({ justifyContent: "normal" }) },
  { pattern: /^justify-stretch$/, apply: () => ({ justifyContent: "stretch" }) },

  // ── Self Alignment ──
  { pattern: /^self-auto$/, apply: () => ({ alignSelf: "auto" }) },
  { pattern: /^self-start$/, apply: () => ({ alignSelf: "flex-start" }) },
  { pattern: /^self-center$/, apply: () => ({ alignSelf: "center" }) },
  { pattern: /^self-end$/, apply: () => ({ alignSelf: "flex-end" }) },
  { pattern: /^self-stretch$/, apply: () => ({ alignSelf: "stretch" }) },
  { pattern: /^self-baseline$/, apply: () => ({ alignSelf: "baseline" }) },

  // ── Flex Child Sizing ──
  { pattern: /^flex-1$/, apply: () => ({ flex: "1 1 0%" }) },
  { pattern: /^flex-auto$/, apply: () => ({ flex: "1 1 auto" }) },
  { pattern: /^flex-initial$/, apply: () => ({ flex: "0 1 auto" }) },
  { pattern: /^flex-none$/, apply: () => ({ flex: "none" }) },
  { pattern: /^grow$/, apply: () => ({ flexGrow: "1" }) },
  { pattern: /^grow-0$/, apply: () => ({ flexGrow: "0" }) },
  { pattern: /^shrink$/, apply: () => ({ flexShrink: "1" }) },
  { pattern: /^shrink-0$/, apply: () => ({ flexShrink: "0" }) },

  // ── Gap + Space Between (directional first, then bidirectional) ──
  { pattern: /^gap-x-(.+)$/, apply: (m) => SPACING[m[1]] ? { columnGap: SPACING[m[1]] } : null },
  { pattern: /^gap-y-(.+)$/, apply: (m) => SPACING[m[1]] ? { rowGap: SPACING[m[1]] } : null },
  { pattern: /^gap-(.+)$/, apply: (m) => SPACING[m[1]] ? { columnGap: SPACING[m[1]], rowGap: SPACING[m[1]] } : null },

  // ── Padding ──
  { pattern: /^p-(.+)$/, apply: (m) => resolveSpacing(m[1], ["pt", "pr", "pb", "pl"]) },
  { pattern: /^px-(.+)$/, apply: (m) => resolveSpacing(m[1], ["pl", "pr"]) },
  { pattern: /^py-(.+)$/, apply: (m) => resolveSpacing(m[1], ["pt", "pb"]) },
  { pattern: /^pt-(.+)$/, apply: (m) => resolveSpacing(m[1], ["pt"]) },
  { pattern: /^pr-(.+)$/, apply: (m) => resolveSpacing(m[1], ["pr"]) },
  { pattern: /^pb-(.+)$/, apply: (m) => resolveSpacing(m[1], ["pb"]) },
  { pattern: /^pl-(.+)$/, apply: (m) => resolveSpacing(m[1], ["pl"]) },

  // ── Margin ──
  { pattern: /^m-(.+)$/, apply: (m) => resolveSpacing(m[1], ["mt", "mr", "mb", "ml"]) },
  { pattern: /^mx-(.+)$/, apply: (m) => resolveSpacing(m[1], ["ml", "mr"]) },
  { pattern: /^my-(.+)$/, apply: (m) => resolveSpacing(m[1], ["mt", "mb"]) },
  { pattern: /^mt-(.+)$/, apply: (m) => resolveSpacing(m[1], ["mt"]) },
  { pattern: /^mr-(.+)$/, apply: (m) => resolveSpacing(m[1], ["mr"]) },
  { pattern: /^mb-(.+)$/, apply: (m) => resolveSpacing(m[1], ["mb"]) },
  { pattern: /^ml-(.+)$/, apply: (m) => resolveSpacing(m[1], ["ml"]) },

  // ── Sizing (M3) ──
  { pattern: /^w-(.+)$/, apply: (m, cfg) => resolveSizing("width", m[1], cfg) },
  { pattern: /^h-(.+)$/, apply: (m, cfg) => resolveSizing("height", m[1], cfg) },
  { pattern: /^min-w-(.+)$/, apply: (m, cfg) => resolveSizing("minWidth", m[1], cfg) },
  { pattern: /^min-h-(.+)$/, apply: (m, cfg) => resolveSizing("minHeight", m[1], cfg) },
  { pattern: /^max-w-(.+)$/, apply: (m, cfg) => resolveSizing("maxWidth", m[1], cfg) },
  { pattern: /^max-h-(.+)$/, apply: (m, cfg) => resolveSizing("maxHeight", m[1], cfg) },

  // ── Positioning (M4) ──
  { pattern: /^static$/, apply: () => ({ position: "static" }) },
  { pattern: /^fixed$/, apply: () => ({ position: "fixed" }) },
  { pattern: /^absolute$/, apply: () => ({ position: "absolute" }) },
  { pattern: /^relative$/, apply: () => ({ position: "relative" }) },
  { pattern: /^sticky$/, apply: () => ({ position: "sticky" }) },
  { pattern: /^top-(.+)$/, apply: (m) => resolveSpacing(m[1], ["top"]) as any },
  { pattern: /^right-(.+)$/, apply: (m) => resolveSpacing(m[1], ["right"]) as any },
  { pattern: /^bottom-(.+)$/, apply: (m) => resolveSpacing(m[1], ["bottom"]) as any },
  { pattern: /^left-(.+)$/, apply: (m) => resolveSpacing(m[1], ["left"]) as any },
  { pattern: /^inset-(.+)$/, apply: (m) => resolveSpacing(m[1], ["top", "right", "bottom", "left"]) as any },

  // ── Borders / Z-Index / Opacity (M5) ──
  { pattern: /^z-(.+)$/, apply: (m) => /^[\d-]+$/.test(m[1]) ? { zIndex: m[1] } : null },
  { pattern: /^opacity-(.+)$/, apply: (m) => { const v = parseFloat(m[1]); return !isNaN(v) ? { opacity: String(v / 100) } : null; } },
  { pattern: /^rounded$/, apply: () => ({ borderRadius: "4px" }) },
  { pattern: /^rounded-none$/, apply: () => ({ borderRadius: "0px" }) },
  { pattern: /^rounded-sm$/, apply: () => ({ borderRadius: "2px" }) },
  { pattern: /^rounded-md$/, apply: () => ({ borderRadius: "6px" }) },
  { pattern: /^rounded-lg$/, apply: () => ({ borderRadius: "8px" }) },
  { pattern: /^rounded-xl$/, apply: () => ({ borderRadius: "12px" }) },
  { pattern: /^rounded-2xl$/, apply: () => ({ borderRadius: "16px" }) },
  { pattern: /^rounded-3xl$/, apply: () => ({ borderRadius: "24px" }) },
  { pattern: /^rounded-full$/, apply: () => ({ borderRadius: "9999px" }) },
  { pattern: /^border$/, apply: () => ({ borderWidth: "1px" }) },
  { pattern: /^border-(\d+)$/, apply: (m) => ({ borderWidth: `${m[1]}px` }) },
  // Side-specific borders: border-t-2 → borderTopWidth: 2px
  { pattern: /^border-t-(\d+)$/, apply: (m) => ({ borderTopWidth: `${m[1]}px` }) },
  { pattern: /^border-t$/, apply: () => ({ borderTopWidth: "1px" }) },
  { pattern: /^border-r-(\d+)$/, apply: (m) => ({ borderRightWidth: `${m[1]}px` }) },
  { pattern: /^border-r$/, apply: () => ({ borderRightWidth: "1px" }) },
  { pattern: /^border-b-(\d+)$/, apply: (m) => ({ borderBottomWidth: `${m[1]}px` }) },
  { pattern: /^border-b$/, apply: () => ({ borderBottomWidth: "1px" }) },
  { pattern: /^border-l-(\d+)$/, apply: (m) => ({ borderLeftWidth: `${m[1]}px` }) },
  { pattern: /^border-l$/, apply: () => ({ borderLeftWidth: "1px" }) },
  // border-style: border-dashed → borderStyle: dashed
  { pattern: /^border-solid$/, apply: () => ({ borderStyle: "solid" }) },
  { pattern: /^border-dashed$/, apply: () => ({ borderStyle: "dashed" }) },
  { pattern: /^border-dotted$/, apply: () => ({ borderStyle: "dotted" }) },
  { pattern: /^border-double$/, apply: () => ({ borderStyle: "double" }) },
  { pattern: /^border-none$/, apply: () => ({ borderStyle: "none" }) },

  // ── Typography (M6) ──
  // text-align
  { pattern: /^text-left$/, apply: () => ({ textAlign: "left" }) },
  { pattern: /^text-center$/, apply: () => ({ textAlign: "center" }) },
  { pattern: /^text-right$/, apply: () => ({ textAlign: "right" }) },
  { pattern: /^text-justify$/, apply: () => ({ textAlign: "justify" }) },
  // font-style + text-decoration
  { pattern: /^italic$/, apply: () => ({ fontStyle: "italic" }) },
  { pattern: /^not-italic$/, apply: () => ({ fontStyle: "normal" }) },
  { pattern: /^underline$/, apply: () => ({ textDecoration: "underline" }) },
  { pattern: /^line-through$/, apply: () => ({ textDecoration: "line-through" }) },
  { pattern: /^no-underline$/, apply: () => ({ textDecoration: "none" }) },
  // font-weight
  { pattern: /^font-thin$/, apply: () => ({ fontWeight: "100" }) },
  { pattern: /^font-extralight$/, apply: () => ({ fontWeight: "200" }) },
  { pattern: /^font-light$/, apply: () => ({ fontWeight: "300" }) },
  { pattern: /^font-normal$/, apply: () => ({ fontWeight: "400" }) },
  { pattern: /^font-medium$/, apply: () => ({ fontWeight: "500" }) },
  { pattern: /^font-semibold$/, apply: () => ({ fontWeight: "600" }) },
  { pattern: /^font-bold$/, apply: () => ({ fontWeight: "700" }) },
  { pattern: /^font-extrabold$/, apply: () => ({ fontWeight: "800" }) },
  { pattern: /^font-black$/, apply: () => ({ fontWeight: "900" }) },
  // font-size (TW default scale)
  { pattern: /^text-xs$/, apply: () => ({ fontSize: "12px", lineHeight: "16px" }) },
  { pattern: /^text-sm$/, apply: () => ({ fontSize: "14px", lineHeight: "20px" }) },
  { pattern: /^text-base$/, apply: () => ({ fontSize: "16px", lineHeight: "24px" }) },
  { pattern: /^text-lg$/, apply: () => ({ fontSize: "18px", lineHeight: "28px" }) },
  { pattern: /^text-xl$/, apply: () => ({ fontSize: "20px", lineHeight: "28px" }) },
  { pattern: /^text-2xl$/, apply: () => ({ fontSize: "24px", lineHeight: "32px" }) },
  { pattern: /^text-3xl$/, apply: () => ({ fontSize: "30px", lineHeight: "36px" }) },
  { pattern: /^text-4xl$/, apply: () => ({ fontSize: "36px", lineHeight: "40px" }) },
  { pattern: /^text-5xl$/, apply: () => ({ fontSize: "48px", lineHeight: "48px" }) },
  { pattern: /^text-6xl$/, apply: () => ({ fontSize: "60px", lineHeight: "60px" }) },
  { pattern: /^text-7xl$/, apply: () => ({ fontSize: "72px", lineHeight: "72px" }) },
  { pattern: /^text-8xl$/, apply: () => ({ fontSize: "96px", lineHeight: "96px" }) },
  { pattern: /^text-9xl$/, apply: () => ({ fontSize: "128px", lineHeight: "128px" }) },
  // tracking (letter-spacing)
  { pattern: /^tracking-tighter$/, apply: () => ({ letterSpacing: "-0.05em" }) },
  { pattern: /^tracking-tight$/, apply: () => ({ letterSpacing: "-0.025em" }) },
  { pattern: /^tracking-normal$/, apply: () => ({ letterSpacing: "0em" }) },
  { pattern: /^tracking-wide$/, apply: () => ({ letterSpacing: "0.025em" }) },
  { pattern: /^tracking-wider$/, apply: () => ({ letterSpacing: "0.05em" }) },
  { pattern: /^tracking-widest$/, apply: () => ({ letterSpacing: "0.1em" }) },
  // text-transform
  { pattern: /^uppercase$/, apply: () => ({ textTransform: "uppercase" }) },
  { pattern: /^lowercase$/, apply: () => ({ textTransform: "lowercase" }) },
  { pattern: /^capitalize$/, apply: () => ({ textTransform: "capitalize" }) },
  { pattern: /^normal-case$/, apply: () => ({ textTransform: "none" }) },
  // leading (line-height)
  { pattern: /^leading-none$/, apply: () => ({ lineHeight: "1" }) },
  { pattern: /^leading-tight$/, apply: () => ({ lineHeight: "1.25" }) },
  { pattern: /^leading-snug$/, apply: () => ({ lineHeight: "1.375" }) },
  { pattern: /^leading-normal$/, apply: () => ({ lineHeight: "1.5" }) },
  { pattern: /^leading-relaxed$/, apply: () => ({ lineHeight: "1.625" }) },
  { pattern: /^leading-loose$/, apply: () => ({ lineHeight: "2" }) },
  // leading with arbitrary bracket value — leading-[0.9] → lineHeight: 0.9
  { pattern: /^leading-\[(.+)\]$/, apply: (m) => ({ lineHeight: m[1] }) },

  // ── Effects (M8): shadows, filters, transforms ──
  // box-shadow
  { pattern: /^shadow-sm$/, apply: () => ({ boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)" }) },
  { pattern: /^shadow$/, apply: () => ({ boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)" }) },
  { pattern: /^shadow-md$/, apply: () => ({ boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)" }) },
  { pattern: /^shadow-lg$/, apply: () => ({ boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)" }) },
  { pattern: /^shadow-xl$/, apply: () => ({ boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)" }) },
  { pattern: /^shadow-2xl$/, apply: () => ({ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" }) },
  { pattern: /^shadow-none$/, apply: () => ({ boxShadow: "none" }) },
  // backdrop-blur
  { pattern: /^backdrop-blur-sm$/, apply: () => ({ backdropFilter: "blur(4px)" }) },
  { pattern: /^backdrop-blur$/, apply: () => ({ backdropFilter: "blur(8px)" }) },
  { pattern: /^backdrop-blur-md$/, apply: () => ({ backdropFilter: "blur(12px)" }) },
  { pattern: /^backdrop-blur-lg$/, apply: () => ({ backdropFilter: "blur(16px)" }) },
  { pattern: /^backdrop-blur-xl$/, apply: () => ({ backdropFilter: "blur(24px)" }) },
  // transforms (GB supports transform via complex string, but these are common)
  { pattern: /^rotate-(\d+)$/, apply: (m) => ({ transform: `rotate(${m[1]}deg)` }) },
  { pattern: /^scale-(\d+)$/, apply: (m) => ({ transform: `scale(${parseInt(m[1]) / 100})` }) },

  // ── Aspect Ratio ──
  { pattern: /^aspect-auto$/, apply: () => ({ aspectRatio: "auto" }) },
  { pattern: /^aspect-square$/, apply: () => ({ aspectRatio: "1 / 1" }) },
  { pattern: /^aspect-video$/, apply: () => ({ aspectRatio: "16 / 9" }) },

  // ── Isolation / Visibility ──
  { pattern: /^isolate$/, apply: () => ({ isolation: "isolate" }) },
  { pattern: /^isolation-auto$/, apply: () => ({ isolation: "auto" }) },
  { pattern: /^visible$/, apply: () => ({ visibility: "visible" }) },
  { pattern: /^invisible$/, apply: () => ({ visibility: "hidden" }) },

  // ── Grid Template ──
  { pattern: /^grid-cols-(\d{1,2})$/, apply: (m) => ({ gridTemplateColumns: `repeat(${m[1]}, minmax(0, 1fr))` }) },
  { pattern: /^grid-cols-none$/, apply: () => ({ gridTemplateColumns: "none" }) },
  { pattern: /^grid-rows-(\d+)$/, apply: (m) => ({ gridTemplateRows: `repeat(${m[1]}, minmax(0, 1fr))` }) },
  { pattern: /^grid-rows-none$/, apply: () => ({ gridTemplateRows: "none" }) },

  // ── Grid Span ──
  { pattern: /^col-span-full$/, apply: () => ({ gridColumn: "1 / -1" }) },
  { pattern: /^col-span-(\d+)$/, apply: (m) => ({ gridColumn: `span ${m[1]}` }) },
  { pattern: /^row-span-full$/, apply: () => ({ gridRow: "1 / -1" }) },
  { pattern: /^row-span-(\d+)$/, apply: (m) => ({ gridRow: `span ${m[1]}` }) },

  // ── Grid Start / End ──
  { pattern: /^col-start-auto$/, apply: () => ({ gridColumnStart: "auto" }) },
  { pattern: /^col-start-(\d+)$/, apply: (m) => ({ gridColumnStart: m[1] }) },
  { pattern: /^col-end-auto$/, apply: () => ({ gridColumnEnd: "auto" }) },
  { pattern: /^col-end-(\d+)$/, apply: (m) => ({ gridColumnEnd: m[1] }) },
  { pattern: /^row-start-auto$/, apply: () => ({ gridRowStart: "auto" }) },
  { pattern: /^row-start-(\d+)$/, apply: (m) => ({ gridRowStart: m[1] }) },
  { pattern: /^row-end-auto$/, apply: () => ({ gridRowEnd: "auto" }) },
  { pattern: /^row-end-(\d+)$/, apply: (m) => ({ gridRowEnd: m[1] }) },

  // ── Grid Auto Flow ──
  { pattern: /^grid-flow-row-dense$/, apply: () => ({ gridAutoFlow: "row dense" }) },
  { pattern: /^grid-flow-col-dense$/, apply: () => ({ gridAutoFlow: "column dense" }) },
  { pattern: /^grid-flow-row$/, apply: () => ({ gridAutoFlow: "row" }) },
  { pattern: /^grid-flow-col$/, apply: () => ({ gridAutoFlow: "column" }) },
  { pattern: /^grid-flow-dense$/, apply: () => ({ gridAutoFlow: "dense" }) },

  // ── Grid Auto Sizing ──
  { pattern: /^auto-cols-auto$/, apply: () => ({ gridAutoColumns: "auto" }) },
  { pattern: /^auto-cols-min$/, apply: () => ({ gridAutoColumns: "min-content" }) },
  { pattern: /^auto-cols-max$/, apply: () => ({ gridAutoColumns: "max-content" }) },
  { pattern: /^auto-cols-fr$/, apply: () => ({ gridAutoColumns: "minmax(0, 1fr)" }) },
  { pattern: /^auto-rows-auto$/, apply: () => ({ gridAutoRows: "auto" }) },
  { pattern: /^auto-rows-min$/, apply: () => ({ gridAutoRows: "min-content" }) },
  { pattern: /^auto-rows-max$/, apply: () => ({ gridAutoRows: "max-content" }) },
  { pattern: /^auto-rows-fr$/, apply: () => ({ gridAutoRows: "minmax(0, 1fr)" }) },

  // ── Order ──
  { pattern: /^order-first$/, apply: () => ({ order: "-9999" }) },
  { pattern: /^order-last$/, apply: () => ({ order: "9999" }) },
  { pattern: /^order-none$/, apply: () => ({ order: "0" }) },
  { pattern: /^order-(\d+)$/, apply: (m) => ({ order: m[1] }) },

  // ── Overflow (longhands only — GB doesn't support shorthand) ──
  { pattern: /^overflow-auto$/, apply: () => ({ overflowX: "auto", overflowY: "auto" }) },
  { pattern: /^overflow-hidden$/, apply: () => ({ overflowX: "hidden", overflowY: "hidden" }) },
  { pattern: /^overflow-visible$/, apply: () => ({ overflowX: "visible", overflowY: "visible" }) },
  { pattern: /^overflow-scroll$/, apply: () => ({ overflowX: "scroll", overflowY: "scroll" }) },

  // ── Place Content ──
  { pattern: /^place-content-center$/, apply: () => ({ placeContent: "center" }) },
  { pattern: /^place-content-start$/, apply: () => ({ placeContent: "start" }) },
  { pattern: /^place-content-end$/, apply: () => ({ placeContent: "end" }) },
  { pattern: /^place-content-between$/, apply: () => ({ placeContent: "space-between" }) },
  { pattern: /^place-content-around$/, apply: () => ({ placeContent: "space-around" }) },
  { pattern: /^place-content-evenly$/, apply: () => ({ placeContent: "space-evenly" }) },
  { pattern: /^place-content-stretch$/, apply: () => ({ placeContent: "stretch" }) },

  // ── Place Items ──
  { pattern: /^place-items-center$/, apply: () => ({ placeItems: "center" }) },
  { pattern: /^place-items-start$/, apply: () => ({ placeItems: "start" }) },
  { pattern: /^place-items-end$/, apply: () => ({ placeItems: "end" }) },
  { pattern: /^place-items-stretch$/, apply: () => ({ placeItems: "stretch" }) },

  // ── Place Self ──
  { pattern: /^place-self-center$/, apply: () => ({ placeSelf: "center" }) },
  { pattern: /^place-self-start$/, apply: () => ({ placeSelf: "start" }) },
  { pattern: /^place-self-end$/, apply: () => ({ placeSelf: "end" }) },
  { pattern: /^place-self-auto$/, apply: () => ({ placeSelf: "auto" }) },
  { pattern: /^place-self-stretch$/, apply: () => ({ placeSelf: "stretch" }) },

  // ── Align Content (multi-line flex/grid) ──
  { pattern: /^content-normal$/, apply: () => ({ alignContent: "normal" }) },
  { pattern: /^content-center$/, apply: () => ({ alignContent: "center" }) },
  { pattern: /^content-start$/, apply: () => ({ alignContent: "flex-start" }) },
  { pattern: /^content-end$/, apply: () => ({ alignContent: "flex-end" }) },
  { pattern: /^content-between$/, apply: () => ({ alignContent: "space-between" }) },
  { pattern: /^content-around$/, apply: () => ({ alignContent: "space-around" }) },
  { pattern: /^content-evenly$/, apply: () => ({ alignContent: "space-evenly" }) },
  { pattern: /^content-stretch$/, apply: () => ({ alignContent: "stretch" }) },
  { pattern: /^content-baseline$/, apply: () => ({ alignContent: "baseline" }) },

  // ── Justify Items / Self ──
  { pattern: /^justify-items-start$/, apply: () => ({ justifyItems: "start" }) },
  { pattern: /^justify-items-center$/, apply: () => ({ justifyItems: "center" }) },
  { pattern: /^justify-items-end$/, apply: () => ({ justifyItems: "end" }) },
  { pattern: /^justify-items-stretch$/, apply: () => ({ justifyItems: "stretch" }) },
  { pattern: /^justify-self-auto$/, apply: () => ({ justifySelf: "auto" }) },
  { pattern: /^justify-self-start$/, apply: () => ({ justifySelf: "start" }) },
  { pattern: /^justify-self-center$/, apply: () => ({ justifySelf: "center" }) },
  { pattern: /^justify-self-end$/, apply: () => ({ justifySelf: "end" }) },
  { pattern: /^justify-self-stretch$/, apply: () => ({ justifySelf: "stretch" }) },

  // ── Flex Basis ──
  { pattern: /^basis-auto$/, apply: () => ({ flexBasis: "auto" }) },
  { pattern: /^basis-full$/, apply: () => ({ flexBasis: "100%" }) },
  { pattern: /^basis-(.+)$/, apply: (m) => SPACING[m[1]] ? { flexBasis: SPACING[m[1]] } : null },
];

// ── V2 Helpers ──────────────────────────────────────────────

/**
 * Parse a Tailwind class token into its breakpoint prefix and remaining class name.
 */
function parseBreakpointPrefix(token: string): { bp: string; rest: string } {
  const match = token.match(BP_RE);
  return match
    ? { bp: match[1], rest: token.slice(match[0].length) }
    : { bp: "", rest: token };
}

function mapTokens(tokens: string[], config?: TailwindLayoutConfig): { styles: Record<string, string>; leftover: string[] } {
  const styles: Record<string, string> = {};
  const leftover: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    let matched = false;
    for (const entry of MAPPING_TABLE) {
      const match = token.match(entry.pattern);
      if (!match) continue;
      const result = entry.apply(match, config);
      if (result === null) continue;
      Object.assign(styles, result);
      matched = true;
      break;
    }
    if (!matched) leftover.push(token);
  }
  return { styles, leftover };
}

function groupByProperty(bpStyles: Map<string, Record<string, string>>): Map<string, Map<string, string>> {
  const byProp = new Map<string, Map<string, string>>();
  for (const [bp, styles] of bpStyles) {
    for (const [prop, value] of Object.entries(styles)) {
      if (!byProp.has(prop)) byProp.set(prop, new Map());
      byProp.get(prop)!.set(bp, value);
    }
  }
  return byProp;
}

function resolveCascade(perBp: Map<string, string>): Map<string, string> {
  const resolved = new Map<string, string>();
  let lastValue: string | undefined;
  for (const bp of BREAKPOINTS) {
    if (perBp.has(bp)) lastValue = perBp.get(bp)!;
    if (lastValue !== undefined) resolved.set(bp, lastValue);
  }
  return resolved;
}

// ── V3 All-Screens-Centric Cascade ────────────────────────

/** Breakpoints in cascade order (smallest → largest) */
const TW_BP_ORDER: { prefix: string; px: number }[] = [
  { prefix: "", px: 0 },
  { prefix: "sm", px: 640 },
  { prefix: "md", px: 768 },
  { prefix: "lg", px: 1024 },
  { prefix: "xl", px: 1280 },
  { prefix: "2xl", px: 1536 },
];

/** Breakpoint px → N−1 px for max-width reset boundary */
function maxWidthBoundary(px: number): number {
  return px - 1;
}

/** CSS initial values for property resets when no breakpoint value exists below */
const PROPERTY_RESETS: Record<string, string> = {
  gridColumn: "auto",
  gridColumnStart: "auto",
  gridColumnEnd: "auto",
  gridRow: "auto",
  gridRowStart: "auto",
  gridRowEnd: "auto",
  gridTemplateColumns: "none",
  gridTemplateRows: "none",
  display: "initial",
  flexDirection: "row",
  flexWrap: "nowrap",
  justifyContent: "flex-start",
  alignItems: "stretch",
  alignContent: "stretch",
  alignSelf: "auto",
  justifyItems: "stretch",
  justifySelf: "auto",
  placeContent: "stretch",
  placeItems: "stretch",
  placeSelf: "auto",
  gap: "0px",
  rowGap: "0px",
  columnGap: "0px",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  marginTop: "0px",
  marginRight: "0px",
  marginBottom: "0px",
  marginLeft: "0px",
  width: "auto",
  height: "auto",
  minWidth: "0px",
  minHeight: "0px",
  maxWidth: "none",
  maxHeight: "none",
  overflowX: "visible",
  overflowY: "visible",
  position: "static",
  zIndex: "auto",
  order: "0",
  flexGrow: "0",
  flexShrink: "1",
  flexBasis: "auto",
  flex: "0 1 auto",
  fontSize: "inherit",
  fontWeight: "400",
  lineHeight: "inherit",
  textAlign: "left",
  borderRadius: "0px",
  borderWidth: "0px",
  opacity: "1",
  visibility: "visible",
  isolation: "auto",
  aspectRatio: "auto",
  gridAutoFlow: "row",
  gridAutoColumns: "auto",
  gridAutoRows: "auto",
};

function getResetValue(propKey: string): string {
  if (propKey in PROPERTY_RESETS) return PROPERTY_RESETS[propKey];
  return "initial";
}

/**
 * V3 All-Screens-centric cascade.
 *
 * Largest Tailwind breakpoint value → All Screens.
 * Each downward value-change → @media(max-width: N−1px) override.
 * Gaps (smallest bp > 0px) → reset to PROPERTY_RESETS value.
 * Blocks emitted in ascending max-width order (largest first, smallest last)
 * so CSS source-order cascade picks the most specific match.
 */
function collapseToAllScreensWithResets(
  propKey: string,
  resolved: Map<string, string>,
): GbStyles {
  // Build sorted entries from the resolved cascade: largest bp → smallest
  const bpEntries = TW_BP_ORDER
    .filter(bp => resolved.has(bp.prefix))
    .map(bp => ({ px: bp.px, val: resolved.get(bp.prefix)! }))
    .reverse(); // largest → smallest

  if (bpEntries.length === 0) return {};

  const styles: GbStyles = {};

  // 1. All Screens = largest breakpoint's value
  styles[propKey] = bpEntries[0].val;

  // 2. Walk downward, emit @media(max-width) at value-change boundaries
  for (let i = 0; i < bpEntries.length - 1; i++) {
    const current = bpEntries[i];
    const below = bpEntries[i + 1];
    if (current.val !== below.val) {
      const boundary = `@media (max-width: ${current.px - 1}px)`;
      styles[boundary] = { [propKey]: below.val };
    }
  }

  // 3. If smallest breakpoint is NOT default (0px), emit a reset at its boundary
  const smallest = bpEntries[bpEntries.length - 1];
  if (smallest.px > 0) {
    const boundary = `@media (max-width: ${smallest.px - 1}px)`;
    if (!styles[boundary]) {
      styles[boundary] = { [propKey]: getResetValue(propKey) };
    }
  }

  // 4. Reorder: @media(max-width) keys descending px (largest first, smallest last)
  return reorderMaxWidthDescending(styles);
}

/**
 * Reorder @media(max-width) keys from largest px to smallest px.
 * This guarantees CSS source-order: at overlapping max-width ranges,
 * the last (smallest) block wins → correct cascade.
 */
function reorderMaxWidthDescending(styles: GbStyles): GbStyles {
  const mediaKeys = Object.keys(styles)
    .filter(k => k.startsWith("@media (max-width:"))
    .sort((a, b) => {
      const aPx = parseInt(a.match(/max-width:\s*(\d+)px/)![1], 10);
      const bPx = parseInt(b.match(/max-width:\s*(\d+)px/)![1], 10);
      return bPx - aPx; // descending = largest first
    });

  const flatKeys = Object.keys(styles).filter(k => !k.startsWith("@media"));

  const reordered: GbStyles = {};
  for (const k of flatKeys) reordered[k] = styles[k];
  for (const k of mediaKeys) reordered[k] = styles[k];
  return reordered;
}

function mergeGbStyles(target: GbStyles, source: GbStyles): void {
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("@media") && typeof value === "object" && value !== null) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      mergeGbStyles(target[key] as GbStyles, value as GbStyles);
    } else {
      target[key] = value;
    }
  }
}

function dedupe(arr: string[]): string[] { return [...new Set(arr)]; }

// ── Main Export ─────────────────────────────────────────────

/**
 * Convert Tailwind layout classes to GenerateBlocks element block styles.
 * Supports responsive prefixes (sm:, md:, lg:, xl:, 2xl:) mapped to GB @media.
 */
export function tailwindLayoutToGbAttributes(
  classString: string,
  config?: TailwindLayoutConfig,
): { styles: GbStyles; leftoverClasses: string } {
  if (!classString || !classString.trim()) {
    return { styles: {}, leftoverClasses: "" };
  }

  const tokens = classString.trim().split(/\s+/);
  const seen = new Set<string>();
  const tokenOrigins = new Map<string, string>();
  const byBp = new Map<string, string[]>();
  for (const bp of BREAKPOINTS) byBp.set(bp, []);

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    const { bp, rest } = parseBreakpointPrefix(token);
    byBp.get(bp)!.push(rest);
    if (bp !== "") tokenOrigins.set(rest, token);
  }

  const bpStyles = new Map<string, Record<string, string>>();
  const rawLeftover: string[] = [];
  for (const bp of BREAKPOINTS) {
    const bpTokens = byBp.get(bp)!;
    if (bpTokens.length === 0) continue;
    const result = mapTokens(bpTokens, config);
    bpStyles.set(bp, result.styles);
    rawLeftover.push(...result.leftover);
  }

  // Restore original tokens for leftovers that lost their breakpoint prefix
  const leftoverAll = rawLeftover.map(t => tokenOrigins.get(t) || t);

  const hasResponsive = [...bpStyles.keys()].some(bp => bp !== "");
  if (!hasResponsive) {
    return { styles: bpStyles.get("") || {}, leftoverClasses: dedupe(leftoverAll).join(" ") };
  }

  const byProp = groupByProperty(bpStyles);
  const finalStyles: GbStyles = {};
  for (const [prop, perBp] of byProp) {
    const resolved = resolveCascade(perBp);
    mergeGbStyles(finalStyles, collapseToAllScreensWithResets(prop, resolved));
  }

  return { styles: finalStyles, leftoverClasses: dedupe(leftoverAll).join(" ") };
}
