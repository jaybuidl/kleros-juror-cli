/**
 * Library surface, kept framework-free so a port into `@kleros/agentkit` is a file
 * move rather than a rewrite (ADR-0001). Nothing here imports incur.
 */

export { type BroadcastResult, simulateAndMaybeBroadcast } from "./core/broadcast.js";
export { assertArbitrumOne, createKlerosClient, parseRpcUrls } from "./core/client.js";
export { hashVote, isEmptyCommitment } from "./core/commitment.js";
export {
  ACCEPTED_DISPUTE_KITS,
  ARBITRUM_ONE_CHAIN_ID,
  KLEROS_CORE,
  PERIODS,
  type Period,
  type ResolvedDisputeKit,
  resolveDisputeKit,
  SHUTTER_DISPUTE_KITS,
} from "./core/deployment.js";
export {
  checkPreflight,
  type PreflightFacts,
  type PreflightIntent,
  type VoteAction,
} from "./core/preflight.js";
export { readPreflightFacts, versionWarning } from "./core/read-preflight.js";
export { err, type KlerosResult, ok } from "./core/result.js";
export { decodeRevert } from "./core/reverts.js";
export { deriveSalt, SALT_VERSION_TAG, type SaltInputs, saltInfo } from "./core/salt.js";
export { deriveSeedFromSigner, SEED_ENV_VAR, SEED_MESSAGE, seedFromEnv } from "./core/seed.js";
export { keyFilePath, loadSigner, resolveHome } from "./core/signer.js";
export { type CanonicalVoteIds, canonicaliseVoteIds } from "./core/vote-ids.js";
