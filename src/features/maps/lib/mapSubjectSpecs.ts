/**
 * What a detail map draws for one subject: a route, a section or an activity. Each kind builds it
 * with one pure function of its data, so the view that draws the subject on its own surface and a
 * host's one surface that swaps between subjects draw the same thing.
 */
import type { LngLatBounds } from './coordinates';
import type { MapImageSpec, MapLayerSpec, MapSourceSpec } from './htmlBuilders/mapSurface';

export interface MapSubjectSpecs {
  sources: Record<string, MapSourceSpec>;
  layers: MapLayerSpec[];
  images: MapImageSpec[];
  /** Layers hit-tested on tap, most specific first, or none. */
  interactiveLayers: string[] | undefined;
  /** The subject's extent, which the map fits, or null for a subject with no line. */
  bounds: LngLatBounds | null;
}
