// The one judge of a baseline ratchet that has fallen below its record.
//
// A ratchet holds each file to the count its baseline records. Above the record always fails.
// Below it, the tree has beaten the record and the baseline should be lowered. The author can
// write that at commit, so it fails there. At the land gate two branches that each lowered a
// count meet, and the merged tree can be below a baseline neither branch could have written:
// refusing it costs a full gate run and a rebuild for a tree better than its record. So at the
// land gate a beaten baseline passes and names the entries to lower with the `--write` command.
//
// `run-guards.mjs` names the set it runs through `VELOQ_GUARD_SET`, and this is the only reader.

const LAND_SETS = new Set(['land']);

export function atLandGate(env = process.env) {
  return LAND_SETS.has(env.VELOQ_GUARD_SET ?? '');
}

/**
 * Prints the entries that sit below their baseline and returns the exit code for the ratchet.
 * `over` is judged by the caller, which has already printed it.
 *
 * @param {{ over: unknown[], under: unknown[], line: (row: any) => string, writeCommand: string, env?: NodeJS.ProcessEnv }} args
 */
export function settleRatchet({ over, under, line, writeCommand, env = process.env }) {
  if (under.length > 0) {
    const tolerated = over.length === 0 && atLandGate(env);
    const out = tolerated ? console.log : console.error;
    out(
      tolerated
        ? '\nThe tree has beaten its baseline. Lower it with the next commit that touches it:'
        : '\nThe tree has beaten its baseline. Lower it, so the ground stays taken:'
    );
    for (const row of under) out(line(row));
    out(`\n  ${writeCommand}`);
  }
  return over.length === 0 && (under.length === 0 || atLandGate(env)) ? 0 : 1;
}
