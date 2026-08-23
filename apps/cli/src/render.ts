import pc from "picocolors";
import type { AnswerResult, HealthReport, SupervisionOutcome } from "@anansi/core";

const STATUS_COLOR = {
  healthy: pc.green,
  degraded: pc.yellow,
  broken: pc.red,
} as const;

const RESOLUTION_LABEL: Record<SupervisionOutcome["resolution"], string> = {
  healthy: pc.green("HEALTHY"),
  healed: pc.green("HEALED"),
  heal_rejected: pc.yellow("HEAL REJECTED"),
  heal_unverified: pc.red("HEAL UNVERIFIED"),
  unhealed: pc.yellow("UNHEALED"),
};

function bar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  const color = score >= 0.8 ? pc.green : score >= 0.5 ? pc.yellow : pc.red;
  return color("█".repeat(filled)) + pc.dim("░".repeat(width - filled));
}

export function renderHealth(report: HealthReport): string {
  const lines: string[] = [];
  const status = STATUS_COLOR[report.status](report.status.toUpperCase());
  lines.push(
    `  ${status}  score ${bar(report.score)} ${report.score.toFixed(2)}  ${report.rowCount} rows`,
  );

  for (const field of report.fields) {
    const mark =
      field.verdict === "healthy"
        ? pc.green("✓")
        : field.verdict === "degraded"
          ? pc.yellow("~")
          : pc.red("✗");
    const fill = `${(field.fillRate * 100).toFixed(0)}%`.padStart(4);
    lines.push(`    ${mark} ${field.field.padEnd(22)} ${pc.dim(`fill ${fill}`)}`);
  }

  for (const symptom of [...report.shapeSymptoms, ...report.fields.flatMap((f) => f.symptoms)]) {
    lines.push(pc.dim(`      → ${symptom}`));
  }
  return lines.join("\n");
}

export function renderOutcome(outcome: SupervisionOutcome): string {
  const lines: string[] = [];
  lines.push(`\n${pc.bold(outcome.contractId)} ${pc.dim(outcome.collectorId)}`);
  lines.push(renderHealth(outcome.before));

  if (outcome.plan) {
    lines.push(pc.dim(`\n  heal prompt (${outcome.plan.prompt.length}/1000 chars):`));
    for (const line of outcome.plan.prompt.split("\n")) {
      lines.push(pc.dim(`  │ ${line}`));
    }
  }

  if (outcome.gate) {
    const verdict =
      outcome.gate.decision === "approve" ? pc.green("APPROVE") : pc.yellow("REJECT");
    lines.push(`\n  gate: ${verdict} — ${outcome.gate.reason}`);
  }

  if (outcome.after) {
    lines.push(pc.dim("\n  after:"));
    lines.push(renderHealth(outcome.after));
  }

  lines.push(`\n  ${RESOLUTION_LABEL[outcome.resolution]}  ${outcome.summary}`);
  return lines.join("\n");
}

const ANSWER_STATUS_LABEL: Record<AnswerResult["status"], string> = {
  cache_hit: pc.cyan("CACHE HIT"),
  bootstrapped: pc.green("BOOTSTRAPPED"),
  refreshed: pc.green("REFRESHED"),
  refresh_failed: pc.red("REFRESH FAILED"),
};

export function renderAnswer(result: AnswerResult): string {
  const lines: string[] = [];
  const { entry } = result;

  lines.push(`\n${pc.bold(result.query)} ${pc.dim(`[${result.topicKey}]`)}`);
  lines.push(`  ${ANSWER_STATUS_LABEL[result.status]}  ${pc.dim(entry.collectorId)}`);

  if (result.status === "cache_hit") {
    const expiresAt = new Date(new Date(entry.lastConfirmedFresh).getTime() + entry.ttlSeconds * 1000);
    lines.push(pc.dim(`  confirmed fresh ${entry.lastConfirmedFresh} — next check ${expiresAt.toISOString()}`));
  }

  lines.push("");
  for (const row of entry.rows) {
    const identity = String(row[entry.identityField] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const change = result.novelty?.changes.find((c) => c.identity === identity);
    const badge = change?.kind === "new" ? pc.green(" NEW") : change?.kind === "changed" ? pc.yellow(" CHANGED") : "";
    lines.push(`  • ${JSON.stringify(row)}${badge}`);
    if (change?.deltas) {
      for (const delta of change.deltas) {
        lines.push(pc.yellow(`      ${delta.field}: ${JSON.stringify(delta.from)} → ${JSON.stringify(delta.to)}`));
      }
    }
  }

  if (result.novelty && !result.novelty.isBaseline) {
    lines.push(
      pc.dim(
        `\n  ${result.novelty.newCount} new · ${result.novelty.changedCount} changed · ` +
          `${result.novelty.unchangedCount} unchanged · ${result.novelty.removedCount} removed since last check`,
      ),
    );
  }

  if (result.freshness?.changed) {
    lines.push(pc.dim(`  freshness: ${result.freshness.reason} (now ${result.freshness.ttlSeconds}s)`));
  }

  if (result.escalation.missingFields.length > 0) {
    lines.push(
      pc.dim(
        `  cost tier: discovery only; would escalate ${result.escalation.identities.length} row(s) for ` +
          `${result.escalation.missingFields.join(", ")}`,
      ),
    );
  }

  return lines.join("\n");
}
