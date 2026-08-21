import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DISPUTE_KITS,
  ARBITRUM_ONE_CHAIN_ID,
  DISPUTE_KIT_ABI,
  KLEROS_CORE,
  KLEROS_CORE_ABI,
  resolveDisputeKit,
  SHUTTER_DISPUTE_KITS,
} from "./deployment.js";

type AbiParam = { name?: string; type: string };
type AbiEntry = {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
};
type MainnetDeployment = Record<string, unknown>;

/**
 * `@kleros/kleros-v2-contracts` is imported through its `cjs` subpath: its `esm`
 * build ships CommonJS under the `import` condition and throws in an ESM package.
 * That is why it is a devDependency and why this file is the only place it appears.
 */
const loadMainnet = async (): Promise<MainnetDeployment> => {
  const mod = (await import("@kleros/kleros-v2-contracts/cjs/deployments")) as Record<
    string,
    unknown
  > & { default?: Record<string, unknown> };
  const ns = (mod.mainnetViem ?? mod.default?.mainnetViem) as MainnetDeployment | undefined;
  if (!ns) throw new Error("mainnetViem export not found");
  return ns;
};

const addressFor = (ns: MainnetDeployment, key: string): string => {
  const record = ns[key] as Record<string, string> | undefined;
  const address = record?.[String(ARBITRUM_ONE_CHAIN_ID)];
  if (!address) throw new Error(`no Arbitrum One address for ${key}`);
  return address;
};

const abiFor = (ns: MainnetDeployment, key: string): AbiEntry[] => ns[key] as AbiEntry[];

const normalise = (entry: AbiEntry) => ({
  type: entry.type,
  name: entry.name,
  stateMutability: entry.stateMutability,
  inputs: (entry.inputs ?? []).map((i) => ({ name: i.name ?? "", type: i.type })),
  outputs: (entry.outputs ?? []).map((o) => ({ name: o.name ?? "", type: o.type })),
});

const findFunction = (abi: AbiEntry[], name: string): AbiEntry => {
  const entry = abi.find((e) => e.type === "function" && e.name === name);
  if (!entry) throw new Error(`${name} absent from the deployed ABI`);
  return entry;
};

/**
 * The canary for the pinned surface in `deployment.ts`. If any of this fails, the
 * deployment or the package changed and `01` must be revisited before shipping --
 * which is the whole point of pinning rather than importing.
 */
describe("pinned deployment matches @kleros/kleros-v2-contracts mainnet", () => {
  it.each([
    ["klerosCoreAddress", KLEROS_CORE.address],
    ["disputeKitClassicAddress", ACCEPTED_DISPUTE_KITS.classic.address],
    ["disputeKitGatedAddress", ACCEPTED_DISPUTE_KITS.gated.address],
    ["disputeKitShutterAddress", SHUTTER_DISPUTE_KITS.shutter],
    ["disputeKitGatedShutterAddress", SHUTTER_DISPUTE_KITS.gatedShutter],
  ])("%s", async (key, pinned) => {
    const ns = await loadMainnet();
    expect(getAddress(addressFor(ns, key))).toBe(getAddress(pinned));
  });

  it("pins KlerosCore fragments identically", async () => {
    const abi = abiFor(await loadMainnet(), "klerosCoreAbi");
    for (const pinned of KLEROS_CORE_ABI) {
      expect(normalise(findFunction(abi, pinned.name))).toEqual(normalise(pinned as AbiEntry));
    }
  });

  it("pins dispute kit fragments identically", async () => {
    const abi = abiFor(await loadMainnet(), "disputeKitClassicAbi");
    for (const pinned of DISPUTE_KIT_ABI) {
      expect(normalise(findFunction(abi, pinned.name))).toEqual(normalise(pinned as AbiEntry));
    }
  });

  it("Classic and Gated share the voting ABI", async () => {
    // Why the two kits can be treated identically (`01 §1`).
    const ns = await loadMainnet();
    const classic = abiFor(ns, "disputeKitClassicAbi");
    const gated = abiFor(ns, "disputeKitGatedAbi");
    for (const name of ["castCommit", "castVote", "hashVote", "getVoteInfo"]) {
      expect(normalise(findFunction(gated, name))).toEqual(normalise(findFunction(classic, name)));
    }
  });
});

/** The two fingerprints from `01 §2` that distinguish the deployment from `master`. */
describe("deployed-versus-master fingerprints", () => {
  it("declares no custom errors for the voting logic", async () => {
    // The deployed implementation reverts with require strings. If custom errors
    // appear here, the package has been regenerated from master and the revert
    // decoding assumed by `04 §5` no longer describes production.
    const abi = abiFor(await loadMainnet(), "disputeKitClassicAbi");
    const proxyLevel = new Set([
      "AlreadyInitialized",
      "FailedDelegateCall",
      "InvalidImplementation",
      "NotInitializing",
      "UUPSUnauthorizedCallContext",
      "UUPSUnsupportedProxiableUUID",
    ]);
    const errors = abi.filter((e) => e.type === "error").map((e) => e.name ?? "");
    expect(errors.filter((name) => !proxyLevel.has(name))).toEqual([]);
  });

  it("exposes the single getDegreeOfCoherence, not master's Reward/Penalty pair", async () => {
    const abi = abiFor(await loadMainnet(), "disputeKitClassicAbi");
    const names = abi.filter((e) => e.type === "function").map((e) => e.name);
    expect(names).toContain("getDegreeOfCoherence");
    expect(names).not.toContain("getDegreeOfCoherenceReward");
    expect(names).not.toContain("getDegreeOfCoherencePenalty");
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
