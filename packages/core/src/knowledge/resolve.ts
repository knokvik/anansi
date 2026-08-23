import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { bootstrapContract } from "../contract/bootstrap.js";
import { loadContract } from "../contract/load.js";
import type { Contract } from "../contract/schema.js";
import { judgeHeal } from "../heal/gate.js";
import { synthesizeHealPlan } from "../heal/prompt.js";
import { evaluateRun, type Row } from "../health/evaluate.js";
import { detectNovelty, type NoveltyReport } from "../health/novelty.js";
import type { HealthReport } from "../health/types.js";
import type { Ledger } from "../ledger/ledger.js";
import type { Snapshots } from "../ledger/snapshots.js";
import type { ScraperClient } from "../supervisor/client.js";
import { planEscalation, type EscalationPlan } from "./escalate.js";
import { adjustTtl, defaultTtlSeconds, inferFreshnessClass, type FreshnessAdjustment } from "./freshness.js";
import { isFresh, shouldBeStanding } from "./gate.js";
import { planTopicKey } from "./planner.js";
import type { KnowledgeStore } from "./store.js";
import type { KnowledgeEntry } from "./types.js";

export interface ResolveOptions {
  /** Required the first time this topic is ever asked. Ignored once a contract exists for it. */
  url?: string;
  /** The collector to bootstrap against. `resolveQuery` never creates one on demand — `bdata scraper create` runs out of band, ahead of the first ask. */
  collectorId?: string;
}

export interface ResolveDeps {
  client: ScraperClient;
  store: KnowledgeStore;
  snapshots: Snapshots;
  ledger: Ledger;
  contractsDir: string;
  now?: () => Date;
  log?: (message: string) => void;
}

export type AnswerStatus = "cache_hit" | "refreshed" | "bootstrapped" | "refresh_failed";

export interface AnswerResult {
  topicKey: string;
  query: string;
  status: AnswerStatus;
  entry: KnowledgeEntry;
  health: HealthReport;
  novelty: NoveltyReport | null;
  freshness: FreshnessAdjustment | null;
  escalation: EscalationPlan;
}

const noop = () => {};
const NO_ESCALATION: EscalationPlan = { missingFields: [], identities: [] };

/**
 * Answer a free-text ask.
 *
 * Serves from the Knowledge Store when the cached answer is still inside its
 * TTL, and only reaches for the network when it isn't. A stale or missing
 * topic runs through the same score -> heal -> gate -> verify machinery
 * `superviseContract` uses for the scheduled fleet — a query is just a
 * different trigger for the same engine, not a second one. A brand-new topic
 * bootstraps its own contract from its first successful run instead of
 * needing one hand-written ahead of time.
 */
export async function resolveQuery(
  query: string,
  options: ResolveOptions,
  deps: ResolveDeps,
): Promise<AnswerResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? noop;
  const topicKey = planTopicKey(query);

  const existing = await deps.store.read(topicKey);

  if (existing && isFresh(existing, now())) {
    log(`${topicKey}: cache hit, fresh for ${remainingSeconds(existing, now())}s more`);
    return {
      topicKey,
      query,
      status: "cache_hit",
      entry: existing,
      health: cachedHealth(existing),
      novelty: null,
      freshness: null,
      escalation: NO_ESCALATION,
    };
  }

  let contract: Contract;
  let rows: Row[];
  let bootstrapped = false;

  if (existing) {
    contract = await loadContract(join(deps.contractsDir, `${existing.contractId}.contract.yaml`));
    log(`${topicKey}: stale, refreshing via ${contract.collectorId}`);
    rows = await deps.client.run(contract.collectorId, contract.canaries);
  } else {
    if (!options.url || !options.collectorId) {
      throw new Error(
        `"${query}" is a new topic. Pass a url and a collectorId to bootstrap it — ` +
          `run \`bdata scraper create\` first; resolveQuery never creates a collector on demand.`,
      );
    }
    log(`${topicKey}: new topic, bootstrapping from ${options.url}`);
    const probeRows = await deps.client.run(options.collectorId, [options.url]);
    const bootstrap = bootstrapContract({
      topicKey,
      query,
      collectorId: options.collectorId,
      canaryUrl: options.url,
      rows: probeRows,
    });
    contract = bootstrap.contract;
    rows = bootstrap.rows;
    await writeContractFile(deps.contractsDir, contract);
    bootstrapped = true;
  }

  await deps.ledger.append({
    kind: "run",
    at: now().toISOString(),
    contractId: contract.id,
    collectorId: contract.collectorId,
    rowCount: rows.length,
    durationMs: 0,
  });

  const baselineRowCount = existing?.rows.length ?? null;
  let health = evaluateRun(contract, rows, { baselineRowCount, now });
  await deps.ledger.append({ kind: "health", at: health.checkedAt, contractId: contract.id, report: health });

  let finalRows = rows;

  // A freshly bootstrapped contract is derived from these exact rows, so it is
  // healthy by construction — the heal path only ever applies to a refresh.
  if (!bootstrapped && health.healRecommended) {
    const plan = synthesizeHealPlan(contract, health);
    await deps.ledger.append({
      kind: "heal_proposed",
      at: now().toISOString(),
      contractId: contract.id,
      collectorId: contract.collectorId,
      prompt: plan.prompt,
      targetedFields: plan.targetedFields,
    });

    const envelope = await deps.client.heal(contract.collectorId, plan.prompt, contract.canaries[0]);
    const verdict = judgeHeal({ contract, before: health, previewRows: envelope.previewRows, targetedFields: plan.targetedFields });
    await deps.ledger.append({
      kind: "heal_gated",
      at: now().toISOString(),
      contractId: contract.id,
      collectorId: contract.collectorId,
      verdict,
    });

    const settled = await deps.client.approve(contract.collectorId, verdict.decision);
    await deps.ledger.append({
      kind: "heal_settled",
      at: now().toISOString(),
      contractId: contract.id,
      collectorId: contract.collectorId,
      decision: verdict.decision,
      ok: settled.ok,
      detail: settled.detail,
    });

    if (verdict.decision === "approve") {
      finalRows = await deps.client.run(contract.collectorId, contract.canaries);
      health = evaluateRun(contract, finalRows, { baselineRowCount, now });
      await deps.ledger.append({ kind: "verified", at: health.checkedAt, contractId: contract.id, collectorId: contract.collectorId, report: health });
    } else {
      await deps.ledger.append({
        kind: "escalated",
        at: now().toISOString(),
        contractId: contract.id,
        collectorId: contract.collectorId,
        reason: verdict.reason,
      });
    }
  }

  if (health.status === "broken") {
    await deps.ledger.append({
      kind: "escalated",
      at: now().toISOString(),
      contractId: contract.id,
      collectorId: contract.collectorId,
      reason: `Query "${query}" could not be resolved: ${health.shapeSymptoms[0] ?? "required fields are missing"}.`,
    });

    if (existing) {
      return { topicKey, query, status: "refresh_failed", entry: existing, health, novelty: null, freshness: null, escalation: NO_ESCALATION };
    }
    throw new Error(`Could not bootstrap "${query}" — the first run itself came back broken (score ${health.score}).`);
  }

  const previousRows = existing ? existing.rows : await deps.snapshots.read(contract.id);
  const novelty = detectNovelty(contract, finalRows, previousRows);

  const freshnessClass = existing?.freshnessClass ?? inferFreshnessClass(contract);
  const currentTtl = existing?.ttlSeconds ?? defaultTtlSeconds(freshnessClass);
  const freshness = adjustTtl(freshnessClass, currentTtl, novelty);

  if (freshness.changed) {
    await deps.ledger.append({
      kind: "freshness_adjusted",
      at: now().toISOString(),
      contractId: contract.id,
      collectorId: contract.collectorId,
      fromTtlSeconds: currentTtl,
      toTtlSeconds: freshness.ttlSeconds,
      reason: freshness.reason,
    });
  }

  const escalation = planEscalation(contract, finalRows, novelty.identityField);
  const askCount = (existing?.askCount ?? 0) + 1;

  const entry: KnowledgeEntry = {
    topicKey,
    query: existing?.query ?? query,
    contractId: contract.id,
    collectorId: contract.collectorId,
    rows: finalRows,
    identityField: novelty.identityField,
    freshnessClass,
    ttlSeconds: freshness.ttlSeconds,
    lastConfirmedFresh: now().toISOString(),
    standing: shouldBeStanding(askCount),
    askCount,
    tier: "discovery",
    escalatedCount: 0,
    lastStatus: health.status,
    lastScore: health.score,
  };

  await deps.store.write(entry);
  await deps.snapshots.write(contract.id, finalRows);

  return { topicKey, query, status: bootstrapped ? "bootstrapped" : "refreshed", entry, health, novelty, freshness, escalation };
}

function remainingSeconds(entry: KnowledgeEntry, now: Date): number {
  const expiresAt = new Date(entry.lastConfirmedFresh).getTime() + entry.ttlSeconds * 1000;
  return Math.max(0, Math.round((expiresAt - now.getTime()) / 1000));
}

/** A cache hit doesn't re-run evaluateRun; report the status this entry was last actually scored at. */
function cachedHealth(entry: KnowledgeEntry): HealthReport {
  return {
    contractId: entry.contractId,
    collectorId: entry.collectorId,
    checkedAt: entry.lastConfirmedFresh,
    rowCount: entry.rows.length,
    baselineRowCount: entry.rows.length,
    status: entry.lastStatus,
    score: entry.lastScore,
    fields: [],
    shapeSymptoms: [],
    healRecommended: false,
  };
}

async function writeContractFile(dir: string, contract: Contract): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${contract.id}.contract.yaml`), stringify(contract), "utf8");
}
