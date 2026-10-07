/**
 * The app's standing answer to what it is doing right now.
 *
 * Four long-running jobs report through different mechanisms, and each one had
 * only its own scattered surface. This composes them into one list so a screen
 * can render every job always, resting state included, rather than a row that
 * appears only while its job happens to hold the process.
 *
 * Sync is not one of them. A resting row is only honest if it says what is
 * waiting, and each of the four below counts something it owes: activities
 * never looked at, tracks yet to fetch, one rebuild outstanding, series yet to
 * download. Sync is
 * scheduled rather than owed, so it had no count to rest on and its row said
 * "Not running" whatever the state of the library.
 *
 * A job that has never run in this process reads as idle. That is honest: the
 * phases the engine keeps are process-global and start at idle on every launch,
 * so a resting row reports the work waiting rather than a run that is over.
 */

import { useEffect, useMemo, useState } from 'react';

import { followRoutesStatus, readRoutesStatus } from '@/shared/native/routesStatusPoll';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { RoutesStatus } from 'veloqrs';

export type BackgroundJobId = 'detection' | 'elevationBackfill' | 'cutover' | 'streamBackfill';

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
  /** The job's last finished run, null when it has never run on this install. */
  lastRun: BackgroundJobRun | null;
}

/** One finished run as the engine recorded it. */
export interface BackgroundJobRun {
  /** When the run finished, epoch milliseconds. */
  finishedAt: number;
  /** complete, partial, failed, paused or stopped. */
  outcome: string;
  handled: number;
  added: number;
  changed: number;
  retired: number;
  failed: number;
}

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
 * `pollSectionDetection` can take a finished run's result off the worker's
 * channel. This row used to poll on a one second timer, which took the
 * completion out from under the follower waiting on the same run, and the
 * rescan behind it reported no change on a run that had really finished.
 *
 * So the state is read from two things that consume nothing: the progress says
 * whether a run holds the slot now, and the outcome says how the last finished
 * one ended.
 */
function readDetection(
  previous: DetectionStatus,
  status: RoutesStatus | null,
  awaiting: number | null
): DetectionStatus {
  if (!status) return DETECTION_IDLE;
  const progress = status.detection;
  if (!progress) {
    const outcome = status.detectionOutcome;
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

/** The parts of the engine's background jobs screen read this hook uses. */
interface BackgroundJobsData {
  runs: (BackgroundJobRun & { job: string })[];
  detectionAwaiting?: number;
  cutoverOwed: boolean;
}

/**
 * What the engine's background jobs screen read says: each job's last run, the
 * activities detection has never seen, and whether a cutover is owed.
 *
 * It is a `COUNT` and a table read under the engine's connection, so it is
 * taken on the channels that move it and never on the progress tick: a run
 * settling, activities landing and a cutover finishing are all announced. The
 * cutover's phase is a process-global static that starts at idle, so the owed
 * rebuild comes from the durable token behind this read, and a relaunch with a
 * re-cut still owed is not reported as nothing to do. Undefined means the
 * engine could not answer, which a count must not read as nothing left to do.
 */
function useBackgroundJobsData(): BackgroundJobsData | undefined {
  const readEngine = useEngineRead([
    'activities',
    'detectionApplied',
    'backfillPhase',
    'streamBackfillPhase',
    'cutoverSettled',
  ]);
  return useMemo(
    () =>
      readEngine((engine) => {
        try {
          return engine.getBackgroundJobsData?.();
        } catch {
          // empty-on-error: undefined is "could not answer", which the rows read as unknown and
          // never as nothing left to do.
          return undefined;
        }
      }),
    [readEngine]
  );
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
  // A failure after the apply left the new sections in place, but the run
  // still did not finish and is still owed.
  if (phase === 'failed' || phase === 'failed_after_apply') return 'failed';
  return 'idle';
}

/**
 * The stream pass's phase as a job state. A pass held for the athlete's
 * consent is not running, it is owed, so it rests on its count.
 */
function streamState(phase: string): BackgroundJobState {
  switch (phase) {
    case 'fetching':
      return 'running';
    case 'complete':
      return 'complete';
    case 'partial':
      return 'partial';
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

/** Every job from one shared routes status read. */
export function useBackgroundJobs(): BackgroundJob[] {
  const data = useBackgroundJobsData();
  const awaiting = data ? (data.detectionAwaiting ?? null) : null;
  const [status, setStatus] = useState(readRoutesStatus);
  const [detection, setDetection] = useState<DetectionStatus>(() =>
    readDetection(DETECTION_IDLE, status, awaiting)
  );

  useEffect(
    () =>
      followRoutesStatus((next) => {
        setStatus(next);
        setDetection((previous) => readDetection(previous, next, awaiting));
      }),
    [awaiting]
  );

  return jobsFromStatus(status, detection, data);
}

function jobsFromStatus(
  status: RoutesStatus | null,
  detection: DetectionStatus,
  data: BackgroundJobsData | undefined
): BackgroundJob[] {
  // One unit of work, so the count is one or zero.
  const cutoverPending = data ? (data.cutoverOwed ? 1 : 0) : null;
  const lastRun = (id: BackgroundJobId): BackgroundJobRun | null => {
    const found = data?.runs.find((candidate) => candidate.job === id);
    return found
      ? {
          finishedAt: found.finishedAt,
          outcome: found.outcome,
          handled: found.handled,
          added: found.added,
          changed: found.changed,
          retired: found.retired,
          failed: found.failed,
        }
      : null;
  };
  const elevation = status?.elevation;
  const cutover = status?.cutover;
  const stream = status?.stream;
  return [
    {
      id: 'detection',
      state: detection.state,
      completed: detection.completed,
      total: detection.total,
      percent: detection.percent,
      remaining: detection.awaiting,
      phase: detection.phase,
      lastRun: lastRun('detection'),
    },
    {
      id: 'elevationBackfill',
      state: backfillState(elevation?.phase ?? 'idle'),
      completed: elevation?.completed ?? 0,
      total: elevation?.total ?? 0,
      percent: null,
      remaining: status?.elevationRemaining ?? null,
      phase: null,
      lastRun: lastRun('elevationBackfill'),
    },
    {
      id: 'cutover',
      state: cutoverState(cutover?.phase ?? 'idle', cutover?.running ?? false),
      completed: 0,
      total: 0,
      percent: null,
      remaining: cutover?.running ? null : cutoverPending,
      phase: cutover?.running ? cutover.phase : null,
      lastRun: lastRun('cutover'),
    },
    {
      id: 'streamBackfill',
      state: streamState(stream?.phase ?? 'idle'),
      completed: stream?.completed ?? 0,
      total: stream?.total ?? 0,
      percent: null,
      remaining: status?.streamRemaining ?? null,
      phase: null,
      lastRun: lastRun('streamBackfill'),
    },
  ];
}
