import {
  deployments,
  getAddress as getDeployedAddress,
  getDisputeKitsViem,
  mainnetViem,
} from "@kleros/kleros-v2-contracts/cjs/deployments";
import type { Address, PublicClient } from "viem";
import { getAddress, isAddress } from "viem";
import { err, type KlerosResult, ok } from "./result.js";

/**
 * The deployed surface on Arbitrum One, taken from `@kleros/kleros-v2-contracts`
 * rather than hand-copied out of `01 §1` and `01 §3`.
 *
 * `01 §2` requires binding to the *deployed* ABI and forbids one compiled from
 * `master` — the deployed kit reverts with `require` strings and exposes a single
 * `getDegreeOfCoherence`. The package satisfies that: `deployment.test.ts` asserts
 * both of those fingerprints against the ABI imported here, so a package
 * regenerated from `master` fails the build rather than a reveal. That is the
 * whole reason those tests still exist after the fragments stopped being ours.
 *
 * Imported through the `cjs/deployments` subpath on purpose. The package root maps
 * its `import` condition at `esm/`, whose files are CommonJS under an
 * `esm/package.json` declaring `"type": "module"`, so importing it throws
 * `ReferenceError: exports is not defined`. See ADR-0006.
 */
const DEPLOYMENT = "mainnet" as const;

export const ARBITRUM_ONE_CHAIN_ID = deployments[DEPLOYMENT].chainId;

export const KLEROS_CORE = {
  address: getDeployedAddress(mainnetViem.klerosCoreConfig, ARBITRUM_ONE_CHAIN_ID),
} as const satisfies { address: Address };

/**
 * The deployed ABIs. Classic and Gated share a voting ABI and hash function
 * (`01 §1`), which `deployment.test.ts` asserts, so one kit ABI covers both.
 */
export const KLEROS_CORE_ABI = mainnetViem.klerosCoreAbi;
export const DISPUTE_KIT_ABI = mainnetViem.disputeKitClassicAbi;

/**
 * Kits whose voting ABI and hash function this tool understands.
 *
 * The versions stay local: they are per-kit (`01 §1` says a single expected value
 * MUST NOT be assumed) and the package carries no version field.
 */
export const ACCEPTED_DISPUTE_KITS = {
  classic: {
    address: getDeployedAddress(mainnetViem.disputeKitClassicConfig, ARBITRUM_ONE_CHAIN_ID),
    expectedVersion: "0.12.0",
  },
  gated: {
    address: getDeployedAddress(mainnetViem.disputeKitGatedConfig, ARBITRUM_ONE_CHAIN_ID),
    expectedVersion: "0.12.2",
  },
} as const satisfies Record<string, { address: Address; expectedVersion: string }>;

/** A different hidden-vote scheme with different cryptography. Refused by name (`00`). */
export const SHUTTER_DISPUTE_KITS = {
  shutter: getDeployedAddress(mainnetViem.disputeKitShutterConfig, ARBITRUM_ONE_CHAIN_ID),
  gatedShutter: getDeployedAddress(mainnetViem.disputeKitGatedShutterConfig, ARBITRUM_ONE_CHAIN_ID),
} as const satisfies Record<string, Address>;

export type DisputeKitName = keyof typeof ACCEPTED_DISPUTE_KITS;

export type ResolvedDisputeKit = {
  name: DisputeKitName;
  address: Address;
  expectedVersion: string;
};

/** A kit that KlerosCore itself confirms it registered, and under which ID. */
export type IdentifiedDisputeKit = ResolvedDisputeKit & {
  /** The `disputeKitID` KlerosCore indexes this kit by. Decimal, as a string. */
  disputeKitId: string;
};

/**
 * Resolve `classic`, `gated`, or an explicit address to a kit this tool will act on.
 * Anything else is refused before a call is built, and Shutter is refused by name
 * rather than by "unknown address" so the operator learns why.
 *
 * Synchronous and network-free on purpose: `salt` derives from the kit address and
 * must keep working when the RPC does not. `identifyDisputeKit` is the on-chain half.
 */
export function resolveDisputeKit(input: string): KlerosResult<ResolvedDisputeKit> {
  const key = input.trim().toLowerCase();

  const named = (Object.keys(ACCEPTED_DISPUTE_KITS) as DisputeKitName[]).find(
    (name) => name === key,
  );
  if (named) {
    return ok({ name: named, ...ACCEPTED_DISPUTE_KITS[named] });
  }

  if (!isAddress(key)) {
    return err(
      "UNKNOWN_DISPUTE_KIT",
      `Unknown dispute kit ${JSON.stringify(input)}. Expected "classic", "gated", or an address.`,
    );
  }

  const address = getAddress(key);

  const SHUTTER_LABELS: Record<string, string> = {
    shutter: "DisputeKitShutterNeo",
    gatedShutter: "DisputeKitGatedShutterNeo",
  };
  for (const [name, shutter] of Object.entries(SHUTTER_DISPUTE_KITS)) {
    if (getAddress(shutter) === address) {
      return err(
        "SHUTTER_DISPUTE_KIT",
        `${address} is ${SHUTTER_LABELS[name] ?? name}. Shutter is a different hidden-vote ` +
          "scheme with different cryptography, and this tool will not guess at it.",
      );
    }
  }

  for (const name of Object.keys(ACCEPTED_DISPUTE_KITS) as DisputeKitName[]) {
    const kit = ACCEPTED_DISPUTE_KITS[name];
    if (getAddress(kit.address) === address) return ok({ name, ...kit });
  }

  return err(
    "UNKNOWN_DISPUTE_KIT",
    `${address} is not a dispute kit this tool recognises on Arbitrum One.`,
  );
}

/**
 * Ask KlerosCore which kits it registered, and under which IDs.
 *
 * `getDisputeKitsViem` reads the `DisputeKitCreated` log, which also carries the
 * `isShutter` / `isGated` classification. That is a bounded query — four events on
 * Arbitrum One — but a fork does not backfill logs and some providers cap ranges,
 * so an empty or failed result falls back to `getDisputeKitsLength` / `disputeKits`,
 * which are plain `eth_call`s listed in `01 §7`.
 */
async function fetchKitRegistry(client: PublicClient): Promise<Map<Address, string>> {
  const byAddress = new Map<Address, string>();

  try {
    const kits = await getDisputeKitsViem(client, DEPLOYMENT);
    for (const [id, info] of Object.entries(kits)) {
      byAddress.set(getAddress(info.address), id);
    }
  } catch {
    // Fall through to the eth_call path below.
  }
  if (byAddress.size > 0) return byAddress;

  const core = { address: KLEROS_CORE.address, abi: KLEROS_CORE_ABI } as const;
  const length = (await client.readContract({
    ...core,
    functionName: "getDisputeKitsLength",
  })) as bigint;

  // Index 0 is the NULL kit and reverts; the registry proper starts at 1.
  const ids = Array.from({ length: Number(length) }, (_, i) => BigInt(i)).slice(1);
  const addresses = await Promise.all(
    ids.map((id) => client.readContract({ ...core, functionName: "disputeKits", args: [id] })),
  );

  ids.forEach((id, index) => {
    byAddress.set(getAddress(addresses[index] as Address), String(id));
  });
  return byAddress;
}

/**
 * Confirm the resolved kit is one KlerosCore actually registered, and attach its ID.
 *
 * Defence in depth rather than the primary Shutter gate: `resolveDisputeKit` has
 * already refused Shutter by address. This catches a kit that is not registered on
 * the core the CLI is talking to at all.
 */
export async function identifyDisputeKit(
  client: PublicClient,
  resolved: ResolvedDisputeKit,
): Promise<KlerosResult<IdentifiedDisputeKit>> {
  let registry: Map<Address, string>;
  try {
    registry = await fetchKitRegistry(client);
  } catch (cause) {
    return err(
      "DISPUTE_KIT_LOOKUP_FAILED",
      "Could not read the dispute kit registry from KlerosCore.",
      {
        hint: "The RPC rejected both the DisputeKitCreated log query and the disputeKits() reads.",
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }

  const disputeKitId = registry.get(getAddress(resolved.address));
  if (disputeKitId === undefined) {
    return err(
      "UNKNOWN_DISPUTE_KIT",
      `${resolved.address} is not registered as a dispute kit by KlerosCore at ${KLEROS_CORE.address}.`,
    );
  }

  return ok({ ...resolved, disputeKitId: String(disputeKitId) });
}

/** `Period` enum, `01 §6`. Indexes `timesPerPeriod` for 0..3. */
export const PERIODS = ["evidence", "commit", "vote", "appeal", "execution"] as const;
export type Period = (typeof PERIODS)[number];
