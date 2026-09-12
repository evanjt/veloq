/**
 * The app's standing answer to what it is doing right now.
 *
 * Three long-running jobs report through different mechanisms, and each one had
 * only its own scattered surface. This composes them into one list so a screen
 * can render every job always, resting state included, rather than a row that
 * appears only while its job happens to hold the process.
 *
 * Sync is not one of them. A resting row is only honest if it says what is
 * waiting, and each of the three below counts something it owes: activities
 * never looked at, tracks yet to fetch, one rebuild outstanding. Sync is
 * scheduled rather than owed, so it had no count to rest on and its row said
 * "Not running" whatever the state of the library.
 *
 * A job that has never run in this process reads as idle. That is honest: the
 * phases the engine keeps are process-global and start at idle on every launch,
 * so a resting row reports the work waiting rather than a run that is over.
 */

import { useEffect, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';
import { useCutoverSummary } from '@/features/routes/hooks/useCutoverSummary';

export type BackgroundJobId = 'detection' | 'elevationBackfill' | 'cutover';

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

/** The channel a finished cutover lands on, which is when the token clears. */
const CUTOVER_SETTLED_CHANNEL = 'cutoverSettled';

interface DetectionStatus {
  state: BackgroundJobState;
  completed: number;
  total: number;
  percent: number | null;
  /** What a run still owes while none is holding the slot. */
  awaiting: number | null;
  phase: string | null;
}

const DETECTION_IDLE: DetectionStatus = {
  state: 'idle',
  completed: 0,
  total: 0,
  percent: null,
  awaiting: null,
  phase: null,
};

/**
 * This screen watches detection, it does not settle it.
 *
 * `pollSectionDetection` is a taking read: it receives the completion from the
 * worker's channel, so whoever polls first applies the run and everyone else
 * then sees idle. This row used to poll on a one second timer, which took the
 * completion out from under the follower waiting on the same run, and the
 * rescan behind it reported no change on a run that had really finished.
 *
 * So the state is read from two things that consume nothing: the progress says
 * whether a run holds the slot now, and the outcome says how the last finished
 * one ended.
 */
function readDetection(previous: DetectionStatus): DetectionStatus {
  const engine = getEngine();
  if (!engine) return DETECTION_IDLE;
  let progress: { phase: string; completed: number; total: number; percent: number } | null = null;
  try {
    progress = engine.getSectionDetectionProgress?.() ?? null;
  } catch {
    return DETECTION_IDLE;
  }
  if (!progress) {
    const awaiting = readDetectionAwaiting();
    let outcome = 'idle';
    try {
      outcome = engine.lastSectionDetectionOutcome?.() ?? 'idle';
    } catch {
      outcome = 'idle';
    }
    if (outcome === 'error') return { ...DETECTION_IDLE, state: 'failed', awaiting };
    // A finished run keeps whatever the last read saw, so the row does not
    // snap back to zero the instant it settles.
    const settled: BackgroundJobState = outcome === 'complete' ? 'complete' : 'idle';
    return previous.state === settled && previous.phase === null && previous.awaiting === awaiting
      ? previous
      : { ...previous, state: settled, phase: null, awaiting };
  }
  return {
    state: 'running',
    completed: progress.completed,
    total: progress.total,
    percent: progress.percent,
    // A run in flight is not also waiting, and the row already says it is
    // running, so the count is what a resting row rests on and nothing else.
    awaiting: null,
    phase: progress.phase,
  };
}

function sameDetection(a: DetectionStatus, b: DetectionStatus): boolean {
  return (
    a.state === b.state &&
    a.completed === b.completed &&
    a.total === b.total &&
    a.percent === b.percent &&
    a.awaiting === b.awaiting &&
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

/**
 * The activities detection has never seen. Read on the same timer the progress
 * is, since nothing announces a run starting and nothing announces the pool
 * moving under one either.
 */
function readDetectionAwaiting(): number | null {
  const engine = getEngine();
  if (!engine) return null;
  try {
    return engine.sectionDetectionAwaiting?.() ?? null;
  } catch {
    return null;
  }
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

/**
 * Whether a cutover is still owed, as a count the row can rest on.
 *
 * The cutover's phase is a process-global static starting at idle, so a
 * relaunch with a re-cut still owed showed this row reporting nothing. The
 * in-flight token behind it is durable and already exported; the screen was
 * simply not asking. One cutover is one unit of work, so the count is one or
 * zero, and null when the engine cannot answer, which must not read as done.
 */
function readCutoverPending(): number | null {
  const engine = getEngine();
  if (!engine) return null;
  try {
    return engine.isCutoverPending?.() ? 1 : 0;
  } catch {
    return null;
  }
}

function useCutoverPending(): number | null {
  const [pending, setPending] = useState(readCutoverPending);

  useEffect(() => {
    const engine = getEngine();
    const unsubscribe = engine?.subscribe(CUTOVER_SETTLED_CHANNEL, () =>
      setPending(readCutoverPending())
    );
    return () => unsubscribe?.();
  }, []);

  return pending;
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

/**
 * Whether a detection run holds the slot now, and nothing else.
 *
 * The jobs screen's `useDetectionStatus` reads three things a tick, and one of
 * them, `sectionDetectionAwaiting`, is a COUNT taken under the engine's write
 * lock: a tick landing while a sync write holds it stalls the caller's JS
 * thread for as long as the write runs. A screen that only says how many jobs
 * are running has no use for the count, nor for how the last run ended.
 */
function useDetectionRunning(): boolean {
  const [running, setRunning] = useState(readDetectionRunning);

  useEffect(() => {
    // Detection announces only that a run was applied, never that one started,
    // so a poll is the only way to find an adopted run. One read, and a
    // non-taking one.
    const timer = setInterval(() => setRunning(readDetectionRunning()), DETECTION_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return running;
}

function readDetectionRunning(): boolean {
  const engine = getEngine();
  if (!engine) return false;
  try {
    return (engine.getSectionDetectionProgress?.() ?? null) !== null;
  } catch {
    return false;
  }
}

/**
 * How many jobs are running, for a subtitle that says only that.
 *
 * The backfill and the cutover hooks poll only while their own run is in
 * flight and rest on a subscription otherwise, so they cost nothing here at
 * rest. Detection is the one that has to be asked, and this asks it for the
 * one fact the count needs.
 */
export function useRunningJobCount(): number {
  const detectionRunning = useDetectionRunning();
  const backfill = useElevationBackfill();
  const cutover = useCutoverSummary();

  return (
    (detectionRunning ? 1 : 0) +
    (backfillState(backfill.phase) === 'running' ? 1 : 0) +
    (cutoverState(cutover.phase, cutover.isRunning) === 'running' ? 1 : 0)
  );
}

/** Every job, in the order the screen lists them. Never empty. */
export function useBackgroundJobs(): BackgroundJob[] {
  const detection = useDetectionStatus();
  const backfill = useElevationBackfill();
  const cutover = useCutoverSummary();
  const backfillRemaining = useBackfillRemaining();
  const cutoverPending = useCutoverPending();

  return [
    {
      id: 'detection',
      state: detection.state,
      completed: detection.completed,
      total: detection.total,
      percent: detection.percent,
      remaining: detection.awaiting,
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
      // A run in flight is not also waiting, and the row already says it is
      // running, so the count is what a resting row rests on and nothing else.
      remaining: cutover.isRunning ? null : cutoverPending,
      phase: cutover.isRunning ? cutover.phase : null,
    },
  ];
}
