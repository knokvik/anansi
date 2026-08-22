import { describe, expect, it } from "vitest";
import { evaluateRun } from "../src/health/evaluate.js";
import { pricingContract } from "./contract.fixture.js";

const healthyRows = [
  { model_name: "Opus", input_price: "$15.00", context_window: 200000 },
  { model_name: "Sonnet", input_price: "$3.00", context_window: 200000 },
  { model_name: "Haiku", input_price: "$0.80", context_window: 200000 },
];

describe("evaluateRun", () => {
  it("passes a run that satisfies every field", () => {
    const report = evaluateRun(pricingContract, healthyRows);
    expect(report.status).toBe("healthy");
    expect(report.score).toBe(1);
    expect(report.healRecommended).toBe(false);
  });

  it("parses currency-formatted numbers rather than flagging them", () => {
    const report = evaluateRun(pricingContract, healthyRows);
    const price = report.fields.find((f) => f.field === "input_price");
    expect(price?.invalidCount).toBe(0);
    expect(price?.verdict).toBe("healthy");
  });

  it("treats the literal string 'undefined' as a missing value", () => {
    const rows = healthyRows.map((row) => ({ ...row, input_price: "undefined" }));
    const report = evaluateRun(pricingContract, rows);
    const price = report.fields.find((f) => f.field === "input_price");
    expect(price?.verdict).toBe("missing");
    expect(price?.fillRate).toBe(0);
    expect(report.status).toBe("broken");
    expect(report.healRecommended).toBe(true);
  });

  it("flags a field that only partially fills after a layout change", () => {
    const rows = [
      healthyRows[0]!,
      { ...healthyRows[1]!, model_name: null },
      { ...healthyRows[2]!, model_name: "" },
    ];
    const report = evaluateRun(pricingContract, rows);
    const name = report.fields.find((f) => f.field === "model_name");
    expect(name?.verdict).toBe("broken");
    expect(name?.fillRate).toBeCloseTo(1 / 3);
    expect(name?.symptoms[0]).toContain("filled on only 1 of 3 rows");
  });

  it("catches unit drift through range bounds", () => {
    const rows = healthyRows.map((row) => ({ ...row, input_price: -5 }));
    const report = evaluateRun(pricingContract, rows);
    const price = report.fields.find((f) => f.field === "input_price");
    expect(price?.verdict).toBe("degraded");
    expect(price?.symptoms.join(" ")).toContain("below min 0");
  });

  it("does not mark an optional sparse field as broken", () => {
    const rows = healthyRows.map((row, index) =>
      index === 0 ? row : { ...row, context_window: null },
    );
    const report = evaluateRun(pricingContract, rows);
    const context = report.fields.find((f) => f.field === "context_window");
    expect(context?.verdict).toBe("broken");
    // Optional fields degrade the score but must not, on their own, mark the run broken.
    expect(report.fields.find((f) => f.field === "model_name")?.verdict).toBe("healthy");
  });

  it("detects a collapse in row count against the healthy baseline", () => {
    const report = evaluateRun(pricingContract, healthyRows.slice(0, 2), {
      baselineRowCount: 40,
    });
    expect(report.status).toBe("broken");
    expect(report.shapeSymptoms[0]).toContain("Row count fell from 40 to 2");
    expect(report.score).toBeLessThanOrEqual(0.5);
  });

  it("reports an empty run as broken rather than vacuously healthy", () => {
    const report = evaluateRun(pricingContract, []);
    expect(report.status).toBe("broken");
    expect(report.score).toBe(0);
  });
});
