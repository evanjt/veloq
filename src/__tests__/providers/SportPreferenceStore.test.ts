/**
 * SportPreferenceStore Tests
 *
 * Focus: Primary sport selection and API type mapping
 * - Initialize with validation against allowed values
 * - setPrimarySport persists
 * - SPORT_API_TYPES and SPORT_COLORS constants
 * - getPrimarySport synchronous helper
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useSportPreference,
  SPORT_API_TYPES,
  SPORT_COLORS,
  getPrimarySport,
  initializeSportPreference,
} from '@/providers/SportPreferenceStore';
import type { PrimarySport } from '@/providers/SportPreferenceStore';

const SPORT_PREFERENCE_KEY = 'veloq-primary-sport';

describe('SportPreferenceStore', () => {
  beforeEach(async () => {
    useSportPreference.setState({
      primarySport: 'Cycling',
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // CONSTANTS
  // ============================================================

  describe('constants', () => {
    it('SPORT_API_TYPES covers all primary sports', () => {
      const sports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];
      sports.forEach((sport) => {
        expect(SPORT_API_TYPES[sport]).toBeDefined();
        expect(SPORT_API_TYPES[sport].length).toBeGreaterThan(0);
      });
    });

    it('SPORT_API_TYPES includes virtual variants for cycling', () => {
      expect(SPORT_API_TYPES.Cycling).toContain('Ride');
      expect(SPORT_API_TYPES.Cycling).toContain('VirtualRide');
    });

    it('SPORT_API_TYPES includes trail variant for running', () => {
      expect(SPORT_API_TYPES.Running).toContain('Run');
      expect(SPORT_API_TYPES.Running).toContain('TrailRun');
    });

    it('SPORT_COLORS has valid hex colors for all sports', () => {
      const sports: PrimarySport[] = ['Cycling', 'Running', 'Swimming'];
      sports.forEach((sport) => {
        expect(SPORT_COLORS[sport]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  describe('initialize()', () => {
    it('sets isLoaded when no stored data (defaults to Cycling)', async () => {
      await useSportPreference.getState().initialize();
      expect(useSportPreference.getState().isLoaded).toBe(true);
      expect(useSportPreference.getState().primarySport).toBe('Cycling');
    });

    it('restores valid sport from storage', async () => {
      await AsyncStorage.setItem(SPORT_PREFERENCE_KEY, 'Running');
      await useSportPreference.getState().initialize();
      expect(useSportPreference.getState().primarySport).toBe('Running');
    });

    it('restores Swimming from storage', async () => {
      await AsyncStorage.setItem(SPORT_PREFERENCE_KEY, 'Swimming');
      await useSportPreference.getState().initialize();
      expect(useSportPreference.getState().primarySport).toBe('Swimming');
    });

    it('rejects invalid sport value — falls back to default', async () => {
      await AsyncStorage.setItem(SPORT_PREFERENCE_KEY, 'Skiing');
      await useSportPreference.getState().initialize();
      expect(useSportPreference.getState().isLoaded).toBe(true);
      expect(useSportPreference.getState().primarySport).toBe('Cycling');
    });

    it('rejects empty string', async () => {
      await AsyncStorage.setItem(SPORT_PREFERENCE_KEY, '');
      await useSportPreference.getState().initialize();
      expect(useSportPreference.getState().primarySport).toBe('Cycling');
    });
  });

  // ============================================================
  // SET PRIMARY SPORT
  // ============================================================

  describe('setPrimarySport()', () => {
    it('updates to Running', async () => {
      await useSportPreference.getState().setPrimarySport('Running');
      expect(useSportPreference.getState().primarySport).toBe('Running');
    });

    it('persists to AsyncStorage', async () => {
      await useSportPreference.getState().setPrimarySport('Swimming');
      const stored = await AsyncStorage.getItem(SPORT_PREFERENCE_KEY);
      expect(stored).toBe('Swimming');
    });
  });

  // ============================================================
  // SYNCHRONOUS HELPERS
  // ============================================================

  describe('getPrimarySport()', () => {
    it('returns current sport', async () => {
      await useSportPreference.getState().setPrimarySport('Running');
      expect(getPrimarySport()).toBe('Running');
    });

    it('returns default before initialization', () => {
      expect(getPrimarySport()).toBe('Cycling');
    });
  });

  describe('initializeSportPreference()', () => {
    it('delegates to store initialize', async () => {
      await initializeSportPreference();
      expect(useSportPreference.getState().isLoaded).toBe(true);
    });
  });
});
