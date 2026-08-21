import type { Address } from "viem";
import { getAddress, isAddress } from "viem";
import { err, type KlerosResult, ok } from "./result.js";

/**
 * The deployed surface on Arbitrum One — addresses from `01 §1`, function
 * fragments from `01 §3` and `01 §7`.
 *
 * These are hand-pinned rather than imported from `@kleros/kleros-v2-contracts`,
 * for two reasons. `01 §2` requires binding to the *deployed* ABI and forbids one
 * compiled from `master`; a pinned fragment cannot drift when the package is
 * regenerated. And `@kleros/kleros-v2-contracts@2.0.0-rc.2` ships CommonJS under
 * its `import` condition, so importing it from an ESM package throws at runtime.
 *
 * The package is still the source of truth: `deployment.test.ts` asserts every
 * address, signature and fingerprint here against its `mainnet` export, so a
 * change upstream fails the build rather than a reveal. Do not replace these
 * fragments with a package import without reading that test. See ADR-0005.
 */
export const ARBITRUM_ONE_CHAIN_ID = 42161;

export const KLEROS_CORE = {
  address: "0x991d2df165670b9cac3B022f4B68D65b664222ea",
  expectedVersion: "0.10.0",
} as const satisfies { address: Address; expectedVersion: string };

/** Kits whose voting ABI and hash function this tool understands. */
export const ACCEPTED_DISPUTE_KITS = {
  classic: {
    address: "0x70B464be85A547144C72485eBa2577E5D3A45421",
    // Classic and Gated are deliberately on different versions (`01 §1`); a single
    // hardcoded expectation would warn spuriously on every Gated invocation.
    expectedVersion: "0.12.0",
  },
  gated: {
    address: "0xaE1eed20C125B739b64c948820C61F809ad9a925",
    expectedVersion: "0.12.2",
  },
} as const satisfies Record<string, { address: Address; expectedVersion: string }>;

/** A different hidden-vote scheme with different cryptography. Refused by name (`00`). */
export const SHUTTER_DISPUTE_KITS = {
  shutter: "0x9D3e3f1765744c2a1BC6F6088549770444BBC768",
  gatedShutter: "0x788330092B9704809C19858E39EB9Ac402c2E47b",
} as const satisfies Record<string, Address>;

export type DisputeKitName = keyof typeof ACCEPTED_DISPUTE_KITS;

export type ResolvedDisputeKit = {
  name: DisputeKitName;
  address: Address;
  expectedVersion: string;
};

/**
 * Resolve `classic`, `gated`, or an explicit address to a kit this tool will act on.
 * Anything else is refused before a call is built, and Shutter is refused by name
 * rather than by "unknown address" so the operator learns why.
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

  for (const [name, shutter] of Object.entries(SHUTTER_DISPUTE_KITS)) {
    if (getAddress(shutter) === address) {
      return err(
        "SHUTTER_DISPUTE_KIT",
        `${address} is the ${name} Shutter dispute kit. Shutter uses a different hidden-vote ` +
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

/** `Period` enum, `01 §6`. Indexes `timesPerPeriod` for 0..3. */
export const PERIODS = ["evidence", "commit", "vote", "appeal", "execution"] as const;
export type Period = (typeof PERIODS)[number];

export const KLEROS_CORE_ABI = [
  {
    type: "function",
    name: "disputes",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "courtID", type: "uint96" },
      { name: "arbitrated", type: "address" },
      { name: "period", type: "uint8" },
      { name: "ruled", type: "bool" },
      { name: "lastPeriodChange", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "courts",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "parent", type: "uint96" },
      { name: "hiddenVotes", type: "bool" },
      { name: "minStake", type: "uint256" },
      { name: "alpha", type: "uint256" },
      { name: "feeForJuror", type: "uint256" },
      { name: "jurorsForCourtJump", type: "uint256" },
      { name: "disabled", type: "bool" },
    ],
  },
  {
    // Solidity struct getters skip arrays, which is why this exists separately.
    type: "function",
    name: "getTimesPerPeriod",
    stateMutability: "view",
    inputs: [{ name: "_courtID", type: "uint96" }],
    outputs: [{ name: "timesPerPeriod", type: "uint256[4]" }],
  },
  {
    type: "function",
    name: "getNumberOfRounds",
    stateMutability: "view",
    inputs: [{ name: "_disputeID", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const DISPUTE_KIT_ABI = [
  {
    type: "function",
    name: "castCommit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_coreDisputeID", type: "uint256" },
      { name: "_voteIDs", type: "uint256[]" },
      { name: "_commit", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "castVote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_coreDisputeID", type: "uint256" },
      { name: "_voteIDs", type: "uint256[]" },
      { name: "_choice", type: "uint256" },
      { name: "_salt", type: "uint256" },
      { name: "_justification", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getVoteInfo",
    stateMutability: "view",
    inputs: [
      { name: "_coreDisputeID", type: "uint256" },
      { name: "_coreRoundID", type: "uint256" },
      { name: "_voteID", type: "uint256" },
    ],
    outputs: [
      { name: "account", type: "address" },
      { name: "commit", type: "bytes32" },
      { name: "choice", type: "uint256" },
      { name: "voted", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getRoundInfo",
    stateMutability: "view",
    inputs: [
      { name: "_coreDisputeID", type: "uint256" },
      { name: "_coreRoundID", type: "uint256" },
      { name: "_choice", type: "uint256" },
    ],
    outputs: [
      { name: "winningChoice", type: "uint256" },
      { name: "tied", type: "bool" },
      { name: "totalVoted", type: "uint256" },
      // Misspelled in the deployed ABI. Reproduced exactly, on purpose.
      { name: "totalCommited", type: "uint256" },
      { name: "nbVoters", type: "uint256" },
      { name: "choiceCount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "coreDisputeIDToActive",
    stateMutability: "view",
    inputs: [{ name: "coreDisputeID", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "coreDisputeIDToLocal",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "disputes",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "numberOfChoices", type: "uint256" },
      { name: "jumped", type: "bool" },
      { name: "extraData", type: "bytes" },
    ],
  },
  {
    type: "function",
    name: "hashVote",
    stateMutability: "pure",
    inputs: [
      { name: "_choice", type: "uint256" },
      { name: "_salt", type: "uint256" },
      { name: "_justification", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
