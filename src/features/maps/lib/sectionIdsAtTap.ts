import type { MapFeatureHit } from '../components/MapSurface';
import { SECTIONS_LINE_LAYER_ID } from '../components/regional/regionalMapLayerSpecs';

/** Distinct section ids in the order returned by the map surface. */
export function sectionIdsAtTap(hits: readonly MapFeatureHit[]): string[] {
  const ids = new Set<string>();
  for (const hit of hits) {
    const id = hit.properties?.id;
    if (hit.layerId === SECTIONS_LINE_LAYER_ID && typeof id === 'string') ids.add(id);
  }
  return [...ids];
}
