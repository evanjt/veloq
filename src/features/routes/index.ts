export * from './components';
/* eslint-disable import/export -- RouteSignature is disambiguated below on purpose */
export * from './hooks';
export * from './constants';
export * from './types';

// types.ts and the route-engine hook both declare RouteSignature (full record vs
// map-minimal shape). The explicit re-export resolves the export-* ambiguity to
// the full record; map consumers that need the minimal shape import it from
// './hooks' directly.
export type { RouteSignature } from './types';
