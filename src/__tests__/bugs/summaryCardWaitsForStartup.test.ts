/**
 * Scenario: the summary card falls back to its own `getSummaryCardData` read
 * when no precomputed bundle is handed to it. On the feed that bundle now
 * arrives after the first paint, so the fallback would fire during render and
 * put the engine back on the render path the startup bundle just left.
 *
 * Expected behaviour: a caller that is waiting on the startup bundle says so
 * and gets defaults until it lands. Callers with no bundle at all, the
 * settings preview, keep the fallback.
 */

import { renderHook } from '@testing-library/react-native';

import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => ({}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/useAthlete', () => ({
  useAthlete: () => ({ data: undefined }),
}));

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: undefined }),
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

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

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
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

describe('useSummaryCardData', () => {
  it('makes no engine call while it waits for the startup bundle', () => {
    const { result } = renderHook(() => useSummaryCardData(undefined, { awaitPrecomputed: true }));

    expect(engine.getSummaryCardData).not.toHaveBeenCalled();
    expect(result.current.supportingMetrics).toBeDefined();
  });

  it('uses the startup bundle once it lands, without its own read', () => {
    const { result } = renderHook(() => useSummaryCardData(CARD, { awaitPrecomputed: true }));

    expect(engine.getSummaryCardData).not.toHaveBeenCalled();
    expect(result.current.heroValue).toBeDefined();
  });

  it('still reads the engine for a caller with no bundle to wait for', () => {
    renderHook(() => useSummaryCardData());

    expect(engine.getSummaryCardData).toHaveBeenCalled();
  });
});
