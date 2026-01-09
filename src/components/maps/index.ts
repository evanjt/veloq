export { ActivityMapView } from './ActivityMapView';
export { RegionalMapView } from './RegionalMapView';
export { TimelineSlider } from './timeline';
export {
  ActivityTypeFilter,
  getActivityTypeConfig,
  getActivityCategory,
  groupTypesByCategory,
  ACTIVITY_CATEGORIES,
} from './ActivityTypeFilter';
export { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
export { BaseMapView, type BaseMapViewProps } from './BaseMapView';
export { HeatmapLayer } from './HeatmapLayer';
export { HeatmapCellPopup } from './HeatmapCellPopup';
export { ActivityPopup, HeatmapCellInfo, SectionPopup } from './regional';
export * from './mapStyles';

// Extracted components from ActivityMapView
export { StyleSwitcher } from './StyleSwitcher';
export { LocationHandler } from './LocationHandler';
export { HighlightRenderer } from './HighlightRenderer';
export { SectionCreationTools } from './SectionCreationTools';
