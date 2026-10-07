/**
 * Scenario: with nothing planned, the banner printed a sentence about the
 * weekday the athlete usually trains, and the insights hook handed it down.
 *
 * Expected behaviour: the banner draws no habit sentence, the hook returns
 * no pattern, and the banner makes no engine call.
 */

import React from 'react';
import { render, renderHook, act } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { TodayBanner } from '@/features/routes/components/TodayBanner';
import { useInsights } from '@/features/insights/hooks/useInsights';
import { fetchInsightsDataFromEngine } from '@/features/insights/lib/computeInsightsData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

let mockLanguage = 'en-AU';

// The banner's sentence is a key with three interpolations. Resolving it
// against the real en-AU bundle keeps the assertion on what the athlete reads
// rather than on the key name. The language is the athlete's, which names the
// day.
jest.mock('react-i18next', () => {
  const { resolvedLocale } = jest.requireActual(
    '../i18n/resolvedLocale'
  ) as typeof import('../i18n/resolvedLocale');
  const bundle = resolvedLocale('en-AU');
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      i18n: { language: mockLanguage },
      t: (key: string, values?: Record<string, string | number>) => {
        const text = key
          .split('.')
          .reduce<unknown>(
            (acc, part) =>
              acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
            bundle
          );
        if (typeof text !== 'string') return key;
        return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(values?.[name] ?? ''));
      },
    }),
  };
});

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
  computeInsightsFromData: jest.fn(() => ({ insights: [], failed: false })),
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
};

const engineCall = jest.fn((..._args: unknown[]) => ({ today: PATTERN, all: [PATTERN] }));

/** Answers to any method name, so the assertions cannot go stale on a rename. */
const engine = new Proxy({ subscribe: () => () => {} } as Record<string, unknown>, {
  get: (target, property: string) =>
    property in target ? target[property] : (...args: unknown[]) => engineCall(...args),
});

let idle: IdleScheduler;

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = 'en-AU';
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  idle = stubIdleScheduler('queued');
});

afterEach(() => {
  idle.restore();
  jest.restoreAllMocks();
});

describe('TodayBanner', () => {
  it('renders no habit sentence when nothing is planned', () => {
    const { queryByText } = render(<TodayBanner form={{ ctl: 50, atl: 40 }} />);

    expect(queryByText(/you usually/)).toBeNull();
    expect(engineCall).not.toHaveBeenCalled();
  });

  it('draws no readiness row and no TSB when there is no form reading', () => {
    const { queryByText } = render(<TodayBanner form={null} />);

    expect(queryByText(/TSB/)).toBeNull();
    expect(queryByText(/TODAY|routeIntelligence\.today/)).toBeNull();
  });
});

describe('useInsights', () => {
  it('returns no pattern from the insights bundle', () => {
    mockFetch.mockReturnValue({
      insightsData: { sportTypes: [] },
      summaryCardData: null,
    } as unknown as ReturnType<typeof fetchInsightsDataFromEngine>);

    const { result } = renderHook(() => useInsights());

    act(() => {
      idle.flush();
    });

    expect(result.current).not.toHaveProperty('todayPattern');
    expect(engineCall).not.toHaveBeenCalled();
  });
});
