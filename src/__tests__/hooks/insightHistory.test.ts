import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import type { EfficiencyTrend, StalePrOpportunity } from 'veloqrs';

const t = (key: string) => key;
const NOW = 1_700_000_000_000;
const DAY = 86_400;

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
          points: [
            { value: 260, date: DAY, activityId: 'ride-1' },
            { value: 240, date: DAY * 2, activityId: 'ride-2' },
            { value: 250, date: DAY * 3, activityId: 'ride-3' },
          ],
        },
      ],
      mark: { date: DAY * 2 },
      target: '/section/ridge?activityId=ride-2',
    });
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

  it('omits a history shorter than three readings', () => {
    const [card] = generateHrvTrendInsight(
      {
        label: 'trendingUp',
        avg: 52,
        latest: 55,
        dataPoints: 2,
        sparkline: [
          { value: 50, date: DAY },
          { value: 55, date: DAY * 2 },
        ],
      },
      NOW,
      t
    );
    expect(card.supportingData?.history).toBeUndefined();
  });

  it('marks the HRV split over dated readings', () => {
    const [card] = generateHrvTrendInsight(
      {
        label: 'trendingUp',
        avg: 52,
        latest: 55,
        dataPoints: 3,
        windowSplit: DAY * 2,
        sparkline: [
          { value: 50, date: DAY },
          { value: 52, date: DAY * 2 },
          { value: 55, date: DAY * 3 },
        ],
      },
      NOW,
      t
    );
    expect(card.supportingData?.history).toMatchObject({
      kind: 'sparkline',
      mark: { from: DAY * 2, to: DAY * 3 },
      series: [{ points: [{ date: DAY }, { date: DAY * 2 }, { date: DAY * 3 }] }],
    });
  });

  it('marks the matched efficiency efforts', () => {
    const trend = {
      sectionId: 'ridge',
      sectionName: 'Ridge',
      sportType: 'Ride',
      points: [1, 2, 3, 4].map((day, index) => ({
        date: day * DAY,
        paceSecsPerKm: 240,
        avgHr: 150,
        hrPaceRatio: 36000 - index * 100,
      })),
      trendSlope: -100,
      direction: 0,
      hrChangeBpm: -5,
      effortCount: 4,
    } as EfficiencyTrend;
    const [card] = generateEfficiencyTrendInsights([trend], NOW, t);
    expect(card.supportingData?.history).toMatchObject({
      kind: 'sparkline',
      mark: { from: DAY, to: DAY * 4 },
      target: '/section/ridge',
      series: [
        {
          points: [
            { date: DAY, value: 36000 },
            { date: DAY * 2, value: 35900 },
            { date: DAY * 3, value: 35800 },
            { date: DAY * 4, value: 35700 },
          ],
        },
      ],
    });
  });

  it('marks the FTP and pace comparison dates', () => {
    const previousDate = 1_700_000_000;
    const latestDate = previousDate + DAY * 2;
    const points = [1, 2, 3].map((day) => ({
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
      expect(card.supportingData?.history?.target).toContain('/fitness?date=');
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
        { start: DAY, stats: week(100) },
        { start: DAY * 8, stats: week(200) },
        { start: DAY * 15, stats: week(300) },
      ],
      { metric: 'tss', current: 400, previous: 300, ratio: 1 / 3 },
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
