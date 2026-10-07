/**
 * Paint for the section creation line and start/end markers, shared by the 2D
 * and 3D maps so a change reaches both.
 */
import { colors, mapLayerColors } from '@/theme';

export const SECTION_CREATION_LINE_WIDTH = 6;
export const SECTION_CREATION_MARKER_RADIUS = 11;
export const SECTION_CREATION_MARKER_STROKE_WIDTH = 2;

/** Line colour; the activity map draws it with no casing. */
export const sectionCreationLinePaint = {
  'line-color': colors.success,
  'line-width': SECTION_CREATION_LINE_WIDTH,
} as const;

/** `positionProperty` is the feature property that holds `start` or `end`. */
export function sectionCreationMarkerPaint(positionProperty: string) {
  return {
    'circle-radius': SECTION_CREATION_MARKER_RADIUS,
    'circle-color': [
      'case',
      ['==', ['get', positionProperty], 'start'],
      mapLayerColors.startSolid,
      mapLayerColors.endSolid,
    ],
    'circle-stroke-width': SECTION_CREATION_MARKER_STROKE_WIDTH,
    'circle-stroke-color': mapLayerColors.casing,
  } as const;
}

export const SECTION_CREATION_LINE_LAYER_ID = 'section-creation-line-fill';
export const SECTION_CREATION_MARKER_LAYER_ID = 'section-creation-marker-fill';

/** The 3D page's circle and line layers, serialised into its script. */
export function sectionCreation3DLayers(visible: boolean) {
  const layout = visible ? {} : { visibility: 'none' };
  return [
    {
      id: SECTION_CREATION_LINE_LAYER_ID,
      type: 'line',
      source: 'section-creation-line',
      layout: { 'line-join': 'round', 'line-cap': 'round', ...layout },
      paint: { ...sectionCreationLinePaint, 'line-opacity': 1 },
    },
    {
      id: SECTION_CREATION_MARKER_LAYER_ID,
      type: 'circle',
      source: 'section-creation-markers',
      layout,
      paint: sectionCreationMarkerPaint('type'),
    },
  ];
}
