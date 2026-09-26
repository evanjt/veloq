/**
 * Scenario: a finger drags across the body diagram, crossing one muscle after
 * another. Each new muscle wants that muscle's four-week progression and the
 * exercises behind it.
 *
 * Expected behaviour: the screen reads once and every muscle is a selection out
 * of that read, so a drag issues no engine call at all. None of what the tab
 * draws depends on which muscle is selected, so a read keyed on the muscle paid
 * a range pass a frame for numbers already in hand.
 */
import { renderHook } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useStrengthScreenData } from '@/features/strength/hooks/useStrengthScreenData';
import { selectExercises, selectProgression } from '@/features/strength/lib/analysis';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockEngine: Record<string, unknown> = {};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

const MUSCLES = ['chest', 'biceps', 'quadriceps', 'abs', 'upper-back'];

let screenCalls = 0;

function summaryForRange(weightedSets: number) {
  return {
    muscleVolumes: MUSCLES.map((slug, index) => ({
      slug,
      primarySets: weightedSets + index,
      secondarySets: 0,
      weightedSets: weightedSets + index,
      totalReps: 10,
      totalWeightKg: 100,
      exerciseNames: [slug],
    })),
    activityCount: 3,
    totalSets: 12,
    balance: [],
  };
}

/** What the engine hands back, ranked over the same weeks the stub returns. */
function rankingFor(slug: string, summaries: ReturnType<typeof summaryForRange>[]) {
  const weeks = summaries.map(
    (summary) => summary.muscleVolumes.find((m) => m.slug === slug)?.weightedSets ?? 0
  );
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const baselineAverage = average(weeks.slice(0, 2));
  const recentAverage = average(weeks.slice(-2));
  return {
    muscleSlug: slug,
    weeklyWeightedSets: weeks,
    recentAverage,
    baselineAverage,
    peakWeightedSets: Math.max(0, ...weeks),
    changePct:
      baselineAverage > 0 ? ((recentAverage - baselineAverage) / baselineAverage) * 100 : undefined,
    trend: recentAverage > baselineAverage ? 'up' : 'flat',
  };
}

function engineWithScreenRead() {
  for (const key of Object.keys(mockEngine)) delete mockEngine[key];
  screenCalls = 0;
  Object.assign(mockEngine, {
    subscribe: () => () => {},
    getStrengthScreenData: (
      _startTs: number,
      _endTs: number,
      ranges: { startTs: number; endTs: number }[]
    ) => {
      screenCalls += 1;
      const weekly = ranges.map((_range, idx) => summaryForRange(idx + 1));
      return {
        summary: summaryForRange(10),
        weekly,
        progressions: MUSCLES.map((slug) => rankingFor(slug, weekly)),
        exercises: MUSCLES.map((slug) => ({
          muscleSlug: slug,
          exercises: [
            {
              exerciseName: slug,
              exerciseCategory: 7,
              frequencyDays: 15,
              totalSets: 6,
              totalWeightKg: 120,
              activityCount: 2,
              isPrimary: true,
            },
          ],
        })),
        periodDays: 30,
      };
    },
  });
}

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

describe('useStrengthScreenData', () => {
  let client: QueryClient;

  beforeEach(() => {
    engineWithScreenRead();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('reads once for a drag across five muscles', async () => {
    const wrapper = wrapperWith(client);
    const { result } = renderHook(() => useStrengthScreenData('1m'), { wrapper });
    await waitForData(() => result.current.data);

    expect(screenCalls).toBe(1);

    for (const slug of MUSCLES) {
      expect(selectProgression(result.current.data, slug)?.muscleSlug).toBe(slug);
      expect(selectExercises(result.current.data, slug).exercises).toHaveLength(1);
    }

    expect(screenCalls).toBe(1);
  });

  it('gives each muscle its own series out of the one read', async () => {
    const wrapper = wrapperWith(client);
    const { result } = renderHook(() => useStrengthScreenData('1m'), { wrapper });
    await waitForData(() => result.current.data);

    const chest = selectProgression(result.current.data, 'chest');
    const biceps = selectProgression(result.current.data, 'biceps');

    // biceps is one further along MUSCLES, so every week reads one set higher.
    const chestSets = chest?.points.map((point) => point.weightedSets) ?? [];
    expect(chestSets.length).toBeGreaterThan(0);
    expect(biceps?.points.map((point) => point.weightedSets)).toEqual(
      chestSets.map((sets) => sets + 1)
    );
  });

  it('carries the period summary the diagram is shaded from', async () => {
    const wrapper = wrapperWith(client);
    const { result } = renderHook(() => useStrengthScreenData('1m'), { wrapper });
    await waitForData(() => result.current.data);

    expect(result.current.data?.summary.muscleVolumes.map((v) => v.slug)).toEqual(MUSCLES);
    expect(result.current.data?.periodDays).toBe(30);
  });

  it('reads nothing at all from an engine that has no such call', async () => {
    for (const key of Object.keys(mockEngine)) delete mockEngine[key];
    const wrapper = wrapperWith(client);
    const { result } = renderHook(() => useStrengthScreenData('1m'), { wrapper });
    await flush();

    expect(result.current.data ?? null).toBeNull();
  });
});

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForData(read: () => unknown) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (read()) return;
    await flush();
  }
  throw new Error('screen data never resolved');
}
