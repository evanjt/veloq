import type { FollowState } from '@/features/recording/lib/planFollow';

/**
 * What the live view shows for a strength session: the set in hand or the rest
 * between sets, and the set that follows.
 */
export interface StrengthLiveActivityState {
  kind: 'strength';
  phase: 'set' | 'rest';
  /** The exercise in hand, or the one just finished while resting. */
  exercise: string;
  /** The set after this one, null on the last line. */
  nextSet: string | null;
  /**
   * Wall-clock ms the rest ends at. The card draws its countdown from it with the
   * system timer, so it keeps running while the app is suspended. Null on a set and
   * on a rest that has no length.
   */
  restEndsAt: number | null;
  /** Wall-clock ms after which the card is stale, one rest past its end, so a dead process stops counting. */
  staleAt: number;
}

/** How long past its end a rest still counts as live before the card goes stale. */
const REST_STALE_GRACE_MS = 5 * 60 * 1000;
const SET_STALE_MS = 15 * 60 * 1000;

/** The line index of the nearest earlier work line, so a rest names the exercise it follows. */
function exerciseBefore(follow: FollowState, index: number): string {
  for (let i = index; i >= 0; i -= 1) {
    const line = follow.lines[i];
    if (line && line.kind === 'work') return line.text;
  }
  return '';
}

function nextWork(follow: FollowState, from: number): string | null {
  for (let i = from + 1; i < follow.lines.length; i += 1) {
    const line = follow.lines[i];
    if (line && line.kind === 'work') return line.text;
  }
  return null;
}

/** The live view's state for a strength session, null once it has finished or has no line. */
export function buildStrengthContentState(
  follow: FollowState,
  now: number
): StrengthLiveActivityState | null {
  if (follow.finishedAt != null) return null;
  const line = follow.lines[follow.index];
  if (!line) return null;

  if (line.kind === 'rest') {
    const restEndsAt =
      line.durationSeconds != null ? follow.lineStartedAt + line.durationSeconds * 1000 : null;
    return {
      kind: 'strength',
      phase: 'rest',
      exercise: exerciseBefore(follow, follow.index),
      nextSet: nextWork(follow, follow.index),
      restEndsAt,
      staleAt: (restEndsAt ?? now) + REST_STALE_GRACE_MS,
    };
  }

  return {
    kind: 'strength',
    phase: 'set',
    exercise: line.text,
    nextSet: nextWork(follow, follow.index),
    restEndsAt: null,
    staleAt: now + SET_STALE_MS,
  };
}
