// What a ratchet's committed ceiling holds now against what it held before.
//
// The area guard and the engine-surface lint each refuse a tree that does not
// match its ceiling, and neither compares the ceiling with its earlier self. A
// commit that adds a call and raises the ceiling in the same change satisfies
// both. These functions read two copies of the ceiling and name what grew.

const NOTE_KEY = /^\/\//;

const areas = (ceilings) =>
  Object.entries(ceilings).filter(([area, keys]) => !NOTE_KEY.test(area) && Array.isArray(keys));

/**
 * The areas whose list is longer than it was, or that were not listed at all.
 * A key replaced by another in the same area keeps the length and passes.
 *
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {{ area: string, before: number | null, after: number, added: string[] }[]}
 */
export function areaGrowth(before, after) {
  const prior = new Map(areas(before));
  const grown = [];
  for (const [area, keys] of areas(after)) {
    const was = prior.get(area);
    if (was === undefined && keys.length === 0) continue;
    if (was !== undefined && keys.length <= was.length) continue;
    grown.push({
      area,
      before: was === undefined ? null : was.length,
      after: keys.length,
      added: keys.filter((key) => !(was ?? []).includes(key)),
    });
  }
  return grown;
}

const CEILING_FLAGS = ['--engine-ceiling', '--store-ceiling'];

/** The numbers a lint script is given for each ceiling flag, null when absent. */
export function ceilingNumbers(script) {
  return Object.fromEntries(
    CEILING_FLAGS.map((flag) => {
      const match = new RegExp(`${flag}[= ](\\d+)`).exec(script ?? '');
      return [flag, match === null ? null : Number(match[1])];
    })
  );
}

/**
 * The ceiling flags whose number is higher than it was.
 *
 * @returns {{ flag: string, before: number, after: number | null }[]}
 */
export function numberGrowth(beforeScript, afterScript) {
  const was = ceilingNumbers(beforeScript);
  const now = ceilingNumbers(afterScript);
  return CEILING_FLAGS.filter(
    (flag) => was[flag] !== null && (now[flag] === null || now[flag] > was[flag])
  ).map((flag) => ({ flag, before: was[flag], after: now[flag] }));
}
