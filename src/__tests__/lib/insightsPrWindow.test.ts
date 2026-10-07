/**
 * Scenario: the recent record window and outing floor sent to the engine.
 * Expected behaviour: both come from the insights config, so changing the
 * section_pr bound changes what the engine returns.
 */
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';
import { INSIGHTS_CONFIG, maxAgeDaysFor } from '@/features/insights/lib/config';

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => true,
}));

describe('recent record params', () => {
  it('carries the section_pr window and the outing floor', () => {
    const params = buildInsightsParams();
    expect(params.recentPrWindowDays).toBe(maxAgeDaysFor('section_pr'));
    expect(params.recentPrWindowDays).toBeGreaterThan(7);
    expect(params.recentPrMinOutings).toBe(INSIGHTS_CONFIG.repetition.section_pr_min_outings);
  });
});
