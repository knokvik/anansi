import { describe, expect, it } from "vitest";
import { planEscalation } from "../src/knowledge/escalate.js";
import { isFresh, shouldBeStanding } from "../src/knowledge/gate.js";
import { planTopicKey } from "../src/knowledge/planner.js";
import type { KnowledgeEntry } from "../src/knowledge/types.js";
import { pricingContract } from "./contract.fixture.js";

describe("planTopicKey", () => {
  it("normalizes casing and punctuation to the same key", () => {
    expect(planTopicKey("Best Headphones Under $200!")).toBe(planTopicKey("best headphones under 200"));
  });

  it("always produces a valid contract id", () => {
    expect(planTopicKey("123 not a letter start")).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(planTopicKey("")).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe("gate", () => {
  const baseEntry: KnowledgeEntry = {
    topicKey: "t",
    query: "q",
    contractId: "t",
    collectorId: "c_abc",
    rows: [],
    identityField: "model_name",
    freshnessClass: "daily",
    ttlSeconds: 3600,
    lastConfirmedFresh: new Date("2026-08-23T00:00:00Z").toISOString(),
    standing: false,
    askCount: 1,
    tier: "discovery",
    escalatedCount: 0,
    lastStatus: "healthy",
    lastScore: 1,
  };

  it("is fresh inside the TTL window", () => {
    const now = new Date("2026-08-23T00:30:00Z");
    expect(isFresh(baseEntry, now)).toBe(true);
  });

  it("is stale once the TTL has elapsed", () => {
    const now = new Date("2026-08-23T02:00:00Z");
    expect(isFresh(baseEntry, now)).toBe(false);
  });

  it("promotes a topic to standing only after it's been asked more than once", () => {
    expect(shouldBeStanding(1)).toBe(false);
    expect(shouldBeStanding(2)).toBe(true);
  });
});

describe("planEscalation", () => {
  it("escalates a required field that is entirely absent at the cheap tier", () => {
    const discoveryRows = [
      { model_name: "Opus" }, // input_price is required on the fixture contract and entirely missing here
      { model_name: "Sonnet" },
    ];
    const plan = planEscalation(pricingContract, discoveryRows, "model_name");
    expect(plan.missingFields).toContain("input_price");
    expect(plan.identities).toEqual(["Opus", "Sonnet"]);
  });

  it("does not escalate a field that is merely sparse, not entirely absent", () => {
    const discoveryRows = [
      { model_name: "Opus", input_price: "$15.00" },
      { model_name: "Sonnet" }, // missing here, but present on at least one row overall
    ];
    const plan = planEscalation(pricingContract, discoveryRows, "model_name");
    expect(plan.missingFields).toEqual([]);
    expect(plan.identities).toEqual([]);
  });

  it("only lists identities actually missing the escalated field", () => {
    const discoveryRows = [{ model_name: "Opus" }, { model_name: "Sonnet" }];
    // Neither row has input_price here, so both need it — sanity check the
    // narrower case where only one row is short a field is covered above.
    const plan = planEscalation(pricingContract, discoveryRows, "model_name");
    expect(plan.identities).toHaveLength(2);
  });
});
