/**
 * Reading the three keychain entries a session is made of.
 *
 * `Promise.all` rejects whole: one transient SecureStore failure discarded the
 * other two reads and landed in a catch that signed the athlete out for the
 * session, silently, with a device full of their data. Each key is read on its
 * own, a rejection is not a null, and a rejection is worth one more try before
 * it is taken as an answer.
 */

export interface CredentialRead {
  /** One entry per key asked for, in order. A key that would not read is null. */
  values: (string | null)[];
  /** Keys that threw on both attempts. A read that returned null is not here. */
  failedKeys: string[];
}

/** One retry, immediately. A keychain that is locked stays locked for longer than a wait we could sit through at launch. */
export async function readCredentialKeys(
  read: (key: string) => Promise<string | null>,
  keys: readonly string[]
): Promise<CredentialRead> {
  const first = await Promise.allSettled(keys.map((key) => read(key)));

  const values: (string | null)[] = [];
  const failedKeys: string[] = [];

  for (let i = 0; i < keys.length; i += 1) {
    const settled = first[i];
    if (settled.status === 'fulfilled') {
      values.push(settled.value);
      continue;
    }
    try {
      values.push(await read(keys[i]));
    } catch {
      values.push(null);
      failedKeys.push(keys[i]);
    }
  }

  return { values, failedKeys };
}
