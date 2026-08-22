import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GateVerdict } from "../heal/gate.js";
import type { HealthReport } from "../health/types.js";

/**
 * Every decision the supervisor makes is appended here, never edited. The
 * dashboard reads it, and it is the audit trail for "why did this collector
 * change?" — the question that is impossible to answer with a manual heal.
 */
export type LedgerEvent =
  | { kind: "run"; at: string; contractId: string; collectorId: string; rowCount: number; durationMs: number }
  | { kind: "health"; at: string; contractId: string; report: HealthReport }
  | { kind: "heal_proposed"; at: string; contractId: string; collectorId: string; prompt: string; targetedFields: string[] }
  | { kind: "heal_gated"; at: string; contractId: string; collectorId: string; verdict: GateVerdict }
  | { kind: "heal_settled"; at: string; contractId: string; collectorId: string; decision: "approve" | "reject"; ok: boolean; detail: string }
  | { kind: "verified"; at: string; contractId: string; collectorId: string; report: HealthReport }
  | { kind: "escalated"; at: string; contractId: string; collectorId: string; reason: string };

export class Ledger {
  constructor(private readonly path: string) {}

  async append(event: LedgerEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }

  async read(): Promise<LedgerEvent[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as LedgerEvent);
  }

  /** Row count of the most recent healthy run, used as the shape baseline. */
  async baselineRowCount(contractId: string): Promise<number | null> {
    const events = await this.read();
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]!;
      if (event.kind === "health" && event.contractId === contractId && event.report.status === "healthy") {
        return event.report.rowCount;
      }
    }
    return null;
  }
}
