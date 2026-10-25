/** The engine's Garmin pull call, behind the shared engine layer. */

import { sync } from 'veloqrs';

/** Pull Garmin's rides now: a paused pass goes on and a stopped one starts. */
export const pullGarminNow = (): boolean => sync.pullGarminNow();
