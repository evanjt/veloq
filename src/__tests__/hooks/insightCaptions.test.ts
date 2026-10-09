/**
 * Scenario: the card's caption sits under its graphic and states the number
 * the graphic shows. The HRV, weekly comparison and fitness milestone cards
 * carried no caption, and the number they showed came from a metric beside
 * the card that the graphic replaced.
 *
 * Expected behaviour: each caption states its numbers, the latest against the
 * mean, the week against the one compared, the estimate against the earlier
 * one, and never a reading of the athlete's state.
 */

import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type { StrengthSummary } from '@/features/strength/types';
import type { TFunc } from '@/features/insights/types';
import { datedSeries } from '../__shared__/datedSeries';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const t: TFunc = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
const NOW = Date.UTC(2026, 8, 20);
const DAY = 86_400;

const stats = (totalTss: number, totalDuration = 4 * 3600, count = 4) => ({
  count,
  totalDuration,
  totalDistance: 100_000,
  totalTss,
});

describe('insight card captions', () => {
  it('states the latest HRV against the window mean', () => {
    const [card] = generateHrvTrendInsight(
      {
        label: 'trendingDown',
        avg: 61.6,
        latest: 57.6,
        dataPoints: 7,
        sparkline: datedSeries([64, 63, 63, 62, 61, 60, 58]),
      },
      NOW,
      t
    );

    expect(card.subtitle).toBe('insights.caption.latestAgainstMean:{"latest":58,"avg":62}');
  });

  it('states this week against last week in the comparison unit', () => {
    const [card] = generatePeriodComparisonInsights(
      stats(450),
      stats(340),
      stats(1300),
      [],
      { metric: 'tss', current: 450, previous: 340, ratio: 450 / 340 - 1 },
      null,
      NOW,
      t
    );

    expect(card.subtitle).toBe(
      'insights.caption.thisWeekAgainstLast:{"current":"450 TSS","previous":"340 TSS"}'
    );
  });

  it('states a rest week against the four-week average in time', () => {
    const [card] = generatePeriodComparisonInsights(
      stats(0, 0, 0),
      stats(100, 2 * 3600),
      stats(800, 24 * 3600),
      [],
      null,
      { metric: 'duration', current: 2 * 3600, previous: 6 * 3600, ratio: -2 / 3 },
      NOW,
      t
    );

    expect(card.subtitle).toBe(
      'insights.caption.lastWeekAgainstAverage:{"current":"2h","previous":"6h"}'
    );
  });

  it('states the eFTP against the one it was compared with', () => {
    const cards = generateFitnessMilestoneInsights(
      {
        latestFtp: 252,
        previousFtp: 240,
        deltaWatts: 12,
        latestDate: NOW / 1000,
        previousDate: NOW / 1000 - 30 * DAY,
        sampleCount: 31,
      },
      null,
      null,
      NOW,
      t
    );

    expect(cards[0]?.subtitle).toBe('insights.caption.fromTo:{"previous":"240W","current":"252W"}');
  });

  it('states the pace against the earlier one in the athlete unit', () => {
    const cards = generateFitnessMilestoneInsights(
      null,
      {
        latestPace: 4.2,
        previousPace: 4.0,
        gainPercent: 5,
        deltaSeconds: 12,
        latestDate: NOW / 1000,
        previousDate: NOW / 1000 - 20 * DAY,
        sampleCount: 6,
      },
      null,
      NOW,
      t
    );

    expect(cards[0]?.subtitle).toMatch(
      /^insights\.caption\.fromTo:\{"previous":"4:10\/km","current":"3:58\/km"\}$/
    );
  });

  it('reads a section PR time the way the rest of the app does', () => {
    const caption = (bestTime: number) =>
      generateSectionPRInsights(
        [{ sectionId: 's1', sectionName: 'Orchard Lane', bestTime, daysAgo: 2, traversalCount: 5 }],
        NOW,
        t
      )[0]?.subtitle ?? '';

    // 59.7 s past the minute rounds to 60 on its own and once read "1:60".
    expect(caption(119.7)).toContain('"time":"1:59"');
    expect(caption(65)).toContain('"time":"1:05"');
    expect(caption(3725)).toContain('"time":"1:02:05"');
    for (let secs = 100; secs < 130; secs += 0.1) {
      const time = JSON.parse(caption(secs).split(':').slice(1).join(':')).time as string;
      expect(Number(time.split(':')[1])).toBeLessThan(60);
    }
  });

  it('states the balance ratio beside the sets on each side', () => {
    const summary: StrengthSummary = {
      muscleVolumes: [],
      activityCount: 4,
      totalSets: 17,
      maxWeightedSets: 12,
      balance: [
        {
          id: 'press_pull',
          leftSlug: 'chest',
          rightSlug: 'upper-back',
          leftWeightedSets: 12,
          rightWeightedSets: 5,
          dominantSlug: 'chest',
          ratio: 2.4,
          status: 'watch',
        },
      ],
    } as unknown as StrengthSummary;
    const balance = generateStrengthInsights(summary, [summary], [], NOW, t).find(
      (insight) => insight.category === 'strength_balance'
    );

    expect(balance?.subtitle).toMatch(/ 12 · .* 5 · 2\.4x$/);
  });
});
