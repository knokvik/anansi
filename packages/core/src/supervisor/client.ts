import type { Row } from "../health/evaluate.js";

/** Outcome of a `bdata scraper heal` that has paused at the approval gate. */
export interface HealEnvelope {
  status: string;
  /** Sample rows the heal proposes to produce, when the envelope carries them. */
  previewRows: Row[] | null;
  /** True when the job is parked waiting for approve/reject. */
  awaitingApproval: boolean;
  raw: unknown;
}

export interface ApproveResult {
  ok: boolean;
  detail: string;
  raw: unknown;
}

/**
 * The three Scraper Studio operations the supervisor needs.
 *
 * Kept as an interface so the control loop can be exercised in tests against a
 * fake, and so the transport (CLI today, `POST /dca/trigger` tomorrow) can change
 * without touching the decision logic.
 */
export interface ScraperClient {
  run(collectorId: string, urls: string[]): Promise<Row[]>;
  heal(collectorId: string, prompt: string, verifyUrl?: string): Promise<HealEnvelope>;
  approve(collectorId: string, decision: "approve" | "reject"): Promise<ApproveResult>;
}
