/**
 * The engine's Garmin key calls, behind the shared engine layer so a feature
 * does not reach the engine itself.
 */

import { sync } from 'veloqrs';

/** Ask Garmin whether a pasted key works, holding it in the engine only when it does. */
export const connectGarmin = (key: string) => sync.connectGarmin(key);

/** Give the engine the key the keychain kept, without asking Garmin. */
export const holdGarminKey = (key: string): void => sync.holdGarminKey(key);

/** Forget the key in the engine. */
export const clearGarminKey = (): void => sync.clearGarminKey();
