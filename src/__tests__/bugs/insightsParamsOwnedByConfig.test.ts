/**
 * Scenario: the windows and caps the engine is asked for were constants beside
 * the builder while the rules read their own copies from the configuration.
 *
 * Expected behaviour: every number in the engine's parameters comes from
 * `INSIGHTS_CONFIG`, so changing it there changes what the engine is asked.
 */

import { INSIGHTS_CONFIG, maxAgeDaysFor } from '@/features/insights/lib/config';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: jest.fn(() => false),
}));

describe('insights engine parameters', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks for the section change window the rules gate on', () => {
    const original = INSIGHTS_CONFIG.recency.section_changed ?? { max: 14 };
    INSIGHTS_CONFIG.recency.section_changed = { max: 30 };
    try {
      expect(maxAgeDaysFor('section_changed')).toBe(30);
      expect(buildInsightsParams().sectionChangeWindowDays).toBe(30);
    } finally {
      INSIGHTS_CONFIG.recency.section_changed = original;
    }
  });

  it('reads the curation numbers from the configuration', () => {
    const params = buildInsightsParams();
    expect(params.rankedLimit).toBe(INSIGHTS_CONFIG.limits.rankedPerSport);
    expect(params.efficiencyPerSport).toBe(INSIGHTS_CONFIG.limits.efficiencyPerSport);
    expect(params.hrvWindowDays).toBe(INSIGHTS_CONFIG.windows.hrvDays);
    expect(params.efficiencyMinHrChangeBpm).toBe(
      INSIGHTS_CONFIG.thresholds.efficiencyMinHrChangeBpm
    );
  });
});
