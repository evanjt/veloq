// The compiler errors `noUncheckedIndexedAccess` can itself raise: an index read that is now
// `undefined` used as a value, a key, an argument or an assignment target. Any other error that
// appears only under the flag is a type resolving differently between checkouts, not an index
// read, so it is not counted.
const INDEX_CODES = new Set(['TS2532', 'TS18048', 'TS2538', 'TS7053']);
const ASSIGNABILITY_CODES = new Set(['TS2322', 'TS2345']);
const DIAGNOSTIC = /error (TS\d+): (.*)$/;

export const isIndexAccessError = (line) => {
  const match = DIAGNOSTIC.exec(line);
  if (!match) return false;
  const [, code, message] = match;
  if (INDEX_CODES.has(code)) return true;
  return ASSIGNABILITY_CODES.has(code) && /\bundefined\b/.test(message);
};
