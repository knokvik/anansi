import type { Row } from "@anansi/core";

/**
 * Bright Data's CLI wraps results in an envelope whose exact shape varies by
 * command and version (`--legacy-output` alone changes it). Rather than pin one
 * shape and break on the next release, we look for the first array of objects
 * under a set of known-good keys, then fall back to a breadth-first search.
 */
const PREFERRED_KEYS = [
  "data",
  "rows",
  "results",
  "output",
  "records",
  "items",
  "preview",
  "sample",
  "sample_rows",
  "preview_rows",
];

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bright Data occasionally truncates a large preview array for display with a trailing marker like `"3 more items"`. */
function isTruncationMarker(value: unknown): boolean {
  return typeof value === "string" && /^\d+\s+more\b/i.test(value.trim());
}

/**
 * Accept an array as a row set if every entry is a row object, or every
 * non-row entry is a truncation marker — and return only the real rows.
 * Approving a heal off a *summarized* preview would otherwise read as "every
 * field is missing" for the entries that got collapsed into that marker,
 * which is a display artifact, not a broken extraction.
 */
function filterRows(value: unknown): Row[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows = value.filter(isRow);
  if (rows.length === 0) return null;
  const rest = value.filter((entry) => !isRow(entry));
  if (rest.length > 0 && !rest.every(isTruncationMarker)) return null;
  return rows;
}

/**
 * Pull the tabular payload out of an arbitrary CLI envelope.
 * Returns `[]` for a well-formed envelope that genuinely carried no rows, and
 * `null` when nothing array-shaped could be found at all.
 */
export function extractRows(payload: unknown): Row[] | null {
  if (payload === null || payload === undefined) return null;

  // A length-1 array is almost always one page's worth of result, not one row:
  // a Discovery-type run against a single page returns `[{ models: [...] }]`,
  // the whole list nested inside a field. Try unwrapping that before falling
  // through to the "the outer array itself is already the rows" check below —
  // otherwise a real multi-item result gets flattened into a single fake row.
  if (Array.isArray(payload) && payload.length === 1) {
    const nested = extractRows(payload[0]);
    if (nested !== null) return nested;
  }

  const direct = filterRows(payload);
  if (direct !== null) return direct;
  if (Array.isArray(payload)) return payload.length === 0 ? [] : null;
  if (typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;

  for (const key of PREFERRED_KEYS) {
    const candidate = record[key];
    const rows = filterRows(candidate);
    if (rows !== null) return rows;
    if (Array.isArray(candidate) && candidate.length === 0) return [];
  }

  // Breadth-first through nested objects, so `{ result: { data: [...] } }` works.
  const queue: unknown[] = Object.values(record);
  while (queue.length > 0) {
    const next = queue.shift();
    const rows = filterRows(next);
    if (rows !== null) return rows;
    if (next && typeof next === "object" && !Array.isArray(next)) {
      queue.push(...Object.values(next as Record<string, unknown>));
    }
  }
  return null;
}

/** True when a heal envelope is parked at the approve/reject gate. */
export function isAwaitingApproval(payload: unknown): boolean {
  const status = findStatus(payload);
  return status !== null && /awaiting[_ -]?approval|pending[_ -]?approval/i.test(status);
}

export function findStatus(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record["status"] === "string") return record["status"];
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const nested = findStatus(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/** Best-effort JSON parse of CLI stdout that may carry log noise around it. */
export function parseJsonLoose(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to bracket scanning.
  }
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }
  return null;
}
