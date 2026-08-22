import pc from "picocolors";
import type { HealthReport, SupervisionOutcome } from "@anansi/core";

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
