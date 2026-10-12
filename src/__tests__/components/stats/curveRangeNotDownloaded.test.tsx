/**
 * Scenario: a curve chart with nothing to draw said "No power data yet" for
 * both an athlete who rested through the window and a device that never pulled
 * it. Offline the second is the common one, and it reads as an empty history.
 *
 * Expected behaviour: the chart says the range was not downloaded when the
 * engine's census says the download is still owed, and keeps the old line for
 * a range the census has and finds empty.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage } from '@/__tests__/__shared__/veloqrsStub';

import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import { PaceCurveChart } from '@/features/stats/components/PaceCurveChart';
import { SwimPaceCurveChart } from '@/features/stats/components/SwimPaceCurveChart';

// `t` answers with the key under test, so the assertions name keys rather than
// the en-AU copy.
const NOT_DOWNLOADED = 'stats.rangeNotDownloaded';

const coverage: { current: RangeCoverage } = { current: RangeCoverage.Empty };
const bodyStatus: { current: string } = { current: 'idle' };
const mockRetryBody = jest.fn();
const readError: { current: unknown } = { current: null };
const mockRefetch = jest.fn();

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({
    data: { type: 'power', sport: 'Ride', secs: [], watts: [] },
    isLoading: false,
    error: readError.current,
    refetch: mockRefetch,
    coverage: coverage.current,
    bodyStatus: bodyStatus.current,
    retryBody: mockRetryBody,
  }),
}));

// The pace chart looks activity names up for its labels, and that hook reaches
// the network context and the engine. Neither is what is under test here.
jest.mock('@/features/activity', () => ({
  useActivities: () => ({ data: [] }),
}));

jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: () => ({
    data: { type: 'pace', sport: 'Run', distances: [], times: [], pace: [] },
    isLoading: false,
    error: readError.current,
    refetch: mockRefetch,
    coverage: coverage.current,
    bodyStatus: bodyStatus.current,
    retryBody: mockRetryBody,
  }),
}));

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockRetryBody.mockClear();
  mockRefetch.mockClear();
  readError.current = null;
  coverage.current = RangeCoverage.Empty;
  bodyStatus.current = 'idle';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  client.clear();
});

describe('a curve chart with nothing to draw', () => {
  it('says the range was never downloaded when the download is still owed', async () => {
    coverage.current = RangeCoverage.NotFetched;

    await render(<PowerCurveChart ftp={300} />, { wrapper });

    expect(screen.getByText(NOT_DOWNLOADED)).toBeTruthy();
    expect(screen.queryByText('stats.noPowerData')).toBeNull();
  });

  it('keeps the no-data line for a range the census has and finds empty', async () => {
    await render(<PowerCurveChart ftp={300} />, { wrapper });

    expect(screen.getByText('stats.noPowerData')).toBeTruthy();
  });

  it('says the same on the swim pace curve', async () => {
    coverage.current = RangeCoverage.NotFetched;

    await render(<SwimPaceCurveChart />, { wrapper });

    expect(screen.getByText(NOT_DOWNLOADED)).toBeTruthy();
    expect(screen.queryByText('stats.noSwimPaceData')).toBeNull();
  });

  it('says the same on the pace curve', async () => {
    coverage.current = RangeCoverage.NotFetched;

    await render(<PaceCurveChart />, { wrapper });

    expect(screen.getByText(NOT_DOWNLOADED)).toBeTruthy();
    expect(screen.queryByText('stats.noPaceData')).toBeNull();
  });
});

describe('a curve chart whose body the engine is fetching', () => {
  const charts: [string, () => React.ReactElement][] = [
    ['power', () => <PowerCurveChart ftp={300} />],
    ['pace', () => <PaceCurveChart />],
    ['swim pace', () => <SwimPaceCurveChart />],
  ];

  it.each(charts)('moves instead of saying not downloaded on the %s curve', async (_, chart) => {
    coverage.current = RangeCoverage.NotFetched;
    bodyStatus.current = 'waiting';

    await render(chart(), { wrapper });

    expect(screen.getByTestId('curve-loading-placeholder')).toBeTruthy();
    expect(screen.queryByText(NOT_DOWNLOADED)).toBeNull();
  });

  it.each(charts)('settles on not downloaded once the %s wait times out', async (_, chart) => {
    coverage.current = RangeCoverage.NotFetched;
    bodyStatus.current = 'timedOut';

    await render(chart(), { wrapper });

    expect(screen.getByText(NOT_DOWNLOADED)).toBeTruthy();
    expect(screen.queryByTestId('curve-loading-placeholder')).toBeNull();
  });

  it.each(charts)('offers a Retry that asks again once the %s wait has ended', async (_, chart) => {
    coverage.current = RangeCoverage.NotFetched;

    for (const status of ['timedOut', 'refused']) {
      bodyStatus.current = status;
      const { unmount } = await render(chart(), { wrapper });

      await fireEvent.press(screen.getByText('common.retry'));
      await unmount();
    }
    expect(mockRetryBody).toHaveBeenCalledTimes(2);
  });

  it.each(charts)('offers no Retry for a %s range the census finds empty', async (_, chart) => {
    bodyStatus.current = 'timedOut';

    await render(chart(), { wrapper });

    expect(screen.queryByText('common.retry')).toBeNull();
  });
});

describe('a curve chart whose read threw', () => {
  const charts: [string, () => React.ReactElement, string][] = [
    ['power', () => <PowerCurveChart ftp={300} />, 'stats.noPowerData'],
    ['pace', () => <PaceCurveChart />, 'stats.noPaceData'],
    ['swim pace', () => <SwimPaceCurveChart />, 'stats.noSwimPaceData'],
  ];

  it.each(charts)(
    'shows the failure and a Retry that reads again on the %s curve',
    (_, chart, noData) => {
      readError.current = { tag: 'Database', inner: { msg: 'disk' } };

      for (const census of [RangeCoverage.NotFetched, RangeCoverage.Empty]) {
        coverage.current = census;
        const { unmount } = render(chart(), { wrapper });

        expect(screen.getByText('engine.failure.database')).toBeTruthy();
        expect(screen.queryByText(NOT_DOWNLOADED)).toBeNull();
        expect(screen.queryByText(noData)).toBeNull();
        fireEvent.press(screen.getByText('common.retry'));
        unmount();
      }
      expect(mockRefetch).toHaveBeenCalledTimes(2);
      expect(mockRetryBody).not.toHaveBeenCalled();
    }
  );
});
