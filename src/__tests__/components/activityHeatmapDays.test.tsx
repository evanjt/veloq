/**
 * Scenario: the activity calendar is a drawn grid. Its colour stands for the
 * day's longest session, and each day it draws holds activities a reader may
 * want to open.
 *
 * Expected behaviour: the legend names that measure and its four bins, every
 * day with activities is a cell a finger can press, and pressing it opens that
 * day's activities the way the fitness strip does: one activity directly,
 * several through the day's picker. A screen reader meets none of those cells:
 * it gets one adjustable element that steps through the active days, reads
 * each with its date, count and longest session, and opens the day it holds.
 */

import {
  act,
  fireEvent,
  isHiddenFromAccessibility,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { RangeCoverage } from 'veloqrs';

import ChartDataSheet from '@/app/sheets/chart-data';
import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { initialiseI18n } from '@/i18n';
import { chartStyles } from '@/theme';
import { getEngine } from '@/shared/native/engine';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { localDay } from '../__shared__/clockEdges';
import { fitnessScreenRead } from '../__shared__/fitnessScreenRead';
import { dayStartEpochSeconds } from '@/shared/time/startDate';
import { WithScreenRead } from '../__shared__/withScreenRead';

const mockPush = jest.fn();
const mockParams: { request?: string } = {};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const NOW = new Date(2026, 5, 17, 12, 0);
const TWO_RUNS = localDay(NOW, -2);
const ONE_RIDE = localDay(NOW, -1);
const EMPTY_DAY = localDay(NOW, -3);

const body = (id: string, name: string, type: string, day: string, hour: number, moving: number) =>
  JSON.stringify({
    id,
    name,
    type,
    start_date_local: `${day}T${String(hour).padStart(2, '0')}:00:00`,
    moving_time: moving,
    distance: 10_000,
    icu_training_load: 40,
  });

const BODIES: Record<string, string[]> = {
  [TWO_RUNS]: [
    body('run-am', 'Harbour loop', 'Run', TWO_RUNS, 7, 55 * 60),
    body('run-pm', 'Park loop', 'Run', TWO_RUNS, 18, 55 * 60),
  ],
  [ONE_RIDE]: [body('ride-1', 'Valley ride', 'Ride', ONE_RIDE, 9, 65 * 60)],
};

const TWO_DAYS = [
  { date: TWO_RUNS, intensity: 1, maxDuration: 55 * 60, activityCount: 2 },
  { date: ONE_RIDE, intensity: 2, maxDuration: 65 * 60, activityCount: 1 },
];

/** Twenty active days, every third day back from yesterday. */
const TWENTY_DAYS = Array.from({ length: 20 }, (_, i) => ({
  date: localDay(NOW, -1 - 3 * i),
  intensity: 1,
  maxDuration: 30 * 60,
  activityCount: 1,
}));

const heatmapDays = jest.fn((_firstDay: string, _lastDay: string) => TWO_DAYS);

const engine = {
  subscribe: () => () => {},
  getFitnessScreenData: fitnessScreenRead({ heatmap: heatmapDays }),
  getActivityBodies: jest.fn((start: number, _end: number) => {
    const day = Object.keys(BODIES).find((d) => dayStartEpochSeconds(d) === start);
    const bodies = day ? BODIES[day] : [];
    return {
      bodies,
      intervalsIds: bodies.map(() => null),
      keys: bodies.map((body) => (JSON.parse(body) as { id: string }).id),
    };
  }),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const pushedRoutes = () => mockPush.mock.calls.map(([target]) => target);

/** A day's cell, which a finger reaches and a screen reader does not. */
const dayCell = (view: Awaited<ReturnType<typeof render>>, date: string) =>
  view.getByTestId(`activity-heatmap-day-${date}`, { includeHiddenElements: true });

const step = async (node: ReactTestInstance, actionName: string) => {
  await act(async () => {
    node.props.onAccessibilityAction({ nativeEvent: { actionName } });
  });
};

async function renderHeatmap(props: { drawn?: boolean } = {}) {
  const view = await render(
    <WithScreenRead>
      {(training) => <ActivityHeatmap training={training} {...props} />}
    </WithScreenRead>,
    { wrapper }
  );
  await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
  return view;
}

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  delete mockParams.request;
  jest.setSystemTime(NOW);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('ActivityHeatmap legend', () => {
  it('names the longest session and its four bins', async () => {
    const view = await renderHeatmap();

    expect(view.getByText('Longest session')).toBeTruthy();
    expect(view.getByText('Under 1 h')).toBeTruthy();
    expect(view.getByText('1 to 1.5 h')).toBeTruthy();
    expect(view.getByText('1.5 to 2 h')).toBeTruthy();
    expect(view.getByText('Over 2 h')).toBeTruthy();
    expect(view.queryByText('Less')).toBeNull();
    expect(view.queryByText('More')).toBeNull();
  });
});

describe('ActivityHeatmap labels', () => {
  it('sets the month, weekday and legend labels at the chart label size or above', async () => {
    const view = await renderHeatmap();

    for (const part of [
      'activity-heatmap-months',
      'activity-heatmap-gutter',
      'activity-heatmap-legend',
    ]) {
      const labels = view.getByTestId(part).findAll((node) => node.type === Text);
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        const style = StyleSheet.flatten(label.props.style) as { fontSize?: number };
        expect(style.fontSize).toBeGreaterThanOrEqual(chartStyles.chartLabel.fontSize);
      }
    }
  });
});

describe('ActivityHeatmap days', () => {
  it('leaves a day with no activity out of the cells', async () => {
    const view = await renderHeatmap();

    expect(
      view.queryByTestId(`activity-heatmap-day-${EMPTY_DAY}`, { includeHiddenElements: true })
    ).toBeNull();
  });

  it('reads no activity until a day is pressed', async () => {
    await renderHeatmap();

    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });

  it('opens the activity directly on a one-activity day', async () => {
    const view = await renderHeatmap();

    await fireEvent.press(dayCell(view, ONE_RIDE));
    await act(async () => {});

    expect(engine.getActivityBodies).toHaveBeenCalledWith(
      dayStartEpochSeconds(ONE_RIDE),
      expect.any(Number)
    );
    expect(pushedRoutes()).toEqual(['/activity/ride-1']);
  });

  it('opens the day picker with both activities and then the chosen one', async () => {
    const view = await renderHeatmap();

    void fireEvent.press(dayCell(view, TWO_RUNS));
    await act(async () => {});
    const sheet = pushedRoutes()[0];
    expect(sheet.pathname).toBe('sheets/day-activities');

    mockParams.request = sheet.params.request;
    const reader = await renderHook(() =>
      useSheetRequest<{ activities: { id: string; movingTime: number }[] }, string>()
    );
    expect(reader.result.current.input?.activities.map((a) => a.id).sort()).toEqual([
      'run-am',
      'run-pm',
    ]);
    expect(reader.result.current.input?.activities[0].movingTime).toBe(55 * 60);
    await act(() => reader.result.current.resolve('run-pm'));
    await reader.unmount();
    await act(async () => {});

    expect(pushedRoutes().at(-1)).toBe('/activity/run-pm');
  });

  it('mounts no day controls while the grid is held undrawn', async () => {
    const view = await renderHeatmap({ drawn: false });

    expect(
      view.queryByTestId(`activity-heatmap-day-${ONE_RIDE}`, { includeHiddenElements: true })
    ).toBeNull();
    expect(view.queryByRole('adjustable')).toBeNull();
  });
});

describe('ActivityHeatmap days for a screen reader', () => {
  it('is one adjustable element over twenty active days, with no day cell of its own', async () => {
    heatmapDays.mockReturnValueOnce(TWENTY_DAYS);
    const view = await renderHeatmap();

    expect(view.queryAllByRole('button', { name: /activity/ })).toHaveLength(0);
    for (const day of TWENTY_DAYS) {
      expect(isHiddenFromAccessibility(dayCell(view, day.date))).toBe(true);
    }
    const calendar = view.getAllByRole('adjustable');
    expect(calendar).toHaveLength(1);
    expect(calendar[0].props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(
      expect.arrayContaining(['increment', 'decrement'])
    );
  });

  it('holds the latest active day and reads its date, count and longest session', async () => {
    const view = await renderHeatmap();

    const calendar = view.getByRole('adjustable');
    expect(calendar.props.accessibilityLabel).toBe('Activity calendar');
    expect(calendar.props.accessibilityValue).toEqual({
      text: 'Jun 16, 2026, 1 activity, longest 1 h 5 min',
    });
  });

  it('steps back and forward through the active days and stops at either end', async () => {
    const view = await renderHeatmap();
    const value = () => view.getByRole('adjustable').props.accessibilityValue.text;

    await step(view.getByRole('adjustable'), 'increment');
    expect(value()).toBe('Jun 16, 2026, 1 activity, longest 1 h 5 min');

    await step(view.getByRole('adjustable'), 'decrement');
    expect(value()).toBe('Jun 15, 2026, 2 activities, longest 55 min');

    await step(view.getByRole('adjustable'), 'decrement');
    expect(value()).toBe('Jun 15, 2026, 2 activities, longest 55 min');

    await step(view.getByRole('adjustable'), 'increment');
    expect(value()).toBe('Jun 16, 2026, 1 activity, longest 1 h 5 min');
  });

  it('marks the day it holds on the grid', async () => {
    const view = await renderHeatmap();

    await step(view.getByRole('adjustable'), 'decrement');

    const highlight = view.getByTestId('activity-heatmap-highlight', {
      includeHiddenElements: true,
    });
    const cell = StyleSheet.flatten(dayCell(view, TWO_RUNS).props.style) as {
      left: number;
      top: number;
    };
    const mark = StyleSheet.flatten(highlight.props.style) as { left: number; top: number };
    expect(mark.left - cell.left).toBe(mark.top - cell.top);
    expect(Math.abs(mark.left - cell.left)).toBeLessThan(4);
  });

  it('opens the day it holds when activated', async () => {
    const view = await renderHeatmap();

    await step(view.getByRole('adjustable'), 'activate');
    await act(async () => {});

    expect(pushedRoutes()).toEqual(['/activity/ride-1']);
  });
});

describe('ActivityHeatmap read without seeing it', () => {
  it('speaks the days trained and the longest session, and lists each day with activities', async () => {
    const view = await renderHeatmap();

    const plot = view.getByTestId('activity-heatmap-plot');
    expect(plot.props.accessibilityRole).toBe('image');
    expect(plot.props.accessibilityLabel).toMatch(
      /^Activity calendar, .+ to Jun 17, 2026: active on 2 of \d+ days\. Peak 1 h 5 min on Jun 16, 2026\.$/
    );

    await act(async () => {
      plot.props.onAccessibilityAction({ nativeEvent: { actionName: 'showData' } });
    });
    const sheet = pushedRoutes().at(-1);
    expect(sheet.pathname).toBe('sheets/chart-data');
    mockParams.request = sheet.params.request;
    const table = await render(<ChartDataSheet />);
    expect(table.getAllByTestId(/^chart-data-row-/)).toHaveLength(2);
  });

  it('keeps the day cells and the stepped days beside the plot', async () => {
    const view = await renderHeatmap();

    const plot = view.getByTestId('activity-heatmap-plot');
    expect(
      plot.findAll((node) => node.props.testID === `activity-heatmap-day-${ONE_RIDE}`)
    ).toHaveLength(0);
    expect(plot.findAll((node) => node.props.accessibilityRole === 'adjustable')).toHaveLength(0);
    expect(dayCell(view, ONE_RIDE)).toBeTruthy();
  });
});
