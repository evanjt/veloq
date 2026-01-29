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
    /**
     * NOTE: The store now uses OPTIMISTIC UPDATES to fix the parallel updates race condition.
     * State updates immediately (synchronously), then persistence happens asynchronously.
     * If persistence fails, state IS updated but storage may be out of sync.
     *
     * This is a deliberate tradeoff:
     * - Pro: Fixes race condition where parallel updates lose changes
     * - Con: State and storage can briefly diverge on write errors
     * - Mitigation: App restart will reload from storage (last successful write)
     */

    it('setEnabled uses optimistic update - state changes even if write fails', async () => {
      const mockSetItem = AsyncStorage.setItem as jest.Mock;
      mockSetItem.mockRejectedValueOnce(new Error('Write failed'));

      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });

      await useRouteSettings.getState().setEnabled(false);

      // State IS updated (optimistic) even though write failed
      const state = useRouteSettings.getState();
      expect(state.settings.enabled).toBe(false); // State updated optimistically
    });

    it('setRetentionDays uses optimistic update - state changes even if write fails', async () => {
      const mockSetItem = AsyncStorage.setItem as jest.Mock;
      mockSetItem.mockRejectedValueOnce(new Error('Write failed'));

      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });

      await useRouteSettings.getState().setRetentionDays(90);

      // State IS updated (optimistic) even though write failed
      const state = useRouteSettings.getState();
      expect(state.settings.retentionDays).toBe(90); // State updated optimistically
    });

    it('setAutoCleanupEnabled uses optimistic update - state changes even if write fails', async () => {
      const mockSetItem = AsyncStorage.setItem as jest.Mock;
      mockSetItem.mockRejectedValueOnce(new Error('Write failed'));

      useRouteSettings.setState({
        settings: { enabled: true, retentionDays: 0, autoCleanupEnabled: false },
        isLoaded: true,
      });

      await useRouteSettings.getState().setAutoCleanupEnabled(true);

      // State IS updated (optimistic) even though write failed
      const state = useRouteSettings.getState();
      expect(state.settings.autoCleanupEnabled).toBe(true); // State updated optimistically
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
     * BUG: Parallel updates have race condition
     *
     * Each setter does: get().settings -> modify -> write -> setState
     * When run in parallel, all read the SAME initial state, so only one
     * setter's changes survive (whichever finishes last).
     *
     * FIX: Use functional updates or mutex to prevent race condition.
     */
    it('parallel updates should preserve all changes', async () => {
      const store = useRouteSettings.getState();

      await Promise.all([
        store.setEnabled(false),
        store.setRetentionDays(90),
        store.setAutoCleanupEnabled(true),
      ]);

      const state = useRouteSettings.getState();
      // All three changes should be preserved
      expect(state.settings.enabled).toBe(false);
      expect(state.settings.retentionDays).toBe(90);
      expect(state.settings.autoCleanupEnabled).toBe(true);
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
     * BUG: Type guard doesn't reject arrays
     *
     * `typeof [] === 'object'` is true, so arrays pass the type guard.
     * Then `{ ...DEFAULT_SETTINGS, ...[1,2,3] }` produces an object with
     * numeric keys (0, 1, 2) alongside the default settings.
     *
     * FIX: Add `Array.isArray(value)` check to type guard.
     */
    it('should reject array values and use defaults', async () => {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, '[1, 2, 3]');

      await initializeRouteSettings();

      const state = useRouteSettings.getState();
      // Should use clean defaults with NO numeric keys from array
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      // Should NOT have array indices leaked into settings
      expect((state.settings as unknown as Record<string, unknown>)['0']).toBeUndefined();
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
