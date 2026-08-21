import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Revert reason to operator guidance — `04 §5`.
 *
 * The deployed implementation reverts with `require` strings, so `Error(string)`
 * is the primary path. Custom error names are mapped too, because the next
 * implementation upgrade replaces the strings with them (`01 §2`) and decoding
 * should keep working without a code change.
 */
const BY_REASON: Record<string, string> = {
  "The dispute should be in Commit period.":
    "The dispute is not in the commit period. Run `status` for the current period and deadline.",
  "The dispute should be in Vote period.":
    "The dispute is not in the vote period. If it is still in commit, the reveal window has not opened yet.",
  "Empty commit.":
    "The computed commitment was zero. That should be unreachable; please report it as a bug.",
  "Not active for core dispute ID":
    "This dispute is not handled by the configured dispute kit. Check --dispute-kit.",
  "The caller has to own the vote.":
    "The signing account does not own one of the vote IDs. Run `status` to see who holds them.",
  "The juror has to own the vote.":
    "The signing account does not own one of the vote IDs. Run `status` to see who holds them.",
  "Choice out of bounds":
    "The choice exceeds numberOfChoices for this dispute. Run `status` for the valid range.",
  "The vote hash must match the commitment in courts with hidden votes.":
    "The revealed choice and salt do not reproduce the stored commitment. The choice, round, vote " +
    "ID set or signing key differs from commit time. Run `recover` to brute-force the committed choice.",
  "Vote already cast.": "This vote has already been revealed. Run `status` to confirm.",
  "Dispute jumped to a parent DK!":
    "The dispute moved to another dispute kit. There is nothing to do on this one.",
  "No voteID provided": "No vote IDs were supplied to the contract.",
};

const BY_CUSTOM_ERROR: Record<string, string> = {
  NotCommitPeriod: BY_REASON["The dispute should be in Commit period."] as string,
  NotVotePeriod: BY_REASON["The dispute should be in Vote period."] as string,
  EmptyCommit: BY_REASON["Empty commit."] as string,
  NotActiveForCoreDisputeID: BY_REASON["Not active for core dispute ID"] as string,
  JurorHasToOwnTheVote: BY_REASON["The juror has to own the vote."] as string,
  ChoiceOutOfBounds: BY_REASON["Choice out of bounds"] as string,
  HashDoesNotMatchHiddenVoteCommitment: BY_REASON[
    "The vote hash must match the commitment in courts with hidden votes."
  ] as string,
  VoteAlreadyCast: BY_REASON["Vote already cast."] as string,
  DisputeJumpedToParentDK: BY_REASON["Dispute jumped to a parent DK!"] as string,
  EmptyVoteIDs: BY_REASON["No voteID provided"] as string,
};

export type DecodedRevert = {
  /** The raw reason string or custom error name, when one could be extracted. */
  reason: string | null;
  /** Actionable guidance, or the raw message when the reason is unrecognised. */
  guidance: string;
};

export function decodeRevert(error: unknown): DecodedRevert {
  if (!(error instanceof BaseError)) {
    return { reason: null, guidance: error instanceof Error ? error.message : String(error) };
  }

  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);

  if (reverted instanceof ContractFunctionRevertedError) {
    const reason = reverted.reason ?? null;
    if (reason && BY_REASON[reason]) {
      return { reason, guidance: BY_REASON[reason] as string };
    }

    const name = reverted.data?.errorName ?? null;
    if (name && BY_CUSTOM_ERROR[name]) {
      return { reason: name, guidance: BY_CUSTOM_ERROR[name] as string };
    }

    if (reason) return { reason, guidance: reason };
    if (name) return { reason: name, guidance: `The contract reverted with ${name}.` };
  }

  // An out-of-range vote ID panics rather than reverting readably (`01 §4`).
  if (error.message.includes("0x32") || error.message.toLowerCase().includes("out-of-bounds")) {
    return {
      reason: "panic 0x32",
      guidance: "A vote ID is out of range for this dispute round.",
    };
  }

  return { reason: null, guidance: error.shortMessage || error.message };
}
