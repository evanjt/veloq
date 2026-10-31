// Which Actions cache entries to delete so that one generation per cache stays.
//
// A cache key is a fixed prefix followed by a generation marker: a commit sha,
// a lockfile hash, a toolchain digest. Replacing every token of seven or more
// hexadecimal characters that holds a digit with `*` collapses the generations
// of one cache into one prefix. Within a prefix only the newest entry on a ref
// is kept. Entries on other refs are left alone, since a pull request's cache
// is read by that pull request and by nothing else.

const GENERATION_TOKEN = /(?<![0-9a-zA-Z])(?=[0-9a-f]*[0-9])[0-9a-f]{7,}(?![0-9a-zA-Z])/g;

/** The key with each generation marker replaced by `*`. */
function keyPrefix(key) {
  return key.replace(GENERATION_TOKEN, '*');
}

/**
 * The entries to delete: every entry but the newest per (ref, prefix).
 * `entries` is the cache listing, each with `id`, `key`, `ref` and `created_at`.
 * Ties on creation time keep the higher id.
 */
function supersededEntries(entries, ref = 'refs/heads/main') {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.ref !== ref) continue;
    const prefix = keyPrefix(entry.key);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(entry);
  }

  const doomed = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || Number(b.id) - Number(a.id)
    );
    doomed.push(...group.slice(1));
  }
  return doomed.sort((a, b) => Number(a.id) - Number(b.id));
}

module.exports = { keyPrefix, supersededEntries };
