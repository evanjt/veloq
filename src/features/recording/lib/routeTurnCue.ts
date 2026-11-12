import type { FfiNextTurn } from 'veloqrs';

/** The cue shows within this many metres of the turn, so it reads as a cue and not a list. */
export const TURN_CUE_M = 150;

/** A heading change over this many degrees is a hairpin, which reads as a turn back. */
export const HAIRPIN_DEG = 150;

export interface TurnCue {
  kind: 'left' | 'right' | 'back';
  distanceM: number;
}

/**
 * The cue for the next turn ahead, or null when there is none or it is further than
 * `TURN_CUE_M`. The sign of the engine's heading change gives the side: negative is a left turn.
 */
export function turnCue(nextTurn: FfiNextTurn | null | undefined): TurnCue | null {
  if (!nextTurn || nextTurn.distanceM > TURN_CUE_M) return null;
  const { angleDeg, distanceM } = nextTurn;
  if (Math.abs(angleDeg) > HAIRPIN_DEG) return { kind: 'back', distanceM };
  return { kind: angleDeg < 0 ? 'left' : 'right', distanceM };
}
