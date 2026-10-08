/**
 * Every mounted map surface, so the memory reclaimer can reach the ones a frozen
 * tab hides from React. A surface releases its page's map and rebuilds it on
 * the next foreground through the same path it uses for a crashed render
 * process.
 *
 * A surface whose screen another screen covers is held released: it stays
 * released through a foreground, and only lifting the hold rebuilds it.
 */
import { debug } from '@/shared/debug/debug';

const log = debug.create('MapSurfaceRegistry');

export interface ReleasableSurface {
  release: (source: 'javascript' | 'native') => void;
  rebuild: () => void;
}

const mounted = new Set<ReleasableSurface>();
const released = new Set<ReleasableSurface>();
const held = new Set<ReleasableSurface>();

export function registerReleasableSurface(surface: ReleasableSurface): () => void {
  mounted.add(surface);
  return () => {
    mounted.delete(surface);
    released.delete(surface);
    held.delete(surface);
  };
}

function release(surface: ReleasableSurface): boolean {
  try {
    surface.release('javascript');
    released.add(surface);
    return true;
  } catch (e) {
    log.warn('surface refused to release:', e);
    return false;
  }
}

/** Releases every mounted surface not already released. Returns how many it reached. */
export function releaseMountedSurfaces(): number {
  let count = 0;
  for (const surface of mounted) {
    if (released.has(surface)) continue;
    if (release(surface)) count++;
  }
  return count;
}

/**
 * Releases one surface and keeps it released until `resumeHeldSurface`.
 * Returns whether this call released it, which it does not when a trim already
 * had.
 */
export function holdSurfaceReleased(surface: ReleasableSurface): boolean {
  if (!mounted.has(surface)) return false;
  held.add(surface);
  if (released.has(surface)) return false;
  return release(surface);
}

/**
 * Lifts a hold. Returns whether the surface is released, in which case the
 * registry has forgotten it and the caller rebuilds it.
 */
export function resumeHeldSurface(surface: ReleasableSurface): boolean {
  held.delete(surface);
  return released.delete(surface);
}

/** Records a page that confirmed its native release script ran. */
export function markNativeReleasedSurface(surface: ReleasableSurface): boolean {
  if (!mounted.has(surface) || released.has(surface)) return false;
  surface.release('native');
  released.add(surface);
  return true;
}

/**
 * Rebuilds every released surface that is still mounted and not held. Returns
 * how many it reached.
 */
export function rebuildReleasedSurfaces(): number {
  let count = 0;
  for (const surface of [...released]) {
    if (held.has(surface)) continue;
    released.delete(surface);
    try {
      surface.rebuild();
      count++;
    } catch (e) {
      log.warn('surface refused to rebuild:', e);
    }
  }
  return count;
}
