import { describe, it } from "node:test";
import assert from "node:assert";
import postcss from "postcss";
import { canonicalizeRule } from "../src/core/css-canonicalizer.js";

function cssToRule(css: string): postcss.Rule {
  const root = postcss.parse(css);
  const rule = root.nodes.find((n): n is postcss.Rule => n.type === "rule");
  if (!rule) throw new Error("No rule found in CSS");
  return rule;
}

describe("canonicalizeRule", () => {
  it("resolves --tw-text-opacity: 1 in rgb()", () => {
    const rule = cssToRule(".text-orange { --tw-text-opacity: 1; color: rgb(255 127 89 / var(--tw-text-opacity, 1)); }");
    canonicalizeRule(rule);
    const hasOpacityVar = rule.nodes.some((n) => n.type === "decl" && (n as postcss.Declaration).prop === "--tw-text-opacity");
    assert.strictEqual(hasOpacityVar, false);
    const colorDecl = rule.nodes.find((n) => n.type === "decl" && (n as postcss.Declaration).prop === "color") as postcss.Declaration;
    assert.ok(colorDecl);
    assert.strictEqual(colorDecl.value, "rgb(255, 127, 89)");
  });

  it("resolves --tw-bg-opacity: 0.5 in rgb()", () => {
    const rule = cssToRule(".bg-primary\\/50 { --tw-bg-opacity: 0.5; background-color: rgb(197 255 214 / var(--tw-bg-opacity, 1)); }");
    canonicalizeRule(rule);
    const decl = rule.nodes.find((n) => n.type === "decl" && (n as postcss.Declaration).prop === "background-color") as postcss.Declaration;
    assert.strictEqual(decl.value, "rgba(197, 255, 214, 0.5)");
  });

  it("resolves opacity: 0", () => {
    const rule = cssToRule(".invisible { --tw-text-opacity: 0; color: rgb(255 0 0 / var(--tw-text-opacity, 1)); }");
    canonicalizeRule(rule);
    const decl = rule.nodes.find((n) => n.type === "decl" && (n as postcss.Declaration).prop === "color") as postcss.Declaration;
    assert.strictEqual(decl.value, "rgba(255, 0, 0, 0)");
  });

  it("handles legacy rgba() syntax", () => {
    const rule = cssToRule(".old { --tw-bg-opacity: 1; background-color: rgba(197, 255, 214, var(--tw-bg-opacity, 1)); }");
    canonicalizeRule(rule);
    const decl = rule.nodes.find((n) => n.type === "decl" && (n as postcss.Declaration).prop === "background-color") as postcss.Declaration;
    assert.strictEqual(decl.value, "rgb(197, 255, 214)");
  });

  it("handles multiple opacity variables in one rule", () => {
    const rule = cssToRule(".combo { --tw-text-opacity: 1; --tw-bg-opacity: 0.5; color: rgb(255 127 89 / var(--tw-text-opacity, 1)); background-color: rgb(197 255 214 / var(--tw-bg-opacity, 1)); }");
    canonicalizeRule(rule);
    const colorDecl = rule.nodes.find((n) => n.type === "decl" && (n as postcss.Declaration).prop === "color") as postcss.Declaration;
    const bgDecl = rule.nodes.find((n) => n.type === "decl" && (n as postcss.Declaration).prop === "background-color") as postcss.Declaration;
    assert.strictEqual(colorDecl.value, "rgb(255, 127, 89)");
    assert.strictEqual(bgDecl.value, "rgba(197, 255, 214, 0.5)");
  });

  it("emits warning on cross-variable mismatch", () => {
    const rule = cssToRule(".mismatch { --tw-text-opacity: 0.5; color: rgb(255 0 0 / var(--tw-bg-opacity, 1)); }");
    const result = canonicalizeRule(rule);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes("CROSS_VARIABLE_MISMATCH"));
  });

  it("skips --tw-shadow-colored rules", () => {
    const rule = cssToRule(".shadow { --tw-shadow: 0 1px 2px 0; --tw-shadow-colored: 0 1px 2px 0 var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow), var(--tw-shadow); }");
    const result = canonicalizeRule(rule);
    assert.strictEqual(result.skipped, true);
  });

  it("returns empty rule when only --tw-* declarations exist", () => {
    const rule = cssToRule(".empty { --tw-text-opacity: 1; }");
    canonicalizeRule(rule);
    assert.strictEqual(rule.nodes.length, 0);
  });

  it("preserves declaration order after stripping", () => {
    const rule = cssToRule(".order { font-size: 1rem; --tw-text-opacity: 1; color: rgb(255 127 89 / var(--tw-text-opacity, 1)); line-height: 1.5; }");
    canonicalizeRule(rule);
    const props = rule.nodes.filter((n) => n.type === "decl").map((n) => (n as postcss.Declaration).prop);
    assert.deepStrictEqual(props, ["font-size", "color", "line-height"]);
  });
});
