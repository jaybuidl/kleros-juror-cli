import { hashVote } from "../core/commitment.js";
import { type KlerosResult, ok } from "../core/result.js";
import {
  describeVotes,
  type Prepared,
  type PrepareOptions,
  prepare,
  prepareLocal,
  resolveSalt,
} from "./shared.js";

export type LocalOptions = Pick<
  PrepareOptions,
  "disputeKit" | "dispute" | "round" | "votes" | "home"
>;

/**
 * Read-only view of where a dispute stands and what this juror still owes it.
 *
 * `actionRequired` is derived here from chain state rather than taken from an
 * upstream hint -- the same reason pre-flight re-derives it (`03 §2`).
 */
export async function runStatus(
  options: Omit<PrepareOptions, "requireSigner">,
): Promise<KlerosResult<Record<string, unknown>>> {
  const prepared = await prepare({ ...options, requireSigner: false });
  if (!prepared.success) return prepared;
  return ok(shapeStatus(prepared.data));
}

function shapeStatus(prepared: Prepared): Record<string, unknown> {
  const { facts } = prepared;
  const isMine = (account: string) => account.toLowerCase() === prepared.juror.toLowerCase();
  const mine = facts.votes.filter((vote) => isMine(vote.account));
  const committed = mine.filter((vote) => !/^0x0{64}$/.test(vote.commit));
  const voted = mine.filter((vote) => vote.voted);

  let actionRequired: "none" | "commit" | "reveal" | "vote" = "none";
  if (mine.length > 0 && voted.length < mine.length) {
    if (facts.period === "commit" && facts.hiddenVotes && committed.length < mine.length) {
      actionRequired = "commit";
    } else if (facts.period === "vote") {
      actionRequired = facts.hiddenVotes ? "reveal" : "vote";
    }
  }

  return {
    ok: true,
    command: "status",
    chainId: 42161,
    disputeKit: prepared.disputeKit.address,
    disputeKitVersion: facts.disputeKitVersion,
    dispute: facts.dispute.toString(),
    round: facts.round.toString(),
    court: facts.courtId.toString(),
    period: facts.period,
    hiddenVotes: facts.hiddenVotes,
    deadline: facts.deadline?.toString() ?? null,
    secondsRemaining: facts.deadline === null ? null : (facts.deadline - facts.now).toString(),
    numberOfChoices: facts.numberOfChoices.toString(),
    numberOfRounds: facts.numberOfRounds.toString(),
    juror: prepared.juror,
    jurorBalanceWei: facts.jurorBalanceWei.toString(),
    myVoteIds: mine.map((vote) => vote.voteId.toString()),
    actionRequired,
    votes: describeVotes(prepared),
    warnings: prepared.warnings,
  };
}

/**
 * `salt` — derive the salt and the commitment it produces. Entirely local: it needs
 * the signing key, because the seed comes from it (ADR-0003), but no RPC at all.
 */
export async function runSalt(
  options: LocalOptions,
  choice: bigint,
): Promise<KlerosResult<Record<string, unknown>>> {
  const local = prepareLocal({ ...options, requireSigner: true });
  if (!local.success) return local;

  const account = local.data.account;
  if (!account) return local as never;

  const salt = await resolveSalt(account, local.data);
  if (!salt.success) return salt;

  return ok({
    ok: true,
    command: "salt",
    disputeKit: local.data.disputeKit.address,
    dispute: local.data.dispute.toString(),
    round: local.data.round.toString(),
    votes: local.data.voteIds.ids.map(String),
    choice: choice.toString(),
    // Permitted in `salt` output, unlike `commit` output, per `03 §6`.
    salt: `0x${salt.data.toString(16).padStart(64, "0")}`,
    commit: hashVote(choice, salt.data),
  });
}
