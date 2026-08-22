# Alias testnet/devnet deployment modules to stubs at build time

Status: ready-for-agent

## Problem

Importing the deployment data from `@kleros/kleros-v2-contracts` (ADR-0006) grew the bundle by 34×:

| | Before | After |
| --- | --- | --- |
| `dist` total | 176 KB | 4.8 MB |
| JS only | 52,268 B | 1,789,799 B |
| Cold start (`node dist/cli.js --help`) | ~0.296 s | ~0.48 s |

Most of that JS is dead weight. `build/kleros-deployments.mjs` pulls in
`cjs/deployments/disputeKitsViem.js`, which requires `contractsViem.js`, which unconditionally
requires **all three** deployment artifacts:

```js
require("./devnet.viem")   // ~24.8k lines
require("./mainnet.viem")  // ~14.4k lines — the only one we use
require("./testnet.viem")
```

`contractsViem` then picks one with a `switch (deployment)`. CommonJS is not tree-shakeable, so the
other two are bundled and never executed.

## Why stubbing is safe here

`src/core/deployment.ts` hardcodes `const DEPLOYMENT = "mainnet"`, and it is the only caller. The
CLI is Arbitrum One only by a spec MUST (`00`: "MUST target chain ID 42161 and refuse any other
chain"), and `assertArbitrumOne` enforces it before any kit lookup runs. Neither `testnet.viem` nor
`devnet.viem` can be reached at runtime.

## Approach

Add esbuild aliases in `tsup.config.ts` mapping `./testnet.viem.js` and `./devnet.viem.js` to a stub
that exports the same names as empty objects, alongside the existing alias. Expect the JS to drop
to roughly the size of `mainnet.viem` plus viem glue.

## Watch out

- **This is a build-time-only trick and it fails loudly, not quietly, only if someone changes
  `DEPLOYMENT`.** Make the stub *throw* on property access rather than return `undefined`, so a
  future `--deployment testnet` surfaces as an error naming this file instead of a confusing
  "no address found for chainId".
- Leave a comment in the stub pointing back here and at ADR-0006.
- Guard it with a test asserting the built bundle stays under a size ceiling, otherwise the next
  upstream bump silently undoes the win.

## Verification

- `pnpm build`, then compare `du -sh dist` and JS byte count against the table above.
- Re-run the salt vectors — `salt`, `commit` and the kit address must stay byte-identical, since
  salt derivation folds in the kit address. Baseline: `--dispute 154 --round 0 --votes 5,6,7
  --choice 1` → salt `0xe9a8062c2acad135573ff4141fec8a7edccdf08c80a688e2426d32dee5dece0b`.
- `node dist/cli.js status --dispute 154 --round 0 --votes 0 --address 0x…01` must still report
  `"disputeKitId": "1"`.
- `npm pack` + `npm install --omit=dev <tarball>` and run the binary, to confirm the stub did not
  break the prod-only install path.
