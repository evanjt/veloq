/**
 * Scenario: the heatmap and season cards each asked the engine for their own
 * part, a call per part and a refresh rule per card, though every part is
 * fixed for as long as the tab stays mounted.
 *
 * Expected behaviour: the two cards paint from the fitness screen read over
 * the windows they draw, one call on mount and one when activities change,
 * and neither reaches for a per-part read.
 */

import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet } from 'react-native';
import { RangeCoverage, type FitnessScreenWindows } from 'veloqrs';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { SeasonComparison } from '@/features/stats/components/SeasonComparison';
import { HEATMAP_PITCH, HEATMAP_WEEKS } from '@/features/stats/lib/heatmapGrid';
import { initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import {
  NO_FITNESS_PARTS,
  noComparisons,
  summaryComparison,
} from '../__shared__/fitnessScreenRead';
import { CLOCK_EDGES, localDay } from '../__shared__/clockEdges';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const listeners = new Map<string, Set<() => void>>();

async function emit(event: string) {
  await act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
}

const totals = (count: number, hours: number) => ({
  count,
  totalDuration: hours * 3600,
  totalDistance: count * 10_000,
  totalTss: count * 50,
});

const engine = {
  subscribe: jest.fn((event: string, cb: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(event, set);
    return () => set.delete(cb);
  }),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
  getFitnessScreenData: jest.fn((_spanDays: number[], windows: FitnessScreenWindows) => ({
    ...NO_FITNESS_PARTS,
    heatmap: [{ date: windows.heatmapLastDay, intensity: 3, maxDuration: 6000, activityCount: 2 }],
    months: [{ year: new Date().getFullYear(), month: 1, stats: totals(2, 4) }],
    seasonYear: summaryComparison(windows.nowWallSeconds, {
      currentStats: totals(2, 4),
      previousStats: totals(1, 2),
    }),
    seasonMonths: [
      summaryComparison(windows.nowWallSeconds, {
        currentStats: totals(1, 1),
        previousStats: totals(0, 0),
      }),
    ],
    comparisons: noComparisons(windows.nowWallSeconds),
  })),
  getActivityHeatmap: jest.fn(() => []),
  getMonthlyStats: jest.fn(() => []),
};

function renderCards() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WithScreenRead>
        {(training) => (
          <>
            <ActivityHeatmap training={training} />
            <SeasonComparison training={training} />
          </>
        )}
      </WithScreenRead>
    </QueryClientProvider>
  );
}

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('the fitness screen read behind the calendar cards', () => {
  it('paints both cards from one call and no per-part read', async () => {
    const view = await renderCards();

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    expect(view.getByText('4h')).toBeTruthy();
    expect(view.getByText('2h')).toBeTruthy();
    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(1);
    expect(engine.getActivityHeatmap).not.toHaveBeenCalled();
    expect(engine.getMonthlyStats).not.toHaveBeenCalled();
  });

  it('reads once more when activities change, not once per card', async () => {
    const view = await renderCards();
    await waitFor(() => expect(view.getByText('4h')).toBeTruthy());

    await emit('activities');

    await waitFor(() => expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(2));
  });

  it('ignores an event the read does not depend on', async () => {
    const view = await renderCards();
    await waitFor(() => expect(view.getByText('4h')).toBeTruthy());

    await emit('sections');

    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(1);
  });
});

describe.each(CLOCK_EDGES)('the fitness screen read on %s', (_name, at) => {
  beforeEach(() => jest.setSystemTime(at));

  it('names the heatmap grid, the two calendar years and the to-date spans by the local calendar', async () => {
    await renderCards();

    await waitFor(() => expect(engine.getFitnessScreenData).toHaveBeenCalled());
    const [, windows] = engine.getFitnessScreenData.mock.calls[0] as [
      number[],
      FitnessScreenWindows,
    ];
    const iso = (ts: number) => new Date(ts * 1000).toISOString();
    const year = at.getFullYear();

    // Fifty-one whole weeks before the Monday that opens this week, to today.
    expect(windows.heatmapFirstDay).toBe(localDay(at, -(51 * 7 + ((at.getDay() + 6) % 7))));
    expect(windows.heatmapLastDay).toBe(localDay(at));
    expect(iso(windows.months.startTs)).toBe(`${year - 1}-01-01T00:00:00.000Z`);
    expect(iso(windows.months.endTs)).toBe(`${localDay(at)}T23:59:59.000Z`);
    expect(iso(windows.yearCurrent.startTs)).toBe(`${year}-01-01T00:00:00.000Z`);
    expect(iso(windows.yearCurrent.endTs)).toBe(`${localDay(at)}T23:59:59.000Z`);
    expect(iso(windows.yearPrevious.startTs)).toBe(`${year - 1}-01-01T00:00:00.000Z`);
    expect(iso(windows.monthCurrent.startTs).slice(0, 10)).toBe(localDay(at, 1 - at.getDate()));
    expect(iso(windows.monthPrevious.startTs).slice(0, 4)).toBe(`${year - 1}`);
  });
});

describe('the calendar draws the span the read answers', () => {
  // Sunday 18 October 2026; a first sync holds back to Monday 20 July.
  beforeEach(() => jest.setSystemTime(new Date(2026, 9, 18, 10, 0)));

  function answer(calendarFirstDay: string, calendarOlderOwed: number) {
    engine.getFitnessScreenData.mockImplementation(
      (_spanDays: number[], windows: FitnessScreenWindows) => ({
        ...NO_FITNESS_PARTS,
        heatmap: [
          { date: windows.heatmapLastDay, intensity: 3, maxDuration: 6000, activityCount: 2 },
        ],
        calendarFirstDay,
        calendarOlderOwed,
        months: [],
        seasonYear: summaryComparison(windows.nowWallSeconds, {
          currentStats: totals(2, 4),
          previousStats: totals(1, 2),
        }),
        seasonMonths: [
          summaryComparison(windows.nowWallSeconds, {
            currentStats: totals(1, 1),
            previousStats: totals(0, 0),
          }),
        ],
        comparisons: noComparisons(windows.nowWallSeconds),
      })
    );
  }

  const gridWidth = (view: Awaited<ReturnType<typeof renderCards>>) =>
    StyleSheet.flatten(view.getByTestId('activity-heatmap-months').props.style).width;

  afterEach(() => engine.getFitnessScreenData.mockReset());

  it('draws the weeks from the first day held and counts the older ones owed', async () => {
    answer('2026-07-20', 37);
    const view = await renderCards();

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    expect(gridWidth(view)).toBe(13 * HEATMAP_PITCH);
    expect(view.getByTestId('activity-heatmap-older-owed')).toHaveTextContent(
      '37 older activities this year are not downloaded'
    );
  });

  it('grows the grid on the read after a widened window, and drops the count', async () => {
    answer('2026-07-20', 37);
    const view = await renderCards();
    await waitFor(() => expect(gridWidth(view)).toBe(13 * HEATMAP_PITCH));

    answer('2025-10-20', 0);
    await emit('activities');

    await waitFor(() => expect(gridWidth(view)).toBe(HEATMAP_WEEKS * HEATMAP_PITCH));
    expect(view.queryByTestId('activity-heatmap-older-owed')).toBeNull();
  });

  it('names one older activity in the singular', async () => {
    answer('2026-07-20', 1);
    const view = await renderCards();

    await waitFor(() =>
      expect(view.getByTestId('activity-heatmap-older-owed')).toHaveTextContent(
        '1 older activity this year is not downloaded'
      )
    );
  });
});
