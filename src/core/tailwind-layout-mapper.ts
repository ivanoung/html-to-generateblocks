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

// ── V2 Responsive Types ──────────────────────────────────────

/** GenerateBlocks supports nested @media keys in styles. */
type GbStyles = Record<string, string | GbStyles>;

/** Tailwind breakpoint prefixes in cascade order (smallest → largest). */
const BREAKPOINTS: string[] = ["", "sm", "md", "lg", "xl", "2xl"];

/** Regex matching a Tailwind responsive prefix: sm:, md:, lg:, xl:, 2xl: */
const BP_RE = /^(sm|md|lg|xl|2xl):/;

type MapperEntry = {
  pattern: RegExp;
  apply: (match: RegExpMatchArray) => Record<string, string> | null;
};

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

function mapTokens(tokens: string[]): { styles: Record<string, string>; leftover: string[] } {
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
      const result = entry.apply(match);
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

const GB_DESKTOP = "(min-width: 1025px)";
const GB_TABLET = "(max-width: 1024px)";
const GB_MOBILE = "(max-width: 767px)";

/**
 * Map cascade-resolved breakpoint values to GB's 3-tier responsive structure.
 *
 * Desktop: largest breakpoint with a value. If a default (0px) value exists,
 * desktop goes into All Screens. If ONLY larger breakpoints have values
 * (e.g., lg:col-span-7 with no default), desktop goes into @media (min-width: 1025px)
 * so it doesn't leak to mobile.
 */
function collapseToGbTiers(propKey: string, resolved: Map<string, string>): GbStyles {
  // Find highest breakpoint with a value
  let desktopValue: string | undefined;
  for (const bp of [...BREAKPOINTS].reverse()) {
    if (resolved.has(bp)) { desktopValue = resolved.get(bp)!; break; }
  }
  if (desktopValue === undefined) return {};

  const hasDefault = resolved.has("");
  const tabletValue = resolved.get("md");
  const mobileValue = resolved.get("");

  const styles: GbStyles = {};

  if (hasDefault) {
    // Default value exists → desktop goes into All Screens
    styles[propKey] = desktopValue;
  } else {
    // No default value → desktop goes into @media (min-width: 1025px) only
    styles[`@media ${GB_DESKTOP}`] = { [propKey]: desktopValue };
  }

  // Tablet: only emit if md has a value AND it differs from what users would see without it.
  // If hasDefault: compare vs desktop. If !hasDefault: emit if md has a value.
  if (tabletValue !== undefined) {
    if (hasDefault && tabletValue !== desktopValue) {
      styles[`@media ${GB_TABLET}`] = { [propKey]: tabletValue };
    } else if (!hasDefault && tabletValue !== desktopValue) {
      styles[`@media ${GB_TABLET}`] = { [propKey]: tabletValue };
    }
  }

  // Mobile: only emit if default exists and differs from tablet, or from desktop if no tablet.
  if (mobileValue !== undefined) {
    const compareValue = tabletValue ?? desktopValue;
    if (mobileValue !== compareValue) {
      styles[`@media ${GB_MOBILE}`] = { [propKey]: mobileValue };
    }
  }

  return styles;
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
    const result = mapTokens(bpTokens);
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
    mergeGbStyles(finalStyles, collapseToGbTiers(prop, resolved));
  }

  return { styles: finalStyles, leftoverClasses: dedupe(leftoverAll).join(" ") };
}
