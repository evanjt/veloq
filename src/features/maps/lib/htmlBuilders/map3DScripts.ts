import type { FeatureCollection } from 'geojson';

// Trophy icon (black silhouette) encoded as base64 for WebView injection.
// Loaded as SDF in MapLibre GL JS so we can tint it gold and match the 2D view.
const TROPHY_BASE64 =
  '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';

interface UpdateLayersParams {
  routesGeoJSON?: FeatureCollection;
  sectionsGeoJSON?: FeatureCollection;
  tracesGeoJSON?: FeatureCollection;
  sectionMarkersGeoJSON?: FeatureCollection;
  pointMarkersGeoJSON?: FeatureCollection;
  sectionBoundariesGeoJSON?: FeatureCollection;
  highlightedSectionId?: string | null;
}

// Builds the injected JS that adds or updates the 3D map's GeoJSON layers
// without reloading the WebView. Retries while the style finishes loading.
export function buildUpdateLayersScript({
  routesGeoJSON,
  sectionsGeoJSON,
  tracesGeoJSON,
  sectionMarkersGeoJSON,
  pointMarkersGeoJSON,
  sectionBoundariesGeoJSON,
  highlightedSectionId,
}: UpdateLayersParams): string {
  const routesJSON = routesGeoJSON ? JSON.stringify(routesGeoJSON) : 'null';
  const sectionsJSON = sectionsGeoJSON ? JSON.stringify(sectionsGeoJSON) : 'null';
  const tracesJSON = tracesGeoJSON ? JSON.stringify(tracesGeoJSON) : 'null';
  const sectionMarkersJSON = sectionMarkersGeoJSON ? JSON.stringify(sectionMarkersGeoJSON) : 'null';
  const pointMarkersJSON = pointMarkersGeoJSON ? JSON.stringify(pointMarkersGeoJSON) : 'null';
  const boundariesJSON = sectionBoundariesGeoJSON
    ? JSON.stringify(sectionBoundariesGeoJSON)
    : 'null';
  const highlightIdJSON = highlightedSectionId ? JSON.stringify(highlightedSectionId) : 'null';

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

            // Update sections layer — section consensus polylines (used by RegionalMapView
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

            // Update traces layer — activity portion cutouts along the activity's own GPS trace.
            // PR = gold; non-PR = section palette indexed by colorIndex (matches 2D).
            var baseTracesColor = ['case', ['==', ['get', 'isPR'], true], '#D4AF37',
              ['match', ['get', 'colorIndex'],
                0, '#00BCD4', 1, '#AB47BC', 2, '#FF7043', 3, '#66BB6A',
                4, '#42A5F5', 5, '#FFCA28', 6, '#26A69A', 7, '#EC407A',
                '#00BCD4']];
            addLayerWithOutline('traces-source', 'traces-layer', tracesData,
              baseTracesColor, 4, 1);
            // Dashed pattern — overlapping sections let the colour underneath bleed through.
            try {
              if (window.map.getLayer('traces-layer')) {
                window.map.setPaintProperty('traces-layer', 'line-dasharray', [2, 1.2]);
              }
            } catch (e) { /* noop */ }
            // Apply highlight state by re-setting paint props (addLayerWithOutline only
            // calls setData on subsequent calls, so paint updates go through here).
            try {
              if (window.map.getLayer('traces-layer')) {
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

            // Section boundary ticks — perpendicular marks at each portion's start/end.
            // Drawn above traces so boundaries are visible through any overlap.
            try {
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

            // Activity point markers — used by the global map in 3D as a
            // points-only equivalent of the 2D markers/clusters layer. We
            // intentionally skip MapLibre supercluster here to keep the
            // implementation simple; the marker count on global is in the
            // hundreds and renders fine as raw points.
            try {
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
