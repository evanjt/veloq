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
import { paceSecondsForUnit, paceUnitLabel, swimPaceUnitLabel } from '@/shared/format/format';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const NOW = 1_700_000_000_000;
const t = (key: string, params?: Record<string, string | number>) =>
  key === 'units.secondsValue'
    ? `${params?.value} s`
    : params
      ? `${key} ${JSON.stringify(params)}`
      : key;

const trend = (over: Partial<PaceTrend>): PaceTrend => ({
  latestPace: 3.5,
  previousPace: 3.2,
  latestPaceMetricText: 'm-now',
  latestPaceImperialText: 'i-now',
  previousPaceMetricText: 'm-then',
  previousPaceImperialText: 'i-then',
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
  vaultIt('names the unit the preference reads', () => {
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
});

describe('pace milestone under imperial units', () => {
  it('states the run pace per mile with the change in seconds per mile', () => {
    const [insight] = generateFitnessMilestoneInsights(null, trend({}), null, NOW, t, false);

    expect(insight.title).toContain('"delta":"16 s/mi"');
    expect(point(insight, 'insights.data.currentPace')).toMatchObject({
      value: 'i-now',
      unit: '/mi',
    });
    expect(point(insight, 'insights.data.previousPace')).toMatchObject({
      value: 'i-then',
      unit: '/mi',
    });
  });

  it('states the swim pace per 100 yd with the change in seconds per 100 yd', () => {
    const [insight] = generateFitnessMilestoneInsights(
      null,
      null,
      trend({
        latestPace: 1.2,
        previousPace: 1.1,
        latestPaceImperialText: 'swim-i-now',
        deltaSeconds: 8,
      }),
      NOW,
      t,
      false
    );

    expect(insight.title).toContain('"delta":"7 s/100yd"');
    expect(point(insight, 'insights.data.currentPace')).toMatchObject({
      value: 'swim-i-now',
      unit: '/100yd',
    });
  });

  it('keeps the metric figures when metric', () => {
    const [insight] = generateFitnessMilestoneInsights(null, trend({}), null, NOW, t, true);

    expect(insight.title).toContain('"delta":"10 s/km"');
    expect(point(insight, 'insights.data.currentPace')).toMatchObject({
      value: 'm-now',
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
    currentMetricText: `m-${id}-now`,
    currentImperialText: `i-${id}-now`,
    previousMetricText: `m-${id}-then`,
    previousImperialText: `i-${id}-then`,
    gainPercent: 5,
    unit,
    sportType: unit === '/km' ? 'Run' : 'Swim',
  } as unknown as StalePrOpportunity;
}

describe('stale record card under imperial units', () => {
  it('prints a run pace per mile', () => {
    const [insight] = generateStalePRInsights([opportunity('/km', 3.5, 3.2)], t, NOW, false);

    expect(insight.subtitle).toContain('i-river-now/mi');
    expect(insight.subtitle).toContain('i-river-then/mi');
    expect(insight.subtitle).not.toContain('/km');
    expect(
      point(
        insight,
        'insights.stalePr.currentMetric {"metric":"insights.stalePr.metricRunningCriticalSpeed"}'
      )
    ).toMatchObject({
      value: 'i-river-now',
      unit: '/mi',
    });
  });

  it('prints a swim pace per 100 yd', () => {
    const [insight] = generateStalePRInsights([opportunity('/100m', 1.2, 1.1)], t, NOW, false);

    expect(insight.subtitle).toContain('i-river-now/100yd');
    expect(insight.subtitle).not.toContain('/100m');
  });

  it('prints the group card paces per mile and per 100 yd', () => {
    const [group] = generateStalePRInsights(
      [opportunity('/km', 3.5, 3.2, 'a'), opportunity('/100m', 1.2, 1.1, 'b')],
      t,
      NOW,
      false
    );

    expect(group.subtitle).toContain('i-a-now/mi');
    expect(group.subtitle).toContain('i-b-now/100yd');
    expect(group.subtitle).not.toContain('/km');
    expect(group.subtitle).not.toContain('/100m');
  });

  it('keeps metric units when metric', () => {
    const [insight] = generateStalePRInsights([opportunity('/km', 3.5, 3.2)], t, NOW, true);

    expect(insight.subtitle).toContain('m-river-now/km');
  });
});
