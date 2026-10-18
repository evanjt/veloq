/**
 * Scenario: a sport's curve on Best Efforts that was never fetched, whose
 * on-demand wait then ran out or was refused. The screen said "No best effort
 * data available", which reads as an athlete with no efforts, and offered no
 * way to ask again.
 *
 * Expected behaviour: a curve never fetched says it was not downloaded, with a
 * Retry once the wait is over that asks for it again. A fetched curve with no
 * efforts keeps the no-data line.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import BestEffortsScreen from '@/app/best-efforts';
import type { EngineBodyStatus } from '@/shared/native/engineBodies';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useScreenSafeAreaEdges: () => [],
}));

const NOT_DOWNLOADED = 'statsScreen.curveNotDownloaded';
const NO_DATA = 'statsScreen.noEffortData';

const mockRetryRide = jest.fn();
const mockRideStatus: { current: EngineBodyStatus } = { current: 'timedOut' };

/** Cycling never fetched, running fetched with no efforts, swimming fetched with one. */
function mockRead() {
  return {
    data: {
      sports: [
        { sport: 'Ride', fetched: false, efforts: [{ label: '5m', checkpoint: 300 }] },
        { sport: 'Run', fetched: true, efforts: [{ label: '5K', checkpoint: 5000 }] },
        {
          sport: 'Swim',
          fetched: true,
          efforts: [{ label: '400m', checkpoint: 400, value: 1.2, time: 333 }],
        },
      ],
      climbing: [],
    },
    isLoading: false,
    error: null,
    curves: {
      Ride: { fetched: false, status: mockRideStatus.current, retry: mockRetryRide },
      Run: { fetched: true, status: 'idle', retry: jest.fn() },
      Swim: { fetched: true, status: 'idle', retry: jest.fn() },
    },
  };
}

jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: () => mockRead(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRideStatus.current = 'timedOut';
});

function renderScreen() {
  return render(<BestEffortsScreen />);
}

function rideSection() {
  return screen.getByTestId('best-efforts-section-Cycling');
}

describe('a Best Efforts curve that was never fetched', () => {
  it.each<EngineBodyStatus>(['timedOut', 'refused'])(
    'says not downloaded with a Retry that asks again once the wait is %s',
    async (status) => {
      mockRideStatus.current = status;
      await renderScreen();

      const section = rideSection();
      expect(screen.getByTestId('best-efforts-not-downloaded-Cycling')).toBeTruthy();
      expect(section).toHaveTextContent(new RegExp(NOT_DOWNLOADED));
      expect(section).not.toHaveTextContent(new RegExp(NO_DATA));

      await fireEvent.press(screen.getByTestId('best-efforts-not-downloaded-Cycling-retry'));
      expect(mockRetryRide).toHaveBeenCalledTimes(1);
    }
  );

  it('waits without a Retry while the curve is still being fetched', async () => {
    mockRideStatus.current = 'waiting';
    await renderScreen();

    expect(screen.queryByTestId('best-efforts-not-downloaded-Cycling')).toBeNull();
    expect(screen.queryByTestId('best-efforts-not-downloaded-Cycling-retry')).toBeNull();
    expect(rideSection()).not.toHaveTextContent(new RegExp(NO_DATA));
  });

  it('keeps the no-data line for a fetched curve with no efforts', async () => {
    await renderScreen();

    const run = screen.getByTestId('best-efforts-section-Running');
    expect(run).toHaveTextContent(new RegExp(NO_DATA));
    expect(screen.queryByTestId('best-efforts-not-downloaded-Running')).toBeNull();
  });

  it('titles every sport card as a heading, so a screen reader can skim between them', async () => {
    await renderScreen();

    expect(screen.getByRole('header', { name: 'bestEffortsScreen.powerBests' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'bestEffortsScreen.paceBests' })).toBeTruthy();
  });
});
