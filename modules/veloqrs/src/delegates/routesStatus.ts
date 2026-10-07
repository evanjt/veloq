/**
 * Every background-job figure the routes screens follow, in one read.
 *
 * Four timers polled four standalone exports on the one screen, each taking
 * the engine lock on its own interval, and the elevation count was read from
 * three files on three schedules. This is the poller consolidation, not a
 * screen read: nothing it carries is drawn as content, and it is refreshed by
 * a tick rather than by an announcement, because progress deliberately has no
 * observer event.
 */

import { getRoutesStatusData as ffiGetRoutesStatusData } from '../generated/veloqrs';
import type { DelegateHost } from './host';
import {
  ELEVATION_PHASES,
  type ElevationBackfillPhase,
  type ElevationBackfillProgress,
} from './elevation';
import {
  STREAM_PHASES,
  type StreamBackfillPhase,
  type StreamBackfillProgress,
} from './streamBackfill';
import { CUTOVER_PHASES, type CutoverPhase } from './cutover';
import type { SectionDetectionProgress } from '../conversions';

export interface RoutesStatus {
  /** The running detection, or null when no run holds the slot. */
  detection: SectionDetectionProgress | null;
  /** How the last finished detect ended: idle, complete or error. */
  detectionOutcome: string;
  stream: StreamBackfillProgress & { phase: StreamBackfillPhase };
  /** Activities with no stored series, on the elevation count's terms. */
  streamRemaining: number | null;
  elevation: ElevationBackfillProgress & { phase: ElevationBackfillPhase };
  /**
   * Stored tracks still owed a fetch. Null while a pass is running, which
   * reports its own progress, and null when the engine cannot answer, which
   * must never read as a finished backfill.
   */
  elevationRemaining: number | null;
  elevationPaused: boolean;
  cutover: { phase: CutoverPhase; running: boolean };
  /** Tiles processed and tiles in the sweep, `[0, 0]` when none runs. */
}

/** An unrecognised phase reads as idle rather than as a finished run. */
function narrow<T extends string>(phases: readonly T[], phase: string, fallback: T): T {
  return phases.includes(phase as T) ? (phase as T) : fallback;
}

/**
 * Read every figure at once. Null is the engine not being open, and a failed
 * read throws, which each caller reads its own way: a count is not a zero and a
 * phase is not idle.
 */
export function getRoutesStatusData(host: DelegateHost): RoutesStatus | null {
  if (!host.ready) return null;
  const status = host.timed('getRoutesStatusData', () => ffiGetRoutesStatusData());
  return {
    detection: status.detection ?? null,
    detectionOutcome: status.detectionOutcome,
    stream: {
      ...status.stream,
      phase: narrow(STREAM_PHASES, status.stream.phase, 'idle'),
    },
    streamRemaining: status.streamRemaining ?? null,
    elevation: {
      ...status.elevation,
      phase: narrow(ELEVATION_PHASES, status.elevation.phase, 'idle'),
    },
    elevationRemaining: status.elevationRemaining ?? null,
    elevationPaused: status.elevationPaused,
    cutover: {
      phase: narrow(CUTOVER_PHASES, status.cutover.phase, 'idle'),
      running: status.cutover.running,
    },
  };
}
