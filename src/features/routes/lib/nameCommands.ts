import { PlaceNameOutcome, type PlaceNameKind } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';

/**
 * The naming commands the route and section detail screens send the engine.
 * What a name shows comes back through each screen's detail read.
 */

/** Store the name the athlete typed for a route. Throws when the engine is closed. */
export function setRouteName(routeId: string, name: string): void {
  const engine = getEngine();
  if (!engine) {
    throw new Error('Route engine not initialised');
  }
  engine.setRouteName(routeId, name);
}

/** Ask for a route or section to be named from its places. */
export function nameFromPlaces(kind: PlaceNameKind, itemId: string): Promise<PlaceNameOutcome> {
  const engine = getEngine();
  if (!engine) return Promise.resolve(PlaceNameOutcome.Failed);
  return engine.nameFromPlaces(kind, itemId);
}
