About `@kleros/agentkit`: it is the main Kleros CLI tool which also capable of acting as a MCP. In its current state, it is read-only. It allows users to fetch all sorts of information for Kleros v1 and v2, and it's very LLM-friendly. But it's not yet ready for write operations and wallet signing etc. So the current project can be seen as a spike or a prototype of how those write operations could be implemented. It's also very much urgently needed because I have an AI agent expected to run autonomously as a Kleros juror, and right now it's not able to vote. So this project is also answering my personal pressing needs, whereas `@kleros/agentkit` is intended to serve a broader audience with various setup/runtime.

Q1. Answer a) . This tool does not need to decide anything if the decision is taken upstream by the user with the help of its LLM armed with `@kleros/agentkit`

Q2. Good question. Right now it's an OpenClaw agent. It may also be a Claude Code CLI tool, but not a MCP at this time. In the future a more production-grade implementation of this bot should be baked with the Vercel AI stack.

Q3. A human audience is not the primary target user, but very much a debug surface. Based on my experience with `@kleros/agentkit`, this means that the CLI must be very much self-documenting, somewhat like what `incur` does. Not sure if it needs to be built on `incur`.

Q4. Answer (b)

Q5. It depends on the data source we're going to use. Using a RPC, we can use an Anvil fork. But if we're using the subgraph, it's tricky because I think that it doesn't support querying for a specific block number (that feature was deprecated a few years ago if I remember well). Both sources have their own downsides. Subgraphs are more complex and more likely to lag, overkill for simple log queries. On the other hand RPCs have many restrictions on the depth of the event log queries. But that's not an issue for us since we're querying very recent block ranges and we will be using a production-grade RPC provider (Alchemy). And yes we could do also do a test on Arbitrum Sepolia (= v2 testnet), which is different set of contracts. But if we can test everything on an Anvil fork it's good enough imo.


