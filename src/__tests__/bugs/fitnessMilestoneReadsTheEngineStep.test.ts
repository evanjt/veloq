/**
 * Scenario: the FTP step and the pace gain were subtracted in TypeScript from
 * trend records the engine returns, so the insights tab, the notification body
 * and the widget snapshot each had to repeat the arithmetic and the rounding to
 * state the same move.
 *
 * Expected behaviour: the generator renders the step the trend carries and
 * derives none of it. The gate stays here, the arithmetic does not.
 */

import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import type { FtpTrend, Insight, PaceTrend } from '@/features/insights/types';

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

function dataPoint(insight: Insight, label: string): string | number | undefined {
  return insight.supportingData?.dataPoints?.find((p) => p.label === label)?.value;
}

const ftp = (over: Partial<FtpTrend>): FtpTrend => ({
  latestFtp: 168,
  previousFtp: 155,
  latestDate: NOW,
  previousDate: NOW,
  sampleCount: 20,
  ...over,
});

const pace = (over: Partial<PaceTrend>): PaceTrend => ({
  latestPace: 3.5,
  previousPace: 3.2,
  latestDate: NOW,
  previousDate: NOW,
  sampleCount: 10,
  ...over,
});

describe('generateFitnessMilestoneInsights', () => {
  it('states the FTP step the trend carries', () => {
    const insight = generateFitnessMilestoneInsights(
      ftp({ deltaWatts: 13 }),
      null,
      null,
      NOW,
      t
    )[0];

    expect(dataPoint(insight, 'insights.data.change')).toBe('+13');
  });

  it('holds the step back when the trend carries none, rather than subtracting its own', () => {
    expect(generateFitnessMilestoneInsights(ftp({}), null, null, NOW, t)).toHaveLength(0);
  });

  it('keeps the watts threshold as a gate over the step the trend states', () => {
    const under = ftp({ latestFtp: 159, previousFtp: 155, deltaWatts: 4 });

    expect(generateFitnessMilestoneInsights(under, null, null, NOW, t)).toHaveLength(0);
  });

  it('states the pace gain and the seconds off the kilometre the trend carries', () => {
    const insight = generateFitnessMilestoneInsights(
      {},
      pace({ gainPercent: 9.375, deltaSeconds: 26.785714285 }),
      null,
      NOW,
      t
    )[0];

    expect(dataPoint(insight, 'insights.data.improvement')).toBe('+9%');
    expect(insight.title).toBe('insights.paceImproved');
  });

  it('holds the pace step back when the trend carries no move', () => {
    expect(generateFitnessMilestoneInsights({}, pace({}), null, NOW, t)).toHaveLength(0);
  });

  it('paces the swim trend in the unit the engine measured it in', () => {
    const insight = generateFitnessMilestoneInsights(
      {},
      null,
      pace({ latestPace: 1.25, previousPace: 1.0, gainPercent: 25, deltaSeconds: 20 }),
      NOW,
      t
    )[0];

    expect(dataPoint(insight, 'insights.data.improvement')).toBe('+25%');
  });
});
