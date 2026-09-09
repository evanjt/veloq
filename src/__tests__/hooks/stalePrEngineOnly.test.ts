/**
 * Scenario: the stale-PR card was decided twice, once by the engine's own
 * filter and sort over SQLite-resident trends, and once by a TypeScript
 * detector kept as the branch for jest and the pre-sync window. The two
 * policies drifted apart while the thresholds stayed single-sourced.
 *
 * Expected behaviour: the engine decides, and only the engine. An engine that
 * cannot answer produces no card, rather than a second opinion.
 */

import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import type { GenerateStalePRInsightsInput } from '@/features/insights/generators/stalePr';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const NOW = Math.floor(Date.now() / 1000);

/** A library that the deleted TypeScript detector would have flagged. */
const INPUT: GenerateStalePRInsightsInput = {
  sections: [
    {
      sectionId: 's1',
      sectionName: 'Hill Climb',
      bestTimeSecs: 263,
      traversalCount: 5,
      daysSinceLast: 90,
      sportType: 'Ride',
    },
  ],
  ftpTrend: {
    latestFtp: 240,
    latestDate: NOW,
    previousFtp: 200,
    previousDate: NOW - 60 * 86400,
  },
  runPaceTrend: null,
  swimPaceTrend: null,
  existingInsightIds: new Set<string>(),
};

const ROW = {
  sectionId: 's1',
  sectionName: 'Hill Climb',
  bestTimeSecs: 263,
  daysSinceLast: 90,
  traversalCount: 5,
  fitnessMetric: 'power',
  currentValue: 240,
  previousValue: 200,
  gainPercent: 20,
  unit: 'W',
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('generateStalePRInsights', () => {
  it('renders what the engine returns', () => {
    const findStalePrOpportunities = jest.fn(() => [ROW]);
    mockGetEngine.mockReturnValue({ findStalePrOpportunities } as unknown as ReturnType<
      typeof getEngine
    >);

    const insights = generateStalePRInsights(INPUT, t, NOW);

    expect(findStalePrOpportunities).toHaveBeenCalled();
    expect(insights).toHaveLength(1);
  });

  it('renders nothing when there is no engine, rather than deciding for itself', () => {
    mockGetEngine.mockReturnValue(null);

    expect(generateStalePRInsights(INPUT, t, NOW)).toEqual([]);
  });

  it('renders nothing when the engine has no stale-PR call', () => {
    mockGetEngine.mockReturnValue({} as unknown as ReturnType<typeof getEngine>);

    expect(generateStalePRInsights(INPUT, t, NOW)).toEqual([]);
  });

  it('renders nothing when the engine throws', () => {
    mockGetEngine.mockReturnValue({
      findStalePrOpportunities: () => {
        throw new Error('engine is closed');
      },
    } as unknown as ReturnType<typeof getEngine>);

    expect(generateStalePRInsights(INPUT, t, NOW)).toEqual([]);
  });

  it('leaves the exclusion of already-carded sections to the engine', () => {
    const findStalePrOpportunities = jest.fn(
      (_days: number, _gain: number, _max: number, _exclude: string[]) => [] as (typeof ROW)[]
    );
    mockGetEngine.mockReturnValue({ findStalePrOpportunities } as unknown as ReturnType<
      typeof getEngine
    >);

    generateStalePRInsights(
      { ...INPUT, existingInsightIds: new Set(['section_pr-s1', 'other-s9']) },
      t,
      NOW
    );

    expect(findStalePrOpportunities.mock.calls[0][3]).toEqual(['s1']);
  });
});
