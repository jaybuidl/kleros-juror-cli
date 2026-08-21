import { createHmac } from "node:crypto";
import type { Address } from "viem";

/**
 * Salt derivation — `02 §4`.
 *
 * Bumping this tag is a breaking change: any commitment still in flight was made
 * with the old one and can only be revealed with the old one, so a future version
 * MUST retain the ability to derive v1 salts.
 */
export const SALT_VERSION_TAG = "kleros-juror-cli/v1/salt";

export type SaltInputs = {
  chainId: number;
  /** Lowercased before interpolation — checksummed casing yields a different salt. */
  disputeKit: Address;
  dispute: bigint;
  round: bigint;
  /** The canonical CSV from `canonicaliseVoteIds`, never the operator's raw order. */
  voteIdsCsv: string;
};

/**
 * The exact string that is MAC'd. Exposed because a regression in its construction
 * is invisible if you only assert the resulting salt (`05 §1.2`).
 */
export function saltInfo(inputs: SaltInputs): string {
  return [
    SALT_VERSION_TAG,
    `chain=${inputs.chainId}`,
    `dk=${inputs.disputeKit.toLowerCase()}`,
    `dispute=${inputs.dispute}`,
    `round=${inputs.round}`,
    `votes=${inputs.voteIdsCsv}`,
  ].join("|");
}

/**
 * `salt := uint256(HMAC-SHA256(key = seed, message = utf8(info)))`, big endian.
 * The key is the raw 32 seed bytes, not their hex encoding.
 */
export function deriveSalt(seed: Uint8Array, inputs: SaltInputs): bigint {
  const mac = createHmac("sha256", seed).update(saltInfo(inputs), "utf8").digest("hex");
  return BigInt(`0x${mac}`);
}
