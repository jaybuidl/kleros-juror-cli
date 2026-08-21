# Standalone repo, shaped for upstreaming into `@kleros/agentkit`

Kleros AgentKit is read-only and its write milestone is unscheduled, while an autonomous juror
agent needs to vote now. This repo is therefore a separate spike rather than a branch of AgentKit
— but it mirrors AgentKit's conventions (`incur`, a framework-free `core/` returning
`KlerosResult<T>`, a thin `commands/` layer, CTA blocks, `--format json`) so the eventual port is
close to a file move rather than a rewrite.

## Considered options

- **Depend on `@kleros/agentkit` as a library.** Rejected: couples an urgent path to AgentKit's
  release cadence and planning process, and its `exports` map only exposes `.` for a read-oriented
  surface.
- **Build the write commands directly in AgentKit.** Rejected: AgentKit serves a broad audience
  across several chains and setups, which drags in wallet middleware, multi-chain key handling and
  a general `--dry-run` story. This spike defers all of that deliberately.
- **Fully standalone with its own conventions.** Rejected: discards the spike's second purpose,
  which is to tell AgentKit how writes should work in runnable code rather than in prose.

## Consequences

The scope line is **casting**, not **deciding**. Turning an already-made decision into a
transaction is frontend-parity work and sits inside AgentKit's scope principle; choosing *what* to
vote for is higher-level analysis and stays outside both projects. See `CONTEXT.md`.
