/**
 * Which failure the engine reported, as a word a caller can branch on.
 *
 * `VeloqError` is a typed enum in Rust and the bindings carry the tag across,
 * but every caller was catching it as an untyped throw and rendering one
 * message. So "the engine is not open", "the engine is mid-job" and
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
  'Database',
  'NotFound',
  'ParseError',
  'ReferenceActivity',
  'TileStore',
  'Busy',
  'NameTaken',
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

/** The lines an engine failure can show. */
export type EngineFailureKey =
  | 'engine.failure.notOpen'
  | 'engine.failure.busy'
  | 'engine.failure.database';

/** The i18n key naming a failure, for the surfaces that show one. */
const KEYS: Record<EngineErrorTag, EngineFailureKey> = {
  NotInitialized: 'engine.failure.notOpen',
  // The five that carry a message are all the database or a row in it failing,
  // and none of them is anything the athlete can act on differently.
  Database: 'engine.failure.database',
  NotFound: 'engine.failure.database',
  ParseError: 'engine.failure.database',
  ReferenceActivity: 'engine.failure.database',
  TileStore: 'engine.failure.database',
  // A job of that kind is already running. A caller that can say so shows it
  // as still running, and this line is for the ones that cannot.
  Busy: 'engine.failure.busy',
  // A refusal, not a failure. A caller that can say the name is taken reads the tag, and
  // this line is for the ones that cannot.
  NameTaken: 'engine.failure.database',
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

/**
 * A read's answer, or why there is none.
 *
 * The client hands a failed read back as a throw, so a surface that shows either
 * the value or the failure takes both from one place rather than reading the
 * throw as nothing there.
 */
export type EngineReadResult<T> =
  | { ok: true; value: T; error?: undefined }
  | { ok: false; value?: undefined; error: unknown };

export function attemptEngineRead<T>(read: () => T): EngineReadResult<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    return { ok: false, error };
  }
}
