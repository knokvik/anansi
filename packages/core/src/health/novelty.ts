import type { Contract } from "../contract/schema.js";
import type { Row } from "./evaluate.js";

export type RowChangeKind = "new" | "changed";

export interface FieldDelta {
  field: string;
  from: unknown;
  to: unknown;
}

export interface RowChange {
  kind: RowChangeKind;
  identity: string;
  row: Row;
  /** Present only for "changed" rows: the fields that actually moved. */
  deltas?: FieldDelta[];
}

export interface NoveltyReport {
  identityField: string;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  /** Rows present in the last snapshot but absent from this run. */
  removedCount: number;
  /** True on a contract's first ever comparison — there is nothing to diff against. */
  isBaseline: boolean;
  /** New and changed rows, most interesting first, capped for display. */
  changes: RowChange[];
}

const MAX_CHANGES = 25;

/** Case- and whitespace-insensitive comparison, so re-fetched text doesn't read as "changed". */
function normalize(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveIdentityField(contract: Contract): string {
  if (contract.identityField) return contract.identityField;
  const firstRequiredString = contract.fields.find(
    (f) => f.required && (f.type === "string" || f.type === "url"),
  );
  return (firstRequiredString ?? contract.fields[0]!).name;
}

/**
 * Diff one run's rows against the last known-good snapshot, so the fleet can
 * answer "what's new" as well as "is this still working".
 *
 * Rows are matched by an identity field — a stable natural key like a model name
 * or product URL — rather than by position, since row order and count both shift
 * as a source adds, removes, or reorders items. A row with no identity value
 * cannot be tracked and is silently excluded from the diff.
 */
export function detectNovelty(
  contract: Contract,
  currentRows: Row[],
  previousRows: Row[] | null,
): NoveltyReport {
  const identityField = resolveIdentityField(contract);
  const trackedFields = contract.fields.map((f) => f.name).filter((name) => name !== identityField);

  if (previousRows === null) {
    return {
      identityField,
      newCount: 0,
      changedCount: 0,
      unchangedCount: currentRows.length,
      removedCount: 0,
      isBaseline: true,
      changes: [],
    };
  }

  const previousByIdentity = new Map<string, Row>();
  for (const row of previousRows) {
    const id = normalize(row[identityField]);
    if (id !== "") previousByIdentity.set(id, row);
  }

  const seen = new Set<string>();
  const changes: RowChange[] = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const row of currentRows) {
    const id = normalize(row[identityField]);
    if (id === "") continue;
    seen.add(id);
    const previous = previousByIdentity.get(id);

    if (!previous) {
      newCount += 1;
      if (changes.length < MAX_CHANGES) changes.push({ kind: "new", identity: id, row });
      continue;
    }

    const deltas: FieldDelta[] = [];
    for (const field of trackedFields) {
      const from = previous[field];
      const to = row[field];
      if (normalize(from) !== normalize(to)) deltas.push({ field, from, to });
    }

    if (deltas.length > 0) {
      changedCount += 1;
      if (changes.length < MAX_CHANGES) changes.push({ kind: "changed", identity: id, row, deltas });
    } else {
      unchangedCount += 1;
    }
  }

  let removedCount = 0;
  for (const id of previousByIdentity.keys()) {
    if (!seen.has(id)) removedCount += 1;
  }

  return { identityField, newCount, changedCount, unchangedCount, removedCount, isBaseline: false, changes };
}
