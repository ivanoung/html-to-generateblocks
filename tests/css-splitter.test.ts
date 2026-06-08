import { describe, it } from "node:test";
import assert from "node:assert";
import { splitCss } from "../src/core/css-splitter.js";

describe("splitCss", () => {
  it("classifies single-class rules into globalStyles", () => {
    const css = ".pt-32{padding-top:8rem}.flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
    assert.strictEqual(result.globalStyles[0].selector, ".pt-32");
    assert.strictEqual(result.globalStyles[1].selector, ".flex");
    assert.strictEqual(result.uniqueCss, "");
  });

  it("puts element selectors into uniqueCss", () => {
    const css = "body{margin:0}h1{font-size:2rem}.foo{color:red}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".foo");
    assert.ok(result.uniqueCss.includes("body"), "uniqueCss should contain body rule");
    assert.ok(result.uniqueCss.includes("h1"), "uniqueCss should contain h1 rule");
  });

  it("handles pseudo-classes on single-class selectors", () => {
    const css = ".hover\\:bg-seafoam:hover{background-color:#93FFD8}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".hover\\:bg-seafoam");
    assert.ok(result.globalStyles[0].css.includes(":hover"), "CSS should preserve pseudo-class");
  });

  it("puts pseudo-element selectors into uniqueCss", () => {
    const css = ".no-scrollbar::-webkit-scrollbar{display:none}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("no-scrollbar"), "pseudo-element rule should be in uniqueCss");
  });

  it("puts multi-selector rules into uniqueCss", () => {
    const css = "h1,h2,h3{font-weight:bold}*,:after,:before{box-sizing:border-box}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("h1,h2,h3"));
    assert.ok(result.uniqueCss.includes("*,:after,:before"));
  });

  it("extracts class rules from inside @media blocks", () => {
    const css = "@media(min-width:768px){.md\\:text-7xl{font-size:4.5rem}.md\\:flex{display:flex}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
    assert.ok(result.globalStyles[0].css.includes("@media"), "CSS should preserve @media wrapper");
  });

  it("handles @keyframes — goes to uniqueCss", () => {
    const css = "@keyframes spin{to{transform:rotate(360deg)}}.animate-spin{animation:spin 1s linear infinite}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".animate-spin");
    assert.ok(result.uniqueCss.includes("@keyframes"), "keyframes should be in uniqueCss");
  });

  it("generates human-readable names from class names", () => {
    const css = ".pt-32{padding-top:8rem}.bg-primary{background:#c5ffd6}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles[0].name, "Pt 32");
    assert.strictEqual(result.globalStyles[1].name, "Bg Primary");
  });

  it("returns empty results for empty input", () => {
    const result = splitCss("");
    assert.strictEqual(result.globalStyles.length, 0);
    assert.strictEqual(result.uniqueCss, "");
  });

  it("survives malformed CSS — returns all as uniqueCss", () => {
    const result = splitCss("not valid css {{{");
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.length > 0);
  });
});
