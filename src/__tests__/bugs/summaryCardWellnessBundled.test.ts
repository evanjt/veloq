/**
 * Scenario: the feed card derived its five wellness numbers and five arrows in
 * TypeScript from a month of parsed bodies, on every wellness invalidation,
 * for values the engine already holds as typed columns.
 *
 * Expected behaviour: the numbers and the glyphs come with the bundle, the
 * card makes no wellness read of its own, and the arrow drawn is the one the
 * engine judged rather than one TypeScript re-decided.
 */

import type { SummaryCardData as EngineSummaryCardData } from 'veloqrs';
import { renderHook } from '@testing-library/react-native';

import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { useDashboardPreferences } from '@/features/home/store';
import { formZoneTextColor } from '@/features/fitness/lib/fitness';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const WELLNESS: EngineSummaryCardData['wellness'] = {
  fitness: 62,
  fitnessTrend: '↑',
  form: 18,
  formTrend: '→',
  hrv: 71,
  hrvTrend: '↓',
  rhr: 47,
  // Resting heart rate fell, which the engine judged an improvement, so the
  // arrow points up against the number's own direction.
  rhrTrend: '↑',
  weight: 70.4,
};

/** The bundle without the given readings, absent the way the engine leaves one out. */
function withoutReadings(...keys: (keyof typeof WELLNESS)[]): typeof WELLNESS {
  const copy = { ...WELLNESS };
  for (const key of keys) delete copy[key];
  return copy;
}

const CARD = {
  wellness: WELLNESS,
  currentWeek: { count: 4, totalDuration: 7200 },
  prevWeek: { count: 2, totalDuration: 3600 },
  ftpTrend: { latestFtp: 250, previousFtp: 240 },
  runPaceTrend: { latestPace: 3.5, previousPace: 3.4 },
  swimPaceTrend: { latestPace: 1.2, previousPace: 1.2 },
};

const engine = {
  getSummaryCardData: jest.fn(() => CARD),
  getWellnessSparklines: jest.fn(() => null),
  getWellnessDays: jest.fn(() => []),
  subscribe: jest.fn(() => () => {}),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

/** The metric row the card draws for `label`, as the athlete reads it. */
function metric(
  metrics: {
    label: string;
    value: number | string;
    color?: string | undefined;
    trend?: string | undefined;
  }[],
  label: string
) {
  return metrics.find((m) => m.label === label);
}

describe('the feed card wellness numbers', () => {
  it('come from the bundle, with the glyph the engine judged', () => {
    const { result } = renderHook(() => useSummaryCardData(CARD, { awaitPrecomputed: true }));
    const metrics = result.current.supportingMetrics;

    // The bundle carries the current value and no baseline, so a trend the
    // card draws can only be the one the engine handed it.
    expect(metric(metrics, 'metrics.fitness')).toMatchObject({ value: 62, trend: '↑' });
    expect(metric(metrics, '⚖️')).toMatchObject({ value: '70.4kg' });
    expect(metric(metrics, '⚖️')?.trend).toBeUndefined();
  });

  it('makes no wellness read of its own', () => {
    renderHook(() => useSummaryCardData(CARD, { awaitPrecomputed: true }));

    expect(engine.getWellnessDays).not.toHaveBeenCalled();
  });

  it('gives placeholders and no arrows before a bundle arrives', () => {
    const { result } = renderHook(() => useSummaryCardData(undefined, { awaitPrecomputed: true }));
    const metrics = result.current.supportingMetrics;

    expect(metric(metrics, 'metrics.fitness')).toMatchObject({ value: '-' });
    expect(metric(metrics, 'metrics.fitness')?.trend).toBeUndefined();
    // Weight with no reading is dropped from the row rather than drawn as zero.
    expect(metric(metrics, '⚖️')).toBeUndefined();
  });
});

it('keeps missing wellness distinct from measured zero after activities arrive', () => {
  const missing = {
    ...CARD,
    wellness: withoutReadings('fitness', 'fitnessTrend', 'form', 'formTrend'),
  };
  const { result, rerender } = renderHook(
    ({ card }: { card: typeof CARD }) => useSummaryCardData(card, { awaitPrecomputed: true }),
    { initialProps: { card: missing as typeof CARD } }
  );
  expect(metric(result.current.supportingMetrics, 'metrics.fitness')).toMatchObject({ value: '-' });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.heroValue).toBe('-');
  rerender({ card: { ...CARD, wellness: { ...WELLNESS, fitness: 0, form: 0 } } });
  expect(metric(result.current.supportingMetrics, 'metrics.fitness')).toMatchObject({ value: 0 });
});

it('withholds the form zone until a form reading arrives', () => {
  const preferences = useDashboardPreferences.getState().summaryCard;
  useDashboardPreferences.setState({
    summaryCard: { ...preferences, supportingMetrics: ['fitness', 'form'] },
  });
  try {
    const { result, rerender } = renderHook(
      ({ wellness }: { wellness: typeof WELLNESS }) =>
        useSummaryCardData({ ...CARD, wellness }, { awaitPrecomputed: true }),
      {
        initialProps: {
          wellness: withoutReadings('fitness', 'form', 'fitnessTrend', 'formTrend'),
        },
      }
    );
    const greyZone = formZoneTextColor('greyZone', false);
    expect(metric(result.current.supportingMetrics, 'metrics.form')).toMatchObject({ value: '-' });
    expect(metric(result.current.supportingMetrics, 'metrics.form')?.color).not.toBe(greyZone);
    rerender({ wellness: { ...WELLNESS, fitness: 0, form: 0 } });
    expect(metric(result.current.supportingMetrics, 'metrics.form')).toMatchObject({
      value: '0',
      color: greyZone,
    });
  } finally {
    useDashboardPreferences.setState({ summaryCard: preferences });
  }
});
