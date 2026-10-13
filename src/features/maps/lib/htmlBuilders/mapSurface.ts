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
import {
  consoleBridgeScript,
  mapLibreHead,
  motionDurationExpression,
  setReduceMotionStatement,
  setStyleStatement,
  tileProtocolsScript,
} from './shared';
import { surfaceRuntimeScript } from './mapSurfaceScripts';
import { resolveStyleExpression, type WebViewStyleOptions } from './styleResolution';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import type { LngLat, LngLatBounds } from '@/features/maps/lib/coordinates';
import { MAP_SURFACE_READY_TIMEOUT_MS } from '@/features/maps/lib/mapBudgets';
import { jsNumber } from '@/features/maps/lib/webViewLiterals';

export { SURFACE_HIT_TEST_RADIUS_PX } from './mapSurfaceScripts';

/** Padding for `fitBounds`, in pixels. A number applies to all four edges. */
export type MapPadding = number | { top: number; right: number; bottom: number; left: number };

export interface MapCameraSpec {
  center?: LngLat | undefined;
  zoom?: number | undefined;
  bearing?: number | undefined;
  pitch?: number | undefined;
  /** Fit these bounds instead of using `center`/`zoom`. */
  bounds?: LngLatBounds | undefined;
  padding?: MapPadding | undefined;
  /** Clamp, so fitting a tiny bounding box cannot zoom past useful detail. */
  maxZoom?: number | undefined;
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
  /**
   * A single LineString that normally grows at its end, such as a recording
   * in progress. The surface then ships the new points alone instead of the
   * whole line. A line that changes any other way is still sent whole.
   */
  growing?: boolean;
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
  paint?: Record<string, unknown> | undefined;
  layout?: Record<string, unknown> | undefined;
  filter?: unknown[] | undefined;
  /**
   * Lowest zoom the layer draws at. A layer whose features are only legible
   * when the view is tight says so here rather than painting a smear and
   * relying on opacity to hide it.
   */
  minzoom?: number | undefined;
  /** Insert below this layer when it exists in the base style. */
  beforeId?: string | undefined;
  /** Hidden layers stay mounted so a toggle is a visibility flip, not a churn. */
  visible?: boolean | undefined;
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
  styleOptions?: WebViewStyleOptions | undefined;
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
  /** The system reduce-motion setting when the page is built. */
  reduceMotion: boolean;
}

function paddingExpression(padding: MapPadding | undefined, fallback: number): string {
  if (padding === undefined) return String(fallback);
  if (typeof padding === 'number') return String(padding);
  return JSON.stringify(padding);
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

    // Nothing below runs without the renderer, so the watchdog is armed
    // before the first line that touches maplibregl.
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
    var _maxZoom = ${jsNumber(camera.maxZoom, null)};
    window._veloqMaxZoom = _maxZoom;
    window._veloqFitPadding = _fitPadding;
    ${setReduceMotionStatement(config.reduceMotion)}

    function _mapOptions(style) {
      var options = {
        container: 'map',
        style: style,
        attributionControl: false,
        antialias: true,
        pixelRatio: ${config.devicePixelRatio},
        bearing: ${jsNumber(camera.bearing, 0)},
        pitch: ${jsNumber(camera.pitch, 0)},
        maxPitch: 85,
        dragPan: ${interaction.scroll},
        scrollZoom: ${interaction.zoom},
        boxZoom: false,
        doubleClickZoom: ${interaction.zoom},
        touchZoomRotate: ${interaction.zoom},
        dragRotate: ${interaction.rotate},
        touchPitch: ${interaction.pitch},
        keyboard: false,
        reduceMotion: window._veloqReduceMotion,
      };
      if (_maxZoom !== null) options.maxZoom = _maxZoom;
      if (_bounds) {
        options.bounds = [_bounds.sw, _bounds.ne];
        options.fitBoundsOptions = { padding: _fitPadding };
      } else if (_center) {
        options.center = _center;
        options.zoom = ${jsNumber(camera.zoom, 12)};
      } else {
        options.center = [0, 0];
        options.zoom = 2;
      }
      return options;
    }

${surfaceRuntimeScript(config)}

    window._veloqReleasableMap = true;
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

        // idle fires once every requested tile has drawn, so the transitions
        // are the only thing posted, not each tile.
        var _tilesLoading = false;
        window.map.on('dataloading', function(e) {
          if (_tilesLoading || e.dataType !== 'source' || !e.tile) return;
          _tilesLoading = true;
          window._veloq.post({ type: 'tilesLoading' });
        });
        window.map.on('idle', function() {
          if (!_tilesLoading) return;
          _tilesLoading = false;
          window._veloq.post({ type: 'tilesSettled' });
        });
      });
    } catch (e) {
      window._rn_log('SCRIPT ERROR: ' + e.message + ' at ' + (e.stack || ''));
      _sendMapFailed('script error: ' + e.message);
    }
  </script>
</body>
</html>`;
}

/**
 * Apply a spec patch. Sources omitted from the patch keep their current data.
 *
 * `sourceJson` holds sources already serialised, by id, and is spliced in as
 * it stands, so a track the patcher stringified to diff is not stringified a
 * second time to send. The script is the same either way.
 */
export function buildApplyScript(
  patch: {
    sources?: Record<string, MapSourceSpec | null>;
    /** Points to add to the end of a growing line already on the page. */
    appends?: Record<string, GeoJSON.Position[]>;
    layers?: MapLayerSpec[];
    markers?: MapMarkerSpec[];
    images?: MapImageSpec[];
    interactiveLayers?: string[];
  },
  sourceJson: Record<string, string> = {}
): string {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key !== 'sources') {
      fields.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
      continue;
    }
    const sources = Object.entries(value as Record<string, MapSourceSpec | null>).map(
      ([id, spec]) => `${JSON.stringify(id)}:${sourceJson[id] ?? JSON.stringify(spec)}`
    );
    fields.push(`"sources":{${sources.join(',')}}`);
  }
  return `window._veloq && window._veloq.apply({${fields.join(',')}}); true;`;
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
        ${setStyleStatement('window.map', 'next')}
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

/**
 * Move the camera. `duration` of 0 jumps, and so does any move while the page
 * holds reduce motion on.
 */
export function buildSetCameraScript(camera: MapCameraSpec, duration = 0): string {
  if (camera.bounds) {
    const maxZoom = Number.isFinite(camera.maxZoom)
      ? `maxZoom: ${jsNumber(camera.maxZoom, null)},`
      : '';
    return `
    if (window.map) {
      window.map.fitBounds(${JSON.stringify([camera.bounds.sw, camera.bounds.ne])}, {
        padding: ${paddingExpression(camera.padding, 40)},
        ${maxZoom}
        duration: ${motionDurationExpression(duration)},
      });
    }
    true;
  `;
  }
  const options: Record<string, unknown> = {};
  if (camera.center) options.center = camera.center;
  if (camera.zoom !== undefined) options.zoom = camera.zoom;
  if (camera.bearing !== undefined) options.bearing = camera.bearing;
  if (camera.pitch !== undefined) options.pitch = camera.pitch;
  const optionsJSON = JSON.stringify(options);
  if (!(duration > 0)) {
    return `
    if (window.map) {
      window.map.jumpTo(${optionsJSON});
    }
    true;
  `;
  }
  return `
    (function() {
      if (!window.map) return;
      var options = ${optionsJSON};
      var duration = ${motionDurationExpression(duration)};
      if (duration > 0) {
        options.duration = duration;
        window.map.easeTo(options);
      } else {
        window.map.jumpTo(options);
      }
    })();
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
        duration: ${motionDurationExpression(duration)},
      });
    }
    true;
  `;
}

export function buildResetOrientationScript(duration = 500): string {
  return `
    if (window.map) {
      window.map.easeTo({ bearing: 0, pitch: 0, duration: ${motionDurationExpression(duration)} });
    }
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
