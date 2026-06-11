import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBlockDelimiters, deriveCssFromAttrs, renderStandalone } from "../src/core/renderer.js";

const SAMPLE_BLOCK = `<!-- wp:generateblocks/element {"uniqueId":"elem001","tagName":"section","styles":{"paddingTop":"64px","backgroundColor":"#f7f7f7"},"css":"","globalClasses":[],"htmlAttributes":{"id":"hero"}} -->
<section class="gb-element-elem001 gb-element" id="hero"><!-- /wp:generateblocks/element -->`;

describe("parseBlockDelimiters", () => {
  it("extracts block JSON from delimiter comments", () => {
    const blocks = parseBlockDelimiters(SAMPLE_BLOCK);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].blockName, "generateblocks/element");
    assert.strictEqual(blocks[0].attrs.uniqueId, "elem001");
    assert.strictEqual(blocks[0].attrs.styles.backgroundColor, "#f7f7f7");
    assert.strictEqual(blocks[0].innerHtml.trim(), '<section class="gb-element-elem001 gb-element" id="hero">');
  });
});

describe("deriveCssFromAttrs", () => {
  it("derives background-color from backgroundColor attribute", () => {
    const attrs = { uniqueId: "elem001", backgroundColor: "#f7f7f7", styles: {}, css: "" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.backgroundColor, "#f7f7f7");
  });

  it("derives bgImage from bgImage attribute (URL)", () => {
    const attrs = { uniqueId: "elem002", bgImage: "https://example.com/bg.jpg", bgImageSize: "cover", styles: {}, css: "" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.backgroundImage, "url(https://example.com/bg.jpg)");
    assert.strictEqual(styleObj.backgroundSize, "cover");
  });

  it("skips properties already present in css string", () => {
    const attrs = { uniqueId: "elem003", backgroundColor: "#f7f7f7", css: "background-color:#fff;" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.backgroundColor, undefined); // already in css, skip
  });

  it("derives gradient from gradient attributes", () => {
    const attrs = {
      uniqueId: "elem004",
      gradient: "linear-gradient",
      gradientDirection: "90deg",
      gradientColorOne: "#ff0000",
      gradientColorTwo: "#0000ff",
      styles: {},
      css: ""
    };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.strictEqual(styleObj.background, "linear-gradient(90deg,#ff0000,#0000ff)");
  });

  it("returns empty object when no GB attrs to derive", () => {
    const attrs = { uniqueId: "elem005", styles: {}, css: "" };
    const styleObj = deriveCssFromAttrs(attrs);
    assert.deepStrictEqual(styleObj, {});
  });
});

describe("renderStandalone", () => {
  const FIXTURE_DIR = resolve(process.cwd(), "fixtures/verify/good-simple-output");

  it("produces valid HTML document from GB output", () => {
    const html = renderStandalone(FIXTURE_DIR, "good-simple");
    // Must start with doctype
    assert.ok(html.startsWith("<!DOCTYPE html>"), "should start with <!DOCTYPE html>");
    // Must contain rendered content (no block delimiters)
    assert.ok(!html.includes("<!-- wp:generateblocks/"), "should not contain block delimiter comments");
    // Must contain the section element
    assert.ok(html.includes('<section class="gb-element-elem001'), "should contain rendered element");
    // Must contain text block content
    assert.ok(html.includes("Hello World"), "should contain text block content");
  });

  it("injects inline styles from GB attributes when css is empty", () => {
    const html = renderStandalone(FIXTURE_DIR, "good-simple");
    // The header section has backgroundColor:#f7f7f7 but css is empty
    // It should appear as an inline style
    assert.ok(html.includes("background-color"), "should inject derived background-color");
  });

  it("strips all block delimiter comments", () => {
    const html = renderStandalone(FIXTURE_DIR, "good-simple");
    const comments = html.match(/<!--\s*wp:/g);
    assert.strictEqual(comments, null, "should have zero block delimiters");
  });

  it("wraps in proper HTML document structure", () => {
    const html = renderStandalone(FIXTURE_DIR, "good-simple");
    assert.ok(html.includes("<head>"), "should have <head>");
    assert.ok(html.includes("<body>"), "should have <body>");
    assert.ok(html.includes("</html>"), "should close with </html>");
    assert.ok(html.includes('<meta charset="UTF-8">'), "should have charset meta");
    assert.ok(html.includes('<meta name="viewport"'), "should have viewport meta");
  });
});
