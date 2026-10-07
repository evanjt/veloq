/**
 * What a detail screen read came to: a record, a record that does not exist, an engine that
 * is not open, or a read that threw. The screen shows the not-found text only for `missing`.
 */
export type DetailReadStatus =
  | { kind: 'ok' }
  | { kind: 'missing' }
  | { kind: 'closed' }
  | { kind: 'failed'; error: unknown };

export type DetailRead<T> = { status: DetailReadStatus; data: T | null };

/**
 * Runs `read` and classifies it. `undefined` is the closed engine's answer (the reader and
 * the delegates both give it), `isMissing` says the engine answered with no record, and a
 * throw is a failed read, never a missing record.
 */
export function classifyDetailRead<R, T>(
  read: () => R | null | undefined,
  toData: (result: R) => T,
  isMissing: (result: R) => boolean
): DetailRead<T> {
  try {
    const result = read();
    if (result === undefined || result === null) return { status: { kind: 'closed' }, data: null };
    if (isMissing(result)) return { status: { kind: 'missing' }, data: null };
    return { status: { kind: 'ok' }, data: toData(result) };
  } catch (error) {
    return { status: { kind: 'failed', error }, data: null };
  }
}
