/**
 * The line above the routes and sections lists.
 *
 * Track work in progress is named with a moving indicator. A regroup the
 * engine says is owed and held, as it is behind the section rebuild an
 * upgrade runs, is a still note naming the hold: the old routes stay on
 * screen and nothing is computing them yet. Any other owed regroup is running
 * or about to, and says so with the indicator.
 */

import type { TFunction } from 'i18next';
import type { FfiDetectionHold } from 'veloqrs';

import { detectionHoldText } from './detectionHoldText';

export interface RoutesBanner {
  text: string;
  /** Whether work is moving now, which is what an indicator beside it claims. */
  busy: boolean;
}

export function routesBannerOf(
  state: {
    /** The track work line, when any runs. */
    progress: string | null;
    groupsDirty: boolean;
    groupsHold: FfiDetectionHold | null | undefined;
  },
  t: TFunction
): RoutesBanner | null {
  if (state.progress) return { text: state.progress, busy: true };
  if (!state.groupsDirty) return null;
  if (state.groupsHold) return { text: detectionHoldText(state.groupsHold, t), busy: false };
  return { text: t('routesScreen.computingRoutes') as string, busy: true };
}
