/**
 * DashboardPreferencesStore Tests
 *
 * Focus: Bug-catching edge cases over coverage metrics
 * - Reorder algorithm bounds checking
 * - Metric toggle state consistency
 * - Sport-specific defaults
 * - Summary card validation gaps
 * - Persistence corruption recovery
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
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

const STORAGE_KEY = 'dashboard_preferences';
const SUMMARY_CARD_STORAGE_KEY = 'dashboard_summary_card';

const DEFAULT_SUMMARY_CARD: SummaryCardPreferences = {
  heroMetric: 'form',
  showSparkline: true,
  supportingMetrics: ['fitness', 'ftp', 'weekHours', 'weekCount'],
};

// Helper to create fresh default state
function createFreshCyclingDefaults(): MetricPreference[] {
  const defaultIds: MetricId[] = ['fitness', 'form', 'ftp', 'weekHours'];
  return AVAILABLE_METRICS.map((metric, index) => ({
    id: metric.id,
    enabled: defaultIds.includes(metric.id),
    order: defaultIds.includes(metric.id) ? defaultIds.indexOf(metric.id) : index + 100,
  }));
}

describe('DashboardPreferencesStore', () => {
  beforeEach(async () => {
    // Reset store to initial state (Cycling defaults)
    useDashboardPreferences.setState({
      metrics: createFreshCyclingDefaults(),
      summaryCard: { ...DEFAULT_SUMMARY_CARD },
      isInitialized: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // REORDER ALGORITHM EDGE CASES - Potential bugs with bounds
  // ============================================================

  describe('reorderMetrics() - Bounds Checking', () => {
    it('handles fromIndex at exact boundary (last enabled metric)', () => {
      const enabledBefore = useDashboardPreferences.getState().getEnabledMetrics();
      const lastIndex = enabledBefore.length - 1;

      useDashboardPreferences.getState().reorderMetrics(lastIndex, 0);

      const enabledAfter = useDashboardPreferences.getState().getEnabledMetrics();
      expect(enabledAfter.length).toBe(enabledBefore.length);
      // Last item should now be first
      expect(enabledAfter[0].id).toBe(enabledBefore[lastIndex].id);
    });

    it('handles same fromIndex and toIndex (no-op)', () => {
      const enabledBefore = useDashboardPreferences.getState().getEnabledMetrics();
      const orderBefore = enabledBefore.map((m) => m.id);

      useDashboardPreferences.getState().reorderMetrics(1, 1);

      const enabledAfter = useDashboardPreferences.getState().getEnabledMetrics();
      const orderAfter = enabledAfter.map((m) => m.id);
      expect(orderAfter).toEqual(orderBefore);
    });

    /**
     * BUG TEST: Negative fromIndex
     *
     * splice(-1, 1) removes the LAST element (JavaScript behavior).
     * This may not be the intended behavior.
     */
    it('negative fromIndex removes last element (unexpected behavior)', () => {
      const enabledBefore = useDashboardPreferences.getState().getEnabledMetrics();
      const lastId = enabledBefore[enabledBefore.length - 1].id;

      useDashboardPreferences.getState().reorderMetrics(-1, 0);

      const enabledAfter = useDashboardPreferences.getState().getEnabledMetrics();
      // Due to splice(-1, 1) behavior, last element was moved to index 0
      expect(enabledAfter[0].id).toBe(lastId);
    });

    /**
     * BUG: fromIndex beyond array length causes crash
     *
     * splice(100, 1) on array of 4 returns empty array, moved = undefined.
     * Then findIndex callback tries to access em.id on undefined, causing TypeError.
     *
     * FIX: Add bounds checking before splice operation.
     */
    it('should handle out-of-bounds fromIndex gracefully', () => {
      const enabledBefore = useDashboardPreferences.getState().getEnabledMetrics();
      expect(enabledBefore.length).toBe(4);

      // Should NOT crash - should either no-op or clamp index
      useDashboardPreferences.getState().reorderMetrics(100, 0);

      // State should remain unchanged (graceful handling)
      const enabledAfter = useDashboardPreferences.getState().getEnabledMetrics();
      expect(enabledAfter.length).toBe(4);
    });

    it('order values are sequential after valid reorder', () => {
      useDashboardPreferences.getState().reorderMetrics(0, 3);

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      // Check order values are 0, 1, 2, 3
      enabled.forEach((metric, index) => {
        expect(metric.order).toBe(index);
      });
    });

    it('disabled metrics retain high order values after reorder', () => {
      useDashboardPreferences.getState().reorderMetrics(0, 2);

      const { metrics } = useDashboardPreferences.getState();
      const disabledMetrics = metrics.filter((m) => !m.enabled);

      // All disabled metrics should have order >= 100
      disabledMetrics.forEach((m) => {
        expect(m.order).toBeGreaterThanOrEqual(100);
      });
    });
  });

  // ============================================================
  // METRIC TOGGLE STATE CONSISTENCY
  // ============================================================

  describe('setMetricEnabled() - State Consistency', () => {
    it('disabling a metric removes it from getEnabledMetrics()', () => {
      useDashboardPreferences.getState().setMetricEnabled('ftp', false);

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);
      expect(ids).not.toContain('ftp');
    });

    it('re-enabling a metric adds it back to getEnabledMetrics()', () => {
      useDashboardPreferences.getState().setMetricEnabled('ftp', false);
      useDashboardPreferences.getState().setMetricEnabled('ftp', true);

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);
      expect(ids).toContain('ftp');
    });

    /**
     * BUG: disable → reorder → re-enable produces duplicate order values
     *
     * After re-enabling a metric, it doesn't get recalculated order.
     * setMetricEnabled() only sets enabled=true, doesn't update order.
     * Result: orders become [0, 1, 2, 2] instead of [0, 1, 2, 3].
     *
     * FIX: setMetricEnabled should assign new sequential order when re-enabling.
     */
    it('disable → reorder → re-enable should produce sequential order values', () => {
      // Disable FTP (currently at index 2)
      useDashboardPreferences.getState().setMetricEnabled('ftp', false);

      // Reorder remaining metrics (fitness, form, weekHours)
      useDashboardPreferences.getState().reorderMetrics(0, 2);

      // Re-enable FTP
      useDashboardPreferences.getState().setMetricEnabled('ftp', true);

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);
      expect(ids).toContain('ftp');

      // Order values should be sequential with NO duplicates
      const orders = enabled.map((m) => m.order).sort((a, b) => a - b);
      orders.forEach((order, index) => {
        expect(order).toBe(index);
      });
    });

    it('disabling all metrics leaves getEnabledMetrics() empty', () => {
      const allIds: MetricId[] = ['fitness', 'form', 'ftp', 'weekHours'];
      allIds.forEach((id) => {
        useDashboardPreferences.getState().setMetricEnabled(id, false);
      });

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      expect(enabled).toHaveLength(0);
    });

    it('rapid toggles produce consistent final state', async () => {
      const store = useDashboardPreferences.getState();

      // Rapidly toggle the same metric
      store.setMetricEnabled('ftp', false);
      store.setMetricEnabled('ftp', true);
      store.setMetricEnabled('ftp', false);
      store.setMetricEnabled('ftp', true);

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);
      expect(ids).toContain('ftp');
    });
  });

  // ============================================================
  // SPORT-SPECIFIC DEFAULTS
  // ============================================================

  describe('resetToDefaults() - Sport Handling', () => {
    it('Cycling enables FTP, disables thresholdPace and css', () => {
      useDashboardPreferences.getState().resetToDefaults('Cycling');

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);

      expect(ids).toContain('ftp');
      expect(ids).not.toContain('thresholdPace');
      expect(ids).not.toContain('css');
    });

    it('Running enables thresholdPace, disables FTP and css', () => {
      useDashboardPreferences.getState().resetToDefaults('Running');

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);

      expect(ids).toContain('thresholdPace');
      expect(ids).not.toContain('ftp');
      expect(ids).not.toContain('css');
    });

    it('Swimming enables css, disables FTP and thresholdPace', () => {
      useDashboardPreferences.getState().resetToDefaults('Swimming');

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);

      expect(ids).toContain('css');
      expect(ids).not.toContain('ftp');
      expect(ids).not.toContain('thresholdPace');
    });

    it('unknown sport falls back to Other defaults', () => {
      useDashboardPreferences.getState().resetToDefaults('UnknownSport');

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);

      // Other defaults: fitness, form, weekHours, hrv
      expect(ids).toContain('hrv');
      expect(ids).not.toContain('ftp');
      expect(ids).not.toContain('thresholdPace');
      expect(ids).not.toContain('css');
    });

    it('reset after custom reorder restores default order', () => {
      // Reorder to non-default order
      useDashboardPreferences.getState().reorderMetrics(0, 3);

      // Reset
      useDashboardPreferences.getState().resetToDefaults('Cycling');

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      // Default Cycling order: fitness, form, ftp, weekHours
      expect(enabled[0].id).toBe('fitness');
      expect(enabled[1].id).toBe('form');
      expect(enabled[2].id).toBe('ftp');
      expect(enabled[3].id).toBe('weekHours');
    });
  });

  // ============================================================
  // SUMMARY CARD VALIDATION GAPS
  // ============================================================

  describe('setSummaryCardPreferences() - Validation', () => {
    it('accepts valid heroMetric', () => {
      useDashboardPreferences.getState().setSummaryCardPreferences({ heroMetric: 'fitness' });

      const { summaryCard } = useDashboardPreferences.getState();
      expect(summaryCard.heroMetric).toBe('fitness');
    });

    /**
     * BUG: No validation on heroMetric
     *
     * Invalid metric IDs are accepted and stored.
     * This could cause UI crashes when trying to render.
     */
    it('accepts invalid heroMetric without validation (BUG)', () => {
      useDashboardPreferences
        .getState()
        .setSummaryCardPreferences({ heroMetric: 'invalid_metric' as MetricId });

      const { summaryCard } = useDashboardPreferences.getState();
      expect(summaryCard.heroMetric).toBe('invalid_metric');

      // getMetricDefinition should return undefined for invalid ID
      expect(getMetricDefinition('invalid_metric' as MetricId)).toBeUndefined();
    });

    /**
     * BUG: No validation on supportingMetrics array
     */
    it('accepts invalid supportingMetrics without validation (BUG)', () => {
      useDashboardPreferences.getState().setSummaryCardPreferences({
        supportingMetrics: ['invalid1', 'invalid2'] as MetricId[],
      });

      const { summaryCard } = useDashboardPreferences.getState();
      expect(summaryCard.supportingMetrics).toContain('invalid1');
    });

    it('partial update preserves other fields', () => {
      const original = { ...useDashboardPreferences.getState().summaryCard };

      useDashboardPreferences.getState().setSummaryCardPreferences({ showSparkline: false });

      const { summaryCard } = useDashboardPreferences.getState();
      expect(summaryCard.showSparkline).toBe(false);
      expect(summaryCard.heroMetric).toBe(original.heroMetric);
      expect(summaryCard.supportingMetrics).toEqual(original.supportingMetrics);
    });

    it('empty partial update is a no-op', () => {
      const original = { ...useDashboardPreferences.getState().summaryCard };

      useDashboardPreferences.getState().setSummaryCardPreferences({});

      const { summaryCard } = useDashboardPreferences.getState();
      expect(summaryCard).toEqual(original);
    });
  });

  // ============================================================
  // PERSISTENCE & INITIALIZATION
  // ============================================================

  describe('initializeDashboardPreferences() - Persistence', () => {
    it('loads valid metrics from AsyncStorage', async () => {
      const customMetrics: MetricPreference[] = [
        { id: 'hrv', enabled: true, order: 0 },
        { id: 'rhr', enabled: true, order: 1 },
        { id: 'weekHours', enabled: false, order: 100 },
        { id: 'weekCount', enabled: false, order: 101 },
        { id: 'ftp', enabled: false, order: 102 },
        { id: 'thresholdPace', enabled: false, order: 103 },
        { id: 'css', enabled: false, order: 104 },
        { id: 'fitness', enabled: false, order: 105 },
        { id: 'form', enabled: false, order: 106 },
      ];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(customMetrics));

      await initializeDashboardPreferences('Cycling');

      const { metrics, isInitialized } = useDashboardPreferences.getState();
      expect(isInitialized).toBe(true);
      expect(metrics.find((m) => m.id === 'hrv')?.enabled).toBe(true);
      expect(metrics.find((m) => m.id === 'ftp')?.enabled).toBe(false);
    });

    it('loads valid summaryCard from AsyncStorage', async () => {
      const customSummaryCard: SummaryCardPreferences = {
        heroMetric: 'hrv',
        showSparkline: false,
        supportingMetrics: ['rhr'],
      };
      await AsyncStorage.setItem(SUMMARY_CARD_STORAGE_KEY, JSON.stringify(customSummaryCard));

      await initializeDashboardPreferences('Cycling');

      const { summaryCard } = useDashboardPreferences.getState();
      expect(summaryCard.heroMetric).toBe('hrv');
      expect(summaryCard.showSparkline).toBe(false);
      expect(summaryCard.supportingMetrics).toEqual(['rhr']);
    });

    it('uses sport-specific defaults when no stored preferences', async () => {
      await initializeDashboardPreferences('Running');

      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      const ids = enabled.map((m) => m.id);

      // Running defaults: fitness, form, thresholdPace, weekHours
      expect(ids).toContain('thresholdPace');
      expect(ids).not.toContain('ftp');
    });

    it('recovers from invalid JSON in metrics storage', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'not valid json {{{');

      await initializeDashboardPreferences('Cycling');

      const { isInitialized } = useDashboardPreferences.getState();
      expect(isInitialized).toBe(true);
      // Should fall back to Cycling defaults
      const enabled = useDashboardPreferences.getState().getEnabledMetrics();
      expect(enabled.length).toBeGreaterThan(0);
    });

    it('recovers from invalid JSON in summaryCard storage', async () => {
      await AsyncStorage.setItem(SUMMARY_CARD_STORAGE_KEY, 'not valid json');

      await initializeDashboardPreferences('Cycling');

      const { summaryCard, isInitialized } = useDashboardPreferences.getState();
      expect(isInitialized).toBe(true);
      expect(summaryCard).toEqual(DEFAULT_SUMMARY_CARD);
    });

    it('handles AsyncStorage read failure gracefully', async () => {
      const mockGetItem = AsyncStorage.getItem as jest.Mock;
      mockGetItem.mockRejectedValueOnce(new Error('Storage unavailable'));

      await initializeDashboardPreferences('Cycling');

      const { isInitialized } = useDashboardPreferences.getState();
      expect(isInitialized).toBe(true);
    });
  });

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================

  describe('Helper Functions', () => {
    describe('getMetricDefinition()', () => {
      it('returns definition for valid metric ID', () => {
        const def = getMetricDefinition('ftp');
        expect(def).toBeDefined();
        expect(def?.labelKey).toBe('metrics.ftp');
        expect(def?.sportSpecific).toBe('Cycling');
      });

      it('returns undefined for invalid metric ID', () => {
        const def = getMetricDefinition('nonexistent' as MetricId);
        expect(def).toBeUndefined();
      });
    });

    describe('getMetricsForSport()', () => {
      it('includes non-sport-specific metrics for any sport', () => {
        const metrics = createFreshCyclingDefaults();
        const filtered = getMetricsForSport(metrics, 'Cycling');

        // HRV and RHR are not sport-specific
        const ids = filtered.map((m) => m.id);
        expect(ids).toContain('hrv');
        expect(ids).toContain('rhr');
      });

      it('excludes sport-specific metrics for wrong sport', () => {
        const metrics = createFreshCyclingDefaults();
        const filtered = getMetricsForSport(metrics, 'Running');

        const ids = filtered.map((m) => m.id);
        expect(ids).not.toContain('ftp'); // Cycling-specific
        expect(ids).not.toContain('css'); // Swimming-specific
        expect(ids).toContain('thresholdPace'); // Running-specific
      });

      it('includes sport-specific metric for matching sport', () => {
        const metrics = createFreshCyclingDefaults();
        const filtered = getMetricsForSport(metrics, 'Cycling');

        const ids = filtered.map((m) => m.id);
        expect(ids).toContain('ftp');
      });
    });
  });

  // ============================================================
  // PERSISTENCE FIRE-AND-FORGET
  // ============================================================

  describe('Persistence Fire-and-Forget', () => {
    it('setMetricEnabled persists to AsyncStorage', async () => {
      useDashboardPreferences.getState().setMetricEnabled('hrv', true);

      // Wait for async persist
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as MetricPreference[];
      expect(parsed.find((m) => m.id === 'hrv')?.enabled).toBe(true);
    });

    it('reorderMetrics persists to AsyncStorage', async () => {
      const enabledBefore = useDashboardPreferences.getState().getEnabledMetrics();
      const firstId = enabledBefore[0].id;

      useDashboardPreferences.getState().reorderMetrics(0, 2);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = JSON.parse(stored!) as MetricPreference[];
      // First metric should now have order 2
      expect(parsed.find((m) => m.id === firstId)?.order).toBe(2);
    });

    it('setSummaryCardPreferences persists to AsyncStorage', async () => {
      useDashboardPreferences.getState().setSummaryCardPreferences({ heroMetric: 'hrv' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const stored = await AsyncStorage.getItem(SUMMARY_CARD_STORAGE_KEY);
      const parsed = JSON.parse(stored!) as SummaryCardPreferences;
      expect(parsed.heroMetric).toBe('hrv');
    });
  });
});
