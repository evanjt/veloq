/**
 * Scenario: the panel cap for stale_pr cards and the number of opportunities
 * the engine returns were one value. Expected behaviour: the engine limit has
 * its own knob, and the panel cap for stale_pr is not overridden because the
 * generator only ever emits one card.
 */
import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => false,
}));

describe('stale_pr opportunity limit', () => {
  it('reads its own threshold, not the panel cap', () => {
    const { surface, thresholds } = INSIGHTS_CONFIG;
    expect(surface.maxPerCategoryOverride.stale_pr).toBeUndefined();
    expect(buildInsightsParams().staleMaxOpportunities).toBe(thresholds.staleMaxOpportunities);
    expect(thresholds.staleMaxOpportunities).toBeGreaterThan(surface.maxPerCategory);
  });

  it('keeps the engine limit when the panel cap changes', () => {
    const original = INSIGHTS_CONFIG.surface.maxPerCategory;
    const before = buildInsightsParams().staleMaxOpportunities;
    INSIGHTS_CONFIG.surface.maxPerCategory = 1;
    try {
      expect(buildInsightsParams().staleMaxOpportunities).toBe(before);
    } finally {
      INSIGHTS_CONFIG.surface.maxPerCategory = original;
    }
  });
});
