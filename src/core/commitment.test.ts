import { encodeAbiParameters, encodePacked, keccak256, parseAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { hashVote, isEmptyCommitment } from "./commitment.js";

/**
 * Bare hash vectors from `02 §9`, every one of them confirmed by live eth_call to
 * DisputeKitClassicNeo on Arbitrum One. These bind the implementation to production
 * behaviour rather than to source.
 */
describe("hashVote", () => {
  it.each([
    [1n, 0n, "0xada5013122d395ba3c54772283fb069b10426056ef8ca54750cb9bb552a59e7d"],
    [0n, 1n, "0xa6eef7e35abe7026729641147f7915573c7e97b47efa546f5f6e3230263bcb49"],
    [1n, 123455678n, "0x1fd0e83e0174096d703044019951eb92c4724e95522337dd7dbbe2638e79631d"],
    [
      2n,
      0x8d1bca9f4a1a5e6b3c2d0f7e9a4b6c8d1e3f5a7b9c0d2e4f6a8b0c1d3e5f7a9bn,
      "0x1966e20afe658d0f31f43bb87e2512beea48ab3521894183918bbef74a3388ee",
    ],
  ])("matches the live vector for choice=%s salt=%s", (choice, salt, expected) => {
    expect(hashVote(choice, salt)).toBe(expected);
  });

  it("encodes exactly 64 bytes, choice first", () => {
    const encoded = encodePacked(["uint256", "uint256"], [1n, 0n]);
    expect(encoded).toHaveLength(2 + 128);
    expect(encoded.slice(2, 66)).toBe(`${"0".repeat(63)}1`);
  });

  it("coincides with abi.encode here, and that is expected", () => {
    // `05 §1.1` asks for an assertion that abi.encode differs. It does not, and
    // cannot: `01 §3` explains that the two encodings are indistinguishable when
    // both arguments are fixed-width uint256. The property worth pinning is the
    // 64-byte layout above, not a difference that does not exist.
    const abiEncoded = keccak256(
      encodeAbiParameters(parseAbiParameters("uint256, uint256"), [1n, 0n]),
    );
    expect(hashVote(1n, 0n)).toBe(abiEncoded);
  });

  it("is order-sensitive in its arguments", () => {
    expect(hashVote(0n, 1n)).not.toBe(hashVote(1n, 0n));
  });
});

describe("isEmptyCommitment", () => {
  it("detects the zero commitment the contract rejects", () => {
    expect(isEmptyCommitment(`0x${"0".repeat(64)}`)).toBe(true);
    expect(isEmptyCommitment(hashVote(1n, 0n))).toBe(false);
  });
});
