// ── Manifest Types ─────────────────────────────────────────────
//
// Type definitions for the section manifest produced during
// Phase 3 classification. Used by manifest-validator.ts,
// html-to-ir.ts, and role-mapper.ts.

export const SECTION_KINDS = [
  "hero", "card-grid", "stats-row", "testimonial-grid",
  "data-rows", "checklist", "feature-grid", "contact-form",
  "logo-marquee", "text-block", "generic",
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

export const ELEMENT_ROLES = [
  "section-label", "heading", "eyebrow", "body",
  "cta-button", "cta-link", "image", "icon", "iconify",
  "avatar", "avatar-stack", "star-rating", "social-proof",
  "card", "card-heading", "card-body", "card-footer", "card-step-label",
  "checklist-item",
  "testimonial", "testimonial-quote", "testimonial-name",
  "testimonial-title", "testimonial-company",
  "form-field", "form-radio-group", "form-textarea", "form-submit",
  "embed", "decoration",
] as const;

export type ElementRole = (typeof ELEMENT_ROLES)[number];

export const GROUP_ROLES = [
  "cta-row", "checklist", "card-grid", "feature-card-grid",
  "testimonial-grid", "social-proof-group", "avatar-row", "star-row",
] as const;

export type GroupRole = (typeof GROUP_ROLES)[number];

export interface ManifestElement {
  selector: string;
  role: ElementRole;
  action?: "strip"; // only valid for role: "decoration"
}

export interface ManifestGroup {
  selector: string;
  role: GroupRole;
  elements: ManifestElement[];
}

export interface ManifestTemplate {
  selector: string;
  role: ElementRole;
  elements: ManifestElement[];
  repeat: "siblings";
}

export interface ManifestNotes {
  decorationEls: string[];
  unsupportedFeatures: string[];
  warnings: string[];
}

export interface SectionManifest {
  sectionId: string;
  kind: SectionKind;
  layout: "single-column" | "two-column" | "grid" | "flex-row" | "form";
  elements: ManifestElement[];
  groups?: ManifestGroup[];
  templates?: ManifestTemplate[];
  exceptions?: ManifestElement[];
  notes: ManifestNotes;
  coverage: number; // 0-100
}

export interface PageManifest {
  page: string;
  sections: SectionManifest[];
  pageMeta: {
    title: string;
    fontFamilies: string[];
    description: string;
  };
}

export interface SectionSnippet {
  sectionId: string;
  html: string;
  elementCount: number;
  isDecorative: boolean;
}

export interface PageMeta {
  title: string;
  fontFamilies: string[];
  description: string;
}
