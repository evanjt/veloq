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

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({
    data: { type: 'power', sport: 'Ride', secs: [], watts: [] },
    isLoading: false,
    error: null,
    coverage: coverage.current,
  }),
  POWER_CURVE_DURATIONS: [],
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
  }),
  PACE_CURVE_DISTANCES: [],
}));

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  coverage.current = RangeCoverage.Empty;
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
