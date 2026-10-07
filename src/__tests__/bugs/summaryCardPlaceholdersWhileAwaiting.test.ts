/**
 * Scenario: the feed hands the summary card `awaitPrecomputed`, so the card
 * renders before the startup bundle answers.
 *
 * Expected behaviour: while the bundle is absent the card says it is loading
 * and draws no number. It read `0 Fitness`, `FTP -` and `Week 0h` on a first
 * launch, and a zero reads as a measurement rather than as a gap.
 */

import { renderHook } from '@testing-library/react-native';

import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/useAthlete', () => ({
  useAthlete: () => ({ data: undefined }),
}));

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: undefined }),
  useWellnessGeneration: () => 0,
}));

jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));

jest.mock('@/features/stats', () => ({
  usePaceCurve: () => ({ data: undefined }),
}));

jest.mock('@/shared/app/useMetricSystem', () => ({
  useMetricSystem: () => true,
}));

const CARD = {
  currentWeek: { count: 4, totalDuration: 7200 },
  prevWeek: { count: 2, totalDuration: 3600 },
  ftpTrend: { latestFtp: 250, previousFtp: 240 },
  runPaceTrend: { latestPace: 3.5, previousPace: 3.4 },
  swimPaceTrend: { latestPace: 1.2, previousPace: 1.2 },
};

const engine = {
  getSummaryCardData: jest.fn(() => CARD),
  subscribe: jest.fn(() => () => {}),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('the summary card while the startup bundle is outstanding', () => {
  it('reports loading', () => {
    const { result } = renderHook(() => useSummaryCardData(undefined, { awaitPrecomputed: true }));

    expect(result.current.isLoading).toBe(true);
  });

  it('draws no hero number', () => {
    const { result } = renderHook(() => useSummaryCardData(undefined, { awaitPrecomputed: true }));

    expect(result.current.heroValue).toBe('-');
    expect(result.current.heroTrend).toBeUndefined();
  });

  it('draws no supporting number', () => {
    const { result } = renderHook(() => useSummaryCardData(undefined, { awaitPrecomputed: true }));

    expect(result.current.supportingMetrics.length).toBeGreaterThan(0);
    for (const metric of result.current.supportingMetrics) {
      expect(metric.value).toBe('-');
      expect(metric.trend).toBeUndefined();
    }
  });

  it('draws the numbers once the bundle lands', () => {
    const { result } = renderHook(() => useSummaryCardData(CARD, { awaitPrecomputed: true }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.supportingMetrics.some((m) => m.value !== '-')).toBe(true);
  });

  it('leaves a caller with no bundle to wait for alone', () => {
    const { result } = renderHook(() => useSummaryCardData());

    expect(result.current.isLoading).toBe(false);
  });
});
