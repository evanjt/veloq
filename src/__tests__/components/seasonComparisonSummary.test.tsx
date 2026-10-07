/**
 * The season comparison card's summary and tooltip: which series each value
 * belongs to, the change between the years, and what it says about a range the
 * device never downloaded.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage } from 'veloqrs';

import { SeasonComparison } from '@/features/stats/components/SeasonComparison';
import { changeLanguage, initializeI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { trainingScreenRead } from '../__shared__/trainingScreenRead';

let mockOnStart: ((event: { x: number }) => void) | undefined;

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-native-gesture-handler', () => {
  const pan = {
    activateAfterLongPress: () => pan,
    minDistance: () => pan,
    onStart: (callback: (event: { x: number }) => void) => {
      mockOnStart = callback;
      return pan;
    },
    onUpdate: () => pan,
    onEnd: () => pan,
    onFinalize: () => pan,
  };
  return {
    ...jest.requireActual('react-native-gesture-handler'),
    Gesture: { Pan: () => pan },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

/** Wednesday 17 June 2026, the clock each test sets in local time. */
const YEAR = 2026;

function month(year: number, m: number, hours: number) {
  return {
    year,
    month: m,
    stats: { count: 1, totalDuration: hours * 3600, totalDistance: 1000, totalTss: 10 },
  };
}

/** Sums the monthly fixture over the months that start inside a window, as the engine would for whole months. */
function periodFrom(rows: ReturnType<typeof month>[], startTs: number, endTs: number) {
  const inside = rows.filter((r) => {
    const first = Date.UTC(r.year, r.month - 1, 1) / 1000;
    return first >= startTs && first <= endTs;
  });
  const sum = (key: 'totalDuration' | 'totalDistance' | 'totalTss') =>
    inside.reduce((acc, r) => acc + r.stats[key], 0);
  return {
    count: inside.length,
    totalDuration: sum('totalDuration'),
    totalDistance: sum('totalDistance'),
    totalTss: sum('totalTss'),
  };
}

const DEFAULT_ROWS = [month(YEAR - 1, 1, 2), month(YEAR, 1, 4)];
let rows = DEFAULT_ROWS;

function setRows(next: typeof DEFAULT_ROWS) {
  rows = next;
}

const engine = {
  getTrainingScreenData: trainingScreenRead({
    months: () => rows,
    period: (startTs, endTs) => periodFrom(rows, startTs, endTs),
  }),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
  subscribe: jest.fn(() => () => {}),
};

let client: QueryClient;

function renderCard() {
  return render(
    <QueryClientProvider client={client}>
      <SeasonComparison />
    </QueryClientProvider>
  );
}

/** Long-press the first month, which opens the tooltip on January. */
async function scrubJanuary() {
  await act(async () => {
    mockOnStart?.({ x: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Local noon, so the date is the 17th in every zone; the suite's UTC instant is the 18th east of UTC+12.
  jest.setSystemTime(new Date(2026, 5, 17, 12));
  rows = DEFAULT_ROWS;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

afterEach(() => client.clear());

describe('SeasonComparison series', () => {
  it('names each series once, beside its colour, with no separate legend row', async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText('4h')).toBeTruthy());
    expect(screen.getAllByText('stats.previous')).toHaveLength(1);
    expect(screen.getAllByText('stats.current')).toHaveLength(1);
    expect(screen.getByTestId('season-summary-dot-previous')).toBeTruthy();
    expect(screen.getByTestId('season-summary-dot-current')).toBeTruthy();
  });
});

describe('SeasonComparison change between years', () => {
  it('states the change against a baseline', async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText('+100%')).toBeTruthy());
  });

  it('states no change when last year is empty', async () => {
    setRows([month(YEAR, 1, 4)]);

    renderCard();

    await waitFor(() => expect(screen.getByText('4h')).toBeTruthy());
    expect(screen.getByText('0h')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('states no change in the tooltip for a month empty last year', async () => {
    setRows([month(YEAR - 1, 3, 2), month(YEAR, 1, 4)]);

    renderCard();
    await waitFor(() => expect(screen.getByText('4h')).toBeTruthy());
    await scrubJanuary();

    expect(screen.getByTestId('season-tooltip')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('states the change in the tooltip for a month with a baseline', async () => {
    setRows([month(YEAR - 1, 1, 4), month(YEAR, 1, 2)]);

    renderCard();
    await waitFor(() => expect(screen.getByText('2h')).toBeTruthy());
    await scrubJanuary();

    expect(screen.getByText('-50%')).toBeTruthy();
  });
});

describe('SeasonComparison over a range never downloaded', () => {
  it('says the two years are not downloaded rather than empty', async () => {
    setRows([]);
    engine.rangeCoverage.mockReturnValueOnce(RangeCoverage.NotFetched);

    renderCard();

    await waitFor(() => expect(screen.getByText('stats.rangeNotDownloaded')).toBeTruthy());
    expect(screen.queryByText('stats.noActivityData')).toBeNull();
  });

  it('keeps the empty state for two years the census says are empty', async () => {
    setRows([]);
    engine.rangeCoverage.mockReturnValueOnce(RangeCoverage.Empty);

    renderCard();

    await waitFor(() => expect(screen.getByText('stats.noActivityData')).toBeTruthy());
    expect(screen.queryByText('stats.rangeNotDownloaded')).toBeNull();
  });

  it('adds a quiet line when part of the two years is not downloaded', async () => {
    engine.rangeCoverage.mockReturnValueOnce(RangeCoverage.NotFetched);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('season-comparison-partial')).toBeTruthy());
  });

  it('asks the census about 1 January last year through today', async () => {
    renderCard();

    await waitFor(() => expect(engine.rangeCoverage).toHaveBeenCalled());
    expect(engine.rangeCoverage).toHaveBeenCalledWith(`${YEAR - 1}-01-01`, `${YEAR}-06-17`);
  });
});

describe('SeasonComparison in the app language', () => {
  beforeAll(async () => {
    await initializeI18n();
    await changeLanguage('ja');
  });
  afterAll(async () => {
    await changeLanguage('en-US');
  });

  it('names the months in that language', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('1月')).toBeTruthy());
    await scrubJanuary();

    expect(screen.getAllByText('1月').length).toBeGreaterThanOrEqual(2);
  });
});
