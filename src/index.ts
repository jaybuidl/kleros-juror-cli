/**
 * Library surface, kept framework-free so a port into `@kleros/agentkit` is a file
 * move rather than a rewrite (ADR-0001). Nothing here imports incur.
 */
export { hashVote, isEmptyCommitment } from "./core/commitment.js";
export { assertArbitrumOne, createKlerosClient, parseRpcUrls } from "./core/client.js";
export {
  ACCEPTED_DISPUTE_KITS,
  ARBITRUM_ONE_CHAIN_ID,
  KLEROS_CORE,
  PERIODS,
  resolveDisputeKit,
  SHUTTER_DISPUTE_KITS,
  type Period,
  type ResolvedDisputeKit,
} from "./core/deployment.js";
export {
  checkPreflight,
  type PreflightFacts,
  type PreflightIntent,
  type VoteAction,
} from "./core/preflight.js";
export { readPreflightFacts, versionWarning } from "./core/read-preflight.js";
export { err, ok, type KlerosResult } from "./core/result.js";
export { decodeRevert } from "./core/reverts.js";
export { deriveSalt, saltInfo, SALT_VERSION_TAG, type SaltInputs } from "./core/salt.js";
export { deriveSeedFromSigner, SEED_ENV_VAR, SEED_MESSAGE, seedFromEnv } from "./core/seed.js";
export { loadSigner, keyFilePath, resolveHome } from "./core/signer.js";
export { canonicaliseVoteIds, type CanonicalVoteIds } from "./core/vote-ids.js";
export { simulateAndMaybeBroadcast, type BroadcastResult } from "./core/broadcast.js";
