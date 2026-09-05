/**
 * Scenario: the Insights tab's first visit lands while the launch is still
 * announcing activities and sections. Each announcement re-ran the whole
 * insights read, and two of them half a second apart cost 70 ms each under the
 * engine lock, on the thread drawing the tab the athlete just opened.
 * Expected behaviour: the visit reads once, and a burst of announcements
 * behind it collapses into one further read rather than one apiece.
 */

import { act, renderHook } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';

import { useInsights } from '@/features/insights/hooks/useInsights';
import { fetchInsightsDataFromEngine } from '@/features/insights/lib/computeInsightsData';
import { getEngine } from '@/shared/native/engine';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [] }),
}));

jest.mock('@/features/insights/lib/computeInsightsData', () => ({
  fetchInsightsDataFromEngine: jest.fn(),
  computeInsightsFromData: jest.fn(() => []),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockFetch = fetchInsightsDataFromEngine as jest.MockedFunction<
  typeof fetchInsightsDataFromEngine
>;

/** Engine announcements, held so the test can fire them like the engine does. */
let announce: (() => void)[] = [];
let pending: (() => void)[] = [];

const engine = {
  subscribe: jest.fn((_event: string, cb: () => void) => {
    announce.push(cb);
    return () => {};
  }),
};

function runInteractions() {
  const tasks = pending;
  pending = [];
  for (const task of tasks) task();
}

function announceOnce() {
  act(() => {
    announce[0]?.();
  });
  act(() => runInteractions());
}

describe('the insights read on a tab visit', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    announce = [];
    pending = [];
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
    mockFetch.mockReturnValue({
      insightsData: { todayPattern: null, allPatterns: [] },
      summaryCardData: null,
    } as unknown as ReturnType<typeof fetchInsightsDataFromEngine>);
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task) => {
      pending.push(task as () => void);
      return {
        then: () => Promise.resolve(),
        done: () => {},
        cancel: () => {},
      } as unknown as ReturnType<typeof InteractionManager.runAfterInteractions>;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reads once on the visit itself', () => {
    renderHook(() => useInsights());
    act(() => runInteractions());

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of announcements into one further read', () => {
    renderHook(() => useInsights());
    act(() => runInteractions());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 4; i += 1) {
      act(() => {
        announce[0]?.();
        jest.advanceTimersByTime(120);
      });
      act(() => runInteractions());
    }
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    act(() => runInteractions());

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('still reads again once the announcements settle', () => {
    renderHook(() => useInsights());
    act(() => runInteractions());

    announceOnce();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    act(() => runInteractions());

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
