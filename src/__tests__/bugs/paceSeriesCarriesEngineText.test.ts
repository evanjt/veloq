/**
 * Scenario: the stale record sheet and the pace milestone chart print a pace
 * series, and the engine sent each point's pace text beside its speed.
 *
 * Expected behaviour: a value that is one of the points reads that point's
 * text in the unit system shown, with the unit after it, and the record
 * effort's pace reads the engine's text for it. The texts here match no
 * speed's own format, so a point printed from its speed fails.
 */

import type { StalePrOpportunity } from 'veloqrs';

import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { seriesChartModel } from '@/features/insights/lib/seriesChart';
import { paceSeriesFormat } from '@/features/insights/lib/paceSeriesFormat';
import type { PaceTrend, SeriesPoint } from '@/features/insights/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const NOW = 1_700_000_000_000;
const DAY = 86_400;
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const points = (): SeriesPoint[] =>
  [3.0, 3.1, 3.2, 3.3, 3.4, 3.5].map((value, i) => ({
    value,
    date: 1_690_000_000 + i * DAY,
    metricText: `m-${i}`,
    imperialText: `i-${i}`,
  }));

describe('paceSeriesFormat', () => {
  const format = (isMetric: boolean) => paceSeriesFormat(points(), isMetric, '/u');

  it('reads a point by its value in the unit system shown', () => {
    expect(format(true)(3.2)).toBe('m-2/u');
    expect(format(false)(3.2)).toBe('i-2/u');
  });

  it('prints a value that is no point as nothing, never a speed formatted here', () => {
    expect(format(true)(3.25)).toBe('');
  });

  it('prints nothing for a series with no text', () => {
    expect(paceSeriesFormat([{ value: 3, date: 1 }], true)(3)).toBe('');
  });
});

describe('pace chart axis marks', () => {
  const model = (marksOnSamples: boolean) =>
    seriesChartModel(points(), { formatDate: String, invert: false, marksOnSamples });

  it('marks the top, middle and bottom at points, with no padding past the data', () => {
    const chart = model(true);
    expect(chart?.yMarks).toEqual([3.5, 3.2, 3.0]);
    expect(chart?.yDomain).toEqual([3.0, 3.5]);
  });

  it('marks an inverted series fastest value first', () => {
    const chart = seriesChartModel(points(), {
      formatDate: String,
      invert: true,
      marksOnSamples: true,
    });
    expect(chart?.yMarks).toEqual([3.0, 3.2, 3.5]);
  });

  it('prints every mark from the engine text, unlike the speed format', () => {
    const format = paceSeriesFormat(points(), true, '/km');
    expect(model(true)?.yMarks?.map(format)).toEqual(['m-5/km', 'm-2/km', 'm-0/km']);
  });

  it('pads the domain and marks no samples by default', () => {
    const chart = model(false);
    expect(chart?.yMarks).toBeUndefined();
    expect(chart!.yDomain[0]).toBeLessThan(3.0);
  });

  it('flags the stale record sheet and milestone pace series', () => {
    const [milestone] = generateFitnessMilestoneInsights(
      null,
      {
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
        history: points(),
      },
      null,
      NOW,
      t,
      true
    );
    const history = milestone?.supportingData?.history;
    expect(history && 'series' in history && history.series[0]?.marksOnSamples).toBe(true);
  });
});

describe('stale record sheet', () => {
  const opportunity = (over: Record<string, unknown>) =>
    ({
      sectionId: 'river',
      sectionName: 'river',
      bestTimeSecs: 1260,
      daysSinceLast: 45,
      traversalCount: 8,
      fitnessMetric: 'pace',
      currentValue: 3.5,
      previousValue: 3.0,
      currentMetricText: 'm-now',
      currentImperialText: 'i-now',
      previousMetricText: 'm-then',
      previousImperialText: 'i-then',
      gainPercent: 5,
      unit: '/km',
      sportType: 'Run',
      prDate: 1_690_000_000,
      prSpeed: 3.3,
      prSpeedMetricText: 'm-effort',
      prSpeedImperialText: 'i-effort',
      prSharePercent: 98,
      fitnessHistory: points(),
      recentEfforts: [],
      ...over,
    }) as unknown as StalePrOpportunity;

  const section = (isMetric: boolean, over: Record<string, unknown> = {}) => {
    const [insight] = generateStalePRInsights([opportunity(over)], t, NOW, isMetric);
    return insight.supportingData?.stalePrSections?.[0];
  };

  it('prints the fitness points and the record effort from the engine text', () => {
    const metric = section(true);
    expect(metric?.fitness.format?.(3.2)).toBe('m-2/km');
    expect(metric?.effort).toContain('m-effort/km');

    const imperial = section(false);
    expect(imperial?.fitness.format?.(3.2)).toBe('i-2/mi');
    expect(imperial?.effort).toContain('i-effort/mi');
  });

  it('prints no effort pace when the engine sent no text for it', () => {
    expect(section(true, { prSpeedMetricText: null })?.effort).toBeUndefined();
  });
});

describe('pace milestone chart', () => {
  const trend = (): PaceTrend => ({
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
    history: points(),
  });

  it('prints a history point from the engine text with the unit', () => {
    const [metric] = generateFitnessMilestoneInsights(null, trend(), null, NOW, t, true);
    const [imperial] = generateFitnessMilestoneInsights(null, trend(), null, NOW, t, false);

    const formatOf = (insight: typeof metric) => {
      const history = insight?.supportingData?.history;
      return history && 'series' in history ? history.series[0]?.format : undefined;
    };
    expect(formatOf(metric)?.(3.4)).toBe('m-4/km');
    expect(formatOf(imperial)?.(3.4)).toBe('i-4/mi');
  });
});
