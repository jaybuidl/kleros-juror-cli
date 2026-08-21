# Broadcast is opt-in, and there is no human confirmation gate

`03 §7` requires an interactive confirmation before every write, skipped when stdin is not a TTY.
The primary consumer is an autonomous agent, so that gate never fires — and the paths it runs under
supply nothing in its place. OpenClaw's `command`-payload cron "executes inside the Gateway process
as admin-authored automation" and is explicitly not governed by the agent's exec-approval policy;
on the interactive exec path, a single `allow-always` writes a persistent allowlist entry keyed on
the resolved binary path and permanently disarms the prompt.

The gate therefore lives inside the tool:

1. **Pre-flight reads** — period, `hiddenVotes` versus the chosen subcommand, vote ownership,
   existing commitment, deadline, balance — reject every chain-detectable error locally.
2. **`simulateContract`** catches the rest before a fee is paid.
3. **Sending requires an explicit `--broadcast`.** The default is plan, simulate, stop.

## What this deliberately does not catch

A well-formed vote for the *wrong choice*. Nothing on chain contradicts a wrong `--choice`, and
that is precisely what the human was eyeballing at the TTY prompt. Asserting the choice against the
dispute template's answer text would catch it, but that means resolving templates from IPFS — which
belongs upstream, where the decision is made and the template is already loaded. See ADR-0001 on
the casting/deciding line.

## Consequences

A caller that forgets `--broadcast` gets a successful simulation and no vote. That must be
unmistakable in the output rather than reading as success: the result carries `"broadcast": false`
and states in words that nothing was sent. This matters more than usual because the consuming
agent sees merged stdout/stderr text and an effectively binary exit code, so failure semantics have
to live in the payload.
