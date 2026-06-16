// ── Global Selector Inventory ──────────────────────────────
//
// Scans the custom CSS for document-level selectors (html, body,
// :root, ::selection) that target elements outside the GB blocks.
// These rules are preserved as-is in the output CSS but need to
// be flagged because they won't apply when viewing blocks in
// isolation — they rely on the WordPress document structure.
//
// Returns categorized rules for inclusion in manual-steps.md.

export interface GlobalSelectorRule {
  selector: string;        // e.g. "body", "html", ":root"
  css: string;             // full rule text including declarations
  category: "element" | "pseudo-element" | "custom-property";
}

export interface GlobalSelectorInventory {
  rules: GlobalSelectorRule[];
  hasBackgroundColor: boolean;
  hasTextColor: boolean;
  hasOverflowX: boolean;
}

/**
 * Extract document-level CSS rules from custom CSS string.
 * Matches: html, body, :root, ::selection, ::backdrop, ::placeholder.
 * Does NOT parse the CSS AST — uses simple regex to be fast
 * and avoid needing a full CSS parser for this narrow task.
 */
export function inventoryGlobalSelectors(customCss: string): GlobalSelectorInventory {
  const rules: GlobalSelectorRule[] = [];
  let hasBackgroundColor = false;
  let hasTextColor = false;
  let hasOverflowX = false;

  // Match rules starting with document-level selectors
  // Pattern: selector { ... } where selector is one of the globals
  const selectorPatterns: { pattern: RegExp; category: GlobalSelectorRule["category"] }[] = [
    { pattern: /(?<![.\w-])(html|body)\s*\{[^}]*\}/g, category: "element" },
    { pattern: /:root\s*\{[^}]*\}/g, category: "custom-property" },
    { pattern: /::(?:selection|backdrop|placeholder)\s*\{[^}]*\}/g, category: "pseudo-element" },
  ];

  for (const { pattern, category } of selectorPatterns) {
    let match;
    while ((match = pattern.exec(customCss)) !== null) {
      const css = match[0];
      const selector = css.substring(0, css.indexOf("{")).trim();
      rules.push({ selector, css, category });

      // Track common properties for manual-steps flags
      if (selector === "body") {
        if (/background-color\s*:/.test(css)) hasBackgroundColor = true;
        if (/color\s*:/.test(css)) hasTextColor = true;
        if (/overflow-x\s*:/.test(css)) hasOverflowX = true;
      }
    }
  }

  return { rules, hasBackgroundColor, hasTextColor, hasOverflowX };
}
