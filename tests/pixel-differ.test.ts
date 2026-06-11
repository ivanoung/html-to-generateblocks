import { describe, it } from "node:test";
import assert from "node:assert";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { compareImages } from "../src/core/pixel-differ.js";

const TMP_DIR = resolve(process.cwd(), "fixtures/verify/tmp");
mkdirSync(TMP_DIR, { recursive: true });

async function createSolidPng(path: string, width: number, height: number, r: number, g: number, b: number) {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  }).png().toBuffer();
  writeFileSync(path, buf);
}

describe("compareImages", () => {
  it("returns 0% mismatch for identical images", async () => {
    const a = resolve(TMP_DIR, "identical-a.png");
    const b = resolve(TMP_DIR, "identical-b.png");
    const diff = resolve(TMP_DIR, "identical-diff.png");
    await createSolidPng(a, 100, 100, 255, 0, 0);
    await createSolidPng(b, 100, 100, 255, 0, 0);
    const result = await compareImages(a, b, diff);
    assert.strictEqual(result.mismatchPct, 0);
    assert.strictEqual(result.band, "pass");
  });

  it("returns 100% mismatch for completely different images", async () => {
    const a = resolve(TMP_DIR, "diff-a.png");
    const b = resolve(TMP_DIR, "diff-b.png");
    const diff = resolve(TMP_DIR, "diff-diff.png");
    await createSolidPng(a, 100, 100, 255, 0, 0);
    await createSolidPng(b, 100, 100, 0, 0, 255);
    const result = await compareImages(a, b, diff);
    assert.ok(result.mismatchPct > 90, `expected >90%, got ${result.mismatchPct}`);
    assert.strictEqual(result.band, "significant");
  });

  it("pads shorter image to match height", async () => {
    const a = resolve(TMP_DIR, "tall-a.png");
    const b = resolve(TMP_DIR, "short-b.png");
    const diff = resolve(TMP_DIR, "height-diff.png");
    await createSolidPng(a, 100, 200, 255, 255, 255);
    await createSolidPng(b, 100, 100, 255, 255, 255);
    const result = await compareImages(a, b, diff);
    // Same white content, just different heights — white padding matches
    assert.strictEqual(result.mismatchPct, 0);
  });

  it("resizes to wider width", async () => {
    const a = resolve(TMP_DIR, "wide-a.png");
    const b = resolve(TMP_DIR, "narrow-b.png");
    const diff = resolve(TMP_DIR, "width-diff.png");
    await createSolidPng(a, 200, 100, 128, 128, 128);
    await createSolidPng(b, 100, 100, 128, 128, 128);
    const result = await compareImages(a, b, diff);
    assert.strictEqual(result.totalWidth, 200, "should resize to wider width");
  });

  it("respects intensity threshold", async () => {
    const a = resolve(TMP_DIR, "threshold-a.png");
    const b = resolve(TMP_DIR, "threshold-b.png");
    const diff = resolve(TMP_DIR, "threshold-diff.png");
    // a = rgb(100,100,100), b = rgb(105,105,105) — 5/255 ≈ 2% difference
    await createSolidPng(a, 100, 100, 100, 100, 100);
    await createSolidPng(b, 100, 100, 105, 105, 105);
    const result = await compareImages(a, b, diff, { threshold: 0.1 });
    // Difference is ~2% per channel, threshold is 10% → should match
    assert.strictEqual(result.mismatchPct, 0, "small intensity diff should be below threshold");
  });
});
