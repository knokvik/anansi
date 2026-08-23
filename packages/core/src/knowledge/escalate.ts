import type { Contract } from "../contract/schema.js";
import type { Row } from "../health/evaluate.js";

export interface EscalationPlan {
  /** Required fields the cheap tier didn't carry at all — not merely sparse. */
  missingFields: string[];
  /** Identity values of rows missing at least one of those fields. */
  identities: string[];
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/**
 * Decide which rows are worth a second, more expensive fetch.
 *
 * Discovery-tier rows legitimately omit detail-page-only fields entirely —
 * that's the tier doing its job cheaply, not breakage. Escalation targets only
 * the specific rows missing a field the contract actually requires, rather
 * than re-fetching everything at the expensive tier because some of it needs
 * one more field. A field with a *partial* fill rate is a heal candidate, not
 * an escalation candidate — this only escalates fields that are entirely
 * absent at the cheap tier.
 */
export function planEscalation(contract: Contract, discoveryRows: Row[], identityField: string): EscalationPlan {
  const requiredFields = contract.fields
    .filter((field) => field.required && field.name !== identityField)
    .map((field) => field.name);

  const missingFields = requiredFields.filter((field) => {
    return !discoveryRows.some((row) => isPresent(row[field]));
  });

  if (missingFields.length === 0) {
    return { missingFields: [], identities: [] };
  }

  const identities = discoveryRows
    .filter((row) => missingFields.some((field) => !isPresent(row[field])))
    .map((row) => String(row[identityField] ?? ""))
    .filter((id) => id !== "");

  return { missingFields, identities };
}
