---
name: kleros-juror
description: Commit and reveal Kleros v2 juror votes on Arbitrum One. Consult this skill when you have been drawn in a Kleros dispute and have already decided how to vote, and need to publish a vote commitment during the commit period or reveal it during the vote period.
version: 1.0.0
allowed-tools: "Bash(kleros-juror:*)"
metadata:
  openclaw:
    requires:
      bins:
        - kleros-juror
    emoji: "⚖️"
---

# kleros-juror

Casts a vote you have already decided. It never reads evidence and never decides how to vote — the
choice is always an argument you supply.

Output is JSON on stdout by default. Branch on the `code` field, not on the exit status.

## Before you can vote

`kleros-juror` does not discover disputes. Get `--dispute`, `--round` and `--votes` from
`kleros juror draws`, or from the draw monitor. Its `actionRequired` is a **hint**: this tool
re-derives the truth from chain state and refuses if they disagree.

The signing key lives at `~/.kleros-juror/key`, mode `0600`, managed outside this tool. **Never put
a private key on the command line, in an environment variable, or in your context.** There is no
flag for it and it will not be read from the environment.

## The three actions are never interchangeable

| Court | Commit period | Vote period |
| --- | --- | --- |
| `hiddenVotes: true` | `commit` | `reveal` |
| `hiddenVotes: false` | *never happens* | `vote` |

Each has a different irreversible on-chain cost. Run `status` first if you are unsure; it reports
`hiddenVotes` and an `actionRequired` derived from chain state.

## Usage

```bash
# Where does this dispute stand, and what do I still owe it?
kleros-juror status --dispute 154 --round 0 --votes 0

# Dry run: simulates and stops. This is the DEFAULT — nothing is sent.
kleros-juror commit --dispute 154 --round 0 --votes 0 --choice 1

# Actually publish the commitment.
kleros-juror commit --dispute 154 --round 0 --votes 0 --choice 1 --broadcast

# Later, in the vote period. The salt is recomputed from the key; nothing was stored.
kleros-juror reveal --dispute 154 --round 0 --votes 0 --choice 1 \
  --justification @reasons.md --broadcast
```

`--choice 0` means *refuse to arbitrate* and is always valid. Valid choices are `0..numberOfChoices`,
which `status` reports.

`--votes` takes every vote ID you hold in that round, comma-separated. Order and duplicates do not
matter, but **the set must be identical between commit and reveal** or the reveal cannot match.

## Nothing is sent without `--broadcast`

Every write command simulates and stops by default. A simulated result carries `"broadcast": false`
and a `message` saying so explicitly. Do not read it as a vote having been cast.

## Timing

Vote windows are short — 45 minutes to commit and 30 minutes to reveal in court 34 — and the
deadline is an **upper bound, not an entitlement**. Both periods end early once every juror has
acted, and anyone can close them. Act as soon as you have decided; do not wait out the window.

## When something goes wrong

Read `code` and follow `cta.commands`.

| `code` | What to do |
| --- | --- |
| `WRONG_SUBCOMMAND_FOR_COURT` | You picked commit/reveal/vote wrongly. Run `status` for `hiddenVotes`. |
| `WRONG_PERIOD` | Too early or too late. `status` reports the current period and deadline. |
| `DEADLINE_PASSED` | The window closed. Nothing can be done for this round. |
| `ALREADY_COMMITTED` | A commitment already exists. Do **not** re-commit casually: it distorts the vote period's early exit. |
| `COMMITMENT_MISMATCH` | The choice you are revealing is not the one you committed. Run `salt`, and check the round and vote ID set. |
| `CHOICE_OUT_OF_BOUNDS` | `status` reports the valid range. |
| `INSUFFICIENT_BALANCE` | The juror's own account pays; there is no relayer. Fund it with ETH on Arbitrum One. |
| `SIMULATION_REVERTED` | Nothing was broadcast and no fee was paid. The message explains why. |

If a broadcast returns `"status": "unknown"`, the CLI stopped watching — the transaction may still
land. **Run `status` before retrying.** Never re-send blindly: a duplicate `castCommit` permanently
damages the dispute's vote period.
