import { isRouteNameTakenError, PlaceNameOutcome, type PlaceNameKind } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';

/**
 * The naming commands the route and section detail screens send the engine.
 * What a name shows comes back through each screen's detail read.
 */

/**
 * Store the name the athlete typed for a route, or say another route is
 * already shown under it, in which case nothing changed. Throws when the
 * engine is closed or the write fails.
 */
export function setRouteName(routeId: string, name: string): 'saved' | 'nameTaken' {
  const engine = getEngine();
  if (!engine) {
    throw new Error('Route engine not initialised');
  }
  try {
    engine.setRouteName(routeId, name);
    return 'saved';
  } catch (error) {
    if (isRouteNameTakenError(error)) return 'nameTaken';
    throw error;
  }
}

/** Ask for a route or section to be named from its places. */
export function nameFromPlaces(kind: PlaceNameKind, itemId: string): Promise<PlaceNameOutcome> {
  const engine = getEngine();
  if (!engine) return Promise.resolve(PlaceNameOutcome.Failed);
  return engine.nameFromPlaces(kind, itemId);
}
