/**
 * Build-time stand-in for `@kleros/kleros-v2-contracts/cjs/deployments`.
 *
 * The package's barrel re-exports 95 typechain factories that `require("ethers")` at
 * module scope -- a dependency it never declares, resolved only by a hoisted wrong-major
 * copy. CommonJS is not tree-shakeable, so bundling the barrel drags all of it in: 6.5MB
 * of dist and an `ethers` we neither want nor call.
 *
 * Everything this tool actually uses sits in three leaf modules whose require graph is
 * just viem and each other. Reaching them needs relative paths because the package's
 * `exports` map declares no deep subpaths -- which is also why this is a bundler alias
 * (see tsup.config.ts) rather than an import the source could write directly.
 */
export { getDisputeKits as getDisputeKitsViem } from "../node_modules/@kleros/kleros-v2-contracts/cjs/deployments/disputeKitsViem.js";
export { deployments, getAddress } from "../node_modules/@kleros/kleros-v2-contracts/cjs/deployments/utils.js";
export * as mainnetViem from "../node_modules/@kleros/kleros-v2-contracts/cjs/deployments/mainnet.viem.js";
