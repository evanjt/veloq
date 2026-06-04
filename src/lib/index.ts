// Algorithms
export {
  calculateTSB,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  FORM_ZONE_BOUNDARIES,
  FORM_ZONE_GUIDANCE_KEYS,
  type FormZone,
} from '@/features/fitness/lib/fitness';

// Geo utilities
export * from '@/shared/geo';

// Spatial indexing
export {
  activitySpatialIndex,
  mapBoundsToViewport,
  type Viewport,
} from '@/shared/geo/spatialIndex';

// Storage
export * from '@/shared/storage';

// Query keys
export { queryKeys } from '@/shared/query/queryKeys';

// Utilities
export * from './utils';

// Export
export * from './export';
