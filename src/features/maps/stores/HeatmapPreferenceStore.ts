/**
 * Whether the map draws the heatmap.
 *
 * It lives here rather than in the routes and detection store because it is
 * something the map draws, and settings offers it on the maps spoke beside the
 * other things it draws. `RegionalMapView` and the launch path read it outside
 * React, so it is a store with a synchronous getter rather than a context.
 *
 * Every install that has ever turned it off persisted the choice under the
 * routes key, so the first load without a key of its own adopts that value and
 * writes it here.
 */

import { create } from 'zustand';

import { getSetting, setSetting } from '@/shared/storage';
import { debug } from '@/shared/debug/debug';

const log = debug.create('HeatmapPreference');

const HEATMAP_KEY = 'veloq-heatmap-enabled';
const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

const DEFAULT_ENABLED = true;

interface HeatmapPreferenceState {
  enabled: boolean;
  isLoaded: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  initialize: () => Promise<void>;
}

/** The value the routes store persisted, for an install that predates this key. */
async function adoptedFromRouteSettings(): Promise<boolean> {
  const stored = await getSetting(ROUTE_SETTINGS_KEY);
  if (!stored) return DEFAULT_ENABLED;
  try {
    const parsed = JSON.parse(stored) as { heatmapEnabled?: unknown };
    return typeof parsed.heatmapEnabled === 'boolean' ? parsed.heatmapEnabled : DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

export const useHeatmapPreference = create<HeatmapPreferenceState>((set) => ({
  enabled: DEFAULT_ENABLED,
  isLoaded: false,

  initialize: async () => {
    try {
      const own = await getSetting(HEATMAP_KEY);
      if (own !== null && own !== undefined) {
        set({ enabled: own === 'true', isLoaded: true });
        return;
      }
      const adopted = await adoptedFromRouteSettings();
      await setSetting(HEATMAP_KEY, String(adopted));
      set({ enabled: adopted, isLoaded: true });
    } catch (error) {
      log.error('Failed to read the heatmap preference:', error);
      set({ isLoaded: true });
    }
  },

  setEnabled: async (enabled: boolean) => {
    set({ enabled });
    try {
      await setSetting(HEATMAP_KEY, String(enabled));
    } catch (error) {
      log.error('Failed to save the heatmap preference:', error);
    }
  },
}));

/** For the map and the launch path, which read this outside React. */
export function isHeatmapEnabled(): boolean {
  return useHeatmapPreference.getState().enabled;
}

export async function initializeHeatmapPreference(): Promise<void> {
  await useHeatmapPreference.getState().initialize();
}
