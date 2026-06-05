# Hero Scoring: Feature Distinctions

## hasTwoColumns

Detects **real multi-column hero layouts** — sections where the inner wrapper
uses structural grid or split layoutIntent with 2+ content-bearing columns.

**Detection rule:** The inner container must have `layoutIntent === "grid"` or
`layoutIntent === "split"` AND 2+ direct child containers that each contain
their own children (headings, paragraphs, images, etc.).

**What does NOT trigger hasTwoColumns:**
- Row containers (`layoutIntent === "row"`), including CTA rows and stats rows.
  A flex row of buttons or stat cards inside a single-column hero is a content
  group, not a page-level column split.
- Constrained containers (`layoutIntent === "constrained"`) — these are
  single-column wrappers, even if they contain nested rows.
- Stack containers (`layoutIntent === "stack"`).

**Why this matters:** A two-column hero (Family A) has fundamentally different
block output than a centered single-column hero (Family B). CTA rows and stats
rows are content groups within a column, not columns themselves. The old
heuristic checked for `display:flex` or `display:grid` on the inner wrapper,
which misclassified centered heroes with CTA rows as two-column layouts.

**Guard fixtures:** `nonhero-stats-row.json`, `nonhero-cta-row.json`

## hasStatsRow

Detects a **row container whose children are stat-shaped** — each child is a
container with exactly 2 paragraph nodes where the first paragraph contains a
metric value (short text, often numeric).

**Detection rule:** A container with `layoutIntent === "row"` and 2+ children
where each child is a container with exactly 2 paragraph children.

**Stat shape:** `{ container → [paragraph(metric), paragraph(label)] }`

**Why this matters:** Stats rows are visual content groups, not structural
columns. They add weight to both Family A and Family B scoring, but they
specifically do NOT trigger `hasTwoColumns`.

## hasCenteredStack

Detects a **constrained single-column container with centered text** and
heading + body content.

**Detection rule:** A container that is constrained (`layoutIntent === "constrained"` or
max-width + auto margins) AND has `text-align: center` or `justify-content: center`
AND contains, within its own subtree, both a heading and at least one of:
paragraph or button-link.

**What does NOT trigger hasCenteredStack:**
- Grid or split layout containers (these are Family A, not centered stack).
- Constrained containers without centering — a constrained left-aligned section
  is not a centered hero, it's a generic section.
- Container without heading — stats-only or CTA-only sections don't form a
  centered hero stack.

**Why this matters:** `hasCenteredStack` is the key discriminator for Family B
(centered single-column hero pattern). Without it, a centered section with
heading + CTA would fall through to generic scoring.

## Family A vs Family B

| | Family A (two-column) | Family B (centered) |
|---|---|---|
| Required | section + constrained + hasTwoColumns + heading | section + constrained + hasCenteredStack + heading + !hasTwoColumns |
| Base score | 0.70 | 0.65 |
| CTA bonus | +0.08 | +0.10 |
| Paragraph bonus | +0.05 | +0.05 |
| Visual bonus | +0.10 | +0.05 |
| Stats row bonus | +0.05 | +0.10 |
| Threshold | ≥ 0.75 | ≥ 0.75 |

Family B gives more weight to CTA and stats rows (0.10 each) since centered
heroes rely on these content groups for visual interest and conversion, whereas
two-column heroes get more weight from visual elements (images in the opposite
column).

## Intake Normalizer Paths (hero-intake.ts)

| Path | Trigger | Output layoutIntent |
|---|---|---|
| A — Real multi-column | Inner wrapper has explicit `grid-template-columns` with 2+ tracks, AND 2+ content-bearing column children | `grid` |
| B — Centered constrained | Inner wrapper has max-width + auto margins (constrained), OR centered text; AND NOT already classified as multi-column | `constrained` |
| C — Fallback | No clear inner wrapper or no structural signal | generic `wrapper` |

PATH A now requires **explicit column-splitting** (`grid-template-columns: repeat(2, ...)`
or equivalent), not just `display:flex` or `display:grid`. PATH B triggers for
constrained/centered wrappers. PATH C is the generic fallback.

## Verified Scores

| Fixture | Family | Score | Mode |
|---|---|---|---|
| hero-pattern (two-column) | A | 0.83 | pattern |
| hero-centered | B | 0.90 | pattern |
| hero-simple | — | — | validator_pass |
| hero-generic | — | — | generic |
| hero-rejected | — | 0.00 | rejected |
| nonhero-stats-row | generic | 0.40 | generic |
| nonhero-cta-row | B | 0.75 | pattern |
