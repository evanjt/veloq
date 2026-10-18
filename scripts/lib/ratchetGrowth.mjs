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

/**
 * The rises an acceptance value names, as `area:Key=reason` entries joined by
 * `;`. The reason runs to the end of its entry, so it may hold `:` or `=`.
 * A value that names nothing, a bare `1`, or an entry with no area, key or
 * reason is an error rather than an empty acceptance, since a gate that reads
 * a malformed acceptance as none would pass nothing and say so too quietly,
 * and one that read it as everything would pass anything.
 *
 * @param {string} value
 * @returns {{ accepted: { area: string, key: string, reason: string }[], errors: string[] }}
 */
export function parseAcceptance(value) {
  const errors = [];
  const accepted = [];
  if (value.trim() === '' || value.trim() === '1') {
    return { accepted, errors: [`"${value}" names no area, key or reason.`] };
  }
  for (const raw of value.split(';')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const equals = entry.indexOf('=');
    const target = equals === -1 ? entry : entry.slice(0, equals);
    const reason = equals === -1 ? '' : entry.slice(equals + 1).trim();
    const colon = target.indexOf(':');
    const area = colon === -1 ? '' : target.slice(0, colon).trim();
    const key = colon === -1 ? target.trim() : target.slice(colon + 1).trim();
    if (area === '' || key === '') {
      errors.push(`"${entry}" does not name an area and a key as area:Key.`);
    } else if (reason === '') {
      errors.push(`"${entry}" gives no reason after "=".`);
    } else {
      accepted.push({ area, key, reason });
    }
  }
  if (errors.length === 0 && accepted.length === 0) {
    errors.push(`"${value}" names no area, key or reason.`);
  }
  return { accepted, errors };
}

/**
 * Splits area growth into what an acceptance covers and what it does not.
 * An area passes only when every key it added is accepted for that area. An
 * accepted key that no area added is stale: it is returned so the caller can
 * refuse it, or it would pass whatever later grows under that name.
 *
 * @param {ReturnType<typeof areaGrowth>} grown
 * @param {{ area: string, key: string, reason: string }[]} accepted
 */
export function applyAcceptance(grown, accepted) {
  const reasonOf = (area, key) =>
    accepted.find((entry) => entry.area === area && entry.key === key)?.reason;
  const passed = [];
  const refused = [];
  for (const growth of grown) {
    const covered = growth.added.every((key) => reasonOf(growth.area, key) !== undefined);
    if (covered && growth.added.length > 0) {
      passed.push(
        ...growth.added.map((key) => ({
          area: growth.area,
          key,
          reason: reasonOf(growth.area, key),
        }))
      );
    } else {
      refused.push({
        ...growth,
        added: growth.added.filter((key) => reasonOf(growth.area, key) === undefined),
      });
    }
  }
  const stale = accepted.filter(
    ({ area, key }) => !grown.some((growth) => growth.area === area && growth.added.includes(key))
  );
  return { passed, refused, stale };
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
