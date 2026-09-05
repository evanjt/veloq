/**
 * Scenario: the heatmap is something the map draws, and its switch lived in the
 * routes and detection store, three spokes away from Maps in settings. An
 * athlete looking for it under Maps did not find it, and an edit had to be made
 * against a store whose name says routes.
 *
 * Expected behaviour: the preference lives with the maps feature and the
 * athlete's existing choice survives the move, since it was already persisted
 * under the routes key on every install that has ever turned it off.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  useHeatmapPreference,
  isHeatmapEnabled,
  initializeHeatmapPreference,
} from '@/features/maps/stores/HeatmapPreferenceStore';

const HEATMAP_KEY = 'veloq-heatmap-enabled';
const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  useHeatmapPreference.setState({ enabled: true, isLoaded: false });
});

describe('the heatmap preference', () => {
  it('is on by default, which is what the routes store defaulted to', async () => {
    await initializeHeatmapPreference();

    expect(isHeatmapEnabled()).toBe(true);
    expect(useHeatmapPreference.getState().isLoaded).toBe(true);
  });

  it('adopts the value the routes store persisted, so a choice is not lost', async () => {
    await AsyncStorage.setItem(
      ROUTE_SETTINGS_KEY,
      JSON.stringify({ enabled: true, heatmapEnabled: false })
    );

    await initializeHeatmapPreference();

    expect(isHeatmapEnabled()).toBe(false);
    // Adopted once and written under its own key, so the routes store is no
    // longer consulted after the first launch.
    expect(await AsyncStorage.getItem(HEATMAP_KEY)).toBe('false');
  });

  it('prefers its own key over the routes store once it has one', async () => {
    await AsyncStorage.setItem(HEATMAP_KEY, 'true');
    await AsyncStorage.setItem(
      ROUTE_SETTINGS_KEY,
      JSON.stringify({ enabled: true, heatmapEnabled: false })
    );

    await initializeHeatmapPreference();

    expect(isHeatmapEnabled()).toBe(true);
  });

  it('persists a change and answers it synchronously', async () => {
    await initializeHeatmapPreference();

    await useHeatmapPreference.getState().setEnabled(false);

    expect(isHeatmapEnabled()).toBe(false);
    expect(await AsyncStorage.getItem(HEATMAP_KEY)).toBe('false');
  });

  it('stays usable when storage throws, rather than blocking the map', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));

    await initializeHeatmapPreference();

    expect(useHeatmapPreference.getState().isLoaded).toBe(true);
    expect(isHeatmapEnabled()).toBe(true);
  });

  it('reads an unparseable routes payload as the default rather than throwing', async () => {
    await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, '{not json');

    await initializeHeatmapPreference();

    expect(isHeatmapEnabled()).toBe(true);
  });
});
