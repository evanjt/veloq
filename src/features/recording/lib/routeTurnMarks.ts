import type { FfiRouteTurn } from 'veloqrs';

import { featureCollection, pointFeature } from '@/features/maps';
import { spacing, stroke } from '@/theme';

/** The size a turn mark is drawn at, from the theme's scales. The next turn ahead is the larger. */
export const TURN_MARK_SIZE = {
  radius: spacing.xs,
  nextRadius: spacing.sm,
  strokeWidth: stroke.one,
};

export type TurnMarkSize = typeof TURN_MARK_SIZE;

/**
 * One point per turn on the followed line. The turn whose `alongM` is the engine's next turn
 * ahead carries `next`, and no other does. The engine's own value is matched, so no turn is
 * placed again here.
 */
export function routeTurnMarks(turns: readonly FfiRouteTurn[], nextAlongM: number | null) {
  return featureCollection(
    turns.map((turn) => pointFeature([turn.lng, turn.lat], { next: turn.alongM === nextAlongM }))
  );
}
