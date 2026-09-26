/**
 * Scenario: the feed card drew its sparklines from a second engine call beside
 * the startup bundle it had already read, and that call re-ran on every
 * wellness invalidation, which every `activities` event causes.
 *
 * Expected behaviour: the sparklines come with the bundle. A caller with no
 * bundle, the settings preview, keeps its own read.
 */

import { renderHook } from '@testing-library/react-native';

import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: undefined }),
  useWellnessGeneration: () => 0,
}));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const CARD = {
  currentWeek: { count: 4, totalDuration: 7200 },
  prevWeek: { count: 2, totalDuration: 3600 },
  ftpTrend: { latestFtp: 250, previousFtp: 240 },
  runPaceTrend: { latestPace: 3.5, previousPace: 3.4 },
  swimPaceTrend: { latestPace: 1.2, previousPace: 1.2 },
};

const SPARKLINES = {
  fitness: [70, 71, 72],
  fatigue: [60, 61, 62],
  form: [10, 10, 10],
  hrv: [55, 56, 57],
  rhr: [48, 48, 47],
};

const engine = {
  getSummaryCardData: jest.fn(() => CARD),
  getWellnessSparklines: jest.fn(() => SPARKLINES),
  subscribe: jest.fn(() => () => {}),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

describe('the feed card sparklines', () => {
  it('come from the bundle, with no second engine call', () => {
    const { result } = renderHook(() =>
      useSummaryCardData(CARD, { awaitPrecomputed: true, precomputedSparklines: SPARKLINES })
    );

    expect(engine.getWellnessSparklines).not.toHaveBeenCalled();
    expect(result.current.fitnessData).toEqual(SPARKLINES.fitness);
    expect(result.current.hrvData).toEqual(SPARKLINES.hrv);
  });

  it('are absent rather than re-read when the bundle carries none', () => {
    const { result } = renderHook(() =>
      useSummaryCardData(CARD, { awaitPrecomputed: true, precomputedSparklines: null })
    );

    expect(engine.getWellnessSparklines).not.toHaveBeenCalled();
    expect(result.current.fitnessData).toBeUndefined();
  });

  it('are read for a caller with no bundle to wait for', () => {
    const { result } = renderHook(() => useSummaryCardData());

    expect(engine.getWellnessSparklines).toHaveBeenCalledWith(30);
    expect(result.current.fitnessData).toEqual(SPARKLINES.fitness);
  });
});
