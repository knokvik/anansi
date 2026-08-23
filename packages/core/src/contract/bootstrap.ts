import type { Row } from "../health/evaluate.js";
import { Contract, FieldContract } from "./schema.js";

/**
 * Parse a value as a number, or null when it isn't one.
 *
 * Stripping non-digit characters from ordinary text (`"Nimbus Titan"`) leaves
 * an empty string, and `Number("")` is `0` — a real number, not an error. That
 * quirk alone was enough to misclassify every all-text field as numeric.
 * Guarding against an empty (or bare sign/decimal) result after stripping is
 * what keeps a name from being inferred as an integer.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function allNumeric(values: unknown[]): boolean {
  return values.every((v) => toNumber(v) !== null);
}

function allIntegers(values: unknown[]): boolean {
  return values.every((v) => {
    const n = toNumber(v);
    return n !== null && Number.isInteger(n);
  });
}

function allUrls(values: unknown[]): boolean {
  return values.every((v) => {
    try {
      new URL(String(v));
      return true;
    } catch {
      return false;
    }
  });
}

function allDates(values: unknown[]): boolean {
  return values.every((v) => !Number.isNaN(Date.parse(String(v))));
}

function allBooleans(values: unknown[]): boolean {
  return values.every((v) => typeof v === "boolean" || /^(true|false|yes|no)$/i.test(String(v)));
}

function inferType(values: unknown[]): FieldContract["type"] {
  if (values.length === 0) return "string";
  if (allBooleans(values)) return "boolean";
  if (allIntegers(values)) return "integer";
  if (allNumeric(values)) return "number";
  if (allUrls(values)) return "url";
  if (allDates(values)) return "date";
  return "string";
}

/** Bright Data field names aren't guaranteed to be lower_snake_case; the contract's must be. */
function sanitizeFieldName(raw: string): string {
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return /^[a-z]/.test(snake) ? snake : `f_${snake}`;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export interface BootstrapInput {
  topicKey: string;
  query: string;
  collectorId: string;
  canaryUrl: string;
  rows: Row[];
}

export interface BootstrapResult {
  contract: Contract;
  /**
   * The same rows, with keys renamed to match the contract's field names.
   * `evaluateRun` and everything downstream of it index a row by
   * `field.name` — if a raw key like `modelName` gets sanitized into
   * `model_name` for the contract but the row itself is never remapped, the
   * field reads as permanently missing. Always score and store these rows,
   * never the ones originally passed in.
   */
  rows: Row[];
}

/**
 * Turn a topic's first successful run into its own contract.
 *
 * There is no human-written field description here — the query and inferred
 * type are all there is — so a heal prompt synthesized from a bootstrapped
 * contract will read as more generic than one written by hand. That's the
 * honest tradeoff of self-bootstrapping: a topic gets self-healing on its
 * first run instead of needing someone to write YAML for it first, at the
 * cost of a less specific repair instruction if it ever breaks.
 */
export function bootstrapContract(input: BootstrapInput): BootstrapResult {
  const { topicKey, query, collectorId, canaryUrl, rows } = input;

  if (rows.length === 0) {
    throw new Error(`cannot bootstrap a contract for "${topicKey}" from zero rows`);
  }

  const rawKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) rawKeys.add(key);
  }

  const keyMap = new Map<string, string>();
  for (const rawKey of rawKeys) keyMap.set(rawKey, sanitizeFieldName(rawKey));

  const fields: FieldContract[] = [...rawKeys].map((rawKey) => {
    const present = rows.map((row) => row[rawKey]).filter(isPresent);
    const fillRate = present.length / rows.length;
    const type = inferType(present);
    const required = fillRate >= 0.8;

    return FieldContract.parse({
      name: keyMap.get(rawKey)!,
      description: `"${rawKey}" as observed when this topic was first scraped for the query: ${query}`,
      type,
      required,
      minFillRate: required ? Math.max(0.7, Math.round((fillRate - 0.1) * 100) / 100) : 0.3,
    });
  });

  const contract = Contract.parse({
    id: topicKey,
    name: query.slice(0, 80),
    collectorId,
    canaries: [canaryUrl],
    fields,
    shape: { minRows: 1, maxRowShrinkRatio: 0.5 },
    healBelowScore: 0.75,
  });

  const normalizedRows = rows.map((row) => {
    const normalized: Row = {};
    for (const [rawKey, value] of Object.entries(row)) {
      normalized[keyMap.get(rawKey) ?? rawKey] = value;
    }
    return normalized;
  });

  return { contract, rows: normalizedRows };
}
