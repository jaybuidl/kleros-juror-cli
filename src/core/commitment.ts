import type { Hex } from "viem";
import { encodePacked, keccak256 } from "viem";

/**
 * The commitment, reimplementing the dispute kit's `hashVote` — `01 §3`, `02 §5`.
 *
 * `abi.encodePacked` of two uint256 values: 64 bytes, big endian, choice first.
 * The justification argument the contract takes is accepted and then ignored by
 * the Classic and Gated kits, so it is absent here.
 */
export function hashVote(choice: bigint, salt: bigint): Hex {
  return keccak256(encodePacked(["uint256", "uint256"], [choice, salt]));
}

/** keccak256 never returns zero, so this is a cheap assertion, not a real branch (`02 §5`). */
export function isEmptyCommitment(commitment: Hex): boolean {
  return /^0x0{64}$/.test(commitment);
}
