/**
 * Which failure the engine reported, as a word a caller can branch on.
 *
 * `VeloqError` is a typed enum in Rust and the bindings carry the tag across,
 * but every caller was catching it as an untyped throw and rendering one
 * message. So "the engine is not open", "another thread holds the lock" and
 * "the database failed" were one `catch` with one outcome, and the athlete was
 * told the same thing whichever it was.
 *
 * The tags are spelled here rather than imported from the bindings, the same
 * reason `useEngineSubscription` spells its channel list: a consumer that wants
 * to name a failure should not pull the static native binding chain in for a
 * string. `src/__tests__/bindings/engineErrorTags.test.ts` reads the generated
 * enum and fails if this list drifts from it.
 */

/** Every variant `VeloqError` can cross as. */
export const ENGINE_ERROR_TAGS = [
  'NotInitialized',
  'LockFailed',
  'Database',
  'NotFound',
  'ParseError',
  'ReferenceActivity',
  'TileStore',
] as const;

export type EngineErrorTag = (typeof ENGINE_ERROR_TAGS)[number];

/**
 * The variant, or `undefined` for anything that did not come from the engine:
 * a deadline this side gave up on, a JavaScript `TypeError`, a rejected fetch.
 *
 * Read off `tag` rather than through `instanceof`. The value crosses the JSI
 * boundary and the generated identity check is a private symbol, so the tag is
 * the only part a consumer can rely on.
 */
export function engineErrorTag(error: unknown): EngineErrorTag | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const tag = (error as { tag?: unknown }).tag;
  return ENGINE_ERROR_TAGS.find((known) => known === tag);
}

/** What the engine said, when it said anything, for a log or a report. */
export function engineErrorDetail(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const inner = (error as { inner?: { msg?: unknown } }).inner;
  return typeof inner?.msg === 'string' ? inner.msg : undefined;
}

/** The lines an engine failure can show. */
export type EngineFailureKey =
  | 'engine.failure.notOpen'
  | 'engine.failure.busy'
  | 'engine.failure.database';

/** The i18n key naming a failure, for the surfaces that show one. */
const KEYS: Record<EngineErrorTag, EngineFailureKey> = {
  NotInitialized: 'engine.failure.notOpen',
  LockFailed: 'engine.failure.busy',
  // The five that carry a message are all the database or a row in it failing,
  // and none of them is anything the athlete can act on differently.
  Database: 'engine.failure.database',
  NotFound: 'engine.failure.database',
  ParseError: 'engine.failure.database',
  ReferenceActivity: 'engine.failure.database',
  TileStore: 'engine.failure.database',
};

/**
 * The key for whatever went wrong, with `fallback` for a failure that is not
 * the engine's. A caller's own lapsed deadline is not an engine failure and
 * must not read as one.
 */
export function engineErrorKey<Fallback extends string>(
  error: unknown,
  fallback: Fallback
): EngineFailureKey | Fallback {
  const tag = engineErrorTag(error);
  return tag ? KEYS[tag] : fallback;
}
