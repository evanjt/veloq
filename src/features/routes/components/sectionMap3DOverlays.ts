/**
 * The section map's overlays as the 3D page takes them.
 *
 * Both renderers read the same `SectionMapLayers`, so the activity and lap
 * one draws are the ones the other draws.
 */
import type { SectionMapLayers } from './useSectionMapLayers';

export interface Section3DOverlays {
  /** The highlighted activity and lap. */
  highlightGeoJSON: GeoJSON.FeatureCollection;
}

function featuresOf(data: GeoJSON.FeatureCollection | GeoJSON.Feature): GeoJSON.Feature[] {
  return data.type === 'FeatureCollection' ? data.features : [data];
}

export function buildSection3DOverlays(
  layers: SectionMapLayers,
  highlightedActivityId: string | null | undefined
): Section3DOverlays {
  const activity = layers.hasAllTraces
    ? highlightedActivityId
      ? layers.allTracesFeatureCollection.features.filter(
          (f) => f.properties?.activityId === highlightedActivityId
        )
      : []
    : featuresOf(layers.highlightedTraceGeoJSON);

  return {
    highlightGeoJSON: {
      type: 'FeatureCollection',
      features: [...activity, ...featuresOf(layers.highlightedLapGeoJSON)],
    },
  };
}
