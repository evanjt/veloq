import type { MapSurfaceHtmlConfig } from './mapSurface';

/**
 * How far either side of a tap the page looks for something to hit, in CSS
 * pixels. A finger covers about 30 px and the thinnest interactive thing on the
 * map is a 2.4 px dashed section line, so a point query missed most taps.
 */
export const SURFACE_HIT_TEST_RADIUS_PX = 12;

/**
 * The reconciler, camera helpers and bridge plumbing. Shared verbatim between
 * the initial page and the scripts injected afterwards, because a style change
 * has to be able to rebuild everything from the cached spec.
 */
export function surfaceRuntimeScript(config: MapSurfaceHtmlConfig): string {
  return `
    window._veloq = window._veloq || {
      sources: {},
      sourceDefs: {},
      layers: [],
      layerSpecs: {},
      markers: {},
      images: {},
      interactiveLayers: [],
      ready: false,
    };

    function _post(payload) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }
    window._veloq.post = _post;

    function _sourceDefinition(spec) {
      if (spec.kind === 'raster') {
        var raster = { type: 'raster', tiles: spec.tiles, tileSize: spec.tileSize };
        if (spec.minzoom !== undefined) raster.minzoom = spec.minzoom;
        if (spec.maxzoom !== undefined) raster.maxzoom = spec.maxzoom;
        return raster;
      }
      var geo = { type: 'geojson', data: spec.data };
      if (spec.cluster) {
        geo.cluster = true;
        if (spec.clusterRadius !== undefined) geo.clusterRadius = spec.clusterRadius;
        if (spec.clusterMaxZoom !== undefined) geo.clusterMaxZoom = spec.clusterMaxZoom;
        if (spec.clusterProperties) geo.clusterProperties = spec.clusterProperties;
      }
      if (spec.lineMetrics) geo.lineMetrics = true;
      if (spec.tolerance !== undefined) geo.tolerance = spec.tolerance;
      return geo;
    }

    // Cluster and lineMetrics options are baked in at addSource time, so a
    // change to any of them means tearing the source down and rebuilding it.
    function _sourceSignature(spec) {
      if (spec.kind === 'raster') {
        return 'raster:' + spec.tiles.join(',') + ':' + spec.tileSize;
      }
      return 'geojson:' + (spec.cluster ? '1' : '0') + ':' + (spec.clusterRadius || 0) +
        ':' + (spec.clusterMaxZoom || 0) + ':' + (spec.lineMetrics ? '1' : '0') +
        ':' + (spec.tolerance === undefined ? 'd' : spec.tolerance);
    }

    function _applySources(sources) {
      var map = window.map;
      Object.keys(sources).forEach(function(id) {
        var spec = sources[id];
        try {
          if (spec === null) {
            window._veloq.layers.forEach(function(layerId) {
              var layerSpec = window._veloq.layerSpecs[layerId];
              if (layerSpec && layerSpec.source === id && map.getLayer(layerId)) {
                map.removeLayer(layerId);
              }
            });
            if (map.getSource(id)) map.removeSource(id);
            delete window._veloq.sources[id];
            delete window._veloq.sourceDefs[id];
            return;
          }
          window._veloq.sources[id] = spec;
          var signature = _sourceSignature(spec);
          var existing = map.getSource(id);
          if (existing && window._veloq.sourceDefs[id] !== signature) {
            window._veloq.layers.forEach(function(layerId) {
              var layerSpec = window._veloq.layerSpecs[layerId];
              if (layerSpec && layerSpec.source === id && map.getLayer(layerId)) {
                map.removeLayer(layerId);
              }
            });
            map.removeSource(id);
            existing = null;
          }
          if (!existing) {
            map.addSource(id, _sourceDefinition(spec));
            window._veloq.sourceDefs[id] = signature;
          } else if (spec.kind !== 'raster') {
            existing.setData(spec.data);
          }
        } catch (e) {
          window._rn_log('source ' + id + ': ' + e.message);
        }
      });
    }

    // Points added to the end of a line the page already holds. The cached
    // spec is grown too, so a style swap rehydrates the whole line and not
    // just the tail.
    function _applyAppends(appends) {
      var map = window.map;
      Object.keys(appends).forEach(function(id) {
        try {
          var spec = window._veloq.sources[id];
          var data = spec && spec.data;
          var feature = data && (data.type === 'FeatureCollection' ? data.features[0] : data);
          var line = feature && feature.geometry;
          var source = map.getSource(id);
          if (!line || line.type !== 'LineString' || !source) return;
          appends[id].forEach(function(point) { line.coordinates.push(point); });
          source.setData(data);
        } catch (e) {
          window._rn_log('append ' + id + ': ' + e.message);
        }
      });
    }

    function _sameValue(a, b) {
      if (a === b) return true;
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function _updateLayer(spec) {
      var map = window.map;
      var previous = window._veloq.layerSpecs[spec.id] || {};
      var paint = spec.paint || {};
      var previousPaint = previous.paint || {};
      Object.keys(paint).forEach(function(key) {
        if (!_sameValue(paint[key], previousPaint[key])) {
          map.setPaintProperty(spec.id, key, paint[key]);
        }
      });
      var layout = spec.layout || {};
      var previousLayout = previous.layout || {};
      Object.keys(layout).forEach(function(key) {
        if (!_sameValue(layout[key], previousLayout[key])) {
          map.setLayoutProperty(spec.id, key, layout[key]);
        }
      });
      var visibility = spec.visible === false ? 'none' : 'visible';
      if (previous.visible !== spec.visible) {
        map.setLayoutProperty(spec.id, 'visibility', visibility);
      }
      if (!_sameValue(spec.filter, previous.filter)) {
        map.setFilter(spec.id, spec.filter || null);
      }
    }

    function _applyLayers(desired) {
      var map = window.map;
      var wanted = {};
      desired.forEach(function(spec) { wanted[spec.id] = true; });

      window._veloq.layers.forEach(function(id) {
        if (!wanted[id] && map.getLayer(id)) {
          try { map.removeLayer(id); } catch (e) { /* already gone with its style */ }
          delete window._veloq.layerSpecs[id];
        }
      });

      // Walk backwards so the layer we insert before already exists.
      for (var i = desired.length - 1; i >= 0; i--) {
        var spec = desired[i];
        try {
          if (map.getLayer(spec.id)) {
            _updateLayer(spec);
          } else {
            var before;
            if (spec.beforeId && map.getLayer(spec.beforeId)) {
              before = spec.beforeId;
            } else {
              for (var j = i + 1; j < desired.length; j++) {
                if (map.getLayer(desired[j].id)) { before = desired[j].id; break; }
              }
            }
            var definition = {
              id: spec.id,
              type: spec.type,
              source: spec.source,
              paint: spec.paint || {},
              layout: Object.assign(
                { visibility: spec.visible === false ? 'none' : 'visible' },
                spec.layout || {}
              ),
            };
            if (spec.filter) definition.filter = spec.filter;
            if (spec.minzoom !== undefined) definition.minzoom = spec.minzoom;
            map.addLayer(definition, before);
          }
          window._veloq.layerSpecs[spec.id] = spec;
        } catch (e) {
          window._rn_log('layer ' + spec.id + ': ' + e.message);
        }
      }
      window._veloq.layers = desired.map(function(spec) { return spec.id; });
    }

    function _applyMarkers(markers) {
      var seen = {};
      (markers || []).forEach(function(spec) {
        seen[spec.id] = true;
        var existing = window._veloq.markers[spec.id];
        if (existing) {
          if (existing.html !== spec.html) {
            existing.marker.getElement().innerHTML = spec.html;
            existing.html = spec.html;
          }
          existing.marker.setLngLat(spec.coordinate);
          return;
        }
        var element = document.createElement('div');
        element.className = 'veloq-marker';
        element.innerHTML = spec.html;
        var marker = new maplibregl.Marker({
          element: element,
          anchor: spec.anchor || 'center',
        }).setLngLat(spec.coordinate).addTo(window.map);
        window._veloq.markers[spec.id] = { marker: marker, html: spec.html };
      });
      Object.keys(window._veloq.markers).forEach(function(id) {
        if (!seen[id]) {
          window._veloq.markers[id].marker.remove();
          delete window._veloq.markers[id];
        }
      });
    }

    function _applyImages(images, done) {
      var pending = (images || []).filter(function(spec) {
        return !window.map.hasImage(spec.id);
      });
      if (pending.length === 0) { done(); return; }
      var remaining = pending.length;
      function settle() {
        remaining--;
        if (remaining === 0) done();
      }
      pending.forEach(function(spec) {
        var image = new Image();
        image.onload = function() {
          try {
            if (!window.map.hasImage(spec.id)) {
              window.map.addImage(spec.id, image, { sdf: !!spec.sdf });
            }
          } catch (e) {
            window._rn_log('image ' + spec.id + ': ' + e.message);
          }
          settle();
        };
        image.onerror = function() {
          window._rn_log('image ' + spec.id + ' failed to load');
          settle();
        };
        image.src = spec.uri;
      });
    }

    // Entry point React Native injects against. patch.sources carries only the
    // sources whose data changed. patch.layers is always the full list because
    // layer specs are small and their ordering has to be authoritative.
    window._veloq.apply = function(patch) {
      if (!window.map || !window._veloq.ready) {
        window._veloq.queued = window._veloq.queued || [];
        window._veloq.queued.push(patch);
        return;
      }
      if (patch.images) { window._veloq.images = patch.images; }
      _applyImages(patch.images || window._veloq.images, function() {
        if (patch.sources) _applySources(patch.sources);
        // After the sources, so a line sent whole this patch is not appended
        // to twice, and before the layers, which may filter on its length.
        if (patch.appends) _applyAppends(patch.appends);
        if (patch.layers) _applyLayers(patch.layers);
        if (patch.markers !== undefined) _applyMarkers(patch.markers);
        if (patch.interactiveLayers) {
          window._veloq.interactiveLayers = patch.interactiveLayers;
        }
      });
    };

    function _drainQueue() {
      var queued = window._veloq.queued || [];
      window._veloq.queued = [];
      queued.forEach(function(patch) { window._veloq.apply(patch); });
    }
    window._veloq.drain = _drainQueue;

    // Replay the whole cached spec. Used after setStyle wipes the style.
    window._veloq.rehydrate = function() {
      var sources = window._veloq.sources;
      var layers = window._veloq.layers.map(function(id) {
        return window._veloq.layerSpecs[id];
      }).filter(Boolean);
      window._veloq.sourceDefs = {};
      window._veloq.layerSpecs = {};
      var previousLayers = window._veloq.layers;
      window._veloq.layers = [];
      _applyImages(window._veloq.images, function() {
        _applySources(sources);
        _applyLayers(layers);
        window._veloq.layers = previousLayers;
      });
    };

    function _cameraState() {
      var map = window.map;
      var center = map.getCenter();
      var bounds = map.getBounds();
      return {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        bounds: {
          sw: [bounds.getWest(), bounds.getSouth()],
          ne: [bounds.getEast(), bounds.getNorth()],
        },
      };
    }
    window._veloq.cameraState = _cameraState;

    window._veloq.attachEvents = function() {
      var map = window.map;
      var lastRegionPost = 0;
      var pendingRegion = null;

      function postRegionIsChanging(event) {
        var now = Date.now();
        if (now - lastRegionPost < ${config.regionChangeThrottleMs}) {
          if (pendingRegion === null) {
            pendingRegion = setTimeout(function() {
              pendingRegion = null;
              postRegionIsChanging(event);
            }, ${config.regionChangeThrottleMs});
          }
          return;
        }
        lastRegionPost = now;
        var state = _cameraState();
        state.type = 'regionIsChanging';
        state.isUserInteraction = !!(event && event.originalEvent);
        _post(state);
      }

      function postRegionDidChange(event) {
        var state = _cameraState();
        state.type = 'regionDidChange';
        state.isUserInteraction = !!(event && event.originalEvent);
        _post(state);
      }

      map.on('move', postRegionIsChanging);
      map.on('rotate', function() {
        _post({ type: 'bearingChange', bearing: map.getBearing() });
      });
      map.on('moveend', postRegionDidChange);
      map.on('zoomend', postRegionDidChange);
      map.on('rotateend', postRegionDidChange);
      map.on('pitchend', postRegionDidChange);

      function hitTest(point) {
        var layers = (window._veloq.interactiveLayers || []).filter(function(id) {
          return !!map.getLayer(id);
        });
        if (layers.length === 0) return [];
        // A finger covers about 30 px and a section line is 2.4 px of dash at
        // its widest, a third of it gap, so a point query missed most taps and
        // ran the empty-space branch. Lines sit last in the precedence
        // below, so widening the query cannot take a tap off a marker.
        var x = point.x === undefined ? point[0] : point.x;
        var y = point.y === undefined ? point[1] : point.y;
        var r = ${SURFACE_HIT_TEST_RADIUS_PX};
        var box = [[x - r, y - r], [x + r, y + r]];
        var features;
        try {
          features = map.queryRenderedFeatures(box, { layers: layers });
        } catch (e) {
          return [];
        }
        if (!features || features.length === 0) return [];
        // Preserve the caller's precedence rather than paint order. Every hit
        // in the winning layer comes back, the winner first, so points stacked
        // under one finger can be told apart by the caller.
        for (var i = 0; i < layers.length; i++) {
          var won = features.filter(function(f) {
            return f.layer && f.layer.id === layers[i];
          });
          if (won.length > 0) return won;
        }
        return [features[0]];
      }

      function describe(feature) {
        if (!feature) return null;
        return {
          layerId: feature.layer ? feature.layer.id : null,
          id: feature.id !== undefined ? feature.id : null,
          properties: feature.properties || {},
          geometry: feature.geometry && feature.geometry.type === 'Point'
            ? feature.geometry
            : null,
        };
      }

      map.on('click', function(e) {
        var hits = hitTest(e.point);
        _post({
          type: 'mapClick',
          coordinate: [e.lngLat.lng, e.lngLat.lat],
          point: [e.point.x, e.point.y],
          feature: describe(hits[0]),
          features: hits.map(describe),
        });
      });

      // MapLibre GL JS has no long-press, so time the contact ourselves and
      // cancel as soon as the finger travels far enough to be a drag.
      var pressTimer = null;
      var pressOrigin = null;
      var canvas = map.getCanvasContainer();

      function cancelPress() {
        if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
        pressOrigin = null;
      }

      canvas.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) { cancelPress(); return; }
        var touch = e.touches[0];
        var rect = canvas.getBoundingClientRect();
        pressOrigin = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        pressTimer = setTimeout(function() {
          pressTimer = null;
          if (!pressOrigin) return;
          var lngLat = map.unproject([pressOrigin.x, pressOrigin.y]);
          _post({
            type: 'mapLongPress',
            coordinate: [lngLat.lng, lngLat.lat],
            point: [pressOrigin.x, pressOrigin.y],
            feature: describe(hitTest([pressOrigin.x, pressOrigin.y])[0]),
          });
        }, ${config.longPressMs});
      }, { passive: true });

      canvas.addEventListener('touchmove', function(e) {
        if (!pressOrigin || e.touches.length !== 1) { cancelPress(); return; }
        var touch = e.touches[0];
        var rect = canvas.getBoundingClientRect();
        var dx = (touch.clientX - rect.left) - pressOrigin.x;
        var dy = (touch.clientY - rect.top) - pressOrigin.y;
        if (dx * dx + dy * dy > 100) cancelPress();
      }, { passive: true });

      canvas.addEventListener('touchend', cancelPress, { passive: true });
      canvas.addEventListener('touchcancel', cancelPress, { passive: true });
    };

    // Request/response helpers. React Native holds the promise and matches on
    // requestId, the same shape the heatmap tile protocol already uses.
    window._veloq.queryFeatures = function(requestId, point, layers, radius) {
      var map = window.map;
      var available = (layers || []).filter(function(id) { return !!map.getLayer(id); });
      var geometry = radius
        ? [[point[0] - radius, point[1] - radius], [point[0] + radius, point[1] + radius]]
        : point;
      var features = [];
      try {
        if (available.length > 0) {
          features = map.queryRenderedFeatures(geometry, { layers: available }) || [];
        }
      } catch (e) {
        features = [];
      }
      _post({
        type: 'queryResult',
        requestId: requestId,
        features: features.map(function(feature) {
          return {
            layerId: feature.layer ? feature.layer.id : null,
            id: feature.id !== undefined ? feature.id : null,
            properties: feature.properties || {},
            geometry: feature.geometry || null,
          };
        }),
      });
    };

    // Everything currently drawn in the named layers, with each point feature's
    // screen position, so a React overlay can sit exactly on top of it.
    window._veloq.queryViewportFeatures = function(requestId, layers) {
      var map = window.map;
      var available = (layers || []).filter(function(id) { return !!map.getLayer(id); });
      var features = [];
      try {
        if (available.length > 0) {
          features = map.queryRenderedFeatures({ layers: available }) || [];
        }
      } catch (e) {
        features = [];
      }
      _post({
        type: 'queryResult',
        requestId: requestId,
        features: features.map(function(feature) {
          var screen = null;
          if (feature.geometry && feature.geometry.type === 'Point') {
            var projected = map.project(feature.geometry.coordinates);
            screen = { x: projected.x, y: projected.y };
          }
          return {
            layerId: feature.layer ? feature.layer.id : null,
            id: feature.id !== undefined ? feature.id : null,
            properties: feature.properties || {},
            geometry: feature.geometry || null,
            screen: screen,
          };
        }),
      });
    };

    window._veloq.clusterLeaves = function(requestId, sourceId, clusterId, limit, offset) {
      var source = window.map.getSource(sourceId);
      if (!source || !source.getClusterLeaves) {
        _post({ type: 'clusterLeaves', requestId: requestId, features: [] });
        return;
      }
      // MapLibre 5 answers with a Promise and ignores a callback argument, and
      // a request with no post leaves its caller waiting.
      Promise.resolve()
        .then(function() { return source.getClusterLeaves(clusterId, limit, offset); })
        .then(function(features) {
          return (features || []).map(function(feature) {
            return { properties: feature.properties || {}, geometry: feature.geometry || null };
          });
        }, function() { return []; })
        .then(function(features) {
          _post({ type: 'clusterLeaves', requestId: requestId, features: features });
        });
    };

    window._veloq.clusterExpansionZoom = function(requestId, sourceId, clusterId) {
      var source = window.map.getSource(sourceId);
      if (!source || !source.getClusterExpansionZoom) {
        _post({ type: 'clusterExpansionZoom', requestId: requestId, zoom: null });
        return;
      }
      Promise.resolve()
        .then(function() { return source.getClusterExpansionZoom(clusterId); })
        .then(function(zoom) {
          return typeof zoom === 'number' ? zoom : null;
        }, function() { return null; })
        .then(function(zoom) {
          _post({ type: 'clusterExpansionZoom', requestId: requestId, zoom: zoom });
        });
    };

    // Screen positions for the React Native overlays that sit above the map.
    window._veloq.projectPoints = function(requestId, points) {
      var projected = (points || []).map(function(entry) {
        var screen = window.map.project(entry.coordinate);
        return { id: entry.id, x: screen.x, y: screen.y };
      });
      _post({ type: 'projected', requestId: requestId, points: projected });
    };
  `;
}
