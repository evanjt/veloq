/**
 * The one owner of a foreground GPS fix. Every screen that waits on the device
 * for a position goes through here, so the wait has one ceiling and one answer
 * for a fix that never comes.
 *
 * A cold fix indoors can take half a minute on Android, because the fused
 * provider caps a request that sets no duration. Without a ceiling of its own
 * a caller holds its loading flag, and the control behind the flag, for that
 * whole time.
 */
import * as Location from 'expo-location';

import { withAwakeDeadline } from '@/shared/async/awakeDeadline';

/**
 * How long a foreground fix may take before the caller stops waiting. It is the
 * same figure as the recording screen's readiness wait, so the two read alike.
 */
export const FOREGROUND_FIX_DEADLINE_MS = 15_000;

/**
 * The coords of a fix taken inside the ceiling, or null when the ceiling arrived
 * first. A fix that lands after the ceiling is dropped, so a caller never moves
 * the map or the dot under an athlete who has moved on. A failed fix rejects.
 */
export async function requestForegroundFix(
  accuracy: Location.LocationAccuracy
): Promise<Location.LocationObjectCoords | null> {
  const outcome = await withAwakeDeadline(
    Location.getCurrentPositionAsync({ accuracy }),
    FOREGROUND_FIX_DEADLINE_MS
  );
  return outcome.state === 'complete' ? outcome.value.coords : null;
}
