# The seed is derived from a wallet signature, and never written to disk

`02 §2` specifies 32 random bytes in a `0600` file, and `02 §1` rejects the web frontend's
signature-derived salt because it "requires strictly deterministic RFC 6979 signing, which not
every signer backend provides". That objection does not hold for the signer this tool actually
uses: a viem `LocalAccount` signs deterministically via `@noble/curves`.

So the seed is `keccak256(sign("kleros-juror-cli/v1/seed"))`. One secret exists instead of two, and
there is no file whose loss between commit and reveal would forfeit a vote — which was the failure
mode the seed design set out to eliminate in the first place.

Determinism is **proved, not assumed**: the tool signs the same message twice at startup and aborts
if the two differ, so a non-deterministic signer fails on invocation one rather than producing an
unrevealable commitment days later. `KLEROS_JUROR_SEED` supplies an explicit seed for a signer that
cannot sign deterministically, or cannot sign arbitrary messages at all.

## Consequences

- `init` disappears, along with the seed-file permission checks in `02 §2` and `03 §9.4`.
- `salt` and `recover` now require the signing key, where the seed alone previously sufficed.
- **The signer address and the seed source are locked for the life of any in-flight commitment.**
  Changing either yields a different salt and an unrevealable vote.
- Migrating the *same key* into another RFC 6979 signer (Web3Signer, for example) preserves the
  seed, because the signature is unchanged. Changing the address does not.
- Salt derivation itself is untouched: the `info` string, the HMAC, the canonicalisation rule and
  every vector in `02 §9` hold exactly as specified. Only the seed's provenance moves.
