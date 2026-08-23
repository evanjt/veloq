export { ActivityMapView } from './ActivityMapView';
export { RegionalMapView } from './RegionalMapView';
export { TimelineSlider, SyncProgressBanner } from './timeline';
export {
  ActivityTypeFilter,
  getActivityTypeConfig,
  getActivityCategory,
  groupTypesByCategory,
  ACTIVITY_CATEGORIES,
} from './ActivityTypeFilter';
export { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
export {
  MapSurface,
  MAP_SURFACE_TEST_ID,
  type MapSurfaceRef,
  type MapSurfaceProps,
  type MapCameraState,
  type MapFeatureHit,
  type MapPressEvent,
} from './MapSurface';
export { TerrainSnapshotWebView, type TerrainSnapshotWebViewRef } from './TerrainSnapshotWebView';
export { BaseMapView, type BaseMapViewProps } from './BaseMapView';
export { ActivityPopup, SectionPopup } from './regional';
export * from './mapStyles';

// Extracted components from ActivityMapView
export {
  AttributionOverlay,
  type AttributionOverlayRef,
  type AttributionOverlayProps,
} from './AttributionOverlay';
