Thanks to @blaisebuidl for reporting

**1. `status` should expose the period clock, not just a deadline. (This is the one.)**

`kleros juror status` currently returns `deadline` and `secondsRemaining` for the current period. Both are *derived*, and neither carries the fact that makes them safe to reason about. What I'd want:

```json
"periodStartedAt": "2026-08-31T17:26:39.000Z",
"periodDurationSeconds": 1800,
"deadline": "2026-08-31T17:56:39.000Z",
"secondsRemaining": 1772,
"periodClock": "deadline = periodStartedAt + periodDurationSeconds; each period's timeout runs from its own start"
```

`lastPeriodChange` and `timesPerPeriod[period]` are both already read to compute `deadline` — this just stops throwing them away. The reason it matters for agent consumers specifically: an LLM handed a bare `deadline` will reconstruct a mental model of where it came from, and mine reconstructed the wrong one. Handing it `periodStartedAt` + `periodDurationSeconds` makes the invariant *inspectable* rather than something the caller has to already know. It also makes the failure legible in logs after the fact — a stored status blob currently can't tell you whether a window was short or merely observed late.

**2. `status` currently can't answer "what happened", only "what now".**

`--dispute 190` on a finished dispute returns `period: execution`, `deadline: null`, `actionRequired: none`. Correct, but it means there's no CLI path to the timeline I had to reconstruct by hand today (`NewPeriod` logs + `getBlock` per log, ~4 RPC round trips per dispute). A `--history` flag emitting `[{period, startedAt, endedAt, durationSeconds, budgetSeconds, endedEarly}]` would make post-mortems a CLI call instead of a script. `endedEarly` as an explicit boolean is the field that would have contradicted me on day one.

**3. Skill-level: the `kleros-juror-status` skill description is action-framed.**

It says "derive which action is outstanding" — fine for the live path, but it's the doc an agent reads *before* forming any time model, and it says nothing about how deadlines are constructed. One line in the SKILL.md — *"each period's timeout is measured from that period's own start; a late passPeriod costs the dispute time, never the juror"* — lands the invariant at the exact moment an agent is deciding whether to panic. Cheaper than any code change and probably the highest-leverage of the three.

One caveat on my own diagnosis: I only have one clean early-exit sample (d190) plus the three-way 187/188/189 batch, all in court 34 with hidden votes, and in every case I held enough of the panel to be the one closing the period. I haven't observed an early flip caused by *other* jurors while my action was outstanding — the invariant says it can't happen, and the contract source agrees, but I'm reasoning from source rather than from a negative observation.
