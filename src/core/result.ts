/**
 * The core/commands seam, mirroring `@kleros/agentkit` so a port upstream stays
 * mechanical (ADR-0001). Core modules return `KlerosResult`; only the command
 * layer knows about incur, exit codes or CTA blocks.
 */
export type KlerosResult<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string; details?: unknown };

export function ok<T>(data: T): KlerosResult<T> {
  return { success: true, data };
}

export function err<T = never>(code: string, message: string, details?: unknown): KlerosResult<T> {
  return details === undefined
    ? { success: false, code, message }
    : { success: false, code, message, details };
}
