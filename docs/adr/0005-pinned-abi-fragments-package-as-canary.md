# ABI fragments are pinned in-repo; the contracts package is a test-only canary

> **Superseded by [ADR-0006](0006-deployment-imported-from-contracts-package.md).** The `01 §2`
> requirement below still holds, but the package ships the deployed artifacts, so importing it
> satisfies that requirement rather than violating it — as the fingerprint tests this ADR
> introduced have always demonstrated. Kept for the reasoning, not as current practice.

`01 §2` requires binding to the **deployed** ABI and forbids one compiled from
`master` — the deployed dispute kit reverts with `require` strings and exposes a single
`getDegreeOfCoherence`, where `master` has custom errors and a Reward/Penalty pair. Importing an
ABI from a package means inheriting whatever that package was last generated from.

So `src/core/deployment.ts` pins the four addresses from `01 §1` and hand-written fragments for the
ten functions this tool actually calls, taken from `01 §3` and `01 §7` — including the misspelled
`totalCommited` in the `getRoundInfo` tuple, which is part of the ABI.

`@kleros/kleros-v2-contracts` remains the source of truth, as a **devDependency**:
`deployment.test.ts` asserts every pinned address and fragment against its `mainnet` export, plus
both `01 §2` fingerprints. An upstream change fails the build instead of a reveal.

## The second reason

`@kleros/kleros-v2-contracts@2.0.0-rc.2` ships CommonJS in its `esm/` directory while
`package.json` maps the `import` condition there, so importing it from a `"type": "module"` package
throws `ReferenceError: exports is not defined in ES module scope`. The test reaches it through the
`cjs/deployments` subpath, which is why that import appears in exactly one file.

Worth reporting upstream. It is the same class of packaging problem `@kleros/agentkit` worked around
by bundling the package into its build.

## Consequences

The pinned fragments are also fully typed, where the package's `getContractsViem` handles expose
`readonly any[]` ABIs and index-signature `read` methods — so `getVoteInfo`'s tuple would arrive
untyped. Do not "fix" `deployment.ts` by importing the package; read `deployment.test.ts` first.
