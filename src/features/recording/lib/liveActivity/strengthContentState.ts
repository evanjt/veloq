import { FfiFocusPhase, type FfiFocusState } from 'veloqrs';

import {
  focusSetText,
  type FocusNames,
  type FocusTranslate,
} from '@/features/recording/lib/strengthFocus';

/**
 * What the live view shows for a strength session: the set in hand or the rest
 * between sets, and the set that follows.
 */
export interface StrengthLiveActivityState {
  kind: 'strength';
  phase: 'set' | 'rest';
  /** The exercise in hand, or the one the rest is before. */
  exercise: string;
  /** The set the rest is before, null on a set. */
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

/**
 * The live view's state drawn from the engine's focus read, null once the session has finished or
 * has no set. The read's times are epoch seconds and the card's are ms.
 */
export function buildStrengthContentState(
  focus: FfiFocusState | null | undefined,
  names: FocusNames,
  now: number,
  translate: FocusTranslate
): StrengthLiveActivityState | null {
  const set = focus?.current;
  if (!focus || !set || focus.phase === FfiFocusPhase.Finished) return null;

  if (focus.phase === FfiFocusPhase.Rest) {
    const restEndsAt = focus.restEndsAt != null ? focus.restEndsAt * 1000 : null;
    return {
      kind: 'strength',
      phase: 'rest',
      exercise: names.current,
      nextSet: `${names.current} · ${focusSetText(set, translate)}`,
      restEndsAt,
      staleAt: (restEndsAt ?? now) + REST_STALE_GRACE_MS,
    };
  }

  return {
    kind: 'strength',
    phase: 'set',
    exercise: names.current,
    nextSet: null,
    restEndsAt: null,
    staleAt: now + SET_STALE_MS,
  };
}
