import { describe, it } from "node:test";
import assert from "node:assert";
import { isGbSupported } from "../src/core/gb-whitelist.js";

describe("isGbSupported", () => {
  it("accepts color with rgb value", () => {
    assert.strictEqual(isGbSupported("color", "rgb(255, 127, 89)"), true);
  });
  it("accepts backgroundColor with hex value", () => {
    assert.strictEqual(isGbSupported("backgroundColor", "#C5FFD6"), true);
  });
  it("accepts fontSize with rem value", () => {
    assert.strictEqual(isGbSupported("fontSize", "1.5rem"), true);
  });
  it("accepts display with block value", () => {
    assert.strictEqual(isGbSupported("display", "block"), true);
  });
  it("rejects unknown property", () => {
    assert.strictEqual(isGbSupported("transform", "translateX(1rem)"), false);
  });
  it("rejects property in whitelist but unsupported value function", () => {
    assert.strictEqual(isGbSupported("color", "color-mix(in srgb, red, blue)"), false);
  });
  it("rejects property in whitelist but unsupported color space", () => {
    assert.strictEqual(isGbSupported("color", "oklch(0.6 0.2 150)"), false);
  });
  it("rejects unresolved var()", () => {
    assert.strictEqual(isGbSupported("color", "var(--brand-color)"), false);
  });
  it("rejects CSS-wide keyword inherit", () => {
    assert.strictEqual(isGbSupported("color", "inherit"), false);
  });
  it("rejects vendor-prefixed value", () => {
    assert.strictEqual(isGbSupported("display", "-webkit-box"), false);
  });
  it("rejects empty string value", () => {
    assert.strictEqual(isGbSupported("color", ""), false);
  });
});
