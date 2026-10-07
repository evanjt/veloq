/**
 * Scenario: the year heatmap read the engine's own intensity cache and then
 * looped a parsed array of activity bodies over the top of it, to fill dates it
 * believed the cache did not cover.
 *
 * Expected behaviour: the cache is the whole answer. It is derived from
 * `activity_metrics` on every metrics write (`write_activity_metrics`)
 * and rebuilt from that table by migration, and `activity_metrics` covers
 * exactly what `activity_bodies` covers, so there is nothing left to supplement.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet } from 'react-native';
import { RangeCoverage } from 'veloqrs';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { changeLanguage, initializeI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { CLOCK_EDGES, localDay } from '../__shared__/clockEdges';
import { trainingScreenRead } from '../__shared__/trainingScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const today = new Date().toISOString().slice(0, 10);

/** The heatmap part of the training screen read, asked over the drawn grid. */
const heatmapDays = jest.fn((_firstDay: string, _lastDay: string) => [
  { date: today, intensity: 3, maxDuration: 6000, activityCount: 1 },
]);

const engine = {
  subscribe: () => () => {},
  getTrainingScreenData: trainingScreenRead({ heatmap: heatmapDays }),
  getActivityBodies: jest.fn(() => []),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(async () => {
  await initializeI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('ActivityHeatmap', () => {
  it('reads the engine cache and no activity bodies', async () => {
    render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(heatmapDays).toHaveBeenCalled());
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });

  it('draws the grid from the cache alone', async () => {
    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    expect(heatmapDays).toHaveBeenCalled();
  });

  it('shows the empty state when the cache holds no day, rather than waiting for an array', async () => {
    heatmapDays.mockReturnValueOnce([]);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(heatmapDays).toHaveBeenCalled());
    expect(view.queryByTestId('activity-heatmap-count')).toBeNull();
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });
});

describe.each(CLOCK_EDGES)('ActivityHeatmap on %s', (_name, at) => {
  beforeEach(() => jest.setSystemTime(at));

  it('asks for the drawn grid, from its first Sunday to today, and counts today', async () => {
    heatmapDays.mockReturnValueOnce([
      { date: localDay(at), intensity: 3, maxDuration: 6000, activityCount: 1 },
    ]);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(heatmapDays).toHaveBeenCalled());
    const [startDate, endDate] = heatmapDays.mock.calls[0] as unknown as [string, string];
    expect(endDate).toBe(localDay(at));
    // Fifty-one whole weeks before the Sunday that opens this week.
    expect(startDate).toBe(localDay(at, -(51 * 7 + at.getDay())));
    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
  });
});

/** Today, `offset` local days from now, as the engine keys a heatmap row. */
function dayFrom(offset: number): string {
  return localDay(new Date(), offset);
}

describe('ActivityHeatmap header', () => {
  beforeEach(() => jest.setSystemTime(new Date(2026, 5, 17, 12, 0)));

  it('counts activities, not active days, and only those inside the grid', async () => {
    // Wednesday 17 June 2026: the grid opens on Sunday 22 June 2025, 360 days back.
    heatmapDays.mockReturnValueOnce([
      { date: dayFrom(-361), intensity: 2, maxDuration: 3600, activityCount: 1 },
      { date: dayFrom(-360), intensity: 1, maxDuration: 1800, activityCount: 1 },
      { date: dayFrom(-3), intensity: 0, maxDuration: 0, activityCount: 1 },
      { date: dayFrom(-1), intensity: 1, maxDuration: 1800, activityCount: 1 },
      { date: dayFrom(0), intensity: 3, maxDuration: 6000, activityCount: 2 },
    ]);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    expect(view.getByTestId('activity-heatmap-count')).toHaveTextContent(/^5 /);
  });

  it('counts a day whose only activity has no moving time', async () => {
    heatmapDays.mockReturnValueOnce([
      { date: dayFrom(-3), intensity: 0, maxDuration: 0, activityCount: 1 },
    ]);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    expect(view.getByTestId('activity-heatmap-count')).toHaveTextContent(/^1 /);
  });

  it.each([
    ['January', new Date(2026, 0, 15, 12, 0), 'Jan 19, 2025 to Jan 15, 2026'],
    ['July', new Date(2026, 6, 15, 12, 0), 'Jul 20, 2025 to Jul 15, 2026'],
    ['October', new Date(2026, 9, 15, 12, 0), 'Oct 19, 2025 to Oct 15, 2026'],
  ])('states the drawn range in %s', async (_name, at, range) => {
    jest.setSystemTime(at);
    heatmapDays.mockReturnValueOnce([
      { date: localDay(at), intensity: 3, maxDuration: 6000, activityCount: 1 },
    ]);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByTestId('activity-heatmap-range')).toBeTruthy());
    expect(view.getByTestId('activity-heatmap-range')).toHaveTextContent(range);
  });

  it('states no range on the empty state', async () => {
    heatmapDays.mockReturnValueOnce([]);
    engine.rangeCoverage.mockReturnValueOnce(RangeCoverage.Empty);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(heatmapDays).toHaveBeenCalled());
    expect(view.queryByTestId('activity-heatmap-range')).toBeNull();
  });
});

const MONTH_NAMES = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;

/** The left offset a label is drawn at, from itself or the view that holds it. */
function leftOf(node: ReturnType<ReturnType<typeof render>['getByText']>): number {
  let at: typeof node | null = node;
  while (at) {
    const left = StyleSheet.flatten(at.props.style)?.left;
    if (typeof left === 'number') return left;
    at = at.parent as typeof node | null;
  }
  throw new Error('a month label with no left offset');
}

describe('ActivityHeatmap month labels', () => {
  it('keeps the leftmost labels apart on 24 September 2026', async () => {
    jest.setSystemTime(new Date(2026, 8, 24, 12, 0));

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    const lefts = view
      .getAllByText(MONTH_NAMES)
      .map(leftOf)
      .sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i++) {
      expect(lefts[i] - lefts[i - 1]).toBeGreaterThanOrEqual(36);
    }
  });
});

describe('ActivityHeatmap year in view', () => {
  /** A 360 dp screen: 296 px inside the card, less the weekday gutter. */
  const VIEWPORT = 272;

  it('pins the year of the leftmost visible column and labels January with its own', async () => {
    jest.setSystemTime(new Date(2027, 0, 10, 12, 0));

    const view = render(<ActivityHeatmap />, { wrapper });
    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    fireEvent(view.getByTestId('activity-heatmap-scroll'), 'layout', {
      nativeEvent: { layout: { width: VIEWPORT, height: 100, x: 0, y: 0 } },
    });

    expect(view.getByTestId('activity-heatmap-year')).toHaveTextContent('2026');
    expect(view.getByText('2027')).toBeTruthy();
  });

  it.each([
    ['July', new Date(2026, 6, 15, 12, 0), '2026'],
    ['October', new Date(2026, 9, 15, 12, 0), '2026'],
    ['January', new Date(2026, 0, 15, 12, 0), '2025'],
  ])('shows a year in the opening view in %s', async (_name, at, year) => {
    jest.setSystemTime(at);
    heatmapDays.mockReturnValueOnce([
      { date: localDay(at), intensity: 3, maxDuration: 6000, activityCount: 1 },
    ]);

    const view = render(<ActivityHeatmap />, { wrapper });
    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    fireEvent(view.getByTestId('activity-heatmap-scroll'), 'layout', {
      nativeEvent: { layout: { width: VIEWPORT, height: 100, x: 0, y: 0 } },
    });

    expect(view.getByTestId('activity-heatmap-year')).toHaveTextContent(year);
  });

  it('follows the scroll back to the first column', async () => {
    jest.setSystemTime(new Date(2026, 8, 23, 12, 0));

    const view = render(<ActivityHeatmap />, { wrapper });
    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    const scroll = view.getByTestId('activity-heatmap-scroll');
    fireEvent(scroll, 'layout', {
      nativeEvent: { layout: { width: VIEWPORT, height: 100, x: 0, y: 0 } },
    });
    expect(view.getByTestId('activity-heatmap-year')).toHaveTextContent('2026');

    fireEvent.scroll(scroll, {
      nativeEvent: {
        contentOffset: { x: 0, y: 0 },
        contentSize: { width: 624, height: 84 },
        layoutMeasurement: { width: VIEWPORT, height: 84 },
      },
    });

    expect(view.getByTestId('activity-heatmap-year')).toHaveTextContent('2025');
  });
});

describe('ActivityHeatmap in the app language', () => {
  beforeAll(async () => {
    await initializeI18n();
    await changeLanguage('de-DE');
  });
  afterAll(async () => {
    await changeLanguage('en-US');
  });

  it('names months and weekdays in that language', async () => {
    jest.setSystemTime(new Date(2026, 9, 15, 12, 0));

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
    expect(view.getByText('Mo')).toBeTruthy();
    expect(view.getByText('Mi')).toBeTruthy();
    expect(view.getByText('Okt')).toBeTruthy();
  });
});

describe('ActivityHeatmap over a range never downloaded', () => {
  it('says the range is not downloaded rather than empty', async () => {
    heatmapDays.mockReturnValueOnce([]);
    engine.rangeCoverage.mockReturnValueOnce(RangeCoverage.NotFetched);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByText('Not downloaded yet')).toBeTruthy());
    expect(view.queryByText(/No activity data/)).toBeNull();
  });

  it('keeps the empty state for a range the census says is empty', async () => {
    heatmapDays.mockReturnValueOnce([]);
    engine.rangeCoverage.mockReturnValueOnce(RangeCoverage.Empty);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByText(/No activity data/)).toBeTruthy());
    expect(view.queryByText('Not downloaded yet')).toBeNull();
  });

  it('adds a quiet line when part of the drawn range is not downloaded', async () => {
    engine.rangeCoverage.mockReturnValueOnce(RangeCoverage.NotFetched);

    const view = render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(view.getByTestId('activity-heatmap-partial')).toBeTruthy());
  });

  it('asks the census about the drawn range', async () => {
    jest.setSystemTime(new Date(2026, 8, 23, 12, 0));

    render(<ActivityHeatmap />, { wrapper });

    await waitFor(() => expect(engine.rangeCoverage).toHaveBeenCalled());
    expect(engine.rangeCoverage).toHaveBeenCalledWith('2025-09-28', '2026-09-23');
  });
});
