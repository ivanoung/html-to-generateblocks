import { describe, it } from "node:test";
import assert from "node:assert";
import { isTailwindUtility, disablePreflight } from "../src/core/css-classifier.js";

// ── isTailwindUtility ──────────────────────────────────────

describe("isTailwindUtility", () => {
  // Spacing utilities
  it("detects spacing utilities (m-*, p-*, mt-*, px-*)", () => {
    assert.ok(isTailwindUtility(".mt-4"));
    assert.ok(isTailwindUtility(".p-2"));
    assert.ok(isTailwindUtility(".mx-auto"));
    assert.ok(isTailwindUtility(".py-8"));
    assert.ok(isTailwindUtility(".mb-12"));
  });

  it("detects gap and space utilities", () => {
    assert.ok(isTailwindUtility(".gap-4"));
    assert.ok(isTailwindUtility(".gap-x-2"));
    assert.ok(isTailwindUtility(".space-x-4"));
  });

  // Sizing utilities
  it("detects sizing utilities (w-*, h-*)", () => {
    assert.ok(isTailwindUtility(".w-full"));
    assert.ok(isTailwindUtility(".h-64"));
    assert.ok(isTailwindUtility(".min-w-0"));
    assert.ok(isTailwindUtility(".max-w-4xl"));
  });

  // Typography utilities
  it("detects typography utilities", () => {
    assert.ok(isTailwindUtility(".text-sm"));
    assert.ok(isTailwindUtility(".text-xl"));
    assert.ok(isTailwindUtility(".font-sans"));
    assert.ok(isTailwindUtility(".font-bold"));
    assert.ok(isTailwindUtility(".tracking-wider"));
    assert.ok(isTailwindUtility(".leading-relaxed"));
    assert.ok(isTailwindUtility(".uppercase"));
  });

  // Color utilities
  it("detects color utilities (bg-*, text-*, border-*)", () => {
    assert.ok(isTailwindUtility(".bg-slate-100"));
    assert.ok(isTailwindUtility(".text-primary"));
    assert.ok(isTailwindUtility(".border-red-500"));
    assert.ok(isTailwindUtility(".ring-blue-200"));
  });

  // Layout utilities
  it("detects layout utilities", () => {
    assert.ok(isTailwindUtility(".flex"));
    assert.ok(isTailwindUtility(".grid"));
    assert.ok(isTailwindUtility(".hidden"));
    assert.ok(isTailwindUtility(".block"));
    assert.ok(isTailwindUtility(".inline-flex"));
    assert.ok(isTailwindUtility(".container"));
  });

  // Position utilities
  it("detects position utilities", () => {
    assert.ok(isTailwindUtility(".fixed"));
    assert.ok(isTailwindUtility(".absolute"));
    assert.ok(isTailwindUtility(".relative"));
    assert.ok(isTailwindUtility(".sticky"));
  });

  // Flex/grid utilities
  it("detects flex/grid alignment utilities", () => {
    assert.ok(isTailwindUtility(".flex-row"));
    assert.ok(isTailwindUtility(".flex-col"));
    assert.ok(isTailwindUtility(".items-center"));
    assert.ok(isTailwindUtility(".justify-between"));
    assert.ok(isTailwindUtility(".grid-cols-3"));
  });

  // Effects utilities
  it("detects effects utilities", () => {
    assert.ok(isTailwindUtility(".opacity-50"));
    assert.ok(isTailwindUtility(".shadow-lg"));
    assert.ok(isTailwindUtility(".rounded-xl"));
    assert.ok(isTailwindUtility(".rounded"));
    assert.ok(isTailwindUtility(".blur-sm"));
  });

  // Transform utilities
  it("detects transform utilities", () => {
    assert.ok(isTailwindUtility(".scale-90"));
    assert.ok(isTailwindUtility(".rotate-45"));
    assert.ok(isTailwindUtility(".translate-x-4"));
  });

  // Transition utilities
  it("detects transition utilities", () => {
    assert.ok(isTailwindUtility(".transition-all"));
    assert.ok(isTailwindUtility(".duration-300"));
    assert.ok(isTailwindUtility(".ease-out"));
    assert.ok(isTailwindUtility(".animate-spin"));
  });

  // Variant prefixes
  it("detects hover/focus/active variants", () => {
    assert.ok(isTailwindUtility(".hover\\:opacity-80"));
    assert.ok(isTailwindUtility(".hover\\:bg-primary"));
    assert.ok(isTailwindUtility(".focus\\:border-blue-500"));
    assert.ok(isTailwindUtility(".active\\:scale-95"));
  });

  it("detects group/peer variants", () => {
    assert.ok(isTailwindUtility(".group-hover\\:opacity-100"));
    assert.ok(isTailwindUtility(".peer-checked\\:border-seafoam"));
  });

  it("detects responsive variants (sm/md/lg/xl/2xl)", () => {
    assert.ok(isTailwindUtility(".sm\\:flex"));
    assert.ok(isTailwindUtility(".md\\:grid-cols-2"));
    assert.ok(isTailwindUtility(".lg\\:text-xl"));
    assert.ok(isTailwindUtility(".xl\\:w-1/2"));
  });

  it("detects dark mode variant", () => {
    assert.ok(isTailwindUtility(".dark\\:bg-slate-800"));
  });

  it("detects arbitrary value utilities", () => {
    assert.ok(isTailwindUtility(".w-\\[300px\\]"));
    assert.ok(isTailwindUtility(".text-\\[#fff\\]"));
    assert.ok(isTailwindUtility(".\\[\\&_\\>\\*\\]\\:block"));
  });

  it("detects z-index, cursor, overflow utilities", () => {
    assert.ok(isTailwindUtility(".z-50"));
    assert.ok(isTailwindUtility(".z-10"));
    assert.ok(isTailwindUtility(".cursor-pointer"));
    assert.ok(isTailwindUtility(".overflow-hidden"));
    assert.ok(isTailwindUtility(".overflow-x-auto"));
  });

  // Design component classes should NOT match
  it("does NOT flag custom design component classes", () => {
    assert.ok(!isTailwindUtility(".blueprint-bg"));
    assert.ok(!isTailwindUtility(".blueprint-bg-dark"));
    assert.ok(!isTailwindUtility(".ruler-x"));
    assert.ok(!isTailwindUtility(".hover-shadow-md"));
    assert.ok(!isTailwindUtility(".clip-hex"));
    assert.ok(!isTailwindUtility(".no-scrollbar"));
  });

  it("does NOT flag semantic class names with mixed case", () => {
    assert.ok(!isTailwindUtility(".btnPrimary"));
    assert.ok(!isTailwindUtility(".Card"));
    assert.ok(!isTailwindUtility(".SectionHeader"));
  });

  it("does NOT flag BEM-style classes", () => {
    assert.ok(!isTailwindUtility(".card__title"));
    assert.ok(!isTailwindUtility(".btn--primary"));
    assert.ok(!isTailwindUtility(".nav__link--active"));
  });
});

// ── disablePreflight ───────────────────────────────────────

describe("disablePreflight", () => {
  it("injects corePlugins into config without corePlugins", () => {
    const input = '{theme:{extend:{colors:{primary:"#fff"}}}}';
    const result = disablePreflight(input);
    assert.ok(result.includes("corePlugins"));
    assert.ok(result.includes("preflight"));
    assert.ok(result.includes("false"));
    // Original content preserved
    assert.ok(result.includes("primary"));
  });

  it("merges into existing corePlugins object", () => {
    const input = '{corePlugins:{float:false},theme:{}}';
    const result = disablePreflight(input);
    assert.ok(result.includes("preflight"));
    assert.ok(result.includes("float"));
  });

  it("preserves theme and other config keys", () => {
    const input = '{theme:{extend:{colors:{bg:"#eee"},fontFamily:{sans:["DM Sans"]}}}}';
    const result = disablePreflight(input);
    assert.ok(result.includes("DM Sans"));
    assert.ok(result.includes("bg"));
    assert.ok(result.includes("preflight"));
  });

  it("handles empty config object", () => {
    const result = disablePreflight("{}");
    assert.ok(result.includes("corePlugins"));
    assert.ok(result.includes("preflight"));
  });
});
