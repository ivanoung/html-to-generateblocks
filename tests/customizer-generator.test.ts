import { describe, it } from "node:test";
import assert from "node:assert";
import { generateCustomizerSettings, buildCustomizerJson } from "../src/core/customizer-generator.js";
import type { MappedTokens } from "../src/core/token-mapper.js";
import type { DesignDossier } from "../src/core/design-dossier.js";

function makeBasicDossier(): DesignDossier {
  return {
    colors: [
      { hex: "#f8f9fa", usageCount: 200, roles: ["body-bg"], examples: ["body"], configName: "background" },
      { hex: "#0d6efd", usageCount: 60, roles: ["button", "link"], examples: ["a", "button"], configName: "primary" },
    ],
    fonts: [
      { fontFamily: "Inter, sans-serif", roles: ["body", "h1"], configName: "sans", sampleSize: "16px", sampleWeight: "400" },
    ],
    containers: [{ px: 1200, source: "computed", selector: "div.container" }],
    customProperties: [],
    googleFonts: [],
    typographySamples: [
      { selector: "body", tagName: "body", fontSize: "16px", fontWeight: "400", lineHeight: "1.5", fontFamily: "Inter, sans-serif", textTransform: "none", letterSpacing: "normal" },
      { selector: "h1", tagName: "h1", fontSize: "36px", fontWeight: "700", lineHeight: "1.2", fontFamily: "Inter, sans-serif", textTransform: "none", letterSpacing: "-0.01em" },
    ],
    tailwindConfig: null,
    classFrequency: {},
    extracted: true,
    warnings: [],
  };
}

describe("generateCustomizerSettings", () => {
  it("returns null for unextracted dossier", () => {
    assert.strictEqual(generateCustomizerSettings({ ...makeBasicDossier(), extracted: false }), null);
  });

  it("produces valid CustomizerExport with colors and typography", () => {
    const result = generateCustomizerSettings(makeBasicDossier());
    assert.ok(result);
    const s = result.options.generate_settings as Record<string, unknown>;
    assert.ok(Array.isArray(s.global_colors));
    assert.ok(Array.isArray(s.typography));
    assert.strictEqual(typeof s.container_width, "number");
    assert.strictEqual(typeof s.background_color, "string");
  });

  it("includes background, primary, accent in global_colors", () => {
    const result = generateCustomizerSettings(makeBasicDossier())!;
    const slugs = (result.options.generate_settings.global_colors as Array<{slug: string}>).map((c) => c.slug);
    assert.ok(slugs.includes("background"));
    assert.ok(slugs.includes("primary"));
    assert.ok(slugs.includes("accent"));
  });

  it("no empty required fields", () => {
    const result = generateCustomizerSettings(makeBasicDossier())!;
    const s = result.options.generate_settings;
    assert.ok(s.background_color.length > 0);
    assert.ok(s.link_color.length > 0);
  });
});

describe("buildCustomizerJson", () => {
  it("produces valid JSON with all required sections", () => {
    const tokens: MappedTokens = {
      globalColors: [
        { name: "Background", slug: "background", color: "#ffffff" },
        { name: "Primary", slug: "primary", color: "#0d6efd" },
        { name: "Accent", slug: "accent", color: "#0d6efd" },
      ],
      typography: [{
        selector: "body", customSelector: "", fontFamily: "Inter, sans-serif",
        fontWeight: "400", textTransform: "", textDecoration: "", fontStyle: "",
        fontSize: "16px", fontSizeTablet: "", fontSizeMobile: "",
        lineHeight: "", lineHeightTablet: "", lineHeightMobile: "",
        letterSpacing: "", letterSpacingTablet: "", letterSpacingMobile: "",
        marginBottom: "", marginBottomTablet: "", marginBottomMobile: "",
        marginBottomUnit: "px", module: "core", group: "base",
      }],
      backgroundColor: "#ffffff",
      containerWidth: 1200,
      linkColor: "#0d6efd",
      linkColorHover: "",
      confidence: "high",
      notes: [],
    };
    const result = buildCustomizerJson(tokens);
    assert.ok(result.modules.Backgrounds);
    assert.ok(result.modules.Blog);
    assert.strictEqual(result.options.generate_settings.container_width, 1200);
  });
});
