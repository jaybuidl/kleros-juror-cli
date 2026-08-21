# No Coinbase AgentKit action provider

Shipping this tool as a `@coinbase/agentkit` `ActionProvider` was the starting assumption. It was
rejected: three of the specification's normative MUSTs are unreachable through the
`ActionProvider` / `ViemWalletProvider` contract.

| Requirement | Why it is unreachable |
| --- | --- |
| `04 §3.1` — MUST `simulateContract` before every write | `ViemWalletProvider`'s `WalletClient` is `#private` with no getter. No `simulateContract`, no `writeContract`. |
| `04 §3.5` — MUST pass `confirmations: 1`, an explicit `timeout`, and `onReplaced` | `waitForTransactionReceipt(txHash)` accepts only a hash and returns `any`. |
| `03 §5`, `§6` — stable exit codes and structured JSON | `Action.invoke` returns `Promise<string>`; the in-repo convention is human-readable prose. |

Reaching them means escaping the abstraction via `getPublicClient()` / `toSigner()` for exactly the
parts that matter most, which leaves a wrapper over viem and no abstraction.

Two further disqualifiers, independent of the above:

- **Telemetry with no opt-out.** `@CreateAction` POSTs the wallet address, chain ID, action name
  and a timestamp to `cca-lite.coinbase.com` on every invocation. The transaction is already public
  on chain, so the incremental leak is IP↔juror-address linkage — but it cannot be disabled.
- **It can kill the process.** That analytics call is `async`, invoked with no `await` and no
  `.catch()`. Under Node's default unhandled-rejection behaviour a Coinbase outage can crash the
  process inside a 30-minute reveal window.

It also carries 41 runtime dependencies with zero peer dependencies, including `ethers` v6 and
`viem` pinned to an exact version, and requires legacy `experimentalDecorators`.

## Consequences

Reversal is cheap by construction, which is why deferring is safe rather than final: the core is
plain functions with no framework in the signing path, `ActionProvider` / `CreateAction` are public
exports usable from any package, and both shipped adapters (LangChain, Vercel AI) are ~20-line
`Action[] → tool()` maps. Revisit if a Vercel-AI agent actually exists.
