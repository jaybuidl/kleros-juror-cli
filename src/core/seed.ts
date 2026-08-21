import type { Hex } from "viem";
import { hexToBytes, isHex, keccak256 } from "viem";
import { err, type KlerosResult, ok } from "./result.js";

/**
 * Seed derivation — ADR-0003, overriding `02 §2`.
 *
 * The seed is `keccak256(sign(SEED_MESSAGE))` and is never written to disk. One
 * secret exists, the signing key, and it is one the juror already has to back up.
 *
 * Changing this message, the signer, or the seed source strands every commitment
 * still in flight, because the salt changes and the reveal can no longer match.
 */
export const SEED_MESSAGE = "kleros-juror-cli/v1/seed";

export const SEED_ENV_VAR = "KLEROS_JUROR_SEED";

export type SignMessage = (message: string) => Promise<Hex>;

/**
 * Derive the seed from the signer, proving determinism rather than assuming it.
 *
 * The scheme rests on the same message always producing the same signature, which
 * requires RFC 6979. A viem local account complies; a remote or HSM-backed signer
 * may not. Signing twice here turns that from a silent unrevealable commitment
 * days later into a loud failure on the first invocation.
 */
export async function deriveSeedFromSigner(
  signMessage: SignMessage,
): Promise<KlerosResult<Uint8Array>> {
  const first = await signMessage(SEED_MESSAGE);
  const second = await signMessage(SEED_MESSAGE);

  if (first !== second) {
    return err(
      "SIGNER_NOT_DETERMINISTIC",
      "This signer produced two different signatures for the same message, so it cannot " +
        "be used to derive the seed. Salts derived now would not reproduce at reveal time.",
      { hint: `Set ${SEED_ENV_VAR} to an explicit 32-byte seed, or use an RFC 6979 signer.` },
    );
  }

  return ok(keccak256(first, "bytes"));
}

/** An explicit seed, for a signer that cannot sign deterministically or at all. */
export function seedFromEnv(value: string): KlerosResult<Uint8Array> {
  const normalised = value.trim().toLowerCase();
  const hex = normalised.startsWith("0x") ? normalised : `0x${normalised}`;

  if (!isHex(hex) || hex.length !== 66) {
    return err(
      "INVALID_SEED",
      `${SEED_ENV_VAR} must be 32 bytes of hex, with or without a 0x prefix.`,
    );
  }

  return ok(hexToBytes(hex as Hex));
}
