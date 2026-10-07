/**
 * Scenario: an athlete on imperial units reads running pace per kilometre and
 * swim pace per 100 m on the pace milestone and the stale record card, with the
 * engine's metric change in seconds per kilometre printed under a mile label.
 *
 * Expected behaviour: each pace figure, its suffix and the change in it follow
 * the unit preference.
 */

import type { StalePrOpportunity } from 'veloqrs';

import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import type { Insight, PaceTrend } from '@/features/insights/types';
import {
  formatPaceFromSecsPerKm,
  paceSecondsForUnit,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format/format';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const NOW = 1_700_000_000_000;
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const trend = (over: Partial<PaceTrend>): PaceTrend => ({
  latestPace: 3.5,
  previousPace: 3.2,
  latestDate: NOW,
  previousDate: NOW,
  sampleCount: 10,
  gainPercent: 9,
  deltaSeconds: 10,
  ...over,
});

const point = (insight: Insight, label: string) =>
  insight.supportingData?.dataPoints?.find((p) => p.label === label);

describe('pace unit labels', () => {
  it('names the unit the preference reads', () => {
    expect(paceUnitLabel(true)).toBe('/km');
    expect(paceUnitLabel(false)).toBe('/mi');
    expect(swimPaceUnitLabel(true)).toBe('/100m');
    expect(swimPaceUnitLabel(false)).toBe('/100yd');
  });

  it('converts a change in seconds per kilometre to seconds per mile', () => {
    expect(paceSecondsForUnit(10, 'run', true)).toBe(10);
    expect(paceSecondsForUnit(10, 'run', false)).toBeCloseTo(16.09, 1);
  });

  it('converts a change in seconds per 100 m to seconds per 100 yd', () => {
    expect(paceSecondsForUnit(10, 'swim', true)).toBe(10);
    expect(paceSecondsForUnit(10, 'swim', false)).toBeCloseTo(9.14, 1);
  });

  it('formats a seconds-per-kilometre pace per mile when imperial', () => {
    expect(formatPaceFromSecsPerKm(300, true)).toBe('5:00');
    expect(formatPaceFromSecsPerKm(300, false)).toBe('8:03');
    expect(formatPaceFromSecsPerKm(0, false)).toBe('--:--');
  });
});

describe('pace milestone under imperial units', () => {
  it('states the run pace per mile with the change in seconds per mile', () => {
    const [insight] = generateFitnessMilestoneInsights(null, trend({}), null, NOW, t, false);

    expect(insight.title).toContain('"delta":"16s/mi"');
    expect(point(insight, 'insights.data.currentPace')).toMatchObject({
      value: '7:40',
      unit: '/mi',
    });
    expect(point(insight, 'insights.data.previousPace')).toMatchObject({ unit: '/mi' });
  });

  it('states the swim pace per 100 yd with the change in seconds per 100 yd', () => {
    const [insight] = generateFitnessMilestoneInsights(
      null,
      null,
      trend({ latestPace: 1.2, previousPace: 1.1, deltaSeconds: 8 }),
      NOW,
      t,
      false
    );

    expect(insight.title).toContain('"delta":"7s/100yd"');
    expect(point(insight, 'insights.data.currentPace')).toMatchObject({
      value: '1:16',
      unit: '/100yd',
    });
  });

  it('keeps the metric figures when metric', () => {
    const [insight] = generateFitnessMilestoneInsights(null, trend({}), null, NOW, t, true);

    expect(insight.title).toContain('"delta":"10s/km"');
    expect(point(insight, 'insights.data.currentPace')).toMatchObject({
      value: '4:46',
      unit: '/km',
    });
  });
});

function opportunity(unit: '/km' | '/100m', current: number, previous: number, id = 'river') {
  return {
    sectionId: id,
    sectionName: id,
    bestTimeSecs: 1260,
    daysSinceLast: 45,
    traversalCount: 8,
    fitnessMetric: 'pace',
    currentValue: current,
    previousValue: previous,
    gainPercent: 5,
    unit,
    sportType: unit === '/km' ? 'Run' : 'Swim',
  } as unknown as StalePrOpportunity;
}

describe('stale record card under imperial units', () => {
  it('prints a run pace per mile', () => {
    const [insight] = generateStalePRInsights([opportunity('/km', 3.5, 3.2)], t, NOW, false);

    expect(insight.subtitle).toContain('7:40/mi');
    expect(insight.subtitle).not.toContain('/km');
    expect(
      point(
        insight,
        'insights.stalePr.currentMetric {"metric":"insights.stalePr.metricRunningCriticalSpeed"}'
      )
    ).toMatchObject({
      value: '7:40',
      unit: '/mi',
    });
  });

  it('prints a swim pace per 100 yd', () => {
    const [insight] = generateStalePRInsights([opportunity('/100m', 1.2, 1.1)], t, NOW, false);

    expect(insight.subtitle).toContain('1:16/100yd');
    expect(insight.subtitle).not.toContain('/100m');
  });

  it('prints the group card paces per mile and per 100 yd', () => {
    const [group] = generateStalePRInsights(
      [opportunity('/km', 3.5, 3.2, 'a'), opportunity('/100m', 1.2, 1.1, 'b')],
      t,
      NOW,
      false
    );

    expect(group.subtitle).toContain('7:40/mi');
    expect(group.subtitle).toContain('1:16/100yd');
    expect(group.subtitle).not.toContain('/km');
    expect(group.subtitle).not.toContain('/100m');
  });

  it('keeps metric units when metric', () => {
    const [insight] = generateStalePRInsights([opportunity('/km', 3.5, 3.2)], t, NOW, true);

    expect(insight.subtitle).toContain('4:46/km');
  });
});
