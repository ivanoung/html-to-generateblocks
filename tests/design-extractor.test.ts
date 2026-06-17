// ── Design Extractor Tests ─────────────────────────────────
//
// TDD: RED phase — these tests test color normalization,
// JS object literal parsing, and config extraction from HTML.

import { describe, it } from "node:test";
import assert from "node:assert";
import { colorToHex, parseJsObjectLiteral, extractConfigFromHtml } from "../src/core/design-extractor.js";

describe("colorToHex", () => {
  it("converts 6-digit hex", () => {
    assert.strictEqual(colorToHex("#ff0000"), "#ff0000");
  });

  it("converts 3-digit hex to 6-digit", () => {
    assert.strictEqual(colorToHex("#f00"), "#ff0000");
  });

  it("converts 8-digit hex (drops alpha)", () => {
    assert.strictEqual(colorToHex("#ff000080"), "#ff0000");
  });

  it("converts rgb() comma-separated", () => {
    assert.strictEqual(colorToHex("rgb(30, 115, 190)"), "#1e73be");
  });

  it("converts rgba() to hex (ignoring alpha)", () => {
    assert.strictEqual(colorToHex("rgba(30, 115, 190, 0.5)"), "#1e73be");
  });

  it("converts space-separated modern rgb", () => {
    assert.strictEqual(colorToHex("rgb(255 0 0)"), "#ff0000");
  });

  it("converts hsl() to hex", () => {
    const result = colorToHex("hsl(0, 100%, 50%)");
    assert.strictEqual(result, "#ff0000");
  });

  it("converts hsla() to hex", () => {
    const result = colorToHex("hsla(120, 100%, 50%, 0.5)");
    assert.ok(result, "should produce hex");
    assert.strictEqual(result, "#00ff00");
  });

  it("converts oklch() to hex (approximately)", () => {
    const result = colorToHex("oklch(0.45 0.2 270)");
    assert.ok(result, "should produce a hex string");
    assert.ok(result.startsWith("#"), "result should start with #: " + result);
    assert.strictEqual(result.length, 7, "should be 7 chars (# + 6 hex)");
  });

  it("handles color-mix() by extracting first argument", () => {
    const result = colorToHex("color-mix(in srgb, #ff0000 80%, white)");
    assert.strictEqual(result, "#ff0000");
  });

  it("returns null for transparent", () => {
    assert.strictEqual(colorToHex("transparent"), null);
    assert.strictEqual(colorToHex("rgba(0, 0, 0, 0)"), null);
  });

  it("returns null for currentColor", () => {
    assert.strictEqual(colorToHex("currentColor"), null);
  });

  it("returns null for empty input", () => {
    assert.strictEqual(colorToHex(""), null);
  });

  it("clamps out-of-range rgb values", () => {
    assert.strictEqual(colorToHex("rgb(300, -10, 128)"), "#ff0080");
  });
});

describe("parseJsObjectLiteral", () => {
  it("parses flat object with unquoted keys", () => {
    const result = parseJsObjectLiteral("{ background: \"#EEEEEE\", primary: \"#C5FFD6\" }");
    assert.strictEqual(result.background, "#EEEEEE");
    assert.strictEqual(result.primary, "#C5FFD6");
  });

  it("parses nested objects", () => {
    const result = parseJsObjectLiteral("{ theme: { extend: { colors: { primary: \"#fff\" } } } }");
    const theme = result.theme as Record<string, unknown>;
    const extend = theme.extend as Record<string, unknown>;
    const colors = extend.colors as Record<string, unknown>;
    assert.strictEqual(colors.primary, "#fff");
  });

  it("parses single-quoted keys", () => {
    const result = parseJsObjectLiteral("{ 'container': '1600px' }");
    assert.strictEqual(result.container, "1600px");
  });

  it("parses arrays", () => {
    const result = parseJsObjectLiteral("{ fontFamily: ['DM Sans', 'sans-serif'] }");
    const fonts = result.fontFamily as string[];
    assert.ok(Array.isArray(fonts));
    assert.strictEqual(fonts[0], "DM Sans");
    assert.strictEqual(fonts[1], "sans-serif");
  });

  it("parses numbers and booleans", () => {
    const result = parseJsObjectLiteral("{ width: 1600, enabled: true, disabled: false, nothing: null }");
    assert.strictEqual(result.width, 1600);
    assert.strictEqual(result.enabled, true);
    assert.strictEqual(result.disabled, false);
    assert.strictEqual(result.nothing, null);
  });

  it("handles trailing commas", () => {
    const result = parseJsObjectLiteral("{ a: 1, }");
    assert.strictEqual(result.a, 1);
  });
});

describe("extractConfigFromHtml", () => {
  it("extracts colors, fonts, and maxWidth from tailwind.config script", () => {
    const html = `<script>
tailwind.config = {
  theme: {
    extend: {
      colors: { primary: "#ff0000", background: "#ffffff" },
      fontFamily: { sans: ["Inter", "sans-serif"] },
      maxWidth: { container: "1200px" }
    }
  }
}
</script>`;
    const config = extractConfigFromHtml(html);
    assert.ok(config);
    assert.strictEqual(config.colors.primary, "#ff0000");
    assert.strictEqual(config.colors.background, "#ffffff");
    assert.deepStrictEqual(config.fontFamily.sans, ["Inter", "sans-serif"]);
    assert.strictEqual(config.maxWidth.container, "1200px");
  });

  it("handles shade objects in colors (picks 500 or DEFAULT)", () => {
    const html = `<script>tailwind.config = { theme: { extend: { colors: { slate: { 800: "#272f31", 500: "#64748b" } } } } }</script>`;
    const config = extractConfigFromHtml(html);
    assert.ok(config);
    assert.strictEqual(config.colors.slate, "#64748b");
  });

  it("handles shade objects with only one shade", () => {
    const html = `<script>tailwind.config = { theme: { extend: { colors: { slate: { 800: "#272f31" } } } } }</script>`;
    const config = extractConfigFromHtml(html);
    assert.ok(config);
    assert.strictEqual(config.colors.slate, "#272f31");
  });

  it("returns null for HTML without tailwind.config", () => {
    const html = "<html><body>no config</body></html>";
    assert.strictEqual(extractConfigFromHtml(html), null);
  });

  it("also checks theme directly (not just extend)", () => {
    const html = `<script>tailwind.config = { theme: { colors: { primary: "#000" }, fontFamily: {}, maxWidth: {} } }</script>`;
    const config = extractConfigFromHtml(html);
    assert.ok(config);
    assert.strictEqual(config.colors.primary, "#000");
  });
});
