import type { Contract } from "../contract/schema.js";
import type { NoveltyReport } from "../health/novelty.js";
import type { FreshnessClass } from "./types.js";

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Starting point before any adjustment has had a chance to run. */
const DEFAULT_TTL_SECONDS: Record<FreshnessClass, number> = {
  volatile: 6 * HOUR,
  daily: DAY,
  weekly: 7 * DAY,
  stable: 30 * DAY,
};

/** Floors and ceiling so the learner can't over-correct into either extreme. */
const MIN_TTL_SECONDS: Record<FreshnessClass, number> = {
  volatile: HOUR,
  daily: 2 * HOUR,
  weekly: DAY,
  stable: 3 * DAY,
};
const MAX_TTL_SECONDS = 30 * DAY;

const CHANGE_RATIO_THRESHOLD = 0.2;

/**
 * Guess how fast a topic's data decays from the shape of its contract. A crude
 * heuristic — any required numeric field (a price, a rate, a count) implies
 * something that moves often; an all-text contract implies something closer to
 * biographical fact. Good enough as a starting point; the learner corrects it
 * from there.
 */
export function inferFreshnessClass(contract: Contract): FreshnessClass {
  const hasVolatileField = contract.fields.some(
    (f) => f.required && (f.type === "number" || f.type === "integer"),
  );
  return hasVolatileField ? "volatile" : "stable";
}

export function defaultTtlSeconds(freshnessClass: FreshnessClass): number {
  return DEFAULT_TTL_SECONDS[freshnessClass];
}

export interface FreshnessAdjustment {
  ttlSeconds: number;
  changed: boolean;
  reason: string;
}

/**
 * Adjust a topic's TTL from what its own novelty diff just observed, rather
 * than leaving it pinned to a static table. Nothing moved → double the wait
 * before checking again. A lot moved → halve it. Repeated calls converge:
 * a topic that keeps coming back unchanged keeps stretching its TTL until it
 * hits the ceiling for its class, and a topic that starts moving fast snaps
 * back down within one or two checks.
 */
export function adjustTtl(
  freshnessClass: FreshnessClass,
  currentTtlSeconds: number,
  novelty: NoveltyReport,
): FreshnessAdjustment {
  const floor = MIN_TTL_SECONDS[freshnessClass];
  const totalRows = novelty.newCount + novelty.changedCount + novelty.unchangedCount;

  if (novelty.isBaseline || totalRows === 0) {
    return { ttlSeconds: currentTtlSeconds, changed: false, reason: "no prior snapshot to compare against yet" };
  }

  const movedRatio = (novelty.newCount + novelty.changedCount) / totalRows;

  if (movedRatio === 0) {
    const next = Math.min(currentTtlSeconds * 2, MAX_TTL_SECONDS);
    return {
      ttlSeconds: next,
      changed: next !== currentTtlSeconds,
      reason: "nothing changed since the last check; widening the check interval",
    };
  }

  if (movedRatio > CHANGE_RATIO_THRESHOLD) {
    const next = Math.max(Math.floor(currentTtlSeconds / 2), floor);
    return {
      ttlSeconds: next,
      changed: next !== currentTtlSeconds,
      reason: `${(movedRatio * 100).toFixed(0)}% of rows moved since the last check; narrowing the check interval`,
    };
  }

  return { ttlSeconds: currentTtlSeconds, changed: false, reason: "change rate within normal range" };
}
