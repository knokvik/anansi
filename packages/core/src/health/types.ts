/** Where a field sits relative to its contract after a run. */
export type FieldVerdict =
  /** Absent from every row — the extraction rule produced nothing at all. */
  | "missing"
  /** Present but below the contracted fill rate. */
  | "broken"
  /** Filling acceptably, but some values fail type/pattern/range checks. */
  | "degraded"
  | "healthy";

export interface FieldHealth {
  field: string;
  verdict: FieldVerdict;
  /** Share of rows carrying a usable value, 0..1. */
  fillRate: number;
  minFillRate: number;
  rowsChecked: number;
  rowsFilled: number;
  /** Values that were present but failed type, pattern or range validation. */
  invalidCount: number;
  /** Up to a handful of offending values, for the heal prompt and the UI. */
  samples: { ok: string[]; bad: string[] };
  /** Plain-language statements of what is wrong. Empty when healthy. */
  symptoms: string[];
}

export type RunStatus = "healthy" | "degraded" | "broken";

export interface HealthReport {
  contractId: string;
  collectorId: string;
  checkedAt: string;
  rowCount: number;
  /** Row count of the most recent healthy run, when one is on record. */
  baselineRowCount: number | null;
  status: RunStatus;
  /** 0..1. Mean of per-field health, penalised by row-shape violations. */
  score: number;
  fields: FieldHealth[];
  /** Shape-level problems: too few rows, a sudden collapse in row count. */
  shapeSymptoms: string[];
  /** True when the supervisor should spend credits on a heal. */
  healRecommended: boolean;
}
