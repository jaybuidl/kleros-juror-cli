# kleros-juror-bot

Headless TypeScript CLI that commits and reveals Kleros v2 juror votes on **Arbitrum One**
(chain 42161). One-shot commands, no daemon. Binary: `kleros-juror`.

**This tool casts a vote; it does not decide one.** The choice is always an input. Nothing here
reads evidence, resolves a dispute template, or discovers draws — see `CONTEXT.md` for the
casting/deciding line and `docs/adr/0001` for why it falls there.

**The primary consumer is an autonomous LLM juror agent, not a human at a terminal.** The spec in
`docs/research/` assumes a human operator wrapping the CLI in cron; several of its defaults invert
under an agent consumer. Where they do, `docs/adr/` records the deviation and the spec citation it
overrides. A human is a debug surface only, so the CLI must be self-documenting.

Status: Slice A shipped — `status`, `salt`, `commit`, `reveal`. `vote` and `recover` are next.

```
pnpm test         # unit + fork tests (fork tests skip when no fork is reachable)
pnpm test:fork    # spawn an Arbitrum One fork on :8546 and run only the fork tests
pnpm typecheck
pnpm lint         # biome check .   (`pnpm exec biome check --write .` to fix)
pnpm dev -- status --dispute 154 --round 0 --votes 0 --address 0x...
```

## Invariants

Guard rails that hold before you've read anything else. Each cites `docs/research/`, which is
absent in a fresh clone (see Reference material) — so they live here too. Where an ADR overrides
the spec, the ADR wins and is named.

- **The salt is recomputed, never stored.** `reveal` re-derives it. It MUST NOT read a salt from
  `commits.jsonl`, which is a non-authoritative audit record. `02 §2, §10`
- **The seed is derived from a wallet signature and never persisted** — `keccak256(sign(...))`,
  proved deterministic by signing twice at startup. The **signer address and seed source are locked
  for the life of any in-flight commitment**; changing either yields an unrevealable vote.
  `ADR-0003`, overriding `02 §2`
- **Vote IDs canonicalise identically in every command** — dedupe, **numeric** ascending sort,
  decimal, comma-joined; the same canonical array goes on chain. Lexicographic sort puts `10`
  before `9` and yields an unrevealable commitment. `02 §3`
- **`commit`, `reveal` and `vote` are never substituted for one another** — not by the CLI, not by
  an agent, and not by an upstream field. `kleros juror draws` supplies `actionRequired` as a
  **hint**; pre-flight MUST independently read `hiddenVotes` and the period and refuse a mismatch.
  `03 §2, §7`
- **Evidence never enters this process.** Everything an agent reads from a dispute is authored by
  parties with an interest in the outcome. The separation is structural, not procedural: attacker-
  authored text has no path to the signing key because this tool never reads any.
- **Never print the seed. Never print the salt during `commit`** — logging it defeats the hiding. `03 §6`
- **Chain 42161 only, Classic and Gated kits only.** Refuse anything else; refuse Shutter by name. `00`
- **Simulate every state-changing call, and broadcast only on explicit `--broadcast`.** The default
  is plan → simulate → stop. There is no human confirmation gate and nothing upstream provides one.
  `04 §3.1`, `ADR-0004` overriding `03 §7`
- **Failure semantics live in the JSON payload, not the exit code.** The consuming agent sees
  stdout and stderr merged into one middle-out-truncated buffer and an effectively binary exit
  status. So: JSON on stdout, stderr silent unless `--verbose`, output kept small, and a stable
  `code` field on every error. Exit codes stay per `03 §5` for shell callers, but they are not the
  machine contract.

Vote windows are short (court 34: 1800s) and **not guaranteed** — both periods end early once every
juror has acted, and `passPeriod` is permissionless. Fail loudly and fast; never retry quietly.

## Stack

`incur` (pinned as `@kleros/agentkit` pins it) · `viem` · Node >=22. Runtime truth: `package.json`.

Addresses and ABI fragments are **pinned** in `src/core/deployment.ts`, not imported.
`@kleros/kleros-v2-contracts` is a **devDependency** and appears in exactly one file,
`deployment.test.ts`, which asserts every pinned address and fragment against its `mainnet` export
plus both `01 §2` fingerprints. Do not replace the fragments with a package import — `ADR-0005`
explains why, including the ESM packaging defect that makes it fail at runtime anyway. Do **not**
add `@kleros/kleros-sdk`; it is a higher-level layer this scope does not need and it drags a
conflicting zod major.

RPC only — no subgraph, no log scanning. Every pre-flight read in `01 §7` is a plain `eth_call`.

Layout mirrors `@kleros/agentkit` so the eventual port is close to a file move: framework-free
`src/core/` returning `KlerosResult<T>`, thin `src/commands/` owning incur and the CTA blocks.
`ADR-0001`

## Domain docs

`CONTEXT.md` is the glossary — use its terms, avoid the synonyms it lists. `docs/adr/` records the
four decisions that a reader would otherwise question. Convention: `docs/agents/domain.md`.

## Reference material

Read-only, outside this repo, via **gitignored symlinks** — absent in a fresh clone. Neither is a
build dependency; both exist to be read.

| Symlink              | Recreate with                                                        |
| -------------------- | -------------------------------------------------------------------- |
| `docs/research/`     | `ln -s ../../kleros-v2/docs/juror-cli-master docs/research`          |
| `coinbase-agentkit/` | `ln -s ../../kleros-playgrounds/coinbase-agentkit coinbase-agentkit` |

**`docs/research/` is the specification for this tool** — RFC 2119 normative, test vectors verified
live against Arbitrum. Start at its `README.md`. Order: `00` orientation → `01` on-chain facts
(pinned ABIs, addresses, reverts) → `02` **the functional core** (seed, salt, commitment, recovery,
vectors) → `03` CLI surface → `04` relaying → `05` verification. Read `03` knowing it targets a
human operator; see the note above.

`coinbase-agentkit/` is upstream `coinbase/agentkit` @ 0.11.0. **This tool does not ship as an
action provider** — `ADR-0002`. The symlink stays for reading source if that is ever revisited.

Other Kleros research artifacts exist outside this repo (a PRD, an agent-authored best-practices
document). `docs/research/` **governs**; the PRD is obsolete and anything else is advisory only.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.
