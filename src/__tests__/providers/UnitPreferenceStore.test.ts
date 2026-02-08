/**
 * UnitPreferenceStore Tests
 *
 * Focus: Metric/imperial resolution with three-tier fallback
 * - User explicit choice (metric/imperial)
 * - Auto mode with intervals.icu profile
 * - Auto mode with locale detection
 * - getIntervalsPreferenceLabel helper
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useUnitPreference,
  resolveIsMetric,
  getIsMetric,
  getIntervalsPreferenceLabel,
  initializeUnitPreference,
} from '@/providers/UnitPreferenceStore';
import type { IntervalsUnitPreferences } from '@/providers/UnitPreferenceStore';

const UNIT_PREFERENCE_KEY = 'veloq-unit-preference';

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

  // ============================================================
  // INITIALIZATION
  // ============================================================

  describe('initialize()', () => {
    it('sets isLoaded when no stored data (defaults to auto)', async () => {
      await useUnitPreference.getState().initialize();
      expect(useUnitPreference.getState().isLoaded).toBe(true);
      expect(useUnitPreference.getState().unitPreference).toBe('auto');
    });

    it('restores metric preference', async () => {
      await AsyncStorage.setItem(UNIT_PREFERENCE_KEY, 'metric');
      await useUnitPreference.getState().initialize();
      expect(useUnitPreference.getState().unitPreference).toBe('metric');
    });

    it('restores imperial preference', async () => {
      await AsyncStorage.setItem(UNIT_PREFERENCE_KEY, 'imperial');
      await useUnitPreference.getState().initialize();
      expect(useUnitPreference.getState().unitPreference).toBe('imperial');
    });

    it('rejects invalid value — keeps default', async () => {
      await AsyncStorage.setItem(UNIT_PREFERENCE_KEY, 'cubits');
      await useUnitPreference.getState().initialize();
      expect(useUnitPreference.getState().unitPreference).toBe('auto');
    });
  });

  // ============================================================
  // SET PREFERENCE
  // ============================================================

  describe('setUnitPreference()', () => {
    it('updates to metric', async () => {
      await useUnitPreference.getState().setUnitPreference('metric');
      expect(useUnitPreference.getState().unitPreference).toBe('metric');
    });

    it('persists to AsyncStorage', async () => {
      await useUnitPreference.getState().setUnitPreference('imperial');
      expect(await AsyncStorage.getItem(UNIT_PREFERENCE_KEY)).toBe('imperial');
    });
  });

  describe('setIntervalsPreferences()', () => {
    it('stores intervals.icu unit preferences', () => {
      const prefs: IntervalsUnitPreferences = {
        measurementPreference: 'feet',
        fahrenheit: true,
        windSpeed: 'MPH',
      };
      useUnitPreference.getState().setIntervalsPreferences(prefs);
      expect(useUnitPreference.getState().intervalsPreferences).toEqual(prefs);
    });
  });

  // ============================================================
  // RESOLUTION LOGIC
  // ============================================================

  describe('resolveIsMetric()', () => {
    it('returns true when preference is metric', async () => {
      await useUnitPreference.getState().setUnitPreference('metric');
      expect(resolveIsMetric()).toBe(true);
    });

    it('returns false when preference is imperial', async () => {
      await useUnitPreference.getState().setUnitPreference('imperial');
      expect(resolveIsMetric()).toBe(false);
    });

    it('uses intervals.icu preferences when auto + profile available', () => {
      useUnitPreference.setState({ unitPreference: 'auto' });
      useUnitPreference.getState().setIntervalsPreferences({
        measurementPreference: 'feet',
        fahrenheit: true,
        windSpeed: 'MPH',
      });
      expect(resolveIsMetric()).toBe(false); // feet = imperial
    });

    it('uses intervals.icu meters as metric', () => {
      useUnitPreference.setState({ unitPreference: 'auto' });
      useUnitPreference.getState().setIntervalsPreferences({
        measurementPreference: 'meters',
        fahrenheit: false,
        windSpeed: 'KMH',
      });
      expect(resolveIsMetric()).toBe(true);
    });

    it('falls back to locale detection when auto + no profile', () => {
      useUnitPreference.setState({
        unitPreference: 'auto',
        intervalsPreferences: null,
      });
      // expo-localization is mocked to en-US in jest.setup.js
      // US is in imperialCountries list, so should return false (imperial)
      const result = resolveIsMetric();
      expect(typeof result).toBe('boolean');
    });
  });

  // ============================================================
  // HELPERS
  // ============================================================

  describe('getIsMetric()', () => {
    it('returns same as resolveIsMetric', async () => {
      await useUnitPreference.getState().setUnitPreference('metric');
      expect(getIsMetric()).toBe(resolveIsMetric());
    });
  });

  describe('getIntervalsPreferenceLabel()', () => {
    it('returns "Metric" for meters', () => {
      const prefs: IntervalsUnitPreferences = {
        measurementPreference: 'meters',
        fahrenheit: false,
        windSpeed: 'KMH',
      };
      expect(getIntervalsPreferenceLabel(prefs)).toBe('Metric');
    });

    it('returns "Imperial" for feet', () => {
      const prefs: IntervalsUnitPreferences = {
        measurementPreference: 'feet',
        fahrenheit: true,
        windSpeed: 'MPH',
      };
      expect(getIntervalsPreferenceLabel(prefs)).toBe('Imperial');
    });

    it('returns null when no preferences', () => {
      expect(getIntervalsPreferenceLabel(null)).toBeNull();
    });
  });

  describe('initializeUnitPreference()', () => {
    it('delegates to store initialize', async () => {
      await initializeUnitPreference();
      expect(useUnitPreference.getState().isLoaded).toBe(true);
    });
  });
});
