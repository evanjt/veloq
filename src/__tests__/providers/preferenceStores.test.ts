/**
 * Preference Stores Tests
 *
 * Consolidated tests for 7 preference-related stores.
 * Each section tests unique behaviors; shared patterns (init, corrupt JSON, persist)
 * are tested once thoroughly in RouteSettingsStore as the representative.
 *
 * - ThemeProvider (getThemePreference with fallback)
 * - UnitPreferenceStore (three-tier metric/imperial resolution)
 * - RouteSettingsStore (clamping logic, setter isolation, optimistic updates)
 * - SportPreferenceStore (sport API types, colors, validation)
 * - DashboardPreferencesStore (reorder algorithm, metric toggle, sport defaults)
 * - HRZonesStore (zone thresholds, schema validation)
 * - MapPreferencesContext (React Context, style resolution, batch updates)
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// UnitPreferenceStore
import {
  useUnitPreference,
  resolveIsMetric,
  getIntervalsPreferenceLabel,
  initializeUnitPreference,
} from '@/providers/UnitPreferenceStore';

// RouteSettingsStore
import {
  useRouteSettings,
  isRouteMatchingEnabled,
  getRetentionDays,
  initializeRouteSettings,
} from '@/providers/RouteSettingsStore';

// SportPreferenceStore
import {
  useSportPreference,
  SPORT_API_TYPES,
  SPORT_COLORS,
  getPrimarySport,
  initializeSportPreference,
} from '@/providers/SportPreferenceStore';
import type { PrimarySport } from '@/providers/SportPreferenceStore';

// DashboardPreferencesStore
import {
  useDashboardPreferences,
  initializeDashboardPreferences,
  getMetricDefinition,
  getMetricsForSport,
  AVAILABLE_METRICS,
  type MetricId,
  type MetricPreference,
  type SummaryCardPreferences,
} from '@/providers/DashboardPreferencesStore';

// HRZonesStore
import { useHRZones, DEFAULT_HR_ZONES, initializeHRZones } from '@/providers/HRZonesStore';

// MapPreferencesContext
import { MapPreferencesProvider, useMapPreferences } from '@/providers/MapPreferencesContext';

// Storage keys
const UNIT_PREFERENCE_KEY = 'veloq-unit-preference';
const ROUTE_SETTINGS_KEY = 'veloq-route-settings';
const SPORT_PREFERENCE_KEY = 'veloq-primary-sport';
const DASHBOARD_STORAGE_KEY = 'dashboard_preferences';
const SUMMARY_CARD_STORAGE_KEY = 'dashboard_summary_card';
const HR_ZONES_KEY = 'veloq-hr-zones';
const MAP_PREFS_KEY = 'veloq-map-preferences';

const DEFAULT_ROUTE_SETTINGS = {
  enabled: true,
  retentionDays: 0,
  autoCleanupEnabled: false,
  geocodingEnabled: false,
  heatmapEnabled: true,
  detectionStrictness: 60,
};

const DEFAULT_SUMMARY_CARD: SummaryCardPreferences = {
  enabled: true,
  heroMetric: 'fitness',
  showSparkline: true,
  supportingMetrics: ['fitness', 'ftp', 'weekHours', 'weight'],
};

function createFreshCyclingDefaults(): MetricPreference[] {
  const defaultIds: MetricId[] = ['fitness', 'ftp', 'weekHours', 'weight'];
  return AVAILABLE_METRICS.map((metric, index) => ({
    id: metric.id,
    enabled: defaultIds.includes(metric.id),
    order: defaultIds.includes(metric.id) ? defaultIds.indexOf(metric.id) : index + 100,
  }));
}

// ================================================================
// ThemeProvider
// ================================================================

describe('ThemeProvider', () => {
  let getThemePreference: () => Promise<string>;
  const THEME_KEY = 'veloq-theme-preference';

  beforeAll(() => {
    jest.doMock('react-native', () => ({
      Appearance: { setColorScheme: jest.fn() },
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tp = require('@/providers/ThemeProvider');
    getThemePreference = tp.getThemePreference;
  });

  afterAll(() => {
    jest.dontMock('react-native');
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('returns "system" when nothing stored', async () => {
    expect(await getThemePreference()).toBe('system');
  });

  it('returns stored valid values', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'light');
    expect(await getThemePreference()).toBe('light');

    await AsyncStorage.setItem(THEME_KEY, 'dark');
    expect(await getThemePreference()).toBe('dark');
  });
});

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
      useUnitPreference.setState({ unitPreference: 'auto', intervalsPreferences: null });
      expect(typeof resolveIsMetric()).toBe('boolean');
    });
  });

  describe('getIntervalsPreferenceLabel()', () => {
    it('returns correct labels', () => {
      expect(
        getIntervalsPreferenceLabel({
          measurementPreference: 'meters',
          fahrenheit: false,
          windSpeed: 'KMH',
        })
      ).toBe('Metric');
      expect(
        getIntervalsPreferenceLabel({
          measurementPreference: 'feet',
          fahrenheit: true,
          windSpeed: 'MPH',
        })
      ).toBe('Imperial');
      expect(getIntervalsPreferenceLabel(null)).toBeNull();
    });
  });
});

// ================================================================
// RouteSettingsStore — Most thorough (representative for persistence patterns)
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

  describe('setRetentionDays() - Clamping Logic', () => {
    it('preserves 0 as special "keep all" value', async () => {
      await useRouteSettings.getState().setRetentionDays(0);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(0);
    });

    it('clamps values below 30 to minimum of 30', async () => {
      for (const val of [1, 15, 29, -1, -100]) {
        await useRouteSettings.getState().setRetentionDays(val);
        expect(useRouteSettings.getState().settings.retentionDays).toBe(30);
      }
    });

    it('clamps values above 365 to maximum of 365', async () => {
      for (const val of [366, 500, 1000]) {
        await useRouteSettings.getState().setRetentionDays(val);
        expect(useRouteSettings.getState().settings.retentionDays).toBe(365);
      }
    });

    it('passes through valid range values unchanged', async () => {
      for (const val of [30, 60, 90, 180, 270, 365]) {
        await useRouteSettings.getState().setRetentionDays(val);
        expect(useRouteSettings.getState().settings.retentionDays).toBe(val);
      }
    });

    it('persists validated (clamped) value', async () => {
      await useRouteSettings.getState().setRetentionDays(15);
      const stored = JSON.parse((await AsyncStorage.getItem(ROUTE_SETTINGS_KEY))!);
      expect(stored.retentionDays).toBe(30);
    });
  });

  describe('initialize() - Corruption Recovery', () => {
    it('loads valid settings', async () => {
      await AsyncStorage.setItem(
        ROUTE_SETTINGS_KEY,
        JSON.stringify({ enabled: false, retentionDays: 90, autoCleanupEnabled: true })
      );
      await initializeRouteSettings();
      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false);
      expect(state.settings.retentionDays).toBe(90);
      expect(state.isLoaded).toBe(true);
    });

    it('recovers from invalid JSON', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, 'not valid json');
      await initializeRouteSettings();
      expect(useRouteSettings.getState().settings).toEqual(DEFAULT_ROUTE_SETTINGS);
    });

    it('recovers from wrong types', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify({ enabled: 'not a boolean' }));
      await initializeRouteSettings();
      expect(useRouteSettings.getState().settings).toEqual(DEFAULT_ROUTE_SETTINGS);
    });

    it('merges partial settings with defaults', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify({ enabled: false }));
      await initializeRouteSettings();
      expect(useRouteSettings.getState().settings.enabled).toBe(false);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(0);
    });

    it('sets isLoaded even when AsyncStorage throws', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      await initializeRouteSettings();
      expect(useRouteSettings.getState().isLoaded).toBe(true);
    });
  });

  describe('Setter Isolation', () => {
    it('each setter only affects its own field', async () => {
      useRouteSettings.setState({
        settings: {
          enabled: true,
          retentionDays: 90,
          autoCleanupEnabled: true,
          geocodingEnabled: true,
          heatmapEnabled: true,
          detectionStrictness: 60,
        },
        isLoaded: true,
      });

      await useRouteSettings.getState().setEnabled(false);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(90);
      expect(useRouteSettings.getState().settings.autoCleanupEnabled).toBe(true);

      await useRouteSettings.getState().setRetentionDays(180);
      expect(useRouteSettings.getState().settings.enabled).toBe(false);
      expect(useRouteSettings.getState().settings.autoCleanupEnabled).toBe(true);
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

  describe('Concurrent Operations', () => {
    it('parallel updates preserve all changes', async () => {
      const store = useRouteSettings.getState();
      await Promise.all([
        store.setEnabled(false),
        store.setRetentionDays(90),
        store.setAutoCleanupEnabled(true),
      ]);
      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false);
      expect(state.settings.retentionDays).toBe(90);
      expect(state.settings.autoCleanupEnabled).toBe(true);
    });
  });

  describe('Type Guard Edge Cases', () => {
    /**
     * BUG: Type guard doesn't reject arrays
     *
     * `typeof [] === 'object'` is true, so arrays pass the type guard.
     */
    it('should reject array values and use defaults', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, '[1, 2, 3]');
      await initializeRouteSettings();
      expect(useRouteSettings.getState().settings).toEqual(DEFAULT_ROUTE_SETTINGS);
      expect(
        (useRouteSettings.getState().settings as unknown as Record<string, unknown>)['0']
      ).toBeUndefined();
    });
  });

  describe('Synchronous Helpers', () => {
    it('isRouteMatchingEnabled and getRetentionDays reflect state', () => {
      useRouteSettings.setState({
        settings: {
          enabled: false,
          retentionDays: 180,
          autoCleanupEnabled: false,
          geocodingEnabled: true,
          heatmapEnabled: true,
          detectionStrictness: 60,
        },
        isLoaded: true,
      });
      expect(isRouteMatchingEnabled()).toBe(false);
      expect(getRetentionDays()).toBe(180);
    });

    it('helpers work before initialization', () => {
      useRouteSettings.setState({
        settings: DEFAULT_ROUTE_SETTINGS,
        isLoaded: false,
      });
      expect(isRouteMatchingEnabled()).toBe(true);
      expect(getRetentionDays()).toBe(0);
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

  describe('constants', () => {
    it('SPORT_API_TYPES covers all sports with variants', () => {
      expect(SPORT_API_TYPES.Cycling).toContain('Ride');
      expect(SPORT_API_TYPES.Cycling).toContain('VirtualRide');
      expect(SPORT_API_TYPES.Running).toContain('Run');
      expect(SPORT_API_TYPES.Running).toContain('TrailRun');
    });
  });

  describe('initialize()', () => {
    it('rejects invalid sport — falls back to default', async () => {
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

  it('getPrimarySport() returns current sport', () => {
    expect(getPrimarySport()).toBe('Cycling');
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
      metrics: createFreshCyclingDefaults(),
      summaryCard: { ...DEFAULT_SUMMARY_CARD },
      isInitialized: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('reorderMetrics() - Bounds Checking', () => {
    it('reorders correctly and produces sequential order values', () => {
      useDashboardPreferences.getState().reorderMetrics(0, 3);
      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      enabled.forEach((metric, index) => {
        expect(metric.order).toBe(index);
      });
    });

    it('same index is a no-op', () => {
      const before = useDashboardPreferences
        .getState()
        .getEnabledMetrics()
        .map((m) => m.id);
      useDashboardPreferences.getState().reorderMetrics(1, 1);
      const after = useDashboardPreferences
        .getState()
        .getEnabledMetrics()
        .map((m) => m.id);
      expect(after).toEqual(before);
    });

    it('disabled metrics retain high order values after reorder', () => {
      useDashboardPreferences.getState().reorderMetrics(0, 2);
      const { metrics } = useDashboardPreferences.getState();
      const disabledMetrics = metrics.filter((m) => !m.enabled);
      disabledMetrics.forEach((m) => {
        expect(m.order).toBeGreaterThanOrEqual(100);
      });
    });
  });

  describe('setMetricEnabled() - State Consistency', () => {
    it('disabling removes from enabled, re-enabling adds back', () => {
      useDashboardPreferences.getState().setMetricEnabled('ftp', false);
      expect(
        useDashboardPreferences
          .getState()
          .getEnabledMetrics()
          .map((m) => m.id)
      ).not.toContain('ftp');

      useDashboardPreferences.getState().setMetricEnabled('ftp', true);
      expect(
        useDashboardPreferences
          .getState()
          .getEnabledMetrics()
          .map((m) => m.id)
      ).toContain('ftp');
    });

    /**
     * BUG: disable → reorder → re-enable produces duplicate order values
     */
    it('disable → reorder → re-enable produces sequential order values', () => {
      useDashboardPreferences.getState().setMetricEnabled('ftp', false);
      useDashboardPreferences.getState().reorderMetrics(0, 2);
      useDashboardPreferences.getState().setMetricEnabled('ftp', true);

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const orders = enabled.map((m) => m.order).sort((a, b) => a - b);
      orders.forEach((order, index) => {
        expect(order).toBe(index);
      });
    });
  });

  describe('resetToDefaults() - Sport Handling', () => {
    it('Cycling enables FTP, Running enables thresholdPace, Swimming enables css', () => {
      useDashboardPreferences.getState().resetToDefaults('Cycling');
      expect(
        useDashboardPreferences
          .getState()
          .getEnabledMetrics()
          .map((m) => m.id)
      ).toContain('ftp');

      useDashboardPreferences.getState().resetToDefaults('Running');
      expect(
        useDashboardPreferences
          .getState()
          .getEnabledMetrics()
          .map((m) => m.id)
      ).toContain('thresholdPace');

      useDashboardPreferences.getState().resetToDefaults('Swimming');
      expect(
        useDashboardPreferences
          .getState()
          .getEnabledMetrics()
          .map((m) => m.id)
      ).toContain('css');
    });

    it('unknown sport falls back to Other defaults', () => {
      useDashboardPreferences.getState().resetToDefaults('UnknownSport');
      const ids = useDashboardPreferences
        .getState()
        .getEnabledMetrics()
        .map((m) => m.id);
      expect(ids).toContain('hrv');
      expect(ids).not.toContain('ftp');
    });

    it('reset after custom reorder restores default order', () => {
      useDashboardPreferences.getState().reorderMetrics(0, 3);
      useDashboardPreferences.getState().resetToDefaults('Cycling');

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      expect(enabled[0].id).toBe('fitness');
      expect(enabled[1].id).toBe('ftp');
      expect(enabled[2].id).toBe('weekHours');
      expect(enabled[3].id).toBe('weight');
    });
  });

  describe('setSummaryCardPreferences() - Validation', () => {
    /**
     * BUG: No validation on heroMetric — invalid IDs accepted and stored.
     */
    it('accepts invalid heroMetric without validation (BUG)', () => {
      useDashboardPreferences
        .getState()
        .setSummaryCardPreferences({ heroMetric: 'invalid' as MetricId });
      expect(useDashboardPreferences.getState().summaryCard.heroMetric).toBe('invalid');
      expect(getMetricDefinition('invalid' as MetricId)).toBeUndefined();
    });

    it('partial update preserves other fields', () => {
      const original = { ...useDashboardPreferences.getState().summaryCard };
      useDashboardPreferences.getState().setSummaryCardPreferences({ showSparkline: false });
      expect(useDashboardPreferences.getState().summaryCard.showSparkline).toBe(false);
      expect(useDashboardPreferences.getState().summaryCard.heroMetric).toBe(original.heroMetric);
    });
  });

  describe('initialization', () => {
    it('recovers from invalid JSON', async () => {
      await AsyncStorage.setItem(DASHBOARD_STORAGE_KEY, 'not valid json');
      await initializeDashboardPreferences('Cycling');
      expect(useDashboardPreferences.getState().isInitialized).toBe(true);
    });

    it('uses sport-specific defaults when no stored preferences', async () => {
      await initializeDashboardPreferences('Running');
      expect(
        useDashboardPreferences
          .getState()
          .getEnabledMetrics()
          .map((m) => m.id)
      ).toContain('thresholdPace');
    });
  });

  describe('getMetricsForSport()', () => {
    it('excludes sport-specific metrics for wrong sport', () => {
      const filtered = getMetricsForSport(createFreshCyclingDefaults(), 'Running');
      const ids = filtered.map((m) => m.id);
      expect(ids).not.toContain('ftp');
      expect(ids).toContain('thresholdPace');
    });

    it('includes non-sport-specific metrics for any sport', () => {
      const filtered = getMetricsForSport(createFreshCyclingDefaults(), 'Cycling');
      const ids = filtered.map((m) => m.id);
      expect(ids).toContain('hrv');
      expect(ids).toContain('rhr');
    });
  });
});

// ================================================================
// HRZonesStore
// ================================================================

describe('HRZonesStore', () => {
  beforeEach(async () => {
    useHRZones.setState({ maxHR: 190, zones: DEFAULT_HR_ZONES, isLoaded: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('defaults', () => {
    it('starts with 5 zones covering 50%-100%, sequential IDs', () => {
      const zones = useHRZones.getState().zones;
      expect(zones).toHaveLength(5);
      expect(zones[0].min).toBe(0.5);
      expect(zones[zones.length - 1].max).toBe(1.0);
      zones.forEach((z, i) => expect(z.id).toBe(i + 1));
    });
  });

  describe('initialize()', () => {
    it('handles corrupt JSON and invalid schema', async () => {
      await AsyncStorage.setItem(HR_ZONES_KEY, 'not json');
      await useHRZones.getState().initialize();
      expect(useHRZones.getState().maxHR).toBe(190);

      await AsyncStorage.setItem(HR_ZONES_KEY, JSON.stringify({ zones: [] }));
      useHRZones.setState({ isLoaded: false });
      await useHRZones.getState().initialize();
      expect(useHRZones.getState().maxHR).toBe(190);
    });
  });

  describe('setMaxHR()', () => {
    it('updates and persists without altering zones', async () => {
      const zonesBefore = useHRZones.getState().zones;
      await useHRZones.getState().setMaxHR(200);
      expect(useHRZones.getState().maxHR).toBe(200);
      expect(useHRZones.getState().zones).toEqual(zonesBefore);
      const stored = JSON.parse((await AsyncStorage.getItem(HR_ZONES_KEY))!);
      expect(stored.maxHR).toBe(200);
    });
  });

  describe('setZoneThreshold()', () => {
    it('updates specific zone without modifying others', async () => {
      const zone2Before = { ...useHRZones.getState().zones[1] };
      await useHRZones.getState().setZoneThreshold(1, 0.4, 0.55);
      expect(useHRZones.getState().zones[0].min).toBe(0.4);
      expect(useHRZones.getState().zones[1]).toEqual(zone2Before);
    });
  });

  describe('resetToDefaults()', () => {
    it('restores and clears storage', async () => {
      await useHRZones.getState().setMaxHR(200);
      await useHRZones.getState().resetToDefaults();
      expect(useHRZones.getState().maxHR).toBe(190);
      expect(useHRZones.getState().zones).toEqual(DEFAULT_HR_ZONES);
      expect(await AsyncStorage.getItem(HR_ZONES_KEY)).toBeNull();
    });
  });

  it('[BUG] rejects HR zone data where a non-first zone is corrupted', async () => {
    // The current validation only checks the first zone - other corrupted zones slip through
    // This test documents the bug - if the validation is already fixed, this will pass
    const validZone = { id: 1, name: 'Recovery', min: 0.5, max: 0.6, color: '#94A3B8' };
    const badZones = [validZone, validZone, { id: 3 }]; // missing min/max on third zone
    await AsyncStorage.setItem(HR_ZONES_KEY, JSON.stringify({ maxHR: 190, zones: badZones }));
    await initializeHRZones();
    expect(useHRZones.getState().zones).toEqual(DEFAULT_HR_ZONES); // should fall back to defaults
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
      const { result } = renderHook(() => useMapPreferences(), { wrapper: mapWrapper });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      expect(result.current.getStyleForActivity('Ride')).toBe('light');

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', 'satellite');
      });
      expect(result.current.getStyleForActivity('Ride')).toBe('satellite');
      expect(result.current.getStyleForActivity('Run')).toBe('light');
    });

    it('removes override when style is null', async () => {
      await AsyncStorage.setItem(
        MAP_PREFS_KEY,
        JSON.stringify({ defaultStyle: 'light', activityTypeStyles: { Ride: 'dark' } })
      );
      const { result } = renderHook(() => useMapPreferences(), { wrapper: mapWrapper });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', null);
      });
      expect(result.current.getStyleForActivity('Ride')).toBe('light');
    });
  });

  describe('setDefaultStyle()', () => {
    it('updates default without affecting overrides', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper: mapWrapper });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', 'dark');
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
      const { result } = renderHook(() => useMapPreferences(), { wrapper: mapWrapper });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'VirtualRide', 'GravelRide'], 'dark');
      });
      expect(result.current.preferences.activityTypeStyles.Ride).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.VirtualRide).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.GravelRide).toBe('dark');
    });

    it('removes multiple overrides when null', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper: mapWrapper });
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
      const { result } = renderHook(() => useMapPreferences(), { wrapper: mapWrapper });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));
      expect(result.current.preferences.defaultStyle).toBe('light');
    });

    it('handles AsyncStorage read failure', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      const { result } = renderHook(() => useMapPreferences(), { wrapper: mapWrapper });
      await waitFor(() => expect(result.current.isLoaded).toBe(true));
      expect(result.current.preferences.defaultStyle).toBe('light');
    });
  });
});
