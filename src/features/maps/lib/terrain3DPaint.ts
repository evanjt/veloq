/**
 * What the 3D pages draw over the terrain, built from the palette of the base
 * under them: the atmosphere, the relief shading, the subject line's casing
 * and its end markers. The interactive page, its style swap and the feed
 * snapshots all read it here, so the three cannot disagree.
 */
import type { MapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { ENDPOINT_IMAGES, buildEndpointLayers } from '@/features/maps/lib/endpointLayers';
import {
  MAP_3D_SCALE,
  OVERLAY_LINE_WIDTH,
  SUBJECT_CASING_WIDTH,
  SUBJECT_LINE_WIDTH,
} from '@/features/maps/lib/mapLineWidths';

/** The subject line on a 3D page. */
export const ROUTE_3D_LINE_WIDTH = SUBJECT_LINE_WIDTH * MAP_3D_SCALE;
/** The matched route on a 3D page, the muted context line under the track. */
export const OVERLAY_3D_LINE_WIDTH = OVERLAY_LINE_WIDTH * MAP_3D_SCALE;

/** The base's sky, horizon and fog, as MapLibre's `sky` takes them. */
export function terrainSky(palette: MapPalette) {
  return {
    'sky-color': palette.sky,
    'horizon-color': palette.horizon,
    'fog-color': palette.fog,
    'fog-ground-blend': 0.5,
    'horizon-fog-blend': 0.8,
    'sky-horizon-blend': 0.5,
    'atmosphere-blend': 0.8,
  };
}

/** The relief shading for a vector base, or null on satellite, whose imagery carries its own. */
export function terrainHillshadePaint(palette: MapPalette): Record<string, unknown> | null {
  if (palette.base === 'satellite') return null;
  return {
    'hillshade-shadow-color': palette.hillshade.shadow,
    'hillshade-highlight-color': palette.hillshade.highlight,
    'hillshade-illumination-anchor': 'map',
    'hillshade-exaggeration': palette.isDark ? 0.4 : 0.3,
  };
}

/** The casing under the subject line, at full opacity like the flat map's. */
export function routeCasing3DPaint(palette: MapPalette) {
  return {
    'line-color': palette.casing,
    'line-width': SUBJECT_CASING_WIDTH * MAP_3D_SCALE,
    'line-opacity': 1,
  };
}

/**
 * The start and finish markers on a 3D page: the flat map's disc and glyph,
 * drawn from `start-end-markers`, whose points say `start` or `end` in `type`.
 */
export function endpoint3DLayers(palette: MapPalette): MapLayerSpec[] {
  return buildEndpointLayers(palette, {
    source: 'start-end-markers',
    idPrefix: 'start-end',
    positionProperty: 'type',
    scale: MAP_3D_SCALE,
  });
}

/** The ids of the end marker layers, in the order the page draws them. */
export const ENDPOINT_3D_LAYER_IDS = ['start-end-border', 'start-end-fill', 'start-end-icon'];

/**
 * Page script that keeps the end marker glyphs registered on the map at
 * `mapExpr` for as long as it lives. A style swap drops every image with the
 * style, so the glyphs are decoded once and handed back whenever a layer asks
 * for one the style does not hold.
 */
export function endpointImagesScript(mapExpr: string): string {
  const images = ENDPOINT_IMAGES.map(({ id, uri }) => ({ id, uri }));
  return `(function(map) {
    if (typeof Image === 'undefined' || !map || !map.on) return;
    var decoded = {};
    function register(id) {
      var image = decoded[id];
      if (!image || !image.complete || !image.width) return;
      try {
        if (!map.hasImage(id)) map.addImage(id, image, { sdf: true });
      } catch (err) { console.warn('addImage ' + id + ' failed:', err); }
    }
    ${JSON.stringify(images)}.forEach(function(spec) {
      var image = new Image();
      image.onload = function() { register(spec.id); };
      image.src = spec.uri;
      decoded[spec.id] = image;
    });
    map.on('styleimagemissing', function(e) { if (e && decoded[e.id]) register(e.id); });
  })(${mapExpr});`;
}
