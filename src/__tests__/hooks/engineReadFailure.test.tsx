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
import {
  useEngineGroups,
  useGroupSummaries,
  useSectionSummaries,
} from '@/features/routes/hooks/useEngine';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { useMuscleGroups } from '@/features/strength/hooks/useExerciseSets';
import { engineErrorTag } from '@/shared/native/engineError';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/ffi/sectionConversions', () => ({
  convertNativeSectionToApp: (native: { id: string }) => ({ ...native }),
}));

const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };
const failing = () => {
  throw lockFailed;
};

const engine = {
  subscribe: () => () => undefined,
  getGroups: jest.fn(failing),
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
  it('useEngineGroups reports a thrown read', () => {
    const { result } = renderHook(() => useEngineGroups());
    expect(engineErrorTag(result.current.error)).toBe('Database');
    expect(result.current.groups).toEqual([]);
  });

  it('useSectionSummaries reports a thrown read', () => {
    const { result } = renderHook(() => useSectionSummaries());
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('useGroupSummaries reports a thrown read', () => {
    const { result } = renderHook(() => useGroupSummaries());
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('useGroupSummaries reads nothing while disabled', () => {
    const { result } = renderHook(() => useGroupSummaries({ enabled: false }));
    expect(engine.getFilteredGroupSummaries).not.toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();
    expect(result.current.summaries).toEqual([]);
  });

  it('useSectionDetail reports a thrown read rather than not found', () => {
    const { result } = renderHook(() => useSectionDetail('s1'));
    expect(result.current.section).toBeNull();
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('a read that answers nothing is not an error', () => {
    engine.getSectionById.mockImplementation(() => null as never);
    const detail = renderHook(() => useSectionDetail('s1'));
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
    const { result } = renderHook(() => useMuscleGroups('act-1', true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(engineErrorTag(result.current.error)).toBe('Database');
  });

  it('caches the muscles a successful read returns', async () => {
    engine.getMuscleGroups.mockImplementation(() => [{ slug: 'chest', intensity: 2 }] as never);
    const { result } = renderHook(() => useMuscleGroups('act-1', true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ slug: 'chest', intensity: 2 }]);
  });
});
