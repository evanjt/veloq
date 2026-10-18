/**
 * The one shape every engine run handle answers in.
 *
 * A run handle starts with the typed start verdict, reads where its run
 * stands in one `FfiRunProgress`, hands its result over once with `take` and
 * says with `cancel` whether there was a run to stop. This narrows the
 * engine's state to the word a screen switches on, in the one place, so no
 * caller keeps its own table of states.
 */

import { FfiRunState, type FfiRunProgress } from '../generated/veloqrs';

/** Where a run stands, as a screen switches on it. */
export type RunStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed' | 'refused';

/** Where a run stands and how far along it is. */
export interface RunProgress {
  status: RunStatus;
  /** The phase the run is in, empty when it has none. */
  phase: string;
  /** Items done in the current phase. */
  completed: number;
  /** Items in the current phase, 0 when the run cannot count them. */
  total: number;
  /** Phase-weighted overall percent, 0 to 100. */
  percent: number;
}

/** The engine's state as a screen word. Unknown reads as failed. */
function statusOf(state: FfiRunState): RunStatus {
  switch (state) {
    case FfiRunState.Idle:
      return 'idle';
    case FfiRunState.Running:
      return 'running';
    case FfiRunState.Complete:
      return 'complete';
    case FfiRunState.Cancelled:
      return 'cancelled';
    case FfiRunState.Refused:
      return 'refused';
    default:
      return 'failed';
  }
}

/** A run in `status` with nothing counted. */
export function runAt(status: RunStatus): RunProgress {
  return { status, phase: '', completed: 0, total: 0, percent: 0 };
}

/**
 * The engine's record as a screen reads it. A state this side does not know
 * reads as failed, since a run nobody can follow has not delivered anything.
 */
export function toRunProgress(progress: FfiRunProgress): RunProgress {
  return {
    status: statusOf(progress.state),
    phase: progress.phase,
    completed: progress.completed,
    total: progress.total,
    percent: progress.percent,
  };
}
