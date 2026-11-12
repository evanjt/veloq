/**
 * What the detail maps keep of the library's sections and routes.
 *
 * The engine stamps both layers with the database state they were read in. One hold serves every
 * detail map, so a card push that swaps the subject, or a second map opening on the same library,
 * passes the held stamps back and the engine leaves both layers' lines out while nothing has
 * committed. The values keep their identity, so nothing downstream rebuilds or re-serialises them.
 */
import type { FfiMapContextLayers, FfiRouteLineLayer } from 'veloqrs';
import { EMPTY_FEATURE_COLLECTION } from './coordinates';
import { createLayerHold } from './mapLayerHold';
import { createSectionLineCache } from './sectionLineCollection';

/** The library's lines as a detail map draws them. */
export interface ContextLayerData {
  /** The section lines, the same object while the engine's stamp is unchanged. */
  sections: GeoJSON.FeatureCollection;
  /** The route group generation the engine serves the route lines at, absent while there are none. */
  routeGeneration: number | undefined;
}

export const NO_CONTEXT_LAYER_DATA: ContextLayerData = {
  sections: EMPTY_FEATURE_COLLECTION,
  routeGeneration: undefined,
};

export interface ContextLayerHold {
  /** Reads the layers under the held stamps, or `undefined` while the engine is not open. */
  read(
    fetch: (heldSections?: number, heldRoutes?: number) => FfiMapContextLayers | undefined
  ): ContextLayerData;
}

export function createContextLayerHold(): ContextLayerHold {
  const sectionCache = createSectionLineCache();
  const routeHold = createLayerHold<FfiRouteLineLayer, { generation: number } | undefined>(
    undefined,
    (layer) => (layer.routes === undefined ? undefined : { generation: layer.generation })
  );
  let last: ContextLayerData = NO_CONTEXT_LAYER_DATA;
  return {
    read(fetch) {
      const layers = fetch(sectionCache.stamp(), routeHold.stamp());
      const sections = sectionCache.overlay(layers?.sections).collection;
      const routeGeneration = routeHold.take(layers?.routes)?.generation;
      // The same object while neither layer moved, so a memo keyed on it holds.
      if (last.sections !== sections || last.routeGeneration !== routeGeneration) {
        last = { sections, routeGeneration };
      }
      return last;
    },
  };
}

/** The hold every detail map shares. */
export const sharedContextLayerHold = createContextLayerHold();
