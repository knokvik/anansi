import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import { Snapshots } from "../src/ledger/snapshots.js";
import { KnowledgeStore } from "../src/knowledge/store.js";
import { resolveQuery, type ResolveDeps } from "../src/knowledge/resolve.js";
import type { Row } from "../src/health/evaluate.js";
import type { ApproveResult, HealEnvelope, ScraperClient } from "../src/supervisor/client.js";

class FakeClient implements ScraperClient {
  calls: string[] = [];
  healResult: Row[] | null = null;

  constructor(private readonly runQueue: Row[][]) {}

  async run(): Promise<Row[]> {
    this.calls.push("run");
    return this.runQueue.shift() ?? [];
  }

  async heal(): Promise<HealEnvelope> {
    this.calls.push("heal");
    return { status: "awaiting_approval", previewRows: this.healResult, awaitingApproval: true, raw: {} };
  }

  async approve(_id: string, decision: "approve" | "reject"): Promise<ApproveResult> {
    this.calls.push(`approve:${decision}`);
    return { ok: true, detail: decision, raw: {} };
  }
}

const bootstrapRows: Row[] = [
  { model_name: "Nimbus Titan", input_price_usd_per_mtok: 15, context_window_tokens: 200000 },
  { model_name: "Nimbus Vale", input_price_usd_per_mtok: 3, context_window_tokens: 200000 },
];

let dir: string;
let deps: Omit<ResolveDeps, "client">;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "anansi-radar-"));
  deps = {
    store: new KnowledgeStore(join(dir, "knowledge")),
    snapshots: new Snapshots(join(dir, "snapshots")),
    ledger: new Ledger(join(dir, "ledger.jsonl")),
    contractsDir: join(dir, "contracts"),
  };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveQuery", () => {
  it("bootstraps a brand-new topic from its first successful run", async () => {
    const client = new FakeClient([bootstrapRows]);
    const result = await resolveQuery(
      "nimbus pricing",
      { url: "https://example.com", collectorId: "c_abc" },
      { client, ...deps },
    );
    expect(result.status).toBe("bootstrapped");
    expect(result.entry.rows).toHaveLength(2);
    expect(client.calls).toEqual(["run"]);
  });

  it("throws when a new topic is asked without a url and collectorId", async () => {
    const client = new FakeClient([bootstrapRows]);
    await expect(resolveQuery("unknown topic", {}, { client, ...deps })).rejects.toThrow(/new topic/);
  });

  it("leaves no contract file behind when the bootstrap probe itself comes back broken", async () => {
    // A real shape captured from a genuinely broken collector: the payload
    // parser's "unwrap a length-1 wrapper" fallback finds no usable nested
    // list and falls back to the wrapper object itself as one degenerate row.
    const brokenProbe: Row[] = [
      { models: [], product_page_url: "https://example.com", input: { url: "https://example.com" } },
    ];
    const client = new FakeClient([brokenProbe]);
    await expect(
      resolveQuery("broken topic", { url: "https://example.com", collectorId: "c_abc" }, { client, ...deps }),
    ).rejects.toThrow(/came back broken/);

    let files: string[] = [];
    try {
      files = await readdir(deps.contractsDir);
    } catch {
      // contractsDir never created at all is an equally valid pass
    }
    expect(files).toHaveLength(0);
  });

  it("serves a repeat ask from cache without touching the network", async () => {
    const client = new FakeClient([bootstrapRows]);
    await resolveQuery("nimbus pricing", { url: "https://example.com", collectorId: "c_abc" }, { client, ...deps });
    const second = await resolveQuery("nimbus pricing", {}, { client, ...deps });
    expect(second.status).toBe("cache_hit");
    expect(client.calls).toEqual(["run"]);
  });

  it("refreshes a stale topic by reusing its bootstrapped contract, and reports what changed", async () => {
    const changedRows: Row[] = [
      { model_name: "Nimbus Titan", input_price_usd_per_mtok: 12, context_window_tokens: 200000 },
      { model_name: "Nimbus Vale", input_price_usd_per_mtok: 3, context_window_tokens: 200000 },
    ];
    const client = new FakeClient([bootstrapRows, changedRows]);
    let clock = new Date("2026-08-23T00:00:00Z");
    const now = () => clock;

    await resolveQuery("nimbus pricing", { url: "https://example.com", collectorId: "c_abc" }, { client, ...deps, now });
    clock = new Date(clock.getTime() + 100 * 24 * 3600 * 1000);

    const result = await resolveQuery("nimbus pricing", {}, { client, ...deps, now });
    expect(result.status).toBe("refreshed");
    expect(result.novelty?.changedCount).toBe(1);
    expect(result.novelty?.changes[0]?.deltas).toContainEqual({
      field: "input_price_usd_per_mtok",
      from: 15,
      to: 12,
    });
    expect(client.calls).toEqual(["run", "run"]);
  });

  it("keeps the old cached entry when a refresh comes back broken, instead of overwriting it with junk", async () => {
    const brokenRows: Row[] = [
      { model_name: "Nimbus Titan", input_price_usd_per_mtok: null, context_window_tokens: 200000 },
      { model_name: "Nimbus Vale", input_price_usd_per_mtok: null, context_window_tokens: 200000 },
    ];
    const client = new FakeClient([bootstrapRows, brokenRows]);
    client.healResult = brokenRows;
    let clock = new Date("2026-08-23T00:00:00Z");
    const now = () => clock;

    const first = await resolveQuery(
      "nimbus pricing",
      { url: "https://example.com", collectorId: "c_abc" },
      { client, ...deps, now },
    );
    clock = new Date(clock.getTime() + 100 * 24 * 3600 * 1000);

    const result = await resolveQuery("nimbus pricing", {}, { client, ...deps, now });
    expect(result.status).toBe("refresh_failed");
    expect(result.entry).toEqual(first.entry);
    expect(client.calls).toContain("heal");
    expect(client.calls).toContain("approve:reject");
  });
});
