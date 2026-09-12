/**
 * Scenario: a finger drags across the body diagram, crossing one muscle after
 * another, and each new muscle asks for that muscle's four-week progression.
 *
 * Expected behaviour: the trailing weeks are read once and every muscle's
 * progression is derived from that read, so a drag issues no engine call at all
 * after the first muscle. The batch read does not depend on which muscle is
 * selected, so keying it on the muscle was paying four range reads a frame for
 * four numbers already in hand.
 */
import { renderHook } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useStrengthProgression } from '@/features/strength/hooks/useStrengthVolume';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockEngine: Record<string, unknown> = {};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

const MUSCLES = ['chest', 'biceps', 'quadriceps', 'abs', 'upper-back'];

let batchCalls = 0;

function summaryForRange(weightedSets: number) {
  return {
    muscleVolumes: MUSCLES.map((slug, index) => ({
      slug,
      name: slug,
      sets: weightedSets + index,
      weightedSets: weightedSets + index,
      totalReps: 10,
      totalWeightKg: 100,
      exerciseNames: [slug],
    })),
    activityCount: 3,
    totalSets: 12,
  };
}

function engineWithBatch() {
  for (const key of Object.keys(mockEngine)) delete mockEngine[key];
  batchCalls = 0;
  Object.assign(mockEngine, {
    subscribe: () => () => {},
    getStrengthSummaryBatch: (ranges: { startTs: number; endTs: number }[]) => {
      batchCalls += 1;
      return ranges.map((_range, idx) => summaryForRange(idx + 1));
    },
  });
}

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

describe('useStrengthProgression', () => {
  let client: QueryClient;

  beforeEach(() => {
    engineWithBatch();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('reads the trailing weeks once for a drag across five muscles', async () => {
    const wrapper = wrapperWith(client);
    const { result, rerender } = renderHook(
      ({ slug }: { slug: string | null }) => useStrengthProgression(slug),
      { initialProps: { slug: MUSCLES[0] as string | null }, wrapper }
    );

    await waitForProgression(() => result.current.data);
    expect(batchCalls).toBe(1);

    for (const slug of MUSCLES.slice(1)) {
      rerender({ slug });
      await waitForProgression(() => result.current.data);
    }

    expect(batchCalls).toBe(1);
  });

  it('gives each muscle its own series out of the one read', async () => {
    const wrapper = wrapperWith(client);
    const chest = renderHook(() => useStrengthProgression('chest'), { wrapper });
    await waitForProgression(() => chest.result.current.data);
    const biceps = renderHook(() => useStrengthProgression('biceps'), { wrapper });
    await waitForProgression(() => biceps.result.current.data);

    expect(batchCalls).toBe(1);
    expect(chest.result.current.data?.muscleSlug).toBe('chest');
    expect(biceps.result.current.data?.muscleSlug).toBe('biceps');
    // biceps is one further along MUSCLES, so every week reads one set higher.
    const chestSets = chest.result.current.data?.points.map((p) => p.weightedSets) ?? [];
    const bicepsSets = biceps.result.current.data?.points.map((p) => p.weightedSets) ?? [];
    expect(chestSets.length).toBeGreaterThan(0);
    expect(bicepsSets).toEqual(chestSets.map((sets) => sets + 1));
  });

  it('reads nothing while no muscle is selected', async () => {
    const wrapper = wrapperWith(client);
    renderHook(() => useStrengthProgression(null), { wrapper });
    await flush();
    expect(batchCalls).toBe(0);
  });
});

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForProgression(read: () => unknown) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (read()) return;
    await flush();
  }
  throw new Error('progression never resolved');
}
