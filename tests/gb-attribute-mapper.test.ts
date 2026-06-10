// tests/gb-attribute-mapper.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { mapStylesToGbAttributes } from "../src/core/gb-attribute-mapper.js";

describe("mapStylesToGbAttributes", () => {
  it("promotes backgroundColor to top-level attribute", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundColor: "#ffffff",
    });
    assert.strictEqual(gbAttrs.backgroundColor, "#ffffff");
    assert.strictEqual("backgroundColor" in remainingStyles, false);
  });

  it("promotes backgroundImage to bgImage + bgImageSize", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundImage: 'url("hero.jpg")',
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "hero.jpg" });
    assert.strictEqual(gbAttrs.bgImageSize, "full");
    assert.strictEqual("backgroundImage" in remainingStyles, false);
  });

  it("extracts URL from single-quoted backgroundImage", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: "url('image.png')",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "image.png" });
  });

  it("extracts URL from unquoted backgroundImage", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: "url(image.png)",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "image.png" });
  });

  it("promotes backgroundOptions to bgOptions with defaults", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    });
    assert.deepStrictEqual(gbAttrs.bgOptions, {
      selector: "element",
      opacity: 1,
      overlay: false,
      size: "cover",
      position: "center",
      repeat: "no-repeat",
    });
    assert.strictEqual("backgroundSize" in remainingStyles, false);
    assert.strictEqual("backgroundPosition" in remainingStyles, false);
    assert.strictEqual("backgroundRepeat" in remainingStyles, false);
  });

  it("promotes backgroundAttachment into bgOptions", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundAttachment: "fixed",
    });
    assert.deepStrictEqual(gbAttrs.bgOptions, {
      selector: "element",
      opacity: 1,
      overlay: false,
      attachment: "fixed",
    });
  });

  it("promotes color to textColor", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      color: "#111111",
    });
    assert.strictEqual(gbAttrs.textColor, "#111111");
    assert.strictEqual("color" in remainingStyles, false);
  });

  it("parses linear-gradient from background shorthand", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      background: "linear-gradient(135deg, #ffffff, #000000)",
    });
    assert.strictEqual(gbAttrs.gradient, true);
    assert.strictEqual(gbAttrs.gradientDirection, 135);
    assert.strictEqual(gbAttrs.gradientColorOne, "#ffffff");
    assert.strictEqual(gbAttrs.gradientColorTwo, "#000000");
    assert.strictEqual("background" in remainingStyles, false);
  });

  it("leaves spacing properties in remainingStyles", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundColor: "#fff",
      paddingTop: "64px",
      marginBottom: "24px",
    });
    assert.strictEqual(gbAttrs.backgroundColor, "#fff");
    assert.strictEqual(remainingStyles.paddingTop, "64px");
    assert.strictEqual(remainingStyles.marginBottom, "24px");
    assert.strictEqual("backgroundColor" in remainingStyles, false);
  });

  it("leaves layout properties in remainingStyles", () => {
    const { remainingStyles } = mapStylesToGbAttributes({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    });
    assert.strictEqual(remainingStyles.display, "flex");
    assert.strictEqual(remainingStyles.flexDirection, "column");
    assert.strictEqual(remainingStyles.alignItems, "center");
  });

  it("returns empty gbAttrs and empty remainingStyles for empty input", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({});
    assert.deepStrictEqual(gbAttrs, {});
    assert.deepStrictEqual(remainingStyles, {});
  });

  it("returns everything in remainingStyles when nothing is mappable", () => {
    const input = { paddingTop: "16px", display: "flex" };
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes(input);
    assert.deepStrictEqual(gbAttrs, {});
    assert.deepStrictEqual(remainingStyles, input);
  });

  it("leaves unparseable background-image URL in remainingStyles", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundImage: "not-a-url",
    });
    assert.strictEqual("bgImage" in gbAttrs, false);
    assert.strictEqual(remainingStyles.backgroundImage, "not-a-url");
  });

  it("leaves unparseable gradient in remainingStyles", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      background: "radial-gradient(circle, #fff, #000)",
    });
    assert.strictEqual("gradient" in gbAttrs, false);
    assert.strictEqual(remainingStyles.background, "radial-gradient(circle, #fff, #000)");
  });

  it("handles graceful fallback to url() URLs in background-image", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: "url(hero.jpg)",
      backgroundSize: "cover",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "hero.jpg" });
    assert.strictEqual(gbAttrs.bgImageSize, "full");
  });

  it("sets bgOptions only when at least one background option is present", () => {
    const { gbAttrs } = mapStylesToGbAttributes({
      backgroundImage: 'url("bg.jpg")',
    });
    // bgImage is set but bgOptions is not — GB will use its own defaults
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "bg.jpg" });
    assert.strictEqual("bgOptions" in gbAttrs, false);
  });

  it("does not mutate the input object", () => {
    const input = { backgroundColor: "#fff", paddingTop: "64px" };
    const inputCopy = { ...input };
    mapStylesToGbAttributes(input);
    assert.deepStrictEqual(input, inputCopy);
  });

  it("handles all background properties together", () => {
    const { gbAttrs, remainingStyles } = mapStylesToGbAttributes({
      backgroundImage: 'url("hero.jpg")',
      backgroundSize: "cover",
      backgroundPosition: "center center",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "scroll",
      paddingTop: "64px",
      display: "flex",
    });
    assert.deepStrictEqual(gbAttrs.bgImage, { url: "hero.jpg" });
    assert.strictEqual(gbAttrs.bgImageSize, "full");
    assert.deepStrictEqual(gbAttrs.bgOptions, {
      selector: "element",
      opacity: 1,
      overlay: false,
      size: "cover",
      position: "center center",
      repeat: "no-repeat",
      attachment: "scroll",
    });
    assert.strictEqual(remainingStyles.paddingTop, "64px");
    assert.strictEqual(remainingStyles.display, "flex");
  });
});
