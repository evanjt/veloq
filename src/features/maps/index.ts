/**
 * What other features import from maps. A cross-feature import comes through
 * here, never a deep path, and `scripts/lint-feature-imports.mjs` holds the
 * deep count where it stands.
 */
export {
  ActivityMapView,
  ACTIVITY_MAP_POSTER_TEST_ID,
  SectionCreationError,
  SectionCreationResult,
  type SectionOverlay,
} from './components/ActivityMapView';
export {
  ACTIVITY_CATEGORIES,
  FILTER_CHIP,
  categoryChipColours,
  groupTypesByCategory,
} from './lib/activityCategories';
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
export { MapNameSearch } from './components/MapNameSearch';
export { type CreationState } from './components/SectionCreationOverlay';
export {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from './components/TerrainSnapshotWebView';
export { getNextStyle, getStyleIcon, isDarkStyle, type MapStyleType } from './components/mapStyles';
export { SyncProgressBanner, TimelineSlider } from './components/timeline';
export { useEngineMapActivities } from './hooks/useEngineMapActivities';
export {
  clearHeatmapTileSets,
  HEATMAP_TILES_DIR,
  LEGACY_HEATMAP_TILES_DIR,
  readHeatmapTilesCacheSize,
} from './lib/heatmapTiles';
export { useDrawnMapStyle } from './hooks/useDrawnMapStyle';
export { useMapFullscreen } from './hooks/useMapFullscreen';
export { useThrottledValue } from './hooks/useThrottledValue';
export {
  calculateFlatCamera,
  calculateTerrainCamera,
  resolveTerrain3D,
  type TerrainCamera,
} from './lib/cameraAngle';
export { cameraAfter3D, type Camera3DState } from './lib/cameraAfter3D';
export { computeAttribution } from './lib/computeAttribution';
export {
  boundsOfLngLat,
  EMPTY_FEATURE_COLLECTION,
  emptyGrowingLngLat,
  featureCollection,
  growLngLat,
  lineFeature,
  type LngLat,
  type LngLatBounds,
  lngLatFromShort,
  lngLatFromShortPoint,
  pointFeature,
  pointsBetweenSourceIndices,
} from './lib/coordinates';
export { type MapCameraSpec, type MapLayerSpec, type MapSourceSpec } from './lib/htmlBuilders';
export { circlePolygon } from './lib/radiusCircle';
export { TRIM_UPDATE_THROTTLE_MS } from './lib/mapBudgets';
export { registerMapSurfaceReclaimer } from './lib/mapMemoryReclaimer';
export {
  DEFAULT_MAP_PERIOD,
  getPeriodStart,
  type MapPeriod,
  PERIOD_OPTIONS,
} from './lib/mapPeriod';
export { offlineMapStyle } from './lib/offlineStyleFallback';
export { readSnapshotQueueReport } from './lib/snapshotQueueTrace';
export { sectionCreationMessageKey } from './lib/sectionCreationMessage';
export { reloadMapCameraState } from './lib/storage/mapCameraState';
export {
  deleteCameraOverride,
  getCameraOverride,
  initCameraOverrides,
  reloadCameraOverrides,
  setCameraOverride,
} from './lib/storage/terrainCameraOverrides';
export {
  addPendingSnapshot,
  clearTerrainPreviews,
  consumePendingSnapshots,
  deleteSupersededTerrainPreviews,
  deleteTerrainPreview,
  deleteTerrainPreviewsForActivity,
  getTerrainPreviewCacheSize,
  getTerrainPreviewUri,
  hasTerrainPreview,
  initTerrainPreviewCache,
  isTerrainCacheInitialized,
  isTerrainPreviewDowngraded,
  onTerrainCacheReady,
} from './lib/storage/terrainPreviewCache';
export { initializeTileCacheSettings, useTileCacheSettings } from './lib/storage/tileCacheSettings';
export { subscribeSnapshot, subscribeSnapshotFailure } from './lib/terrainSnapshotEvents';
export { TILE_CACHE_BUDGET_CHOICES_MB } from './lib/tileCacheBudget';
export { flushBasemapSidecars } from './lib/basemapFlush';
export {
  BYTES_PER_BUDGET_MB,
  clearUnpinnedBasemapTiles,
  readBasemapTileCounts,
  readBasemapTileSizes,
  resetBasemapTileCounts,
  type BasemapTileSizes,
} from './lib/basemapCache';
export { handOverGroundTemplates } from './lib/tileTransport';
export {
  MAX_MAP_CONTROLS,
  mapControlColumnLayout,
  useMapControlColumn,
} from './lib/mapControlColumnLayout';
export { buildSectionTrimCollection } from './lib/sectionTrimCollection';
export {
  initializeHeatmapPreference,
  isHeatmapEnabled,
  useHeatmapPreference,
} from './stores/HeatmapPreferenceStore';
export {
  MapPreferencesProvider,
  useMapPreferences,
  useMapPreferenceActions,
} from './stores/MapPreferencesContext';
export { buildDeltaLineStops, deltaToColor } from './lib/deltaLineColor';
