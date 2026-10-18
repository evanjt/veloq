/**
 * Scenario: the engine throws while Best Efforts reads its bests.
 *
 * Expected behaviour: a thrown bests read shows one failure with a Retry that
 * reads again, in place of cards that each claim their curve was never
 * downloaded. A read that answers names no activity for a best the device
 * does not hold, and that row says so.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import BestEffortsScreen from '@/app/best-efforts';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useScreenSafeAreaEdges: () => [],
}));

const THROWN = { tag: 'Database', inner: { msg: 'disk' } };
const NOT_CACHED = 'activitySummary.notDownloaded';

const mockReadError: { current: unknown } = { current: null };
const mockRefetch = jest.fn();
const unfetched = { fetched: false, status: 'idle', retry: jest.fn() };

function mockRead() {
  if (mockReadError.current != null) {
    return {
      data: undefined,
      isLoading: false,
      error: mockReadError.current,
      refetch: mockRefetch,
      curves: { Ride: unfetched, Run: unfetched, Swim: unfetched },
    };
  }
  return {
    data: {
      sports: [
        {
          sport: 'Ride',
          fetched: true,
          efforts: [{ label: '5m', checkpoint: 300, value: 310, activityId: 'ride-a' }],
        },
        { sport: 'Run', fetched: true, efforts: [] },
        { sport: 'Swim', fetched: true, efforts: [] },
      ],
      climbing: [],
    },
    isLoading: false,
    error: null,
    refetch: mockRefetch,
    curves: {
      Ride: { ...unfetched, fetched: true },
      Run: { ...unfetched, fetched: true },
      Swim: { ...unfetched, fetched: true },
    },
  };
}

jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: () => mockRead(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockReadError.current = null;
});

describe('a Best Efforts read that threw', () => {
  it('shows one failure with a Retry in place of the sport and climbing cards', () => {
    mockReadError.current = THROWN;
    render(<BestEffortsScreen />);

    expect(screen.getByTestId('best-efforts-read-failed')).toBeTruthy();
    expect(screen.getByText('engine.failure.database')).toBeTruthy();
    for (const sport of ['Cycling', 'Running', 'Swimming']) {
      expect(screen.queryByTestId(`best-efforts-not-downloaded-${sport}`)).toBeNull();
      expect(screen.queryByTestId(`best-efforts-section-${sport}`)).toBeNull();
    }
    expect(screen.queryByTestId('best-efforts-climbing-Cycling')).toBeNull();

    fireEvent.press(screen.getByText('common.retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe('a best whose activity the device does not hold', () => {
  it('still says not downloaded for a best whose activity the read did not find', () => {
    render(<BestEffortsScreen />);

    expect(screen.getByText(NOT_CACHED)).toBeTruthy();
  });
});
