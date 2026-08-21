import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { hashVote } from "./commitment.js";
import {
  checkPreflight,
  deadlineFor,
  type PreflightFacts,
  type PreflightIntent,
  periodFromIndex,
} from "./preflight.js";

const JUROR = "0x57eb05d4dfFAc43A0C52B42C47a4E7d1838725Ea" as Address;
const STRANGER = "0xD44Ca97a1F1B0C6A1F4a2d21cB0Ee1cF3c1D5e8b" as Address;
const ZERO = `0x${"0".repeat(64)}` as Hex;

const facts = (over: Partial<PreflightFacts> = {}): PreflightFacts => ({
  dispute: 154n,
  round: 0n,
  courtId: 34n,
  period: "commit",
  hiddenVotes: true,
  deadline: 2_000n,
  now: 1_000n,
  numberOfChoices: 2n,
  numberOfRounds: 1n,
  activeForKit: true,
  disputeKitVersion: "0.12.0",
  expectedDisputeKitVersion: "0.12.0",
  votes: [{ voteId: 0n, account: JUROR, commit: ZERO, choice: 0n, voted: false }],
  jurorBalanceWei: 10n ** 16n,
  ...over,
});

const intent = (over: Partial<PreflightIntent> = {}): PreflightIntent => ({
  action: "commit",
  juror: JUROR,
  choice: 1n,
  voteIds: [0n],
  ...over,
});

const codeOf = (result: ReturnType<typeof checkPreflight>): string =>
  result.success ? "OK" : result.code;

describe("checkPreflight — the happy paths", () => {
  it("accepts a commit in the commit period of a hidden-vote court", () => {
    expect(codeOf(checkPreflight(facts(), intent()))).toBe("OK");
  });

  it("accepts a reveal whose derived commitment matches the stored one", () => {
    const commit = hashVote(1n, 42n);
    const result = checkPreflight(
      facts({
        period: "vote",
        votes: [{ voteId: 0n, account: JUROR, commit, choice: 0n, voted: false }],
      }),
      intent({ action: "reveal", expectedCommitment: commit }),
    );
    expect(codeOf(result)).toBe("OK");
  });

  it("accepts a vote in a court without hidden votes", () => {
    const result = checkPreflight(
      facts({ hiddenVotes: false, period: "vote" }),
      intent({ action: "vote" }),
    );
    expect(codeOf(result)).toBe("OK");
  });

  it("accepts choice 0, refuse to arbitrate", () => {
    expect(codeOf(checkPreflight(facts(), intent({ choice: 0n })))).toBe("OK");
  });

  it("accepts choice == numberOfChoices, since the contract bound is inclusive", () => {
    expect(codeOf(checkPreflight(facts(), intent({ choice: 2n })))).toBe("OK");
  });

  it("accepts several vote IDs held by the same juror", () => {
    const votes = [0n, 2n, 4n].map((voteId) => ({
      voteId,
      account: JUROR,
      commit: ZERO,
      choice: 0n,
      voted: false,
    }));
    expect(codeOf(checkPreflight(facts({ votes }), intent({ voteIds: [0n, 2n, 4n] })))).toBe("OK");
  });
});

describe("checkPreflight — never substitute one action for another", () => {
  it("refuses commit in a court without hidden votes", () => {
    const result = checkPreflight(
      facts({ hiddenVotes: false, period: "vote" }),
      intent({ action: "commit" }),
    );
    expect(codeOf(result)).toBe("WRONG_SUBCOMMAND_FOR_COURT");
    if (!result.success) expect(result.message).toContain("never enters a commit period");
  });

  it("refuses vote in a hidden-vote court", () => {
    const result = checkPreflight(facts({ period: "vote" }), intent({ action: "vote" }));
    expect(codeOf(result)).toBe("WRONG_SUBCOMMAND_FOR_COURT");
  });

  it("refuses reveal while still in the commit period, and says so", () => {
    const result = checkPreflight(facts(), intent({ action: "reveal" }));
    expect(codeOf(result)).toBe("WRONG_PERIOD");
    if (!result.success) expect(result.message).toContain("has not opened yet");
  });

  it.each(["evidence", "appeal", "execution"] as const)("refuses commit during %s", (period) => {
    expect(codeOf(checkPreflight(facts({ period }), intent()))).toBe("WRONG_PERIOD");
  });
});

describe("checkPreflight — the irreversible hazards", () => {
  it("refuses to re-commit by default", () => {
    // Each castCommit adds to totalCommitted again; once it exceeds the votes
    // actually held, areVotesAllCast can never become true (`01 §4`).
    const votes = [
      { voteId: 0n, account: JUROR, commit: hashVote(1n, 7n), choice: 0n, voted: false },
    ];
    const result = checkPreflight(facts({ votes }), intent());
    expect(codeOf(result)).toBe("ALREADY_COMMITTED");
    if (!result.success) expect(result.message).toContain("totalCommitted");
  });

  it("allows a re-commit behind the explicit opt-in", () => {
    const votes = [
      { voteId: 0n, account: JUROR, commit: hashVote(1n, 7n), choice: 0n, voted: false },
    ];
    expect(codeOf(checkPreflight(facts({ votes }), intent({ allowRecommit: true })))).toBe("OK");
  });

  it("refuses a reveal whose commitment does not match, before simulating", () => {
    const votes = [
      { voteId: 0n, account: JUROR, commit: hashVote(2n, 7n), choice: 0n, voted: false },
    ];
    const result = checkPreflight(
      facts({ period: "vote", votes }),
      intent({ action: "reveal", expectedCommitment: hashVote(1n, 7n) }),
    );
    expect(codeOf(result)).toBe("COMMITMENT_MISMATCH");
    if (!result.success) expect(JSON.stringify(result.details)).toContain("recover");
  });

  it("refuses a reveal when nothing was committed", () => {
    const result = checkPreflight(
      facts({ period: "vote" }),
      intent({ action: "reveal", expectedCommitment: hashVote(1n, 7n) }),
    );
    expect(codeOf(result)).toBe("NO_COMMITMENT");
  });

  it("refuses a vote already cast", () => {
    const votes = [{ voteId: 0n, account: JUROR, commit: ZERO, choice: 1n, voted: true }];
    expect(
      codeOf(
        checkPreflight(
          facts({ hiddenVotes: false, period: "vote", votes }),
          intent({ action: "vote" }),
        ),
      ),
    ).toBe("ALREADY_VOTED");
  });
});

describe("checkPreflight — ownership, bounds and timing", () => {
  it("refuses a vote ID owned by someone else, naming both addresses", () => {
    const votes = [{ voteId: 0n, account: STRANGER, commit: ZERO, choice: 0n, voted: false }];
    const result = checkPreflight(facts({ votes }), intent());
    expect(codeOf(result)).toBe("VOTE_NOT_OWNED");
    if (!result.success) {
      expect(result.message).toContain(STRANGER);
      expect(result.message).toContain(JUROR);
    }
  });

  it("compares ownership case-insensitively", () => {
    const votes = [
      {
        voteId: 0n,
        account: JUROR.toLowerCase() as Address,
        commit: ZERO,
        choice: 0n,
        voted: false,
      },
    ];
    expect(codeOf(checkPreflight(facts({ votes }), intent()))).toBe("OK");
  });

  it("refuses a choice above numberOfChoices", () => {
    const result = checkPreflight(facts(), intent({ choice: 3n }));
    expect(codeOf(result)).toBe("CHOICE_OUT_OF_BOUNDS");
    if (!result.success) expect(result.message).toContain("refuses to arbitrate");
  });

  it("refuses once the deadline has passed", () => {
    expect(codeOf(checkPreflight(facts({ now: 2_000n }), intent()))).toBe("DEADLINE_PASSED");
  });

  it("refuses a dispute this kit does not handle", () => {
    const result = checkPreflight(facts({ activeForKit: false }), intent());
    expect(codeOf(result)).toBe("NOT_ACTIVE_FOR_KIT");
    if (!result.success) expect(result.message).toContain("--dispute-kit");
  });

  it("refuses when a requested vote ID was never read", () => {
    expect(codeOf(checkPreflight(facts(), intent({ voteIds: [0n, 9n] })))).toBe("VOTE_NOT_READ");
  });
});

describe("period and deadline arithmetic", () => {
  it("maps every period index", () => {
    const names = [0, 1, 2, 3, 4].map((i) => {
      const p = periodFromIndex(i);
      return p.success ? p.data : p.code;
    });
    expect(names).toEqual(["evidence", "commit", "vote", "appeal", "execution"]);
  });

  it("rejects an unknown period index rather than guessing", () => {
    expect(periodFromIndex(5).success).toBe(false);
  });

  it("computes deadline as lastPeriodChange + timesPerPeriod[period]", () => {
    // Court 34: [evidence 2700, commit 2700, vote 1800, appeal 129600].
    const times = [2700n, 2700n, 1800n, 129600n];
    expect(deadlineFor(1, 1_000n, times)).toBe(3_700n);
    expect(deadlineFor(2, 1_000n, times)).toBe(2_800n);
  });

  it("has no deadline in the execution period", () => {
    expect(deadlineFor(4, 1_000n, [2700n, 2700n, 1800n, 129600n])).toBeNull();
  });
});
