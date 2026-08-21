import type { Address, Hex } from "viem";
import { hashVote } from "./commitment.js";
import { PERIODS, type Period } from "./deployment.js";
import { err, type KlerosResult, ok } from "./result.js";

/** The three write actions. Never inferred, never substituted (`03 §2`). */
export type VoteAction = "commit" | "reveal" | "vote";

/** The period each action requires. */
const REQUIRED_PERIOD: Record<VoteAction, Period> = {
  commit: "commit",
  reveal: "vote",
  vote: "vote",
};

/** Whether the action belongs to a hidden-vote court. */
const REQUIRES_HIDDEN_VOTES: Record<VoteAction, boolean> = {
  commit: true,
  reveal: true,
  vote: false,
};

export type VoteState = {
  voteId: bigint;
  account: Address;
  commit: Hex;
  choice: bigint;
  voted: boolean;
};

/** Everything read from chain, with no judgement applied. */
export type PreflightFacts = {
  dispute: bigint;
  round: bigint;
  courtId: bigint;
  period: Period;
  hiddenVotes: boolean;
  /** `lastPeriodChange + timesPerPeriod[period]`, or null in `execution` (`01 §7`). */
  deadline: bigint | null;
  /** `timesPerPeriod[period]`, the nominal window length. Null in `execution`. */
  periodDuration: bigint | null;
  now: bigint;
  numberOfChoices: bigint;
  numberOfRounds: bigint;
  activeForKit: boolean;
  disputeKitVersion: string;
  expectedDisputeKitVersion: string;
  votes: VoteState[];
  jurorBalanceWei: bigint;
};

export type PreflightIntent = {
  action: VoteAction;
  juror: Address;
  choice: bigint;
  voteIds: bigint[];
  /** Only meaningful for `reveal`: the commitment the local salt reproduces. */
  expectedCommitment?: Hex;
  /** `01 §4`: re-committing is legal on chain but distorts `totalCommitted`. */
  allowRecommit?: boolean;
};

const ZERO_COMMITMENT = `0x${"0".repeat(64)}` as const;

export function periodFromIndex(index: number): KlerosResult<Period> {
  const period = PERIODS[index];
  if (!period) return err("UNKNOWN_PERIOD", `Unknown period index ${index}.`);
  return ok(period);
}

export function deadlineFor(
  periodIndex: number,
  lastPeriodChange: bigint,
  timesPerPeriod: readonly bigint[],
): bigint | null {
  // timesPerPeriod covers evidence..appeal only; `execution` has no deadline.
  const duration = timesPerPeriod[periodIndex];
  return duration === undefined ? null : lastPeriodChange + duration;
}

/**
 * Every rejection that can be decided from chain state, applied before a fee is
 * paid. Pure on purpose: this is the safety logic, and it should be exhaustively
 * testable without a network (`04 §3`).
 *
 * Deliberately not covered: a well-formed vote for the wrong choice. Nothing on
 * chain contradicts it. See ADR-0004.
 */
export function checkPreflight(
  facts: PreflightFacts,
  intent: PreflightIntent,
): KlerosResult<PreflightFacts> {
  const { action } = intent;

  if (!facts.activeForKit) {
    return err(
      "NOT_ACTIVE_FOR_KIT",
      `Dispute ${facts.dispute} is not handled by this dispute kit. Check --dispute-kit.`,
    );
  }

  // Checked before the period, because "you picked the wrong subcommand" is a
  // more useful diagnosis than "wrong period" when the court never has one.
  if (facts.hiddenVotes !== REQUIRES_HIDDEN_VOTES[action]) {
    return err(
      "WRONG_SUBCOMMAND_FOR_COURT",
      facts.hiddenVotes
        ? `Court ${facts.courtId} has hidden votes, so this dispute needs "commit" then ` +
            `"reveal". "vote" is for courts without hidden votes.`
        : `Court ${facts.courtId} does not have hidden votes, so it never enters a commit ` +
            `period. Use "vote", which casts the choice in a single call.`,
      { hiddenVotes: facts.hiddenVotes, action },
    );
  }

  const required = REQUIRED_PERIOD[action];
  if (facts.period !== required) {
    return err(
      "WRONG_PERIOD",
      `Dispute ${facts.dispute} is in the ${facts.period} period; "${action}" requires the ` +
        `${required} period.` +
        (facts.period === "commit" && required === "vote"
          ? " The reveal window has not opened yet."
          : ""),
      { period: facts.period, required, deadline: facts.deadline?.toString() ?? null },
    );
  }

  if (facts.deadline !== null && facts.now >= facts.deadline) {
    return err(
      "DEADLINE_PASSED",
      `The ${facts.period} period for dispute ${facts.dispute} closed at ${facts.deadline}.`,
      { deadline: facts.deadline.toString(), now: facts.now.toString() },
    );
  }

  // `01 §4`: the bound is inclusive, and 0 (refuse to arbitrate) is always valid.
  if (intent.choice > facts.numberOfChoices) {
    return err(
      "CHOICE_OUT_OF_BOUNDS",
      `Choice ${intent.choice} exceeds numberOfChoices (${facts.numberOfChoices}) for dispute ` +
        `${facts.dispute}. Valid choices are 0..${facts.numberOfChoices}, where 0 refuses to arbitrate.`,
      { choice: intent.choice.toString(), numberOfChoices: facts.numberOfChoices.toString() },
    );
  }

  const byId = new Map(facts.votes.map((vote) => [vote.voteId, vote]));
  const juror = intent.juror.toLowerCase();

  for (const voteId of intent.voteIds) {
    const vote = byId.get(voteId);
    if (!vote) {
      return err("VOTE_NOT_READ", `No vote information was read for vote ID ${voteId}.`);
    }

    if (vote.account.toLowerCase() !== juror) {
      return err(
        "VOTE_NOT_OWNED",
        `Vote ID ${voteId} belongs to ${vote.account}, not ${intent.juror}. The account that ` +
          "owns a vote must be the account that sends the transaction.",
        { voteId: voteId.toString(), owner: vote.account, signer: intent.juror },
      );
    }

    if (vote.voted) {
      return err(
        "ALREADY_VOTED",
        `Vote ID ${voteId} has already been cast, for choice ${vote.choice}.`,
        { voteId: voteId.toString(), choice: vote.choice.toString() },
      );
    }

    if (action === "commit" && vote.commit !== ZERO_COMMITMENT && !intent.allowRecommit) {
      return err(
        "ALREADY_COMMITTED",
        `Vote ID ${voteId} already carries commitment ${vote.commit}. Re-committing overwrites ` +
          "it, but each call adds to totalCommitted again, which can permanently remove the " +
          "vote period's early exit for this dispute. Pass --allow-recommit to proceed anyway.",
        { voteId: voteId.toString(), commit: vote.commit },
      );
    }

    if (action === "reveal") {
      if (vote.commit === ZERO_COMMITMENT) {
        return err(
          "NO_COMMITMENT",
          `Vote ID ${voteId} has no commitment recorded, so there is nothing to reveal.`,
          { voteId: voteId.toString() },
        );
      }

      if (intent.expectedCommitment && vote.commit !== intent.expectedCommitment) {
        // Converts an on-chain revert that costs a transaction into a local error
        // that costs nothing and can name the likely cause (`02 §6`).
        return err(
          "COMMITMENT_MISMATCH",
          `Derived commitment ${intent.expectedCommitment} does not match the stored commitment ` +
            `${vote.commit} for vote ID ${voteId}. The choice, round, vote ID set or signing key ` +
            "is not the one used at commit time.",
          {
            voteId: voteId.toString(),
            derived: intent.expectedCommitment,
            stored: vote.commit,
            hint: "run `kleros-juror recover` to brute-force the committed choice",
          },
        );
      }
    }
  }

  return ok(facts);
}

/** Recompute what `reveal` should match, so the caller cannot pass the wrong thing. */
export function expectedCommitmentFor(choice: bigint, salt: bigint): Hex {
  return hashVote(choice, salt);
}
