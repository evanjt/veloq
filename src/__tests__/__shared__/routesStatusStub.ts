/**
 * The bundle `getRoutesStatusData` answers with, for a test that stubs the
 * engine.
 *
 * The routes pollers read every background-job figure in one call, so a stub
 * that only answers the old per-job exports leaves the hooks reading nothing.
 * This builds the bundle from whichever parts a test cares about and fills the
 * rest with an idle library.
 */

export interface StubbedStatusParts {
  detection?: {
    phase: string;
    completed: number;
    total: number;
    percent: number;
  } | null;
  /** How the last finished detect ended: idle, complete or error. */
  detectionOutcome?: string;
  stream?: {
    phase: string;
    completed?: number;
    total?: number;
    stored?: number;
    failed?: number;
    percent?: number;
  } | null;
  streamRemaining?: number | null;
  elevation?: {
    phase: string;
    completed?: number;
    total?: number;
    failed?: number;
    percent?: number;
  } | null;
  /**
   * Null is the engine being unable to answer, never a finished backfill, and
   * it is the default: a test that says nothing about the count is a test
   * whose engine did not carry the read at all.
   */
  elevationRemaining?: number | null;
  elevationPaused?: boolean;
  cutover?: { phase: string; running: boolean } | null;
}

export function routesStatus(parts: StubbedStatusParts = {}) {
  const elevation = {
    phase: 'idle',
    completed: 0,
    total: 0,
    failed: 0,
    percent: 0,
    ...(parts.elevation ?? {}),
  };
  const stream = {
    phase: 'idle',
    completed: 0,
    total: 0,
    stored: 0,
    failed: 0,
    percent: 0,
    ...(parts.stream ?? {}),
  };
  return {
    detection: parts.detection ?? null,
    detectionOutcome: parts.detectionOutcome ?? 'idle',
    stream,
    streamRemaining: stream.phase === 'fetching' ? null : (parts.streamRemaining ?? null),
    elevation,
    // Rust withholds the count while a pass reports its own figures.
    elevationRemaining: elevation.phase === 'fetching' ? null : (parts.elevationRemaining ?? null),
    elevationPaused: parts.elevationPaused ?? false,
    cutover: parts.cutover ?? { phase: 'idle', running: false },
  };
}
