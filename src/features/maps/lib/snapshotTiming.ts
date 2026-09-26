/**
 * Preview durations and source-event counts in the Developer Dashboard's
 * metrics ring.
 *
 * Nothing on a handset could say. The worker page logs through `_rn_log` and
 * the pool prints that only under `__DEV__`; the queue trace holds the
 * timestamps but is written out only once the watchdog decides the queue is
 * wedged; and a debug APK is embedded with `--dev false`, so an installed
 * build has none of it. The FFI ring survives a release build, which is why
 * these go through `recordFFIMetric` rather than a log channel: they appear in
 * the dashboard's table as calls, mean, max and p95 beside the engine calls.
 *
 * The names are the contract. They are read back out of
 * `getFFIMetricsSummary`, which groups on the name alone, so a rename is a
 * gap in whatever was being compared across it.
 */

import { recordFFIMetric } from '@/shared/debug/renderTimer';

/** WebView mount to `mapReady`, per worker. */
export const SNAPSHOT_BOOT = 'snapshot.boot';
/** Enqueue to assignment: how long a card sat behind the two workers. */
export const SNAPSHOT_WAIT = 'snapshot.wait';
/** Base64 received to `emitSnapshotComplete`: the JPEG write and the card's wake. */
export const SNAPSHOT_SAVE = 'snapshot.save';

// Assignment to capture, separated by the reason for the render.
export function snapshotRenderMetric(shape: {
  flat: boolean;
  standIn: boolean;
  firstPaint?: boolean;
}): string {
  if (shape.firstPaint && shape.standIn) return 'snapshot.render.firstPaint';
  if (shape.standIn) return 'snapshot.render.standIn';
  return shape.flat ? 'snapshot.render.flat' : 'snapshot.render.drape';
}

/**
 * The page's own elapsed, by the path it took.
 *
 * The fast path is a camera jump over a style already mounted; `setStyle` is
 * the whole style, its sources and its tiles. They differ by an order of
 * magnitude and the host cannot tell them apart from the outside, so the page
 * says which it took on the message that carries the image.
 */
export function snapshotPageMetric(fastPath: boolean): string {
  return fastPath ? 'snapshot.page.fast' : 'snapshot.page.setStyle';
}

/**
 * Record one duration, ignoring a negative or absent start.
 *
 * A worker that reloads, a request requeued by the watchdog and a page that
 * posts twice all produce a start that is missing or newer than the end, and a
 * negative duration in the ring is worse than no reading: it pulls the mean
 * without showing up as anything.
 */
export function recordSnapshotTiming(name: string, startedAt: number | null, now: number): void {
  if (startedAt == null || now < startedAt) return;
  recordFFIMetric(name, now - startedAt);
}

/**
 * The four stages inside one page render, in the order they happen.
 *
 * The whole of a render measures inside the page, and the fast path is 6%
 * cheaper than a full `setStyle` rather than an order of magnitude, so the
 * style is not what the seconds are. These split what is left: the style
 * document and the call that mounts it, the tile and terrain wait, the
 * fourteen `readPixels` probes, and the JPEG encode.
 *
 * They partition the elapsed posted beside them, so the four summing to less
 * than it is a path that posted without stamping rather than time nobody
 * owns.
 */
export const SNAPSHOT_PHASES = ['style', 'settle', 'probe', 'encode'] as const;

export type SnapshotPhase = (typeof SNAPSHOT_PHASES)[number];

export function snapshotPhaseMetric(phase: SnapshotPhase): string {
  return `snapshot.phase.${phase}`;
}

/**
 * Record whichever of the four stages the page stamped.
 *
 * The page is a string this module builds and a WebView runs, so what comes
 * back is untyped and a render aborted part way through stamps only the
 * stages it reached. A stage that is absent, not a number, or negative
 * records nothing: a missing reading is readable in the table and a wrong one
 * is not.
 */
export function recordSnapshotPhases(phases: unknown): void {
  if (typeof phases !== 'object' || phases === null) return;
  for (const phase of SNAPSHOT_PHASES) {
    const value = (phases as Record<string, unknown>)[phase];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    recordFFIMetric(snapshotPhaseMetric(phase), value);
  }
}

/**
 * Source events per render, not network fetches or disk-cache hits.
 * The ring stores these as values: calls count renders, mean and max count
 * loaded events. Sum regional sources before recording to keep that unit.
 */
export function recordSnapshotTiles(tileStats: unknown): void {
  if (typeof tileStats !== 'object' || tileStats === null) return;
  const counts = new Map<string, number>();
  for (const [source, stats] of Object.entries(tileStats)) {
    const prefix = ['satellite', 'terrain', 'openmaptiles', 'route'].find(
      (name) => source === name || source.startsWith(`${name}-`)
    );
    if (!prefix || typeof stats !== 'object' || stats === null) continue;
    const loaded = (stats as Record<string, unknown>).loaded;
    if (typeof loaded !== 'number' || !Number.isSafeInteger(loaded) || loaded < 0) continue;
    counts.set(prefix, (counts.get(prefix) ?? 0) + loaded);
  }
  for (const [prefix, count] of counts) {
    if (Number.isSafeInteger(count)) recordFFIMetric(`snapshot.tiles.${prefix}`, count);
  }
}
