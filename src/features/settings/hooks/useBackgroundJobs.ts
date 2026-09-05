/**
 * The app's standing answer to what it is doing right now.
 *
 * Four long-running jobs report through different mechanisms, and each one had
 * only its own scattered surface. This composes them into one list so a screen
 * can render every job always, resting state included, rather than a row that
 * appears only while its job happens to hold the process.
 *
 * A job that has never run in this process reads as idle. That is honest: the
 * phases the engine keeps are process-global and start at idle on every launch,
 * so a resting row reports the work waiting rather than a run that is over.
 */

import { useEffect, useState } from 'react';
import { SyncState } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';
import { useCutoverSummary } from '@/features/routes/hooks/useCutoverSummary';

export type BackgroundJobId = 'sync' | 'detection' | 'elevationBackfill' | 'cutover';

/**
 * `partial` and `paused` are the elevation backfill's own terminal states: a
 * pass that finished but left activities a later run retries, and one the
 * athlete stopped until the app is next opened. No other job can reach them.
 */
export type BackgroundJobState = 'idle' | 'running' | 'complete' | 'partial' | 'failed' | 'paused';

export interface BackgroundJob {
  id: BackgroundJobId;
  state: BackgroundJobState;
  /** Items the reported run has finished, 0 when the job counts nothing. */
  completed: number;
  /** Items the reported run started with, 0 when the length is unknown. */
  total: number;
  /** Overall percent 0-100, or null when the job does not report one. */
  percent: number | null;
  /** Work still waiting while idle, null when it cannot be counted. */
  remaining: number | null;
  /** The running job's phase token, null when it names no phases. */
  phase: string | null;
}

/**
 * Detection announces only that a run was applied, never that one started, so
 * an adopted run can be found no other way than by asking.
 */
const DETECTION_POLL_MS = 1000;

/** The channel `EngineObserver.backfill_phase` lands on. */
const BACKFILL_PHASE_CHANNEL = 'backfillPhase';

interface DetectionStatus {
  state: BackgroundJobState;
  completed: number;
  total: number;
  percent: number | null;
  phase: string | null;
}

const DETECTION_IDLE: DetectionStatus = {
  state: 'idle',
  completed: 0,
  total: 0,
  percent: null,
  phase: null,
};

function readDetection(previous: DetectionStatus): DetectionStatus {
  const engine = getEngine();
  if (!engine) return DETECTION_IDLE;
  let status: string;
  try {
    status = engine.pollSectionDetection?.() ?? 'idle';
  } catch {
    return DETECTION_IDLE;
  }
  if (status === 'error') return { ...DETECTION_IDLE, state: 'failed' };
  // A finished run keeps whatever the last poll saw, so the row does not snap
  // back to zero the instant it settles.
  if (status !== 'running') {
    const settled: BackgroundJobState = status === 'complete' ? 'complete' : 'idle';
    return previous.state === settled && previous.phase === null
      ? previous
      : { ...previous, state: settled, phase: null };
  }
  let progress: { phase: string; completed: number; total: number; percent: number } | null = null;
  try {
    progress = engine.getSectionDetectionProgress?.() ?? null;
  } catch {
    progress = null;
  }
  if (!progress) return { ...DETECTION_IDLE, state: 'running' };
  return {
    state: 'running',
    completed: progress.completed,
    total: progress.total,
    percent: progress.percent,
    phase: progress.phase,
  };
}

function sameDetection(a: DetectionStatus, b: DetectionStatus): boolean {
  return (
    a.state === b.state &&
    a.completed === b.completed &&
    a.total === b.total &&
    a.percent === b.percent &&
    a.phase === b.phase
  );
}

function useDetectionStatus(): DetectionStatus {
  const [state, setState] = useState<DetectionStatus>(() => readDetection(DETECTION_IDLE));

  useEffect(() => {
    // Reading through the updater keeps the poll off any captured snapshot, so
    // the interval never needs re-creating to see the run it is following.
    const tick = () =>
      setState((previous) => {
        const next = readDetection(previous);
        return sameDetection(previous, next) ? previous : next;
      });
    const timer = setInterval(tick, DETECTION_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return state;
}

function readRemaining(): number | null {
  const engine = getEngine();
  if (!engine) return null;
  try {
    return engine.getElevationBackfillRemaining?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * The queue length behind the elevation backfill, read once at mount and again
 * on every phase Rust announces. Null means the engine could not answer, which
 * must not read as "nothing left to do".
 */
function useBackfillRemaining(): number | null {
  const [remaining, setRemaining] = useState(readRemaining);

  useEffect(() => {
    const engine = getEngine();
    const unsubscribe = engine?.subscribe(BACKFILL_PHASE_CHANNEL, () =>
      setRemaining(readRemaining())
    );
    return () => unsubscribe?.();
  }, []);

  return remaining;
}

function syncState(
  state: SyncState | undefined,
  lastError: string | undefined
): BackgroundJobState {
  if (state === SyncState.Syncing) return 'running';
  if (state === SyncState.AuthExpired) return 'failed';
  return lastError ? 'failed' : 'idle';
}

function backfillState(phase: string): BackgroundJobState {
  switch (phase) {
    case 'fetching':
      return 'running';
    case 'complete':
      return 'complete';
    case 'partial':
      return 'partial';
    case 'failed':
      return 'failed';
    case 'paused':
      return 'paused';
    default:
      return 'idle';
  }
}

function cutoverState(phase: string, running: boolean): BackgroundJobState {
  if (running) return 'running';
  if (phase === 'complete') return 'complete';
  if (phase === 'failed') return 'failed';
  return 'idle';
}

/** Every job, in the order the screen lists them. Never empty. */
export function useBackgroundJobs(): BackgroundJob[] {
  const sync = useSyncStatus();
  const detection = useDetectionStatus();
  const backfill = useElevationBackfill();
  const cutover = useCutoverSummary();
  const backfillRemaining = useBackfillRemaining();

  return [
    {
      id: 'sync',
      state: syncState(sync?.state, sync?.lastError),
      completed: sync?.completed ?? 0,
      total: sync?.total ?? 0,
      percent: null,
      remaining: null,
      phase: null,
    },
    {
      id: 'detection',
      state: detection.state,
      completed: detection.completed,
      total: detection.total,
      percent: detection.percent,
      remaining: null,
      phase: detection.phase,
    },
    {
      id: 'elevationBackfill',
      state: backfillState(backfill.phase),
      completed: backfill.completed,
      total: backfill.total,
      percent: null,
      remaining: backfillRemaining,
      phase: null,
    },
    {
      id: 'cutover',
      state: cutoverState(cutover.phase, cutover.isRunning),
      completed: 0,
      total: 0,
      percent: null,
      remaining: null,
      phase: cutover.isRunning ? cutover.phase : null,
    },
  ];
}
