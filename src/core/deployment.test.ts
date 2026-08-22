import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
} from "viem";
import { arbitrum } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DISPUTE_KITS,
  ARBITRUM_ONE_CHAIN_ID,
  DISPUTE_KIT_ABI,
  identifyDisputeKit,
  KLEROS_CORE,
  KLEROS_CORE_ABI,
  resolveDisputeKit,
  SHUTTER_DISPUTE_KITS,
} from "./deployment.js";

type AbiParam = { readonly name?: string; readonly type: string };
type AbiEntry = {
  readonly type: string;
  readonly name?: string;
  readonly stateMutability?: string;
  readonly inputs?: readonly AbiParam[];
  readonly outputs?: readonly AbiParam[];
};

const CORE = KLEROS_CORE_ABI as readonly AbiEntry[];
const KIT = DISPUTE_KIT_ABI as readonly AbiEntry[];

/**
 * Output *names* and order are part of the assertion on purpose: `read-preflight.ts`
 * destructures multicall results positionally, so a reordered tuple would silently
 * shift a field rather than fail.
 */
const signature = (entry: AbiEntry): string =>
  `${entry.name}(${(entry.inputs ?? []).map((i) => i.type).join(",")}) -> (${(entry.outputs ?? [])
    .map((o) => (o.name ? `${o.type} ${o.name}` : o.type))
    .join(", ")})`;

const fn = (abi: readonly AbiEntry[], name: string): AbiEntry => {
  const entry = abi.find((e) => e.type === "function" && e.name === name);
  if (!entry) throw new Error(`${name} absent from the deployed ABI`);
  return entry;
};

/**
 * `deployment.ts` imports its addresses and ABIs from `@kleros/kleros-v2-contracts`
 * rather than pinning them, so these tests are what keeps that import honest. They
 * are the reason the import is safe, not a leftover from when it was not.
 */
describe("the deployed ABI still has the shape this tool calls", () => {
  it.each([
    "disputes(uint256) -> (uint96 courtID, address arbitrated, uint8 period, bool ruled, uint256 lastPeriodChange)",
    "courts(uint256) -> (uint96 parent, bool hiddenVotes, uint256 minStake, uint256 alpha, uint256 feeForJuror, uint256 jurorsForCourtJump, bool disabled)",
    "getTimesPerPeriod(uint96) -> (uint256[4] timesPerPeriod)",
    "getNumberOfRounds(uint256) -> (uint256)",
    "version() -> (string)",
    // Both used by the no-logs fallback in `identifyDisputeKit` (`01 §7`).
    "disputeKits(uint256) -> (address)",
    "getDisputeKitsLength() -> (uint256)",
  ])("KlerosCore.%s", (expected) => {
    const name = expected.slice(0, expected.indexOf("("));
    expect(signature(fn(CORE, name))).toBe(expected);
  });

  it.each([
    "castCommit(uint256,uint256[],bytes32) -> ()",
    "castVote(uint256,uint256[],uint256,uint256,string) -> ()",
    "getVoteInfo(uint256,uint256,uint256) -> (address account, bytes32 commit, uint256 choice, bool voted)",
    // `totalCommited` is misspelled in the deployed ABI. That is not a typo here.
    "getRoundInfo(uint256,uint256,uint256) -> (uint256 winningChoice, bool tied, uint256 totalVoted, uint256 totalCommited, uint256 nbVoters, uint256 choiceCount)",
    "coreDisputeIDToActive(uint256) -> (bool)",
    "coreDisputeIDToLocal(uint256) -> (uint256)",
    "disputes(uint256) -> (uint256 numberOfChoices, bool jumped, bytes extraData)",
    "hashVote(uint256,uint256,string) -> (bytes32)",
    "version() -> (string)",
  ])("DisputeKit.%s", (expected) => {
    const name = expected.slice(0, expected.indexOf("("));
    expect(signature(fn(KIT, name))).toBe(expected);
  });
});

/**
 * The addresses now come from the package, so the risk is no longer that we mistyped
 * one -- it is that an upstream regeneration moves one under us. Salt derivation folds
 * in the dispute kit address (`salt.ts`), so a changed address makes every commitment
 * still in flight unrevealable. These literals exist to detect that, and nothing reads
 * them; do not "fix" a failure here by updating them without reading `02 §4` first.
 */
describe("addresses have not moved (in-flight commitments depend on it)", () => {
  it.each([
    ["KlerosCore", KLEROS_CORE.address, "0x991d2df165670b9cac3B022f4B68D65b664222ea"],
    [
      "Classic",
      ACCEPTED_DISPUTE_KITS.classic.address,
      "0x70B464be85A547144C72485eBa2577E5D3A45421",
    ],
    ["Gated", ACCEPTED_DISPUTE_KITS.gated.address, "0xaE1eed20C125B739b64c948820C61F809ad9a925"],
    ["Shutter", SHUTTER_DISPUTE_KITS.shutter, "0x9D3e3f1765744c2a1BC6F6088549770444BBC768"],
    [
      "GatedShutter",
      SHUTTER_DISPUTE_KITS.gatedShutter,
      "0x788330092B9704809C19858E39EB9Ac402c2E47b",
    ],
  ])("%s", (_label, resolved, historical) => {
    expect(getAddress(resolved)).toBe(getAddress(historical));
  });

  it("resolves the Arbitrum One chain ID from the deployment, not a literal", () => {
    expect(ARBITRUM_ONE_CHAIN_ID).toBe(42161);
  });
});

/** The two fingerprints from `01 §2` that distinguish the deployment from `master`. */
describe("deployed-versus-master fingerprints", () => {
  it("declares no custom errors for the voting logic", () => {
    // The deployed implementation reverts with require strings. If custom errors
    // appear here, the package has been regenerated from master and the revert
    // decoding assumed by `04 §5` no longer describes production.
    const proxyLevel = new Set([
      "AlreadyInitialized",
      "FailedDelegateCall",
      "InvalidImplementation",
      "NotInitializing",
      "UUPSUnauthorizedCallContext",
      "UUPSUnsupportedProxiableUUID",
    ]);
    const errors = KIT.filter((e) => e.type === "error").map((e) => e.name ?? "");
    expect(errors.filter((name) => !proxyLevel.has(name))).toEqual([]);
  });

  it("exposes the single getDegreeOfCoherence, not master's Reward/Penalty pair", () => {
    const names = KIT.filter((e) => e.type === "function").map((e) => e.name);
    expect(names).toContain("getDegreeOfCoherence");
    expect(names).not.toContain("getDegreeOfCoherenceReward");
    expect(names).not.toContain("getDegreeOfCoherencePenalty");
  });
});

describe("Classic and Gated share the voting ABI", () => {
  // Why the two kits can be treated with one ABI (`01 §1`).
  it.each(["castCommit", "castVote", "hashVote", "getVoteInfo"])("%s", async (name) => {
    const { mainnetViem } = await import("@kleros/kleros-v2-contracts/cjs/deployments");
    const gated = mainnetViem.disputeKitGatedAbi as readonly AbiEntry[];
    expect(signature(fn(gated, name))).toBe(signature(fn(KIT, name)));
  });
});

describe("resolveDisputeKit", () => {
  it.each([
    ["classic", "0x70B464be85A547144C72485eBa2577E5D3A45421", "0.12.0"],
    ["gated", "0xaE1eed20C125B739b64c948820C61F809ad9a925", "0.12.2"],
  ])("resolves %s by name", (name, address, version) => {
    const result = resolveDisputeKit(name);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(getAddress(result.data.address)).toBe(getAddress(address));
    // A single hardcoded version would warn spuriously on every Gated invocation.
    expect(result.data.expectedVersion).toBe(version);
  });

  it("resolves an accepted kit by address, in any casing", () => {
    const lower = resolveDisputeKit(ACCEPTED_DISPUTE_KITS.classic.address.toLowerCase());
    expect(lower.success).toBe(true);
    if (lower.success) expect(lower.data.name).toBe("classic");
  });

  it.each(Object.entries(SHUTTER_DISPUTE_KITS))("refuses the %s kit by name", (_key, address) => {
    const result = resolveDisputeKit(address);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("SHUTTER_DISPUTE_KIT");
      expect(result.message).toContain("Shutter");
    }
  });

  it.each([
    ["an unrelated address", "0x0000000000000000000000000000000000000001"],
    ["a made-up name", "sybilResistant"],
    ["nonsense", "not-an-address"],
  ])("refuses %s", (_label, input) => {
    const result = resolveDisputeKit(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("UNKNOWN_DISPUTE_KIT");
  });
});

/**
 * The fallback matters more than it looks: it is what keeps `commit` and `reveal`
 * working inside a 1800-second window against a provider that caps log ranges. It is
 * driven here by a transport that refuses `eth_getLogs` and answers only the two
 * `01 §7` reads, so the test needs no network.
 */
describe("identifyDisputeKit falls back to eth_call when the log query fails", () => {
  const registry: Record<number, string> = {
    1: ACCEPTED_DISPUTE_KITS.classic.address,
    2: SHUTTER_DISPUTE_KITS.shutter,
    3: ACCEPTED_DISPUTE_KITS.gated.address,
    4: SHUTTER_DISPUTE_KITS.gatedShutter,
  };

  let sawGetLogs = false;

  const client = createPublicClient({
    chain: arbitrum,
    transport: custom({
      async request({ method, params }: any) {
        if (method === "eth_chainId") return "0xa4b1";
        if (method === "eth_getLogs") {
          sawGetLogs = true;
          throw new Error("query returned more than 10000 results");
        }
        if (method === "eth_call") {
          const data = params[0].data as `0x${string}`;
          const { functionName, args } = decodeFunctionData({ abi: KLEROS_CORE_ABI, data });
          if (functionName === "getDisputeKitsLength") {
            return encodeFunctionResult({
              abi: KLEROS_CORE_ABI,
              functionName,
              result: BigInt(Object.keys(registry).length + 1),
            });
          }
          if (functionName === "disputeKits") {
            const id = Number((args as readonly bigint[])[0]);
            return encodeFunctionResult({
              abi: KLEROS_CORE_ABI,
              functionName,
              result: registry[id] as `0x${string}`,
            });
          }
        }
        throw new Error(`unexpected ${method}`);
      },
    }),
  });

  it("still returns the kit ID KlerosCore registered", async () => {
    const resolved = resolveDisputeKit("classic");
    expect(resolved.success).toBe(true);
    if (!resolved.success) return;

    const result = await identifyDisputeKit(client, resolved.data);
    expect(sawGetLogs).toBe(true);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.disputeKitId).toBe("1");
  });
});
