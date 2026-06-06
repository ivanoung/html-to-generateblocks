// ── Manual Steps Reporter ──────────────────────────────
//
// Analyzes the source HTML and generates a checklist of
// manual steps needed after conversion. Written as a
// human-readable report alongside other output files.

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
      if (f.startsWith("family=")) {
        fonts.push(decodeURIComponent(f.replace("family=", "")));
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

export function generateManualStepsReport(steps: ManualSteps): string {
  const lines: string[] = [
    "============================================",
    "  MANUAL STEPS — Post-Conversion Checklist",
    "============================================",
    "",
  ];

  // Fonts
  if (steps.fonts.length > 0) {
    lines.push("1. ENQUEUE GOOGLE FONTS");
    for (const f of steps.fonts) {
      lines.push(`   - ${f}`);
    }
    lines.push("   Use a fonts plugin or add to functions.php.");
    lines.push("");
  }

  // Navigation & Footer
  if (steps.hasNav) {
    lines.push("2. REBUILD NAVIGATION");
    lines.push("   <nav> was stripped during conversion. Rebuild it");
    lines.push("   manually in the block editor.");
    lines.push("");
  }
  if (steps.hasFooter) {
    lines.push("3. REBUILD FOOTER");
    lines.push("   <footer> was stripped during conversion. Rebuild it");
    lines.push("   manually in the block editor.");
    lines.push("");
  }

  // Blocks
  const next = steps.hasNav ? (steps.hasFooter ? 4 : 3) : (steps.hasFooter ? 3 : 2);
  lines.push(`${next}. PASTE BLOCKS`);
  lines.push("   Open the WordPress Code Editor (Ctrl+Shift+Alt+M).");
  lines.push("   Copy the ENTIRE contents of index.html and paste.");
  lines.push("   Save the post, reload the editor, confirm no");
  lines.push("   \"Attempt Recovery\" prompt.");
  lines.push("");

  // CSS
  lines.push(`${next + 1}. ADD STYLES.CSS`);
  lines.push("   Paste styles.css into Appearance → Customize →");
  lines.push("   Additional CSS.");
  lines.push("");

  // Customizer
  lines.push(`${next + 2}. IMPORT CUSTOMIZER SETTINGS`);
  lines.push("   Import customizer-import.json via Appearance →");
  lines.push("   Customize → Import/Export (or a plugin like");
  lines.push("   \"Customizer Export/Import\").");
  lines.push("");

  // Iconify
  if (steps.hasIconify) {
    lines.push(`${next + 3}. ICONIFY ICONS`);
    lines.push("   The original uses <iconify-icon> web components.");
    lines.push("   Option A: Enqueue the Iconify script:");
    steps.externalScripts.filter((s) => s.includes("iconify")).forEach((s) => {
      lines.push(`     ${s}`);
    });
    lines.push("   Option B: Replace icons with GenerateBlocks");
    lines.push("   Shape blocks + SVGs manually.");
    lines.push("");
  }

  // Images
  if (steps.externalImages.length > 0) {
    const stepNum = steps.hasIconify ? next + 4 : next + 3;
    lines.push(`${stepNum}. REPLACE EXTERNAL IMAGES (${steps.externalImages.length} total)`);
    steps.externalImages.slice(0, 5).forEach((url) => {
      lines.push(`   - ${url.substring(0, 70)}${url.length > 70 ? "..." : ""}`);
    });
    if (steps.externalImages.length > 5) {
      lines.push(`   ... and ${steps.externalImages.length - 5} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
