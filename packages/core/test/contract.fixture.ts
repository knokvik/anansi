import { Contract } from "../src/contract/schema.js";

/** A minimal but realistic contract used across the health and heal tests. */
export const pricingContract = Contract.parse({
  id: "test-pricing",
  name: "Test pricing",
  collectorId: "c_testcollector01",
  canaries: ["https://example.com/pricing"],
  healBelowScore: 0.8,
  shape: { minRows: 2, maxRowShrinkRatio: 0.5 },
  fields: [
    {
      name: "model_name",
      description: "The display name of the model as shown on the pricing table",
      type: "string",
      required: true,
      minFillRate: 0.9,
    },
    {
      name: "input_price",
      description: "Price in USD to process one million input tokens",
      type: "number",
      required: true,
      minFillRate: 0.9,
      min: 0,
    },
    {
      name: "context_window",
      description: "Maximum context length in tokens, as an integer",
      type: "integer",
      required: false,
      minFillRate: 0.5,
    },
  ],
});
