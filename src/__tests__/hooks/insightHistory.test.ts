import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { historyRange } from '@/features/insights/lib/sparkline';
import type { InsightHistory } from '@/features/insights/types';
import type { EfficiencyTrend, StalePrOpportunity } from 'veloqrs';

const t = (key: string) => key;
const NOW = 1_700_000_000_000;
const DAY = 86_400;

/** The values at a history's top and bottom edge, printed in its series' own unit. */
function printedEdges(history: InsightHistory | undefined) {
  if (!history || !('series' in history)) throw new Error('no dated history');
  const [first] = history.series;
  const format = first?.format;
  if (!format) throw new Error('the series carries no formatter');
  const range = historyRange(
    history.kind,
    history.series.flatMap((s) => s.points.map((point) => point.value))
  );
  return { top: format(range.top), bottom: format(range.bottom) };
}

describe('insight card histories', () => {
  it('marks the best effort and opens its activity', () => {
    const [card] = generateSectionPRInsights(
      [
        {
          sectionId: 'ridge',
          sectionName: 'Ridge',
          bestTime: 240,
          daysAgo: 1,
          traversalCount: 4,
          bestActivityId: 'ride-2',
          recentEfforts: [
            { value: 260, date: DAY, activityId: 'ride-1' },
            { value: 240, date: DAY * 2, activityId: 'ride-2' },
            { value: 250, date: DAY * 3, activityId: 'ride-3' },
            { value: 255, date: DAY * 4, activityId: 'ride-4' },
            { value: 245, date: DAY * 5, activityId: 'ride-5' },
            { value: 250, date: DAY * 6, activityId: 'ride-6' },
          ],
        },
      ],
      NOW,
      t
    );

    expect(card.supportingData?.history).toEqual({
      kind: 'timeline',
      series: [
        {
          label: 'insights.data.recentEfforts',
          format: expect.any(Function),
          points: [
            { value: 260, date: DAY, activityId: 'ride-1' },
            { value: 240, date: DAY * 2, activityId: 'ride-2' },
            { value: 250, date: DAY * 3, activityId: 'ride-3' },
            { value: 255, date: DAY * 4, activityId: 'ride-4' },
            { value: 245, date: DAY * 5, activityId: 'ride-5' },
            { value: 250, date: DAY * 6, activityId: 'ride-6' },
          ],
        },
      ],
      mark: { date: DAY * 2 },
      target: '/section/ridge?activityId=ride-2',
    });
    expect(printedEdges(card.supportingData?.history)).toEqual({ top: '4:00', bottom: '4:20' });
  });

  it('does not mark a best effort outside the capped tail', () => {
    const [card] = generateSectionPRInsights(
      [
        {
          sectionId: 'ridge',
          sectionName: 'Ridge',
          bestTime: 220,
          daysAgo: 10,
          traversalCount: 4,
          bestActivityId: 'older-ride',
          recentEfforts: [
            { value: 260, date: DAY },
            { value: 250, date: DAY * 2 },
            { value: 240, date: DAY * 3 },
            { value: 245, date: DAY * 4 },
            { value: 255, date: DAY * 5 },
            { value: 250, date: DAY * 6 },
          ],
        },
      ],
      NOW,
      t
    );
    expect(card.supportingData?.history).not.toHaveProperty('mark');
  });

  it('marks the stale record at its activity', () => {
    const row = {
      sectionId: 'ridge',
      sectionName: 'Ridge',
      bestTimeSecs: 240,
      daysSinceLast: 60,
      traversalCount: 4,
      fitnessMetric: 'power',
      currentValue: 260,
      previousValue: 240,
      gainPercent: 8,
      unit: 'W',
      sportType: 'Ride',
      bestActivityId: 'ride-2',
      recentEfforts: [
        { value: 260, date: DAY, activityId: 'ride-1' },
        { value: 240, date: DAY * 2, activityId: 'ride-2' },
        { value: 250, date: DAY * 3, activityId: 'ride-3' },
        { value: 255, date: DAY * 4, activityId: 'ride-4' },
        { value: 245, date: DAY * 5, activityId: 'ride-5' },
        { value: 250, date: DAY * 6, activityId: 'ride-6' },
      ],
    } as StalePrOpportunity;
    const [card] = generateStalePRInsights([row], t, NOW);
    expect(card.supportingData?.history).toMatchObject({
      kind: 'timeline',
      mark: { date: DAY * 2 },
      target: '/section/ridge?activityId=ride-2',
      series: [{ points: row.recentEfforts }],
    });
  });

  function hrvCard(readings: number) {
    const [card] = generateHrvTrendInsight(
      {
        label: 'trendingUp',
        avg: 52,
        latest: 55,
        dataPoints: readings,
        sparkline: Array.from({ length: readings }, (_, index) => ({
          value: 50 + index,
          date: DAY * (index + 1),
        })),
      },
      NOW,
      t
    );
    return card;
  }

  it('omits a history of five readings, too few to draw', () => {
    expect(hrvCard(5).supportingData?.history).toBeUndefined();
  });

  it('draws a history from six readings', () => {
    expect(hrvCard(6).supportingData?.history).toMatchObject({ kind: 'sparkline' });
  });

  it('marks the HRV split over dated readings', () => {
    const [card] = generateHrvTrendInsight(
      {
        label: 'trendingUp',
        avg: 52,
        latest: 55,
        dataPoints: 6,
        windowSplit: DAY * 2,
        sparkline: [
          { value: 50, date: DAY },
          { value: 52, date: DAY * 2 },
          { value: 55, date: DAY * 3 },
          { value: 53, date: DAY * 4 },
          { value: 54, date: DAY * 5 },
          { value: 55, date: DAY * 6 },
        ],
      },
      NOW,
      t
    );
    expect(card.supportingData?.history).toMatchObject({
      kind: 'sparkline',
      mark: { from: DAY * 2, to: DAY * 6 },
      series: [
        {
          points: [
            { date: DAY },
            { date: DAY * 2 },
            { date: DAY * 3 },
            { date: DAY * 4 },
            { date: DAY * 5 },
            { date: DAY * 6 },
          ],
        },
      ],
    });
  });

  it('marks the matched efficiency efforts', () => {
    const trend = {
      sectionId: 'ridge',
      sectionName: 'Ridge',
      sportType: 'Ride',
      points: [1, 2, 3, 4, 5, 6].map((day, index) => ({
        date: day * DAY,
        paceSecsPerKm: 240,
        avgHr: 150,
        hrPaceRatio: 36000 - index * 100,
      })),
      trendSlope: -100,
      direction: 0,
      hrChangeBpm: -5,
      effortCount: 6,
    } as EfficiencyTrend;
    const [card] = generateEfficiencyTrendInsights([trend], NOW, t);
    expect(card.supportingData?.history).toMatchObject({
      kind: 'sparkline',
      mark: { from: DAY, to: DAY * 6 },
      target: '/section/ridge',
      series: [
        {
          points: [
            { date: DAY, value: 36000 },
            { date: DAY * 2, value: 35900 },
            { date: DAY * 3, value: 35800 },
            { date: DAY * 4, value: 35700 },
            { date: DAY * 5, value: 35600 },
            { date: DAY * 6, value: 35500 },
          ],
        },
      ],
    });
  });

  it('marks the FTP and pace comparison dates', () => {
    const previousDate = 1_700_000_000;
    const latestDate = previousDate + DAY * 2;
    const points = [1, 2, 3, 4, 5, 6].map((day) => ({
      value: 220 + day * 10,
      date: previousDate + (day - 1) * DAY,
    }));
    const cards = generateFitnessMilestoneInsights(
      {
        previousFtp: 220,
        latestFtp: 250,
        deltaWatts: 30,
        previousDate,
        latestDate,
        sampleCount: 3,
        history: points,
      },
      {
        previousPace: 3,
        latestPace: 3.5,
        gainPercent: 16,
        deltaSeconds: 20,
        previousDate,
        latestDate,
        sampleCount: 3,
        history: points,
      },
      null,
      NOW,
      t
    );
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.supportingData?.history).toMatchObject({
        kind: 'sparkline',
        mark: { from: previousDate, to: latestDate },
        series: [{ points }],
      });
      expect(card.supportingData?.history).toMatchObject({
        target: expect.stringContaining('/fitness?date='),
      });
    }
  });

  it('uses engine week starts for bars and marks the compared week', () => {
    const week = (totalTss: number) => ({
      count: 2,
      totalDuration: 3600,
      totalDistance: 1,
      totalTss,
    });
    const [card] = generatePeriodComparisonInsights(
      week(400),
      week(300),
      week(200),
      [
        { start: DAY, stats: week(100), partial: false },
        { start: DAY * 8, stats: week(200), partial: false },
        { start: DAY * 15, stats: week(300), partial: false },
        { start: DAY * 22, stats: week(250), partial: false },
        { start: DAY * 29, stats: week(350), partial: false },
        { start: DAY * 36, stats: week(400), partial: false },
      ],
      { metric: 'tss', current: 400, previous: 300, ratio: 1 / 3, comparedStart: DAY * 15 },
      null,
      NOW,
      t
    );
    expect(card.supportingData?.history).toMatchObject({
      kind: 'bars',
      mark: { date: DAY * 15 },
      series: [
        {
          points: [
            { date: DAY, value: 100 },
            { date: DAY * 8, value: 200 },
            { date: DAY * 15, value: 300 },
            { date: DAY * 22, value: 250 },
            { date: DAY * 29, value: 350 },
            { date: DAY * 36, value: 400 },
          ],
        },
      ],
    });
  });

  it('carries the decoded section line', () => {
    const points = [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ];
    const [card] = generateSectionChangedInsights(
      [{ sectionId: 'ridge', sectionName: 'Ridge', kind: 'recut', at: NOW, points }],
      NOW,
      t
    );
    expect(card.supportingData?.history).toEqual({
      kind: 'line',
      points,
      target: '/section/ridge',
    });
  });
});

describe('the values a history prints at its edges, in its own unit', () => {
  const hrvCard = () =>
    generateHrvTrendInsight(
      {
        label: 'trendingUp',
        avg: 52,
        latest: 55,
        dataPoints: 6,
        windowSplit: DAY * 2,
        sparkline: [
          { value: 50.4, date: DAY },
          { value: 52, date: DAY * 2 },
          { value: 55.2, date: DAY * 3 },
          { value: 53, date: DAY * 4 },
          { value: 51, date: DAY * 5 },
          { value: 54, date: DAY * 6 },
        ],
      },
      NOW,
      t
    )[0];

  it('prints the fastest time at the top of a stale record timeline', () => {
    const [card] = generateStalePRInsights(
      [
        {
          sectionId: 'ridge',
          sectionName: 'Ridge',
          bestTimeSecs: 240,
          daysSinceLast: 60,
          traversalCount: 4,
          fitnessMetric: 'power',
          currentValue: 260,
          previousValue: 240,
          gainPercent: 8,
          unit: 'W',
          sportType: 'Ride',
          bestActivityId: 'ride-2',
          recentEfforts: [
            { value: 260, date: DAY, activityId: 'ride-1' },
            { value: 240, date: DAY * 2, activityId: 'ride-2' },
            { value: 250, date: DAY * 3, activityId: 'ride-3' },
            { value: 255, date: DAY * 4, activityId: 'ride-4' },
            { value: 245, date: DAY * 5, activityId: 'ride-5' },
            { value: 250, date: DAY * 6, activityId: 'ride-6' },
          ],
        } as StalePrOpportunity,
      ],
      t,
      NOW
    );
    expect(printedEdges(card.supportingData?.history)).toEqual({ top: '4:00', bottom: '4:20' });
  });

  it('prints the highest reading at the top of the HRV sparkline, in milliseconds', () => {
    expect(printedEdges(hrvCard().supportingData?.history)).toEqual({
      top: '55 ms',
      bottom: '50 ms',
    });
  });

  it('prints the FTP and threshold pace in their units, the faster pace at the top', () => {
    const previousDate = 1_700_000_000;
    const latestDate = previousDate + DAY * 2;
    const watts = [230, 240, 235, 245, 240, 250].map((value, index) => ({
      value,
      date: previousDate + index * DAY,
    }));
    const speeds = [3, 3.2, 3.1, 3.3, 3.4, 3.5].map((value, index) => ({
      value,
      date: previousDate + index * DAY,
    }));
    const [ftp, pace] = generateFitnessMilestoneInsights(
      {
        previousFtp: 230,
        latestFtp: 250,
        deltaWatts: 20,
        previousDate,
        latestDate,
        sampleCount: 3,
        history: watts,
      },
      {
        previousPace: 3,
        latestPace: 3.5,
        gainPercent: 16,
        deltaSeconds: 20,
        previousDate,
        latestDate,
        sampleCount: 3,
        history: speeds,
      },
      null,
      NOW,
      t
    );
    expect(printedEdges(ftp.supportingData?.history)).toEqual({ top: '250 W', bottom: '230 W' });
    // 3.5 m/s is 4:46 a kilometre and 3 m/s is 5:33.
    expect(printedEdges(pace.supportingData?.history)).toEqual({
      top: '4:46/km',
      bottom: '5:33/km',
    });
  });

  it('prints the tallest week and the zero line of weekly bars', () => {
    const week = (totalTss: number, totalDuration = 3600) => ({
      count: 2,
      totalDuration,
      totalDistance: 1,
      totalTss,
    });
    const weeks = [
      { start: DAY, stats: week(100, 3600), partial: false },
      { start: DAY * 8, stats: week(320, 7200), partial: false },
      { start: DAY * 15, stats: week(300, 5400), partial: false },
      { start: DAY * 22, stats: week(250, 3600), partial: false },
      { start: DAY * 29, stats: week(200, 5400), partial: false },
      { start: DAY * 36, stats: week(150, 3600), partial: false },
    ];
    const [byLoad] = generatePeriodComparisonInsights(
      week(400),
      week(300),
      week(200),
      weeks,
      { metric: 'tss', current: 400, previous: 300, ratio: 1 / 3, comparedStart: 0 },
      null,
      NOW,
      t
    );
    expect(printedEdges(byLoad.supportingData?.history)).toEqual({ top: '320', bottom: '0' });

    const [byTime] = generatePeriodComparisonInsights(
      week(0, 9000),
      week(0, 5400),
      week(0, 3600),
      weeks.map((row) => ({ ...row, stats: { ...row.stats, totalTss: 0 } })),
      { metric: 'duration', current: 9000, previous: 5400, ratio: 2 / 3, comparedStart: 0 },
      null,
      NOW,
      t
    );
    expect(printedEdges(byTime.supportingData?.history)).toEqual({ top: '2 h', bottom: '0 s' });
  });

  it('prints the efficiency scale in heart rate times pace', () => {
    const [card] = generateEfficiencyTrendInsights(
      [
        {
          sectionId: 'ridge',
          sectionName: 'Ridge',
          sportType: 'Ride',
          points: [35900, 35800, 35700, 35750, 35850, 35800].map((hrPaceRatio, index) => ({
            date: (index + 1) * DAY,
            paceSecsPerKm: 240,
            avgHr: 150,
            hrPaceRatio,
          })),
          trendSlope: -100,
          direction: 0,
          hrChangeBpm: -5,
          effortCount: 6,
        } as EfficiencyTrend,
      ],
      NOW,
      t
    );
    expect(printedEdges(card.supportingData?.history)).toEqual({
      top: '35900 units.bpmSecondsPerKm',
      bottom: '35700 units.bpmSecondsPerKm',
    });
  });
});
