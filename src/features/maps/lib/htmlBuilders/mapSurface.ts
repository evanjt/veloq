/**
 * HTML and injected scripts for `MapSurface`, the MapLibre GL JS page every
 * 2D map renders into.
 *
 * The page owns a small reconciler. React Native posts a declarative patch of
 * sources, layers and markers, and the page adds, updates or removes to match.
 * Keeping the reconciler in the page means a style change only has to replay a
 * cached spec instead of round-tripping every polyline back over the bridge.
 *
 * Hit testing also lives in the page. `queryRenderedFeatures` runs against the
 * layers the caller declared interactive and only the resolved feature comes
 * out, so there is no platform-specific tap path on the React Native side.
 */
import { consoleBridgeScript, mapLibreHead, tileProtocolsScript } from './shared';
import { resolveStyleExpression, type WebViewStyleOptions } from './styleResolution';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import type { LngLat, LngLatBounds } from '@/features/maps/lib/coordinates';
import { MAP_SURFACE_READY_TIMEOUT_MS } from '@/features/maps/lib/mapBudgets';

/** Padding for `fitBounds`, in pixels. A number applies to all four edges. */
export type MapPadding = number | { top: number; right: number; bottom: number; left: number };

export interface MapCameraSpec {
  center?: LngLat;
  zoom?: number;
  bearing?: number;
  pitch?: number;
  /** Fit these bounds instead of using `center`/`zoom`. */
  bounds?: LngLatBounds;
  padding?: MapPadding;
  /** Clamp, so fitting a tiny bounding box cannot zoom past useful detail. */
  maxZoom?: number;
}

/** A GeoJSON source, optionally clustered. */
export interface MapGeoJSONSourceSpec {
  kind: 'geojson';
  data: GeoJSON.FeatureCollection | GeoJSON.Feature;
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoom?: number;
  clusterProperties?: Record<string, unknown>;
  /** Needed by gradient lines, which address the line by `line-progress`. */
  lineMetrics?: boolean;
  tolerance?: number;
}

/** A raster tile source, used by the heatmap overlay. */
export interface MapRasterSourceSpec {
  kind: 'raster';
  tiles: string[];
  tileSize: number;
  minzoom?: number;
  maxzoom?: number;
}

export type MapSourceSpec = MapGeoJSONSourceSpec | MapRasterSourceSpec;

export interface MapLayerSpec {
  id: string;
  type: 'line' | 'circle' | 'symbol' | 'fill' | 'raster' | 'heatmap';
  source: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown[];
  /** Insert below this layer when it exists in the base style. */
  beforeId?: string;
  /** Hidden layers stay mounted so a toggle is a visibility flip, not a churn. */
  visible?: boolean;
}

/** A DOM marker anchored to a coordinate, for chrome the layers cannot draw. */
export interface MapMarkerSpec {
  id: string;
  coordinate: LngLat;
  /** Inline HTML for the marker element. Built from theme tokens by callers. */
  html: string;
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

/** Images the page must register before symbol layers can reference them. */
export interface MapImageSpec {
  id: string;
  /** `data:` URI. */
  uri: string;
  /** Register as an SDF so `icon-color` can tint it. */
  sdf?: boolean;
}

export interface MapSurfaceSpec {
  sources: Record<string, MapSourceSpec>;
  layers: MapLayerSpec[];
  markers?: MapMarkerSpec[];
  images?: MapImageSpec[];
  /** Layers hit-tested on tap, most specific first. */
  interactiveLayers?: string[];
}

export interface MapSurfaceHtmlConfig {
  style: MapStyleType;
  styleOptions?: WebViewStyleOptions;
  camera: MapCameraSpec;
  /** Gestures the user may perform. A preview map turns them all off. */
  interaction: {
    scroll: boolean;
    zoom: boolean;
    rotate: boolean;
    pitch: boolean;
  };
  devicePixelRatio: number;
  /** Milliseconds between `regionIsChanging` posts while a gesture runs. */
  regionChangeThrottleMs: number;
  /** Emit a long-press message after this many milliseconds of contact. */
  longPressMs: number;
}

function paddingExpression(padding: MapPadding | undefined, fallback: number): string {
  if (padding === undefined) return String(fallback);
  if (typeof padding === 'number') return String(padding);
  return JSON.stringify(padding);
}

/**
 * The reconciler, camera helpers and bridge plumbing. Shared verbatim between
 * the initial page and the scripts injected afterwards, because a style change
 * has to be able to rebuild everything from the cached spec.
 */
function surfaceRuntimeScript(config: MapSurfaceHtmlConfig): string {
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
        if (layers.length === 0) return null;
        var features;
        try {
          features = map.queryRenderedFeatures(point, { layers: layers });
        } catch (e) {
          return null;
        }
        if (!features || features.length === 0) return null;
        // Preserve the caller's precedence rather than paint order.
        for (var i = 0; i < layers.length; i++) {
          for (var j = 0; j < features.length; j++) {
            if (features[j].layer && features[j].layer.id === layers[i]) {
              return features[j];
            }
          }
        }
        return features[0];
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
        _post({
          type: 'mapClick',
          coordinate: [e.lngLat.lng, e.lngLat.lat],
          point: [e.point.x, e.point.y],
          feature: describe(hitTest(e.point)),
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
            feature: describe(hitTest([pressOrigin.x, pressOrigin.y])),
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
      source.getClusterLeaves(clusterId, limit, offset, function(error, features) {
        _post({
          type: 'clusterLeaves',
          requestId: requestId,
          features: error ? [] : (features || []).map(function(feature) {
            return { properties: feature.properties || {}, geometry: feature.geometry || null };
          }),
        });
      });
    };

    window._veloq.clusterExpansionZoom = function(requestId, sourceId, clusterId) {
      var source = window.map.getSource(sourceId);
      if (!source || !source.getClusterExpansionZoom) {
        _post({ type: 'clusterExpansionZoom', requestId: requestId, zoom: null });
        return;
      }
      source.getClusterExpansionZoom(clusterId, function(error, zoom) {
        _post({
          type: 'clusterExpansionZoom',
          requestId: requestId,
          zoom: error ? null : zoom,
        });
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

/** Build the page. Only style, camera and gesture settings force a rebuild. */
export function buildMapSurfaceHtml(config: MapSurfaceHtmlConfig): string {
  const { styleJSON, url } = resolveStyleExpression(config.style, config.styleOptions);
  const { camera, interaction } = config;

  const boundsJSON = camera.bounds ? JSON.stringify(camera.bounds) : 'null';
  const centerJSON = camera.center ? JSON.stringify(camera.center) : 'null';

  return `${mapLibreHead({ title: 'Map' })}
<body>
  <div id="map"></div>
  <script>
${consoleBridgeScript()}

    // The renderer is fetched from a CDN and nothing below runs without it, so
    // the watchdog is armed before the first line that touches maplibregl.
    var _mapReadySent = false;
    var _mapFailedSent = false;

    function _postToHost(message) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }
    }

    function _sendMapFailed(reason) {
      if (_mapReadySent || _mapFailedSent) return;
      _mapFailedSent = true;
      window._rn_log('sending mapFailed - ' + reason);
      _postToHost({ type: 'mapFailed', reason: String(reason) });
    }

    // A load that lands after the watchdog fired still counts, so a slow page
    // clears the unavailable state rather than staying stuck on it.
    function _sendMapReady() {
      if (_mapReadySent) return;
      _mapReadySent = true;
      _postToHost({ type: 'mapReady' });
    }

    if (window.addEventListener) {
      window.addEventListener('error', function(e) {
        _sendMapFailed('page error: ' + ((e && e.message) || 'unknown'));
      });
    }

    setTimeout(function() { _sendMapFailed('ready timeout'); }, ${MAP_SURFACE_READY_TIMEOUT_MS});

${tileProtocolsScript()}

    var _bounds = ${boundsJSON};
    var _center = ${centerJSON};
    var _fitPadding = ${paddingExpression(camera.padding, 40)};
    var _maxZoom = ${camera.maxZoom ?? 'null'};
    window._veloqMaxZoom = _maxZoom;
    window._veloqFitPadding = _fitPadding;

    function _mapOptions(style) {
      var options = {
        container: 'map',
        style: style,
        attributionControl: false,
        antialias: true,
        pixelRatio: ${config.devicePixelRatio},
        bearing: ${camera.bearing ?? 0},
        pitch: ${camera.pitch ?? 0},
        maxPitch: 85,
        dragPan: ${interaction.scroll},
        scrollZoom: ${interaction.zoom},
        boxZoom: false,
        doubleClickZoom: ${interaction.zoom},
        touchZoomRotate: ${interaction.zoom},
        dragRotate: ${interaction.rotate},
        touchPitch: ${interaction.pitch},
        keyboard: false,
      };
      if (_maxZoom !== null) options.maxZoom = _maxZoom;
      if (_bounds) {
        options.bounds = [_bounds.sw, _bounds.ne];
        options.fitBoundsOptions = { padding: _fitPadding };
      } else if (_center) {
        options.center = _center;
        options.zoom = ${camera.zoom ?? 12};
      } else {
        options.center = [0, 0];
        options.zoom = 2;
      }
      return options;
    }

${surfaceRuntimeScript(config)}

    try {
      var _style = ${styleJSON};
      if (_style) {
        window.map = new maplibregl.Map(_mapOptions(_style));
      } else {
        window.map = new maplibregl.Map(_mapOptions('${url ?? ''}'));
      }

      if (${!interaction.rotate}) {
        window.map.touchZoomRotate.disableRotation();
      }

      window.map.on('error', function(e) {
        var message = e.error ? (e.error.message || String(e.error)) : (e.message || '');
        // Regional satellite sources 404 outside their coverage by design.
        if (message.indexOf('HTTP 4') === 0) return;
        window._rn_log('map error: ' + message);
      });

      window.map.on('load', function() {
        window.map.resize();
        window._veloq.ready = true;
        window._veloq.attachEvents();
        window._veloq.drain();
        _sendMapReady();
      });
    } catch (e) {
      window._rn_log('SCRIPT ERROR: ' + e.message + ' at ' + (e.stack || ''));
      _sendMapFailed('script error: ' + e.message);
    }
  </script>
</body>
</html>`;
}

/** Apply a spec patch. Sources omitted from the patch keep their current data. */
export function buildApplyScript(patch: {
  sources?: Record<string, MapSourceSpec | null>;
  layers?: MapLayerSpec[];
  markers?: MapMarkerSpec[];
  images?: MapImageSpec[];
  interactiveLayers?: string[];
}): string {
  return `window._veloq && window._veloq.apply(${JSON.stringify(patch)}); true;`;
}

/** Swap the base style, then replay the cached sources and layers over it. */
export function buildSetStyleScript(
  style: MapStyleType,
  options: WebViewStyleOptions = {}
): string {
  const { styleJSON, url } = resolveStyleExpression(style, options);
  return `
    (function() {
      if (!window.map) return;
      function apply(next) {
        window.map.once('style.load', function() { window._veloq.rehydrate(); });
        window.map.setStyle(next);
      }
      var inline = ${styleJSON};
      if (inline) {
        apply(inline);
      } else {
        fetch('${url ?? ''}')
          .then(function(r) { return r.json(); })
          .then(apply)
          .catch(function(e) { window._rn_log('style fetch failed: ' + e.message); });
      }
    })();
    true;
  `;
}

/** Move the camera. `duration` of 0 jumps. */
export function buildSetCameraScript(camera: MapCameraSpec, duration = 0): string {
  const options: Record<string, unknown> = {};
  if (camera.center) options.center = camera.center;
  if (camera.zoom !== undefined) options.zoom = camera.zoom;
  if (camera.bearing !== undefined) options.bearing = camera.bearing;
  if (camera.pitch !== undefined) options.pitch = camera.pitch;
  return `
    if (window.map) {
      window.map.${duration > 0 ? 'easeTo' : 'jumpTo'}(${JSON.stringify({
        ...options,
        ...(duration > 0 ? { duration } : {}),
      })});
    }
    true;
  `;
}

export function buildFitBoundsScript(
  bounds: LngLatBounds,
  padding: MapPadding = 40,
  duration = 0
): string {
  return `
    if (window.map) {
      window.map.fitBounds(${JSON.stringify([bounds.sw, bounds.ne])}, {
        padding: ${paddingExpression(padding, 40)},
        duration: ${duration},
      });
    }
    true;
  `;
}

export function buildResetOrientationScript(duration = 500): string {
  return `
    if (window.map) { window.map.easeTo({ bearing: 0, pitch: 0, duration: ${duration} }); }
    true;
  `;
}

export function buildQueryFeaturesScript(
  requestId: string,
  point: [number, number],
  layers: string[],
  radius = 0
): string {
  return `
    window._veloq && window._veloq.queryFeatures(${JSON.stringify(requestId)}, ${JSON.stringify(
      point
    )}, ${JSON.stringify(layers)}, ${radius});
    true;
  `;
}

export function buildQueryViewportFeaturesScript(requestId: string, layers: string[]): string {
  return `
    window._veloq && window._veloq.queryViewportFeatures(${JSON.stringify(
      requestId
    )}, ${JSON.stringify(layers)});
    true;
  `;
}

export function buildClusterLeavesScript(
  requestId: string,
  sourceId: string,
  clusterId: number,
  limit: number,
  offset: number
): string {
  return `
    window._veloq && window._veloq.clusterLeaves(${JSON.stringify(requestId)}, ${JSON.stringify(
      sourceId
    )}, ${clusterId}, ${limit}, ${offset});
    true;
  `;
}

export function buildClusterExpansionZoomScript(
  requestId: string,
  sourceId: string,
  clusterId: number
): string {
  return `
    window._veloq && window._veloq.clusterExpansionZoom(${JSON.stringify(
      requestId
    )}, ${JSON.stringify(sourceId)}, ${clusterId});
    true;
  `;
}

export function buildProjectPointsScript(
  requestId: string,
  points: { id: string; coordinate: LngLat }[]
): string {
  return `
    window._veloq && window._veloq.projectPoints(${JSON.stringify(requestId)}, ${JSON.stringify(
      points
    )});
    true;
  `;
}

/**
 * Answer a pending `bundled://` request with base64 bytes, or tell the page to
 * fetch it itself when the app does not carry that asset.
 *
 * The page decoded what shape it asked for when it made the request, so the
 * reply only carries bytes. They are walked out of the binary string with
 * `charCodeAt`: `new Blob` would re-encode them as UTF-8 and mangle the PNG.
 */
export function buildBundledAssetReplyScript(requestId: string, base64: string | null): string {
  const id = JSON.stringify(requestId);
  if (!base64) {
    return `
      (function() {
        var pending = window._bundledRequests && window._bundledRequests[${id}];
        if (pending) pending.fallback();
      })();
      true;
    `;
  }
  return `
    (function() {
      var pending = window._bundledRequests && window._bundledRequests[${id}];
      if (!pending) return;
      try {
        var binary = atob('${base64}');
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        if (pending.kind === 'json') {
          pending.deliver({ data: JSON.parse(new TextDecoder().decode(bytes)) });
        } else if (pending.kind === 'image') {
          pending.deliver(window._veloqBlobToImage(new Blob([bytes])));
        } else {
          pending.deliver({ data: bytes.buffer });
        }
      } catch (e) {
        pending.fallback();
      }
    })();
    true;
  `;
}

/**
 * Resolve a pending `heatmap-file://` request with base64 PNG bytes, or reject
 * it when the tile is missing.
 *
 * `addProtocol` wants `{ data: ArrayBuffer }` for a raster tile. The bytes are
 * walked out of the binary string with `charCodeAt` rather than handed to
 * `new Blob`, which would re-encode them as UTF-8 and mangle the PNG.
 */
export function buildHeatmapTileReplyScript(requestId: string, base64: string | null): string {
  const id = JSON.stringify(requestId);
  if (!base64) {
    return `
      (function() {
        var pending = window._heatmapRequests && window._heatmapRequests[${id}];
        if (pending) {
          delete window._heatmapRequests[${id}];
          pending.reject(new Error('tile unavailable'));
        }
      })();
      true;
    `;
  }
  return `
    (function() {
      var pending = window._heatmapRequests && window._heatmapRequests[${id}];
      if (!pending) return;
      delete window._heatmapRequests[${id}];
      try {
        var binary = atob(${JSON.stringify(base64)});
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
        pending.resolve({ data: bytes.buffer });
      } catch (err) {
        pending.reject(new Error('heatmap base64 decode failed: ' + err));
      }
    })();
    true;
  `;
}
