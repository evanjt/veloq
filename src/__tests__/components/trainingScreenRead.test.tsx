/**
 * Scenario: the training tab's heatmap and season cards each asked the engine
 * for their own part, a call per part and a refresh rule per card, though
 * every part is fixed for as long as the tab stays mounted.
 *
 * Expected behaviour: the two cards paint from one screen read over the
 * windows they draw, one call on mount and one when activities change, and
 * neither reaches for a per-part read.
 */

import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RangeCoverage, type TrainingScreenWindows } from 'veloqrs';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { SeasonComparison } from '@/features/stats/components/SeasonComparison';
import { initializeI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { CLOCK_EDGES, localDay } from '../__shared__/clockEdges';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const listeners = new Map<string, Set<() => void>>();

function emit(event: string) {
  act(() => {
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
  getTrainingScreenData: jest.fn((windows: TrainingScreenWindows) => ({
    heatmap: [{ date: windows.heatmapLastDay, intensity: 3, maxDuration: 6000, activityCount: 2 }],
    months: [{ year: new Date().getFullYear(), month: 1, stats: totals(2, 4) }],
    yearCurrent: totals(2, 4),
    yearPrevious: totals(1, 2),
    monthCurrent: totals(1, 1),
    monthPrevious: totals(0, 0),
  })),
  getActivityHeatmap: jest.fn(() => []),
  getMonthlyStats: jest.fn(() => []),
  getPeriodStats: jest.fn(() => totals(0, 0)),
};

function renderCards() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivityHeatmap />
      <SeasonComparison />
    </QueryClientProvider>
  );
}

beforeAll(async () => {
  await initializeI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('the training screen read', () => {
  it('paints both cards from one call and no per-part read', async () => {
    const view = renderCards();

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    expect(view.getByText('4h')).toBeTruthy();
    expect(view.getByText('2h')).toBeTruthy();
    expect(engine.getTrainingScreenData).toHaveBeenCalledTimes(1);
    expect(engine.getActivityHeatmap).not.toHaveBeenCalled();
    expect(engine.getMonthlyStats).not.toHaveBeenCalled();
    expect(engine.getPeriodStats).not.toHaveBeenCalled();
  });

  it('reads once more when activities change, not once per card', async () => {
    const view = renderCards();
    await waitFor(() => expect(view.getByText('4h')).toBeTruthy());

    emit('activities');

    await waitFor(() => expect(engine.getTrainingScreenData).toHaveBeenCalledTimes(2));
  });

  it('ignores an event the read does not depend on', async () => {
    const view = renderCards();
    await waitFor(() => expect(view.getByText('4h')).toBeTruthy());

    emit('sections');

    expect(engine.getTrainingScreenData).toHaveBeenCalledTimes(1);
  });
});

describe.each(CLOCK_EDGES)('the training screen read on %s', (_name, at) => {
  beforeEach(() => jest.setSystemTime(at));

  it('names the heatmap grid, the two calendar years and the to-date spans by the local calendar', async () => {
    renderCards();

    await waitFor(() => expect(engine.getTrainingScreenData).toHaveBeenCalled());
    const [windows] = engine.getTrainingScreenData.mock.calls[0] as [TrainingScreenWindows];
    const iso = (ts: number) => new Date(ts * 1000).toISOString();
    const year = at.getFullYear();

    // Fifty-one whole weeks before the Sunday that opens this week, to today.
    expect(windows.heatmapFirstDay).toBe(localDay(at, -(51 * 7 + at.getDay())));
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
