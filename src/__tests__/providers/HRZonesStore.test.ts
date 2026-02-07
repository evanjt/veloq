/**
 * HRZonesStore Tests
 *
 * Focus: HR zone customization and persistence
 * - Initialize from storage with schema validation
 * - setMaxHR persists alongside zones
 * - setZoneThreshold updates individual zone
 * - resetToDefaults clears storage
 * - Corrupt data recovery
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useHRZones,
  DEFAULT_HR_ZONES,
  getHRZones,
  initializeHRZones,
} from '@/providers/HRZonesStore';

const HR_ZONES_KEY = 'veloq-hr-zones';

describe('HRZonesStore', () => {
  beforeEach(async () => {
    useHRZones.setState({
      maxHR: 190,
      zones: DEFAULT_HR_ZONES,
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // DEFAULT STATE
  // ============================================================

  describe('defaults', () => {
    it('starts with maxHR 190', () => {
      expect(useHRZones.getState().maxHR).toBe(190);
    });

    it('starts with 5 default zones', () => {
      expect(useHRZones.getState().zones).toHaveLength(5);
    });

    it('default zones cover 50%-100% of max HR', () => {
      const zones = useHRZones.getState().zones;
      expect(zones[0].min).toBe(0.5);
      expect(zones[zones.length - 1].max).toBe(1.0);
    });

    it('default zones have sequential IDs 1-5', () => {
      const zones = useHRZones.getState().zones;
      zones.forEach((z, i) => {
        expect(z.id).toBe(i + 1);
      });
    });

    it('default zones have names and colors', () => {
      const zones = useHRZones.getState().zones;
      zones.forEach((z) => {
        expect(z.name).toBeTruthy();
        expect(z.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await useHRZones.getState().initialize();
      expect(useHRZones.getState().isLoaded).toBe(true);
      expect(useHRZones.getState().maxHR).toBe(190); // Keeps default
    });

    it('restores settings from storage', async () => {
      const stored = {
        maxHR: 185,
        zones: DEFAULT_HR_ZONES.map((z) => ({ ...z })),
      };
      stored.zones[0] = { ...stored.zones[0], min: 0.45, max: 0.55 };
      await AsyncStorage.setItem(HR_ZONES_KEY, JSON.stringify(stored));

      await useHRZones.getState().initialize();
      const state = useHRZones.getState();
      expect(state.maxHR).toBe(185);
      expect(state.zones[0].min).toBe(0.45);
      expect(state.isLoaded).toBe(true);
    });

    it('handles corrupt JSON gracefully', async () => {
      await AsyncStorage.setItem(HR_ZONES_KEY, 'not json');
      await useHRZones.getState().initialize();
      expect(useHRZones.getState().isLoaded).toBe(true);
      expect(useHRZones.getState().maxHR).toBe(190); // Falls back to default
    });

    it('handles invalid schema (missing maxHR)', async () => {
      await AsyncStorage.setItem(HR_ZONES_KEY, JSON.stringify({ zones: [] }));
      await useHRZones.getState().initialize();
      // safeJsonParseWithSchema returns default when schema check fails
      expect(useHRZones.getState().isLoaded).toBe(true);
      expect(useHRZones.getState().maxHR).toBe(190);
    });
  });

  // ============================================================
  // SETTERS
  // ============================================================

  describe('setMaxHR()', () => {
    it('updates maxHR in state', async () => {
      await useHRZones.getState().setMaxHR(200);
      expect(useHRZones.getState().maxHR).toBe(200);
    });

    it('persists maxHR with zones to storage', async () => {
      await useHRZones.getState().setMaxHR(200);
      const stored = JSON.parse((await AsyncStorage.getItem(HR_ZONES_KEY))!);
      expect(stored.maxHR).toBe(200);
      expect(stored.zones).toHaveLength(5); // Zones preserved
    });

    it('does not alter zones when setting maxHR', async () => {
      const zonesBefore = useHRZones.getState().zones;
      await useHRZones.getState().setMaxHR(175);
      expect(useHRZones.getState().zones).toEqual(zonesBefore);
    });
  });

  describe('setZoneThreshold()', () => {
    it('updates specific zone min/max', async () => {
      await useHRZones.getState().setZoneThreshold(1, 0.4, 0.55);
      const zone = useHRZones.getState().zones.find((z) => z.id === 1);
      expect(zone!.min).toBe(0.4);
      expect(zone!.max).toBe(0.55);
    });

    it('does not modify other zones', async () => {
      const zone2Before = { ...useHRZones.getState().zones[1] };
      await useHRZones.getState().setZoneThreshold(1, 0.4, 0.55);
      expect(useHRZones.getState().zones[1]).toEqual(zone2Before);
    });

    it('persists to storage', async () => {
      await useHRZones.getState().setZoneThreshold(3, 0.65, 0.75);
      const stored = JSON.parse((await AsyncStorage.getItem(HR_ZONES_KEY))!);
      const zone3 = stored.zones.find((z: { id: number }) => z.id === 3);
      expect(zone3.min).toBe(0.65);
      expect(zone3.max).toBe(0.75);
    });

    it('ignores non-existent zone ID', async () => {
      const zonesBefore = useHRZones.getState().zones.map((z) => ({ ...z }));
      await useHRZones.getState().setZoneThreshold(99, 0.1, 0.2);
      expect(useHRZones.getState().zones).toEqual(zonesBefore);
    });
  });

  describe('resetToDefaults()', () => {
    it('restores maxHR and zones to defaults', async () => {
      await useHRZones.getState().setMaxHR(200);
      await useHRZones.getState().setZoneThreshold(1, 0.1, 0.2);
      await useHRZones.getState().resetToDefaults();

      const state = useHRZones.getState();
      expect(state.maxHR).toBe(190);
      expect(state.zones).toEqual(DEFAULT_HR_ZONES);
    });

    it('removes from storage', async () => {
      await useHRZones.getState().setMaxHR(200);
      await useHRZones.getState().resetToDefaults();
      const stored = await AsyncStorage.getItem(HR_ZONES_KEY);
      expect(stored).toBeNull();
    });
  });

  // ============================================================
  // SYNCHRONOUS HELPERS
  // ============================================================

  describe('getHRZones()', () => {
    it('returns current maxHR and zones', async () => {
      await useHRZones.getState().setMaxHR(180);
      const result = getHRZones();
      expect(result.maxHR).toBe(180);
      expect(result.zones).toHaveLength(5);
    });
  });

  describe('initializeHRZones()', () => {
    it('delegates to store initialize', async () => {
      await initializeHRZones();
      expect(useHRZones.getState().isLoaded).toBe(true);
    });
  });
});
