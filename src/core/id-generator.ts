// ── Deterministic ID Generator ────────────────────────────────
//
// Generates auto-incrementing IDs per block type, reset per fixture run.
// elem001, text001, outer001, inner001, ...

interface Counters {
  elem: number;
  text: number;
  img: number;
  shape: number;
  core: number;
  outer: number;
  inner: number;
}

const counters: Counters = {
  elem: 0,
  text: 0,
  img: 0,
  shape: 0,
  core: 0,
  outer: 0,
  inner: 0,
};

const PREFIXES: Record<string, string> = {
  elem: "elem",
  text: "text",
  img: "img",
  shape: "shape",
  core: "core",
  outer: "outer",
  inner: "inner",
};

export function resetIds(): void {
  counters.elem = 0;
  counters.text = 0;
  counters.img = 0;
  counters.shape = 0;
  counters.core = 0;
  counters.outer = 0;
  counters.inner = 0;
}

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

export function currentCount(type: string): number {
  const counterKey = type as keyof Counters;
  return counters[counterKey];
}
