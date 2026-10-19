/**
 * Scenario: the Insights tab is open when the developer switch flips. The
 * experimental insights follow the switch, so the list has to be computed again.
 * Expected behaviour: the computation runs with the switch as it stands, which
 * it reads itself, and a flip recomputes the list with the new value.
 */

import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { useInsights } from '@/features/insights/hooks/useInsights';
import {
  computeInsightsFromData,
  fetchInsightsDataFromEngine,
} from '@/features/insights/lib/computeInsightsData';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [] }),
}));

jest.mock('@/features/insights/lib/computeInsightsData', () => ({
  fetchInsightsDataFromEngine: jest.fn(),
  computeInsightsFromData: jest.fn(() => ({ insights: [], failed: false })),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockFetch = fetchInsightsDataFromEngine as jest.MockedFunction<
  typeof fetchInsightsDataFromEngine
>;
const mockCompute = computeInsightsFromData as jest.MockedFunction<typeof computeInsightsFromData>;

const engine = { subscribe: jest.fn(() => () => {}) };
let idle: IdleScheduler;

/** The switch as each computation found it when it ran. */
let switchAtCompute: boolean[] = [];
const lastExperimental = () => switchAtCompute.at(-1);

async function settle() {
  await act(() => {
    jest.advanceTimersByTime(2000);
  });
  await act(() => idle.flush());
}

describe('the insights computation and the developer switch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
    mockFetch.mockReturnValue({
      insightsData: { sportTypes: [] },
    } as unknown as ReturnType<typeof fetchInsightsDataFromEngine>);
    idle = stubIdleScheduler('queued');
    useDebugStore.setState({ enabled: false, unlocked: false });
    switchAtCompute = [];
    mockCompute.mockImplementation(() => {
      switchAtCompute.push(useDebugStore.getState().enabled);
      return { insights: [], failed: false };
    });
  });

  afterEach(() => {
    idle.restore();
    jest.useRealTimers();
    useDebugStore.setState({ enabled: false, unlocked: false });
  });

  it('computes without the experimental insights while the switch is off', async () => {
    await renderHook(() => useInsights());
    await act(() => idle.flush());

    expect(mockCompute).toHaveBeenCalledTimes(1);
    expect(lastExperimental()).toBe(false);
  });

  it('computes with them when the switch is on at the visit', async () => {
    useDebugStore.setState({ enabled: true, unlocked: true });
    await renderHook(() => useInsights());
    await act(() => idle.flush());

    expect(lastExperimental()).toBe(true);
  });

  it('recomputes on each flip of the switch', async () => {
    await renderHook(() => useInsights());
    await act(() => idle.flush());
    expect(lastExperimental()).toBe(false);

    await act(() => {
      useDebugStore.setState({ enabled: true, unlocked: true });
    });
    await settle();
    expect(mockCompute).toHaveBeenCalledTimes(2);
    expect(lastExperimental()).toBe(true);

    await act(() => {
      useDebugStore.setState({ enabled: false, unlocked: false });
    });
    await settle();
    expect(mockCompute).toHaveBeenCalledTimes(3);
    expect(lastExperimental()).toBe(false);
  });
});
