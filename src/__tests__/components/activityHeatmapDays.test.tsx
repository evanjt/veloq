/**
 * Scenario: the activity calendar is a drawn grid. Its colour stands for the
 * day's longest session, and each day it draws holds activities a reader may
 * want to open.
 *
 * Expected behaviour: the legend names that measure and its four bins, every
 * day with activities is a control a screen reader announces with its date,
 * count and longest session, and pressing it opens that day's activities the
 * way the fitness strip does: one activity directly, several through the
 * day's picker.
 */

import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
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

const heatmapDays = jest.fn((_firstDay: string, _lastDay: string) => [
  { date: TWO_RUNS, intensity: 1, maxDuration: 55 * 60, activityCount: 2 },
  { date: ONE_RIDE, intensity: 2, maxDuration: 65 * 60, activityCount: 1 },
]);

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
  it('announces a day with its date, count and longest session', async () => {
    const view = await renderHeatmap();

    const ride = view.getByTestId(`activity-heatmap-day-${ONE_RIDE}`);
    expect(ride.props.accessibilityLabel).toBe('Jun 16, 2026, 1 activity, longest 1 h 5 min');
    expect(ride.props.accessibilityRole).toBe('button');

    const runs = view.getByTestId(`activity-heatmap-day-${TWO_RUNS}`);
    expect(runs.props.accessibilityLabel).toBe('Jun 15, 2026, 2 activities, longest 55 min');
  });

  it('leaves a day with no activity out of the controls', async () => {
    const view = await renderHeatmap();

    expect(view.queryByTestId(`activity-heatmap-day-${EMPTY_DAY}`)).toBeNull();
  });

  it('reads no activity until a day is pressed', async () => {
    await renderHeatmap();

    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });

  it('opens the activity directly on a one-activity day', async () => {
    const view = await renderHeatmap();

    await fireEvent.press(view.getByTestId(`activity-heatmap-day-${ONE_RIDE}`));
    await act(async () => {});

    expect(engine.getActivityBodies).toHaveBeenCalledWith(
      dayStartEpochSeconds(ONE_RIDE),
      expect.any(Number)
    );
    expect(pushedRoutes()).toEqual(['/activity/ride-1']);
  });

  it('opens the day picker with both activities and then the chosen one', async () => {
    const view = await renderHeatmap();

    void fireEvent.press(view.getByTestId(`activity-heatmap-day-${TWO_RUNS}`));
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

    expect(view.queryByTestId(`activity-heatmap-day-${ONE_RIDE}`)).toBeNull();
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

  it('keeps each day a control of its own beside the plot', async () => {
    const view = await renderHeatmap();

    expect(
      view
        .getByTestId('activity-heatmap-plot')
        .findAll((node) => node.props.testID === `activity-heatmap-day-${ONE_RIDE}`)
    ).toHaveLength(0);
    expect(view.getByTestId(`activity-heatmap-day-${ONE_RIDE}`)).toBeTruthy();
  });
});
