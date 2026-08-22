import type { Contract } from "../contract/schema.js";
import type { FieldHealth, HealthReport } from "../health/types.js";

/** `bdata scraper heal` rejects prompts longer than this. */
export const HEAL_PROMPT_LIMIT = 1000;

export interface HealPlan {
  /** The prompt to hand to `bdata scraper heal`. Always within the limit. */
  prompt: string;
  /** Fields the prompt asks to repair, worst first. */
  targetedFields: string[];
  /** Fields that are healthy and must survive the repair untouched. */
  preservedFields: string[];
  /** True when field detail had to be dropped to fit the character budget. */
  truncated: boolean;
}

/** Worst first: a field that vanished outranks one that merely mistypes values. */
const VERDICT_PRIORITY = { missing: 0, broken: 1, degraded: 2, healthy: 3 } as const;

function bySeverity(a: FieldHealth, b: FieldHealth): number {
  const delta = VERDICT_PRIORITY[a.verdict] - VERDICT_PRIORITY[b.verdict];
  return delta !== 0 ? delta : a.fillRate - b.fillRate;
}

/**
 * Turn a failed health check into repair instructions.
 *
 * The prompt is assembled from two things that already exist in version control:
 * the plain-language field descriptions in the contract, and the concrete
 * symptoms observed in the run. Nothing is invented at heal time, so the repaired
 * scraper is pulled back toward the contract rather than toward whatever the
 * model guesses the page is about.
 */
export function synthesizeHealPlan(contract: Contract, report: HealthReport): HealPlan {
  const byName = new Map(contract.fields.map((field) => [field.name, field]));
  const unhealthy = report.fields.filter((f) => f.verdict !== "healthy").sort(bySeverity);
  const preservedFields = report.fields.filter((f) => f.verdict === "healthy").map((f) => f.field);

  const header =
    `The scraper is failing its data contract on ${report.rowCount} scraped row(s). ` +
    `Repair the extraction so every field below is populated again.`;

  const footer =
    preservedFields.length > 0
      ? `Leave these already-working fields exactly as they are: ${preservedFields.join(", ")}.`
      : "";

  const shapeLines = report.shapeSymptoms.slice(0, 2);

  // Each targeted field costs one block. Add blocks worst-first until the budget
  // runs out, so the most severe breakage always makes it into the prompt.
  const blocks: { field: string; text: string }[] = unhealthy.map((health) => {
    const contractField = byName.get(health.field);
    const symptom = health.symptoms[0] ?? `"${health.field}" is not matching its contract.`;
    const definition = contractField
      ? ` It must contain: ${contractField.description} (type: ${contractField.type}).`
      : "";
    return { field: health.field, text: `- ${symptom}${definition}` };
  });

  const targetedFields: string[] = [];
  const chosen: string[] = [];
  let truncated = false;

  const fixedCost = header.length + shapeLines.join(" ").length + footer.length + 4;
  let used = fixedCost;

  for (const block of blocks) {
    const cost = block.text.length + 1;
    if (used + cost > HEAL_PROMPT_LIMIT) {
      truncated = true;
      continue;
    }
    used += cost;
    chosen.push(block.text);
    targetedFields.push(block.field);
  }

  const prompt = [header, ...shapeLines, ...chosen, footer]
    .filter((part) => part.length > 0)
    .join("\n")
    .slice(0, HEAL_PROMPT_LIMIT);

  return { prompt, targetedFields, preservedFields, truncated };
}
