import {
  generateSectionClusterInsights,
  SectionTrendData,
} from '@/hooks/insights/sectionClusterInsights';

// Mock translation function — returns key with interpolated params
const mockT = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key;
  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `${key} {${paramStr}}`;
};

const NOW = Date.now();

function makeTrend(
  id: string,
  name: string,
  trend: number,
  traversalCount = 10,
  daysSinceLast?: number
): SectionTrendData {
  return {
    sectionId: id,
    sectionName: name,
    trend,
    medianRecentSecs: 300,
    bestTimeSecs: 270,
    traversalCount,
    daysSinceLast,
  };
}

describe('generateSectionClusterInsights', () => {
  it('returns empty array for empty input', () => {
    const result = generateSectionClusterInsights([], NOW, mockT);
    expect(result).toEqual([]);
  });

  it('returns empty array for null-ish input', () => {
    const result = generateSectionClusterInsights(
      null as unknown as SectionTrendData[],
      NOW,
      mockT
    );
    expect(result).toEqual([]);
  });

  it('returns no insights when only 1 improving and 1 declining (need 2+)', () => {
    const trends = [makeTrend('s1', 'Hill A', 1), makeTrend('s2', 'Hill B', -1)];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toEqual([]);
  });

  it('returns no insights when all sections are stable', () => {
    const trends = [
      makeTrend('s1', 'Section A', 0),
      makeTrend('s2', 'Section B', 0),
      makeTrend('s3', 'Section C', 0),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toEqual([]);
  });

  it('generates one improving cluster insight for 3 improving sections', () => {
    const trends = [
      makeTrend('s1', 'Riverside', 1),
      makeTrend('s2', 'Lakeside', 1),
      makeTrend('s3', 'Parkway', 1),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);

    const insight = result[0];
    expect(insight.id).toBe('section_cluster-improving');
    expect(insight.category).toBe('section_cluster');
    expect(insight.priority).toBe(3);
    expect(insight.iconColor).toBe('#66BB6A');
    expect(insight.title).toContain('name: Riverside');
    expect(insight.body).toContain('Riverside');
    expect(insight.body).toContain('Lakeside');
    expect(insight.body).toContain('Parkway');
  });

  it('generates two cluster insights for 2 improving and 2 declining', () => {
    const trends = [
      makeTrend('s1', 'Fast A', 1),
      makeTrend('s2', 'Fast B', 1),
      makeTrend('s3', 'Slow C', -1),
      makeTrend('s4', 'Slow D', -1),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(2);

    const improving = result.find((i) => i.id === 'section_cluster-improving');
    const declining = result.find((i) => i.id === 'section_cluster-declining');
    expect(improving).toBeDefined();
    expect(declining).toBeDefined();

    expect(improving!.iconColor).toBe('#66BB6A');
    expect(declining!.iconColor).toBe('#FFA726');

    // Declining framed positively as "to revisit"
    expect(declining!.title).toContain('decliningTitle');
  });

  it('does not generate declining insight for only 1 declining section', () => {
    const trends = [
      makeTrend('s1', 'Fast A', 1),
      makeTrend('s2', 'Fast B', 1),
      makeTrend('s3', 'Slow C', -1),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('section_cluster-improving');
  });

  it('falls back to traversal count sort when daysSinceLast is not provided', () => {
    const trends = [
      makeTrend('s1', 'Low Traffic', 1, 5),
      makeTrend('s2', 'High Traffic', 1, 50),
      makeTrend('s3', 'Medium Traffic', 1, 20),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);

    const sections = result[0].supportingData?.sections;
    expect(sections).toBeDefined();
    expect(sections!.length).toBe(3);
    expect(sections![0].sectionName).toBe('High Traffic');
    expect(sections![1].sectionName).toBe('Medium Traffic');
    expect(sections![2].sectionName).toBe('Low Traffic');
  });

  it('falls back to traversal count ordering in body when daysSinceLast is not provided', () => {
    const trends = [makeTrend('s1', 'Alpha', 1, 3), makeTrend('s2', 'Beta', 1, 30)];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);
    // Body should list Beta before Alpha (higher traversal count first, as tiebreaker)
    const body = result[0].body!;
    expect(body.indexOf('Beta')).toBeLessThan(body.indexOf('Alpha'));
  });

  it('sorts sections by daysSinceLast ascending when provided', () => {
    const trends = [
      makeTrend('s1', 'Old Section', 1, 50, 14),
      makeTrend('s2', 'Recent Section', 1, 5, 2),
      makeTrend('s3', 'Medium Section', 1, 30, 7),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);

    const sections = result[0].supportingData?.sections;
    expect(sections![0].sectionName).toBe('Recent Section');
    expect(sections![1].sectionName).toBe('Medium Section');
    expect(sections![2].sectionName).toBe('Old Section');
  });

  it('uses traversal count as tiebreaker when daysSinceLast is equal', () => {
    const trends = [
      makeTrend('s1', 'Less Visited', 1, 5, 3),
      makeTrend('s2', 'More Visited', 1, 50, 3),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    const sections = result[0].supportingData?.sections;
    expect(sections![0].sectionName).toBe('More Visited');
    expect(sections![1].sectionName).toBe('Less Visited');
  });

  it('names most recent section in title when daysSinceLast is provided', () => {
    const trends = [
      makeTrend('s1', 'Old Favorite', 1, 50, 14),
      makeTrend('s2', 'Fresh Run', 1, 5, 1),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result[0].title).toContain('name: Fresh Run');
  });

  it('includes daysSinceLast in supporting data sections', () => {
    const trends = [makeTrend('s1', 'A', 1, 10, 3), makeTrend('s2', 'B', 1, 10, 7)];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    const sections = result[0].supportingData?.sections;
    expect(sections![0].daysSinceLast).toBe(3);
    expect(sections![1].daysSinceLast).toBe(7);
  });

  it('includes methodology in the insight', () => {
    const trends = [makeTrend('s1', 'A', 1), makeTrend('s2', 'B', 1)];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result[0].methodology).toBeDefined();
    expect(result[0].methodology!.name).toBe('Trend-based section clustering');
    expect(result[0].supportingData?.algorithmDescription).toBeDefined();
  });

  it('sets timestamp from the now parameter', () => {
    const customNow = 1700000000000;
    const trends = [makeTrend('s1', 'A', 1), makeTrend('s2', 'B', 1)];
    const result = generateSectionClusterInsights(trends, customNow, mockT);
    expect(result[0].timestamp).toBe(customNow);
  });

  it('sets navigationTarget to /routes', () => {
    const trends = [makeTrend('s1', 'A', 1), makeTrend('s2', 'B', 1)];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result[0].navigationTarget).toBe('/routes');
  });

  it('limits to MAX_CLUSTER_INSIGHTS (2)', () => {
    // Both improving and declining should generate, and we cap at 2
    const trends = [
      makeTrend('s1', 'Up A', 1),
      makeTrend('s2', 'Up B', 1),
      makeTrend('s3', 'Down C', -1),
      makeTrend('s4', 'Down D', -1),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('handles exactly 2 improving sections (minimum cluster size)', () => {
    const trends = [makeTrend('s1', 'A', 1), makeTrend('s2', 'B', 1)];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('section_cluster-improving');
  });

  it('ignores stable sections entirely', () => {
    const trends = [
      makeTrend('s1', 'Stable A', 0),
      makeTrend('s2', 'Stable B', 0),
      makeTrend('s3', 'Stable C', 0),
      makeTrend('s4', 'Improving D', 1),
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    // Only 1 improving, need 2+ for a cluster
    expect(result).toEqual([]);
  });

  it('truncates name list when more than 5 sections', () => {
    const trends = Array.from({ length: 7 }, (_, i) =>
      makeTrend(`s${i}`, `Section ${i}`, 1, 10 + i)
    );
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);

    // Body names param should contain at most 5 section names
    const body = result[0].body!;
    // The highest traversal count sections should be listed
    expect(body).toContain('Section 6');
    expect(body).toContain('Section 5');
    expect(body).toContain('Section 4');
    expect(body).toContain('Section 3');
    expect(body).toContain('Section 2');
    // Section 0 and 1 have lowest traversal count, should be excluded from name list
    expect(body).not.toContain('Section 0');
    expect(body).not.toContain('Section 1');

    // But supporting data should still include up to 10
    expect(result[0].supportingData?.sections?.length).toBe(7);
  });

  // ---------------------------------------------------------------------------
  // Sport-type-aware grouping tests
  // ---------------------------------------------------------------------------

  it('groups sections by sport type before trend', () => {
    const trends = [
      { ...makeTrend('s1', 'Run Hill', 1), sportType: 'Run' },
      { ...makeTrend('s2', 'Run Valley', 1), sportType: 'Run' },
      { ...makeTrend('s3', 'Bike Climb', 1), sportType: 'Ride' },
      { ...makeTrend('s4', 'Bike Descent', 1), sportType: 'Ride' },
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(2);

    const runInsight = result.find((i) => i.id === 'section_cluster-improving-run');
    const rideInsight = result.find((i) => i.id === 'section_cluster-improving-ride');
    expect(runInsight).toBeDefined();
    expect(rideInsight).toBeDefined();
  });

  it('includes sport display name in title', () => {
    const trends = [
      { ...makeTrend('s1', 'Sprint', 1), sportType: 'Run' },
      { ...makeTrend('s2', 'Tempo', 1), sportType: 'Run' },
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);
    // Title now uses top section name, sport goes to subtitle
    expect(result[0].title).toContain('name: Sprint');
    expect(result[0].subtitle).toContain('sport: running');
  });

  it('uses empty sport for unknown sport types', () => {
    const trends = [
      { ...makeTrend('s1', 'A', 1), sportType: 'Kayak' },
      { ...makeTrend('s2', 'B', 1), sportType: 'Kayak' },
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toHaveLength(1);
    // Title uses top section name, sport goes to subtitle
    expect(result[0].title).toContain('name: A');
    expect(result[0].subtitle).toContain('sport: ');
  });

  it('does not cluster across sport types', () => {
    // 1 run improving + 1 ride improving = no cluster (need 2+ per sport)
    const trends = [
      { ...makeTrend('s1', 'Run A', 1), sportType: 'Run' },
      { ...makeTrend('s2', 'Ride B', 1), sportType: 'Ride' },
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result).toEqual([]);
  });

  it('carries sportType in supporting data sections', () => {
    const trends = [
      { ...makeTrend('s1', 'Hill A', 1), sportType: 'Run' },
      { ...makeTrend('s2', 'Hill B', 1), sportType: 'Run' },
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    expect(result[0].supportingData?.sections?.[0]?.sportType).toBe('Run');
    expect(result[0].supportingData?.sections?.[1]?.sportType).toBe('Run');
  });

  it('prioritises improving clusters over declining when exceeding MAX_CLUSTER_INSIGHTS', () => {
    const trends = [
      { ...makeTrend('s1', 'Run Up A', 1), sportType: 'Run' },
      { ...makeTrend('s2', 'Run Up B', 1), sportType: 'Run' },
      { ...makeTrend('s3', 'Ride Up A', 1), sportType: 'Ride' },
      { ...makeTrend('s4', 'Ride Up B', 1), sportType: 'Ride' },
      { ...makeTrend('s5', 'Run Down A', -1), sportType: 'Run' },
      { ...makeTrend('s6', 'Run Down B', -1), sportType: 'Run' },
    ];
    const result = generateSectionClusterInsights(trends, NOW, mockT);
    // 3 possible insights (2 improving + 1 declining), capped at 2
    expect(result.length).toBeLessThanOrEqual(2);
    // Both should be improving (higher priority)
    expect(result.every((i) => i.id.includes('improving'))).toBe(true);
  });
});
