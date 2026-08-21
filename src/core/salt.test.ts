import { createHmac } from "node:crypto";
import { hexToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { hashVote } from "./commitment.js";
import { deriveSalt, type SaltInputs, saltInfo } from "./salt.js";
import { canonicaliseVoteIds } from "./vote-ids.js";

/** The fixed seed all vectors in `02 §9` are built on. */
const SEED = hexToBytes("0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");

const DK_LOWER = "0x70b464be85a547144c72485eba2577e5d3a45421" as const;
const DK_CHECKSUMMED = "0x70B464be85A547144C72485eBa2577E5D3A45421" as const;

const inputs = (over: Partial<SaltInputs> = {}): SaltInputs => ({
  chainId: 42161,
  disputeKit: DK_LOWER,
  dispute: 1234n,
  round: 0n,
  voteIdsCsv: "5,6,7",
  ...over,
});

describe("vector S1", () => {
  const expectedInfo =
    "kleros-juror-cli/v1/salt|chain=42161|dk=0x70b464be85a547144c72485eba2577e5d3a45421" +
    "|dispute=1234|round=0|votes=5,6,7";

  it("builds the exact info string", () => {
    // Asserted separately from the salt: a test that only checks the salt cannot
    // localise a regression in the string construction (`05 §1.2`).
    expect(saltInfo(inputs())).toBe(expectedInfo);
  });

  it("derives the salt", () => {
    const salt = deriveSalt(SEED, inputs());
    expect(salt).toBe(
      37492314153244834180637680052978514187881094605871202108217290800039191902312n,
    );
    expect(`0x${salt.toString(16)}`).toBe(
      "0x52e3e5d69b71fbc3a392e066d909370bdcaf5c9f7dc9a431d83c9f6abdf7f868",
    );
  });

  it("produces the commitment", () => {
    expect(hashVote(1n, deriveSalt(SEED, inputs()))).toBe(
      "0x318e4bbd992ae79ba63e610e06e6fb369cc687daba873c420b649c0578380956",
    );
  });
});

describe("vector S2 — canonicalisation", () => {
  it("is byte-identical to S1 for --votes 7,5,6,5", () => {
    // This vector exists specifically to catch a canonicalisation regression.
    const canonical = canonicaliseVoteIds("7,5,6,5");
    if (!canonical.success) throw new Error("unexpected failure");

    const s2 = inputs({ voteIdsCsv: canonical.data.csv });
    expect(saltInfo(s2)).toBe(saltInfo(inputs()));
    expect(deriveSalt(SEED, s2)).toBe(deriveSalt(SEED, inputs()));
    expect(hashVote(1n, deriveSalt(SEED, s2))).toBe(
      "0x318e4bbd992ae79ba63e610e06e6fb369cc687daba873c420b649c0578380956",
    );
  });
});

describe("vector S3", () => {
  const s3 = inputs({ dispute: 42n, round: 2n, voteIdsCsv: "0" });

  it("builds the exact info string", () => {
    expect(saltInfo(s3)).toBe(
      "kleros-juror-cli/v1/salt|chain=42161|dk=0x70b464be85a547144c72485eba2577e5d3a45421" +
        "|dispute=42|round=2|votes=0",
    );
  });

  it("derives the salt and commitment for choice 0", () => {
    const salt = deriveSalt(SEED, s3);
    expect(salt).toBe(
      68765686865283756064353174399144946916317104923079885247008543884444240935685n,
    );
    // Refuse to arbitrate is a valid choice and must not be treated as absent.
    expect(hashVote(0n, salt)).toBe(
      "0x6cc045a453f1d3946cf6d76c730a4d7964c1d575840e2361cc15e89cf0d17b38",
    );
  });
});

describe("domain separation", () => {
  it.each([
    ["chain", { chainId: 1 }],
    ["dispute kit", { disputeKit: "0xae1eed20c125b739b64c948820c61f809ad9a925" as const }],
    ["dispute", { dispute: 1235n }],
    ["round", { round: 1n }],
    ["votes", { voteIdsCsv: "5,6,8" }],
  ])("changing %s changes the salt", (_label, over) => {
    expect(deriveSalt(SEED, inputs(over))).not.toBe(deriveSalt(SEED, inputs()));
  });

  it("lowercases the dispute kit address, so both casings agree", () => {
    expect(saltInfo(inputs({ disputeKit: DK_CHECKSUMMED }))).toBe(saltInfo(inputs()));
    expect(deriveSalt(SEED, inputs({ disputeKit: DK_CHECKSUMMED }))).toBe(
      deriveSalt(SEED, inputs()),
    );
  });

  it("would produce a different salt if the casing were not normalised", () => {
    // Proves the lowercasing above is load-bearing rather than cosmetic.
    const unnormalised = saltInfo(inputs()).replace(DK_LOWER, DK_CHECKSUMMED);
    const mac = createHmac("sha256", SEED).update(unnormalised, "utf8").digest("hex");
    expect(BigInt(`0x${mac}`)).not.toBe(deriveSalt(SEED, inputs()));
  });

  it("changes the salt if the seed changes", () => {
    const otherSeed = new Uint8Array(32).fill(9);
    expect(deriveSalt(otherSeed, inputs())).not.toBe(deriveSalt(SEED, inputs()));
  });
});
