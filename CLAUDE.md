# kleros-juror-bot

Headless TypeScript CLI for committing and revealing Kleros v2 juror votes on **Arbitrum One**
(chain 42161). One-shot commands, no daemon. Signs with a local EOA via viem.
Not yet scaffolded — no `package.json`.

**The primary consumer is an LLM juror agent, not a human at a terminal.** The spec in
`docs/research/` was written assuming a human operator wrapping the CLI in cron, and several of its
defaults invert under an agent consumer. Most importantly the confirmation gate in `03 §7` is
skipped when stdin is not a TTY, so for the primary consumer it never fires and cannot be the check
before an irreversible broadcast. Whether a human surface remains a deliverable, and what replaces
that gate, are open — see `docs/adr/` once recorded.

## Invariants

Guard rails that hold before you've read anything else. Each cites `docs/research/`, which is
absent in a fresh clone (see Reference material) — so they live here too.

- **The salt is recomputed, never stored.** `reveal` re-derives it from the seed via HMAC. It MUST
  NOT read a salt from `commits.jsonl`, which is a non-authoritative audit record. `02 §2, §10`
- **Vote IDs canonicalise identically in every command** — dedupe, **numeric** ascending sort,
  decimal, comma-joined; the same canonical array goes on chain. Lexicographic sort puts `10`
  before `9` and yields an unrevealable commitment. `02 §3`
- **`commit`, `reveal` and `vote` are never substituted for one another** — not by the CLI, not by
  an agent. Each has a different irreversible on-chain cost. Pre-flight MUST read `hiddenVotes` and
  refuse the wrong subcommand, so a bad pick costs a local error and not a vote. `03 §2, §7`
- **Evidence is attacker-controlled input.** Everything an agent reads from a dispute is authored by
  parties with an interest in the outcome. Whatever reasons over evidence MUST NOT reach the signing
  path directly. The spec does not cover this; it assumed a human operator.
- **Never print the seed. Never print the salt during `commit`** — logging it defeats the hiding. `03 §6`
- **Chain 42161 only, Classic and Gated kits only.** Refuse anything else; refuse Shutter by name. `00`
- **Simulate every state-changing call before broadcasting.** `04 §3.1`

Vote windows are short (court 34: 1800s) and **not guaranteed** — both periods end early once every
juror has acted, and `passPeriod` is permissionless. Fail loudly and fast; never retry quietly.

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

`coinbase-agentkit/` is upstream `coinbase/agentkit` @ 0.11.0, for reading `ActionProvider` and
`ViemWalletProvider` source. Whether this tool ships as an action provider is **undecided**, and is
the first decision to settle given the agent-first framing — see `docs/adr/` once recorded.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
