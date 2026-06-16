import { describe, it } from "node:test";
import assert from "node:assert";
import { inventoryGlobalSelectors } from "../src/core/global-selector-inventory.js";

describe("inventoryGlobalSelectors", () => {
  it("detects body rule with background-color", () => {
    const css = "body { background-color: #EEEEEE; color: #334155; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.hasBackgroundColor, true);
    assert.strictEqual(result.hasTextColor, true);
    assert.strictEqual(result.hasOverflowX, false);
  });

  it("detects body rule with overflow-x", () => {
    const css = "body { overflow-x: hidden; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.hasOverflowX, true);
    assert.strictEqual(result.hasBackgroundColor, false);
  });

  it("detects :root custom properties", () => {
    const css = ":root { --brand: #FF7F59; --spacing: 1rem; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.rules[0].category, "custom-property");
  });

  it("detects ::selection pseudo-element", () => {
    const css = "::selection { background: #C5FFD6; color: #1E293B; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.rules[0].category, "pseudo-element");
  });

  it("detects multiple document-level rules", () => {
    const css = `
      body { background-color: #EEE; }
      html { scroll-behavior: smooth; }
      :root { --accent: blue; }
      ::selection { background: green; }
    `;
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 4);
  });

  it("ignores non-document-level selectors", () => {
    const css = ".blueprint-bg { background-size: 40px; } .container { max-width: 1200px; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 0);
  });

  it("returns empty inventory for empty CSS", () => {
    const result = inventoryGlobalSelectors("");
    assert.strictEqual(result.rules.length, 0);
  });

  it("detects ::backdrop pseudo-element", () => {
    const css = "::backdrop { background: rgba(0,0,0,0.5); }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.rules[0].category, "pseudo-element");
  });

  it("detects ::placeholder pseudo-element", () => {
    const css = "::placeholder { color: #999; }";
    const result = inventoryGlobalSelectors(css);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.rules[0].category, "pseudo-element");
  });
});
