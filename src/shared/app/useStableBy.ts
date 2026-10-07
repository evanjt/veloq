import { useMemo } from 'react';

/**
 * The same reference for as long as `key` is unchanged.
 *
 * What the callers want is for a downstream memo or a `FlatList` to keep its
 * identity when a query refetches data that is structurally the same. They did
 * it by holding the previous value in a ref, comparing it during render and
 * writing the ref back, which is what `react-hooks/refs` reports: a render
 * React throws away has already written that ref, so the next render compares
 * against a value the committed tree never saw and hands back an object from
 * the abandoned pass.
 *
 * Here the memo's own cache is the store. Nothing is written during render, and
 * a discarded render takes its cache with it. React may drop a memo cache of
 * its own accord, and then this returns the current `value`, which costs one
 * re-render downstream and is never a stale object.
 *
 * The caller builds the key, because only the caller knows what "the same data"
 * means for its own shape: a serialisation, a joined list of ids, or the two
 * fields that actually move.
 */
export function useStableBy<T>(value: T, key: string): T {
  // The key is the dependency by design: `value` is a fresh object on every
  // refetch and listing it would defeat the whole thing.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- A fresh value must not replace the memo while its key is unchanged.
  return useMemo(() => value, [key]);
}
