import { readFileSync } from "node:fs";
import { type BroadcastResult, simulateAndMaybeBroadcast } from "../core/broadcast.js";
import { hashVote, isEmptyCommitment } from "../core/commitment.js";
import { ARBITRUM_ONE_CHAIN_ID } from "../core/deployment.js";
import { err, type KlerosResult, ok } from "../core/result.js";
import {
  type Prepared,
  type PrepareOptions,
  prepare,
  resolveSalt,
  runPreflight,
} from "./shared.js";

export type WriteOptions = Omit<PrepareOptions, "requireSigner" | "address"> & {
  choice: bigint;
  broadcast: boolean;
  timeoutSeconds: number;
};

export type CommitOptions = WriteOptions & { allowRecommit: boolean };
export type RevealOptions = WriteOptions & { justification: string };

/** `02 §11`: the web frontend enforces this client-side; the contract enforces nothing. */
const SUGGESTED_JUSTIFICATION_LENGTH = 100;

/**
 * `commit` — publish `keccak256(choice, salt)` during the commit period.
 *
 * The salt is derived, used, and discarded. It is never written to disk and never
 * appears in this command's output: printing it during the commit period would
 * defeat the hiding the commitment exists to provide (`03 §6`).
 */
export async function runCommit(
  options: CommitOptions,
): Promise<KlerosResult<Record<string, unknown>>> {
  const prepared = await prepare({ ...options, requireSigner: true });
  if (!prepared.success) return prepared;
  const account = prepared.data.account;
  if (!account) return err("KEY_FILE_MISSING", "A signing key is required to commit.");

  const checked = runPreflight(prepared.data, "commit", options.choice, {
    allowRecommit: options.allowRecommit,
  });
  if (!checked.success) return checked;

  const salt = await resolveSalt(account, prepared.data);
  if (!salt.success) return salt;

  const commitment = hashVote(options.choice, salt.data);
  if (isEmptyCommitment(commitment)) {
    return err("EMPTY_COMMIT", "The computed commitment was zero, which the contract rejects.");
  }

  const outcome = await simulateAndMaybeBroadcast({
    client: prepared.data.client,
    account,
    disputeKit: prepared.data.disputeKit.address,
    call: {
      functionName: "castCommit",
      args: [prepared.data.dispute, prepared.data.voteIds.ids, commitment],
    },
    broadcast: options.broadcast,
    timeoutMs: options.timeoutSeconds * 1_000,
    balanceWei: prepared.data.facts.jurorBalanceWei,
    rpcUrls: prepared.data.rpcUrls,
  });
  if (!outcome.success) return outcome;

  return ok({
    ...envelope("commit", prepared.data, options.choice, outcome.data),
    commit: commitment,
    warnings: [
      ...prepared.data.warnings,
      ...(options.allowRecommit
        ? [
            "Re-committing overwrites the stored commitment but adds to totalCommitted again, " +
              "which can permanently remove this dispute's early exit from the vote period.",
          ]
        : []),
    ],
  });
}

/**
 * `reveal` — publish the choice and salt during the vote period.
 *
 * The salt is recomputed from the key, never read back from anywhere. The derived
 * commitment is compared against the stored one before simulating, which turns an
 * on-chain revert that costs a transaction into a local error that costs nothing
 * and can name the likely cause (`02 §6`).
 */
export async function runReveal(
  options: RevealOptions,
): Promise<KlerosResult<Record<string, unknown>>> {
  const prepared = await prepare({ ...options, requireSigner: true });
  if (!prepared.success) return prepared;
  const account = prepared.data.account;
  if (!account) return err("KEY_FILE_MISSING", "A signing key is required to reveal.");

  const salt = await resolveSalt(account, prepared.data);
  if (!salt.success) return salt;

  const commitment = hashVote(options.choice, salt.data);

  const checked = runPreflight(prepared.data, "reveal", options.choice, {
    expectedCommitment: commitment,
  });
  if (!checked.success) return checked;

  const justification = resolveJustification(options.justification);
  if (!justification.success) return justification;

  const outcome = await simulateAndMaybeBroadcast({
    client: prepared.data.client,
    account,
    disputeKit: prepared.data.disputeKit.address,
    call: {
      functionName: "castVote",
      args: [
        prepared.data.dispute,
        prepared.data.voteIds.ids,
        options.choice,
        salt.data,
        justification.data,
      ],
    },
    broadcast: options.broadcast,
    timeoutMs: options.timeoutSeconds * 1_000,
    balanceWei: prepared.data.facts.jurorBalanceWei,
    rpcUrls: prepared.data.rpcUrls,
  });
  if (!outcome.success) return outcome;

  const trimmed = justification.data.trim();
  return ok({
    ...envelope("reveal", prepared.data, options.choice, outcome.data),
    commit: commitment,
    justificationLength: trimmed.length,
    warnings: [
      ...prepared.data.warnings,
      ...(trimmed.length > 0 && trimmed.length < SUGGESTED_JUSTIFICATION_LENGTH
        ? [
            `The justification is ${trimmed.length} characters. The web frontend suggests at ` +
              `least ${SUGGESTED_JUSTIFICATION_LENGTH}; the contract enforces nothing.`,
          ]
        : []),
    ],
  });
}

/**
 * Shared output shape. `broadcast: false` is stated in words as well as in the
 * field, because a caller that forgets --broadcast must not read this as a vote
 * having been cast (ADR-0004).
 */
function envelope(
  command: "commit" | "reveal",
  prepared: Prepared,
  choice: bigint,
  outcome: BroadcastResult,
): Record<string, unknown> {
  const cast = command === "commit" ? "commitment was published" : "vote was cast";
  const message =
    outcome.status === "simulated"
      ? `SIMULATION ONLY — no transaction was sent and no ${cast}. Re-run with --broadcast to ${
          command === "commit" ? "publish the commitment" : "cast the vote"
        }.`
      : outcome.status === "mined"
        ? `The ${cast}.`
        : outcome.status === "reverted"
          ? `The transaction was mined but reverted; no ${cast}.`
          : `Broadcast succeeded but no receipt arrived before the timeout. The outcome is ` +
            `UNKNOWN — the transaction may still land. Run status before retrying; do not ` +
            `re-send blindly.`;

  return {
    ok: outcome.status === "mined" || outcome.status === "simulated",
    command,
    message,
    chainId: ARBITRUM_ONE_CHAIN_ID,
    disputeKit: prepared.disputeKit.address,
    dispute: prepared.dispute.toString(),
    round: prepared.round.toString(),
    votes: prepared.voteIds.ids.map(String),
    choice: choice.toString(),
    juror: prepared.juror,
    period: prepared.facts.period,
    secondsRemaining:
      prepared.facts.deadline === null
        ? null
        : (prepared.facts.deadline - prepared.facts.now).toString(),
    ...outcome,
  };
}

/** A literal string, `@path` to read a file, or `-` to read stdin (`03 §4`). */
export function resolveJustification(input: string): KlerosResult<string> {
  try {
    if (input === "-") return ok(readFileSync(0, "utf8"));
    if (input.startsWith("@")) return ok(readFileSync(input.slice(1), "utf8"));
    return ok(input);
  } catch (cause) {
    return err("JUSTIFICATION_UNREADABLE", `Could not read the justification from ${input}.`, {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
