/**
 * Single-FFI hook for the Routes screen.
 * Returns everything the screen needs (groups with polylines, sections with polylines,
 * counts, date range) from one Rust call instead of 50+.
 */

import { createEngineHook } from './useRouteEngine';
import type { RoutesScreenData } from 'veloqrs';

export const useRoutesScreenData = createEngineHook<RoutesScreenData | null>(
  (engine) => engine.getRoutesScreenData() ?? null,
  ['groups', 'sections', 'activities'],
  null
);
