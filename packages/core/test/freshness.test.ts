import { describe, expect, it } from "vitest";
import { adjustTtl, defaultTtlSeconds, inferFreshnessClass } from "../src/knowledge/freshness.js";
import type { NoveltyReport } from "../src/health/novelty.js";
import { pricingContract } from "./contract.fixture.js";

function novelty(overrides: Partial<NoveltyReport>): NoveltyReport {
  return {
    identityField: "model_name",
    newCount: 0,
    changedCount: 0,
    unchangedCount: 10,
    removedCount: 0,
    isBaseline: false,
    changes: [],
    ...overrides,
  };
}

describe("inferFreshnessClass", () => {
  it("classifies a contract with a required numeric field as volatile", () => {
    expect(inferFreshnessClass(pricingContract)).toBe("volatile");
  });

  it("classifies an all-text contract as stable", () => {
    const textOnly = { ...pricingContract, fields: [pricingContract.fields[0]!] };
    expect(inferFreshnessClass(textOnly)).toBe("stable");
  });
});

describe("adjustTtl", () => {
  it("leaves the TTL alone on the first ever comparison", () => {
    const result = adjustTtl("daily", defaultTtlSeconds("daily"), novelty({ isBaseline: true, unchangedCount: 0 }));
    expect(result.changed).toBe(false);
  });

  it("widens the interval when nothing changed", () => {
    const start = defaultTtlSeconds("daily");
    const result = adjustTtl("daily", start, novelty({ unchangedCount: 10 }));
    expect(result.ttlSeconds).toBe(start * 2);
    expect(result.changed).toBe(true);
  });

  it("narrows the interval when a lot changed", () => {
    const start = defaultTtlSeconds("daily");
    const result = adjustTtl("daily", start, novelty({ changedCount: 5, unchangedCount: 5 }));
    expect(result.ttlSeconds).toBe(Math.floor(start / 2));
  });

  it("leaves the TTL alone for a modest, unremarkable amount of change", () => {
    const start = defaultTtlSeconds("daily");
    const result = adjustTtl("daily", start, novelty({ changedCount: 1, unchangedCount: 9 }));
    expect(result.changed).toBe(false);
  });

  it("converges toward the ceiling over repeated stable checks", () => {
    let ttl = defaultTtlSeconds("volatile");
    for (let i = 0; i < 10; i += 1) {
      ttl = adjustTtl("volatile", ttl, novelty({ unchangedCount: 10 })).ttlSeconds;
    }
    expect(ttl).toBe(30 * 24 * 3600);
  });

  it("never shrinks below the floor for its class", () => {
    let ttl = defaultTtlSeconds("volatile");
    for (let i = 0; i < 10; i += 1) {
      ttl = adjustTtl("volatile", ttl, novelty({ changedCount: 9, unchangedCount: 1 })).ttlSeconds;
    }
    expect(ttl).toBe(3600);
  });
});
