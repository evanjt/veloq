/**
 * Whether the map draws the heatmap, and which layers its layers menu has checked.
 *
 * It lives here rather than in the routes and detection store because it is
 * something the map draws, and settings offers it on the maps spoke beside the
 * other things it draws. `RegionalMapView` and the launch path read it outside
 * React, so it is a store with a synchronous getter rather than a context.
 *
 * Every install that has ever turned it off persisted the choice under the
 * routes key, so the first load without a key of its own adopts that value and
 * writes it here.
 *
 * `enabled` is the settings switch, whether the heatmap layer exists at all.
 * `heatmapVisible`, `activitiesVisible` and `routesVisible` are the checks in
 * the map's layers menu, persisted like any other view setting.
 */

import { create } from 'zustand';

import { getSetting, setSetting } from '@/shared/storage';
import { debug } from '@/shared/debug/debug';

const log = debug.create('HeatmapPreference');

const HEATMAP_KEY = 'veloq-heatmap-enabled';
const ROUTES_VISIBLE_KEY = 'veloq-map-routes-visible';
const HEATMAP_VISIBLE_KEY = 'veloq-map-heatmap-visible';
const ACTIVITIES_VISIBLE_KEY = 'veloq-map-activities-visible';
const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

const DEFAULT_ENABLED = true;

interface HeatmapPreferenceState {
  enabled: boolean;
  /** Whether the global map draws route lines. Off until the athlete turns it on. */
  routesVisible: boolean;
  /** Whether the global map draws the heatmap layer, when settings has it on. */
  heatmapVisible: boolean;
  /** Whether the global map draws activity markers and traces. */
  activitiesVisible: boolean;
  sectionsVisible: boolean;
  isLoaded: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  setRoutesVisible: (visible: boolean) => void;
  setHeatmapVisible: (visible: boolean) => void;
  setActivitiesVisible: (visible: boolean) => void;
  setSectionsVisible: (visible: boolean) => void;
  initialise: () => Promise<void>;
}

/** A layer check that starts on, so only a stored `false` hides it. */
async function readVisible(key: string): Promise<boolean> {
  return (await getSetting(key)) !== 'false';
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
  routesVisible: false,
  heatmapVisible: true,
  activitiesVisible: true,
  sectionsVisible: true,
  isLoaded: false,

  initialise: async () => {
    try {
      set({
        routesVisible: (await getSetting(ROUTES_VISIBLE_KEY)) === 'true',
        heatmapVisible: await readVisible(HEATMAP_VISIBLE_KEY),
        activitiesVisible: await readVisible(ACTIVITIES_VISIBLE_KEY),
      });
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

  setRoutesVisible: (visible: boolean) => {
    set({ routesVisible: visible });
    setSetting(ROUTES_VISIBLE_KEY, String(visible)).catch((error) => {
      log.error('Failed to save the routes visibility:', error);
    });
  },

  setHeatmapVisible: (visible: boolean) => {
    set({ heatmapVisible: visible });
    setSetting(HEATMAP_VISIBLE_KEY, String(visible)).catch((error) => {
      log.error('Failed to save the heatmap visibility:', error);
    });
  },

  setActivitiesVisible: (visible: boolean) => {
    set({ activitiesVisible: visible });
    setSetting(ACTIVITIES_VISIBLE_KEY, String(visible)).catch((error) => {
      log.error('Failed to save the activities visibility:', error);
    });
  },

  setSectionsVisible: (visible: boolean) => set({ sectionsVisible: visible }),

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

export async function initialiseHeatmapPreference(): Promise<void> {
  await useHeatmapPreference.getState().initialise();
}
