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
  initialiseHeatmapPreference,
} from '@/features/maps/stores/HeatmapPreferenceStore';

const HEATMAP_KEY = 'veloq-heatmap-enabled';
const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  useHeatmapPreference.setState({
    enabled: true,
    routesVisible: false,
    heatmapVisible: true,
    activitiesVisible: true,
    isLoaded: false,
  });
});

describe('the heatmap preference', () => {
  vaultIt('is on by default, which is what the routes store defaulted to', async () => {
    await initialiseHeatmapPreference();

    expect(isHeatmapEnabled()).toBe(true);
    expect(useHeatmapPreference.getState().isLoaded).toBe(true);
  });

  it('adopts the value the routes store persisted, so a choice is not lost', async () => {
    await AsyncStorage.setItem(
      ROUTE_SETTINGS_KEY,
      JSON.stringify({ enabled: true, heatmapEnabled: false })
    );

    await initialiseHeatmapPreference();

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

    await initialiseHeatmapPreference();

    expect(isHeatmapEnabled()).toBe(true);
  });

  it('persists a change and answers it synchronously', async () => {
    await initialiseHeatmapPreference();

    await useHeatmapPreference.getState().setEnabled(false);

    expect(isHeatmapEnabled()).toBe(false);
    expect(await AsyncStorage.getItem(HEATMAP_KEY)).toBe('false');
  });

  it('stays usable when storage throws, rather than blocking the map', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));

    await initialiseHeatmapPreference();

    expect(useHeatmapPreference.getState().isLoaded).toBe(true);
    expect(isHeatmapEnabled()).toBe(true);
  });

  it('reads an unparseable routes payload as the default rather than throwing', async () => {
    await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, '{not json');

    await initialiseHeatmapPreference();

    expect(isHeatmapEnabled()).toBe(true);
  });
});

describe('the routes visibility', () => {
  vaultIt('is off by default and survives a relaunch once turned on', async () => {
    await initialiseHeatmapPreference();
    expect(useHeatmapPreference.getState().routesVisible).toBe(false);

    useHeatmapPreference.getState().setRoutesVisible(true);
    await Promise.resolve();
    useHeatmapPreference.setState({ routesVisible: false, isLoaded: false });

    await initialiseHeatmapPreference();
    expect(useHeatmapPreference.getState().routesVisible).toBe(true);
  });
});

describe('the heatmap and activities layer checks', () => {
  vaultIt('are on by default', async () => {
    await initialiseHeatmapPreference();

    expect(useHeatmapPreference.getState().heatmapVisible).toBe(true);
    expect(useHeatmapPreference.getState().activitiesVisible).toBe(true);
  });

  it('survive a relaunch once turned off', async () => {
    await initialiseHeatmapPreference();

    useHeatmapPreference.getState().setHeatmapVisible(false);
    useHeatmapPreference.getState().setActivitiesVisible(false);
    await Promise.resolve();
    useHeatmapPreference.setState({
      heatmapVisible: true,
      activitiesVisible: true,
      isLoaded: false,
    });

    await initialiseHeatmapPreference();
    expect(useHeatmapPreference.getState().heatmapVisible).toBe(false);
    expect(useHeatmapPreference.getState().activitiesVisible).toBe(false);
  });

  vaultIt('come back on after being turned off and on again', async () => {
    await initialiseHeatmapPreference();

    useHeatmapPreference.getState().setHeatmapVisible(false);
    useHeatmapPreference.getState().setHeatmapVisible(true);
    await Promise.resolve();
    useHeatmapPreference.setState({ heatmapVisible: false, isLoaded: false });

    await initialiseHeatmapPreference();
    expect(useHeatmapPreference.getState().heatmapVisible).toBe(true);
  });

  it('leave the heatmap setting alone, which says whether the layer exists at all', async () => {
    await initialiseHeatmapPreference();

    useHeatmapPreference.getState().setHeatmapVisible(false);
    await Promise.resolve();

    expect(isHeatmapEnabled()).toBe(true);
    expect(await AsyncStorage.getItem(HEATMAP_KEY)).toBe('true');
  });
});

describe('the heatmap on the detail maps', () => {
  it('is off for every map kind until turned on', async () => {
    await initialiseHeatmapPreference();

    expect(useHeatmapPreference.getState().detailHeatmap).toEqual({
      activity: false,
      section: false,
      route: false,
    });
  });

  it('is remembered per map kind, leaving the others and the global map alone', async () => {
    await initialiseHeatmapPreference();
    useHeatmapPreference.getState().setDetailHeatmap('section', true);
    await Promise.resolve();

    useHeatmapPreference.setState({
      detailHeatmap: { activity: false, section: false, route: false },
    });
    await initialiseHeatmapPreference();

    expect(useHeatmapPreference.getState().detailHeatmap).toEqual({
      activity: false,
      section: true,
      route: false,
    });
    expect(useHeatmapPreference.getState().heatmapVisible).toBe(true);
  });
});

describe('the library layers on the detail maps', () => {
  const allOff = {
    sections: { activity: false, section: false, route: false },
    routes: { activity: false, section: false, route: false },
  };

  it('are off for every map kind until turned on', async () => {
    await initialiseHeatmapPreference();

    expect(useHeatmapPreference.getState().detailContext).toEqual(allOff);
  });

  it('are remembered per layer and map kind, leaving the other layer and the heatmap alone', async () => {
    await initialiseHeatmapPreference();
    useHeatmapPreference.getState().setDetailContext('routes', 'section', true);
    await Promise.resolve();

    useHeatmapPreference.setState({ detailContext: allOff });
    await initialiseHeatmapPreference();

    expect(useHeatmapPreference.getState().detailContext).toEqual({
      ...allOff,
      routes: { activity: false, section: true, route: false },
    });
    expect(useHeatmapPreference.getState().detailHeatmap.section).toBe(false);
  });
});
