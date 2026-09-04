/**
 * Wait for an on-demand GPS download to land in the engine.
 */

import { getEngine } from '@/shared/native/engine';

/** How long to wait for a single on-demand GPS download before giving up. */
const GPS_WAIT_TIMEOUT_MS = 15_000;

/**
 * Resolve an activity's track once Rust announces it landed, or null if it
 * never does.
 *
 * The engine is read once up front, for a track already downloaded, and then
 * only on an announcement naming this activity. Nothing runs on a timer except
 * the deadline.
 */
export function waitForGpsTrack(activityId: string): Promise<[number, number][] | null> {
  const engine = getEngine();
  const read = (): [number, number][] | null => {
    const points = engine?.getGpsTrack(activityId);
    if (!points || points.length === 0) return null;
    return points.map((p) => [p.latitude, p.longitude] as [number, number]);
  };

  const stored = read();
  if (stored || !engine) return Promise.resolve(stored);

  return new Promise((resolve) => {
    let off: (() => void) | null = null;
    const settle = (coords: [number, number][] | null) => {
      clearTimeout(timer);
      off?.();
      off = null;
      resolve(coords);
    };
    const timer = setTimeout(() => settle(null), GPS_WAIT_TIMEOUT_MS);
    off = engine.subscribe('gpsTrackStored', (payload) => {
      if ((payload as { activityId?: string } | undefined)?.activityId !== activityId) return;
      const coords = read();
      if (coords) settle(coords);
    });
  });
}
