# Kleros juror CLI

The language of committing and revealing a Kleros v2 juror vote on Arbitrum One. This tool turns a
decision that has already been made into a transaction; it does not make the decision.

## Language

### The scope boundary

**Casting**:
Turning an already-chosen choice into an on-chain `castCommit` or `castVote`. The whole of this
tool's job.
_Avoid_: voting (ambiguous — `vote` is also a subcommand and a period)

**Deciding**:
Choosing which choice to vote for, by reasoning over a dispute and its evidence. Happens upstream,
outside this repo, and its output reaches this tool only as `--choice`.
_Avoid_: analysis, judging, reasoning

**Discovery**:
Finding which disputes an address is drawn in, and which vote IDs it holds. Supplied upstream by
`kleros juror draws`; never performed here.
_Avoid_: monitoring, polling

### The vote

**Choice**:
One of the `0..numberOfChoices` options a juror can vote for. `0` means refuse to arbitrate and is
always valid.
_Avoid_: ruling, answer, verdict, vote

**Ruling**:
The arbitrator's *output*: the winning choice `KlerosCore` reports through `currentRuling`, the
`Ruling` event, and `IArbitrableV2.rule`. Jurors supply choices; the dispute kit aggregates them
into a winning choice, and only that becomes the ruling. A juror never casts one, and this tool
never produces one — it is an input away from the end of the pipeline, not the end of it.
`docs/research/00 §116` calls a choice "the ruling option"; this glossary deliberately overrides it.
_Avoid_: using it for `--choice`, or for anything a single juror does

**Salt**:
The `uint256` that blinds a commitment. Always recomputed from the seed, never stored or read back.
_Avoid_: nonce, blinding factor

**Seed**:
The 32 bytes every salt derives from, obtained by signing a fixed message with the juror's key. Held
only in memory.
_Avoid_: master key, secret (it authorises nothing and holds no funds)

**Commitment**:
`keccak256(abi.encodePacked(uint256 choice, uint256 salt))` — the `bytes32` published during the
commit period.
_Avoid_: hash, commit hash, vote hash

**Vote ID**:
The index of a single vote within a round. One drawn juror may hold several, and votes them
together in one transaction.
_Avoid_: draw ID, ballot

**Canonical vote IDs**:
A vote ID list deduplicated, sorted numerically ascending, rendered decimal and comma-joined. The
one form used both to derive the salt and as the on-chain array — the two can never diverge.

**Justification**:
The free text accompanying a reveal. Emitted in the `VoteCast` event, never stored on chain, and
not part of the commitment.

### The chain

**Juror**:
The address that owns a vote. It must be the transaction sender; there is no delegation or
meta-transaction path.
_Avoid_: voter, operator, agent

**Dispute kit**:
The pluggable contract implementing a voting method. Classic and Gated are accepted; Shutter is
refused by name.
_Avoid_: DK (except in the salt `info` string, where it is fixed)

**Dispute kit ID**:
The index KlerosCore registers a kit under, in `disputeKits[]` — Classic is `1` on Arbitrum One.
Reported by `status` as `disputeKitId`. It identifies the kit contract, not a dispute; it is
unrelated to the core dispute ID, and nothing takes it as an argument.
_Avoid_: kit index, DK ID

**Core dispute ID**:
The global dispute identifier in `KlerosCore.disputes[]`. What `--dispute` takes. Distinct from the
kit-internal local dispute ID, which is only needed to read `numberOfChoices`.
_Avoid_: dispute ID (unqualified — the ambiguity is the trap)

**Round index**:
The zero-based index of an appeal round within a dispute. An appeal re-draws the panel, so the same
address can hold votes in more than one round of the same dispute.

**Period**:
One of `evidence`, `commit`, `vote`, `appeal`, `execution`. `commit` is entered only in courts with
`hiddenVotes`.
_Avoid_: phase, stage

**Deadline**:
`lastPeriodChange + timesPerPeriod[period]`. An upper bound, never an entitlement — both the commit
and the vote period end early once every juror has acted, and `passPeriod` is permissionless.

**Period duration**:
`timesPerPeriod[period]` — the *nominal* budget a period is allowed, and never the time it actually
took. The two come apart whenever a period ends early: the duration is unchanged, the elapsed time
is shorter. Undefined for `execution`, which has no budget.
_Avoid_: budget, window length; and never "duration" for the time a period actually took — that is
elapsed time

**Neo**:
The name of the Arbitrum One production deployment, as in `DisputeKitClassicNeo`. A deployment
name, not a contract.
