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
