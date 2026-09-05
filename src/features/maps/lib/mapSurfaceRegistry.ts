/**
 * Every mounted map surface, so the memory reclaimer can reach the ones a frozen
 * tab hides from React. A surface releases its page's map and rebuilds it on
 * the next foreground through the same path it uses for a crashed render
 * process.
 */
import { debug } from '@/shared/debug/debug';

const log = debug.create('MapSurfaceRegistry');

export interface ReleasableSurface {
  release: () => void;
  rebuild: () => void;
}

const mounted = new Set<ReleasableSurface>();
const released = new Set<ReleasableSurface>();

export function registerReleasableSurface(surface: ReleasableSurface): () => void {
  mounted.add(surface);
  return () => {
    mounted.delete(surface);
    released.delete(surface);
  };
}

/** Releases every mounted surface not already released. Returns how many it reached. */
export function releaseMountedSurfaces(): number {
  let count = 0;
  for (const surface of mounted) {
    if (released.has(surface)) continue;
    try {
      surface.release();
      released.add(surface);
      count++;
    } catch (e) {
      log.warn('surface refused to release:', e);
    }
  }
  return count;
}

/** Rebuilds every released surface that is still mounted. Returns how many it reached. */
export function rebuildReleasedSurfaces(): number {
  let count = 0;
  for (const surface of released) {
    try {
      surface.rebuild();
      count++;
    } catch (e) {
      log.warn('surface refused to rebuild:', e);
    }
  }
  released.clear();
  return count;
}
