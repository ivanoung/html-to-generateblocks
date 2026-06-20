import { describe, it, before } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const PROJECT_ROOT = resolve(process.cwd());
const STYLES_CSS = resolve(PROJECT_ROOT, "output/mino/styles.css");
const MANUAL_STEPS = resolve(PROJECT_ROOT, "output/mino/manual-steps.md");

// Custom color classes that must appear in compiled CSS (fixed by expandColorPalettes DEFAULT key)
const REQUIRED_CLASSES = [
  ".text-orange",
  ".text-surface",
  ".bg-surface",
  ".text-primary",
  ".bg-primary",
  ".text-seafoam",
  ".bg-seafoam",
  ".text-magenta",
  ".bg-magenta",
  ".text-fog",
  ".bg-secondary",
  ".bg-background",
  ".text-slate",
  ".bg-slate",
];

// Body-level classes that must appear (fixed by proxy div injection)
const BODY_CLASSES = [
  "selection\\:bg-primary",
  "selection\\:text-surface",
  "font-sans",
  "antialiased",
];

const INPUT_EXISTS = existsSync(resolve(PROJECT_ROOT, "inputs/mino/index.html"));

describe("Pixel Parity Verification", { skip: !INPUT_EXISTS }, () => {
  before(() => {
    execSync("npx tsx src/cli/index.ts convert inputs/mino/", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 120_000,
    });
  });

  it("styles.css exists and is non-empty after conversion", () => {
    assert.ok(existsSync(STYLES_CSS), "styles.css should exist");
    const css = readFileSync(STYLES_CSS, "utf-8");
    assert.ok(css.length > 1000, "styles.css should contain substantial CSS");
  });

  it("all custom color classes appear in compiled CSS", () => {
    const css = readFileSync(STYLES_CSS, "utf-8");
    const missing: string[] = [];
    for (const cls of REQUIRED_CLASSES) {
      // Check class appears as a selector (may have space before {)
      const re = new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{");
      if (!re.test(css)) {
        missing.push(cls);
      }
    }
    assert.deepStrictEqual(missing, [], `Missing custom color classes: ${missing.join(", ")}`);
  });

  it("body-level classes appear in compiled CSS (proxy injection)", () => {
    const css = readFileSync(STYLES_CSS, "utf-8");
    const missing: string[] = [];
    for (const cls of BODY_CLASSES) {
      if (!css.includes(cls)) {
        missing.push(cls);
      }
    }
    assert.deepStrictEqual(missing, [], `Missing body-level classes: ${missing.join(", ")}`);
  });

  it("body element selector rules are preserved in styles.css", () => {
    const css = readFileSync(STYLES_CSS, "utf-8");
    assert.ok(css.includes("body{"), "body rule should be preserved as element selector");
    assert.ok(css.includes("background-color: #EEEEEE"), "body background-color should be preserved");
    assert.ok(css.includes("color: #334155"), "body text color should be preserved");
  });

  it("manual-steps.md includes global document style inventory", () => {
    assert.ok(existsSync(MANUAL_STEPS), "manual-steps.md should exist");
    const md = readFileSync(MANUAL_STEPS, "utf-8");
    assert.ok(md.includes("Global Document Styles"), "should have global document styles section");
    assert.ok(md.includes("bg-background"), "should mention bg-background fallback");
  });

  it("all 10 mino pages convert without hard fails", () => {
    const pagesDir = resolve(PROJECT_ROOT, "output/mino/pages");
    const reports = [
      "ai-integrations", "bespoke-systems", "blog-wordpress", "blog",
      "care-plans", "case-featured", "case-studies", "contact",
      "fast-seo", "index",
    ];
    for (const name of reports) {
      const report = JSON.parse(readFileSync(resolve(pagesDir, `${name}.report.json`), "utf-8"));
      assert.strictEqual(
        report.overallStatus, "pass",
        `${name} should pass, got ${report.overallStatus}. Hard fails: ${JSON.stringify(report.hardFails)}`,
      );
    }
  });
});
