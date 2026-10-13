/**
 * Scenario: the aerobic efficiency sheet printed its trend slope as
 * '-12.3457' and its chart ticks as bare five-digit numbers, so neither said
 * it was heart rate times pace, nor that the slope is per day.
 *
 * Expected behaviour: the series and the slope carry the unit of the formula
 * the method states, and the slope is as precise as its size needs.
 */

import { EfficiencyDirection, type EfficiencyTrend } from 'veloqrs';

import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { formatSeriesValue } from '@/features/insights/components/InsightHistoryChart';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const NOW = 1_700_000_000_000;
const t = (key: string) => (key === 'units.bpmSecondsPerKm' ? 'bpm·s/km' : key);

const trend = {
  sectionId: 'quarry-loop',
  sectionName: 'Quarry Loop',
  sportType: 'Run',
  points: [45200, 44900, 44400, 44100, 43800].map((hrPaceRatio, i) => ({
    date: 1_690_000_000 + i * 7 * 86_400,
    paceSecsPerKm: 300,
    avgHr: hrPaceRatio / 300,
    hrPaceRatio,
  })),
  trendSlope: -12.345678,
  direction: EfficiencyDirection.Improving,
  hrChangeBpm: -4.6,
  effortCount: 5,
} as EfficiencyTrend;

function insight() {
  const [card] = generateEfficiencyTrendInsights([trend], NOW, t);
  if (!card) throw new Error('no efficiency card');
  return card;
}

describe('the aerobic efficiency sheet', () => {
  it('gives the slope the unit of heart rate times pace per day', () => {
    const slope = insight().supportingData?.dataPoints?.find(
      (point) => point.label === 'insights.data.trendSlope'
    );

    expect(slope).toMatchObject({ value: '-12.3', unit: 'bpm·s/km/d' });
  });

  it('names the unit of the series it draws', () => {
    const history = insight().supportingData?.history;
    const series = history && 'series' in history ? history.series[0] : undefined;

    expect(series?.unit).toBe('bpm·s/km');
  });
});

describe('a supporting series value', () => {
  it('carries the series unit when it has one', () => {
    expect(formatSeriesValue(44100, 0, 'bpm·s/km')).toBe('44,100 bpm·s/km');
  });

  it('prints bare when the series has none', () => {
    expect(formatSeriesValue(3.5, 1, undefined)).toBe('3.5');
  });
});

describe('the slope precision', () => {
  function slopeOf(trendSlope: number) {
    const [card] = generateEfficiencyTrendInsights([{ ...trend, trendSlope }], NOW, t);
    return card?.supportingData?.dataPoints?.find(
      (point) => point.label === 'insights.data.trendSlope'
    )?.value;
  }

  it('never prints exponent notation for a large or a vanishing slope', () => {
    expect(slopeOf(-1234.5)).toBe('-1230');
    expect(slopeOf(0.00000012)).toBe('0');
  });
});
