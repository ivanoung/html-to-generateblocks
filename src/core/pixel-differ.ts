// ── Pixel Differ ───────────────────────────────────────────────
//
// Compares two screenshots pixel-by-pixel with configurable intensity
// threshold. Produces a diff overlay image and mismatch statistics.

import sharp from "sharp";

export interface DiffResult {
  mismatchPct: number;
  mismatchPixels: number;
  totalPixels: number;
  threshold: number;
  band: "pass" | "minor" | "significant";
  totalWidth: number;
  totalHeight: number;
}

export interface CompareOptions {
  threshold?: number; // 0–1, default 0.1 (10% intensity difference → match)
  passBand?: number;  // default 1 (%)
  minorBand?: number; // default 5 (%)
}

/**
 * Compare two PNG images pixel-by-pixel.
 *
 * - Resizes both to the wider width
 * - Pads the shorter image with white pixels at the bottom
 * - Compares each pixel's RGB channels against the threshold
 * - Produces a diff overlay image (mismatched pixels in red)
 */
export async function compareImages(
  imageAPath: string,
  imageBPath: string,
  diffOutputPath: string,
  options: CompareOptions = {},
): Promise<DiffResult> {
  const threshold = options.threshold ?? 0.1;
  const passBand = options.passBand ?? 1;
  const minorBand = options.minorBand ?? 5;

  // Load images
  const [imgA, imgB] = await Promise.all([
    sharp(imageAPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(imageBPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  let { width: wA, height: hA } = imgA.info;
  let { width: wB, height: hB } = imgB.info;

  const targetWidth = Math.max(wA, wB);
  const targetHeight = Math.max(hA, hB);

  // Resize to same width if needed
  const buffers = await Promise.all([
    wA !== targetWidth
      ? sharp(imageAPath).resize(targetWidth, hA, { fit: "fill" }).ensureAlpha().raw().toBuffer()
      : Promise.resolve(imgA.data),
    wB !== targetWidth
      ? sharp(imageBPath).resize(targetWidth, hB, { fit: "fill" }).ensureAlpha().raw().toBuffer()
      : Promise.resolve(imgB.data),
  ]);

  // Pad to same height with white pixels
  const rowBytes = targetWidth * 4; // RGBA
  const paddedA = hA < targetHeight ? padBuffer(buffers[0], hA, targetHeight, rowBytes) : buffers[0];
  const paddedB = hB < targetHeight ? padBuffer(buffers[1], hB, targetHeight, rowBytes) : buffers[1];

  // Build diff overlay
  const diffBuffer = Buffer.alloc(targetWidth * targetHeight * 4);
  let mismatchPixels = 0;
  const totalPixels = targetWidth * targetHeight;

  const thresholdAbs = threshold * 255; // Convert 0–1 threshold to 0–255 scale

  for (let i = 0; i < paddedA.length; i += 4) {
    const rA = paddedA[i], gA = paddedA[i + 1], bA = paddedA[i + 2];
    const rB = paddedB[i], gB = paddedB[i + 1], bB = paddedB[i + 2];

    const dr = Math.abs(rA - rB);
    const dg = Math.abs(gA - gB);
    const db = Math.abs(bA - bB);

    const isMatch = dr <= thresholdAbs && dg <= thresholdAbs && db <= thresholdAbs;

    if (isMatch) {
      // Matching pixel: show original dimmed
      diffBuffer[i] = Math.round(rA * 0.5);
      diffBuffer[i + 1] = Math.round(gA * 0.5);
      diffBuffer[i + 2] = Math.round(bA * 0.5);
      diffBuffer[i + 3] = 255;
    } else {
      // Mismatching pixel: show in red
      diffBuffer[i] = 255;
      diffBuffer[i + 1] = 0;
      diffBuffer[i + 2] = 0;
      diffBuffer[i + 3] = 255;
      mismatchPixels++;
    }
  }

  // Write diff image
  await sharp(diffBuffer, {
    raw: { width: targetWidth, height: targetHeight, channels: 4 },
  }).png().toFile(diffOutputPath);

  const mismatchPct = (mismatchPixels / totalPixels) * 100;
  let band: DiffResult["band"];
  if (mismatchPct < passBand) band = "pass";
  else if (mismatchPct < minorBand) band = "minor";
  else band = "significant";

  return {
    mismatchPct: Math.round(mismatchPct * 100) / 100,
    mismatchPixels,
    totalPixels,
    threshold,
    band,
    totalWidth: targetWidth,
    totalHeight: targetHeight,
  };
}

function padBuffer(buf: Buffer, currentHeight: number, targetHeight: number, rowBytes: number): Buffer {
  const padded = Buffer.alloc(rowBytes * targetHeight, 255); // white RGBA
  buf.copy(padded, 0, 0, rowBytes * currentHeight);
  return padded;
}
