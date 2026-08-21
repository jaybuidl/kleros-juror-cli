import type { Address, Hex, PrivateKeyAccount, PublicClient } from "viem";
import { createWalletClient, formatEther, http } from "viem";
import { arbitrum } from "viem/chains";
import { DISPUTE_KIT_ABI } from "./deployment.js";
import { err, type KlerosResult, ok } from "./result.js";
import { decodeRevert } from "./reverts.js";

/** The gas buffer every bot in the Kleros repo uses (`04 §3.2`). */
const GAS_BUFFER_NUMERATOR = 150n;
const GAS_BUFFER_DENOMINATOR = 100n;

/**
 * A generous cap costs nothing: on Arbitrum the sender is charged the base fee
 * regardless of the cap, and tips are ignored entirely (`04 §1.2`). The cap only
 * matters as protection against a base fee that has risen since estimation.
 */
const MAX_FEE_MULTIPLIER = 3n;

export type WriteCall =
  | { functionName: "castCommit"; args: readonly [bigint, readonly bigint[], Hex] }
  | {
      functionName: "castVote";
      args: readonly [bigint, readonly bigint[], bigint, bigint, string];
    };

export type BroadcastParams = {
  client: PublicClient;
  account: PrivateKeyAccount;
  disputeKit: Address;
  call: WriteCall;
  /** False means plan, simulate and stop. The default (ADR-0004). */
  broadcast: boolean;
  timeoutMs: number;
  balanceWei: bigint;
  maxFeePerGas?: bigint;
  rpcUrls: readonly string[];
};

export type FeePlan = {
  gas: string;
  maxFeePerGas: string;
  estimatedFeeWei: string;
  estimatedFeeEth: string;
};

export type BroadcastResult =
  | ({ status: "simulated"; broadcast: false } & FeePlan)
  | ({
      status: "mined";
      broadcast: true;
      txHash: Hex;
      blockNumber: string;
      gasUsed: string;
      effectiveGasPrice: string;
    } & FeePlan)
  | ({
      status: "reverted";
      broadcast: true;
      txHash: Hex;
      blockNumber: string;
      gasUsed: string;
    } & FeePlan)
  | ({ status: "unknown"; broadcast: true; txHash: Hex } & FeePlan);

/**
 * Simulate, price, and optionally send one state-changing call.
 *
 * Simulation is unconditional: it is an eth_call against current state, it costs
 * nothing, and it catches every condition in `01 §4` before a fee is paid (`04 §3.1`).
 * It is necessary but not sufficient -- the period can advance between the
 * simulation and inclusion -- so a post-broadcast revert is reported as a normal
 * outcome rather than an internal error.
 */
export async function simulateAndMaybeBroadcast(
  params: BroadcastParams,
): Promise<KlerosResult<BroadcastResult>> {
  const { client, account, disputeKit, call, balanceWei } = params;
  const contract = { address: disputeKit, abi: DISPUTE_KIT_ABI } as const;

  try {
    await client.simulateContract({
      ...contract,
      functionName: call.functionName,
      args: call.args as never,
      account,
    });
  } catch (cause) {
    const { reason, guidance } = decodeRevert(cause);
    return err("SIMULATION_REVERTED", guidance, { reason, broadcast: false });
  }

  let gas: bigint;
  let maxFeePerGas: bigint;
  try {
    const [estimated, fees] = await Promise.all([
      client.estimateContractGas({
        ...contract,
        functionName: call.functionName,
        args: call.args as never,
        account,
      }),
      client.estimateFeesPerGas(),
    ]);
    gas = (estimated * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
    maxFeePerGas = params.maxFeePerGas ?? fees.maxFeePerGas * MAX_FEE_MULTIPLIER;
  } catch (cause) {
    return err("RPC_ERROR", "Failed to estimate gas or fees.", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const estimatedFeeWei = gas * maxFeePerGas;
  const plan: FeePlan = {
    gas: gas.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    estimatedFeeWei: estimatedFeeWei.toString(),
    estimatedFeeEth: formatEther(estimatedFeeWei),
  };

  if (balanceWei < estimatedFeeWei) {
    // Discovered here rather than at broadcast time (`04 §1.1`).
    return err(
      "INSUFFICIENT_BALANCE",
      `${account.address} holds ${formatEther(balanceWei)} ETH on Arbitrum One, below the ` +
        `${plan.estimatedFeeEth} ETH needed to cover this transaction at the fee cap.`,
      { balanceWei: balanceWei.toString(), ...plan },
    );
  }

  if (!params.broadcast) {
    return ok({ status: "simulated", broadcast: false, ...plan });
  }

  const wallet = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(params.rpcUrls[0]),
  });

  let txHash: Hex;
  try {
    txHash = await wallet.writeContract({
      ...contract,
      functionName: call.functionName,
      args: call.args as never,
      gas,
      maxFeePerGas,
      // Tips are ignored on Arbitrum; zero states that plainly (`04 §1.2`).
      maxPriorityFeePerGas: 0n,
    });
  } catch (cause) {
    const { reason, guidance } = decodeRevert(cause);
    return err("BROADCAST_FAILED", guidance, { reason, broadcast: false });
  }

  const receipt = await waitBounded(client, txHash, params.timeoutMs);

  if (receipt === "timeout") {
    // Not a failure: the CLI stopped watching. Retrying blindly risks a duplicate
    // submission, and for castCommit a duplicate inflates totalCommitted (`04 §3.6`).
    return ok({ status: "unknown", broadcast: true, txHash, ...plan });
  }

  if (receipt.status === "reverted") {
    return ok({
      status: "reverted",
      broadcast: true,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      ...plan,
    });
  }

  return ok({
    status: "mined",
    broadcast: true,
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    ...plan,
  });
}

/**
 * `waitForTransactionReceipt` with an independent deadline on top of its own.
 *
 * There are open reports of it never settling when a hash is never found, and of
 * polling handles outliving a timeout, so `04 §3.5` requires the caller to bound
 * it and to guarantee the process exits. The race timer is unref'd for that reason.
 *
 * `confirmations` must be 1: one confirmation is the right notion of done on an L2
 * with immediate soft finality, and `onReplaced` does not fire above 1.
 */
async function waitBounded(
  client: PublicClient,
  hash: Hex,
  timeoutMs: number,
): Promise<Awaited<ReturnType<PublicClient["waitForTransactionReceipt"]>> | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs + 5_000);
    timer.unref();
  });

  try {
    return await Promise.race([
      client
        .waitForTransactionReceipt({ hash, confirmations: 1, timeout: timeoutMs })
        .catch(() => "timeout" as const),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
