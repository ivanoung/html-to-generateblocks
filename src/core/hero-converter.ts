// ── Hero Converter ─────────────────────────────────────────────
//
// Converts an IRNode tree (hero section) into GB blocks.
// Three modes: pattern, generic, rejected.
//
// Pipeline: IR input → score → determine mode → map → blocks → report

import type { IRNode } from "./ir-node.js";
import type { Block, HardFail } from "./types.js";
import type { HeroScore, HeroConverterOptions } from "./hero-scorer.js";
export type { HeroConverterOptions } from "./hero-scorer.js";
import { scoreHeroPattern, DEFAULT_OPTIONS } from "./hero-scorer.js";
export { DEFAULT_OPTIONS } from "./hero-scorer.js";
import { resetIds } from "./id-generator.js";
import { planBlocks } from "./ir-planner.js";
import { serializeBlocks, countBlocks } from "./serializer.js";
import { validateBlocks } from "./validator.js";

export type HeroMode = "pattern" | "generic" | "rejected";

export interface HeroReport {
  fixture: string;
  mode: HeroMode;
  patternId: string | null;
  patternScore: number;
  blockCount: number;
  hardFails: string[];
  simplifications: string[];
  unsupportedFeatures: string[];
}

export interface HeroResult {
  html: string;
  report: HeroReport;
}

/**
 * Convert a hero IR tree to GB blocks.
 */
export function convertHero(
  fixtureName: string,
  root: IRNode,
  options: HeroConverterOptions = DEFAULT_OPTIONS,
): HeroResult {
  resetIds();

  // 1. Score the hero pattern
  const heroScore = scoreHeroPattern(root);

  // 2. Check for rejection
  const rejectReasons = checkRejection(root);
  if (rejectReasons.length > 0) {
    return makeRejected(fixtureName, rejectReasons);
  }

  // 3. Determine mode
  let mode: HeroMode;
  if (options.mode === "generic-only") {
    mode = "generic";
  } else if (options.mode === "pattern-only") {
    mode = "pattern";
  } else if (heroScore.score >= options.minPatternScore) {
    mode = "pattern";
  } else {
    mode = "generic";
  }

  // 4. Map based on mode
  const simplifications: string[] = [];

  let blocks: Block[];
  if (mode === "pattern") {
    blocks = mapPatternHero(root, heroScore, simplifications);
  } else {
    blocks = mapGenericHero(root, simplifications);
  }

  // 5. Serialize and validate
  const html = blocks.length > 0 ? serializeBlocks(blocks) : "";
  const blockCount = countBlocks(blocks);

  const { hardFails: validatorFails } = blocks.length > 0
    ? validateBlocks(blocks, html)
    : { hardFails: [] };

  const allHardFails = [
    ...validatorFails.map((f) => f.code),
  ];

  const report: HeroReport = {
    fixture: fixtureName,
    mode,
    patternId: mode === "pattern" ? "hero-composite-v1" : null,
    patternScore: heroScore.score,
    blockCount,
    hardFails: allHardFails,
    simplifications,
    unsupportedFeatures: [],
  };

  return { html, report };
}

// ── Rejection ─────────────────────────────────────────────────

function checkRejection(root: IRNode): string[] {
  const reasons: string[] = [];
  // Check for pro-required content
  if (containsNodeType(root, "carousel") || containsAttr(root, "data-tabs")) {
    reasons.push("PRO_REQUIRED_TABS");
  }
  // Check for unsafe nesting depth
  if (maxDepth(root) > 12) {
    reasons.push("TOO_MANY_BLOCKS");
  }
  return reasons;
}

// ── Pattern hero mapping ──────────────────────────────────────

function mapPatternHero(
  root: IRNode,
  score: HeroScore,
  simplifications: string[],
): Block[] {
  // The pattern mapper passes through the existing IR planner.
  // The IR tree is already structured as a hero-composite,
  // so we just plan it through the standard pipeline.
  const { blocks, errors } = planBlocks(root);
  simplifications.push(...errors.filter(e => e.startsWith("DEFERRED") || e.startsWith("UNKNOWN")));
  return blocks;
}

// ── Generic hero mapping ──────────────────────────────────────

function mapGenericHero(
  root: IRNode,
  simplifications: string[],
): Block[] {
  // Generic mode: wrap the section in default outer/inner if needed,
  // then plan through standard pipeline with simplifications recorded.
  const { blocks, errors } = planBlocks(root);
  simplifications.push(...errors.filter(e => e.startsWith("DEFERRED") || e.startsWith("UNKNOWN")));
  return blocks;
}

// ── Rejection result ──────────────────────────────────────────

function makeRejected(fixtureName: string, reasons: string[]): HeroResult {
  return {
    html: "",
    report: {
      fixture: fixtureName,
      mode: "rejected",
      patternId: null,
      patternScore: 0,
      blockCount: 0,
      hardFails: reasons,
      simplifications: [],
      unsupportedFeatures: reasons,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────

function containsNodeType(root: IRNode, type: string): boolean {
  if (root.nodeType === type) return true;
  return root.children.some(c => containsNodeType(c, type));
}

function containsAttr(root: IRNode, attr: string): boolean {
  if (root.attributes && Object.keys(root.attributes).some(k => k.startsWith(attr))) return true;
  return root.children.some(c => containsAttr(c, attr));
}

function maxDepth(root: IRNode, depth = 1): number {
  if (root.children.length === 0) return depth;
  return Math.max(...root.children.map(c => maxDepth(c, depth + 1)));
}
