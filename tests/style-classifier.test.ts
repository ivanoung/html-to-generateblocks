import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyStyles } from "../src/core/style-classifier.js";

describe("classifyStyles", () => {
  const computedStyles: Record<string, Record<string, string>> = {
    "section:nth-of-type(1)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(249, 250, 251)",
    },
    "section:nth-of-type(2)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(255, 255, 255)",
    },
    "section:nth-of-type(3)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(249, 250, 251)",
    },
    "section#hero": {
      paddingTop: "128px", paddingBottom: "128px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(255, 102, 0)", color: "rgb(255, 255, 255)",
    },
    "section:nth-of-type(5)": {
      paddingTop: "64px", paddingBottom: "64px", paddingLeft: "32px", paddingRight: "32px",
      backgroundColor: "rgb(204, 68, 0)", color: "rgb(255, 255, 255)",
    },
  };

  const config = {
    theme: { extend: { colors: { brand: { 500: "#ff6600", 700: "#cc4400" } } } }
  };

  it("classifies shared padding (>=3 uses) as Global Styles", () => {
    const result = classifyStyles(computedStyles, config);
    // px-8 py-16 = padding per side, used on all 5 sections
    assert.ok(result.globalStyles.length > 0, "should have at least one global style");
    const paddingStyles = result.globalStyles.filter(g => g.css.includes("padding"));
    assert.ok(paddingStyles.length >= 2, "shared padding properties should become Global Styles");
  });

  it("classifies unique section#hero styles as Inline", () => {
    const result = classifyStyles(computedStyles, config);
    const heroStyles = result.inlineStyles["section#hero"];
    assert.ok(heroStyles, "hero section should have inline styles");
    assert.ok(heroStyles.paddingTop === "128px" || Object.values(heroStyles).some(v => v === "128px"), "hero padding should be inline");
  });

  it("includes config colors that are actually used in Customizer", () => {
    const result = classifyStyles(computedStyles, config);
    assert.ok(result.customizer.colors["brand-500"], "brand-500 should be in customizer");
    assert.ok(result.customizer.colors["brand-700"], "brand-700 should be in customizer");
  });

  it("excludes config colors that are never used", () => {
    const configWithUnused = {
      theme: { extend: { colors: { brand: { 500: "#ff6600" }, unused: { 100: "#abcdef" } } } }
    };
    const result = classifyStyles(computedStyles, configWithUnused);
    assert.ok(!result.customizer.colors["unused-100"], "unused config color should be excluded");
  });

  it("handles empty computed styles gracefully", () => {
    const result = classifyStyles({}, null);
    assert.deepStrictEqual(result.customizer.colors, {});
    assert.deepStrictEqual(result.globalStyles, []);
    assert.deepStrictEqual(result.inlineStyles, {});
  });
});
