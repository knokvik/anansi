import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApproveResult, HealEnvelope, Row, ScraperClient } from "@anansi/core";

/**
 * Replays recorded Bright Data responses instead of calling the network.
 *
 * This exists so anyone can clone the repository and watch the full detect →
 * heal → verify cycle without a Bright Data account or a single credit spent.
 * Fixtures are captured from real runs by `scripts/capture-fixtures.mjs`; the
 * seeds committed here are replaced by real captures once a collector exists.
 *
 * Layout, per contract id:
 *   fixtures/<contract-id>/run.1.json      first run (the broken one)
 *   fixtures/<contract-id>/run.2.json      verification run after the heal
 *   fixtures/<contract-id>/heal.json       the approval-gate envelope
 */
export class FixtureClient implements ScraperClient {
  private runIndex = 0;

  constructor(
    private readonly dir: string,
    private readonly log: (message: string) => void = () => {},
  ) {}

  private async load(name: string): Promise<unknown> {
    const path = join(this.dir, name);
    this.log(`replaying ${path}`);
    return JSON.parse(await readFile(path, "utf8"));
  }

  async run(collectorId: string): Promise<Row[]> {
    this.runIndex += 1;
    const rows = (await this.load(`run.${this.runIndex}.json`)) as Row[];
    this.log(`replayed run ${this.runIndex} for ${collectorId}: ${rows.length} rows`);
    return rows;
  }

  async heal(): Promise<HealEnvelope> {
    const raw = (await this.load("heal.json")) as {
      status?: string;
      preview_rows?: Row[];
    };
    return {
      status: raw.status ?? "awaiting_approval",
      previewRows: raw.preview_rows ?? null,
      awaitingApproval: true,
      raw,
    };
  }

  async approve(_collectorId: string, decision: "approve" | "reject"): Promise<ApproveResult> {
    return { ok: true, detail: `replayed ${decision}`, raw: { status: decision } };
  }
}
