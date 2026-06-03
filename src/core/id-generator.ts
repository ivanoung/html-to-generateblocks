// ── Deterministic ID Generator ────────────────────────────────
//
// Generates auto-incrementing IDs per block type, reset per fixture run.
// elem001, elem002, ... text001, text002, ... img001, ... shape001, ...

interface Counters {
  elem: number;
  text: number;
  img: number;
  shape: number;
  core: number; // for core blocks
}

const counters: Counters = {
  elem: 0,
  text: 0,
  img: 0,
  shape: 0,
  core: 0,
};

/** Prefixes map for idGenType → string prefix */
const PREFIXES: Record<string, string> = {
  elem: "elem",
  text: "text",
  img: "img",
  shape: "shape",
  core: "core",
};

/** Reset all counters to zero. Call per fixture run. */
export function resetIds(): void {
  counters.elem = 0;
  counters.text = 0;
  counters.img = 0;
  counters.shape = 0;
  counters.core = 0;
}

/**
 * Generate the next ID for the given type.
 * Types: "elem", "text", "img", "shape", "core"
 * Returns padded string like "elem001", "text002", etc.
 */
export function nextId(type: string): string {
  const counterKey = type as keyof Counters;
  if (!(counterKey in counters)) {
    throw new Error(`Unknown ID generator type: "${type}"`);
  }
  counters[counterKey] += 1;
  const num = counters[counterKey];
  const prefix = PREFIXES[type] ?? type;
  return `${prefix}${String(num).padStart(3, "0")}`;
}

/**
 * Peek at current count without incrementing.
 */
export function currentCount(type: string): number {
  const counterKey = type as keyof Counters;
  return counters[counterKey];
}
