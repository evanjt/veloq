/**
 * Scenario: a section ridden and run, or ridden and gravel-ridden, yields one
 * claim per sport. Titles and bodies named only the section, so two cards read
 * alike, and sheet rows keyed on the section alone shared state.
 *
 * Expected behaviour: every claim names its own sport from the activity-type
 * labels, and a (section, sport) pair is the row key.
 */

import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import {
  generateStalePRInsights,
  stalePROpportunityToInsight,
  type StalePROpportunity,
} from '@/features/insights/generators/stalePr';
import type { StalePrOpportunity } from 'veloqrs';
import { sectionRowKey } from '@/features/insights/lib/cardSport';
import type { SectionPR, SectionTrendData } from '@/features/insights/types';

const NOW = 1_700_000_000_000;
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const pr = (sportType?: string): SectionPR => ({
  sectionId: 'cedar',
  sectionName: 'Cedar Hill',
  bestTime: 300,
  daysAgo: 2,
  ...(sportType ? { sportType } : {}),
  traversalCount: 6,
});

const trend = (sportType?: string): SectionTrendData => ({
  sectionId: 'cedar',
  sectionName: 'Cedar Hill',
  trend: 1,
  medianRecentSecs: 320,
  bestTimeSecs: 300,
  traversalCount: 8,
  sportType,
  daysSinceLast: 3,
  latestIsPr: false,
});

const stale = (sectionId: string, sportType: string): StalePrOpportunity => ({
  sectionId,
  sectionName: 'Cedar Hill',
  bestTimeSecs: 263,
  daysSinceLast: 10,
  traversalCount: 9,
  fitnessMetric: 'power',
  currentValue: 220,
  previousValue: 200,
  gainPercent: 10,
  unit: 'W',
  sportType,
  recentEfforts: [],
});

describe('a section PR card', () => {
  it('names its own sport in the title when it is the only card', () => {
    const [run] = generateSectionPRInsights([pr('Run')], NOW, t);
    const [ride] = generateSectionPRInsights([pr('Ride')], NOW, t);
    expect(run.title).toContain('activityTypes.Run');
    expect(ride.title).toContain('activityTypes.Ride');
    expect(run.title).not.toBe(ride.title);
  });

  it('keeps the plain section name when the record carries no sport', () => {
    const [insight] = generateSectionPRInsights([pr(undefined)], NOW, t);
    expect(insight.title).not.toContain('activityTypes');
  });
});

describe('a section trend card', () => {
  it('carries each sport on its drill-down row', () => {
    const [run] = generateSectionTrendInsights([trend('Run')], new Set(), NOW, t);
    const [gravel] = generateSectionTrendInsights([trend('GravelRide')], new Set(), NOW, t);
    expect(run.supportingData?.sections?.[0]?.sportType).toBe('Run');
    expect(gravel.supportingData?.sections?.[0]?.sportType).toBe('GravelRide');
  });

  it('keeps a row without a sport distinct from a sport row', () => {
    const [insight] = generateSectionTrendInsights([trend(undefined)], new Set(), NOW, t);
    expect(insight.supportingData?.sections?.[0]?.sportType).toBeUndefined();
  });
});

describe('a stale PR card', () => {
  it('names its own sport in the title', () => {
    const insight = stalePROpportunityToInsight(stale('a', 'Run') as StalePROpportunity, t, NOW);
    expect(insight.title).toContain('activityTypes.Run');
  });

  it('names each sport in the group body, Ride apart from GravelRide', () => {
    const [group] = generateStalePRInsights([stale('a', 'Ride'), stale('b', 'GravelRide')], t, NOW);
    const named = (key: string, params?: Record<string, string | number>) =>
      key === 'insights.sectionWithSport' ? `${params?.name} / ${params?.sport}` : (key as string);
    const [namedGroup] = generateStalePRInsights(
      [stale('a', 'Ride'), stale('b', 'GravelRide')],
      named,
      NOW
    );
    expect(namedGroup.body).toBe(
      'Cedar Hill / activityTypes.Ride, Cedar Hill / activityTypes.GravelRide'
    );
    expect(group.body).toContain('activityTypes.GravelRide');
  });
});

describe('the sheet row key', () => {
  it('differs between sports on the same section', () => {
    expect(sectionRowKey({ sectionId: 'cedar', sportType: 'Run' })).not.toBe(
      sectionRowKey({ sectionId: 'cedar', sportType: 'Ride' })
    );
  });

  it('does not depend on position', () => {
    expect(sectionRowKey({ sectionId: 'cedar', sportType: 'Run' })).toBe(
      sectionRowKey({ sectionId: 'cedar', sportType: 'Run' })
    );
  });

  it('is stable for a row with no sport', () => {
    expect(sectionRowKey({ sectionId: 'cedar' })).toBe('cedar:');
  });
});
