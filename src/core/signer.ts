import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, PrivateKeyAccount } from "viem";
import { err, ok, type KlerosResult } from "./result.js";

export const HOME_ENV_VAR = "KLEROS_JUROR_HOME";
export const DEFAULT_HOME = join(homedir(), ".kleros-juror");
export const KEY_FILE_NAME = "key";

export function resolveHome(override?: string): string {
  return override ?? process.env[HOME_ENV_VAR] ?? DEFAULT_HOME;
}

export function keyFilePath(home = resolveHome()): string {
  return join(home, KEY_FILE_NAME);
}

/**
 * Load the juror's signing key from a file the CLI owns.
 *
 * Deliberately not an environment variable. This process is launched by an agent
 * gateway that also runs model-authored shell commands, so anything in the
 * environment is inherited by every child and readable from /proc; and scheduled
 * runs store their environment in plaintext. A file is not a security boundary
 * against a compromised host either, but it is not *ambient*, which is the
 * difference that matters here. See ADR-0004's sibling reasoning in CLAUDE.md.
 */
export function loadSigner(home = resolveHome()): KlerosResult<PrivateKeyAccount> {
  const path = keyFilePath(home);

  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    return err(
      "KEY_FILE_MISSING",
      `No signing key at ${path}.`,
      {
        hint:
          `Write the juror's private key there and run: chmod 600 ${path}. ` +
          "This tool does not accept a key from the environment or the command line.",
      },
    );
  }

  if ((mode & 0o077) !== 0) {
    return err(
      "KEY_FILE_PERMISSIONS",
      `${path} is readable by group or others (mode ${(mode & 0o777).toString(8)}).`,
      { hint: `chmod 600 ${path}` },
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8").trim();
  } catch (cause) {
    return err("KEY_FILE_UNREADABLE", `Could not read ${path}.`, {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`).toLowerCase();
  if (!isHex(hex) || hex.length !== 66) {
    return err("KEY_FILE_INVALID", `${path} does not contain a 32-byte hex private key.`);
  }

  try {
    return ok(privateKeyToAccount(hex as Hex));
  } catch (cause) {
    return err("KEY_FILE_INVALID", `The key in ${path} is not a valid secp256k1 private key.`, {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
