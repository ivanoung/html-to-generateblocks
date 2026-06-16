import { describe, it } from "node:test";
import assert from "node:assert";
import { extractBodyClasses } from "../src/core/tailwind-inliner.js";

describe("extractBodyClasses", () => {
  it("extracts classes from a single body tag", () => {
    const html = '<html><body class="font-sans antialiased blueprint-bg selection:bg-primary"></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, ["font-sans", "antialiased", "blueprint-bg", "selection:bg-primary"]);
  });

  it("deduplicates across multiple pages", () => {
    const html1 = '<html><body class="font-sans blueprint-bg"></body></html>';
    const html2 = '<html><body class="font-sans antialiased"></body></html>';
    const classes = extractBodyClasses([html1, html2]);
    assert.deepStrictEqual(classes, ["font-sans", "blueprint-bg", "antialiased"]);
  });

  it("returns empty array when no body tag", () => {
    const html = '<html><head></head></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, []);
  });

  it("returns empty array when body has no class attribute", () => {
    const html = '<html><body></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, []);
  });

  it("returns empty array when body class is empty string", () => {
    const html = '<html><body class=""></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, []);
  });

  it("handles data-class attribute before real class", () => {
    const html = '<html><body data-class="y" class="x"></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, ["x"]);
  });

  it("handles data-class attribute after real class", () => {
    const html = '<html><body class="x" data-class="y"></body></html>';
    const classes = extractBodyClasses([html]);
    assert.deepStrictEqual(classes, ["x"]);
  });
});
