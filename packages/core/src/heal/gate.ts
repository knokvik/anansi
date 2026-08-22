import type { Contract } from "../contract/schema.js";
import { evaluateRun, type Row } from "../health/evaluate.js";
import type { HealthReport } from "../health/types.js";

export type GateDecision = "approve" | "reject";

export interface GateVerdict {
  decision: GateDecision;
  reason: string;
  /** Health of the preview rows the heal proposed, when it returned any. */
  previewReport: HealthReport | null;
}

export interface GateInput {
  contract: Contract;
  /** Health of the run that triggered the heal. */
  before: HealthReport;
  /** Sample rows attached to the heal's approval envelope, if present. */
  previewRows: Row[] | null;
  /** Fields the heal prompt set out to repair. */
  targetedFields: string[];
}

/**
 * Decide whether a proposed heal is allowed to land.
 *
 * Scraper Studio pauses a heal at `awaiting_approval`, and the tempting shortcut
 * is `--auto-approve`. That trades one silent failure for another: a heal that
 * confidently extracts the wrong thing gets saved and nothing downstream notices.
 * This gate re-scores the proposed output against the same contract that
 * detected the breakage, and rejects fixes that do not actually fix it.
 */
export function judgeHeal(input: GateInput): GateVerdict {
  const { contract, before, previewRows, targetedFields } = input;

  if (previewRows === null) {
    return {
      decision: "reject",
      reason:
        "The heal returned no preview rows, so there is no evidence it repaired anything. " +
        "Rejecting rather than saving an unverified template.",
      previewReport: null,
    };
  }

  const after = evaluateRun(contract, previewRows, {
    baselineRowCount: before.baselineRowCount,
  });

  const stillBroken = targetedFields.filter((name) => {
    const health = after.fields.find((f) => f.field === name);
    return !health || health.verdict === "missing" || health.verdict === "broken";
  });

  if (stillBroken.length > 0) {
    return {
      decision: "reject",
      reason: `Heal did not repair: ${stillBroken.join(", ")}. Preview score ${after.score} vs ${before.score} before.`,
      previewReport: after,
    };
  }

  const regressed = before.fields
    .filter((f) => f.verdict === "healthy")
    .filter((f) => {
      const now = after.fields.find((candidate) => candidate.field === f.field);
      return !now || now.verdict === "missing" || now.verdict === "broken";
    })
    .map((f) => f.field);

  if (regressed.length > 0) {
    return {
      decision: "reject",
      reason: `Heal repaired its targets but broke previously healthy field(s): ${regressed.join(", ")}.`,
      previewReport: after,
    };
  }

  if (after.score <= before.score) {
    return {
      decision: "reject",
      reason: `Heal did not improve the contract score (${before.score} → ${after.score}).`,
      previewReport: after,
    };
  }

  return {
    decision: "approve",
    reason: `Contract score improved ${before.score} → ${after.score}; repaired ${targetedFields.join(", ")} with no regressions.`,
    previewReport: after,
  };
}
