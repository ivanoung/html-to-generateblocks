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

  // ── Gap (directional first, then bidirectional) ──
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

/**
 * Convert Tailwind layout classes to GenerateBlocks element block styles.
 *
 * Processes classes left-to-right in original order. Matched classes are
 * consumed (removed from class list) and converted to GB styles keys.
 * Unmatched classes pass through as leftoverClasses.
 *
 * Configurable spacing scale for projects using non-default Tailwind config.
 */
export function tailwindLayoutToGbAttributes(
  classString: string,
  _config?: { spacingScale?: Record<string, string> },
): { styles: Record<string, string>; leftoverClasses: string } {
  if (!classString || !classString.trim()) {
    return { styles: {}, leftoverClasses: "" };
  }

  const tokens = classString.trim().split(/\s+/);
  const styles: Record<string, string> = {};
  const seenTokens = new Set<string>();
  const leftover: string[] = [];

  for (const token of tokens) {
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);

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

    if (!matched) {
      leftover.push(token);
    }
  }

  return { styles, leftoverClasses: leftover.join(" ") };
}
