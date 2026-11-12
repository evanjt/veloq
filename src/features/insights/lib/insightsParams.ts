/**
 * Scalar inputs for the engine's insights bundle, on the phone.
 *
 * The feed and the routes tab both feed the same pipeline, so both build their
 * parameters here and the windows they ask for stay identical. The windows are
 * built in `insightsParamsFor`, which the linked browser calls too.
 */

import type { InsightsParams } from 'veloqrs';
import { isRouteMatchingEnabled } from '@/features/routes';

import { insightsParamsFor } from './insightsParamsFor';

/**
 * Build the parameters for `getInsightsData` / `getStartupData` from the
 * current clock, the insights configuration and the route-matching setting.
 */
export function buildInsightsParams(): InsightsParams {
  return insightsParamsFor(isRouteMatchingEnabled());
}
