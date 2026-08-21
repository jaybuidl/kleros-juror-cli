import type { Address, PublicClient } from "viem";
import {
  ACCEPTED_DISPUTE_KITS,
  DISPUTE_KIT_ABI,
  KLEROS_CORE,
  KLEROS_CORE_ABI,
  type ResolvedDisputeKit,
} from "./deployment.js";
import { deadlineFor, type PreflightFacts, periodFromIndex, type VoteState } from "./preflight.js";
import { err, type KlerosResult, ok } from "./result.js";

/**
 * viem cannot infer across a multicall batch mixing two ABIs and several argument
 * arities, so the batch is typed loosely here and results are destructured
 * positionally. That is safe because `deployment.test.ts` asserts the pinned
 * fragments -- output names *and* order -- against the deployed ABI, so a change
 * in tuple layout fails a test rather than silently shifting a field.
 */
type MulticallEntry = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

type MulticallOutcome =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

async function multicall(
  client: PublicClient,
  contracts: MulticallEntry[],
): Promise<MulticallOutcome[]> {
  const results = await client.multicall({
    allowFailure: true,
    contracts: contracts as Parameters<typeof client.multicall>[0]["contracts"],
  });
  return results as MulticallOutcome[];
}

export type ReadPreflightParams = {
  client: PublicClient;
  disputeKit: ResolvedDisputeKit;
  dispute: bigint;
  round: bigint;
  voteIds: readonly bigint[];
  juror: Address;
};

/**
 * Read everything `checkPreflight` needs, in two multicall round trips.
 *
 * Two rather than one because the court ID and the kit-local dispute ID are both
 * outputs of the first batch. Batching matters: inside a 1800-second reveal window
 * a dozen sequential round trips is a meaningful fraction of the budget.
 */
export async function readPreflightFacts(
  params: ReadPreflightParams,
): Promise<KlerosResult<PreflightFacts>> {
  const { client, disputeKit, dispute, round, voteIds, juror } = params;
  const core = { address: KLEROS_CORE.address, abi: KLEROS_CORE_ABI } as const;
  const kit = { address: disputeKit.address, abi: DISPUTE_KIT_ABI } as const;

  let first: MulticallOutcome[];
  let block: Awaited<ReturnType<typeof client.getBlock>>;
  try {
    [first, block] = await Promise.all([
      multicall(client, [
        { ...core, functionName: "disputes", args: [dispute] },
        { ...core, functionName: "getNumberOfRounds", args: [dispute] },
        { ...kit, functionName: "coreDisputeIDToActive", args: [dispute] },
        { ...kit, functionName: "coreDisputeIDToLocal", args: [dispute] },
        { ...kit, functionName: "version" },
      ]),
      client.getBlock(),
    ]);
  } catch (cause) {
    return rpcError("Failed to read dispute state.", cause);
  }

  const [disputeResult, roundsResult, activeResult, localResult, versionResult] = first;

  if (disputeResult?.status !== "success") {
    // A Solidity array getter panics rather than reverting readably when the
    // index is out of range, so "does not exist" has to be named here.
    return err(
      "DISPUTE_NOT_FOUND",
      `Dispute ${dispute} could not be read from KlerosCore at ${KLEROS_CORE.address}. ` +
        "Check the dispute ID.",
    );
  }

  const [courtId, , periodIndex, , lastPeriodChange] = disputeResult.result as readonly [
    bigint,
    Address,
    number,
    boolean,
    bigint,
  ];

  const period = periodFromIndex(Number(periodIndex));
  if (!period.success) return period;

  if (localResult?.status !== "success" || activeResult?.status !== "success") {
    return err(
      "NOT_ACTIVE_FOR_KIT",
      `Dispute ${dispute} could not be resolved against dispute kit ${disputeKit.address}. ` +
        "Check --dispute-kit.",
    );
  }

  const localDisputeId = localResult.result as bigint;
  const activeForKit = activeResult.result as boolean;

  let second: MulticallOutcome[];
  try {
    second = await multicall(client, [
      { ...core, functionName: "courts", args: [courtId] },
      { ...core, functionName: "getTimesPerPeriod", args: [courtId] },
      { ...kit, functionName: "disputes", args: [localDisputeId] },
      ...voteIds.map((voteId) => ({
        ...kit,
        functionName: "getVoteInfo",
        args: [dispute, round, voteId],
      })),
    ]);
  } catch (cause) {
    return rpcError("Failed to read court parameters and vote state.", cause);
  }

  const [courtsResult, timesResult, kitDisputeResult, ...voteResults] = second;

  if (courtsResult?.status !== "success" || timesResult?.status !== "success") {
    return err("RPC_ERROR", `Failed to read parameters for court ${courtId}.`);
  }
  if (kitDisputeResult?.status !== "success") {
    return err(
      "RPC_ERROR",
      `Failed to read numberOfChoices for dispute ${dispute} (local ID ${localDisputeId}).`,
    );
  }

  const [, hiddenVotes] = courtsResult.result as readonly [bigint, boolean, ...unknown[]];
  const timesPerPeriod = timesResult.result as readonly bigint[];
  const [numberOfChoices] = kitDisputeResult.result as readonly [bigint, boolean, `0x${string}`];

  const votes: VoteState[] = [];
  for (const [index, voteId] of voteIds.entries()) {
    const result = voteResults[index];
    if (result?.status !== "success") {
      // An out-of-range vote ID panics with 0x32 rather than reverting readably.
      return err(
        "VOTE_ID_OUT_OF_RANGE",
        `Vote ID ${voteId} could not be read for dispute ${dispute} round ${round}. It is ` +
          "probably out of range for that round.",
        { voteId: voteId.toString() },
      );
    }
    const [account, commit, choice, voted] = result.result as readonly [
      Address,
      `0x${string}`,
      bigint,
      boolean,
    ];
    votes.push({ voteId, account, commit, choice, voted });
  }

  let jurorBalanceWei: bigint;
  try {
    jurorBalanceWei = await client.getBalance({ address: juror });
  } catch (cause) {
    return rpcError(`Failed to read the ETH balance of ${juror}.`, cause);
  }

  return ok({
    dispute,
    round,
    courtId,
    period: period.data,
    hiddenVotes,
    deadline: deadlineFor(Number(periodIndex), lastPeriodChange, timesPerPeriod),
    periodDuration: timesPerPeriod[Number(periodIndex)] ?? null,
    now: block.timestamp,
    numberOfChoices,
    numberOfRounds: roundsResult?.status === "success" ? (roundsResult.result as bigint) : 0n,
    activeForKit,
    disputeKitVersion:
      versionResult?.status === "success" ? (versionResult.result as string) : "unknown",
    expectedDisputeKitVersion: disputeKit.expectedVersion,
    votes,
    jurorBalanceWei,
  });
}

/**
 * `03 §9.3`: warn rather than fail. The version guards the revert encoding assumed
 * by `04 §5`, and a mismatch means decoding may degrade -- not that voting is unsafe.
 */
export function versionWarning(facts: PreflightFacts): string | null {
  if (facts.disputeKitVersion === facts.expectedDisputeKitVersion) return null;
  return (
    `Dispute kit reports version ${facts.disputeKitVersion}, expected ` +
    `${facts.expectedDisputeKitVersion}. Revert decoding may be less precise than documented.`
  );
}

export const EXPECTED_KIT_VERSIONS = Object.fromEntries(
  Object.entries(ACCEPTED_DISPUTE_KITS).map(([name, kit]) => [name, kit.expectedVersion]),
);

function rpcError(message: string, cause: unknown): KlerosResult<never> {
  return err("RPC_ERROR", message, {
    cause: cause instanceof Error ? cause.message : String(cause),
  });
}
