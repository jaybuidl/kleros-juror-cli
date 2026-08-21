import type { PublicClient } from "viem";
import { createPublicClient, fallback, http } from "viem";
import { arbitrum } from "viem/chains";
import { ARBITRUM_ONE_CHAIN_ID } from "./deployment.js";
import { err, type KlerosResult, ok } from "./result.js";

export const DEFAULT_RPC_URLS = ["https://arb1.arbitrum.io/rpc"] as const;

/**
 * A read client over one or more Arbitrum One endpoints.
 *
 * `fallback` retries the next endpoint on transport failure, which covers the
 * most likely "stuck" cause on this chain: an endpoint that accepted a request
 * and did not forward it (`04 §2`). It is not a substitute for the chain check
 * below -- a fallback list pointed at the wrong network would still be wrong.
 */
export function createKlerosClient(rpcUrls: readonly string[] = DEFAULT_RPC_URLS): PublicClient {
  const urls = rpcUrls.length > 0 ? rpcUrls : DEFAULT_RPC_URLS;
  return createPublicClient({
    chain: arbitrum,
    transport: fallback(urls.map((url) => http(url))),
  });
}

/** Parse `ARBITRUM_RPC`, which may hold a comma-separated list. */
export function parseRpcUrls(value: string | undefined): string[] {
  if (!value) return [...DEFAULT_RPC_URLS];
  const urls = value
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  return urls.length > 0 ? urls : [...DEFAULT_RPC_URLS];
}

/**
 * `03 §9.1`. Every address, ABI fragment and salt in this tool is specific to
 * chain 42161; on any other chain they are meaningless rather than merely wrong.
 */
export async function assertArbitrumOne(client: PublicClient): Promise<KlerosResult<number>> {
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (cause) {
    return err("RPC_ERROR", "Could not read the chain ID from the configured RPC endpoint.", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (chainId !== ARBITRUM_ONE_CHAIN_ID) {
    return err(
      "WRONG_CHAIN",
      `Connected to chain ${chainId}, but this tool only operates on Arbitrum One ` +
        `(${ARBITRUM_ONE_CHAIN_ID}).`,
      { chainId, expected: ARBITRUM_ONE_CHAIN_ID },
    );
  }

  return ok(chainId);
}
