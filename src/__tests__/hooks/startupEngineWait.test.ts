/**
 * Scenario: the engine handle is absent when the feed mounts. The accessor
 * answers the same for the life of the process, so there is nothing to wait for.
 *
 * Expected behaviour: the feed subscribes to nothing and schedules no timer.
 */

import { renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useStartupData } from '@/features/home/hooks/useStartupData';

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

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockGetEngine.mockReturnValue(null as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  jest.useRealTimers();
});

it('schedules no timer while the engine is absent', () => {
  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  renderHook(() => useStartupData(['a1']));
  expect(setIntervalSpy).not.toHaveBeenCalled();
  setIntervalSpy.mockRestore();
});

it('subscribes to the signals once when the engine is present', () => {
  const subscribe = jest.fn(() => () => {});
  mockGetEngine.mockReturnValue({
    subscribe,
    getSyncStatus: () => ({ state: 0 }),
    getStartupData: () => ({ summaryCard: {}, previewTracks: [] }),
  } as unknown as ReturnType<typeof getEngine>);
  renderHook(() => useStartupData(['a1']));

  expect(subscribe).toHaveBeenCalledWith('syncSettled', expect.any(Function));
  expect(subscribe).toHaveBeenCalledWith('bodyStored', expect.any(Function));
});
