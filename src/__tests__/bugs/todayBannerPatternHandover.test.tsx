/**
 * Scenario: the insights tab computed the activity patterns twice. The
 * insights bundle carries them, and `TodayBanner` then called
 * `getActivityPatternsWithToday` for a second k-means pass over the same
 * metric rows on the same screen.
 *
 * Expected behaviour: the hook that already holds the bundle hands the
 * pattern down, and the banner makes no engine call of its own.
 */

import React from 'react';
import { render, renderHook, act } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';

import { TodayBanner } from '@/features/routes/components/TodayBanner';
import { useInsights } from '@/features/insights/hooks/useInsights';
import { fetchInsightsDataFromEngine } from '@/features/insights/lib/computeInsightsData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => ({}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({ todayWorkout: null, tomorrowWorkout: null, isLoading: false }),
}));

jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [{ id: '2026-09-01', ctl: 50, atl: 40 }] }),
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

const PATTERN = {
  sportType: 'Run',
  primaryDay: 2,
  avgDurationSecs: 3600,
  avgTss: 55,
  activityCount: 12,
  confidence: 0.8,
  commonSections: [],
};

const engine = {
  getActivityPatternsWithToday: jest.fn(() => ({ today: PATTERN, all: [PATTERN] })),
  subscribe: jest.fn(() => () => {}),
};

let pending: (() => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  pending = [];
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
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
  jest.restoreAllMocks();
});

describe('TodayBanner', () => {
  it('renders the pattern it is handed without an engine call', () => {
    const { getByText } = render(
      <TodayBanner
        todayPattern={PATTERN as unknown as Parameters<typeof TodayBanner>[0]['todayPattern']}
      />
    );

    expect(engine.getActivityPatternsWithToday).not.toHaveBeenCalled();
    expect(getByText(/Wednesdays you usually run/)).toBeTruthy();
  });

  it('makes no engine call when it is handed no pattern', () => {
    render(<TodayBanner todayPattern={null} />);

    expect(engine.getActivityPatternsWithToday).not.toHaveBeenCalled();
  });
});

describe('useInsights', () => {
  it('returns the pattern from the bundle it already fetched', () => {
    mockFetch.mockReturnValue({
      insightsData: { todayPattern: PATTERN, allPatterns: [PATTERN] },
      summaryCardData: null,
    } as unknown as ReturnType<typeof fetchInsightsDataFromEngine>);

    const { result } = renderHook(() => useInsights());

    act(() => {
      for (const task of pending) task();
    });

    expect(result.current.todayPattern).toEqual(PATTERN);
    expect(engine.getActivityPatternsWithToday).not.toHaveBeenCalled();
  });
});
