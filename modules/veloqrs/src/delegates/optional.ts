/**
 * Building an engine record from nullable input.
 *
 * A uniffi `Option` crosses as an optional field, and an optional field is
 * either present with a value or not there at all. `{ ctl: undefined }` is
 * neither, and under `exactOptionalPropertyTypes` it is a different type: a
 * delegate that fills absent fields that way type-checks against a record it
 * did not build, so a field the Rust record gains or renames goes unnoticed.
 */

/** The same record with every absent field optional rather than filled. */
type Present<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/**
 * The record without the keys whose value is absent.
 *
 * The assertion is sound by construction and lives here alone: dropping a key
 * whose value is `undefined` can only narrow the type, never widen it.
 */
export function present<T extends object>(record: T): Present<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as Present<T>;
}
