import { describe, it } from "node:test";
import assert from "node:assert";
import { splitCss } from "../src/core/css-splitter.js";

describe("splitCss — property-based classification", () => {
  // ── GS-eligible: structural ────────────────────────────────

  it("structural: display → GS", () => {
    const css = ".flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".flex");
    assert.ok(result.globalStyles[0].css.includes("display:flex"));
    assert.strictEqual(result.uniqueCss, "");
  });

  it("structural: sizing → GS", () => {
    const css = ".w-full{width:100%}.h-screen{height:100vh}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: spacing → GS", () => {
    const css = ".pt-32{padding-top:8rem}.m-4{margin:1rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: flex/grid → GS", () => {
    const css = ".flex-col{flex-direction:column}.grid-cols-2{grid-template-columns:repeat(2,1fr)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: borders → GS", () => {
    const css = ".rounded-lg{border-radius:0.5rem}.border{border-width:1px;border-style:solid}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 2);
  });

  it("structural: positioning → GS", () => {
    const css = ".absolute{position:absolute}.top-0{top:0}.z-10{z-index:10}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 3);
  });

  // ── GS-eligible: typography ────────────────────────────────

  it("typography → GS", () => {
    const css = ".text-lg{font-size:1.125rem;line-height:1.75rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".text-lg");
  });

  it("text color → GS", () => {
    const css = ".text-primary{color:var(--primary)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".text-primary");
  });

  // ── UC-only: background-color ──────────────────────────────

  it("background-color → UC", () => {
    const css = ".bg-primary{background-color:var(--primary)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("bg-primary"));
  });

  it("background shorthand → UC", () => {
    const css = ".bg-white{background:#fff}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("bg-white"));
  });

  // ── UC-only: backgrounds ───────────────────────────────────

  it("background-image → UC", () => {
    const css = ".bg-gradient-to-r{background-image:linear-gradient(to right,red,blue)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("bg-gradient-to-r"));
  });

  // ── UC-only: effects ───────────────────────────────────────

  it("effects → UC", () => {
    const css = ".shadow{box-shadow:0 1px 3px rgba(0,0,0,0.1)}.opacity-50{opacity:0.5}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("shadow"));
    assert.ok(result.uniqueCss.includes("opacity-50"));
  });

  it("transforms → UC", () => {
    const css = ".rotate-45{transform:rotate(45deg)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("rotate-45"));
  });

  // ── UC-only: transitions & animations ──────────────────────

  it("transitions → UC", () => {
    const css = ".transition{transition:0.3s}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("transition"));
  });

  it("animations → UC", () => {
    const css = ".animate-spin{animation:spin 1s linear infinite}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("animate-spin"));
  });

  // ── Mixed properties (any UC → entire rule to UC) ──────────

  it("mixed: structural + transition → UC", () => {
    const css = ".btn{padding:1rem;transition:0.3s}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("btn"));
  });

  it("mixed: typography + box-shadow → UC", () => {
    const css = ".card{font-size:1rem;padding:1rem;box-shadow:0 2px 4px rgba(0,0,0,0.1)}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("card"));
  });

  // ── @media (responsive) handling ───────────────────────────

  it("responsive structural → GS with @media wrapper", () => {
    const css = "@media(min-width:768px){.md\\:flex{display:flex}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md\\:flex");
    assert.ok(result.globalStyles[0].css.includes("@media"));
    assert.ok(result.globalStyles[0].css.includes("display:flex"));
  });

  it("responsive typography → GS with @media wrapper", () => {
    const css = "@media(min-width:768px){.md\\:text-7xl{font-size:4.5rem;line-height:1}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md\\:text-7xl");
    assert.ok(result.globalStyles[0].css.includes("@media"));
  });

  it("responsive background-color stays in UC", () => {
    const css = "@media(min-width:768px){.md\\:bg-primary{background-color:var(--primary)}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("@media"));
    assert.ok(result.uniqueCss.includes("md\\:bg-primary"));
  });

  it("mixed @media children: GS + UC coexist", () => {
    const css = "@media(min-width:768px){.md\\:flex{display:flex}.md\\:shadow{box-shadow:0 2px 4px rgba(0,0,0,0.1)}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".md\\:flex");
    assert.ok(result.uniqueCss.includes("md\\:shadow"));
  });

  // ── Non-class selectors ────────────────────────────────────

  it("element selector → UC", () => {
    const css = "body{margin:0}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("body"));
  });

  it("multi-selector → UC", () => {
    const css = "h1,h2,h3{font-weight:bold}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("h1,h2,h3"));
  });

  it("pseudo-element → UC (even with GS properties)", () => {
    const css = ".foo::before{display:block;content:\"\"}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("foo"));
  });

  it("combinator (descendant) → UC", () => {
    const css = ".group:hover .group-hover\\:flex{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("group-hover"));
  });

  // ── Keyframes ──────────────────────────────────────────────

  it("keyframes → UC", () => {
    const css = "@keyframes spin{to{transform:rotate(360deg)}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("@keyframes"));
  });

  // ── Preflight ──────────────────────────────────────────────

  it("preflight reset → UC", () => {
    const css = "*,::after,::before{box-sizing:border-box}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("box-sizing"));
  });

  // ── Custom class priority ──────────────────────────────────

  it("custom class bypasses property check → GS", () => {
    const css = ".blueprint-bg{background:#0a0a0a}";
    const custom = new Set(["blueprint-bg"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".blueprint-bg");
  });

  it("custom class with UC-only property still goes to GS", () => {
    const css = ".custom-glow{box-shadow:0 0 10px blue}";
    const custom = new Set(["custom-glow"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".custom-glow");
  });

  it("custom class inside @media bypasses property check → GS", () => {
    const css = "@media(min-width:768px){.custom-bg{background:red}}";
    const custom = new Set(["custom-bg"]);
    const result = splitCss(css, custom);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".custom-bg");
    assert.ok(result.globalStyles[0].css.includes("@media"));
  });

  // ── Fallback: unclassified properties ──────────────────────

  it("unclassified property → UC (safe fallback)", () => {
    const css = ".snap-start{scroll-margin-top:1rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("snap-start"));
  });

  // ── Compound and functional pseudo-class selectors ─────────

  it("compound class selector → UC", () => {
    const css = ".foo.bar{display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
  });

  it("functional pseudo-class → UC", () => {
    const css = ".foo:nth-child(2){display:flex}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
  });

  // ── @font-face and @supports handling ──────────────────────

  it("@font-face → UC", () => {
    const css = "@font-face{font-family:Test;src:url(test.woff)}.text-lg{font-size:1.125rem}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.ok(result.uniqueCss.includes("@font-face"));
    assert.ok(result.uniqueCss.includes("font-family:Test"));
  });

  it("@supports → UC with children preserved", () => {
    const css = "@supports(display:grid){.grid{display:grid}}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
    assert.ok(result.uniqueCss.includes("@supports"));
    assert.ok(result.uniqueCss.includes(".grid"));
  });

  // ── Empty rules ────────────────────────────────────────────

  it("empty rule → UC (no GS clutter)", () => {
    const css = ".empty{}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 0);
  });

  // ── Edge cases ─────────────────────────────────────────────

  it("empty input → empty results", () => {
    const result = splitCss("");
    assert.strictEqual(result.globalStyles.length, 0);
    assert.strictEqual(result.uniqueCss, "");
  });

  it("malformed CSS → returns empty globalStyles, original as uniqueCss", () => {
    const result = splitCss("not valid css {{{");
    assert.strictEqual(result.globalStyles.length, 0);
  });

  it("deduplicates entries with the same selector", () => {
    const css = ".my-class{display:flex}.my-class{width:100%}";
    const result = splitCss(css);
    assert.strictEqual(result.globalStyles.length, 1);
    assert.strictEqual(result.globalStyles[0].selector, ".my-class");
    assert.ok(result.globalStyles[0].css.includes("display:flex"));
    assert.ok(result.globalStyles[0].css.includes("width:100%"));
  });

  it("generates Title Case names from class names", () => {
    const css = ".pt-32{padding-top:8rem}.md\\:text-7xl{font-size:4.5rem}";
    const result = splitCss(css);
    const names = result.globalStyles.map((s) => s.name);
    assert.ok(names.some((n) => n.includes("Pt") && n.includes("32")), "should name pt-32");
    assert.ok(names.some((n) => n.includes("Md") && n.includes("7xl")), "should name md:7xl");
  });
});
