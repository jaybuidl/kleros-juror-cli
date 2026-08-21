import { createPublicClient, hexToBytes, http } from "viem";
import { arbitrum } from "viem/chains";
import { describe, expect, it } from "vitest";
import { hashVote } from "../core/commitment.js";
import {
  ACCEPTED_DISPUTE_KITS,
  ARBITRUM_ONE_CHAIN_ID,
  DISPUTE_KIT_ABI,
} from "../core/deployment.js";
import { decodeRevert } from "../core/reverts.js";
import { deriveSalt } from "../core/salt.js";

/**
 * Fork tests against the real deployed bytecode (`05 §2`).
 *
 * Start a fork first:
 *   anvil --fork-url https://arb1.arbitrum.io/rpc --port 8546 --silent
 *
 * Skipped when no fork is reachable, so `pnpm test` stays green offline.
 *
 * NOTE: the full commit -> passPeriod -> reveal cycle (`05 §5.3`) is not here.
 * It needs a dispute in the commit period, which means forking at a historical
 * block, which needs an archive RPC. No public Arbitrum endpoint serves one.
 */
const RPC = process.env.KLEROS_FORK_RPC ?? "http://127.0.0.1:8546";

const client = createPublicClient({ chain: arbitrum, transport: http(RPC) });
const kit = { address: ACCEPTED_DISPUTE_KITS.classic.address, abi: DISPUTE_KIT_ABI } as const;

const reachable = await client
  .getChainId()
  .then((id) => id === ARBITRUM_ONE_CHAIN_ID)
  .catch(() => false);

describe.skipIf(!reachable)("fork: the deployed dispute kit", () => {
  it("preserves chain 42161, so the chain guard needs no exemption", async () => {
    expect(await client.getChainId()).toBe(ARBITRUM_ONE_CHAIN_ID);
  });

  it.each([
    [1n, 0n],
    [0n, 1n],
    [1n, 123455678n],
  ])("agrees with our hashVote for choice=%s salt=%s", async (choice, salt) => {
    const onChain = await client.readContract({
      ...kit,
      functionName: "hashVote",
      args: [choice, salt, ""],
    });
    expect(onChain).toBe(hashVote(choice, salt));
  });

  it("ignores the justification, exactly as `01 §3` records", async () => {
    const [withText, without] = await Promise.all(
      ["hello", ""].map((justification) =>
        client.readContract({
          ...kit,
          functionName: "hashVote",
          args: [1n, 123455678n, justification],
        }),
      ),
    );
    expect(withText).toBe(without);
  });

  it("reproduces vector S1 end to end, seed through to on-chain commitment", async () => {
    // The strongest single assertion available without a live dispute: the salt
    // this tool derives from a seed, hashed by the deployed contract itself,
    // equals the commitment recorded in `02 §9`.
    const seed = hexToBytes("0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    const salt = deriveSalt(seed, {
      chainId: ARBITRUM_ONE_CHAIN_ID,
      disputeKit: ACCEPTED_DISPUTE_KITS.classic.address,
      dispute: 1234n,
      round: 0n,
      voteIdsCsv: "5,6,7",
    });

    const onChain = await client.readContract({
      ...kit,
      functionName: "hashVote",
      args: [1n, salt, ""],
    });

    expect(onChain).toBe("0x318e4bbd992ae79ba63e610e06e6fb369cc687daba873c420b649c0578380956");
    expect(onChain).toBe(hashVote(1n, salt));
  });

  it("reverts with a require string, and we decode it to guidance", async () => {
    // Confirms `01 §2` against production bytecode: the deployed implementation
    // uses require strings, so `Error(string)` is the primary decoding path.
    let caught: unknown;
    try {
      await client.simulateContract({
        ...kit,
        functionName: "castCommit",
        args: [154n, [0n], hashVote(1n, 1n)],
        account: "0x57eb05d4dfFAc43A0C52B42C47a4E7d1838725Ea",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    const decoded = decodeRevert(caught);
    expect(decoded.reason).toBe("The dispute should be in Commit period.");
    expect(decoded.guidance).toContain("not in the commit period");
  });

  it("reports the expected version, guarding the revert encoding above", async () => {
    const version = await client.readContract({ ...kit, functionName: "version" });
    expect(version).toBe(ACCEPTED_DISPUTE_KITS.classic.expectedVersion);
  });
});

if (!reachable) {
  // Visible in the run output rather than silently green.
  console.warn(`[fork] no Arbitrum One fork at ${RPC}; fork tests skipped.`);
}
