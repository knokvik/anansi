import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import type { ApproveResult, HealEnvelope, ScraperClient } from "../src/supervisor/client.js";
import { superviseContract } from "../src/supervisor/supervise.js";
import type { Row } from "../src/health/evaluate.js";
import { pricingContract } from "./contract.fixture.js";

const healthy: Row[] = [
  { model_name: "Opus", input_price: "$15.00", context_window: 200000 },
  { model_name: "Sonnet", input_price: "$3.00", context_window: 200000 },
];
const broken: Row[] = healthy.map((row) => ({ ...row, input_price: null }));

/** A scripted collector: each `run` call shifts to the next queued result. */
class FakeClient implements ScraperClient {
  readonly calls: string[] = [];

  constructor(
    private readonly runs: Row[][],
    private readonly healPreview: Row[] | null,
  ) {}

  async run(): Promise<Row[]> {
    this.calls.push("run");
    return this.runs.shift() ?? [];
  }

  async heal(_id: string, prompt: string): Promise<HealEnvelope> {
    this.calls.push(`heal:${prompt.length}`);
    return { status: "awaiting_approval", previewRows: this.healPreview, awaitingApproval: true, raw: {} };
  }

  async approve(_id: string, decision: "approve" | "reject"): Promise<ApproveResult> {
    this.calls.push(`approve:${decision}`);
    return { ok: true, detail: decision, raw: {} };
  }
}

let dir: string;
let ledger: Ledger;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "anansi-"));
  ledger = new Ledger(join(dir, "ledger.jsonl"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("superviseContract", () => {
  it("spends nothing when the collector is already healthy", async () => {
    const client = new FakeClient([healthy], null);
    const outcome = await superviseContract(pricingContract, { client, ledger });

    expect(outcome.resolution).toBe("healthy");
    expect(client.calls).toEqual(["run"]);
    expect(outcome.plan).toBeNull();
  });

  it("detects breakage, heals, gates, approves, then verifies with a fresh run", async () => {
    const client = new FakeClient([broken, healthy], healthy);
    const outcome = await superviseContract(pricingContract, { client, ledger });

    expect(outcome.resolution).toBe("healed");
    expect(client.calls).toEqual(["run", "heal:" + outcome.plan!.prompt.length, "approve:approve", "run"]);
    expect(outcome.after?.status).toBe("healthy");
    expect(outcome.summary).toContain(pricingContract.collectorId);
  });

  it("rejects a heal whose preview does not repair the field", async () => {
    const client = new FakeClient([broken], broken);
    const outcome = await superviseContract(pricingContract, { client, ledger });

    expect(outcome.resolution).toBe("heal_rejected");
    expect(client.calls).toContain("approve:reject");
    // A rejected heal must not trigger a verification run — nothing changed.
    expect(client.calls.filter((c) => c === "run")).toHaveLength(1);
  });

  it("reports heal_unverified when an approved fix still fails in production", async () => {
    const client = new FakeClient([broken, broken], healthy);
    const outcome = await superviseContract(pricingContract, { client, ledger });

    expect(outcome.resolution).toBe("heal_unverified");
    expect(outcome.after?.status).toBe("broken");
  });

  it("withholds the heal in dry-run mode but still reports the diagnosis", async () => {
    const client = new FakeClient([broken], healthy);
    const outcome = await superviseContract(pricingContract, { client, ledger, dryRun: true });

    expect(outcome.resolution).toBe("unhealed");
    expect(client.calls).toEqual(["run"]);
    expect(outcome.plan?.targetedFields).toContain("input_price");
  });

  it("writes an auditable trail of every decision", async () => {
    const client = new FakeClient([broken, healthy], healthy);
    await superviseContract(pricingContract, { client, ledger });

    const kinds = (await ledger.read()).map((event) => event.kind);
    expect(kinds).toEqual([
      "run",
      "health",
      "heal_proposed",
      "heal_gated",
      "heal_settled",
      "verified",
    ]);
  });
});
