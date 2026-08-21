import { describe, expect, it } from "vitest";
import { canonicaliseVoteIds } from "./vote-ids.js";

/** Properties required by `05 §1.3`. */
describe("canonicaliseVoteIds", () => {
  const csv = (input: Parameters<typeof canonicaliseVoteIds>[0]): string => {
    const result = canonicaliseVoteIds(input);
    if (!result.success) throw new Error(`unexpected failure: ${result.code}`);
    return result.data.csv;
  };

  it("sorts numerically, not lexicographically", () => {
    // The whole invariant in one assertion: lexicographic order puts 10 before 9
    // and produces a salt that cannot be reproduced at reveal time.
    expect(csv("9,10")).toBe("9,10");
    expect(csv("10,9")).toBe("9,10");
    expect(csv([2, 10, 1])).toBe("1,2,10");
  });

  it("is invariant under permutation", () => {
    expect(csv("7,5,6")).toBe(csv("5,6,7"));
    expect(csv("6,7,5")).toBe(csv("5,6,7"));
  });

  it("is invariant under duplication", () => {
    // Vector S2 from `02 §9`.
    expect(csv("7,5,6,5")).toBe("5,6,7");
  });

  it("changes when an element is added", () => {
    expect(csv("5,6,7")).not.toBe(csv("5,6,7,8"));
  });

  it("keeps the ids and the csv in agreement", () => {
    const result = canonicaliseVoteIds("7,5,6,5");
    if (!result.success) throw new Error("unexpected failure");
    expect(result.data.ids).toEqual([5n, 6n, 7n]);
    expect(result.data.ids.join(",")).toBe(result.data.csv);
  });

  it("tolerates surrounding whitespace without changing meaning", () => {
    expect(csv(" 5 , 6,7 ")).toBe("5,6,7");
  });

  it("sorts correctly above Number.MAX_SAFE_INTEGER", () => {
    const big = 2n ** 60n;
    expect(csv([big + 1n, big])).toBe(`${big},${big + 1n}`);
  });

  it.each([
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["hex", "0x5"],
    ["exponent", "1e3"],
    ["signed", "+5"],
    ["non-numeric", "five"],
    ["blank element", "5,,6"],
  ])("rejects %s input", (_label, input) => {
    const result = canonicaliseVoteIds(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("INVALID_VOTE_ID");
  });

  it("rejects an empty list", () => {
    // castCommit accepts an empty array and silently does nothing (`01 §4`).
    for (const input of ["", []] as const) {
      const result = canonicaliseVoteIds(input);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe("EMPTY_VOTE_IDS");
    }
  });
});
