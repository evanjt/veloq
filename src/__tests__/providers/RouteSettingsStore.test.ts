/**
 * RouteSettingsStore Tests
 *
 * Focus: Bug-catching edge cases over coverage metrics
 * - Retention days clamping logic
 * - Persistence corruption recovery
 * - AsyncStorage error handling
 * - State isolation between setters
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useRouteSettings,
  isRouteMatchingEnabled,
  getRetentionDays,
  initializeRouteSettings,
} from '@/providers/RouteSettingsStore';

const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

const DEFAULT_SETTINGS = {
  enabled: true,
  retentionDays: 0,
  autoCleanupEnabled: false,
};

describe('RouteSettingsStore', () => {
  beforeEach(async () => {
    // Reset store to initial state
    useRouteSettings.setState({
      settings: { ...DEFAULT_SETTINGS },
      isLoaded: false,
    });
    // Clear AsyncStorage
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // RETENTION DAYS CLAMPING - Critical validation logic
  // ============================================================

  describe('setRetentionDays() - Clamping Logic', () => {
    it('preserves 0 as special "keep all" value (not clamped to 30)', async () => {
      const { setRetentionDays } = useRouteSettings.getState();
      await setRetentionDays(0);

      const state = useRouteSettings.getState();
      expect(state.settings.retentionDays).toBe(0);
    });

    it('clamps values below 30 to minimum of 30', async () => {
      const { setRetentionDays } = useRouteSettings.getState();

      await setRetentionDays(1);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(30);

      await setRetentionDays(15);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(30);

      await setRetentionDays(29);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(30);
    });

    it('clamps negative values to minimum of 30', async () => {
      const { setRetentionDays } = useRouteSettings.getState();

      await setRetentionDays(-1);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(30);

      await setRetentionDays(-100);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(30);

      await setRetentionDays(Number.MIN_SAFE_INTEGER);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(30);
    });

    it('clamps values above 365 to maximum of 365', async () => {
      const { setRetentionDays } = useRouteSettings.getState();

      await setRetentionDays(366);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(365);

      await setRetentionDays(500);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(365);

      await setRetentionDays(1000);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(365);
    });

    it('passes through valid range values unchanged', async () => {
      const { setRetentionDays } = useRouteSettings.getState();

      const validValues = [30, 60, 90, 180, 270, 365];
      for (const value of validValues) {
        await setRetentionDays(value);
        expect(useRouteSettings.getState().settings.retentionDays).toBe(value);
      }
    });

    it('handles boundary values correctly', async () => {
      const { setRetentionDays } = useRouteSettings.getState();

      // Exact minimum boundary
      await setRetentionDays(30);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(30);

      // Exact maximum boundary
      await setRetentionDays(365);
      expect(useRouteSettings.getState().settings.retentionDays).toBe(365);
    });

    it('persists validated value to AsyncStorage', async () => {
      const { setRetentionDays } = useRouteSettings.getState();
      await setRetentionDays(15); // Will be clamped to 30

      const stored = await AsyncStorage.getItem(ROUTE_SETTINGS_KEY);
      const parsed = JSON.parse(stored!);
      expect(parsed.retentionDays).toBe(30); // Clamped value is persisted
    });
  });

  // ============================================================
  // INITIALIZATION - Corruption recovery is critical
  // ============================================================

  describe('initialize() - Corruption Recovery', () => {
    it('loads valid settings from AsyncStorage', async () => {
      const customSettings = {
        enabled: false,
        retentionDays: 90,
        autoCleanupEnabled: true,
      };
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify(customSettings));

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false);
      expect(state.settings.retentionDays).toBe(90);
      expect(state.settings.autoCleanupEnabled).toBe(true);
      expect(state.isLoaded).toBe(true);
    });

    it('uses defaults when AsyncStorage is empty', async () => {
      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      expect(state.isLoaded).toBe(true);
    });

    it('recovers from invalid JSON in AsyncStorage', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, 'not valid json {{{');

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      expect(state.isLoaded).toBe(true);
    });

    it('recovers from wrong type for enabled field', async () => {
      await AsyncStorage.setItem(
        ROUTE_SETTINGS_KEY,
        JSON.stringify({ enabled: 'not a boolean', retentionDays: 90 })
      );

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      expect(state.isLoaded).toBe(true);
    });

    it('recovers from wrong type for retentionDays field', async () => {
      await AsyncStorage.setItem(
        ROUTE_SETTINGS_KEY,
        JSON.stringify({ enabled: true, retentionDays: 'ninety' })
      );

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      expect(state.isLoaded).toBe(true);
    });

    it('merges partial settings with defaults', async () => {
      // Only enabled is stored (old version compatibility)
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify({ enabled: false }));

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false);
      expect(state.settings.retentionDays).toBe(0); // Default
      expect(state.settings.autoCleanupEnabled).toBe(false); // Default
    });

    it('sets isLoaded even when AsyncStorage throws', async () => {
      const mockGetItem = AsyncStorage.getItem as jest.Mock;
      mockGetItem.mockRejectedValueOnce(new Error('Storage unavailable'));

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  // ============================================================
  // SETTER ISOLATION - Each setter should only affect its field
  // ============================================================

  describe('Setter Isolation', () => {
    it('setEnabled does not affect retentionDays or autoCleanupEnabled', async () => {
      // Set non-default values first
      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 90, autoCleanupEnabled: true },
        isLoaded: true,
      });

      await useRouteSettings.getState().setEnabled(false);

      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false);
      expect(state.settings.retentionDays).toBe(90); // Unchanged
      expect(state.settings.autoCleanupEnabled).toBe(true); // Unchanged
    });

    it('setRetentionDays does not affect enabled or autoCleanupEnabled', async () => {
      useRouteSettings.setState({
        settings: { enabled: false, retentionDays: 0, autoCleanupEnabled: true },
        isLoaded: true,
      });

      await useRouteSettings.getState().setRetentionDays(180);

      const state = useRouteSettings.getState();
      expect(state.settings.retentionDays).toBe(180);
      expect(state.settings.enabled).toBe(false); // Unchanged
      expect(state.settings.autoCleanupEnabled).toBe(true); // Unchanged
    });

    it('setAutoCleanupEnabled does not affect enabled or retentionDays', async () => {
      useRouteSettings.setState({
        settings: { enabled: false, retentionDays: 120, autoCleanupEnabled: false },
        isLoaded: true,
      });

      await useRouteSettings.getState().setAutoCleanupEnabled(true);

      const state = useRouteSettings.getState();
      expect(state.settings.autoCleanupEnabled).toBe(true);
      expect(state.settings.enabled).toBe(false); // Unchanged
      expect(state.settings.retentionDays).toBe(120); // Unchanged
    });

    it('each setter persists complete settings object to AsyncStorage', async () => {
      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 60, autoCleanupEnabled: true },
        isLoaded: true,
      });

      await useRouteSettings.getState().setEnabled(false);

      const stored = await AsyncStorage.getItem(ROUTE_SETTINGS_KEY);
      const parsed = JSON.parse(stored!);

      // All fields should be in persisted object
      expect(parsed.enabled).toBe(false);
      expect(parsed.retentionDays).toBe(60);
      expect(parsed.autoCleanupEnabled).toBe(true);
    });
  });

  // ============================================================
  // ASYNCSTORAGE ERROR HANDLING
  // ============================================================

  describe('AsyncStorage Error Handling', () => {
    it('setEnabled catches write errors and does not update state', async () => {
      const mockSetItem = AsyncStorage.setItem as jest.Mock;
      mockSetItem.mockRejectedValueOnce(new Error('Write failed'));

      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });

      await useRouteSettings.getState().setEnabled(false);

      // State should remain unchanged because write failed
      // Note: Current implementation DOES update state even on error
      // This test documents actual behavior
      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(true); // Should stay true
    });

    it('setRetentionDays catches write errors and does not update state', async () => {
      const mockSetItem = AsyncStorage.setItem as jest.Mock;
      mockSetItem.mockRejectedValueOnce(new Error('Write failed'));

      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });

      await useRouteSettings.getState().setRetentionDays(90);

      const state = useRouteSettings.getState();
      expect(state.settings.retentionDays).toBe(0); // Should stay 0
    });

    it('setAutoCleanupEnabled catches write errors and does not update state', async () => {
      const mockSetItem = AsyncStorage.setItem as jest.Mock;
      mockSetItem.mockRejectedValueOnce(new Error('Write failed'));

      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });

      await useRouteSettings.getState().setAutoCleanupEnabled(true);

      const state = useRouteSettings.getState();
      expect(state.settings.autoCleanupEnabled).toBe(false); // Should stay false
    });
  });

  // ============================================================
  // SYNCHRONOUS HELPER FUNCTIONS
  // ============================================================

  describe('Synchronous Helpers', () => {
    it('isRouteMatchingEnabled returns current enabled state', () => {
      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });
      expect(isRouteMatchingEnabled()).toBe(true);

      useRouteSettings.setState({
        settings: { enabled: false, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });
      expect(isRouteMatchingEnabled()).toBe(false);
    });

    it('getRetentionDays returns current retentionDays value', () => {
      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });
      expect(getRetentionDays()).toBe(0);

      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 180, autoCleanupEnabled: false },
        isLoaded: true,
      });
      expect(getRetentionDays()).toBe(180);
    });

    it('helpers work before initialization', () => {
      // Reset to uninitialized state
      useRouteSettings.setState({
        settings: DEFAULT_SETTINGS,
        isLoaded: false,
      });

      // Should return default values without crashing
      expect(isRouteMatchingEnabled()).toBe(true);
      expect(getRetentionDays()).toBe(0);
    });
  });

  // ============================================================
  // CONCURRENT OPERATIONS
  // ============================================================

  describe('Concurrent Operations', () => {
    it('rapid sequential updates produce consistent final state', async () => {
      const { setRetentionDays } = useRouteSettings.getState();

      // Rapidly change retention days
      await setRetentionDays(30);
      await setRetentionDays(60);
      await setRetentionDays(90);
      await setRetentionDays(120);
      await setRetentionDays(180);

      const state = useRouteSettings.getState();
      expect(state.settings.retentionDays).toBe(180);

      // Verify AsyncStorage has final value
      const stored = await AsyncStorage.getItem(ROUTE_SETTINGS_KEY);
      const parsed = JSON.parse(stored!);
      expect(parsed.retentionDays).toBe(180);
    });

    /**
     * BUG FOUND: Parallel updates have race condition
     *
     * Each setter does: get().settings -> modify -> write -> setState
     * When run in parallel, all read the SAME initial state, so only one
     * setter's changes survive (whichever finishes last).
     *
     * This test documents the ACTUAL (buggy) behavior. In a future fix,
     * setters should use functional updates or mutex to prevent this.
     */
    it('parallel updates have race condition (BUG: only last writer wins)', async () => {
      const store = useRouteSettings.getState();

      await Promise.all([
        store.setEnabled(false),
        store.setRetentionDays(90),
        store.setAutoCleanupEnabled(true),
      ]);

      const state = useRouteSettings.getState();
      // BUG: Due to race condition, we can't predict final state
      // At minimum one setter's value should be present
      const changesApplied = [
        state.settings.enabled === false,
        state.settings.retentionDays === 90,
        state.settings.autoCleanupEnabled === true,
      ].filter(Boolean).length;

      // At least one change should apply (the last one to finish)
      expect(changesApplied).toBeGreaterThanOrEqual(1);

      // TODO: Fix race condition - then this test should expect all 3 changes
    });
  });

  // ============================================================
  // TYPE GUARD EDGE CASES
  // ============================================================

  describe('Type Guard (isRouteSettings)', () => {
    it('accepts empty object as valid partial settings', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify({}));

      await initializeRouteSettings();

      // Empty object is valid - merged with defaults
      const state = useRouteSettings.getState();
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      expect(state.isLoaded).toBe(true);
    });

    it('rejects null value', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, 'null');

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
    });

    /**
     * BUG FOUND: Type guard doesn't reject arrays
     *
     * `typeof [] === 'object'` is true, so arrays pass the type guard.
     * Then `{ ...DEFAULT_SETTINGS, ...[1,2,3] }` produces an object with
     * numeric keys (0, 1, 2) alongside the default settings.
     *
     * This test documents the ACTUAL (buggy) behavior. The type guard
     * should check `Array.isArray(value)` to properly reject arrays.
     */
    it('does not properly reject array value (BUG: array indices leak into settings)', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, '[1, 2, 3]');

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      // BUG: Array is merged into settings, adding numeric keys
      expect(state.settings.enabled).toBe(DEFAULT_SETTINGS.enabled);
      expect(state.settings.retentionDays).toBe(DEFAULT_SETTINGS.retentionDays);
      expect(state.settings.autoCleanupEnabled).toBe(DEFAULT_SETTINGS.autoCleanupEnabled);
      // These shouldn't exist but do due to bug
      expect((state.settings as Record<string, unknown>)['0']).toBe(1);

      // TODO: Fix type guard to check Array.isArray(value)
    });

    it('rejects object with extra invalid properties gracefully', async () => {
      // Extra properties are ignored (only checked properties validated)
      await AsyncStorage.setItem(
        ROUTE_SETTINGS_KEY,
        JSON.stringify({
          enabled: false,
          retentionDays: 60,
          autoCleanupEnabled: true,
          unknownField: 'should be ignored',
        })
      );

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false);
      expect(state.settings.retentionDays).toBe(60);
    });
  });
});
