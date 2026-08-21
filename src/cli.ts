#!/usr/bin/env node
import { createRequire } from "node:module";
import { Cli, z } from "incur";
import {
  chainOptions,
  exitCodeFor,
  parseBigInt,
  voteSelectionOptions,
  writeOptions,
} from "./commands/shared.js";
import { runSalt, runStatus } from "./commands/status.js";
import { runCommit, runReveal } from "./commands/write.js";
import type { KlerosResult } from "./core/result.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

type CtaBlock = { commands: { command: string; description?: string }[]; description?: string };

/**
 * Every error carries a next command. The consumer is an agent that sees merged
 * stdout and stderr and an effectively binary exit status, so the payload has to
 * say what to do as well as what went wrong.
 */
function ctaFor(code: string, dispute?: string): CtaBlock | undefined {
  const at = dispute ? ` --dispute ${dispute}` : "";
  switch (code) {
    case "KEY_FILE_MISSING":
    case "KEY_FILE_PERMISSIONS":
    case "KEY_FILE_INVALID":
      // CTA entries are rendered prefixed with the binary name, so they must be
      // subcommands of this CLI. Shell remedies belong in the message hint.
      return {
        description:
          "The signing key lives in a file this tool owns, mode 0600. It is never read from " +
          "the environment or the command line.",
        commands: [
          {
            command: `status${at} --address <juror>`,
            description: "Inspect a dispute without a signing key",
          },
        ],
      };
    case "WRONG_PERIOD":
    case "DEADLINE_PASSED":
    case "ALREADY_VOTED":
    case "ALREADY_COMMITTED":
      return {
        commands: [
          { command: `status${at}`, description: "Show the current period and vote state" },
        ],
      };
    case "COMMITMENT_MISMATCH":
      return {
        description: "The revealed choice does not reproduce the stored commitment.",
        commands: [
          { command: `salt${at}`, description: "Show the salt and commitment this key derives" },
          { command: `status${at}`, description: "Show the stored commitment" },
        ],
      };
    case "WRONG_SUBCOMMAND_FOR_COURT":
      return {
        description:
          "commit, reveal and vote are never interchangeable; each has a different cost.",
        commands: [{ command: `status${at}`, description: "Show whether this court hides votes" }],
      };
    case "INSUFFICIENT_BALANCE":
      return {
        description:
          "The juror's own account must send the transaction and pay for it; these dispute kits " +
          "have no relayer or meta-transaction path.",
        commands: [{ command: `status${at}`, description: "Show the account and its balance" }],
      };
    default:
      return undefined;
  }
}

function finish<T>(
  c: {
    ok: (data: T) => never;
    error: (o: { code: string; message: string; exitCode?: number; cta?: CtaBlock }) => never;
  },
  result: KlerosResult<T>,
  dispute?: string,
): never {
  if (result.success) return c.ok(result.data);
  const cta = ctaFor(result.code, dispute);
  // Error messages already embed the values that matter (addresses, commitments,
  // periods). Only a `hint` adds anything, so only a hint is appended -- dumping
  // the whole details object made messages unreadable for the agent consuming them.
  const hint =
    result.details && typeof result.details === "object" && "hint" in result.details
      ? String((result.details as { hint: unknown }).hint)
      : null;

  return c.error({
    code: result.code,
    message: hint ? `${result.message} ${hint}` : result.message,
    exitCode: exitCodeFor(result.code),
    ...(cta ? { cta } : {}),
  });
}

const choiceOption = {
  choice: z
    .string()
    .describe(
      "The chosen option to vote for, 0..numberOfChoices. 0 refuses to arbitrate and is always valid.",
    ),
};

const cli = Cli.create("kleros-juror", {
  description:
    "Commit and reveal Kleros v2 juror votes on Arbitrum One. Casts a decision already made " +
    "elsewhere: it never reads evidence and never decides how to vote.",
  version: pkg.version,
  // JSON by default: the primary consumer merges stdout and stderr into one
  // buffer, so anything else on stdout breaks parsing. See CLAUDE.md.
  format: "json",
})
  .command("status", {
    description:
      "Show a dispute's period, deadline and this juror's vote state, and derive which action " +
      "is outstanding. Reads only; works without a signing key if --address is given.",
    options: z.object({
      ...chainOptions,
      ...voteSelectionOptions,
      address: z
        .string()
        .optional()
        .describe("Juror address to report on. Defaults to the address of the loaded key."),
    }),
    examples: [
      {
        description: "Check a dispute you were drawn in",
        options: { dispute: "154", round: "0", votes: "0" },
      },
      {
        description: "Inspect another juror's vote state, without a signing key",
        options: {
          dispute: "154",
          round: "0",
          votes: "0,1,2",
          address: "0x57eb05d4dfFAc43A0C52B42C47a4E7d1838725Ea",
        },
      },
    ],
    async run(c) {
      const result = await runStatus({
        disputeKit: c.options["dispute-kit"],
        rpcUrl: c.options["rpc-url"],
        home: c.options.home,
        dispute: c.options.dispute,
        round: c.options.round,
        votes: c.options.votes,
        address: c.options.address,
      });
      return finish(c, result, c.options.dispute);
    },
  })
  .command("salt", {
    description:
      "Derive the salt and commitment for one vote, without touching the chain. Needs the " +
      "signing key, because the seed comes from it.",
    options: z.object({ ...chainOptions, ...voteSelectionOptions, ...choiceOption }),
    examples: [
      {
        description: "Show the salt and commitment this key derives",
        options: { dispute: "154", round: "0", votes: "0", choice: "1" },
      },
    ],
    async run(c) {
      const choice = parseBigInt("choice", c.options.choice);
      if (!choice.success) return finish(c, choice);
      const result = await runSalt(
        {
          disputeKit: c.options["dispute-kit"],
          home: c.options.home,
          dispute: c.options.dispute,
          round: c.options.round,
          votes: c.options.votes,
        },
        choice.data,
      );
      return finish(c, result, c.options.dispute);
    },
  })
  .command("commit", {
    description:
      "Publish a vote commitment during the commit period of a hidden-vote court. Simulates and " +
      "stops unless --broadcast is passed. Never substitutes for reveal or vote.",
    destructive: true,
    options: z.object({
      ...chainOptions,
      ...voteSelectionOptions,
      ...choiceOption,
      ...writeOptions,
      "allow-recommit": z
        .boolean()
        .default(false)
        .describe(
          "Overwrite an existing commitment. Each commit adds to totalCommitted again, which " +
            "can permanently remove this dispute's early exit from the vote period.",
        ),
    }),
    examples: [
      {
        description: "Check what would happen, sending nothing",
        options: { dispute: "154", round: "0", votes: "0", choice: "1" },
      },
      {
        description: "Actually publish the commitment",
        options: { dispute: "154", round: "0", votes: "0", choice: "1", broadcast: true },
      },
    ],
    async run(c) {
      const choice = parseBigInt("choice", c.options.choice);
      if (!choice.success) return finish(c, choice);
      const result = await runCommit({
        disputeKit: c.options["dispute-kit"],
        rpcUrl: c.options["rpc-url"],
        home: c.options.home,
        dispute: c.options.dispute,
        round: c.options.round,
        votes: c.options.votes,
        choice: choice.data,
        broadcast: c.options.broadcast,
        timeoutSeconds: Number(c.options.timeout),
        allowRecommit: c.options["allow-recommit"],
      });
      return finish(c, result, c.options.dispute);
    },
  })
  .command("reveal", {
    description:
      "Reveal a previously committed vote during the vote period. The salt is recomputed from " +
      "the signing key, never read from stored state. Simulates and stops unless --broadcast.",
    destructive: true,
    options: z.object({
      ...chainOptions,
      ...voteSelectionOptions,
      ...choiceOption,
      ...writeOptions,
      justification: z
        .string()
        .default("")
        .describe(
          "Reasoning for the vote. A literal string, @path to read a file, or - to read stdin. " +
            "Emitted in the VoteCast event and never stored on chain.",
        ),
    }),
    examples: [
      {
        description: "Verify the reveal would succeed, sending nothing",
        options: { dispute: "154", round: "0", votes: "0", choice: "1" },
      },
      {
        description: "Reveal with a written justification",
        options: {
          dispute: "154",
          round: "0",
          votes: "0",
          choice: "1",
          justification: "@reasons.md",
          broadcast: true,
        },
      },
    ],
    async run(c) {
      const choice = parseBigInt("choice", c.options.choice);
      if (!choice.success) return finish(c, choice);
      const result = await runReveal({
        disputeKit: c.options["dispute-kit"],
        rpcUrl: c.options["rpc-url"],
        home: c.options.home,
        dispute: c.options.dispute,
        round: c.options.round,
        votes: c.options.votes,
        choice: choice.data,
        broadcast: c.options.broadcast,
        timeoutSeconds: Number(c.options.timeout),
        justification: c.options.justification,
      });
      return finish(c, result, c.options.dispute);
    },
  });

cli.serve();
