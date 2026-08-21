# kleros-juror-bot

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Reference material

Read-only material living outside this repo, reached through **gitignored symlinks** — absent in a fresh clone, so re-create them locally if you need them. Neither is a build dependency; both exist to be read.

- **Juror CLI design docs** — `docs/research/` → `docs/juror-cli-master` in the `kleros-v2` checkout. Onchain reference, commit-reveal, CLI surface, transaction relaying, verification.
- **Coinbase AgentKit** (`coinbase/agentkit`) — `coinbase-agentkit/` → a read-only upstream clone kept alongside this repo.
