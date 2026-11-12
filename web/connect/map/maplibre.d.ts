// The part of the vendored MapLibre GL JS renderer the page uses. The renderer
// is a classic script that sets the global `maplibregl`, loaded before the
// page's module, so there is no package to take types from.

declare namespace maplibregl {
  type LngLat = [longitude: number, latitude: number];
  /** West, south, east, north. */
  type Bounds = [west: number, south: number, east: number, north: number];

  interface RequestParameters {
    url: string;
    type?: 'string' | 'json' | 'arrayBuffer' | 'image';
  }

  interface ResourceResponse {
    data: unknown;
    cacheControl?: string;
    expires?: string;
  }

  type ProtocolHandler = (
    parameters: RequestParameters,
    abortController: AbortController
  ) => Promise<ResourceResponse>;

  function addProtocol(scheme: string, handler: ProtocolHandler): void;
  function removeProtocol(scheme: string): void;

  interface MapOptions {
    container: HTMLElement;
    style: object;
    center?: LngLat;
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    attributionControl?: false;
    fadeDuration?: number;
    canvasContextAttributes?: { preserveDrawingBuffer?: boolean };
  }

  interface MapFeature {
    id?: string | number;
    properties: Record<string, unknown>;
    layer: { id: string };
    geometry: { type: string; coordinates: unknown };
  }

  interface FeatureTarget {
    source: string;
    id: string | number;
  }

  interface LayerDefinition {
    id: string;
    type: string;
    source: string;
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    filter?: unknown[];
    minzoom?: number;
  }

  interface GeoJSONSource {
    setData(data: unknown): void;
  }

  interface RasterSource {
    setTiles(tiles: string[]): void;
  }

  interface PointerEvent {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
  }

  class Map {
    constructor(options: MapOptions);
    remove(): void;
    resize(): void;
    isStyleLoaded(): boolean;
    on(event: string, listener: (event: PointerEvent) => void): this;
    off(event: string, listener: (event: PointerEvent) => void): this;
    once(event: string, listener: () => void): this;
    getCanvas(): HTMLCanvasElement;
    setStyle(style: object): this;
    getSource(id: string): (GeoJSONSource & RasterSource) | undefined;
    addSource(id: string, definition: object): this;
    removeSource(id: string): this;
    getLayer(id: string): object | undefined;
    addLayer(definition: LayerDefinition, before?: string): this;
    removeLayer(id: string): this;
    setLayoutProperty(layer: string, name: string, value: unknown): this;
    setPaintProperty(layer: string, name: string, value: unknown): this;
    setFilter(layer: string, filter: unknown[] | null): this;
    setLayerZoomRange(layer: string, minzoom: number, maxzoom: number): this;
    hasImage(id: string): boolean;
    addImage(id: string, image: HTMLImageElement, options?: { sdf?: boolean }): void;
    queryRenderedFeatures(
      geometry: [[number, number], [number, number]],
      options: { layers: string[] }
    ): MapFeature[];
    setFeatureState(target: FeatureTarget, state: Record<string, unknown>): void;
    removeFeatureState(target: FeatureTarget, key?: string): void;
    fitBounds(
      bounds: [[number, number], [number, number]],
      options?: { padding?: number; duration?: number; maxZoom?: number }
    ): this;
    jumpTo(options: { center?: LngLat; zoom?: number }): this;
    getZoom(): number;
    getBounds(): { toArray(): [[number, number], [number, number]] };
    unproject(point: [number, number]): { lng: number; lat: number };
    boxZoom: { disable(): void };
  }
}
