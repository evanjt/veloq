/**
 * Scenario: a section with this month's attempts and an excluded attempt the
 * athlete reviews with the eye toggle.
 *
 * Expected behaviour: the dimmed points are the excluded attempts the screen
 * read returned for the chosen range and sport, so the chart's axis and its
 * sport follow the pills. The hook reads nothing of its own.
 */

import { renderHook } from '@testing-library/react-native';
import { useSectionChartDataEnriched } from '@/features/routes/hooks/useSectionChartDataEnriched';
import { getEngine } from '@/shared/native/engine';
import type { FfiSectionChartPoint } from 'veloqrs';
import type { PerformanceDataPoint } from '@/types';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const counted: (PerformanceDataPoint & { x: number })[] = [
  {
    x: 0,
    id: 'ride_now_lap0',
    activityId: 'ride_now',
    speed: 4,
    date: new Date('2026-09-25T00:00:00Z'),
    activityName: 'Ride now',
    direction: 'same',
    sectionTime: 200,
    sectionDistance: 800,
    lapCount: 1,
  },
];

const excludedPoint: FfiSectionChartPoint = {
  lapId: 'ride_x_lap0',
  activityId: 'ride_x',
  activityName: 'Ride x',
  activityDate: 1_790_000_000,
  speed: 3.1,
  sectionTime: 260,
  sectionDistance: 800,
  direction: 'reverse',
  isBest: false,
};

describe('useSectionChartDataEnriched', () => {
  beforeEach(() => {
    (getEngine as jest.Mock).mockReturnValue({});
  });

  it('draws the excluded attempts the screen read returned, flagged', () => {
    const { result } = renderHook(() =>
      useSectionChartDataEnriched({
        chartData: counted,
        showExcluded: true,
        excludedPoints: [excludedPoint],
        preComputedCalendarSummary: null,
      })
    );

    const excluded = result.current.combinedChartData.filter((p) => p.isExcluded);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]).toMatchObject({
      id: 'ride_x_lap0',
      activityId: 'ride_x',
      speed: 3.1,
      sectionTime: 260,
      direction: 'reverse',
      isExcluded: true,
    });
    expect(result.current.combinedChartData).toHaveLength(2);
  });

  it('draws none while they are hidden', () => {
    const { result } = renderHook(() =>
      useSectionChartDataEnriched({
        chartData: counted,
        showExcluded: false,
        excludedPoints: [excludedPoint],
        preComputedCalendarSummary: null,
      })
    );

    expect(result.current.combinedChartData.some((p) => p.isExcluded)).toBe(false);
  });

  it('keeps the record flag the engine set rather than re-picking the fastest point', () => {
    const tied = counted.map((p, i) => ({ ...p, speed: 4, isBest: i === 0 }));
    const { result } = renderHook(() =>
      useSectionChartDataEnriched({
        chartData: [
          ...tied,
          { ...tied[0], id: 'faster_lap0', activityId: 'faster', speed: 9, isBest: false, x: 1 },
        ],
        showExcluded: false,
        excludedPoints: [],
        preComputedCalendarSummary: null,
      })
    );

    expect(result.current.combinedChartData.map((p) => [p.activityId, p.isBest])).toEqual([
      ['ride_now', true],
      ['faster', false],
    ]);
  });
});
