import { describe, expect, it } from "vitest";
import { extractRows, findStatus, isAwaitingApproval, parseJsonLoose } from "../src/payload.js";

describe("extractRows", () => {
  const rows = [{ a: 1 }, { a: 2 }];

  it("accepts a bare array of objects", () => {
    expect(extractRows(rows)).toEqual(rows);
  });

  it.each(["data", "rows", "results", "output", "preview_rows"])(
    "unwraps an envelope keyed on %s",
    (key) => {
      expect(extractRows({ [key]: rows, status: "done" })).toEqual(rows);
    },
  );

  it("finds rows nested below an unknown wrapper key", () => {
    expect(extractRows({ result: { payload: { data: rows } } })).toEqual(rows);
  });

  it("distinguishes an empty result from an unreadable one", () => {
    expect(extractRows({ data: [] })).toEqual([]);
    expect(extractRows({ status: "running" })).toBeNull();
    expect(extractRows(null)).toBeNull();
  });

  it("does not mistake an array of strings for rows", () => {
    expect(extractRows({ data: ["a", "b"] })).toBeNull();
  });

  it("unwraps a real bdata Discovery envelope: one page, nested item list", () => {
    // Captured verbatim from `bdata scraper run c_mt59mh6q1omairtns1 <breakroom url>`:
    // a single-element array wrapping one page, with the actual list nested
    // under a field name the client has no way to predict ahead of time.
    const envelope = [
      {
        models: [
          { model_name: "Nimbus Titan", input_price_usd_per_mtok: 15, output_price_usd_per_mtok: 75 },
          { model_name: "Nimbus Vale", input_price_usd_per_mtok: 3, output_price_usd_per_mtok: 15 },
        ],
        product_page_url: "https://knokvik.github.io/anansi/",
        input: { url: "https://knokvik.github.io/anansi/" },
      },
    ];
    expect(extractRows(envelope)).toEqual(envelope[0]!.models);
  });

  it("still treats a genuine single row as one row when it has no nested list", () => {
    expect(extractRows([{ model_name: "Solo Model", price: 9 }])).toEqual([
      { model_name: "Solo Model", price: 9 },
    ]);
  });

  it("strips a trailing truncation marker from a summarized heal preview", () => {
    // Captured from a real `bdata scraper heal` approval-gate preview: a large
    // result gets summarized to a couple of items plus a literal string marker.
    const envelope = [
      {
        models: [
          { model_name: "Nimbus Titan", input_price_usd_per_mtok: 15 },
          { model_name: "Nimbus Vale", input_price_usd_per_mtok: 3 },
          "3 more items",
        ],
        product_page_url: "https://knokvik.github.io/anansi/",
      },
    ];
    expect(extractRows(envelope)).toEqual([
      { model_name: "Nimbus Titan", input_price_usd_per_mtok: 15 },
      { model_name: "Nimbus Vale", input_price_usd_per_mtok: 3 },
    ]);
  });

  it("does not treat an array of only truncation markers as rows", () => {
    expect(extractRows({ data: ["3 more items"] })).toBeNull();
  });
});

describe("status helpers", () => {
  it("reads a nested status", () => {
    expect(findStatus({ job: { status: "awaiting_approval" } })).toBe("awaiting_approval");
  });

  it.each(["awaiting_approval", "awaiting approval", "pending-approval"])(
    "recognises %s as the approval gate",
    (status) => {
      expect(isAwaitingApproval({ status })).toBe(true);
    },
  );

  it("does not treat a finished job as awaiting approval", () => {
    expect(isAwaitingApproval({ status: "done" })).toBe(false);
  });
});

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON surrounded by CLI log noise", () => {
    expect(parseJsonLoose('fetching...\n{"a":1}\ndone')).toEqual({ a: 1 });
  });

  it("returns null when there is no JSON at all", () => {
    expect(parseJsonLoose("Error: no API key found")).toBeNull();
  });
});
