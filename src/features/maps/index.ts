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
export { FILTER_CHIP, groupTypesByCategory } from './lib/activityCategories';
export {
  ATTRIBUTION_CLEARANCE,
  AttributionOverlay,
  type AttributionOverlayRef,
} from './components/AttributionOverlay';
export {
  MAP_CONTROL_GAP,
  MAP_CONTROL_SIZE,
  MapControlButton,
  type MapControlButtonProps,
} from './components/MapControlButton';
export { BaseMapView, type BaseMap3DLayer } from './components/BaseMapView';
export { ACTIVITY_COUNT_GLYPH, DIRECTION_GLYPH, FIT_GLYPH, LOCATE_GLYPH } from './lib/mapGlyphs';
export {
  HOME_RADIUS_MAP_HEIGHT,
  HomeRadiusMap,
  type HomeRadiusMapProps,
} from './components/HomeRadiusMap';
export { Map3DWebView, type Map3DWebViewRef } from './components/Map3DWebView';
export { MapKey, MapKeyNote, MapKeyRamp, MapKeySwatch } from './components/MapKey';
export { DivergingKeyRows } from './components/DivergingKeyRows';
export { type MapCameraState, MapSurface, type MapSurfaceRef } from './components/MapSurface';
export { RegionalMapView } from './components/RegionalMapView';
export { MapEmptyState } from './components/MapEmptyState';
export { MapNameSearch } from './components/MapNameSearch';
export {
  MAP_TOOL_BAR_HEIGHT,
  MapToolBar,
  type MapToolBarProps,
  type MapToolHintTone,
} from './components/MapToolBar';
export { mapToolTitle } from './lib/mapToolTitle';
export { type CreationState } from './components/SectionCreationOverlay';
export {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from './components/TerrainSnapshotWebView';
export {
  getNextStyle,
  getStyleIcon,
  isDarkStyle,
  statusBarStyleForMap,
  type MapStyleType,
} from './components/mapStyles';
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
export { useLocateUser } from './hooks/useLocateUser';
export { useTerrainFallback } from './hooks/useTerrainFallback';
export {
  calculateFlatCamera,
  calculateTerrainCamera,
  resolveTerrain3D,
  SMART_3D_MIN_RELIEF_M,
  type TerrainCamera,
} from './lib/cameraAngle';
export { cameraAfter3D, type Camera3DState } from './lib/cameraAfter3D';
export { computeAttribution } from './lib/computeAttribution';
export {
  filterSheetExpandedAfterDrag,
  filterSheetFootCover,
  filterSheetMaxHeight,
} from './lib/filterSheet';
export {
  USER_LOCATION_SOURCE_ID,
  buildUserLocationCollection,
  buildUserLocationLayers,
} from './lib/userLocationLayer';
export { ENDPOINT_IMAGES, buildEndpointLayers } from './lib/endpointLayers';
export {
  ENDPOINT_AND_DIRECTION_IMAGES,
  buildDirectionLayer,
  type LineDirection,
} from './lib/directionLayer';
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
export {
  type MapCameraSpec,
  type MapLayerSpec,
  type MapPadding,
  type MapSourceSpec,
} from './lib/htmlBuilders';
export { circlePolygon } from './lib/radiusCircle';
export { formatTrackStage } from './lib/syncProgressFormat';
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
export { submitSectionCreation } from './hooks/submitSectionCreation';
export { reloadMapCameraState } from './lib/storage/mapCameraState';
export { initCameraOverrides, reloadCameraOverrides } from './lib/storage/terrainCameraOverrides';
export {
  clearTerrainPreviews,
  deleteSupersededTerrainPreviews,
  deleteTerrainPreview,
  deleteTerrainPreviewsForActivity,
  getTerrainPreviewCacheSize,
  getTerrainPreviewUri,
  hasTerrainPreview,
  initTerrainPreviewCache,
  isTerrainCacheInitialised,
  isTerrainPreviewDowngraded,
  onTerrainCacheReady,
} from './lib/storage/terrainPreviewCache';
export { initialiseTileCacheSettings, useTileCacheSettings } from './lib/storage/tileCacheSettings';
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
export { handOverGroundTemplates, registerTileListenerResume } from './lib/tileTransport';
export {
  MAX_MAP_CONTROLS,
  activityMapControlCount,
  mapControlColumnLayout,
  useMapControlColumn,
} from './lib/mapControlColumnLayout';
export { visibleMapInset, type MapEdgeInset } from './lib/activityCamera';
export { buildSectionTrimCollection } from './lib/sectionTrimCollection';
export {
  initialiseHeatmapPreference,
  isHeatmapEnabled,
  useHeatmapPreference,
} from './stores/HeatmapPreferenceStore';
export {
  DELTA_GAPS_SOURCE_ID,
  buildDeltaGapLayer,
  deltaLineBands,
  lineBandExpression,
  noDataRanges,
  type LineBand,
} from './lib/deltaLineColor';
export { cutLineByProgress } from './lib/lineProgressCut';
