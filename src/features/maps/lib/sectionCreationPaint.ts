/**
 * Paint for the section creation line and start/end markers, shared by the 2D
 * and 3D maps so a change reaches both.
 */
import type { MapPalette } from '@/theme';
import { SECTION_END_ICON_ID, SECTION_START_ICON_ID } from '@/features/maps/lib/mapIcons';

const SECTION_CREATION_LINE_WIDTH = 6;
const SECTION_CREATION_MARKER_RADIUS = 11;
const SECTION_CREATION_MARKER_STROKE_WIDTH = 2;

/** The range being picked is a selection, so it is ink; the activity map draws it with no casing. */
export function sectionCreationLinePaint(palette: MapPalette, scale = 1) {
  return {
    'line-color': palette.ink,
    'line-width': SECTION_CREATION_LINE_WIDTH * scale,
  } as const;
}

/** `positionProperty` is the feature property that holds `start` or `end`. */
export function sectionCreationMarkerPaint(
  positionProperty: string,
  palette: MapPalette,
  scale = 1
) {
  return {
    'circle-radius': SECTION_CREATION_MARKER_RADIUS * scale,
    'circle-color': [
      'case',
      ['==', ['get', positionProperty], 'start'],
      palette.start,
      palette.ink,
    ],
    'circle-stroke-width': SECTION_CREATION_MARKER_STROKE_WIDTH * scale,
    'circle-stroke-color': palette.casing,
  } as const;
}

const SECTION_CREATION_LINE_LAYER_ID = 'section-creation-line-fill';
const SECTION_CREATION_MARKER_LAYER_ID = 'section-creation-marker-fill';
const SECTION_CREATION_MARKER_ICON_LAYER_ID = 'section-creation-marker-icon';

/** The 3D page's line, circle and icon layers, serialised into its script. */
export function sectionCreation3DLayers(visible: boolean, palette: MapPalette) {
  const layout = visible ? {} : { visibility: 'none' };
  return [
    {
      id: SECTION_CREATION_LINE_LAYER_ID,
      type: 'line',
      source: 'section-creation-line',
      layout: { 'line-join': 'round', 'line-cap': 'round', ...layout },
      paint: { ...sectionCreationLinePaint(palette), 'line-opacity': 1 },
    },
    {
      id: SECTION_CREATION_MARKER_LAYER_ID,
      type: 'circle',
      source: 'section-creation-markers',
      layout,
      paint: sectionCreationMarkerPaint('type', palette),
    },
    {
      id: SECTION_CREATION_MARKER_ICON_LAYER_ID,
      type: 'symbol',
      source: 'section-creation-markers',
      layout: {
        'icon-image': [
          'case',
          ['==', ['get', 'type'], 'start'],
          SECTION_START_ICON_ID,
          SECTION_END_ICON_ID,
        ],
        'icon-size': 0.25,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
        ...layout,
      },
      paint: { 'icon-color': palette.casing },
    },
  ];
}
