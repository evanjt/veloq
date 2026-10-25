/**
 * The engine's Garmin file swap calls, behind the shared engine layer so a
 * feature does not reach the engine itself.
 */

import { sync } from 'veloqrs';

/** Whether the activity offers Garmin's own file, an undo of an earlier swap, or nothing. */
export const garminSwapState = (activityId: string) => sync.garminSwapState(activityId);

/** Replace intervals.icu's file for the activity with Garmin's original. */
export const garminSwapReplace = (activityId: string) => sync.garminSwapReplace(activityId);

/** Put the file intervals.icu held before the swap back. */
export const garminSwapUndo = (activityId: string) => sync.garminSwapUndo(activityId);
