import {
  stalePROpportunityToInsight,
  StalePROpportunity,
} from '@/features/insights/generators/stalePr';

// Mock translation function - returns key with interpolated params
const mockT = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key;
  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `${key} {${paramStr}}`;
};

describe('stalePROpportunityToInsight', () => {
  const opportunity: StalePROpportunity = {
    sectionId: 's1',
    sectionName: 'Hill Climb',
    bestTimeSecs: 263,
    daysSinceLast: 60,
    traversalCount: 5,
    fitnessMetric: 'power',
    currentValue: 220,
    previousValue: 200,
    gainPercent: 10,
    unit: 'W',
  };

  it('produces a valid Insight object', () => {
    const insight = stalePROpportunityToInsight(opportunity, mockT, 1700000000000);

    expect(insight.id).toBe('stale_pr-s1');
    expect(insight.category).toBe('stale_pr');
    expect(insight.priority).toBe(2);
    expect(insight.icon).toBe('lightning-bolt');
    expect(insight.iconColor).toBe('#FF9800');
    expect(insight.navigationTarget).toBe('/section/s1');
    expect(insight.isNew).toBe(true);
    expect(insight.timestamp).toBe(1700000000000);
  });

  it('includes section name in title', () => {
    const insight = stalePROpportunityToInsight(opportunity, mockT);
    expect(insight.title).toContain('Hill Climb');
  });

  it('includes fitness values in subtitle', () => {
    const insight = stalePROpportunityToInsight(opportunity, mockT);
    expect(insight.subtitle).toContain('200');
    expect(insight.subtitle).toContain('220');
  });

  it('includes supporting data with FTP comparison', () => {
    const insight = stalePROpportunityToInsight(opportunity, mockT);
    expect(insight.supportingData!.dataPoints).toHaveLength(4);
    expect(insight.supportingData!.formula).toContain('220');
    expect(insight.supportingData!.formula).toContain('200');
    expect(insight.supportingData!.formula).toContain('+10%');
  });

  it('includes methodology', () => {
    const insight = stalePROpportunityToInsight(opportunity, mockT);
    expect(insight.methodology!.name).toBe(
      'insights.methodology.stalePrCrossRefName {metric: insights.stalePr.metricCyclingFtp}'
    );
  });

  it('includes fitness values in body', () => {
    const insight = stalePROpportunityToInsight(opportunity, mockT);
    expect(insight.body).toContain('200W');
    expect(insight.body).toContain('220W');
    expect(insight.body).toContain('Hill Climb');
  });

  it('uses Date.now() when no timestamp provided', () => {
    const before = Date.now();
    const insight = stalePROpportunityToInsight(opportunity, mockT);
    const after = Date.now();
    expect(insight.timestamp).toBeGreaterThanOrEqual(before);
    expect(insight.timestamp).toBeLessThanOrEqual(after);
  });

  it('dates the card by the traversal, not by when it was built', () => {
    const now = Date.UTC(2026, 7, 22, 9, 0, 0);
    const insight = stalePROpportunityToInsight(opportunity, mockT, now);

    // The recency gate reads sourceTimestamp. Stamping it with `now` would
    // report every card as zero days old and fail the minimum-age check.
    const ageDays = (now - insight.meta!.sourceTimestamp!) / 86_400_000;
    expect(ageDays).toBeCloseTo(opportunity.daysSinceLast, 6);
    expect(insight.meta!.repetitionCount).toBe(opportunity.traversalCount);
  });

  it('formats pace-based opportunity correctly', () => {
    const paceOpportunity: StalePROpportunity = {
      sectionId: 'r1',
      sectionName: 'Park Loop',
      bestTimeSecs: 420,
      daysSinceLast: 45,
      traversalCount: 4,
      fitnessMetric: 'pace',
      currentValue: 3.3,
      previousValue: 3.0,
      gainPercent: 10,
      unit: '/km',
    };
    const insight = stalePROpportunityToInsight(paceOpportunity, mockT);
    expect(insight.methodology!.name).toBe(
      'insights.methodology.stalePrCrossRefName {metric: insights.stalePr.metricRunningThreshold}'
    );
    expect(insight.body).toContain('insights.stalePr.metricRunningThreshold');
    expect(insight.body).not.toContain('metricCyclingFtp');
  });
});
