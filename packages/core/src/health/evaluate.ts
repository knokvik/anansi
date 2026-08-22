import type { Contract, FieldContract } from "../contract/schema.js";
import type { FieldHealth, FieldVerdict, HealthReport, RunStatus } from "./types.js";

/** A single row of scraper output. Values arrive untyped from the collector. */
export type Row = Record<string, unknown>;

export interface EvaluateOptions {
  /** Row count from the last run that was recorded healthy, if any. */
  baselineRowCount?: number | null;
  /** Injectable for deterministic tests. */
  now?: () => Date;
}

/**
 * Strings Bright Data collectors emit when an extraction rule matched nothing.
 * Treating these as absent — rather than as legitimate values — is what lets a
 * layout change surface as a fill-rate collapse instead of a wall of junk data.
 */
const NULLISH_STRINGS = new Set(["", "undefined", "null", "n/a", "na", "-", "—"]);

const MAX_SAMPLES = 3;

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return !NULLISH_STRINGS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/** Numbers frequently arrive as "$1,299.00" or "₹499". Recover the magnitude. */
function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Why a present value fails its contract, or null when it is valid. */
function validationError(value: unknown, field: FieldContract): string | null {
  switch (field.type) {
    case "number":
    case "integer": {
      const n = coerceNumber(value);
      if (n === null) return "not numeric";
      if (field.type === "integer" && !Number.isInteger(n)) return "not an integer";
      if (field.min !== undefined && n < field.min) return `below min ${field.min}`;
      if (field.max !== undefined && n > field.max) return `above max ${field.max}`;
      break;
    }
    case "boolean":
      if (typeof value !== "boolean" && !/^(true|false|yes|no)$/i.test(String(value))) {
        return "not boolean";
      }
      break;
    case "url":
      try {
        new URL(String(value));
      } catch {
        return "not a URL";
      }
      break;
    case "date":
      if (Number.isNaN(Date.parse(String(value)))) return "not a parsable date";
      break;
    case "string":
      break;
  }

  if (field.pattern && !new RegExp(field.pattern).test(String(value))) {
    return `does not match /${field.pattern}/`;
  }
  return null;
}

function verdictFor(
  fillRate: number,
  field: FieldContract,
  invalidCount: number,
  rowsFilled: number,
): FieldVerdict {
  if (rowsFilled === 0) return "missing";
  if (fillRate < field.minFillRate) return "broken";
  if (invalidCount > 0) return "degraded";
  return "healthy";
}

/** Per-field contribution to the run score. Missing data hurts most. */
function scoreFor(health: FieldHealth, field: FieldContract): number {
  switch (health.verdict) {
    case "missing":
      return 0;
    case "broken":
      // Partial credit proportional to how close the fill rate got.
      return field.minFillRate === 0 ? 0 : (health.fillRate / field.minFillRate) * 0.6;
    case "degraded": {
      const validShare = 1 - health.invalidCount / Math.max(health.rowsFilled, 1);
      return 0.6 + validShare * 0.4;
    }
    case "healthy":
      return 1;
  }
}

function evaluateField(field: FieldContract, rows: Row[]): FieldHealth {
  const ok: string[] = [];
  const bad: string[] = [];
  let rowsFilled = 0;
  let invalidCount = 0;
  const errorCounts = new Map<string, number>();

  for (const row of rows) {
    const value = row[field.name];
    if (!isPresent(value)) continue;
    rowsFilled += 1;

    const error = validationError(value, field);
    if (error) {
      invalidCount += 1;
      errorCounts.set(error, (errorCounts.get(error) ?? 0) + 1);
      if (bad.length < MAX_SAMPLES) bad.push(String(value).slice(0, 80));
    } else if (ok.length < MAX_SAMPLES) {
      ok.push(String(value).slice(0, 80));
    }
  }

  const fillRate = rows.length === 0 ? 0 : rowsFilled / rows.length;
  const verdict = verdictFor(fillRate, field, invalidCount, rowsFilled);
  const symptoms: string[] = [];

  if (verdict === "missing") {
    symptoms.push(
      `"${field.name}" returned no value on any of the ${rows.length} rows — the extraction rule matches nothing.`,
    );
  } else if (verdict === "broken") {
    symptoms.push(
      `"${field.name}" filled on only ${rowsFilled} of ${rows.length} rows ` +
        `(${(fillRate * 100).toFixed(0)}%, contract requires ${(field.minFillRate * 100).toFixed(0)}%).`,
    );
  }

  for (const [error, count] of errorCounts) {
    symptoms.push(
      `"${field.name}" has ${count} value(s) that are ${error}` +
        (bad.length > 0 ? `, e.g. ${JSON.stringify(bad[0])}` : "") +
        `; it should be ${field.type}.`,
    );
  }

  return {
    field: field.name,
    verdict,
    fillRate,
    minFillRate: field.minFillRate,
    rowsChecked: rows.length,
    rowsFilled,
    invalidCount,
    samples: { ok, bad },
    symptoms,
  };
}

/**
 * Score one run of a collector against its contract.
 *
 * This is the piece Scraper Studio leaves to the operator: it turns "the output
 * looks wrong" into a machine-readable verdict, so a supervisor can decide to
 * heal without a human having eyeballed a preview.
 */
export function evaluateRun(
  contract: Contract,
  rows: Row[],
  options: EvaluateOptions = {},
): HealthReport {
  const now = options.now ?? (() => new Date());
  const baselineRowCount = options.baselineRowCount ?? null;
  const fields = contract.fields.map((field) => evaluateField(field, rows));

  const shapeSymptoms: string[] = [];
  if (rows.length < contract.shape.minRows) {
    shapeSymptoms.push(
      `The run returned ${rows.length} row(s); the contract expects at least ${contract.shape.minRows}.`,
    );
  }
  if (baselineRowCount !== null && baselineRowCount > 0) {
    const shrink = 1 - rows.length / baselineRowCount;
    if (shrink > contract.shape.maxRowShrinkRatio) {
      shapeSymptoms.push(
        `Row count fell from ${baselineRowCount} to ${rows.length} ` +
          `(${(shrink * 100).toFixed(0)}% drop) — pagination or the result container likely moved.`,
      );
    }
  }

  const fieldScore =
    fields.length === 0
      ? 0
      : fields.reduce((sum, health, index) => sum + scoreFor(health, contract.fields[index]!), 0) /
        fields.length;

  // A shape violation is a whole-run problem, so it caps the score rather than
  // averaging away against fields that happen to still be filling.
  const score = shapeSymptoms.length > 0 ? Math.min(fieldScore, 0.5) : fieldScore;

  const requiredBroken = fields.some((health, index) => {
    const field = contract.fields[index]!;
    return field.required && (health.verdict === "missing" || health.verdict === "broken");
  });

  let status: RunStatus;
  if (rows.length === 0 || requiredBroken || shapeSymptoms.length > 0) {
    status = "broken";
  } else if (fields.some((f) => f.verdict !== "healthy")) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return {
    contractId: contract.id,
    collectorId: contract.collectorId,
    checkedAt: now().toISOString(),
    rowCount: rows.length,
    baselineRowCount,
    status,
    score: Number(score.toFixed(4)),
    fields,
    shapeSymptoms,
    healRecommended: score < contract.healBelowScore,
  };
}
