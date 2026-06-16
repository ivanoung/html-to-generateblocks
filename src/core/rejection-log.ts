export interface RejectionEntry {
  selector: string;
  reason: string;
  property?: string;
  detail?: string;
  severity: "expected" | "warning" | "error";
  destination: "styles-unique.css";
}

export interface RejectionJson {
  version: string;
  totalRules: number;
  rejectedRules: number;
  rejectionRate: string;
  rejections: RejectionEntry[];
  summaryByReason: Record<string, number>;
}

export class RejectionLog {
  private entries: RejectionEntry[] = [];

  get count(): number {
    return this.entries.length;
  }

  add(
    selector: string,
    reason: string,
    property?: string,
    severity: RejectionEntry["severity"] = "expected",
    destination: "styles-unique.css" = "styles-unique.css",
    detail?: string,
  ): void {
    this.entries.push({ selector, reason, property, severity, destination, detail });
  }

  toJSON(totalRules: number): string {
    const summaryByReason: Record<string, number> = {};
    for (const e of this.entries) {
      summaryByReason[e.reason] = (summaryByReason[e.reason] || 0) + 1;
    }

    const rate = totalRules > 0
      ? ((this.entries.length / totalRules) * 100).toFixed(1) + "%"
      : "0%";

    const json: RejectionJson = {
      version: "1.0",
      totalRules,
      rejectedRules: this.entries.length,
      rejectionRate: rate,
      rejections: this.entries,
      summaryByReason,
    };

    return JSON.stringify(json, null, 2) + "\n";
  }
}
