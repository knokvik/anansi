import { describe, expect, it } from "vitest";
import { evaluateRun } from "../src/health/evaluate.js";
import { judgeHeal } from "../src/heal/gate.js";
import { HEAL_PROMPT_LIMIT, synthesizeHealPlan } from "../src/heal/prompt.js";
import { pricingContract } from "./contract.fixture.js";

const brokenRows = [
  { model_name: "Opus", input_price: "undefined", context_window: 200000 },
  { model_name: "Sonnet", input_price: "undefined", context_window: 200000 },
  { model_name: "Haiku", input_price: "undefined", context_window: 200000 },
];

const repairedRows = [
  { model_name: "Opus", input_price: "$15.00", context_window: 200000 },
  { model_name: "Sonnet", input_price: "$3.00", context_window: 200000 },
  { model_name: "Haiku", input_price: "$0.80", context_window: 200000 },
];

describe("synthesizeHealPlan", () => {
  it("names the broken field and restates its contract description", () => {
    const report = evaluateRun(pricingContract, brokenRows);
    const plan = synthesizeHealPlan(pricingContract, report);

    expect(plan.targetedFields).toContain("input_price");
    expect(plan.prompt).toContain("input_price");
    expect(plan.prompt).toContain("Price in USD to process one million input tokens");
  });

  it("tells the healer to preserve fields that still work", () => {
    const report = evaluateRun(pricingContract, brokenRows);
    const plan = synthesizeHealPlan(pricingContract, report);

    expect(plan.preservedFields).toEqual(expect.arrayContaining(["model_name", "context_window"]));
    expect(plan.prompt).toContain("Leave these already-working fields exactly as they are");
  });

  it("carries shape symptoms into the prompt", () => {
    const report = evaluateRun(pricingContract, brokenRows, { baselineRowCount: 40 });
    const plan = synthesizeHealPlan(pricingContract, report);
    expect(plan.prompt).toContain("Row count fell from 40 to 3");
  });

  it("never exceeds the CLI prompt limit, even with many broken fields", () => {
    const rows = [{}, {}, {}];
    const report = evaluateRun(pricingContract, rows);
    const plan = synthesizeHealPlan(pricingContract, report);
    expect(plan.prompt.length).toBeLessThanOrEqual(HEAL_PROMPT_LIMIT);
  });
});

describe("judgeHeal", () => {
  const before = evaluateRun(pricingContract, brokenRows);
  const plan = synthesizeHealPlan(pricingContract, before);

  it("approves a heal whose preview satisfies the contract", () => {
    const verdict = judgeHeal({
      contract: pricingContract,
      before,
      previewRows: repairedRows,
      targetedFields: plan.targetedFields,
    });
    expect(verdict.decision).toBe("approve");
    expect(verdict.previewReport?.status).toBe("healthy");
  });

  it("rejects a heal that returns no preview to verify", () => {
    const verdict = judgeHeal({
      contract: pricingContract,
      before,
      previewRows: null,
      targetedFields: plan.targetedFields,
    });
    expect(verdict.decision).toBe("reject");
    expect(verdict.reason).toContain("no preview rows");
  });

  it("rejects a heal that claims success but leaves the field empty", () => {
    const verdict = judgeHeal({
      contract: pricingContract,
      before,
      previewRows: brokenRows,
      targetedFields: plan.targetedFields,
    });
    expect(verdict.decision).toBe("reject");
    expect(verdict.reason).toContain("did not repair");
  });

  it("rejects a heal that fixes its target but breaks a healthy field", () => {
    const collateral = repairedRows.map((row) => ({ ...row, model_name: null }));
    const verdict = judgeHeal({
      contract: pricingContract,
      before,
      previewRows: collateral,
      targetedFields: plan.targetedFields,
    });
    expect(verdict.decision).toBe("reject");
    expect(verdict.reason).toContain("broke previously healthy field");
    expect(verdict.reason).toContain("model_name");
  });

  it("approves a correct fix even when the preview itself was truncated to fewer rows than the contract requires", () => {
    // Real Bright Data behaviour: a heal's approval-gate preview is a
    // summarized sanity check and can come back shorter than a full run
    // (observed: 5 rows summarized to 2). The contract here requires
    // shape.minRows: 2 — pass exactly one row, correct in every field, and
    // confirm the gate judges it on correctness, not on looking short.
    const verdict = judgeHeal({
      contract: pricingContract,
      before,
      previewRows: [repairedRows[0]!],
      targetedFields: plan.targetedFields,
    });
    expect(verdict.decision).toBe("approve");
  });
});
