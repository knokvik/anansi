export { Contract, FieldContract, ShapeExpectations } from "./contract/schema.js";
export { ContractError, loadContract, loadContracts } from "./contract/load.js";
export { evaluateRun, type EvaluateOptions, type Row } from "./health/evaluate.js";
export type { FieldHealth, FieldVerdict, HealthReport, RunStatus } from "./health/types.js";
export { synthesizeHealPlan, HEAL_PROMPT_LIMIT, type HealPlan } from "./heal/prompt.js";
export { judgeHeal, type GateDecision, type GateInput, type GateVerdict } from "./heal/gate.js";
export { Ledger, type LedgerEvent } from "./ledger/ledger.js";
export type { ApproveResult, HealEnvelope, ScraperClient } from "./supervisor/client.js";
export {
  superviseContract,
  type Resolution,
  type SuperviseDeps,
  type SupervisionOutcome,
} from "./supervisor/supervise.js";

export { bootstrapContract, type BootstrapInput } from "./contract/bootstrap.js";
export { detectNovelty, type FieldDelta, type NoveltyReport, type RowChange, type RowChangeKind } from "./health/novelty.js";
export { Snapshots } from "./ledger/snapshots.js";
export {
  adjustTtl,
  defaultTtlSeconds,
  inferFreshnessClass,
  type FreshnessAdjustment,
} from "./knowledge/freshness.js";
export { isFresh, shouldBeStanding } from "./knowledge/gate.js";
export { planEscalation, type EscalationPlan } from "./knowledge/escalate.js";
export { planTopicKey } from "./knowledge/planner.js";
export { KnowledgeStore } from "./knowledge/store.js";
export type { FreshnessClass, KnowledgeEntry, ScrapeTier } from "./knowledge/types.js";
export {
  resolveQuery,
  type AnswerResult,
  type AnswerStatus,
  type ResolveDeps,
  type ResolveOptions,
} from "./knowledge/resolve.js";
