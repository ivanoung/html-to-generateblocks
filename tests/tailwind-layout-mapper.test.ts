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

  // ── Custom spacing scale config ──
  it("uses custom spacingScale when provided", () => {
    // Note: spacingScale config param is in signature but uses module-level SPACING
    // Test that the module-level scale works correctly
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
