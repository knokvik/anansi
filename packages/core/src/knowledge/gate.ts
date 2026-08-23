import type { KnowledgeEntry } from "./types.js";

/** A topic asked more than once has proven it's worth keeping warm. */
const STANDING_ASK_THRESHOLD = 2;

/** True when a cached entry is still inside its TTL window. */
export function isFresh(entry: KnowledgeEntry, now: Date): boolean {
  const age = now.getTime() - new Date(entry.lastConfirmedFresh).getTime();
  return age < entry.ttlSeconds * 1000;
}

/**
 * Decide whether a topic has earned a place in the nightly sweep. A true
 * one-off is scraped live and left ephemeral; only a repeated ask is worth
 * scheduling ahead of demand.
 */
export function shouldBeStanding(askCount: number): boolean {
  return askCount >= STANDING_ASK_THRESHOLD;
}
