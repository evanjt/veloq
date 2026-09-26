/**
 * Writing the basemap store's per-source indexes back to disk.
 *
 * The store writes a source's `index.json` on its own only every 32 tile
 * operations, because writing the whole sidecar per tile would cost a JSON
 * encode on every pan. Android kills the app process without unwinding the
 * store, so the `Drop` that would write it back never runs, and a source that
 * never crossed the cadence had no sidecar at all. The next launch then rebuilt
 * its index by walking the whole tree, blocking, on whichever thread first
 * asked for a size, which is the settings hub at mount. Measured at about
 * 330 ms on the S22 at the 400 MB ceiling against a 100 ms mount budget.
 */
import { debug } from '@/shared/debug/debug';

const log = debug.create('BasemapFlush');

/**
 * Write every source's index back. Called when the app goes to the background,
 * which is the last moment the process is reliably alive.
 *
 * Quiet on failure: backgrounding is not a moment to throw, and the cost of a
 * lost flush is the walk this avoids rather than a lost tile.
 */
export function flushBasemapSidecars(): void {
  try {
    // Required lazily, not imported: `veloqrs` reaches the Turbo Module at
    // import time, and the lifecycle module it is called from is loaded in
    // tests and on web, where that module does not exist.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
    basemapStore().flush();
  } catch (e) {
    log.warn('could not write the tile indexes back:', e);
  }
}
