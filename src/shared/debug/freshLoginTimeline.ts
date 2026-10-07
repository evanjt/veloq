/**
 * A retained timeline of one sync run, read from the Developer Dashboard.
 *
 * The FFI ring keeps the last 500 calls, which a first sync of a large library
 * overwrites within minutes, so the early milestones live here instead: a few
 * bounded runs, each with its named sync steps and the first visible card and
 * map. Every duration is observer time, the clock of the JavaScript side that
 * saw the engine's announcement, not time measured inside the engine. A
 * milestone nothing observed is `null`, and a failed or stopped run is named
 * as such, so a missing figure is never read as a fast one.
 *
 * Holds no activity ids, credentials or training data.
 */
import { SyncStep, SyncState } from 'veloqrs';

import { buildCommit } from '@/shared/format/buildStamp';

export type TimelineMilestone = 'firstCard' | 'firstMap' | 'backfillSettled';
export type TimelineOutcome = 'running' | 'success' | 'failed' | 'cancelled' | 'abandoned';

export interface TimelineStep {
  step: string;
  startMs: number;
  durationMs: number | null;
}

export interface TimelineRun {
  startedAtMs: number;
  totalMs: number | null;
  outcome: TimelineOutcome;
  build: string | undefined;
  clock: 'observer';
  steps: TimelineStep[];
  milestones: Record<TimelineMilestone, number | null>;
}

interface SyncObservation {
  state: SyncState;
  step?: SyncStep | undefined;
  lastError?: string | undefined;
}

const MAX_STEPS_PER_RUN = 32;
const DEFAULT_MAX_RUNS = 5;

export function createFreshLoginTimeline(options: {
  now: () => number;
  build?: string | undefined;
  maxRuns?: number;
}) {
  const { now, build } = options;
  const maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
  let runs: TimelineRun[] = [];
  let currentStep: SyncStep | undefined;
  let cancelRequested = false;

  const active = (): TimelineRun | undefined => {
    const last = runs[runs.length - 1];
    return last?.outcome === 'running' ? last : undefined;
  };

  const closeStep = (run: TimelineRun, at: number) => {
    const open = run.steps[run.steps.length - 1];
    if (open && open.durationMs === null) open.durationMs = at - run.startedAtMs - open.startMs;
  };

  const settle = (run: TimelineRun, outcome: TimelineOutcome) => {
    const at = now();
    closeStep(run, at);
    run.totalMs = at - run.startedAtMs;
    run.outcome = outcome;
    if (outcome === 'success') run.milestones.backfillSettled = run.totalMs;
    currentStep = undefined;
    cancelRequested = false;
  };

  const begin = () => {
    const run: TimelineRun = {
      startedAtMs: now(),
      totalMs: null,
      outcome: 'running',
      build,
      clock: 'observer',
      steps: [],
      milestones: { firstCard: null, firstMap: null, backfillSettled: null },
    };
    runs.push(run);
    if (runs.length > maxRuns) runs = runs.slice(runs.length - maxRuns);
    currentStep = undefined;
    cancelRequested = false;
    return run;
  };

  return {
    observeSync(status: SyncObservation | null): void {
      if (!status) return;
      const run = active();
      if (status.state === SyncState.Syncing) {
        const current = run ?? begin();
        if (status.step === undefined || status.step === currentStep) return;
        const at = now();
        closeStep(current, at);
        currentStep = status.step;
        if (current.steps.length < MAX_STEPS_PER_RUN) {
          current.steps.push({
            step: SyncStep[status.step] ?? String(status.step),
            startMs: at - current.startedAtMs,
            durationMs: null,
          });
        }
        return;
      }
      if (!run) return;
      if (status.state === SyncState.AuthExpired || status.lastError) settle(run, 'failed');
      else if (cancelRequested || status.state === SyncState.Paused) settle(run, 'cancelled');
      else settle(run, 'success');
    },

    // The engine reports a stopped run as an ordinary idle settle, so the stop
    // has to be noted where it is asked for.
    markCancelRequested(): void {
      if (active()) cancelRequested = true;
    },

    mark(milestone: Exclude<TimelineMilestone, 'backfillSettled'>): void {
      const run = runs[runs.length - 1];
      if (!run || run.milestones[milestone] !== null) return;
      run.milestones[milestone] = now() - run.startedAtMs;
    },

    runs(): TimelineRun[] {
      return runs.map((run) => ({
        ...run,
        steps: run.steps.map((s) => ({ ...s })),
        milestones: { ...run.milestones },
      }));
    },

    clear(): void {
      runs = [];
      currentStep = undefined;
      cancelRequested = false;
    },
  };
}

export const freshLoginTimeline = createFreshLoginTimeline({
  now: () => Date.now(),
  build: buildCommit(),
});
