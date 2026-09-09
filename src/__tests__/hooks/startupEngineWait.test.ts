/**
 * Scenario: the engine is not open when the feed mounts. The hook that waits
 * for it polled `getEngine()` every 200 ms and left only when the engine
 * arrived, so an install where init failed ticked five times a second for as
 * long as the feed was on screen.
 *
 * Expected behaviour: the wait has a cap. It stops asking, and the feed is
 * left on its first read, which is what it does today either way.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useStartupData } from '@/features/home/hooks/useStartupData';
import { SyncState } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [],
  })
);

jest.mock('@/features/insights/lib/insightsParams', () => ({
  buildInsightsParams: () => ({}),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** How often `getEngine` is asked while the engine is absent. */
let asks = 0;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  asks = 0;
  mockGetEngine.mockImplementation(() => {
    asks += 1;
    return null as unknown as ReturnType<typeof getEngine>;
  });
});

afterEach(() => {
  jest.useRealTimers();
});

it('stops asking for an engine that never arrives', () => {
  renderHook(() => useStartupData(['a1']));
  // Past the cap, whatever it is, but nowhere near a minute.
  act(() => {
    jest.advanceTimersByTime(15_000);
  });
  const asksBeforeGivingUp = asks;

  // A minute later. If the wait is capped, nothing has asked again.
  act(() => {
    jest.advanceTimersByTime(60_000);
  });

  expect(asks).toBe(asksBeforeGivingUp);
  // And it gave up rather than never having started: a 200 ms tick over a
  // minute and a quarter would be hundreds.
  expect(asksBeforeGivingUp).toBeLessThan(100);
});

it('still picks up an engine that arrives inside the cap', () => {
  const subscribe = jest.fn(() => () => {});
  renderHook(() => useStartupData(['a1']));

  act(() => {
    jest.advanceTimersByTime(400);
  });
  mockGetEngine.mockReturnValue({
    subscribe,
    getSyncStatus: () => ({ state: SyncState.Idle }),
    getStartupData: () => ({ summaryCard: {}, previewTracks: [] }),
  } as unknown as ReturnType<typeof getEngine>);
  act(() => {
    jest.advanceTimersByTime(400);
  });

  expect(subscribe).toHaveBeenCalledWith('syncSettled', expect.any(Function));
});
