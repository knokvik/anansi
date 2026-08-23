/**
 * Normalize a free-text ask into a stable topic key, so repeat questions —
 * even phrased slightly differently in casing or spacing — resolve to the
 * same Knowledge Store entry instead of each spawning its own scrape.
 */
export function planTopicKey(query: string): string {
  const slug =
    query
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "topic";
  return /^[a-z]/.test(slug) ? slug : `topic-${slug}`;
}
