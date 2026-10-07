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
import { render, screen } from '@testing-library/react-native';
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

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({
    data: { type: 'power', sport: 'Ride', secs: [], watts: [] },
    isLoading: false,
    error: null,
    coverage: coverage.current,
    bodyStatus: bodyStatus.current,
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
    error: null,
    coverage: coverage.current,
    bodyStatus: bodyStatus.current,
  }),
}));

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  coverage.current = RangeCoverage.Empty;
  bodyStatus.current = 'idle';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  client.clear();
});

describe('a curve chart with nothing to draw', () => {
  it('says the range was never downloaded when the download is still owed', () => {
    coverage.current = RangeCoverage.NotFetched;

    render(<PowerCurveChart ftp={300} />, { wrapper });

    expect(screen.getByText(NOT_DOWNLOADED)).toBeTruthy();
    expect(screen.queryByText('stats.noPowerData')).toBeNull();
  });

  it('keeps the no-data line for a range the census has and finds empty', () => {
    render(<PowerCurveChart ftp={300} />, { wrapper });

    expect(screen.getByText('stats.noPowerData')).toBeTruthy();
  });

  it('says the same on the swim pace curve', () => {
    coverage.current = RangeCoverage.NotFetched;

    render(<SwimPaceCurveChart />, { wrapper });

    expect(screen.getByText(NOT_DOWNLOADED)).toBeTruthy();
    expect(screen.queryByText('stats.noSwimPaceData')).toBeNull();
  });

  it('says the same on the pace curve', () => {
    coverage.current = RangeCoverage.NotFetched;

    render(<PaceCurveChart />, { wrapper });

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

  it.each(charts)('moves instead of saying not downloaded on the %s curve', (_, chart) => {
    coverage.current = RangeCoverage.NotFetched;
    bodyStatus.current = 'waiting';

    render(chart(), { wrapper });

    expect(screen.getByTestId('curve-loading-placeholder')).toBeTruthy();
    expect(screen.queryByText(NOT_DOWNLOADED)).toBeNull();
  });

  it.each(charts)('settles on not downloaded once the %s wait times out', (_, chart) => {
    coverage.current = RangeCoverage.NotFetched;
    bodyStatus.current = 'timedOut';

    render(chart(), { wrapper });

    expect(screen.getByText(NOT_DOWNLOADED)).toBeTruthy();
    expect(screen.queryByTestId('curve-loading-placeholder')).toBeNull();
  });
});
