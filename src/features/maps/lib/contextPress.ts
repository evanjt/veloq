import type { MapFeatureHit } from '../components/MapSurface';
import { CONTEXT_ROUTES_HIT_LAYER_ID, CONTEXT_SECTIONS_HIT_LAYER_ID } from './contextLayerSpecs';

/** A library section or route a tap landed on, as the context layer's feature names it. */
export interface ContextSubject {
  kind: 'section' | 'route';
  id: string;
  name: string;
  distanceMeters: number;
}

const KIND_BY_LAYER: Record<string, ContextSubject['kind']> = {
  [CONTEXT_SECTIONS_HIT_LAYER_ID]: 'section',
  [CONTEXT_ROUTES_HIT_LAYER_ID]: 'route',
};

/**
 * The distinct library sections and routes under a tap, in the order the surface returned them.
 * A hit on any other layer, the subject's own among them, names none.
 */
export function contextSubjectsAtTap(hits: readonly MapFeatureHit[]): ContextSubject[] {
  const seen = new Set<string>();
  const subjects: ContextSubject[] = [];
  for (const hit of hits) {
    const kind = hit.layerId === null ? undefined : KIND_BY_LAYER[hit.layerId];
    const { id, name, distanceMeters } = hit.properties ?? {};
    if (kind === undefined || typeof id !== 'string' || id.length === 0) continue;
    if (seen.has(`${kind}:${id}`)) continue;
    seen.add(`${kind}:${id}`);
    subjects.push({
      kind,
      id,
      name: typeof name === 'string' ? name : '',
      distanceMeters: typeof distanceMeters === 'number' ? distanceMeters : 0,
    });
  }
  return subjects;
}
