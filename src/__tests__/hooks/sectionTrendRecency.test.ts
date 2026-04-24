import { generateSectionTrendInsights } from '@/hooks/insights/sectionTrendInsights';
import { INSIGHTS_CONFIG } from '@/hooks/insights/config';
import type { SectionTrendData } from '@/hooks/insights/types';

const mockT = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key;
  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `${key} {${paramStr}}`;
};

const NOW = 1_700_000_000_000;

function trend(
  id: string,
  daysSinceLast: number | undefined,
  traversalCount = 5,
  trendDir: -1 | 0 | 1 = 1
): SectionTrendData {
  return {
    sectionId: id,
    sectionName: `Section ${id}`,
    trend: trendDir,
    medianRecentSecs: 120,
    bestTimeSecs: 110,
    traversalCount,
    daysSinceLast,
    latestIsPr: false,
  };
}

describe('generateSectionTrendInsights — recency gate (regression)', () => {
  it('drops sections with daysSinceLast outside activeWindowDays', () => {
    // User's reported bug: a section visited 3 months ago surfaced as a top
    // insight. With the recency gate, it should be dropped.
    const stale = trend('stale', 90, 5, 1);
    const result = generateSectionTrendInsights([stale], new Set(), NOW, mockT);
    expect(result).toHaveLength(0);
  });

  it('keeps a recently-visited old section (event recency, not section age)', () => {
    // A section you first rode 2 years ago but beat yesterday — the
    // daysSinceLast is 1, so it passes. Section age is irrelevant.
    const freshEffort = trend('recent', 1, 5, 1);
    const result = generateSectionTrendInsights([freshEffort], new Set(), NOW, mockT);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('section_trend-recent');
  });

  it('keeps section when daysSinceLast is unknown (not filtered out)', () => {
    // Conservative: if we don't know when it was last visited, don't
    // preemptively drop it. The rules-pipeline G1 gate acts as defence in
    // depth via meta.sourceTimestamp.
    const unknown = trend('unknown', undefined, 5, 1);
    const result = generateSectionTrendInsights([unknown], new Set(), NOW, mockT);
    expect(result).toHaveLength(1);
  });

  it('boundary: exactly at activeWindowDays passes, 1 day beyond rejects', () => {
    const boundary = INSIGHTS_CONFIG.activeWindowDays;
    const atBoundary = trend('at', boundary, 5, 1);
    const justBeyond = trend('beyond', boundary + 1, 5, 1);

    expect(generateSectionTrendInsights([atBoundary], new Set(), NOW, mockT)).toHaveLength(1);
    expect(generateSectionTrendInsights([justBeyond], new Set(), NOW, mockT)).toHaveLength(0);
  });

  it('attaches meta.sourceTimestamp matching daysSinceLast', () => {
    const section = trend('s1', 7, 5, 1);
    const [insight] = generateSectionTrendInsights([section], new Set(), NOW, mockT);
    expect(insight.meta?.sourceTimestamp).toBe(NOW - 7 * 86_400_000);
    expect(insight.meta?.comparisonKind).toBe('self');
    expect(insight.meta?.repetitionCount).toBe(5);
  });
});
