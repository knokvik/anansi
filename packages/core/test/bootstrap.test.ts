import { describe, expect, it } from "vitest";
import { bootstrapContract } from "../src/contract/bootstrap.js";
import { evaluateRun } from "../src/health/evaluate.js";

const rows = [
  { modelName: "Nimbus Titan", input_price_usd_per_mtok: 15, context_window_tokens: 200000, lifecycle_status: "GA" },
  { modelName: "Nimbus Vale", input_price_usd_per_mtok: 3, context_window_tokens: 200000, lifecycle_status: "GA" },
  { modelName: "Nimbus Wisp", input_price_usd_per_mtok: 0.8, context_window_tokens: 200000, lifecycle_status: null },
];

const params = { topicKey: "t", query: "q", collectorId: "c_abc", canaryUrl: "https://example.com", rows };

describe("bootstrapContract", () => {
  it("infers a valid contract from a set of rows", () => {
    const { contract } = bootstrapContract({ ...params, topicKey: "nimbus-pricing" });
    expect(contract.id).toBe("nimbus-pricing");
    expect(contract.collectorId).toBe("c_abc");
    expect(contract.canaries).toEqual(["https://example.com"]);
  });

  it("sanitizes camelCase keys into lower_snake_case field names", () => {
    const { contract } = bootstrapContract(params);
    expect(contract.fields.map((f) => f.name)).toContain("model_name");
  });

  it("remaps the rows themselves to the same sanitized keys as the contract", () => {
    // Otherwise evaluateRun looks up "model_name" on a row that still only has
    // "modelName", and the field reads as permanently missing.
    const { rows: normalized } = bootstrapContract(params);
    expect(normalized[0]).toMatchObject({ model_name: "Nimbus Titan" });
    expect(normalized[0]).not.toHaveProperty("modelName");
  });

  it("does not misclassify an all-text field as integer", () => {
    // "Nimbus Titan" has no digits at all — stripping non-numeric characters
    // leaves "", and Number("") is 0, a valid integer, unless guarded against.
    const { contract } = bootstrapContract(params);
    const name = contract.fields.find((f) => f.name === "model_name");
    expect(name?.type).toBe("string");
  });

  it("infers numeric fields as required with a fill rate of 1.0", () => {
    const { contract } = bootstrapContract(params);
    const price = contract.fields.find((f) => f.name === "input_price_usd_per_mtok");
    expect(price?.type).toBe("number");
    expect(price?.required).toBe(true);
  });

  it("marks a partially-filled field as optional rather than required", () => {
    const { contract } = bootstrapContract(params);
    const status = contract.fields.find((f) => f.name === "lifecycle_status");
    // Present on 2 of 3 rows -> below the 0.8 threshold for "required".
    expect(status?.required).toBe(false);
  });

  it("scores as healthy against the exact rows it was bootstrapped from", () => {
    const { contract, rows: normalized } = bootstrapContract(params);
    const report = evaluateRun(contract, normalized);
    expect(report.status).not.toBe("broken");
    expect(report.healRecommended).toBe(false);
  });

  it("refuses to bootstrap from zero rows", () => {
    expect(() => bootstrapContract({ ...params, rows: [] })).toThrow(/zero rows/);
  });
});
