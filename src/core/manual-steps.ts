// ── Manual Steps Reporter ──────────────────────────────
//
// Analyzes the source HTML and generates a checklist of
// manual steps needed after conversion. Written as a
// human-readable report alongside other output files.

import type { GlobalSelectorInventory } from "./global-selector-inventory.js";

export interface ManualSteps {
  fonts: string[];
  externalScripts: string[];
  hasNav: boolean;
  hasFooter: boolean;
  hasIconify: boolean;
  imageCount: number;
  externalImages: string[];
}

export function analyzeSource(html: string): ManualSteps {
  const fonts: string[] = [];
  const fontMatch = html.match(/fonts\.googleapis\.com\/css2\?family=([^"'\s]+)/);
  if (fontMatch) {
    fontMatch[1].split("&").forEach((f) => {
      // The first entry is the value of ?family=, subsequent entries have family= prefix
      const name = f.startsWith("family=") ? f.replace("family=", "") : f;
      if (name && !name.startsWith("display=") && !name.startsWith("subset=")) {
        fonts.push(decodeURIComponent(name));
      }
    });
  }

  const externalScripts: string[] = [];
  const scriptMatches = html.matchAll(/<script[^>]*src="([^"]+)"/g);
  for (const m of scriptMatches) {
    const url = m[1];
    if (!url.includes("tailwindcss")) {
      externalScripts.push(url);
    }
  }

  const hasNav = /<nav[\s>]/.test(html);
  const hasFooter = /<footer[\s>]/.test(html);
  const hasIconify = /iconify-icon/.test(html);

  const imageMatches = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)];
  const externalImages = imageMatches.map((m) => m[1]).filter((url) => url.startsWith("http"));
  const imageCount = imageMatches.length;

  return {
    fonts,
    externalScripts,
    hasNav,
    hasFooter,
    hasIconify,
    imageCount,
    externalImages,
  };
}

export function generateManualStepsReport(steps: ManualSteps, inventory?: GlobalSelectorInventory): string {
  const autoFixable: string[] = [];
  const judgment: string[] = [];
  const pureManual: string[] = [];

  const header = [
    "============================================",
    "  MANUAL STEPS — Post-Conversion Checklist",
    "============================================",
    "",
    "Categories:",
    "  [AUTO]     — Can be automated in future updates",
    "  [JUDGMENT] — Requires human decision",
    "  [MANUAL]   — Must be done by hand",
    "",
  ];

  // ── AUTO-FIXABLE ────────────────────────────────────

  // 1. JavaScript
  autoFixable.push(
    "1. ADD JAVASCRIPT",
    "   Add setup/global.js to your site via WPCode plugin",
    "   or enqueue in functions.php. This preserves all",
    "   interactions, animations, and scripts.",
    "",
  );

  // 2. Global Styles
  autoFixable.push(
    "2. IMPORT GLOBAL STYLES",
    "   Import setup/global-styles.json into GenerateBlocks →",
    "   Global Styles. Structured entries (non-raw) are",
    "   fully editable through the GB Styles UI.",
    "",
  );

  // 3. CSS
  autoFixable.push(
    "3. ADD REMAINING CSS",
    "   Paste setup/styles-unique.css into Appearance →",
    "   Customize → Additional CSS for non-class styles",
    "   (keyframes, media queries, pseudo-elements).",
    "   Tip: styles.css at project root is the complete",
    "   master fallback if global-styles isn't enough.",
    "",
  );

  // 4. Customizer
  autoFixable.push(
    "4. IMPORT CUSTOMIZER SETTINGS",
    "   Import setup/customizer-import.json via Appearance →",
    "   Customize → Import/Export (or a plugin like",
    "   \"Customizer Export/Import\").",
    "",
  );

  // ── JUDGMENT-REQUIRED ────────────────────────────────

  // Fonts
  if (steps.fonts.length > 0) {
    judgment.push(
      "5. ENQUEUE GOOGLE FONTS",
      "   The following fonts were detected. Choose a method:",
    );
    for (const f of steps.fonts) {
      judgment.push(`     - ${f}`);
    }
    judgment.push(
      "   Option A: Use a fonts plugin (e.g., Fonts Plugin |",
      "             Google Fonts Typography).",
      "   Option B: Add to functions.php with wp_enqueue_style.",
      "   Option C: Use GeneratePress Typography module.",
      "",
    );
  }

  // Navigation
  if (steps.hasNav) {
    judgment.push(
      `${steps.fonts.length > 0 ? 6 : 5}. NAVIGATION PRESENT`,
      "   The source has a <nav> element. It's been converted",
      "   as part of each page. If you want reusable navigation:",
      "   Option A: Keep as-is (each page has its own nav).",
      "   Option B: Create a reusable block from one page's nav",
      "             and replace nav in other pages.",
      "",
    );
  }

  // ── Global Selector Rules Inventory ──────────────────
  if (inventory && inventory.rules.length > 0) {
    let inventoryNum = 5;
    if (steps.fonts.length > 0) inventoryNum = 6;
    autoFixable.push(
      `${inventoryNum}. GLOBAL DOCUMENT STYLES`,
      "   The following CSS rules target <html>, <body>, :root,",
      "   or pseudo-elements like ::selection. These are preserved",
      "   in styles.css but only apply when enqueued globally.",
    );
    for (const rule of inventory.rules) {
      autoFixable.push(`   - ${rule.selector}`);
    }
    if (inventory.hasBackgroundColor) {
      autoFixable.push(
        "   ⚠ The source body has a background-color. If your theme",
        '     overrides body styles, add class="bg-background" to',
        "     the outermost GB container block.",
      );
    }
    autoFixable.push("");
  }

  // ── PURE MANUAL ───────────────────────────────────────

  const manualBase = steps.fonts.length > 0
    ? (steps.hasNav ? 7 : 6)
    : (steps.hasNav ? 6 : 5);

  // Paste blocks
  pureManual.push(
    `${manualBase}. PASTE BLOCKS PER PAGE`,
    "   Open the WordPress Code Editor (Ctrl+Shift+Alt+M).",
    "   For each page in setup/pages/, copy the entire",
    "   contents and paste into the corresponding WP page.",
    "   Save, reload, confirm no \"Attempt Recovery\" prompt.",
    "",
  );

  // Iconify
  if (steps.hasIconify) {
    pureManual.push(
      `${manualBase + 1}. ICONIFY ICONS`,
      "   The original uses <iconify-icon> web components.",
      "   They've been auto-resolved to inline SVGs where",
      "   possible. Any unresolved icons need manual handling:",
    );
    const iconifyScripts = steps.externalScripts.filter((s) => s.includes("iconify"));
    if (iconifyScripts.length > 0) {
      pureManual.push("   Option A: Enqueue the Iconify script:");
      iconifyScripts.forEach((s) => pureManual.push(`     ${s}`));
    }
    pureManual.push(
      "   Option B: Replace icons with GenerateBlocks",
      "             Shape blocks + SVGs manually.",
      "",
    );
  }

  // Images
  if (steps.externalImages.length > 0) {
    const imgNum = steps.hasIconify ? manualBase + 2 : manualBase + 1;
    pureManual.push(
      `${imgNum}. REPLACE EXTERNAL IMAGES (${steps.externalImages.length} total)`,
    );
    steps.externalImages.slice(0, 5).forEach((url) => {
      pureManual.push(`   - ${url.substring(0, 70)}${url.length > 70 ? "..." : ""}`);
    });
    if (steps.externalImages.length > 5) {
      pureManual.push(`   ... and ${steps.externalImages.length - 5} more`);
    }
    pureManual.push("");
  }

  // ── Assemble report ───────────────────────────────────

  const lines: string[] = [...header];

  if (autoFixable.length > 0) {
    lines.push("─── AUTO-FIXABLE ───", "");
    lines.push(...autoFixable);
  }

  if (judgment.length > 0) {
    lines.push("─── JUDGMENT REQUIRED ───", "");
    lines.push(...judgment);
  }

  if (pureManual.length > 0) {
    lines.push("─── PURE MANUAL ───", "");
    lines.push(...pureManual);
  }

  return lines.join("\n");
}
