import { err, type KlerosResult, ok } from "./result.js";

/**
 * Canonical vote IDs — `02 §3`.
 *
 * Applying this in one command and not another is the single most likely way to
 * build a tool that commits successfully and then cannot reveal. The canonical
 * array is what feeds both the salt derivation and the on-chain call, so the two
 * cannot drift apart: callers get `ids` and `csv` from the same computation.
 */
export type CanonicalVoteIds = {
  /** Deduplicated, numerically ascending. The array passed to castCommit/castVote. */
  ids: bigint[];
  /** Decimal, comma-joined, no spaces. The `votes=` component of the salt info string. */
  csv: string;
};

/** A vote ID as accepted from the command line, before validation. */
export type VoteIdInput = string | readonly (string | number | bigint)[];

const DECIMAL_UINT = /^\d+$/;

export function canonicaliseVoteIds(input: VoteIdInput): KlerosResult<CanonicalVoteIds> {
  // A whole input that is empty or blank means "no vote IDs"; a blank element
  // among others means the caller built the list wrong. They are different errors.
  if (typeof input === "string" && input.trim() === "") {
    return err("EMPTY_VOTE_IDS", "At least one vote ID is required.");
  }
  const raw = typeof input === "string" ? input.split(",") : input;

  const parsed: bigint[] = [];
  for (const element of raw) {
    // Trimming is safe: it cannot change which integer is meant. Anything else
    // -- signs, decimals, hex, exponents -- is rejected rather than coerced.
    const text = String(element).trim();
    if (!DECIMAL_UINT.test(text)) {
      return err(
        "INVALID_VOTE_ID",
        `Vote IDs must be non-negative decimal integers; got ${JSON.stringify(text)}.`,
        { element: text },
      );
    }
    parsed.push(BigInt(text));
  }

  const ids = [...new Set(parsed)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (ids.length === 0) {
    // `castCommit` accepts an empty array and silently does nothing (`01 §4`),
    // so this has to be caught here or it costs a transaction for no vote.
    return err("EMPTY_VOTE_IDS", "At least one vote ID is required.");
  }

  return ok({ ids, csv: ids.join(",") });
}
