/**
 * What other features import from maps. A cross-feature import comes through
 * here, never a deep path, and `scripts/lint-feature-imports.mjs` holds the
 * deep count where it stands.
 */
export {
  ActivityMapView,
  SectionCreationError,
  SectionCreationResult,
  type SectionOverlay,
} from './components/ActivityMapView';
export { ACTIVITY_CATEGORIES, groupTypesByCategory } from './components/ActivityTypeFilter';
export {
  ATTRIBUTION_CLEARANCE,
  AttributionOverlay,
  type AttributionOverlayRef,
} from './components/AttributionOverlay';
export { BaseMapView } from './components/BaseMapView';
export {
  HOME_RADIUS_MAP_HEIGHT,
  HomeRadiusMap,
  type HomeRadiusMapProps,
} from './components/HomeRadiusMap';
export { Map3DWebView, type Map3DWebViewRef } from './components/Map3DWebView';
export { type MapCameraState, MapSurface, type MapSurfaceRef } from './components/MapSurface';
export { RegionalMapView } from './components/RegionalMapView';
export { type CreationState } from './components/SectionCreationOverlay';
export {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from './components/TerrainSnapshotWebView';
export { getNextStyle, getStyleIcon, isDarkStyle, type MapStyleType } from './components/mapStyles';
export { SyncProgressBanner, TimelineSlider } from './components/timeline';
export { useEngineMapActivities } from './hooks/useEngineMapActivities';
export { HEATMAP_TILES_DIR, readHeatmapTilesCacheSize } from './hooks/useHeatmapTiles';
export { useMapFullscreen } from './hooks/useMapFullscreen';
export { useThrottledValue } from './hooks/useThrottledValue';
export {
  calculateFlatCamera,
  calculateTerrainCamera,
  isLikelyInterestingTerrain,
  type TerrainCamera,
} from './lib/cameraAngle';
export { computeAttribution } from './lib/computeAttribution';
export {
  boundsOfLngLat,
  EMPTY_FEATURE_COLLECTION,
  featureCollection,
  lineEndpoints,
  lineFeature,
  type LngLat,
  type LngLatBounds,
  lngLatFromLatLngTuples,
  lngLatFromShort,
  lngLatFromShortPoint,
  pointFeature,
} from './lib/coordinates';
export { type MapCameraSpec, type MapLayerSpec, type MapSourceSpec } from './lib/htmlBuilders';
export { TRIM_UPDATE_THROTTLE_MS } from './lib/mapBudgets';
export {
  filterMapActivities,
  type MapDistanceFilter,
  mapDistanceThresholds,
} from './lib/mapDistanceFilter';
export { registerMapSurfaceReclaimer, registerTileCacheReclaimer } from './lib/mapMemoryReclaimer';
export {
  DEFAULT_MAP_PERIOD,
  getPeriodStart,
  type MapPeriod,
  PERIOD_OPTIONS,
} from './lib/mapPeriod';
export { offlineMapStyle } from './lib/offlineStyleFallback';
export { reloadMapCameraState } from './lib/storage/mapCameraState';
export {
  deleteCameraOverride,
  getCameraOverride,
  initCameraOverrides,
  reloadCameraOverrides,
  setCameraOverride,
} from './lib/storage/terrainCameraOverrides';
export {
  clearTerrainPreviews,
  consumePendingSnapshots,
  deleteSupersededTerrainPreviews,
  getTerrainPreviewCacheSize,
  getTerrainPreviewUri,
  hasTerrainPreview,
  initTerrainPreviewCache,
  isTerrainCacheInitialized,
  isTerrainPreviewDowngraded,
  onTerrainCacheReady,
} from './lib/storage/terrainPreviewCache';
export {
  initializeTileCacheSettings,
  migrateTileCacheSettings,
  useTileCacheSettings,
} from './lib/storage/tileCacheSettings';
export {
  emitClearTileCache,
  onTileCacheStats,
  requestTileCacheStats,
  subscribeSnapshot,
  subscribeSnapshotFailure,
  type TileCacheStats,
} from './lib/terrainSnapshotEvents';
export { TILE_CACHE_BUDGET_CHOICES_MB } from './lib/tileCacheBudget';
export { flushBasemapSidecars } from './lib/basemapFlush';
export { handOverGroundTemplates } from './lib/tileTransport';
export {
  initializeHeatmapPreference,
  isHeatmapEnabled,
  useHeatmapPreference,
} from './stores/HeatmapPreferenceStore';
export { MapPreferencesProvider, useMapPreferences } from './stores/MapPreferencesContext';
