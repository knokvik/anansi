import { describe, expect, it } from "vitest";
import { detectNovelty } from "../src/health/novelty.js";
import { pricingContract } from "./contract.fixture.js";

const gen1 = [
  { model_name: "Opus", input_price: "$15.00", context_window: 200000 },
  { model_name: "Sonnet", input_price: "$3.00", context_window: 200000 },
];

describe("detectNovelty", () => {
  it("reports a baseline with no changes when there is nothing to compare against", () => {
    const report = detectNovelty(pricingContract, gen1, null);
    expect(report.isBaseline).toBe(true);
    expect(report.newCount).toBe(0);
    expect(report.unchangedCount).toBe(gen1.length);
  });

  it("flags a row with an identity not seen before as new", () => {
    const withNewModel = [...gen1, { model_name: "Haiku", input_price: "$0.80", context_window: 200000 }];
    const report = detectNovelty(pricingContract, withNewModel, gen1);
    expect(report.newCount).toBe(1);
    expect(report.changes[0]).toMatchObject({ kind: "new", identity: "haiku" });
  });

  it("flags a tracked field changing on a known identity as changed, with the delta", () => {
    const priceDropped = [{ ...gen1[0]!, input_price: "$12.00" }, gen1[1]!];
    const report = detectNovelty(pricingContract, priceDropped, gen1);
    expect(report.changedCount).toBe(1);
    const change = report.changes.find((c) => c.identity === "opus");
    expect(change?.kind).toBe("changed");
    expect(change?.deltas).toContainEqual({ field: "input_price", from: "$15.00", to: "$12.00" });
  });

  it("does not flag re-fetched text that only differs by whitespace or case", () => {
    const reformatted = [{ ...gen1[0]!, model_name: "  OPUS  " }, gen1[1]!];
    const report = detectNovelty(pricingContract, reformatted, gen1);
    expect(report.changedCount).toBe(0);
    expect(report.unchangedCount).toBe(2);
  });

  it("counts a row present before but absent now as removed", () => {
    const report = detectNovelty(pricingContract, [gen1[0]!], gen1);
    expect(report.removedCount).toBe(1);
  });

  it("excludes rows with no identity value from the diff entirely", () => {
    const noIdentity = [{ input_price: "$5.00" }];
    const report = detectNovelty(pricingContract, noIdentity, gen1);
    expect(report.newCount).toBe(0);
    expect(report.changedCount).toBe(0);
    expect(report.unchangedCount).toBe(0);
  });

  it("respects an explicit identityField over the default heuristic", () => {
    const contract = { ...pricingContract, identityField: "context_window" as const };
    const report = detectNovelty(contract, gen1, gen1);
    expect(report.identityField).toBe("context_window");
  });
});
