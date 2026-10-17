import { setFlagsFromString } from 'v8';
import { runInNewContext } from 'vm';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/**
 * Runs full collections until finalisers settle, so a `WeakRef` to anything
 * unreachable reads empty. A `WeakRef` target stays alive until the end of the
 * job that dereferenced it, hence the turns between collections.
 */
export async function collectGarbage(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    gc();
  }
}
