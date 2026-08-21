import { z } from "incur";
import type { Address, PrivateKeyAccount, PublicClient } from "viem";
import { assertArbitrumOne, createKlerosClient, parseRpcUrls } from "../core/client.js";
import { type ResolvedDisputeKit, resolveDisputeKit } from "../core/deployment.js";
import { checkPreflight, type PreflightFacts, type VoteAction } from "../core/preflight.js";
import { readPreflightFacts, versionWarning } from "../core/read-preflight.js";
import { err, type KlerosResult, ok } from "../core/result.js";
import { deriveSalt } from "../core/salt.js";
import { deriveSeedFromSigner, SEED_ENV_VAR, seedFromEnv } from "../core/seed.js";
import { keyFilePath, loadSigner, resolveHome } from "../core/signer.js";
import { type CanonicalVoteIds, canonicaliseVoteIds } from "../core/vote-ids.js";

/**
 * Exit codes are stable for shell callers (`03 §5`), but they are not the machine
 * contract: the agent consuming this sees an effectively binary exit status, so the
 * `code` field in the payload is what it must branch on. See CLAUDE.md.
 */
const EXIT_CODES: Record<string, number> = {
  INVALID_VOTE_ID: 1,
  EMPTY_VOTE_IDS: 1,
  UNKNOWN_DISPUTE_KIT: 1,
  INVALID_NUMBER: 1,
  KEY_FILE_MISSING: 2,
  KEY_FILE_PERMISSIONS: 2,
  KEY_FILE_UNREADABLE: 2,
  KEY_FILE_INVALID: 2,
  INVALID_SEED: 2,
  SIGNER_NOT_DETERMINISTIC: 2,
  WRONG_CHAIN: 2,
  SHUTTER_DISPUTE_KIT: 2,
  INSUFFICIENT_BALANCE: 2,
  DISPUTE_NOT_FOUND: 3,
  NOT_ACTIVE_FOR_KIT: 3,
  WRONG_SUBCOMMAND_FOR_COURT: 3,
  WRONG_PERIOD: 3,
  DEADLINE_PASSED: 3,
  CHOICE_OUT_OF_BOUNDS: 3,
  VOTE_NOT_OWNED: 3,
  VOTE_NOT_READ: 3,
  VOTE_ID_OUT_OF_RANGE: 3,
  ALREADY_VOTED: 3,
  ALREADY_COMMITTED: 3,
  NO_COMMITMENT: 3,
  COMMITMENT_MISMATCH: 3,
  UNKNOWN_PERIOD: 3,
  SIMULATION_REVERTED: 4,
  BROADCAST_FAILED: 5,
  RPC_ERROR: 7,
};

export function exitCodeFor(code: string): number {
  return EXIT_CODES[code] ?? 1;
}

export const chainOptions = {
  "dispute-kit": z
    .string()
    .default("classic")
    .describe('Dispute kit: "classic", "gated", or an address. Shutter kits are refused.'),
  "rpc-url": z
    .string()
    .optional()
    .describe("Arbitrum One RPC URL. Comma-separated for automatic fallback."),
  home: z
    .string()
    .optional()
    .describe("Directory holding the signing key. Defaults to ~/.kleros-juror."),
};

export const voteSelectionOptions = {
  dispute: z.string().describe("Core dispute ID, as reported by `kleros juror draws`."),
  round: z.string().default("0").describe("Zero-based appeal round index."),
  votes: z
    .string()
    .describe(
      "Comma-separated vote IDs held in this round, e.g. 5,6,7. Order and duplicates do not matter.",
    ),
};

export const writeOptions = {
  broadcast: z
    .boolean()
    .default(false)
    .describe("Actually send the transaction. Without this, the command simulates and stops."),
  timeout: z
    .string()
    .default("120")
    .describe("Seconds to wait for a receipt before reporting the outcome as unknown."),
};

export function parseBigInt(label: string, value: string): KlerosResult<bigint> {
  const text = value.trim();
  if (!/^\d+$/.test(text)) {
    return err("INVALID_NUMBER", `--${label} must be a non-negative integer; got "${value}".`);
  }
  return ok(BigInt(text));
}

export type PrepareOptions = {
  disputeKit: string;
  rpcUrl?: string | undefined;
  home?: string | undefined;
  dispute: string;
  round: string;
  votes: string;
  /** `status` can run without a key; the write commands cannot. */
  requireSigner: boolean;
  /** Reported as owner-of-record when no key is loaded. */
  address?: string | undefined;
};

export type LocallyPrepared = {
  disputeKit: ResolvedDisputeKit;
  dispute: bigint;
  round: bigint;
  voteIds: CanonicalVoteIds;
  account: PrivateKeyAccount | null;
};

/**
 * Argument resolution and key loading, with no network access at all. `salt` and
 * `recover` need nothing more, so they keep working when the RPC does not.
 */
export function prepareLocal(
  options: Pick<PrepareOptions, "disputeKit" | "dispute" | "round" | "votes" | "home"> & {
    requireSigner: boolean;
  },
): KlerosResult<LocallyPrepared> {
  const disputeKit = resolveDisputeKit(options.disputeKit);
  if (!disputeKit.success) return disputeKit;

  const dispute = parseBigInt("dispute", options.dispute);
  if (!dispute.success) return dispute;

  const round = parseBigInt("round", options.round);
  if (!round.success) return round;

  const voteIds = canonicaliseVoteIds(options.votes);
  if (!voteIds.success) return voteIds;

  const signer = loadSigner(resolveHome(options.home));
  if (!signer.success && options.requireSigner) return signer;

  return ok({
    disputeKit: disputeKit.data,
    dispute: dispute.data,
    round: round.data,
    voteIds: voteIds.data,
    account: signer.success ? signer.data : null,
  });
}

export type Prepared = {
  client: PublicClient;
  rpcUrls: string[];
  disputeKit: ResolvedDisputeKit;
  dispute: bigint;
  round: bigint;
  voteIds: CanonicalVoteIds;
  juror: Address;
  account: PrivateKeyAccount | null;
  facts: PreflightFacts;
  warnings: string[];
};

/**
 * Everything every command does before it can act: resolve the chain, the kit and
 * the vote IDs, load the signer, and read the dispute. Ordered so the cheapest and
 * most-likely-wrong checks fail first.
 */
export async function prepare(options: PrepareOptions): Promise<KlerosResult<Prepared>> {
  const warnings: string[] = [];

  const local = prepareLocal(options);
  if (!local.success) return local;
  const { disputeKit: kitData, dispute, round, voteIds, account } = local.data;

  const rpcUrls = parseRpcUrls(options.rpcUrl ?? process.env.ARBITRUM_RPC);
  const client = createKlerosClient(rpcUrls);

  const chain = await assertArbitrumOne(client);
  if (!chain.success) return chain;

  const juror = (account?.address ?? options.address) as Address | undefined;
  if (!juror) {
    return err(
      "KEY_FILE_MISSING",
      "No signing key and no --address, so there is no juror to report on.",
      { hint: `Pass --address to inspect a dispute without a key: ${keyFilePath()} is absent.` },
    );
  }

  const facts = await readPreflightFacts({
    client,
    disputeKit: kitData,
    dispute,
    round,
    voteIds: voteIds.ids,
    juror,
  });
  if (!facts.success) return facts;

  const preflightFacts = facts.data;
  const versionMismatch = versionWarning(preflightFacts);
  if (versionMismatch) warnings.push(versionMismatch);
  warnings.push(...deadlineWarnings(preflightFacts));

  return ok({
    client,
    rpcUrls,
    disputeKit: kitData,
    dispute,
    round,
    voteIds,
    juror,
    account,
    facts: preflightFacts,
    warnings,
  });
}

/** `04 §4`: the nominal deadline is an upper bound, not an entitlement. */
export function deadlineWarnings(facts: PreflightFacts): string[] {
  const warnings: string[] = [];
  if (facts.deadline === null) return warnings;

  const remaining = facts.deadline - facts.now;
  const duration = facts.periodDuration;
  // `04 §4`: warn under 10% of the window, or under two minutes, whichever bites first.
  const nearlyOver = remaining < 120n || (duration !== null && remaining * 10n < duration);
  if (remaining > 0n && nearlyOver) {
    warnings.push(`Only ${remaining} seconds remain in the ${facts.period} period.`);
  }

  if (facts.period === "commit") {
    warnings.push(
      "The commit deadline is an upper bound, not an entitlement: the period ends early once " +
        "every drawn juror has committed, and passPeriod is permissionless.",
    );
  }
  if (facts.period === "vote") {
    warnings.push(
      "The reveal deadline is an upper bound, not an entitlement: the period ends early once " +
        "every juror who committed has revealed, and passPeriod is permissionless.",
    );
  }
  return warnings;
}

/** Resolve the seed, then the salt for exactly this vote. Never logged, never stored. */
export async function resolveSalt(
  account: PrivateKeyAccount,
  prepared: LocallyPrepared | Prepared,
): Promise<KlerosResult<bigint>> {
  const explicit = process.env[SEED_ENV_VAR];
  const seed = explicit
    ? seedFromEnv(explicit)
    : await deriveSeedFromSigner((message) => account.signMessage({ message }));
  if (!seed.success) return seed;

  return ok(
    deriveSalt(seed.data, {
      chainId: 42161,
      disputeKit: prepared.disputeKit.address,
      dispute: prepared.dispute,
      round: prepared.round,
      voteIdsCsv: prepared.voteIds.csv,
    }),
  );
}

export function runPreflight(
  prepared: Prepared,
  action: VoteAction,
  choice: bigint,
  extra: { expectedCommitment?: `0x${string}`; allowRecommit?: boolean } = {},
): KlerosResult<PreflightFacts> {
  return checkPreflight(prepared.facts, {
    action,
    juror: prepared.juror,
    choice,
    voteIds: prepared.voteIds.ids,
    ...extra,
  });
}

export function describeVotes(prepared: Prepared) {
  return prepared.facts.votes.map((vote) => ({
    voteId: vote.voteId.toString(),
    account: vote.account,
    isMine: vote.account.toLowerCase() === prepared.juror.toLowerCase(),
    hasCommitment: !/^0x0{64}$/.test(vote.commit),
    voted: vote.voted,
  }));
}
