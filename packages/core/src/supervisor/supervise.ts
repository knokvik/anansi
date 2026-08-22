import type { Contract } from "../contract/schema.js";
import { judgeHeal, type GateVerdict } from "../heal/gate.js";
import { synthesizeHealPlan, type HealPlan } from "../heal/prompt.js";
import { evaluateRun } from "../health/evaluate.js";
import type { HealthReport } from "../health/types.js";
import type { Ledger } from "../ledger/ledger.js";
import type { ScraperClient } from "./client.js";

export type Resolution =
  /** The collector was already meeting its contract. Nothing was spent. */
  | "healthy"
  /** Broken, repaired, and the repair verified against a fresh run. */
  | "healed"
  /** Broken, a repair was proposed, and the gate refused it. */
  | "heal_rejected"
  /** Broken, the repair was approved, but the verification run still failed. */
  | "heal_unverified"
  /** Broken, and healing was not attempted (dry run, or disabled). */
  | "unhealed";

export interface SupervisionOutcome {
  contractId: string;
  collectorId: string;
  resolution: Resolution;
  before: HealthReport;
  after: HealthReport | null;
  plan: HealPlan | null;
  gate: GateVerdict | null;
  /** One line fit for a CI log or a Slack message. */
  summary: string;
}

export interface SuperviseDeps {
  client: ScraperClient;
  ledger: Ledger;
  /** Detect and report, but never spend credits on a heal. */
  dryRun?: boolean;
  log?: (message: string) => void;
}

const noop = () => {};

/**
 * Run one collector through the full detect → repair → verify cycle.
 *
 * Scraper Studio gives you the repair step. The loop around it — noticing that a
 * repair is needed, describing what broke, and refusing a repair that does not
 * hold up — is what turns a manual tool into something that can run at 3am.
 */
export async function superviseContract(
  contract: Contract,
  deps: SuperviseDeps,
): Promise<SupervisionOutcome> {
  const { client, ledger, dryRun = false } = deps;
  const log = deps.log ?? noop;

  const startedAt = Date.now();
  const rows = await client.run(contract.collectorId, contract.canaries);
  await ledger.append({
    kind: "run",
    at: new Date().toISOString(),
    contractId: contract.id,
    collectorId: contract.collectorId,
    rowCount: rows.length,
    durationMs: Date.now() - startedAt,
  });

  const baselineRowCount = await ledger.baselineRowCount(contract.id);
  const before = evaluateRun(contract, rows, { baselineRowCount });
  await ledger.append({ kind: "health", at: before.checkedAt, contractId: contract.id, report: before });

  const base = { contractId: contract.id, collectorId: contract.collectorId };
  log(`${contract.id}: ${before.status} (score ${before.score}, ${before.rowCount} rows)`);

  if (!before.healRecommended) {
    return {
      ...base,
      resolution: "healthy",
      before,
      after: null,
      plan: null,
      gate: null,
      summary: `${contract.id} is meeting its contract (score ${before.score}).`,
    };
  }

  const plan = synthesizeHealPlan(contract, before);

  if (dryRun) {
    await ledger.append({ kind: "escalated", at: new Date().toISOString(), ...base, reason: "dry run" });
    return {
      ...base,
      resolution: "unhealed",
      before,
      after: null,
      plan,
      gate: null,
      summary: `${contract.id} is ${before.status}; heal withheld (dry run). Would target: ${plan.targetedFields.join(", ")}.`,
    };
  }

  log(`${contract.id}: proposing heal for ${plan.targetedFields.join(", ")}`);
  await ledger.append({
    kind: "heal_proposed",
    at: new Date().toISOString(),
    ...base,
    prompt: plan.prompt,
    targetedFields: plan.targetedFields,
  });

  const envelope = await client.heal(contract.collectorId, plan.prompt, contract.canaries[0]);
  const gate = judgeHeal({
    contract,
    before,
    previewRows: envelope.previewRows,
    targetedFields: plan.targetedFields,
  });
  await ledger.append({ kind: "heal_gated", at: new Date().toISOString(), ...base, verdict: gate });
  log(`${contract.id}: gate says ${gate.decision} — ${gate.reason}`);

  const settled = await client.approve(contract.collectorId, gate.decision);
  await ledger.append({
    kind: "heal_settled",
    at: new Date().toISOString(),
    ...base,
    decision: gate.decision,
    ok: settled.ok,
    detail: settled.detail,
  });

  if (gate.decision === "reject") {
    await ledger.append({
      kind: "escalated",
      at: new Date().toISOString(),
      ...base,
      reason: gate.reason,
    });
    return {
      ...base,
      resolution: "heal_rejected",
      before,
      after: gate.previewReport,
      plan,
      gate,
      summary: `${contract.id}: proposed fix rejected at the gate. ${gate.reason}`,
    };
  }

  // Approving is not the same as working. Re-run the real collector and score it.
  const verifyRows = await client.run(contract.collectorId, contract.canaries);
  const after = evaluateRun(contract, verifyRows, { baselineRowCount });
  await ledger.append({ kind: "verified", at: after.checkedAt, ...base, report: after });

  if (after.healRecommended) {
    await ledger.append({
      kind: "escalated",
      at: new Date().toISOString(),
      ...base,
      reason: `Verification run still failing after an approved heal (score ${after.score}).`,
    });
    return {
      ...base,
      resolution: "heal_unverified",
      before,
      after,
      plan,
      gate,
      summary: `${contract.id}: heal approved but the verification run still fails (score ${before.score} → ${after.score}).`,
    };
  }

  return {
    ...base,
    resolution: "healed",
    before,
    after,
    plan,
    gate,
    summary: `${contract.id}: repaired and verified. Score ${before.score} → ${after.score}, same Collector ID ${contract.collectorId}.`,
  };
}
