<h1 align="center">⚖️ kleros-juror-cli</h1>

<p align="center">
  <strong>A headless CLI that commits and reveals Kleros v2 juror votes on Arbitrum One.</strong><br>
  One-shot commands, no daemon, JSON in and JSON out.<br>
  <sub>package <code>kleros-juror-cli</code> · binary <code>kleros-juror</code></sub>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Node >= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a.svg">
  <img alt="Chain: Arbitrum One" src="https://img.shields.io/badge/chain-Arbitrum%20One%20(42161)-28a0f0.svg">
  <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-orange.svg">
</p>

---

> [!IMPORTANT]
> **This tool casts a vote; it does not decide one.** The ruling is always an input (`--choice`).
> It never reads evidence, never resolves a dispute template, and never discovers which disputes
> you were drawn in. Deciding happens upstream — a human, an agent, a coin flip, your business.

## Why this exists

In a Kleros court with **hidden votes**, voting happens twice:

```
  evidence  │       commit       │        vote        │  appeal  │  execution
            │                    │                    │
            │  castCommit        │  castVote          │
            │  keccak256(        │  the choice, plus  │
            │    choice, salt)   │  that same salt    │
            └────────────────────┴────────────────────┘
                      the salt has to survive this gap
```

Between those two transactions you must still hold the **salt** that blinded your commitment. Lose
it and the vote is unrevealable — you are penalised for a vote you actually cast. Web wallets keep
it in browser local storage; a scheduled, headless juror has nowhere comparable to put it.

So this tool keeps nothing. The salt is **recomputed on demand** from a seed that is itself derived
from a signature by the juror's own key. There is no salt file, no vote database, and nothing to
back up beyond the key you already back up.

| It does | It does not |
| --- | --- |
| Publish a commitment (`castCommit`) | Read evidence or decide a ruling |
| Reveal a committed vote (`castVote`) | Discover which disputes you are drawn in |
| Re-derive salts deterministically | Store salts, seeds, or vote history |
| Refuse anything that looks wrong, before spending gas | Broadcast anything without `--broadcast` |

## Status

Alpha. Working, tested against the deployed Arbitrum One bytecode, and **no transaction has ever
been broadcast from it in production**. Treat the first live vote as the shakedown run.

| Command | Signing key | RPC | On-chain write | State |
| --- | :---: | :---: | --- | --- |
| `status` | optional&nbsp;¹ | ✅ | never | ✅ shipped |
| `salt` | required | — | never | ✅ shipped |
| `commit` | required | ✅ | `castCommit`, only with `--broadcast` | ✅ shipped |
| `reveal` | required | ✅ | `castVote`, only with `--broadcast` | ✅ shipped |
| `vote` | required | ✅ | `castVote` in courts without hidden votes | 🚧 planned |
| `recover` | required | ✅ | never | 🚧 planned |

¹ `status` runs without a key if you pass `--address`, so you can inspect any juror's position.

## Requirements

- **Node.js ≥ 22** and [pnpm](https://pnpm.io)
- An **Arbitrum One RPC endpoint** (a public one works; set `ARBITRUM_RPC` for your own)
- The juror's **private key**, in a file this tool owns — see [Set up the key](#set-up-the-key)
- ETH on Arbitrum One in the juror's account: it sends its own transactions, there is no relayer

## Install

Not published to npm yet. Build from source:

```bash
git clone https://github.com/jaybuidl/kleros-juror-cli.git
cd kleros-juror-cli
pnpm install
pnpm build
pnpm link --global      # puts `kleros-juror` on your PATH
```

Or skip the link and run it in place with `pnpm dev status --dispute 154 …`.

## Set up the key

```bash
mkdir -p ~/.kleros-juror
printf '0x%s' "<64 hex chars>" > ~/.kleros-juror/key
chmod 600 ~/.kleros-juror/key
```

The key is read **only** from that file. There is deliberately no `--private-key` flag and no
`PRIVATE_KEY` environment variable: this process is meant to be launched by an agent gateway that
also runs model-authored shell commands, and anything in the environment is inherited by every
child process. A file is not a security boundary against a compromised host — but it is not
*ambient*, which is the difference that matters here.

The tool refuses to run if the file is readable by group or others.

## Quick start

```bash
# 1. Where does this dispute stand, and what do I still owe it?
kleros-juror status --dispute 154 --round 0 --votes 5,6,7

# 2. Dry run. This is the DEFAULT: it simulates and stops, sending nothing.
kleros-juror commit --dispute 154 --round 0 --votes 5,6,7 --choice 1

# 3. Actually publish the commitment.
kleros-juror commit --dispute 154 --round 0 --votes 5,6,7 --choice 1 --broadcast

# 4. Later, in the vote period. The salt is recomputed; nothing was stored.
kleros-juror reveal --dispute 154 --round 0 --votes 5,6,7 --choice 1 \
  --justification @reasons.md --broadcast
```

`--dispute`, `--round` and `--votes` come from upstream — `kleros juror draws`, a draw monitor, or
the block explorer. This tool does not look them up.

`--votes` takes **every** vote ID you hold in that round. Order and duplicates do not matter, but
the *set* must be identical between commit and reveal, or the reveal cannot match.

`--choice 0` means *refuse to arbitrate* and is always valid. `status` reports the valid range.

## How the salt is derived

```
seed   = keccak256( sign("kleros-juror-cli/v1/seed") )            ← memory only, never written
info   = "kleros-juror-cli/v1/salt|chain=42161|dk=<kit>|dispute=<id>|round=<n>|votes=<csv>"
salt   = uint256( HMAC-SHA256(key = seed, message = info) )
commit = keccak256( abi.encodePacked(uint256 choice, uint256 salt) )
```

`<csv>` is the **canonical** vote ID list: deduplicated, sorted *numerically* ascending, decimal,
comma-joined. The same canonical array is what goes on chain, so the two can never diverge. (A
lexicographic sort would put `10` before `9` and produce an unrevealable commitment.)

Two consequences worth internalising:

- **Nothing needs backing up but the key.** `reveal` re-derives the salt from scratch; it never
  reads it back from anywhere.
- **The signer is locked for the life of a commitment.** Change the key, or the seed source,
  between commit and reveal and the salt changes with it — the vote becomes unrevealable. The tool
  proves determinism rather than assuming it: it signs the same message twice at startup and aborts
  loudly if a non-RFC-6979 signer returns two different signatures.

The seed derives salts and nothing else. It authorises no transaction and holds no funds.

## Command reference

**Selecting the vote** — accepted by every command:

| Option | Default | Meaning |
| --- | --- | --- |
| `--dispute <id>` | *required* | Core dispute ID (the global one in `KlerosCore`) |
| `--round <n>` | `0` | Zero-based appeal round index |
| `--votes <csv>` | *required* | Vote IDs held in this round, e.g. `5,6,7` |
| `--dispute-kit <k>` | `classic` | `classic`, `gated`, or an address. Shutter kits are refused |
| `--rpc-url <url>` | `ARBITRUM_RPC`, else the public endpoint | Comma-separated for failover |
| `--home <dir>` | `~/.kleros-juror` | Directory holding the signing key |

**Writing** — `commit` and `reveal`:

| Option | Default | Meaning |
| --- | --- | --- |
| `--choice <n>` | *required* | The ruling, `0..numberOfChoices` |
| `--broadcast` | `false` | Actually send. Without it, simulate and stop |
| `--timeout <s>` | `120` | Seconds to wait for a receipt before reporting the outcome unknown |
| `--justification <s>` | `""` | *(reveal)* A literal string, `@path`, or `-` for stdin |
| `--allow-recommit` | `false` | *(commit)* Overwrite an existing commitment. Adds to `totalCommitted` again — see the warning below |

Every command is self-documenting: `kleros-juror --help`, `kleros-juror commit --help`.

## Output, and what to branch on

Output is **JSON on stdout by default**, because the primary consumer is a program. Every write
command returns the same envelope, with a `message` that states in words whether anything was sent:

```jsonc
{
  "ok": true,
  "command": "commit",
  "message": "SIMULATION ONLY — no transaction was sent and no commitment was published. Re-run with --broadcast to publish the commitment.",
  "chainId": 42161,
  "dispute": "154",
  "round": "0",
  "votes": ["5", "6", "7"],
  "choice": "1",
  "juror": "0x…",
  "period": "commit",
  "secondsRemaining": "1420",
  "commit": "0x…",
  "status": "simulated",
  "broadcast": false,
  "gas": "245000",
  "maxFeePerGas": "12000000",
  "estimatedFeeWei": "2940000000000",
  "estimatedFeeEth": "0.00000294",
  "warnings": []
}
```

Errors carry a stable machine-readable `code`, a human message, and a `cta` block naming the next
command to run:

```jsonc
{
  "code": "KEY_FILE_MISSING",
  "message": "No signing key at /home/juror/.kleros-juror/key. Write the juror's private key there and run: chmod 600 /home/juror/.kleros-juror/key. This tool does not accept a key from the environment or the command line.",
  "cta": {
    "description": "The signing key lives in a file this tool owns, mode 0600. It is never read from the environment or the command line.",
    "commands": [
      {
        "command": "kleros-juror status --dispute 154 --address <juror>",
        "description": "Inspect a dispute without a signing key"
      }
    ]
  }
}
```

**Branch on `code`, not on the exit status.** Exit codes are grouped for shell callers —
`1` usage · `2` key, config or wrong chain · `3` dispute state · `4` simulation reverted ·
`5` broadcast failed · `7` RPC error — but the payload is the real contract.

> [!WARNING]
> If a broadcast returns `"status": "unknown"`, the CLI stopped watching; the transaction may still
> land. Run `status` before retrying. Never re-send blindly — a duplicate `castCommit` adds to
> `totalCommitted` again and can permanently remove that dispute's early exit from the vote period.

## The rules it will not let you break

These are enforced in code, not left to the caller:

- **Chain 42161 only.** Every address, ABI fragment and salt here is specific to Arbitrum One; on
  another chain they are meaningless rather than merely wrong. The chain ID is checked before any
  call is built.
- **Classic and Gated dispute kits only.** Shutter kits use different cryptography and are refused
  *by name*, so you learn why rather than seeing "unknown address".
- **`commit`, `reveal` and `vote` are never substituted for one another.** Each has a different
  irreversible cost. An upstream `actionRequired` hint is only a hint: pre-flight independently
  reads `hiddenVotes` and the current period and refuses a mismatch.
- **Simulate first, always.** Every state-changing call is simulated; nothing is broadcast without
  an explicit `--broadcast`. Pre-flight checks period, deadline, choice bounds, vote ownership,
  prior commitments and account balance before a fee is ever paid.
- **The salt never leaks during the commit period.** `commit` never prints it — logging it would
  defeat the hiding the commitment exists to provide. `salt` prints it on request, which is
  deliberate and safe *after* you know what you are doing.
- **Evidence never enters this process.** Everything written in a dispute is authored by parties
  with an interest in the outcome. The separation is structural: attacker-authored text has no path
  to the signing key, because this tool never reads any.

> [!CAUTION]
> Vote windows are short — in court 34, 45 minutes to commit and 30 to reveal — and the deadline is
> an **upper bound, not an entitlement**. Both periods end early once every juror has acted, and
> closing a period is permissionless. Act as soon as you have decided; never wait out the window.

## Using it from an agent

The repo ships an agent skill at [`skills/kleros-juror/SKILL.md`](skills/kleros-juror/SKILL.md) —
the usage contract, the period→action table, and a troubleshooting table keyed on error `code`.

The framework-free core is also importable as a library, if you would rather build the calls
yourself than shell out:

```ts
import { canonicaliseVoteIds, deriveSalt, hashVote, checkPreflight } from "kleros-juror-cli";
```

Everything under `src/core/` is free of CLI concerns and returns a `KlerosResult<T>`; `src/commands/`
is the thin layer that owns argument parsing and output.

## Development

```bash
pnpm test        # unit + fork tests (fork tests skip when no fork is reachable)
pnpm test:fork   # spawn an Arbitrum One fork on :8546 and run only the fork tests (needs anvil)
pnpm typecheck
pnpm lint        # biome check .   (`pnpm exec biome check --write .` to fix)
pnpm build
pnpm dev status --dispute 154 --round 0 --votes 0 --address 0x…
```

The fork tests run against **real deployed bytecode**: they check that our `hashVote` agrees with
the on-chain hash function and that the derived salt reproduces a known vector end to end.

Contract addresses and the ten ABI fragments this tool calls are hand-pinned in
[`src/core/deployment.ts`](src/core/deployment.ts) rather than imported, because the deployed ABI
and the one compiled from `master` differ. `@kleros/kleros-v2-contracts` is a **devDependency** used
in exactly one file — a canary test that fails the build if anything upstream drifts.

## Design docs

| Where | What |
| --- | --- |
| [`CONTEXT.md`](CONTEXT.md) | The glossary. Casting vs deciding, choice vs ruling, and the synonyms to avoid |
| [`docs/adr/`](docs/adr/) | Five decisions a reader would otherwise question, with the options rejected |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement and invariants, for agents contributing to the repo |

The normative specification lives outside this repository, in the `kleros-v2` docs; a gitignored
symlink at `docs/research/` points at it on a developer machine and is simply absent in a fresh
clone. Every invariant that depends on it is restated in `CLAUDE.md` so nothing important is only
reachable through a dangling link.

## Roadmap

- [ ] `vote` — the single-transaction path for courts without hidden votes
- [ ] `recover` — brute-force which choice a stored commitment corresponds to, when the choice
      itself has been lost (the seed regenerates the salt, but never the choice)
- [ ] The full commit → `passPeriod` → reveal acceptance test, which needs an archive RPC
- [ ] Upstreaming into `@kleros/agentkit` once its write milestone lands

## Contributing

Issues and pull requests are welcome. Two things to know before you start:

1. **Read [`CONTEXT.md`](CONTEXT.md) first** and use its vocabulary — the terminology in this domain
   is full of near-synonyms that quietly mean different things (core dispute ID vs local dispute ID,
   choice vs ruling, commit-the-period vs commit-the-command).
2. **A change that alters salt derivation is a breaking change**, even if every test passes. Any
   commitment still in flight was made with the old derivation and can only be revealed with it.
   The version tag exists for exactly this reason; bumping it means keeping the old path alive.

If you are changing behaviour that an ADR covers, update the ADR in the same PR.

## Security

Please do not open a public issue for a vulnerability in vote handling, salt derivation, or key
management. Use GitHub's private vulnerability reporting on this repository, or contact the
maintainers directly.

This is alpha software holding a key whose stake can be penalised on chain. Read the code before
you point it at real stakes.

## License

MIT — see [LICENSE](LICENSE).
