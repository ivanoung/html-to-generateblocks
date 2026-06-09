import { describe, it } from "node:test";
import assert from "node:assert";
import { splitCss } from "../src/core/css-splitter.js";

describe("splitCss", () => {
  it("puts custom classes into globalStyles, everything else into uniqueCss", () => {
    const css = ".blueprint-bg{background:#0a0a0a}.pt-32{padding-top:8rem}.flex{display:flex}";
    const custom = new Set(["blueprint-bg"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".blueprint-bg");
    assert.ok(result.uniqueCss.includes("pt-32"), "Tailwind utility should be in UC");
    assert.ok(result.uniqueCss.includes("flex"), "Tailwind utility should be in UC");
  });

  it("puts everything into uniqueCss when no custom class names are provided", () => {
    const css = ".pt-32{padding-top:8rem}.flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("pt-32"));
    assert.ok(result.uniqueCss.includes("flex"));
  });

  it("puts everything into uniqueCss with empty custom set", () => {
    const css = ".pt-32{padding-top:8rem}";
    const result = splitCss(css, new Set());
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("pt-32"));
  });

  it("includes element and universal selectors in uniqueCss", () => {
    const css = "body{margin:0}*,::before,::after{box-sizing:border-box}.foo{color:red}";
    const custom = new Set(["foo"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".foo");
    assert.ok(result.uniqueCss.includes("body"), "element selector should be in UC");
    assert.ok(result.uniqueCss.includes("box-sizing"), "preflight should be in UC");
  });

  it("puts pseudo-class selectors into uniqueCss", () => {
    const css = ".hover\\:bg-seafoam:hover{background-color:#93FFD8}.my-custom{color:red}";
    const custom = new Set(["hover\\:bg-seafoam", "my-custom"]);
    const result = splitCss(css, custom);
    // .hover\:bg-seafoam has a pseudo-class → isSingleClassSelector strips it
    // but the selector still has non-escaped colon before :hover → goes to UC
    // Actually with the custom set, only plain selectors match
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".my-custom");
    assert.ok(result.uniqueCss.includes(":hover"), "pseudo-class rule should be in UC");
  });

  it("puts pseudo-element selectors into uniqueCss", () => {
    const css = ".no-scrollbar::-webkit-scrollbar{display:none}";
    const result = splitCss(css, new Set(["no-scrollbar"]));
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("no-scrollbar"), "pseudo-element rule should be in UC");
  });

  it("puts multi-selector rules into uniqueCss", () => {
    const css = "h1,h2,h3{font-weight:bold}.group:hover .group-hover\\:text-primary{color:red}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("group-hover"), "class combinator rule should be in UC");
    assert.ok(result.uniqueCss.includes("h1,h2,h3"), "element multi-selector should be in UC");
  });

  it("keeps @media blocks intact in uniqueCss", () => {
    const css = "@media(min-width:768px){.md\\:text-7xl{font-size:4.5rem}.md\\:flex{display:flex}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("@media"), "@media block should be in UC");
  });

  it("handles @keyframes — goes to uniqueCss", () => {
    const css = "@keyframes spin{to{transform:rotate(360deg)}}.animate-spin{animation:spin 1s linear infinite}";
    const custom = new Set(["animate-spin"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".animate-spin");
    assert.ok(result.uniqueCss.includes("@keyframes"), "keyframes should be in UC");
  });

  it("generates human-readable names from class names", () => {
    const css = ".blueprint-bg{background:#0a0a0a}.clip-hex{clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)}";
    const custom = new Set(["blueprint-bg", "clip-hex"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 2);
    assert.strictEqual(result.globalStyles[0].name, "Blueprint Bg");
    assert.strictEqual(result.globalStyles[1].name, "Clip Hex");
  });

  it("returns empty results for empty input", () => {
    const result = splitCss("");
    assert.strictEqual(result.globalStyles.length, 0);
    assert.strictEqual(result.uniqueCss, "");
  });

  it("survives malformed CSS — returns empty", () => {
    const result = splitCss("not valid css {{{");
    assert.strictEqual(result.globalStyles.length, 0);
  });

  it("deduplicates entries with the same selector", () => {
    const css = ".my-custom{width:100%}.my-custom{max-width:1600px}";
    const custom = new Set(["my-custom"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".my-custom");
    assert.ok(result.globalStyles[0].css.includes("width:100%"), "should include first rule");
    assert.ok(result.globalStyles[0].css.includes("max-width:1600px"), "should include second rule");
  });
});
