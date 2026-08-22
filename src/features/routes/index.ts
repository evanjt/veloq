export * from './components';
export * from './hooks';
export * from './lib';
export * from './stores';
export * from './constants';
export * from './demo';
export * from './types';

// types.ts and the route-engine hook both declare RouteSignature (full record vs
// map-minimal shape). The explicit re-export resolves the export-* ambiguity to
// the full record; map consumers that need the minimal shape import it from
// './hooks' directly.
// eslint-disable-next-line import/export -- the ambiguity is the point, see above
export type { RouteSignature } from './types';
