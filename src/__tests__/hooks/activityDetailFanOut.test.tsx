/**
 * Scenario: the activity detail screen reads the engine once, through
 * `getActivityDetailData`.
 * Expected behaviour: every hook the screen mounts takes its slice of that
 * bundle as pre-computed input and makes no engine read of its own.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useCustomSections } from '@/features/routes/hooks/useCustomSections';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { getEngine } from '@/shared/native/engine';
import { queryKeys } from '@/shared/query/queryKeys';
import type { Section as NativeSection } from 'veloqrs';

jest.mock('veloqrs', () => ({
  decodeCoords: () => [],
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  getSectionsByType: jest.fn(() => []),
  getActivityCount: jest.fn(() => 0),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

const nativeSection = {
  id: 'custom-1',
  sectionType: 'custom',
  sportType: 'Ride',
  encodedPolyline: new ArrayBuffer(0),
  representativeActivityId: 'act-1',
  activityIds: ['act-1'],
  visitCount: 1,
  distanceMeters: 1000,
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as NativeSection;

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  client.clear();
});

describe('activity detail fan-out', () => {
  it('reads no custom sections when the bundle already carried them', async () => {
    const { result } = renderHook(
      () => useCustomSections({ preComputedSections: [nativeSection] }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.sections).toHaveLength(1));
    expect(engine.getSectionsByType).not.toHaveBeenCalled();
  });

  it('reads no custom sections when the bundle carried an empty list', async () => {
    const { result } = renderHook(() => useCustomSections({ preComputedSections: [] }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sections).toEqual([]);
    expect(engine.getSectionsByType).not.toHaveBeenCalled();
  });

  it('reads no custom sections when another screen already primed the cache', async () => {
    client.setQueryData(queryKeys.sections.custom, []);
    client.setQueryDefaults(queryKeys.sections.custom, { staleTime: 0 });

    const { result } = renderHook(
      () => useCustomSections({ preComputedSections: [nativeSection] }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.sections).toHaveLength(1));
    expect(engine.getSectionsByType).not.toHaveBeenCalled();
  });

  it('still reads the engine when no caller supplied the sections', async () => {
    renderHook(() => useCustomSections(), { wrapper });

    await waitFor(() => expect(engine.getSectionsByType).toHaveBeenCalledWith('custom'));
  });

  it('reads no activity count when the bundle already carried it', () => {
    renderHook(() => useCacheDays(42), { wrapper });

    expect(engine.getActivityCount).not.toHaveBeenCalled();
  });
});
