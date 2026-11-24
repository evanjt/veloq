/**
 * Scenario: the engine throws a tagged failure while a hook reads it.
 *
 * Expected behaviour: the hook hands the thrown value back as `error` instead
 * of an empty value, so a screen can tell a failed read from a library with
 * nothing in it. A read that succeeds carries no error.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useGroupSummaries, useSectionSummaries } from '@/features/routes/hooks/useEngine';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { useMuscleGroups } from '@/features/strength/hooks/useExerciseSets';
import { engineErrorTag } from '@/shared/native/engineError';

jest.mock('@/shared/native/engine', () => {
  const getEngine = jest.fn();
  return { getEngine, isEngineReady: () => getEngine() != null };
});
// The routes namespace answers through the engine handle unless a test sets
// its own answer here, so the handle and the namespace can be told apart.
const mockRouteAnswer: { groups?: unknown } = {};

jest.mock('veloqrs', () => {
  const stub = require('../__shared__/veloqrsStub');
  const over = stub.namespacesOver(() => require('@/shared/native/engine').getEngine());
  return stub.withOverrides({
    ...over,
    routes: {
      ...over.routes,
      getFilteredGroupSummaries: (...args: unknown[]) =>
        mockRouteAnswer.groups ??
        (over.routes.getFilteredGroupSummaries as (...a: unknown[]) => unknown)(...args),
    },
  });
});
jest.mock('@/shared/ffi/sectionConversions', () => ({
  convertNativeSectionToApp: (native: { id: string }) => ({ ...native }),
}));

const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };
const failing = () => {
  throw lockFailed;
};

const engine = {
  subscribe: () => () => undefined,
  getFilteredSectionSummaries: jest.fn(failing),
  getFilteredGroupSummaries: jest.fn(failing),
  getSectionById: jest.fn(failing),
  getMuscleGroups: jest.fn(failing),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('route engine hooks', () => {
  it('useSectionSummaries reports a thrown read', async () => {
    const { result } = await renderHook(() => useSectionSummaries());
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('useGroupSummaries reports a thrown read', async () => {
    const { result } = await renderHook(() => useGroupSummaries());
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('useGroupSummaries takes its rows from the routes namespace, not the handle', async () => {
    const groups = { totalCount: 1, summaries: [{ groupId: 'g1' }] };
    mockRouteAnswer.groups = groups;
    try {
      const { result } = await renderHook(() => useGroupSummaries());
      expect(result.current.error).toBeUndefined();
      expect(result.current.totalCount).toBe(1);
      expect(result.current.summaries).toEqual(groups.summaries);
    } finally {
      delete mockRouteAnswer.groups;
    }
  });

  vaultIt('useGroupSummaries reads nothing while disabled', async () => {
    const { result } = await renderHook(() => useGroupSummaries({ enabled: false }));
    expect(engine.getFilteredGroupSummaries).not.toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();
    expect(result.current.summaries).toEqual([]);
  });

  it('useSectionDetail reports a thrown read rather than not found', async () => {
    const { result } = await renderHook(() => useSectionDetail('s1'));
    expect(result.current.section).toBeNull();
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('a read that answers nothing is not an error', async () => {
    engine.getSectionById.mockImplementation(() => null as never);
    const detail = await renderHook(() => useSectionDetail('s1'));
    expect(detail.result.current.section).toBeNull();
    expect(detail.result.current.error).toBeUndefined();
  });
});

describe('useMuscleGroups', () => {
  function wrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    return Wrapper;
  }

  it('records a thrown read as a query error, not a cached empty list', async () => {
    const { result } = await renderHook(() => useMuscleGroups('act-1', true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('caches the muscles a successful read returns', async () => {
    engine.getMuscleGroups.mockImplementation(() => [{ slug: 'chest', intensity: 2 }] as never);
    const { result } = await renderHook(() => useMuscleGroups('act-1', true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ slug: 'chest', intensity: 2 }]);
  });
});
