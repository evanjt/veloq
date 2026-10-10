import type { FeatureCollection } from 'geojson';

import { TROPHY_ICON_BASE64 as TROPHY_BASE64 } from '@/features/maps/lib/mapIcons';
import { BUNDLED_TEXT_FONT } from '@/features/maps/lib/bundledGlyphs';
import { jsLiteral, jsLiteralList } from '@/features/maps/lib/webViewLiterals';
import { TRACK_FIT_PADDING } from '@/features/maps/lib/activityCamera';
import { heatmapRasterPaint } from '@/features/maps/lib/heatmapPaint';
import { HEATMAP_SOURCE_MINZOOM, heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';
import {
  HILLSHADE_INSERT_INDEX_SCRIPT,
  TERRAIN_3D_CONFIG,
  terrain3DSource,
} from '@/features/maps/components/mapStyles';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { setStyleStatement } from './shared';
import { resolveStyleExpression } from './styleResolution';
import {
  colors,
  colorWithOpacity,
  mapLayerColors,
  sectionPalette,
  sectionPaletteExpression,
} from '@/theme/colors';

export interface UpdateLayersParams {
  routesGeoJSON?: FeatureCollection | undefined;
  sectionsGeoJSON?: FeatureCollection | undefined;
  tracesGeoJSON?: FeatureCollection | undefined;
  sectionMarkersGeoJSON?: FeatureCollection | undefined;
  pointMarkersGeoJSON?: FeatureCollection | undefined;
  /** Legs from a fanned-out stack of starts back to where they share a spot. */
  spiderLinesGeoJSON?: FeatureCollection | undefined;
  sectionBoundariesGeoJSON?: FeatureCollection | undefined;
  /** Trimmed line, extension line and trimmed end points, tagged by `kind`. */
  sectionTrimGeoJSON?: FeatureCollection | undefined;
  highlightedTraceGeoJSON?: FeatureCollection | undefined;
  highlightedSectionId?: string | null | undefined;
}

/** Every collection the page holds, in the order the script applies them. */
export const LAYER_KEYS = [
  'routesGeoJSON',
  'sectionsGeoJSON',
  'tracesGeoJSON',
  'sectionMarkersGeoJSON',
  'pointMarkersGeoJSON',
  'spiderLinesGeoJSON',
  'sectionBoundariesGeoJSON',
  'sectionTrimGeoJSON',
  'highlightedTraceGeoJSON',
  'highlightedSectionId',
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

// The line collections the page draws over the base style, each a source with
// a casing layer under a line layer. One table feeds the update script and the
// style swap, so a collection listed here is carried across a swap. Defines
// `veloqLine(key)` for an entry and `veloqLineOverlay(line, data)`, which gives
// the `{ source, layers }` that draw `data` with it.
//
// The matched route runs under the activity track, as on the flat map, with the
// same widths so it reads when the two lines nearly coincide. Sections are the
// consensus polylines RegionalMapView draws (ActivityMapView passes none), thin
// and dashed so long sections do not dominate; their colour is per feature.
// Traces are the activity portions cut along its own GPS trace, PR in gold and
// the rest from the section palette, dashed so overlapping sections let the
// colour underneath bleed through. The selected activity or lap draws over them.
function lineOverlayTableScript(): string {
  const sectionColorsJson = JSON.stringify(sectionPaletteExpression());
  return `
    var VELOQ_LINES = [
      { key: 'routes', sourceId: 'routes-source', layerId: 'routes-layer',
        color: ${jsLiteral(mapLayerColors.routeOverlay)}, width: 9, opacity: 0.95, casing: 12, below: 'route-outline' },
      { key: 'sections', sourceId: 'sections-source', layerId: 'sections-layer',
        color: ['case', ['==', ['get', 'isPR'], true], ${jsLiteral(mapLayerColors.personalRecord)}, ['get', 'color']],
        width: 2.4, opacity: 0.95, dash: [2, 1.2] },
      { key: 'traces', sourceId: 'traces-source', layerId: 'traces-layer',
        color: ['case', ['==', ['get', 'isPR'], true], ${jsLiteral(mapLayerColors.personalRecord)}, ${sectionColorsJson}],
        width: 4, opacity: 1, dash: [2, 1.2] },
      { key: 'highlightedTrace', sourceId: 'highlighted-trace-source', layerId: 'highlighted-trace-layer',
        color: ${jsLiteral(colors.chartCyan)}, width: 4, opacity: 1 },
    ];
    function veloqLine(key) {
      return VELOQ_LINES.filter(function(line) { return line.key === key; })[0];
    }
    function veloqLineOverlay(line, data) {
      var main = { 'line-color': line.color, 'line-width': line.width, 'line-opacity': line.opacity };
      if (line.dash) main['line-dasharray'] = line.dash;
      return {
        source: { type: 'geojson', data: data },
        layers: [
          { id: line.layerId + '-outline', type: 'line', source: line.sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ${jsLiteral(mapLayerColors.casing)}, 'line-width': line.casing || line.width + 2, 'line-opacity': line.opacity * 0.6 } },
          { id: line.layerId, type: 'line', source: line.sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: main },
        ],
      };
    }
  `;
}

// Builds the injected JS that adds or updates the 3D map's GeoJSON layers
// without reloading the WebView. Retries while the style finishes loading.
//
// A key the caller leaves out is emitted as `undefined`, which the page reads
// as "unchanged, leave that layer alone". A key present but empty is `null`
// and still hides its layer, so omitting is not the same as clearing: a
// highlight change must not re-inject every section polyline.
export function buildUpdateLayersScript(params: UpdateLayersParams): string {
  const literal = (key: keyof UpdateLayersParams): string => {
    if (!(key in params)) return 'undefined';
    const value = params[key];
    return value ? JSON.stringify(value) : 'null';
  };

  const routesJSON = literal('routesGeoJSON');
  const sectionsJSON = literal('sectionsGeoJSON');
  const tracesJSON = literal('tracesGeoJSON');
  const sectionMarkersJSON = literal('sectionMarkersGeoJSON');
  const pointMarkersJSON = literal('pointMarkersGeoJSON');
  const spiderLinesJSON = literal('spiderLinesGeoJSON');
  const boundariesJSON = literal('sectionBoundariesGeoJSON');
  const trimJSON = literal('sectionTrimGeoJSON');
  const highlightedTraceJSON = literal('highlightedTraceGeoJSON');
  const highlightIdJSON = literal('highlightedSectionId');
  const sectionColorsJson = JSON.stringify(sectionPaletteExpression());

  return `
        (function() {
          var retryCount = 0;
          var maxRetries = 5;

          ${lineOverlayTableScript()}

          // The line collections as last sent, kept on the page so a style swap
          // can build them into the style it applies. Recorded before the style
          // is ready, so a swap that lands while this waits still carries them.
          window._veloq3d = window._veloq3d || {};
          window._veloq3d.lines = window._veloq3d.lines || {};
          [['routes', ${routesJSON}], ['sections', ${sectionsJSON}], ['traces', ${tracesJSON}],
           ['highlightedTrace', ${highlightedTraceJSON}]].forEach(function(entry) {
            if (entry[1] !== undefined) window._veloq3d.lines[entry[0]] = entry[1];
          });

          function addOrUpdateLayers() {
            if (!window.map) return;

            // If style isn't loaded yet or map is still loading, wait
            if (!window.map.isStyleLoaded() || !window.map.loaded()) {
              retryCount++;
              if (retryCount <= maxRetries) {
                console.log('[3D] Style/tiles not ready, retry ' + retryCount + '/' + maxRetries);
                setTimeout(addOrUpdateLayers, 200 * retryCount);
              } else {
                console.log('[3D] Max retries reached, forcing layer update');
                window.map.once('idle', addOrUpdateLayers);
              }
              return;
            }

            const routesData = ${routesJSON};
            const sectionsData = ${sectionsJSON};
            const tracesData = ${tracesJSON};
            const sectionMarkersData = ${sectionMarkersJSON};
            const pointMarkersData = ${pointMarkersJSON};
            const spiderLinesData = ${spiderLinesJSON};
            const sectionBoundariesData = ${boundariesJSON};
            const sectionTrimData = ${trimJSON};
            const highlightedTraceData = ${highlightedTraceJSON};
            const highlightedSectionId = ${highlightIdJSON};

            // Helper to safely add or update a layer
            function updateLayer(sourceId, layerId, data, layerConfig) {
              if (data === undefined) return;
              const sourceExists = !!window.map.getSource(sourceId);
              const hasData = data && data.features && data.features.length > 0;

              try {
                if (sourceExists) {
                  if (hasData) {
                    window.map.getSource(sourceId).setData(data);
                    window.map.setLayoutProperty(layerId, 'visibility', 'visible');
                  } else {
                    window.map.setLayoutProperty(layerId, 'visibility', 'none');
                  }
                } else if (hasData) {
                  window.map.addSource(sourceId, { type: 'geojson', data: data });
                  window.map.addLayer(layerConfig);
                }
              } catch (e) {
                console.warn('Layer error:', sourceId, e);
              }
            }

            // Add a line collection with its casing, or update it in place. A
            // collection with no features hides its layers rather than removing them.
            function addLine(line, data) {
              if (data === undefined) return;
              var sourceExists = !!window.map.getSource(line.sourceId);
              var hasData = data && data.features && data.features.length > 0;
              var outlineId = line.layerId + '-outline';

              try {
                if (sourceExists) {
                  if (hasData) {
                    window.map.getSource(line.sourceId).setData(data);
                    window.map.setLayoutProperty(outlineId, 'visibility', 'visible');
                    window.map.setLayoutProperty(line.layerId, 'visibility', 'visible');
                  } else {
                    window.map.setLayoutProperty(outlineId, 'visibility', 'none');
                    window.map.setLayoutProperty(line.layerId, 'visibility', 'none');
                  }
                } else if (hasData) {
                  var spec = veloqLineOverlay(line, data);
                  window.map.addSource(line.sourceId, spec.source);
                  // A line with a layer to sit under goes there, and only when the page has it.
                  var below = line.below && window.map.getLayer(line.below) ? line.below : undefined;
                  spec.layers.forEach(function(layer) { window.map.addLayer(layer, below); });
                }
              } catch (e) {
                console.warn('Layer error:', line.sourceId, e);
              }
            }

            addLine(veloqLine('routes'), routesData);

            addLine(veloqLine('sections'), sectionsData);

            var baseTracesColor = veloqLine('traces').color;
            addLine(veloqLine('traces'), tracesData);
            // Apply highlight state by re-setting paint props (addLine only
            // calls setData on subsequent calls, so paint updates go through here).
            try {
              if (highlightedSectionId !== undefined && window.map.getLayer('traces-layer')) {
                var tracesColor = highlightedSectionId
                  ? ['case',
                      ['==', ['get', 'id'], highlightedSectionId], ${jsLiteral(mapLayerColors.highlight)},
                      ['==', ['get', 'isPR'], true], ${jsLiteral(mapLayerColors.personalRecord)},
                      ${sectionColorsJson}]
                  : baseTracesColor;
                var tracesOpacity = highlightedSectionId
                  ? ['case', ['==', ['get', 'id'], highlightedSectionId], 1, 0.25]
                  : 0.95;
                var tracesWidth = highlightedSectionId
                  ? ['case', ['==', ['get', 'id'], highlightedSectionId], 6, 4]
                  : 4;
                window.map.setPaintProperty('traces-layer', 'line-color', tracesColor);
                window.map.setPaintProperty('traces-layer', 'line-opacity', tracesOpacity);
                window.map.setPaintProperty('traces-layer', 'line-width', tracesWidth);
              }
            } catch (e) { console.warn('traces-layer paint update failed:', e); }

            addLine(veloqLine('highlightedTrace'), highlightedTraceData);

            // Section boundary ticks - perpendicular marks at each portion's start/end.
            // Drawn above traces so boundaries are visible through any overlap.
            if (sectionBoundariesData !== undefined) try {
              var boundariesSrcExists = !!window.map.getSource('section-boundaries-source');
              var hasBoundaries = sectionBoundariesData && sectionBoundariesData.features && sectionBoundariesData.features.length > 0;
              if (boundariesSrcExists) {
                if (hasBoundaries) {
                  window.map.getSource('section-boundaries-source').setData(sectionBoundariesData);
                  window.map.setLayoutProperty('section-boundaries-casing-3d', 'visibility', 'visible');
                  window.map.setLayoutProperty('section-boundaries-line-3d', 'visibility', 'visible');
                } else {
                  window.map.setLayoutProperty('section-boundaries-casing-3d', 'visibility', 'none');
                  window.map.setLayoutProperty('section-boundaries-line-3d', 'visibility', 'none');
                }
              } else if (hasBoundaries) {
                window.map.addSource('section-boundaries-source', { type: 'geojson', data: sectionBoundariesData });
                window.map.addLayer({
                  id: 'section-boundaries-casing-3d',
                  type: 'line',
                  source: 'section-boundaries-source',
                  layout: { 'line-cap': 'round' },
                  paint: { 'line-color': ${jsLiteral(mapLayerColors.boundaryCasing)}, 'line-width': 6, 'line-opacity': 0.45 },
                });
                window.map.addLayer({
                  id: 'section-boundaries-line-3d',
                  type: 'line',
                  source: 'section-boundaries-source',
                  layout: { 'line-cap': 'round' },
                  paint: { 'line-color': ${jsLiteral(mapLayerColors.casing)}, 'line-width': 3.5 },
                });
              }
            } catch (e) { console.warn('section-boundaries layer error:', e); }

            // Section trim: the full line dims, the kept portion and the extension draw
            // over it, and the end points move to the trimmed positions. An empty
            // collection puts the full line and its original end markers back.
            if (sectionTrimData !== undefined) try {
              var trimOn = !!(sectionTrimData && sectionTrimData.features && sectionTrimData.features.length > 0);
              var trimIds = ['section-trim-extension-casing-3d', 'section-trim-extension-3d', 'section-trim-casing-3d', 'section-trim-line-3d', 'section-trim-end-border-3d', 'section-trim-end-3d'];
              if (window.map.getSource('section-trim-source')) {
                if (trimOn) window.map.getSource('section-trim-source').setData(sectionTrimData);
                trimIds.forEach(function(id) {
                  if (window.map.getLayer(id)) window.map.setLayoutProperty(id, 'visibility', trimOn ? 'visible' : 'none');
                });
              } else if (trimOn) {
                var lineKind = function(kind) { return ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'kind'], kind]]; };
                var pointFilter = ['==', ['geometry-type'], 'Point'];
                window.map.addSource('section-trim-source', { type: 'geojson', data: sectionTrimData });
                window.map.addLayer({ id: 'section-trim-extension-casing-3d', type: 'line', source: 'section-trim-source', filter: lineKind('extension'),
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': ${jsLiteral(mapLayerColors.boundaryCasing)}, 'line-width': 6, 'line-opacity': 0.5 } });
                window.map.addLayer({ id: 'section-trim-extension-3d', type: 'line', source: 'section-trim-source', filter: lineKind('extension'),
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': ${jsLiteral(mapLayerColors.extension)}, 'line-width': 4 } });
                window.map.addLayer({ id: 'section-trim-casing-3d', type: 'line', source: 'section-trim-source', filter: lineKind('trimmed'),
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': ${jsLiteral(mapLayerColors.casing)}, 'line-width': 6 } });
                window.map.addLayer({ id: 'section-trim-line-3d', type: 'line', source: 'section-trim-source', filter: lineKind('trimmed'),
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': (window.map.getLayer('route-line') && window.map.getPaintProperty('route-line', 'line-color')) || ${jsLiteral(colors.primary)}, 'line-width': 4 } });
                window.map.addLayer({ id: 'section-trim-end-border-3d', type: 'circle', source: 'section-trim-source', filter: pointFilter,
                  paint: { 'circle-radius': 7, 'circle-color': ${jsLiteral(mapLayerColors.casing)} } });
                window.map.addLayer({ id: 'section-trim-end-3d', type: 'circle', source: 'section-trim-source', filter: pointFilter,
                  paint: { 'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'kind'], 'start'], ${jsLiteral(colorWithOpacity(colors.success, 0.75))}, ${jsLiteral(colorWithOpacity(colors.error, 0.75))}] } });
              }
              if (window.map.getLayer('route-line')) {
                window.map.setPaintProperty('route-line', 'line-opacity', trimOn ? 0.4 : 1);
              }
              if (window.map.getLayer('route-outline')) {
                window.map.setPaintProperty('route-outline', 'line-opacity', trimOn ? 0.3 : 0.8);
              }
              ['start-end-border', 'start-end-fill'].forEach(function(id) {
                if (window.map.getLayer(id)) window.map.setLayoutProperty(id, 'visibility', trimOn ? 'none' : 'visible');
              });
            } catch (e) { console.warn('section-trim layer error:', e); }

            // Update section markers (numbered/PR circles matching 2D parity)
            var markerSourceExists = !!window.map.getSource('section-markers-source');
            var hasMarkers = sectionMarkersData && sectionMarkersData.features && sectionMarkersData.features.length > 0;

            function addMarkerLayers() {
              if (sectionMarkersData === undefined) return;
              try {
                if (!hasMarkers) {
                  ['section-marker-circle-3d','section-marker-border-3d','section-marker-text-3d','section-marker-pr-shadow-3d','section-marker-pr-icon-3d'].forEach(function(id) {
                    if (window.map.getLayer(id)) window.map.setLayoutProperty(id, 'visibility', 'none');
                  });
                  return;
                }
                if (markerSourceExists) {
                  window.map.getSource('section-markers-source').setData(sectionMarkersData);
                } else {
                  window.map.addSource('section-markers-source', { type: 'geojson', data: sectionMarkersData });
                }
                // Remove any old unfiltered layers from previous versions so the new filtered ones take over
                ['section-marker-border-3d','section-marker-circle-3d','section-marker-text-3d','section-marker-pr-shadow-3d','section-marker-pr-icon-3d'].forEach(function(id) {
                  if (window.map.getLayer(id)) window.map.removeLayer(id);
                });
                {
                  // Non-PR numbered markers: white border + colored fill + text label
                  window.map.addLayer({
                    id: 'section-marker-border-3d',
                    type: 'circle',
                    source: 'section-markers-source',
                    filter: ['!=', ['get', 'isPR'], true],
                    paint: { 'circle-radius': 14, 'circle-color': ${jsLiteral(mapLayerColors.casing)} },
                  });
                  window.map.addLayer({
                    id: 'section-marker-circle-3d',
                    type: 'circle',
                    source: 'section-markers-source',
                    filter: ['!=', ['get', 'isPR'], true],
                    paint: {
                      'circle-radius': 12,
                      'circle-color': ${sectionColorsJson},
                      'circle-stroke-width': 2,
                      'circle-stroke-color': ${jsLiteral(mapLayerColors.casing)},
                    },
                  });
                  window.map.addLayer({
                    id: 'section-marker-text-3d',
                    type: 'symbol',
                    source: 'section-markers-source',
                    filter: ['!=', ['get', 'isPR'], true],
                    layout: {
                      'text-field': ['get', 'label'],
                      'text-font': ${jsLiteralList(BUNDLED_TEXT_FONT)},
                      'text-size': 10,
                      'text-anchor': 'center',
                      'text-allow-overlap': true,
                      'text-ignore-placement': true,
                    },
                    paint: { 'text-color': ${jsLiteral(mapLayerColors.casing)} },
                  });
                  // PR markers: gold trophy, offset above trace
                  if (window.map.hasImage('trophy-3d')) {
                    window.map.addLayer({
                      id: 'section-marker-pr-icon-3d',
                      type: 'symbol',
                      source: 'section-markers-source',
                      filter: ['==', ['get', 'isPR'], true],
                      layout: {
                        'icon-image': 'trophy-3d',
                        'icon-size': 0.15,
                        'icon-offset': [0, -90],
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true,
                        'icon-anchor': 'center',
                      },
                      paint: {
                        'icon-color': ${jsLiteral(mapLayerColors.personalRecord)},
                      },
                    });
                  }
                }
              } catch (e) {
                console.warn('Section marker layer error:', e);
              }
            }

            // Load trophy image as SDF once, then add marker layers.
            if (!window.map.hasImage('trophy-3d')) {
              var trophyImg = new Image();
              trophyImg.onload = function() {
                try {
                  if (!window.map.hasImage('trophy-3d')) {
                    window.map.addImage('trophy-3d', trophyImg, { sdf: true });
                  }
                } catch (err) { console.warn('addImage trophy-3d failed:', err); }
                addMarkerLayers();
              };
              trophyImg.onerror = function() {
                console.warn('trophy-3d image failed to load');
                addMarkerLayers();
              };
              trophyImg.src = 'data:image/png;base64,${TROPHY_BASE64}';
            } else {
              addMarkerLayers();
            }

            // Activity point markers - used by the global map in 3D as a
            // points-only equivalent of the 2D markers/clusters layer. We
            // intentionally skip MapLibre supercluster here to keep the
            // implementation simple; the marker count on global is in the
            // hundreds and renders fine as raw points.
            // Legs of a fanned-out stack, under the points they lead to.
            updateLayer('spider-lines-source', 'spider-lines-layer', spiderLinesData, {
              id: 'spider-lines-layer',
              type: 'line',
              source: 'spider-lines-source',
              paint: {
                'line-color': ${jsLiteral(mapLayerColors.casing)},
                'line-width': 1.5,
                'line-opacity': 0.6,
              },
            });
            try {
              if (window.map.getLayer('spider-lines-layer') && window.map.getLayer('activity-points-layer')) {
                window.map.moveLayer('spider-lines-layer', 'activity-points-layer');
              }
            } catch (e) { console.warn('spider-lines order error:', e); }

            if (pointMarkersData !== undefined) try {
              var pointSourceExists = !!window.map.getSource('activity-points-source');
              var hasPoints = pointMarkersData && pointMarkersData.features && pointMarkersData.features.length > 0;
              if (pointSourceExists) {
                if (hasPoints) {
                  window.map.getSource('activity-points-source').setData(pointMarkersData);
                  window.map.setLayoutProperty('activity-points-layer', 'visibility', 'visible');
                } else {
                  window.map.setLayoutProperty('activity-points-layer', 'visibility', 'none');
                }
              } else if (hasPoints) {
                window.map.addSource('activity-points-source', { type: 'geojson', data: pointMarkersData });
                window.map.addLayer({
                  id: 'activity-points-layer',
                  type: 'circle',
                  source: 'activity-points-source',
                  paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': [
                      'interpolate', ['linear'], ['zoom'],
                      6, 4,
                      10, 6,
                      14, 8,
                      18, 10
                    ],
                    'circle-opacity': 0.9,
                    'circle-stroke-color': ${jsLiteral(mapLayerColors.casing)},
                    'circle-stroke-width': 1.5,
                    'circle-stroke-opacity': 0.8,
                  },
                });
              }
            } catch (e) { console.warn('activity-points layer error:', e); }

            console.log('[3D] Layers updated - routes:', routesData?.features?.length || 0,
                        'sections:', sectionsData?.features?.length || 0,
                        'traces:', tracesData?.features?.length || 0,
                        'sectionMarkers:', sectionMarkersData?.features?.length || 0,
                        'pointMarkers:', pointMarkersData?.features?.length || 0);
          }

          addOrUpdateLayers();
        })();
        true;
  `;
}

/**
 * Swap the drawn route on a 3D page that is already up, and frame it.
 *
 * The alternative is rebuilding the page, which reboots maplibre and refetches
 * every DEM and hillshade tile one bridge call at a time.
 */
export function buildSetRouteScript(
  coordinates: [number, number][],
  /** MapLibre corners, `[lng, lat]` each, as `getBoundsFromPoints` returns. */
  bounds?: { ne: [number, number]; sw: [number, number] } | null,
  /** The line colour for this route, which changes with the activity's sport. */
  color?: string
): string {
  const coordsJSON = JSON.stringify(coordinates);
  const colorArg = color === undefined ? '' : `, ${JSON.stringify(color)}`;
  const fit =
    bounds && coordinates.length > 0
      ? `window.map.fitBounds([${JSON.stringify(bounds.sw)}, ${JSON.stringify(bounds.ne)}], { padding: ${TRACK_FIT_PADDING}, duration: 600 });`
      : '';
  return `
        (function() {
          if (!window.map || !window._veloq3d || !window._veloq3d.setRoute) return;
          window._veloq3d.setRoute(${coordsJSON}${colorArg});
          ${fit}
        })();
        true;
  `;
}

// Colour by gradient on the page's route line. The expression is the one the
// 2D layer uses; null clears it back to the flat route colour. The page keeps
// the expression so a style swap rebuilds the route layer with it.
export function buildSetRouteGradientScript(expression: object | null): string {
  return `
        (function() {
          if (!window.map || !window._veloq3d || !window._veloq3d.setRouteGradient) return;
          window._veloq3d.setRouteGradient(${expression ? JSON.stringify(expression) : 'null'});
        })();
        true;
  `;
}

// The sources and layers the page mounts once and always keeps: the route and
// its start/end markers, empty and hidden when there is no route, the scrub
// marker, and the matched-route, section and trace lines the page last drew. A setStyle drops every source the new style does not name, so
// the style swap splices these into the style it builds. The returned script
// defines `veloqOverlays(coords, routeColor)`, which gives
// `{ sources, layers }` for the caller to merge into a style object.
export function buildStyleOverlayScript(): string {
  return `
    ${lineOverlayTableScript()}
    function veloqOverlays(coords, routeColor) {
      var on = coords.length > 0;
      var vis = { visibility: on ? 'visible' : 'none' };
      var points = on ? [
        { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: coords[0] } },
        { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: coords[coords.length - 1] } },
      ] : [];
      // The line collections the page last drew, carried into the new style.
      // The matched route goes under the activity's route layers and the rest
      // over the scrub marker, where the update script would have added them.
      var sent = (window._veloq3d && window._veloq3d.lines) || {};
      var lineSources = {};
      var below = [];
      var above = [];
      VELOQ_LINES.forEach(function(line) {
        var data = sent[line.key];
        if (!data || !data.features || data.features.length === 0) return;
        var overlay = veloqLineOverlay(line, data);
        lineSources[line.sourceId] = overlay.source;
        var group = line.below ? below : above;
        overlay.layers.forEach(function(layer) { group.push(layer); });
      });
      return {
        sources: Object.assign({
          'route': {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: on ? [
              { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
            ] : [] },
            tolerance: 0,
            lineMetrics: true,
          },
          'start-end-markers': { type: 'geojson', data: { type: 'FeatureCollection', features: points } },
          'highlight-point': { type: 'geojson', data: { type: 'Point', coordinates: [0, 0] } },
        }, lineSources),
        layers: below.concat([
          { id: 'route-outline', type: 'line', source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round', visibility: vis.visibility },
            paint: { 'line-color': ${jsLiteral(mapLayerColors.casing)}, 'line-width': 5, 'line-opacity': 0.8 } },
          { id: 'route-line', type: 'line', source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round', visibility: vis.visibility },
            paint: Object.assign({ 'line-color': routeColor, 'line-width': 3 },
              (window._veloq3d && window._veloq3d.gradient) ? { 'line-gradient': window._veloq3d.gradient } : {}) },
          { id: 'start-end-border', type: 'circle', source: 'start-end-markers',
            layout: vis,
            paint: { 'circle-radius': 7, 'circle-color': ${jsLiteral(mapLayerColors.casing)} } },
          { id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
            layout: vis,
            paint: { 'circle-radius': 5,
              'circle-color': ['case', ['==', ['get', 'type'], 'start'], ${jsLiteral(colorWithOpacity(colors.success, 0.75))}, ${jsLiteral(colorWithOpacity(colors.error, 0.75))}] } },
          { id: 'highlight-border', type: 'circle', source: 'highlight-point',
            layout: { visibility: 'none' },
            paint: { 'circle-radius': 7, 'circle-color': ${jsLiteral(mapLayerColors.casing)} } },
          { id: 'highlight-fill', type: 'circle', source: 'highlight-point',
            layout: { visibility: 'none' },
            paint: { 'circle-radius': 5, 'circle-color': ${jsLiteral(sectionPalette[0])} } },
        ]).concat(above),
      };
    }
  `;
}

export interface Map3DStyleSwap {
  mapStyle: MapStyleType;
  routeColor: string;
  terrainExaggeration: number;
  /** Finished heatmap tile passes, which versions the heatmap tile URL. */
  heatmapGeneration: number;
  showHeatmap: boolean;
}

// Swaps the 3D page to another base style without reloading it. Builds a
// complete style object with terrain, sky, hillshade, and route layers, then
// applies it at once, the same pattern as the snapshot worker.
export function buildMap3DSetStyleScript({
  mapStyle,
  routeColor,
  terrainExaggeration,
  heatmapGeneration,
  showHeatmap,
}: Map3DStyleSwap): string {
  const isSatellite = mapStyle === 'satellite';
  const isDark = mapStyle === 'dark' || mapStyle === 'satellite';

  const { styleJSON: styleConfig } = resolveStyleExpression(mapStyle);

  // Serialize shared terrain config for injection
  const terrainSourceJSON = JSON.stringify(terrain3DSource());
  const skyConfigJSON = JSON.stringify(
    isSatellite
      ? TERRAIN_3D_CONFIG.sky.satellite
      : isDark
        ? TERRAIN_3D_CONFIG.sky.dark
        : TERRAIN_3D_CONFIG.sky.light
  );
  const hillshadePaintJSON = JSON.stringify(
    isDark ? TERRAIN_3D_CONFIG.hillshadePaint.dark : TERRAIN_3D_CONFIG.hillshadePaint.light
  );

  return `
    (function() {
      if (!window.map) return;

      ${buildStyleOverlayScript()}

      var isSatellite = ${isSatellite};
      var isDark = ${isDark};
      var coords = window._routeCoords || [];
      var routeColor = ${jsLiteral(routeColor)};
      var terrainSource = ${terrainSourceJSON};
      var skyConfig = ${skyConfigJSON};
      var hillshadePaint = ${hillshadePaintJSON};
      ${HILLSHADE_INSERT_INDEX_SCRIPT}
      var hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

      // Build style: either JSON object or fetch URL-based style
      function applyNewStyle(styleObj) {
        styleObj.sources['terrain'] = terrainSource;
        styleObj.terrain = { source: 'terrain', exaggeration: ${terrainExaggeration} };
        styleObj.sky = skyConfig;

        // Insert hillshade before the first transportation/building layer found
        if (!isSatellite) {
          var hillshadeIdx = hillshadeInsertIndex(styleObj.layers, hillshadeInsertCandidates);
          styleObj.layers.splice(hillshadeIdx, 0, {
            id: 'hillshading',
            type: 'hillshade',
            source: 'terrain',
            layout: { visibility: 'visible' },
            paint: hillshadePaint,
          });
        }

        // The route, its markers and the scrub marker are always part of
        // the style, empty and hidden when there is nothing to draw, so a
        // later setRoute or scrub finds its source.
        var overlays = veloqOverlays(coords, routeColor);
        for (var sid in overlays.sources) styleObj.sources[sid] = overlays.sources[sid];
        for (var oi = 0; oi < overlays.layers.length; oi++) styleObj.layers.push(overlays.layers[oi]);

        ${setStyleStatement('window.map', 'styleObj')}
        console.log('[3D] Style changed via setStyle()');

        // Re-add heatmap raster overlay (setStyle clears all sources/layers).
        // Probe for 'route-outline' before inserting under it - it's only
        // present in activity-detail mode (when route coordinates exist).
        window.map.once('style.load', function() {
          if (!window.map.getSource('heatmap-tiles')) {
            window.map.addSource('heatmap-tiles', {
              type: 'raster',
              tiles: [${jsLiteral(heatmapTileTemplate(heatmapGeneration))}],
              tileSize: 256,
              minzoom: ${HEATMAP_SOURCE_MINZOOM},
              maxzoom: 17
            });
            var heatmapBeforeId = window.map.getLayer('route-outline') ? 'route-outline' : undefined;
            window.map.addLayer({
              id: 'heatmap-layer',
              type: 'raster',
              source: 'heatmap-tiles',
              layout: { visibility: ${showHeatmap} ? 'visible' : 'none' },
              paint: ${JSON.stringify(heatmapRasterPaint(mapStyle))}
            }, heatmapBeforeId);
          }
        });
      }

      var styleJSON = ${styleConfig};
      applyNewStyle(styleJSON);
    })();
    true;
  `;
}
