import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { deriveSeedFromSigner, SEED_MESSAGE, seedFromEnv } from "./seed.js";

const TEST_KEY = `0x${"11".repeat(32)}` as const;

describe("deriveSeedFromSigner", () => {
  it("derives a 32-byte seed from a deterministic signer", async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const sign = (message: string) => account.signMessage({ message });

    const result = await deriveSeedFromSigner(sign);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toHaveLength(32);
    expect(result.data).toEqual(keccak256(await sign(SEED_MESSAGE), "bytes"));
  });

  it("reproduces the same seed across independent invocations", async () => {
    // The central claim of ADR-0003: no state is carried between commit and
    // reveal, so the seed has to fall out of the key alone, every time.
    const sign = (message: string) => privateKeyToAccount(TEST_KEY).signMessage({ message });
    const first = await deriveSeedFromSigner(sign);
    const second = await deriveSeedFromSigner(sign);

    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) expect(first.data).toEqual(second.data);
  });

  it("a viem local account signs deterministically (RFC 6979)", async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const a = await account.signMessage({ message: SEED_MESSAGE });
    const b = await account.signMessage({ message: SEED_MESSAGE });
    expect(a).toBe(b);
  });

  it("refuses a non-deterministic signer instead of deriving an unusable seed", async () => {
    // A signer using random k would commit fine and then be unable to reveal.
    // Failing here costs nothing; failing later costs the vote.
    let counter = 0;
    const sign = vi.fn(async () => `0x${String(++counter).padStart(130, "0")}` as const);

    const result = await deriveSeedFromSigner(sign);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SIGNER_NOT_DETERMINISTIC");
    expect(sign).toHaveBeenCalledTimes(2);
  });
});

describe("seedFromEnv", () => {
  const hex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

  it("accepts 32 bytes with or without a 0x prefix", () => {
    const bare = seedFromEnv(hex);
    const prefixed = seedFromEnv(`0x${hex.toUpperCase()}`);
    expect(bare.success && prefixed.success).toBe(true);
    if (bare.success && prefixed.success) expect(bare.data).toEqual(prefixed.data);
  });

  it.each([
    ["too short", "00ff"],
    ["too long", `${hex}00`],
    ["not hex", "z".repeat(64)],
  ])("rejects a seed that is %s", (_label, value) => {
    const result = seedFromEnv(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("INVALID_SEED");
  });
});
