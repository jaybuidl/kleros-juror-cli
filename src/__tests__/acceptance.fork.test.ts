import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
  pad,
  publicActions,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashVote } from "../core/commitment.js";
import {
  ACCEPTED_DISPUTE_KITS,
  DISPUTE_KIT_ABI,
  KLEROS_CORE,
  KLEROS_CORE_ABI,
} from "../core/deployment.js";
import { deriveSalt } from "../core/salt.js";
import { deriveSeedFromSigner } from "../core/seed.js";

/**
 * The central acceptance criterion, `05 §5.3`: a commit followed by a reveal
 * succeeds on a fork with **no state carried between the two invocations**, and it
 * MUST be tested by running the two commands as separate processes.
 *
 * This tool carries even less than the spec allows for. `02 §2` assumes a seed
 * file; ADR-0003 replaced it with a seed derived from the signing key, and no
 * `commits.jsonl` is written either. So the only thing shared between the two
 * processes below is the key file — and the assertions check that, rather than
 * assuming it.
 *
 * Needs an **archive** RPC, because the fork has to be pinned at a block where a
 * real dispute was mid-commit-period. Set `KLEROS_ARCHIVE_RPC`, or use
 * `pnpm test:acceptance`. Skipped otherwise, so `pnpm test` stays green offline.
 */
const ARCHIVE_RPC = process.env.KLEROS_ARCHIVE_RPC;

/** Its own port, so a fork left running for `pnpm test:fork` on 8546 is untouched. */
const PORT = 8547;
const FORK_RPC = `http://127.0.0.1:${PORT}`;

/**
 * The pinned fixture, all of it re-derivable from the chain.
 *
 * Dispute 154 is a Classic dispute in court 34, which hides votes. Block 496599679
 * is the first block of its commit period, found by binary searching
 * `disputes(154).period` over block height — the period only ever increases for a
 * given dispute, so the transition is a clean boundary. At that block nothing has
 * been committed yet, and vote IDs 2 and 4 both belong to a single drawn juror,
 * which lets one commitment cover two votes the way a real draw usually does.
 */
const FORK_BLOCK = 496_599_679n;
const DISPUTE = 154n;
const ROUND = 0n;
const VOTE_IDS = [2n, 4n] as const;
const DRAWN_JUROR: Address = "0xD44Ca97bCd957b410a6e0A7109323cfD9ad814bE";
/** `getTimesPerPeriod(34)[1]`, the commit window. */
const COMMIT_PERIOD_SECONDS = 2700n;
const CHOICE = 1n;

const kit = ACCEPTED_DISPUTE_KITS.classic;
const ONE_ETH = 10n ** 18n;

/** Test-side only. The CLI never calls `passPeriod`, so it is not in the pinned ABI. */
const PASS_PERIOD_ABI = [
  {
    type: "function",
    name: "passPeriod",
    stateMutability: "nonpayable",
    inputs: [{ name: "_disputeID", type: "uint256" }],
    outputs: [],
  },
] as const;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliEntry = join(repoRoot, "src", "cli.ts");

const publicClient = createPublicClient({ chain: arbitrum, transport: http(FORK_RPC) });
const testClient = createTestClient({
  chain: arbitrum,
  mode: "anvil",
  transport: http(FORK_RPC),
}).extend(publicActions);

/** A throwaway juror for this run: nothing about the flow may depend on which key it is. */
const jurorKey = generatePrivateKey();
const juror = privateKeyToAccount(jurorKey);

let anvil: ChildProcess | undefined;
let home: string;

function startFork(): Promise<void> {
  const child = spawn(
    "anvil",
    [
      "--fork-url",
      ARCHIVE_RPC as string,
      "--fork-block-number",
      FORK_BLOCK.toString(),
      "--port",
      String(PORT),
      "--silent",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  anvil = child;

  // Kept only to explain a startup failure; anvil is otherwise silent.
  let diagnostics = "";
  child.stdout?.on("data", (chunk) => {
    diagnostics += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk);
  });

  return (async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`anvil exited with ${child.exitCode}. Output:\n${diagnostics}`);
      }
      const chainId = await publicClient.getChainId().catch(() => null);
      if (chainId !== null) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`anvil did not accept connections on ${PORT} within 90s.\n${diagnostics}`);
  })();
}

/**
 * Hand the drawn juror's votes to the address this test holds the key for.
 *
 * `05 §2.2` says to impersonate the drawn juror, but impersonation only reaches
 * `eth_sendTransaction`, and this CLI signs its own transactions with its own key
 * and refuses to act on votes that key does not own. So the fork is edited from the
 * other side: `Vote.account` is rewritten to the test address, and everything
 * downstream — the contract's own `msg.sender` check included — then runs unmodified.
 *
 * The slots are **discovered, not computed**. `eth_createAccessList` reports exactly
 * which storage `castCommit` touches, and the entries holding the drawn juror's
 * address are the `Vote.account` fields. That keeps a storage layout out of this
 * file, and the read-back below turns a future layout change into a loud failure
 * rather than a test that silently stops testing anything.
 */
async function reassignVotes(to: Address): Promise<void> {
  await testClient.setBalance({ address: DRAWN_JUROR, value: ONE_ETH });

  const data = encodeFunctionData({
    abi: DISPUTE_KIT_ABI,
    functionName: "castCommit",
    args: [DISPUTE, [...VOTE_IDS], `0x${"11".repeat(32)}`],
  });
  const probe = (await publicClient.request({
    method: "eth_createAccessList" as never,
    params: [
      { from: DRAWN_JUROR, to: kit.address, data, gas: "0x1000000", gasPrice: "0x0" },
      "latest",
    ] as never,
  })) as { error?: string; accessList: { address: Address; storageKeys: Hex[] }[] };
  expect(
    probe.error,
    "castCommit must be callable by its owner at the pinned block",
  ).toBeUndefined();

  const touched =
    probe.accessList.find((entry) => entry.address.toLowerCase() === kit.address.toLowerCase())
      ?.storageKeys ?? [];
  const owned = pad(DRAWN_JUROR.toLowerCase() as Hex, { size: 32 });

  const rewritten: Hex[] = [];
  for (const slot of touched) {
    const value = await publicClient.getStorageAt({ address: kit.address, slot });
    if (value?.toLowerCase() !== owned) continue;
    await testClient.setStorageAt({
      address: kit.address,
      index: slot,
      value: pad(to.toLowerCase() as Hex, { size: 32 }),
    });
    rewritten.push(slot);
  }
  expect(rewritten, "one Vote.account slot per vote ID").toHaveLength(VOTE_IDS.length);

  for (const voteId of VOTE_IDS) {
    const [account, commit, , voted] = await publicClient.readContract({
      address: kit.address,
      abi: DISPUTE_KIT_ABI,
      functionName: "getVoteInfo",
      args: [DISPUTE, ROUND, voteId],
    });
    expect(account).toBe(to);
    expect(commit, "the fixture block must precede any commitment").toBe(`0x${"0".repeat(64)}`);
    expect(voted).toBe(false);
  }
}

type CliRun = { exitCode: number; stdout: string; stderr: string; json: Record<string, unknown> };

/**
 * Run the CLI the way the consuming agent does: a fresh process, arguments only.
 * `05 §5.3` turns on this being a real process boundary, so nothing is imported and
 * called in-band. The environment is scrubbed of the variables that would otherwise
 * let a developer's shell decide the seed or the endpoint.
 */
function runCli(args: string[]): Promise<CliRun> {
  const env = { ...process.env };
  delete env.KLEROS_JUROR_SEED;
  delete env.KLEROS_JUROR_HOME;
  delete env.ARBITRUM_RPC;

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", cliEntry, ...args, "--rpc-url", FORK_RPC, "--home", home],
      { cwd: repoRoot, env, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code as number)
            : 0;
        try {
          resolve({ exitCode, stdout, stderr, json: JSON.parse(stdout) });
        } catch {
          reject(new Error(`CLI did not print JSON (exit ${exitCode}).\n${stdout}\n${stderr}`));
        }
      },
    );
  });
}

describe.skipIf(!ARCHIVE_RPC)(
  "acceptance: commit then reveal, separate processes (`05 §5.3`)",
  () => {
    beforeAll(async () => {
      await startFork();

      home = mkdtempSync(join(tmpdir(), "kleros-juror-acceptance-"));
      writeFileSync(join(home, "key"), jurorKey, { mode: 0o600 });

      await reassignVotes(juror.address);
      await testClient.setBalance({ address: juror.address, value: ONE_ETH });
    }, 120_000);

    afterAll(() => {
      anvil?.kill("SIGTERM");
      if (home) rmSync(home, { recursive: true, force: true });
    });

    it("records the vote, with nothing carried between the two processes", async () => {
      // The salt this run must produce, derived here so the assertions below can be
      // about a known value rather than about whatever the CLI happened to print.
      const seed = await deriveSeedFromSigner((message) => juror.signMessage({ message }));
      if (!seed.success) throw new Error(seed.message);
      const salt = deriveSalt(seed.data, {
        chainId: 42161,
        disputeKit: kit.address,
        dispute: DISPUTE,
        round: ROUND,
        voteIdsCsv: VOTE_IDS.join(","),
      });
      const expectedCommitment = hashVote(CHOICE, salt);

      // --- process 1: commit -------------------------------------------------
      // Vote IDs deliberately unsorted and duplicated: the commitment goes on chain
      // over the canonical array, and a lexicographic sort here would strand it.
      const commit = await runCli([
        "commit",
        "--dispute",
        DISPUTE.toString(),
        "--round",
        ROUND.toString(),
        "--votes",
        "4,2,2",
        "--choice",
        CHOICE.toString(),
        "--broadcast",
      ]);

      expect(commit.exitCode).toBe(0);
      expect(commit.json.ok).toBe(true);
      expect(commit.json.status).toBe("mined");
      expect(commit.json.votes).toEqual(["2", "4"]);
      expect(commit.json.commit).toBe(expectedCommitment);

      // `03 §6` and acceptance criterion 11: publishing either of these during the
      // commit period would undo the hiding the commitment exists to provide.
      const secrets = [salt.toString(), toHex(salt), toHex(seed.data)];
      for (const secret of secrets) {
        expect(commit.stdout, "commit must not emit the salt or the seed").not.toContain(secret);
        expect(commit.stderr).not.toContain(secret);
      }

      for (const voteId of VOTE_IDS) {
        const [, storedCommit] = await publicClient.readContract({
          address: kit.address,
          abi: DISPUTE_KIT_ABI,
          functionName: "getVoteInfo",
          args: [DISPUTE, ROUND, voteId],
        });
        expect(storedCommit).toBe(expectedCommitment);
      }

      // Acceptance criterion 4 is vacuous here and stronger for it: there is no
      // `commits.jsonl` to delete, because nothing but the key is ever on disk.
      expect(readdirSync(home)).toEqual(["key"]);

      // --- the world moves on ------------------------------------------------
      await testClient.increaseTime({ seconds: Number(COMMIT_PERIOD_SECONDS) + 1 });
      await testClient.mine({ blocks: 1 });

      const wallet = createWalletClient({
        account: juror,
        chain: arbitrum,
        transport: http(FORK_RPC),
      });
      const passPeriod = await wallet.writeContract({
        address: KLEROS_CORE.address,
        abi: PASS_PERIOD_ABI,
        functionName: "passPeriod",
        args: [DISPUTE],
      });
      await publicClient.waitForTransactionReceipt({ hash: passPeriod });

      const [, , period] = await publicClient.readContract({
        address: KLEROS_CORE.address,
        abi: KLEROS_CORE_ABI,
        functionName: "disputes",
        args: [DISPUTE],
      });
      expect(period, "the dispute must now be in the vote period").toBe(2);

      // --- process 2: reveal -------------------------------------------------
      // A different process, a different block, and a period boundary in between.
      // The salt is not passed in and was never written down; it is re-derived from
      // the key, which is the whole claim this test exists to check.
      const reveal = await runCli([
        "reveal",
        "--dispute",
        DISPUTE.toString(),
        "--round",
        ROUND.toString(),
        "--votes",
        "2,4",
        "--choice",
        CHOICE.toString(),
        "--broadcast",
      ]);

      expect(reveal.exitCode).toBe(0);
      expect(reveal.json.ok).toBe(true);
      expect(reveal.json.status).toBe("mined");
      expect(reveal.json.period).toBe("vote");
      expect(reveal.json.commit).toBe(expectedCommitment);

      for (const voteId of VOTE_IDS) {
        const [account, , choice, voted] = await publicClient.readContract({
          address: kit.address,
          abi: DISPUTE_KIT_ABI,
          functionName: "getVoteInfo",
          args: [DISPUTE, ROUND, voteId],
        });
        expect(account).toBe(juror.address);
        expect(voted, `vote ${voteId} must be recorded`).toBe(true);
        expect(choice).toBe(CHOICE);
      }

      const [, , totalVoted, , , choiceCount] = await publicClient.readContract({
        address: kit.address,
        abi: DISPUTE_KIT_ABI,
        functionName: "getRoundInfo",
        args: [DISPUTE, ROUND, CHOICE],
      });
      expect(totalVoted).toBe(BigInt(VOTE_IDS.length));
      expect(choiceCount).toBe(BigInt(VOTE_IDS.length));

      expect(readdirSync(home)).toEqual(["key"]);
    }, 180_000);
  },
);

if (!ARCHIVE_RPC) {
  // Visible in the run output rather than silently green.
  console.warn("[acceptance] KLEROS_ARCHIVE_RPC is unset; `05 §5.3` was not exercised.");
}
