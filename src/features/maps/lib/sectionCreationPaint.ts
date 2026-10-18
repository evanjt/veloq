/**
 * Paint for the section creation line and start/end markers, shared by the 2D
 * and 3D maps so a change reaches both.
 */
import type { MapPalette } from '@/theme';
import {
  SECTION_END_ICON,
  SECTION_END_ICON_ID,
  SECTION_START_ICON,
  SECTION_START_ICON_ID,
} from '@/features/maps/lib/mapIcons';

export const SECTION_CREATION_LINE_WIDTH = 6;
export const SECTION_CREATION_MARKER_RADIUS = 11;
export const SECTION_CREATION_MARKER_STROKE_WIDTH = 2;

/** Line colour; the activity map draws it with no casing. */
export function sectionCreationLinePaint(palette: MapPalette) {
  return {
    'line-color': palette.layer.added,
    'line-width': SECTION_CREATION_LINE_WIDTH,
  } as const;
}

/** `positionProperty` is the feature property that holds `start` or `end`. */
export function sectionCreationMarkerPaint(positionProperty: string, palette: MapPalette) {
  return {
    'circle-radius': SECTION_CREATION_MARKER_RADIUS,
    'circle-color': [
      'case',
      ['==', ['get', positionProperty], 'start'],
      palette.layer.startSolid,
      palette.layer.endSolid,
    ],
    'circle-stroke-width': SECTION_CREATION_MARKER_STROKE_WIDTH,
    'circle-stroke-color': palette.layer.casing,
  } as const;
}

export const SECTION_CREATION_LINE_LAYER_ID = 'section-creation-line-fill';
export const SECTION_CREATION_MARKER_LAYER_ID = 'section-creation-marker-fill';
export const SECTION_CREATION_MARKER_ICON_LAYER_ID = 'section-creation-marker-icon';

type SectionCreation3DSource = 'section-creation-line' | 'section-creation-markers';

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
      paint: { 'icon-color': palette.layer.casing },
    },
  ];
}

/**
 * Script that adds the 3D layers drawn from `source` to the map at `mapExpr`.
 *
 * The marker icons are registered first, since a setStyle drops them with the
 * layers. A symbol layer asked for an image that has not loaded yet draws it
 * once `addImage` lands, so the layers do not wait on the load.
 */
export function addSectionCreation3DLayersScript(
  mapExpr: string,
  source: SectionCreation3DSource,
  visible: boolean,
  palette: MapPalette
): string {
  const layers = sectionCreation3DLayers(visible, palette).filter((l) => l.source === source);
  const images =
    source === 'section-creation-markers'
      ? [SECTION_START_ICON, SECTION_END_ICON].map(({ id, uri }) => ({ id, uri }))
      : [];
  return `(function(map) {
    ${JSON.stringify(images)}.forEach(function(spec) {
      if (map.hasImage(spec.id)) return;
      var image = new Image();
      image.onload = function() {
        try {
          if (!map.hasImage(spec.id)) map.addImage(spec.id, image, { sdf: true });
        } catch (err) { console.warn('addImage ' + spec.id + ' failed:', err); }
      };
      image.src = spec.uri;
    });
    ${JSON.stringify(layers)}.forEach(function(l) { map.addLayer(l); });
  })(${mapExpr});`;
}
