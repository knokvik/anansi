import type { Row } from "../health/evaluate.js";
import type { RunStatus } from "../health/types.js";

/**
 * How fast a topic's data actually decays. Drives the default TTL; the
 * Freshness Learner adjusts the concrete number from there based on what
 * `detectNovelty` actually observes for this topic over time.
 */
export type FreshnessClass = "volatile" | "daily" | "weekly" | "stable";

/** Which scraper tier produced a topic's current data. Cost is shown, not hidden. */
export type ScrapeTier = "discovery" | "discovery+pdp";

export interface KnowledgeEntry {
  topicKey: string;
  /** The original free-text ask that first created this topic. */
  query: string;
  contractId: string;
  collectorId: string;
  rows: Row[];
  identityField: string;
  freshnessClass: FreshnessClass;
  ttlSeconds: number;
  lastConfirmedFresh: string;
  /** True once this topic has been asked enough to earn a place in the nightly sweep. */
  standing: boolean;
  askCount: number;
  tier: ScrapeTier;
  /** Rows escalated to the expensive tier on the most recent resolution, if any. */
  escalatedCount: number;
  /** The contract-score outcome of the run that produced this entry — persisted so a cache hit can report it honestly instead of assuming "healthy". */
  lastStatus: RunStatus;
  lastScore: number;
}
