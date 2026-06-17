// ── Manual Steps Reporter ──────────────────────────────
//
// Generates a post-conversion checklist organized by category.
// Steps auto-number based on registration order and conditions.

import type { GlobalSelectorInventory } from "./global-selector-inventory.js";

// ── Types ──────────────────────────────────────────────

export interface ManualStepsContext {
  fonts: string[];
  externalImages: string[];
  hasNav: boolean;
  hasIconify: boolean;
  inventory?: GlobalSelectorInventory;
  customizerExists: boolean;
  appJsExists: boolean;
}

interface Step {
  id: string;
  category: "import" | "enqueue" | "per-page";
  condition?: (ctx: ManualStepsContext) => boolean;
  render: (ctx: ManualStepsContext) => string[];
}

// ── Source Analysis ────────────────────────────────────

export function analyzeSource(html: string): {
  fonts: string[];
  externalImages: string[];
  hasNav: boolean;
  hasIconify: boolean;
} {
  const fonts: string[] = [];
  const fontMatch = html.match(/fonts\.googleapis\.com\/css2\?family=([^"'\s]+)/);
  if (fontMatch) {
    fontMatch[1].split("&").forEach((f) => {
      const name = f.startsWith("family=") ? f.replace("family=", "") : f;
      if (name && !name.startsWith("display=") && !name.startsWith("subset=")) {
        fonts.push(decodeURIComponent(name));
      }
    });
  }

  const imageMatches = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)];
  const externalImages = imageMatches.map((m) => m[1]).filter((url) => url.startsWith("http"));

  const hasNav = /<nav[\s>]/.test(html);
  const hasIconify = /iconify-icon/.test(html);

  return { fonts, externalImages, hasNav, hasIconify };
}

// ── Step Registry ──────────────────────────────────────

const CATEGORY_LABELS: Record<Step["category"], string> = {
  "import":    "IMPORT — One-Time Setup",
  "enqueue":   "ENQUEUE — Site-Wide",
  "per-page":  "PER PAGE — For Each Page",
};

const STEPS: Step[] = [
  // ── IMPORT ────────────────────────────────────────
  {
    id: "import-global-styles",
    category: "import",
    render: () => [
      "Import setup/global-styles-import.json into",
      "GenerateBlocks → Global Styles. This imports all",
      "editable utility classes with --tw-* variables",
      "resolved to concrete CSS values.",
    ],
  },
  {
    id: "import-css-utilities",
    category: "import",
    render: () => [
      "Add setup/tailwind-utilities.css via WPCodeBox.",
      "This loads all Tailwind utility classes (mt-4,",
      "flex, text-slate-700, hover:opacity-80, etc.)",
      "that the block markup references via class=\"...\".",
      "Load this BEFORE styles-unique.css if ordering matters.",
    ],
  },
  {
    id: "import-css-unique",
    category: "import",
    render: () => [
      "Add setup/styles-unique.css via WPCodeBox (NOT",
      "Additional CSS — WordPress strips * selectors,",
      "escaped colons, and some pseudo-elements).",
      "This covers non-utility CSS: @keyframes,",
      "@media blocks, transforms, filters, gradients,",
      "and raw declarations from design components.",
    ],
  },
  {
    id: "import-js",
    category: "import",
    condition: (ctx) => ctx.appJsExists,
    render: () => [
      "Add setup/global.js via WPCodeBox to preserve",
      "all interactions, animations, and scripts.",
    ],
  },
  {
    id: "import-customizer",
    category: "import",
    condition: (ctx) => ctx.customizerExists,
    render: () => [
      "Import customizer-import.json into Appearance →",
      "Customize → Import/Export (or use a plugin like",
      '"Customizer Export/Import"). This sets up theme',
      "colors, fonts, container width, and backgrounds",
      "matching the source design.",
    ],
  },

  // ── ENQUEUE ───────────────────────────────────────
  {
    id: "enqueue-nav",
    category: "enqueue",
    condition: (ctx) => ctx.hasNav,
    render: () => [
      "The source has a <nav> element. It's been converted",
      "as part of each page. If you want reusable navigation:",
      "Option A: Keep as-is (each page has its own nav).",
      "Option B: Create a reusable block from one page's nav",
      "          and replace nav in other pages.",
    ],
  },
  {
    id: "enqueue-fonts",
    category: "enqueue",
    condition: (ctx) => ctx.fonts.length > 0,
    render: (ctx) => [
      "The following Google Fonts were detected:",
      ...ctx.fonts.map((f) => `  - ${f}`),
      "Option A: Use a fonts plugin (Fonts Plugin |",
      "          Google Fonts Typography).",
      "Option B: Add to functions.php with wp_enqueue_style.",
      "Option C: Use GeneratePress Typography module.",
    ],
  },
  {
    id: "enqueue-global-css",
    category: "enqueue",
    condition: (ctx) => !!(ctx.inventory && ctx.inventory.rules.length > 0),
    render: (ctx) => {
      const inv = ctx.inventory!;
      const lines: string[] = [
        "The following CSS rules target <html>, <body>,",
        ":root, or pseudo-elements. They are preserved in",
        "styles.css but only apply when enqueued globally:",
      ];
      for (const rule of inv.rules) {
        lines.push(`  - ${rule.selector}`);
      }
      if (inv.hasBackgroundColor) {
        lines.push(
          "",
          '⚠ The source page body has a background-color.',
          '  If your theme overrides body styles, add',
          '  class="bg-background" to the outermost GB',
          "  container block.",
        );
      }
      return lines;
    },
  },

  // ── PER PAGE ──────────────────────────────────────
  {
    id: "per-page-blocks",
    category: "per-page",
    render: () => [
      "Open the WordPress Code Editor (Ctrl+Shift+Alt+M).",
      "For each page in pages/, copy the entire contents",
      "and paste into the corresponding WP page.",
      "Save, reload, confirm no \"Attempt Recovery\" prompt.",
    ],
  },
  {
    id: "per-page-images",
    category: "per-page",
    condition: (ctx) => ctx.externalImages.length > 0,
    render: (ctx) => {
      const lines: string[] = [
        `Replace ${ctx.externalImages.length} external image(s):`,
      ];
      ctx.externalImages.slice(0, 5).forEach((url) => {
        lines.push(`  - ${url.substring(0, 70)}${url.length > 70 ? "..." : ""}`);
      });
      if (ctx.externalImages.length > 5) {
        lines.push(`  ... and ${ctx.externalImages.length - 5} more`);
      }
      return lines;
    },
  },
];

// ── Report Generator ──────────────────────────────────

export function generateManualStepsReport(ctx: ManualStepsContext): string {
  const header = [
    "============================================",
    "  MANUAL STEPS — Post-Conversion Checklist",
    "============================================",
    "",
    "Files referenced below are in the output/",
    "directory alongside this document.",
    "",
  ];

  const lines: string[] = [...header];

  // Group active steps by category
  const activeByCategory = new Map<Step["category"], { step: Step; ctx: ManualStepsContext; num: number }[]>();

  let n = 0;
  for (const step of STEPS) {
    if (step.condition && !step.condition(ctx)) continue;
    n++;
    const cat = step.category;
    if (!activeByCategory.has(cat)) activeByCategory.set(cat, []);
    activeByCategory.get(cat)!.push({ step, ctx, num: n });
  }

  // Render by category
  for (const cat of ["import", "enqueue", "per-page"] as const) {
    const entries = activeByCategory.get(cat);
    if (!entries || entries.length === 0) continue;

    const range = entries.length === 1
      ? `${entries[0].num}`
      : `${entries[0].num}-${entries[entries.length - 1].num}`;

    lines.push(`=== ${CATEGORY_LABELS[cat]} (${range}) ===`, "");

    for (const { step, ctx: stepCtx, num } of entries) {
      lines.push(`${num}. ${stepTitle(step.id)}`);
      for (const textLine of step.render(stepCtx)) {
        lines.push(`   ${textLine}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function stepTitle(id: string): string {
  const titles: Record<string, string> = {
    "import-global-styles": "Import Global Styles",
    "import-css-utilities": "Add Tailwind Utilities CSS",
    "import-css-unique":    "Add Remaining Unique CSS",
    "import-js":            "Add JavaScript",
    "import-customizer":    "Import Customizer Settings",
    "enqueue-fonts":        "Enqueue Google Fonts",
    "enqueue-nav":          "Navigation Present",
    "enqueue-global-css":   "Global Document Styles",
    "per-page-blocks":      "Paste Blocks Per Page",
    "per-page-images":      "Replace External Images",
  };
  return titles[id] || id;
}
