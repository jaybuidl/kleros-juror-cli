import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The CLI's own surface, checked against the vocabulary `CONTEXT.md` governs.
 *
 * `CONTEXT.md` has told readers to avoid "ruling" for a juror's choice since the
 * glossary was written, and the CLI help, the README and the skill frontmatter all
 * drifted into it anyway — advisory prose does not hold a term in place. This does.
 *
 * Offline: nothing here reads the chain, a key, or the network.
 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliEntry = join(repoRoot, "src", "cli.ts");

/**
 * Deliberately narrower than the `_Avoid_` lines in `CONTEXT.md`.
 *
 * Those lines forbid a word *as the noun for a juror's choice*. Several of them —
 * "vote", "answer" — are perfectly correct in other roles, and this surface is full
 * of them ("Publish a vote commitment", "the vote period"). Only the terms that are
 * wrong in every role a CLI description can put them in belong here. Widening this
 * list means allowlisting half the CLI; add a term only if that trade holds.
 *
 * **Ruling** is the arbitrator's output — see the `CONTEXT.md` entry. A juror never
 * casts one, so it can never describe an input this tool takes.
 */
const FORBIDDEN = ["ruling", "verdict"] as const;

/** Render a view of the surface as a user or an agent actually receives it. */
function render(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", cliEntry, ...args],
      { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !stdout) reject(new Error(`${args.join(" ")} failed:\n${stderr}`));
        else resolve(stdout);
      },
    );
  });
}

describe("the CLI surface uses the vocabulary CONTEXT.md governs", () => {
  // `--llms-full` carries every command and option description but not the root
  // one; `--help` carries the root description. Neither alone covers the surface.
  it.each([
    ["--llms-full", "the manifest an agent consumes"],
    ["--help", "the root description and command summaries"],
  ])(
    "%s (%s) is free of avoided terms",
    async (flag) => {
      const rendered = await render([flag]);
      expect(rendered.length, "expected the CLI to render something").toBeGreaterThan(0);

      for (const term of FORBIDDEN) {
        const offending = rendered
          .split("\n")
          .filter((line) => line.toLowerCase().includes(term))
          .join("\n");

        expect(
          offending,
          `"${term}" is an avoided term (see CONTEXT.md). It appears in:\n${offending}`,
        ).toBe("");
      }
    },
    60_000,
  );
});
