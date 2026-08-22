# Addresses and ABIs come from the contracts package, bundled at build time

Supersedes [ADR-0005](0005-pinned-abi-fragments-package-as-canary.md).

`src/core/deployment.ts` hand-pinned five Arbitrum One addresses and fourteen ABI fragments — five
on KlerosCore, nine on the dispute kit. It now imports them from `@kleros/kleros-v2-contracts`, and
asks `getDisputeKitsViem` which kit is which.

## Why ADR-0005's argument does not hold

ADR-0005 rests on `01 §2`: bind to the **deployed** ABI, never one compiled from `master`. That
requirement is real and unchanged. What ADR-0005 got wrong is the conclusion that a package import
must therefore be avoided — the package ships the deployed artifacts, not `master`. The proof is
the test ADR-0005 itself introduced: `deployment.test.ts` asserts both `01 §2` fingerprints — no
custom errors for the voting logic, a single `getDegreeOfCoherence` — and it has always asserted
them **against the package's ABI**. Those tests still run, now pointed at the imported ABI, so a
package regenerated from `master` fails the build exactly as before. The canary did not go away;
it moved from guarding a copy to guarding the import.

Addresses were never covered by a MUST at all. `01 §1` requires only that a *configured* kit
address be verified as Classic or Gated and refused if Shutter — a constraint on verification, not
on provenance. ADR-0005 bundled addresses into an argument whose every premise (`master` drift,
regeneration, typing) is ABI-specific.

ADR-0005's typing objection was also too broad. `getContractsViem`'s contract *handles* do expose
`readonly any[]`, but the raw `klerosCoreAbi` / `disputeKitClassicAbi` consts are fully literal
(`readonly [{ readonly type: "fallback"; … }]`), so viem keeps tuple inference on `getVoteInfo`.

## What we gain

The dispute kit **ID**. `getDisputeKitsViem` returns `disputeKitID → {address, isGated, isShutter}`,
which nothing in this codebase could previously obtain, and `status` now reports it.

## The ESM defect, handled rather than avoided

`@kleros/kleros-v2-contracts@2.0.0-rc.2` maps its `import` condition at `esm/`, whose files are
CommonJS under an `esm/package.json` declaring `"type": "module"`, so importing the package root
throws `ReferenceError: exports is not defined`. Source therefore imports the `cjs/deployments`
subpath, and tsup bundles it — the same workaround `@kleros/agentkit` applied.

Two consequences worth knowing:

- The barrel re-exports 95 typechain factories that `require("ethers")` at module scope, a
  dependency the package never declares and which resolves only to a hoisted wrong-major copy.
  CommonJS is not tree-shakeable, so bundling the barrel produced a 6.5MB chunk containing `ethers`.
  `build/kleros-deployments.mjs` reaches the three leaf modules directly instead — their require
  graph is only viem — which cuts the chunk to 1.7MB with no `ethers` at all. It exists as a
  bundler alias rather than a plain import because the package's `exports` map declares no deep
  subpaths.
- Those leaf modules are CommonJS and `require("viem")`. esbuild cannot satisfy that in ESM output
  while viem stays external, and its fallback throws on first call, so `tsup.config.ts` emits a
  `createRequire` banner into every output file — including the shared chunk, which evaluates
  before the entry and so cannot be fixed from there.

Because the code is bundled, the package stays a **devDependency**: shipping it as a runtime
dependency would put 54MB, plus `@shutter-network/shutter-sdk`, into every install for something
the built artifact never loads.

## Costs accepted

`dist` grows from 176KB to 4.8MB (1.7MB of JS, the rest sourcemaps) and cold start from ~0.30s to
~0.48s. Most of the JS is the testnet and devnet deployment data that `contractsViem` pulls in
alongside mainnet.

## What did not change

Salt derivation folds in the kit address, and a changed address makes an in-flight commitment
unrevealable. The package's addresses are byte-identical to the previously pinned ones, verified
against the live chain and locked by a regression test in `deployment.test.ts` that compares them
to the historical literals. That test is the one place a hardcoded address is still correct,
because its job is to detect drift rather than to configure anything.
