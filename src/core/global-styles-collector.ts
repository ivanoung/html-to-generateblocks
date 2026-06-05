// ── Global Styles Collector ─────────────────────────────────
//
// Tracks reusable class definitions extracted from <head> <style>
// blocks. Classes used on 2+ elements are promoted to GB globalClasses
// references and included in the page-global-styles.json output.

import type { BlockStyles } from "./types.js";

export interface GlobalClassEntry {
  slug: string;
  name: string;
  styles: BlockStyles;
}

export interface GlobalStylesManifest {
  page: string;
  classes: GlobalClassEntry[];
}

export class GlobalStylesCollector {
  private classUsageCount = new Map<string, number>();
  private classDefinitions = new Map<string, BlockStyles>();
  private pageName: string;

  constructor(pageName: string) {
    this.pageName = pageName;
  }

  /**
   * Register a class definition from classNameToProperties.
   * Called once per class found in <head> <style>.
   */
  registerDefinition(className: string, styles: BlockStyles): void {
    this.classDefinitions.set(className, styles);
  }

  /**
   * Record usage of a class on an element.
   * Returns true if this class should be added to the block's globalClasses array
   * (i.e., it has been used on 2+ elements).
   */
  recordUsage(className: string): boolean {
    const count = (this.classUsageCount.get(className) || 0) + 1;
    this.classUsageCount.set(className, count);
    return count >= 2;
  }

  /**
   * Return the globalClasses array for a block, given its class names.
   * Only includes classes that have been used on 2+ elements.
   */
  getGlobalClassesForElement(classNames: string[]): string[] {
    return classNames.filter((c) => {
      const count = this.classUsageCount.get(c) || 0;
      return count >= 2 && this.classDefinitions.has(c);
    });
  }

  /**
   * Produce the global styles manifest for output.
   */
  toManifest(): GlobalStylesManifest {
    const classes: GlobalClassEntry[] = [];
    this.classDefinitions.forEach((styles, slug) => {
      const count = this.classUsageCount.get(slug) || 0;
      if (count >= 2) {
        classes.push({
          slug,
          name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          styles,
        });
      }
    });
    return { page: this.pageName, classes };
  }
}
