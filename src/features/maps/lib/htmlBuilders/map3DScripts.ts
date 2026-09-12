import type { FeatureCollection } from 'geojson';

import { TROPHY_ICON_BASE64 as TROPHY_BASE64 } from '@/features/maps/lib/mapIcons';

export interface UpdateLayersParams {
  routesGeoJSON?: FeatureCollection;
  sectionsGeoJSON?: FeatureCollection;
  tracesGeoJSON?: FeatureCollection;
  sectionMarkersGeoJSON?: FeatureCollection;
  pointMarkersGeoJSON?: FeatureCollection;
  sectionBoundariesGeoJSON?: FeatureCollection;
  highlightedSectionId?: string | null;
}

/** Every collection the page holds, in the order the script applies them. */
export const LAYER_KEYS = [
  'routesGeoJSON',
  'sectionsGeoJSON',
  'tracesGeoJSON',
  'sectionMarkersGeoJSON',
  'pointMarkersGeoJSON',
  'sectionBoundariesGeoJSON',
  'highlightedSectionId',
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

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
  const boundariesJSON = literal('sectionBoundariesGeoJSON');
  const highlightIdJSON = literal('highlightedSectionId');

  return `
        (function() {
          var retryCount = 0;
          var maxRetries = 5;

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
            const sectionBoundariesData = ${boundariesJSON};
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

            // Helper to add layer with outline for visibility on all map styles
            function addLayerWithOutline(sourceId, layerId, data, lineColor, lineWidth, lineOpacity) {
              if (data === undefined) return;
              const sourceExists = !!window.map.getSource(sourceId);
              const hasData = data && data.features && data.features.length > 0;
              const outlineId = layerId + '-outline';

              try {
                if (sourceExists) {
                  if (hasData) {
                    window.map.getSource(sourceId).setData(data);
                    window.map.setLayoutProperty(outlineId, 'visibility', 'visible');
                    window.map.setLayoutProperty(layerId, 'visibility', 'visible');
                  } else {
                    window.map.setLayoutProperty(outlineId, 'visibility', 'none');
                    window.map.setLayoutProperty(layerId, 'visibility', 'none');
                  }
                } else if (hasData) {
                  window.map.addSource(sourceId, { type: 'geojson', data: data });
                  // Add outline first (renders behind)
                  window.map.addLayer({
                    id: outlineId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#FFFFFF', 'line-width': lineWidth + 2, 'line-opacity': lineOpacity * 0.6 },
                  });
                  // Add main line on top
                  window.map.addLayer({
                    id: layerId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': lineColor, 'line-width': lineWidth, 'line-opacity': lineOpacity },
                  });
                }
              } catch (e) {
                console.warn('Layer error:', sourceId, e);
              }
            }

            // Update routes layer (with outline for visibility) - purple to match 2D
            addLayerWithOutline('routes-source', 'routes-layer', routesData, '#9C27B0', 3, 0.8);

            // Update sections layer - section consensus polylines (used by RegionalMapView
            // where there is no activity trace to overlay onto). ActivityMapView does not
            // pass sectionsGeoJSON, so this layer is hidden there.
            // Match 2D: per-feature color from getSectionStyle (color property),
            // thin dashed line so long sections do not dominate the 3D view.
            addLayerWithOutline('sections-source', 'sections-layer', sectionsData,
              ['case', ['==', ['get', 'isPR'], true], '#D4AF37', ['get', 'color']], 2.4, 0.95);
            try {
              if (window.map.getLayer('sections-layer')) {
                window.map.setPaintProperty('sections-layer', 'line-dasharray', [2, 1.2]);
              }
            } catch (e) { /* noop */ }

            // Update traces layer - activity portion cutouts along the activity's own GPS trace.
            // PR = gold; non-PR = section palette indexed by colorIndex (matches 2D).
            var baseTracesColor = ['case', ['==', ['get', 'isPR'], true], '#D4AF37',
              ['match', ['get', 'colorIndex'],
                0, '#00BCD4', 1, '#AB47BC', 2, '#FF7043', 3, '#66BB6A',
                4, '#42A5F5', 5, '#FFCA28', 6, '#26A69A', 7, '#EC407A',
                '#00BCD4']];
            addLayerWithOutline('traces-source', 'traces-layer', tracesData,
              baseTracesColor, 4, 1);
            // Dashed pattern - overlapping sections let the colour underneath bleed through.
            try {
              if (window.map.getLayer('traces-layer')) {
                window.map.setPaintProperty('traces-layer', 'line-dasharray', [2, 1.2]);
              }
            } catch (e) { /* noop */ }
            // Apply highlight state by re-setting paint props (addLayerWithOutline only
            // calls setData on subsequent calls, so paint updates go through here).
            try {
              if (highlightedSectionId !== undefined && window.map.getLayer('traces-layer')) {
                var tracesColor = highlightedSectionId
                  ? ['case',
                      ['==', ['get', 'id'], highlightedSectionId], '#00E5FF',
                      ['==', ['get', 'isPR'], true], '#D4AF37',
                      ['match', ['get', 'colorIndex'],
                        0, '#00BCD4', 1, '#AB47BC', 2, '#FF7043', 3, '#66BB6A',
                        4, '#42A5F5', 5, '#FFCA28', 6, '#26A69A', 7, '#EC407A',
                        '#00BCD4']]
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
                  paint: { 'line-color': '#000000', 'line-width': 6, 'line-opacity': 0.45 },
                });
                window.map.addLayer({
                  id: 'section-boundaries-line-3d',
                  type: 'line',
                  source: 'section-boundaries-source',
                  layout: { 'line-cap': 'round' },
                  paint: { 'line-color': '#FFFFFF', 'line-width': 3.5 },
                });
              }
            } catch (e) { console.warn('section-boundaries layer error:', e); }

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
                    paint: { 'circle-radius': 14, 'circle-color': '#FFFFFF' },
                  });
                  window.map.addLayer({
                    id: 'section-marker-circle-3d',
                    type: 'circle',
                    source: 'section-markers-source',
                    filter: ['!=', ['get', 'isPR'], true],
                    paint: {
                      'circle-radius': 12,
                      'circle-color': ['match', ['get', 'colorIndex'],
                        0, '#00BCD4', 1, '#AB47BC', 2, '#FF7043', 3, '#66BB6A',
                        4, '#42A5F5', 5, '#FFCA28', 6, '#26A69A', 7, '#EC407A',
                        '#00BCD4'],
                      'circle-stroke-width': 2,
                      'circle-stroke-color': '#FFFFFF',
                    },
                  });
                  window.map.addLayer({
                    id: 'section-marker-text-3d',
                    type: 'symbol',
                    source: 'section-markers-source',
                    filter: ['!=', ['get', 'isPR'], true],
                    layout: {
                      'text-field': ['get', 'label'],
                      'text-size': 10,
                      'text-anchor': 'center',
                      'text-allow-overlap': true,
                      'text-ignore-placement': true,
                    },
                    paint: { 'text-color': '#FFFFFF' },
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
                        'icon-color': '#D4AF37',
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
                    'circle-stroke-color': '#FFFFFF',
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
  bounds?: { ne: [number, number]; sw: [number, number] } | null
): string {
  const coordsJSON = JSON.stringify(coordinates);
  const fit =
    bounds && coordinates.length > 0
      ? `window.map.fitBounds([${JSON.stringify(bounds.sw)}, ${JSON.stringify(bounds.ne)}], { padding: 60, duration: 600 });`
      : '';
  return `
        (function() {
          if (!window.map || !window._veloq3d || !window._veloq3d.setRoute) return;
          window._veloq3d.setRoute(${coordsJSON});
          ${fit}
        })();
        true;
  `;
}
