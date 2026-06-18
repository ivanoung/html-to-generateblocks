import { describe, it } from "node:test";
import assert from "node:assert";
import { tailwindLayoutToGbAttributes } from "../src/core/tailwind-layout-mapper.js";

describe("tailwindLayoutToGbAttributes", () => {
  // ── Basic mapping ──
  it("maps flex + gap-4 to styles", () => {
    const result = tailwindLayoutToGbAttributes("flex gap-4");
    assert.strictEqual(result.styles.display, "flex");
    assert.strictEqual(result.styles.columnGap, "16px");
    assert.strictEqual(result.styles.rowGap, "16px");
    assert.strictEqual(result.leftoverClasses, "");
  });

  it("maps justify-between + items-center", () => {
    const result = tailwindLayoutToGbAttributes("justify-between items-center");
    assert.strictEqual(result.styles.justifyContent, "space-between");
    assert.strictEqual(result.styles.alignItems, "center");
  });

  it("maps grid-cols-3 + gap-8", () => {
    const result = tailwindLayoutToGbAttributes("grid-cols-3 gap-8");
    assert.strictEqual(result.styles.display, undefined);
    assert.strictEqual(result.styles.gridTemplateColumns, "repeat(3, minmax(0, 1fr))");
    assert.strictEqual(result.styles.columnGap, "32px");
  });

  it("maps col-span-2", () => {
    const result = tailwindLayoutToGbAttributes("col-span-2");
    assert.strictEqual(result.styles.gridColumn, "span 2");
  });

  // ── Partial conversion ──
  it("leaves unmapped classes as leftover", () => {
    const result = tailwindLayoutToGbAttributes("flex shadow-lg opacity-50");
    assert.strictEqual(result.styles.display, "flex");
    assert.ok(result.leftoverClasses.includes("shadow-lg"));
    assert.ok(result.leftoverClasses.includes("opacity-50"));
  });

  // ── Empty / whitespace ──
  it("returns empty for empty string", () => {
    const result = tailwindLayoutToGbAttributes("");
    assert.deepStrictEqual(result.styles, {});
    assert.strictEqual(result.leftoverClasses, "");
  });

  it("returns empty for whitespace-only", () => {
    const result = tailwindLayoutToGbAttributes("   ");
    assert.deepStrictEqual(result.styles, {});
    assert.strictEqual(result.leftoverClasses, "");
  });

  // ── Deduplication ──
  it("deduplicates classes", () => {
    const result = tailwindLayoutToGbAttributes("flex flex flex");
    assert.strictEqual(result.styles.display, "flex");
    assert.strictEqual(result.leftoverClasses, "");
  });

  // ── Priority: gap interactions ──
  it("gap-x overrides gap for column axis", () => {
    const result = tailwindLayoutToGbAttributes("gap-4 gap-x-8");
    assert.strictEqual(result.styles.columnGap, "32px");
    assert.strictEqual(result.styles.rowGap, "16px");
  });

  // ── Class ordering sensitivity ──
  it("class ordering matters: last-write-wins per style key", () => {
    // gap-x-8 sets columnGap:32px, then gap-4 overrides to columnGap:16px + rowGap:16px
    const a = tailwindLayoutToGbAttributes("gap-x-8 gap-4");
    assert.strictEqual(a.styles.columnGap, "16px");
    assert.strictEqual(a.styles.rowGap, "16px");
    // gap-4 sets both 16px, then gap-x-8 overrides column to 32px, row stays 16px
    const b = tailwindLayoutToGbAttributes("gap-4 gap-x-8");
    assert.strictEqual(b.styles.columnGap, "32px");
    assert.strictEqual(b.styles.rowGap, "16px");
  });

  it("justify-center after justify-between — last wins", () => {
    const result = tailwindLayoutToGbAttributes("justify-between justify-center");
    assert.strictEqual(result.styles.justifyContent, "center");
  });

  // ── Arbitrary values: pass through ──
  it("passes through gap-[13px] (not in spacing table)", () => {
    const result = tailwindLayoutToGbAttributes("gap-[13px]");
    assert.deepStrictEqual(result.styles, {});
    assert.strictEqual(result.leftoverClasses, "gap-[13px]");
  });

  // ── All display values ──
  it("maps all display values", () => {
    const tests: [string, string][] = [
      ["flex", "flex"], ["grid", "grid"], ["inline-flex", "inline-flex"],
      ["inline-grid", "inline-grid"], ["block", "block"],
      ["inline-block", "inline-block"], ["hidden", "none"],
    ];
    for (const [input, expected] of tests) {
      const result = tailwindLayoutToGbAttributes(input);
      assert.strictEqual(result.styles.display, expected, `display: ${input}`);
    }
  });

  // ── All flex directions ──
  it("maps all flex directions", () => {
    const tests: [string, string][] = [
      ["flex-row", "row"], ["flex-row-reverse", "row-reverse"],
      ["flex-col", "column"], ["flex-col-reverse", "column-reverse"],
    ];
    for (const [input, expected] of tests) {
      const result = tailwindLayoutToGbAttributes(input);
      assert.strictEqual(result.styles.flexDirection, expected, `flexDirection: ${input}`);
    }
  });

  // ── All justify values ──
  it("maps all justify-content values", () => {
    const tests: [string, string][] = [
      ["justify-start", "flex-start"], ["justify-center", "center"],
      ["justify-end", "flex-end"], ["justify-between", "space-between"],
      ["justify-around", "space-around"], ["justify-evenly", "space-evenly"],
      ["justify-normal", "normal"], ["justify-stretch", "stretch"],
    ];
    for (const [input, expected] of tests) {
      const r = tailwindLayoutToGbAttributes(input);
      assert.strictEqual(r.styles.justifyContent, expected, `justify: ${input}`);
    }
  });

  // ── Overflow → longhands ──
  it("maps overflow-hidden to overflowX + overflowY", () => {
    const result = tailwindLayoutToGbAttributes("overflow-hidden");
    assert.strictEqual(result.styles.overflowX, "hidden");
    assert.strictEqual(result.styles.overflowY, "hidden");
  });

  // ── Order ──
  it("order-first → order: -9999", () => {
    const result = tailwindLayoutToGbAttributes("order-first");
    assert.strictEqual(result.styles.order, "-9999");
  });

  it("order-last → order: 9999", () => {
    const result = tailwindLayoutToGbAttributes("order-last");
    assert.strictEqual(result.styles.order, "9999");
  });

  // ── Gap with standard spacing scale ──
  it("gap-4 maps to 16px", () => {
    const result = tailwindLayoutToGbAttributes("gap-4");
    assert.strictEqual(result.styles.columnGap, "16px");
  });

  // ── Aspect ratio / isolation / visibility ──
  it("maps aspect-square", () => {
    const result = tailwindLayoutToGbAttributes("aspect-square");
    assert.strictEqual(result.styles.aspectRatio, "1 / 1");
  });

  it("maps isolate and invisible", () => {
    const result = tailwindLayoutToGbAttributes("isolate invisible");
    assert.strictEqual(result.styles.isolation, "isolate");
    assert.strictEqual(result.styles.visibility, "hidden");
  });
});

describe("V2 — responsive breakpoints", () => {
  it("maps md:grid-cols-2 lg:grid-cols-4 with cascade", () => {
    const r = tailwindLayoutToGbAttributes("grid-cols-1 md:grid-cols-2 lg:grid-cols-4");
    assert.strictEqual(r.styles.gridTemplateColumns, "repeat(4, minmax(0, 1fr))");
    const t = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    const m = r.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(m.gridTemplateColumns, "repeat(1, minmax(0, 1fr))");
    assert.strictEqual(r.leftoverClasses, "");
  });

  it("maps flex-col sm:flex-row — Mobile column, Desktop row", () => {
    const r = tailwindLayoutToGbAttributes("flex-col sm:flex-row");
    assert.strictEqual(r.styles.flexDirection, "row");
    const m = r.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(m.flexDirection, "column");
    // Tablet = Desktop = row → no Tablet @media
    assert.strictEqual(r.styles["@media (max-width: 1024px) and (min-width: 768px)"], undefined);
  });

  it("xl: overrides lg — Desktop picks highest breakpoint", () => {
    const r = tailwindLayoutToGbAttributes("grid-cols-1 lg:grid-cols-2 xl:grid-cols-3");
    assert.strictEqual(r.styles.gridTemplateColumns, "repeat(3, minmax(0, 1fr))");
    const t = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t.gridTemplateColumns, "repeat(1, minmax(0, 1fr))");
  });

  it("skips redundant @media when value unchanged across tiers", () => {
    const r = tailwindLayoutToGbAttributes("grid-cols-2 md:grid-cols-2 lg:grid-cols-4");
    const t2 = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t2.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    const t3 = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t3.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
  });

  it("handles lg:grid-cols-none as intentional reset", () => {
    const r = tailwindLayoutToGbAttributes("grid-cols-4 md:grid-cols-2 lg:grid-cols-none");
    assert.strictEqual(r.styles.gridTemplateColumns, "none");
    const t = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    const m = r.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(m.gridTemplateColumns, "repeat(4, minmax(0, 1fr))");
  });

  it("passes through responsive cosmetic classes", () => {
    const r = tailwindLayoutToGbAttributes("flex md:shadow-lg lg:opacity-50");
    assert.strictEqual(r.styles.display, "flex");
    assert.ok(r.leftoverClasses.includes("md:shadow-lg"));
    assert.ok(r.leftoverClasses.includes("lg:opacity-50"));
  });

  it("multi-property responsive: display + gap", () => {
    const r = tailwindLayoutToGbAttributes("flex flex-col md:flex-row md:gap-4 lg:gap-8");
    assert.strictEqual(r.styles.display, "flex");
    assert.strictEqual(r.styles.flexDirection, "row");
    assert.strictEqual(r.styles.columnGap, "32px");
    const t = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t.columnGap, "16px");
    const m = r.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(m.flexDirection, "column");
  });

  it("merges multiple properties into same @media block", () => {
    const r = tailwindLayoutToGbAttributes("flex-col sm:flex-row sm:gap-4 lg:gap-8");
    assert.strictEqual(r.styles.flexDirection, "row");
    assert.strictEqual(r.styles.columnGap, "32px");
    const t = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t.columnGap, "16px");
    const m = r.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(m.flexDirection, "column");
  });

  it("sm:-only with no default — Desktop gets sm value", () => {
    const r = tailwindLayoutToGbAttributes("sm:flex sm:gap-4");
    assert.strictEqual(r.styles.display, "flex");
    assert.strictEqual(r.styles.columnGap, "16px");
    assert.strictEqual(r.styles["@media (max-width: 767px)"], undefined);
  });

  it("2xl:-only — Desktop picks 2xl", () => {
    const r = tailwindLayoutToGbAttributes("grid-cols-2 2xl:grid-cols-4");
    assert.strictEqual(r.styles.gridTemplateColumns, "repeat(4, minmax(0, 1fr))");
    const t3 = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t3.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
  });

  it("mixed breakpoints: sm: md: lg: xl: all on same property", () => {
    const r = tailwindLayoutToGbAttributes("gap-1 sm:gap-2 md:gap-4 lg:gap-8 xl:gap-12");
    assert.strictEqual(r.styles.columnGap, "48px");
    const t = r.styles["@media (max-width: 1024px) and (min-width: 768px)"] as any;
    assert.strictEqual(t.columnGap, "16px");
    const m = r.styles["@media (max-width: 767px)"] as any;
    assert.strictEqual(m.columnGap, "4px");
  });

  it("hover: and focus: prefixes are NOT parsed as breakpoints", () => {
    const r = tailwindLayoutToGbAttributes("flex hover:opacity-80 focus:border-blue-500");
    assert.strictEqual(r.styles.display, "flex");
    assert.ok(r.leftoverClasses.includes("hover:opacity-80"));
    assert.ok(r.leftoverClasses.includes("focus:border-blue-500"));
    assert.strictEqual(r.styles["@media (max-width: 767px)"], undefined);
  });

  it("bare colon prefix passes through as leftover", () => {
    const r = tailwindLayoutToGbAttributes("flex :broken-prefix");
    assert.strictEqual(r.styles.display, "flex");
    assert.ok(r.leftoverClasses.includes(":broken-prefix"));
  });

  it("stacked breakpoint+state prefix passes through", () => {
    const r = tailwindLayoutToGbAttributes("md:hover:flex md:hover:bg-primary");
    assert.ok(r.leftoverClasses.includes("md:hover:flex"));
    assert.ok(r.leftoverClasses.includes("md:hover:bg-primary"));
  });

  it("nested @media keys survive merge with existing styles", () => {
    const r = tailwindLayoutToGbAttributes("flex-col sm:flex-row");
    const existing = { backgroundColor: "#fff" };
    const merged = { ...existing, ...r.styles };
    assert.strictEqual(merged.backgroundColor, "#fff");
    assert.strictEqual(merged.flexDirection, "row");
    const m = merged["@media (max-width: 767px)"] as any;
    assert.strictEqual(m.flexDirection, "column");
  });

  it("V1 flat path still works", () => {
    const r = tailwindLayoutToGbAttributes("flex gap-4 items-center shadow-lg");
    assert.strictEqual(r.styles.display, "flex");
    assert.strictEqual(r.styles.columnGap, "16px");
    assert.ok(r.leftoverClasses.includes("shadow-lg"));
  });
});
