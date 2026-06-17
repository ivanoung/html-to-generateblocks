import { describe, it } from "node:test";
import assert from "node:assert";
import { mapTokensHeuristic } from "../src/core/token-mapper.js";
import type { DesignDossier } from "../src/core/design-dossier.js";

function makeMinoDossier(): DesignDossier {
  return {
    colors: [
      { hex: "#eeeeee", usageCount: 142, roles: ["body-bg", "generic"], examples: ["body", "div"], configName: "background" },
      { hex: "#1e293b", usageCount: 87, roles: ["generic", "footer"], examples: ["div.surface", "footer"], configName: "surface" },
      { hex: "#c5ffd6", usageCount: 45, roles: ["button", "link", "generic"], examples: ["a.button", "button"], configName: "primary" },
      { hex: "#3d3b4f", usageCount: 23, roles: ["generic"], examples: ["div.secondary"], configName: "secondary" },
      { hex: "#334155", usageCount: 120, roles: ["generic"], examples: ["p", "span"], configName: "slate" },
    ],
    fonts: [
      { fontFamily: '"DM Sans", sans-serif', roles: ["body", "p", "a"], configName: "sans", sampleSize: "16px", sampleWeight: "400" },
      { fontFamily: 'Anybody, sans-serif', roles: ["h1", "h2", "h3"], configName: "display", sampleSize: "48px", sampleWeight: "700" },
    ],
    containers: [{ px: 1600, source: "computed", selector: "div.max-w-container" }],
    customProperties: [
      { name: "--primary", value: "#c5ffd6", context: ":root" },
      { name: "--secondary", value: "#3d3b4f", context: ":root" },
    ],
    googleFonts: [],
    typographySamples: [
      { selector: "body", tagName: "body", fontSize: "16px", fontWeight: "400", lineHeight: "1.6", fontFamily: '"DM Sans", sans-serif', textTransform: "none", letterSpacing: "normal" },
      { selector: "h1", tagName: "h1", fontSize: "48px", fontWeight: "700", lineHeight: "1.2", fontFamily: 'Anybody, sans-serif', textTransform: "none", letterSpacing: "-0.02em" },
    ],
    tailwindConfig: {
      colors: { background: "#eeeeee", primary: "#c5ffd6", secondary: "#3d3b4f", slate: "#334155" },
      fontFamily: { sans: ['"DM Sans"', "sans-serif"], display: ["Anybody", "sans-serif"] },
      maxWidth: { container: "1600px" },
    },
    extracted: true,
    warnings: [],
  };
}

describe("mapTokensHeuristic", () => {
  it("picks background from body-bg role", () => {
    assert.strictEqual(mapTokensHeuristic(makeMinoDossier()).backgroundColor, "#eeeeee");
  });

  it("picks primary from CSS custom property --primary", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    assert.strictEqual(tokens.linkColor, "#c5ffd6");
    assert.strictEqual(tokens.globalColors.find((c) => c.slug === "primary")?.color, "#c5ffd6");
  });

  it("picks secondary from CSS custom property --secondary", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    assert.strictEqual(tokens.globalColors.find((c) => c.slug === "secondary")?.color, "#3d3b4f");
  });

  it("picks body font from body role", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    const body = tokens.typography.find((t) => t.selector === "body");
    assert.ok(body, "should have body typography entry");
    assert.ok(body.fontFamily.includes("DM Sans"));
  });

  it("picks heading font from h1 role", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    const heading = tokens.typography.find((t) => t.selector === "all-headings");
    assert.ok(heading, "should have all-headings entry");
    assert.ok(heading.fontFamily.includes("Anybody"));
  });

  it("accent equals primary", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    const accent = tokens.globalColors.find((c) => c.slug === "accent");
    const primary = tokens.globalColors.find((c) => c.slug === "primary");
    assert.strictEqual(accent?.color, primary?.color);
  });

  it("falls back to defaults on empty dossier", () => {
    const empty = makeMinoDossier();
    empty.colors = []; empty.fonts = []; empty.containers = [];
    empty.customProperties = []; empty.tailwindConfig = null;
    empty.typographySamples = [];
    const tokens = mapTokensHeuristic(empty);
    assert.strictEqual(tokens.backgroundColor, "#ffffff");
    assert.strictEqual(tokens.containerWidth, 1600);
    assert.ok(tokens.globalColors.length >= 1);
  });

  it("includes background, primary, secondary, accent in global_colors", () => {
    const tokens = mapTokensHeuristic(makeMinoDossier());
    const slugs = tokens.globalColors.map((c) => c.slug);
    assert.ok(slugs.includes("background"));
    assert.ok(slugs.includes("primary"));
    assert.ok(slugs.includes("secondary"));
    assert.ok(slugs.includes("accent"));
  });
});
