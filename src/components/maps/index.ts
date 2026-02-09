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
export { BaseMapView, type BaseMapViewProps } from './BaseMapView';
export { ActivityPopup, SectionPopup } from './regional';
export * from './mapStyles';

// Extracted components from ActivityMapView
export { LocationHandler } from './LocationHandler';
export { SectionCreationTools } from './SectionCreationTools';
