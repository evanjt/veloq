/**
 * Preference Stores Tests
 *
 * Consolidated tests for preference-related stores.
 * Each section tests unique behaviors; shared patterns (init, corrupt JSON, persist)
 * are tested once thoroughly in RouteSettingsStore as the representative.
 *
 * - UnitPreferenceStore (three-tier metric/imperial resolution)
 * - RouteSettingsStore (clamping logic, setter isolation, optimistic updates)
 * - SportPreferenceStore (sport API types, colors, validation)
 * - DashboardPreferencesStore (reorder algorithm, metric toggle, sport defaults)
 * - MapPreferencesContext (React Context, style resolution, batch updates)
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { eachCorruptPayloadRecovers } from '../__shared__/storeCorruptionHelper';

// UnitPreferenceStore
import {
  useUnitPreference,
  resolveIsMetric,
  getIntervalsUnitSystem,
  initializeUnitPreference,
} from '@/shared/app/UnitPreferenceStore';

// RouteSettingsStore
import {
  useRouteSettings,
  isRouteMatchingEnabled,
  initializeRouteSettings,
} from '@/features/routes/stores/RouteSettingsStore';

// SportPreferenceStore
import {
  useSportPreference,
  initializeSportPreference,
} from '@/features/fitness/stores/SportPreferenceStore';

// DashboardPreferencesStore
import {
  useDashboardPreferences,
  initializeDashboardPreferences,
  getMetricDefinition,
  AVAILABLE_METRICS,
  type MetricId,
  type SummaryCardPreferences,
  HERO_METRICS,
} from '@/features/home/store';

// MapPreferencesContext
import {
  MapPreferencesProvider,
  useMapPreferences,
} from '@/features/maps/stores/MapPreferencesContext';

// Storage keys
const UNIT_PREFERENCE_KEY = 'veloq-unit-preference';
const ROUTE_SETTINGS_KEY = 'veloq-route-settings';
const SPORT_PREFERENCE_KEY = 'veloq-primary-sport';
const SUMMARY_CARD_STORAGE_KEY = 'dashboard_summary_card';
const MAP_PREFS_KEY = 'veloq-map-preferences';

const DEFAULT_ROUTE_SETTINGS = {
  enabled: true,
};

const DEFAULT_SUMMARY_CARD: SummaryCardPreferences = {
  enabled: true,
  heroMetric: 'fitness',
  showSparkline: true,
  supportingMetrics: ['fitness', 'ftp', 'weekHours', 'weight'],
};

// ================================================================
// UnitPreferenceStore
// ================================================================

describe('UnitPreferenceStore', () => {
  beforeEach(async () => {
    useUnitPreference.setState({
      unitPreference: 'auto',
      intervalsPreferences: null,
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initialize()', () => {
    it('defaults to auto when nothing stored', async () => {
      await initializeUnitPreference();
      expect(useUnitPreference.getState().unitPreference).toBe('auto');
    });

    it('restores valid values from storage', async () => {
      await AsyncStorage.setItem(UNIT_PREFERENCE_KEY, 'imperial');
      await useUnitPreference.getState().initialize();
      expect(useUnitPreference.getState().unitPreference).toBe('imperial');
    });
  });

  describe('resolveIsMetric() - Three-tier fallback', () => {
    it('returns true for metric, false for imperial', async () => {
      await useUnitPreference.getState().setUnitPreference('metric');
      expect(resolveIsMetric()).toBe(true);

      await useUnitPreference.getState().setUnitPreference('imperial');
      expect(resolveIsMetric()).toBe(false);
    });

    it('uses intervals.icu preferences when auto', () => {
      useUnitPreference.setState({ unitPreference: 'auto' });
      useUnitPreference.getState().setIntervalsPreferences({
        measurementPreference: 'feet',
        fahrenheit: true,
        windSpeed: 'MPH',
      });
      expect(resolveIsMetric()).toBe(false);

      useUnitPreference.getState().setIntervalsPreferences({
        measurementPreference: 'meters',
        fahrenheit: false,
        windSpeed: 'KMH',
      });
      expect(resolveIsMetric()).toBe(true);
    });

    it('falls back to locale when auto + no profile', () => {
      useUnitPreference.setState({
        unitPreference: 'auto',
        intervalsPreferences: null,
      });
      expect(typeof resolveIsMetric()).toBe('boolean');
    });
  });

  describe('getIntervalsUnitSystem()', () => {
    it('returns the unit system, not display text', () => {
      expect(
        getIntervalsUnitSystem({
          measurementPreference: 'meters',
          fahrenheit: false,
          windSpeed: 'KMH',
        })
      ).toBe('metric');
      expect(
        getIntervalsUnitSystem({
          measurementPreference: 'feet',
          fahrenheit: true,
          windSpeed: 'MPH',
        })
      ).toBe('imperial');
      expect(getIntervalsUnitSystem(null)).toBeNull();
    });
  });
});

// ================================================================
// RouteSettingsStore - Most thorough (representative for persistence patterns)
// ================================================================

describe('RouteSettingsStore', () => {
  beforeEach(async () => {
    useRouteSettings.setState({
      settings: { ...DEFAULT_ROUTE_SETTINGS },
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initialize() - Corruption Recovery', () => {
    it('loads valid settings', async () => {
      await AsyncStorage.setItem(
        ROUTE_SETTINGS_KEY,
        JSON.stringify({
          enabled: false,
        })
      );
      await initializeRouteSettings();
      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false);
      expect(state.isLoaded).toBe(true);
    });

    // typeof [] === 'object', so the array case verifies the type guard rejects arrays too.
    it('falls back to defaults for invalid JSON, wrong types, and arrays', async () => {
      await eachCorruptPayloadRecovers(
        ROUTE_SETTINGS_KEY,
        initializeRouteSettings,
        ['not valid json', JSON.stringify({ enabled: 'not a boolean' }), '[1, 2, 3]'],
        () => {
          expect(useRouteSettings.getState().settings).toEqual(DEFAULT_ROUTE_SETTINGS);
          expect(
            (useRouteSettings.getState().settings as unknown as Record<string, unknown>)['0']
          ).toBeUndefined();
        }
      );
    });

    it('merges partial settings with defaults', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify({ enabled: false }));
      await initializeRouteSettings();
      expect(useRouteSettings.getState().settings.enabled).toBe(false);
    });

    it('drops the retired detectionStrictness key from a stored payload', async () => {
      await AsyncStorage.setItem(
        ROUTE_SETTINGS_KEY,
        JSON.stringify({
          enabled: true,
          autoCleanupEnabled: true,
          heatmapEnabled: true,
          detectionStrictness: 90,
        })
      );
      await initializeRouteSettings();
      expect(useRouteSettings.getState().settings).toEqual(DEFAULT_ROUTE_SETTINGS);

      await useRouteSettings.getState().setEnabled(false);
      const stored = JSON.parse((await AsyncStorage.getItem(ROUTE_SETTINGS_KEY))!);
      expect(stored).not.toHaveProperty('detectionStrictness');
      expect(stored).not.toHaveProperty('autoCleanupEnabled');
    });

    it('sets isLoaded even when AsyncStorage throws', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      await initializeRouteSettings();
      expect(useRouteSettings.getState().isLoaded).toBe(true);
    });
  });

  describe('Optimistic Updates', () => {
    it('state changes even if write fails', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Write failed'));
      useRouteSettings.setState({
        settings: { ...DEFAULT_ROUTE_SETTINGS },
        isLoaded: true,
      });

      await useRouteSettings.getState().setEnabled(false);
      expect(useRouteSettings.getState().settings.enabled).toBe(false);
    });
  });

  describe('Synchronous Helpers', () => {
    it('isRouteMatchingEnabled reflects state', () => {
      useRouteSettings.setState({
        settings: {
          enabled: false,
        },
        isLoaded: true,
      });
      expect(isRouteMatchingEnabled()).toBe(false);
    });

    it('helpers work before initialization', () => {
      useRouteSettings.setState({
        settings: DEFAULT_ROUTE_SETTINGS,
        isLoaded: false,
      });
      expect(isRouteMatchingEnabled()).toBe(true);
    });
  });
});

// ================================================================
// SportPreferenceStore
// ================================================================

describe('SportPreferenceStore', () => {
  beforeEach(async () => {
    useSportPreference.setState({ primarySport: 'Cycling', isLoaded: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initialize()', () => {
    it('rejects invalid sport - falls back to default', async () => {
      await AsyncStorage.setItem(SPORT_PREFERENCE_KEY, 'Skiing');
      await useSportPreference.getState().initialize();
      expect(useSportPreference.getState().primarySport).toBe('Cycling');
    });
  });

  describe('setPrimarySport()', () => {
    it('updates and persists', async () => {
      await useSportPreference.getState().setPrimarySport('Swimming');
      expect(useSportPreference.getState().primarySport).toBe('Swimming');
      expect(await AsyncStorage.getItem(SPORT_PREFERENCE_KEY)).toBe('Swimming');
    });
  });

  it('initializeSportPreference() delegates to store', async () => {
    await initializeSportPreference();
    expect(useSportPreference.getState().isLoaded).toBe(true);
  });
});

// ================================================================
// DashboardPreferencesStore
// ================================================================

describe('DashboardPreferencesStore', () => {
  beforeEach(async () => {
    useDashboardPreferences.setState({
      summaryCard: { ...DEFAULT_SUMMARY_CARD },
      isInitialized: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('getMetricDefinition()', () => {
    it('resolves every id in AVAILABLE_METRICS and rejects unknown ids', () => {
      for (const metric of AVAILABLE_METRICS) {
        expect(getMetricDefinition(metric.id)?.id).toBe(metric.id);
      }
      expect(getMetricDefinition('notAMetric' as MetricId)).toBeUndefined();
    });
  });

  describe('setSummaryCardPreferences()', () => {
    it('partial update preserves other fields', () => {
      const original = { ...useDashboardPreferences.getState().summaryCard };
      useDashboardPreferences.getState().setSummaryCardPreferences({ showSparkline: false });
      expect(useDashboardPreferences.getState().summaryCard.showSparkline).toBe(false);
      expect(useDashboardPreferences.getState().summaryCard.heroMetric).toBe(original.heroMetric);
    });
  });

  describe('initialization', () => {
    it('reads only the summary card key', async () => {
      await initializeDashboardPreferences();
      const reads = (AsyncStorage.getItem as jest.Mock).mock.calls.map(([key]) => key);
      expect(reads).not.toContain('dashboard_preferences');
      expect(reads).toContain(SUMMARY_CARD_STORAGE_KEY);
      expect(useDashboardPreferences.getState().isInitialized).toBe(true);
    });

    it('falls back to summary card defaults on a mismatched stored value', async () => {
      const payloads = [
        JSON.stringify({ heroMetric: 'notAMetric' }),
        JSON.stringify({ supportingMetrics: 'ftp' }),
        JSON.stringify({ enabled: 'yes' }),
        JSON.stringify(['fitness']),
        'not valid json',
      ];
      for (const payload of payloads) {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(SUMMARY_CARD_STORAGE_KEY, payload);
        useDashboardPreferences.setState({ isInitialized: false });
        await initializeDashboardPreferences();
        expect(useDashboardPreferences.getState().summaryCard).toEqual(DEFAULT_SUMMARY_CARD);
      }
    });

    it('keeps a stored summary card that matches the current shape', async () => {
      const stored: SummaryCardPreferences = {
        enabled: false,
        heroMetric: 'hrv',
        showSparkline: false,
        supportingMetrics: ['hrv', 'rhr'],
      };
      await AsyncStorage.setItem(SUMMARY_CARD_STORAGE_KEY, JSON.stringify(stored));
      await initializeDashboardPreferences();
      expect(useDashboardPreferences.getState().summaryCard).toEqual(stored);
    });
    it.each(['rhr', 'form', 'weekHours', 'weight'])(
      'rewrites a stored %s hero to fitness, keeps the rest, and persists it',
      async (hero) => {
        const supportingMetrics = ['hrv', 'rhr', 'ftp'];
        await AsyncStorage.setItem(
          SUMMARY_CARD_STORAGE_KEY,
          JSON.stringify({
            enabled: true,
            heroMetric: hero,
            showSparkline: false,
            supportingMetrics,
          })
        );
        useDashboardPreferences.setState({ isInitialized: false });
        await initializeDashboardPreferences();

        const expected = {
          enabled: true,
          heroMetric: 'fitness',
          showSparkline: false,
          supportingMetrics,
        };
        expect(useDashboardPreferences.getState().summaryCard).toEqual(expected);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const persisted = await AsyncStorage.getItem(SUMMARY_CARD_STORAGE_KEY);
        expect(JSON.parse(persisted!)).toEqual(expected);
      }
    );

    it('offers only the heroes the card can draw', () => {
      expect([...HERO_METRICS]).toEqual(['fitness', 'hrv']);
    });
  });
});

// ================================================================
// MapPreferencesContext
// ================================================================

const mapWrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(MapPreferencesProvider, null, children);

describe('MapPreferencesContext', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('throws when used outside provider', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useMapPreferences());
    }).toThrow('useMapPreferences must be used within a MapPreferencesProvider');
    consoleSpy.mockRestore();
  });

  describe('Style Resolution', () => {
    it('returns default when no override, override when set', async () => {
      const { result } = renderHook(() => useMapPreferences(), {
        wrapper: mapWrapper,
      });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      expect(result.current.getStyleForActivity('Ride')).toBe('light');

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride'], 'satellite');
      });
      expect(result.current.getStyleForActivity('Ride')).toBe('satellite');
      expect(result.current.getStyleForActivity('Run')).toBe('light');
    });

    it('removes override when style is null', async () => {
      await AsyncStorage.setItem(
        MAP_PREFS_KEY,
        JSON.stringify({
          defaultStyle: 'light',
          activityTypeStyles: { Ride: 'dark' },
        })
      );
      const { result } = renderHook(() => useMapPreferences(), {
        wrapper: mapWrapper,
      });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride'], null);
      });
      expect(result.current.getStyleForActivity('Ride')).toBe('light');
    });
  });

  describe('setDefaultStyle()', () => {
    it('updates default without affecting overrides', async () => {
      const { result } = renderHook(() => useMapPreferences(), {
        wrapper: mapWrapper,
      });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride'], 'dark');
      });
      await act(async () => {
        await result.current.setDefaultStyle('satellite');
      });

      expect(result.current.getStyleForActivity('Ride')).toBe('dark');
      expect(result.current.preferences.defaultStyle).toBe('satellite');
    });
  });

  describe('setActivityGroupStyle() - Batch Updates', () => {
    it('updates multiple activity types at once', async () => {
      const { result } = renderHook(() => useMapPreferences(), {
        wrapper: mapWrapper,
      });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'VirtualRide', 'GravelRide'], 'dark');
      });
      expect(result.current.preferences.activityTypeStyles.Ride).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.VirtualRide).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.GravelRide).toBe('dark');
    });

    it('removes multiple overrides when null', async () => {
      const { result } = renderHook(() => useMapPreferences(), {
        wrapper: mapWrapper,
      });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'Run', 'Swim'], 'dark');
      });
      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'Run'], null);
      });

      expect(result.current.preferences.activityTypeStyles.Ride).toBeUndefined();
      expect(result.current.preferences.activityTypeStyles.Run).toBeUndefined();
      expect(result.current.preferences.activityTypeStyles.Swim).toBe('dark');
    });
  });

  describe('Persistence Validation', () => {
    it('rejects invalid JSON and uses defaults', async () => {
      await AsyncStorage.setItem(MAP_PREFS_KEY, 'not valid json');
      const { result } = renderHook(() => useMapPreferences(), {
        wrapper: mapWrapper,
      });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));
      expect(result.current.preferences.defaultStyle).toBe('light');
    });

    it('handles AsyncStorage read failure', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      const { result } = renderHook(() => useMapPreferences(), {
        wrapper: mapWrapper,
      });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));
      expect(result.current.preferences.defaultStyle).toBe('light');
    });
  });
});
