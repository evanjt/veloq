/**
 * The selected riding area drawn as a dashed box on a preview map. Both
 * previews take the outline and its layer from here, so the box reads the same
 * on each.
 */
import type { MapPalette } from '@/theme';
import { EMPTY_FEATURE_COLLECTION, type MapLayerSpec } from '@/features/maps';
import { previewAreaBounds, type PreviewAreaCentre } from './previewMapCamera';

/**
 * The area's box as a polygon, for the dashed outline both previews draw. Same
 * bounds as the camera, so the box, the frame and the label name one area.
 */
export function previewAreaOutline(centre: PreviewAreaCentre | null): GeoJSON.FeatureCollection {
  const area = previewAreaBounds(centre);
  if (!area) return EMPTY_FEATURE_COLLECTION;
  const [west, south] = area.sw;
  const [east, north] = area.ne;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      },
    ],
  };
}

/**
 * The selected area's box: bottom of the stack and not interactive, so it says
 * which ground the area covers and never takes a tap meant for a line. Both
 * previews draw it through this one spec.
 */
export function previewAreaLayerSpec({ layer }: MapPalette): MapLayerSpec {
  return {
    id: 'preview-area-line',
    type: 'line',
    source: 'preview-area',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': layer.casing,
      'line-opacity': 0.8,
      'line-width': 1.5,
      'line-dasharray': [4, 3],
    },
  };
}
