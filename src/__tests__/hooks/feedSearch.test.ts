/**
 * Scenario: the feed filtered the thirty-day windows it had paged in, so a
 * search or a sport chip answered "no match" for anything older than what was
 * loaded. The filtered feed now reads the engine's search over the whole
 * library.
 *
 * Expected behaviour: a search or a chip reads the engine with the trimmed
 * text and the chip's engine family, pages on from where the last page ended,
 * reports the engine's count of every match, answers in the render that asked
 * so the list does not blank between keystrokes, and reads nothing when no
 * filter is on.
 */

import { EngineSportFamily } from 'veloqrs';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useFeedSearch } from '@/features/activity/hooks/useActivities';
import type { FeedGroup } from '@/features/activity/lib/feedActivityGroups';
import type { FeedRange } from '@/features/activity/lib/feedRange';
import { dayEndEpochSeconds, dayStartEpochSeconds } from '@/shared/time/startDate';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const engine = {
  searchActivityBodies: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

const body = (id: string) => JSON.stringify({ id, name: `Ferry ${id}`, type: 'Ride' });

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.searchActivityBodies.mockReturnValue({
    bodies: [],
    intervalsIds: [],
    keys: [],
    matchedCount: 0,
    hasMore: false,
  });
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
});

afterEach(() => {
  client.clear();
});

function render(text: string, group: FeedGroup | null, range: FeedRange | null = null) {
  return renderHook(() => useFeedSearch(text, group ? new Set([group]) : new Set(), range), {
    wrapper,
  });
}

const MARCH_2024: FeedRange = { oldest: '2024-03-01', newest: '2024-03-31' };

describe('useFeedSearch', () => {
  it('reads the engine with the trimmed text and no sport when only text is set', async () => {
    engine.searchActivityBodies.mockReturnValue({
      bodies: [body('old')],
      intervalsIds: [null],
      keys: ['old'],
      matchedCount: 1,
      hasMore: false,
    });

    const { result } = await render('  ferry ', null);

    await waitFor(() => expect(result.current.activities.map((a) => a.id)).toEqual(['old']));
    expect(engine.searchActivityBodies).toHaveBeenCalledWith({
      needle: 'ferry',
      sportFamilies: [],
      offset: 0,
      limit: 30,
    });
    expect(result.current.matchedCount).toBe(1);
  });

  it.each([
    ['Ride', EngineSportFamily.Ride],
    ['Winter', EngineSportFamily.Winter],
    ['Run', EngineSportFamily.Run],
    ['Water', EngineSportFamily.Water],
    ['Foot', EngineSportFamily.Foot],
    ['Strength', EngineSportFamily.Strength],
    ['Other', EngineSportFamily.Other],
  ] as const)('reads the %s chip as the engine family of that name', async (chip, group) => {
    const { result } = await render('', chip);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(engine.searchActivityBodies).toHaveBeenCalledWith({
      needle: '',
      sportFamilies: [group],
      offset: 0,
      limit: 30,
    });
  });

  it('passes two selected families to one whole-library read', async () => {
    const selected = new Set<FeedGroup>(['Ride', 'Other']);
    const { result } = await renderHook(() => useFeedSearch('', selected), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(engine.searchActivityBodies).toHaveBeenCalledWith({
      needle: '',
      sportFamilies: [EngineSportFamily.Ride, EngineSportFamily.Other],
      offset: 0,
      limit: 30,
    });
  });

  it('has the first page in the render that asked for it, so the list never blanks', async () => {
    engine.searchActivityBodies.mockReturnValue({
      bodies: [body('old')],
      intervalsIds: [null],
      keys: ['old'],
      matchedCount: 1,
      hasMore: false,
    });

    const { result, rerender } = await renderHook(
      ({ text }: { text: string }) => useFeedSearch(text, new Set()),
      { wrapper, initialProps: { text: 'f' } }
    );
    expect(result.current.activities.map((a) => a.id)).toEqual(['old']);
    expect(result.current.isLoading).toBe(false);

    engine.searchActivityBodies.mockReturnValue({
      bodies: [body('older')],
      intervalsIds: [null],
      keys: ['older'],
      matchedCount: 1,
      hasMore: false,
    });
    await rerender({ text: 'fe' });
    expect(result.current.activities.map((a) => a.id)).toEqual(['older']);
  });

  it('sends the range as an inclusive window of epoch seconds with the chip', async () => {
    const { result } = await render('', 'Ride', MARCH_2024);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(engine.searchActivityBodies).toHaveBeenCalledWith({
      needle: '',
      sportFamilies: [EngineSportFamily.Ride],
      oldestTs: dayStartEpochSeconds('2024-03-01'),
      newestTs: dayEndEpochSeconds('2024-03-31'),
      offset: 0,
      limit: 30,
    });
  });

  it('keeps the window on the next page', async () => {
    engine.searchActivityBodies
      .mockReturnValueOnce({
        bodies: Array.from({ length: 30 }, (_, i) => body(`p1-${i}`)),
        intervalsIds: Array.from({ length: 30 }, () => null),
        keys: Array.from({ length: 30 }, (_, i) => `p1-${i}`),
        matchedCount: 31,
        hasMore: true,
      })
      .mockReturnValueOnce({
        bodies: [],
        intervalsIds: [],
        keys: [],
        matchedCount: 31,
        hasMore: false,
      });
    const { result } = await render('ferry', null, MARCH_2024);

    await waitFor(() => expect(result.current.activities).toHaveLength(30));
    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(engine.searchActivityBodies).toHaveBeenLastCalledWith(
      expect.objectContaining({
        oldestTs: dayStartEpochSeconds('2024-03-01'),
        newestTs: dayEndEpochSeconds('2024-03-31'),
        offset: 30,
      })
    );
  });

  it('re-reads when the range changes rather than serving the other range', async () => {
    const { rerender } = await renderHook(
      ({ range }: { range: FeedRange | null }) => useFeedSearch('ferry', new Set(), range),
      { wrapper, initialProps: { range: MARCH_2024 as FeedRange | null } }
    );
    await rerender({ range: { oldest: '2023-01-01', newest: '2023-12-31' } });

    expect(engine.searchActivityBodies).toHaveBeenLastCalledWith(
      expect.objectContaining({ oldestTs: dayStartEpochSeconds('2023-01-01') })
    );
  });

  it('sends no window when no range is set', async () => {
    const { result } = await render('ferry', null);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = engine.searchActivityBodies.mock.calls[0][0];
    expect(query).not.toHaveProperty('oldestTs');
    expect(query).not.toHaveProperty('newestTs');
  });

  it('counts a range alone without reading a body, since the range read lists it', async () => {
    engine.searchActivityBodies.mockReturnValue({ bodies: [], matchedCount: 212, hasMore: true });

    const { result } = await render('', null, MARCH_2024);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(engine.searchActivityBodies).toHaveBeenCalledWith({
      needle: '',
      sportFamilies: [],
      oldestTs: dayStartEpochSeconds('2024-03-01'),
      newestTs: dayEndEpochSeconds('2024-03-31'),
      offset: 0,
      limit: 0,
    });
    expect(result.current.matchedCount).toBe(212);
    expect(result.current.activities).toEqual([]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('reads nothing while no filter is on, blank text included', async () => {
    const { result } = await render('   ', null);

    expect(engine.searchActivityBodies).not.toHaveBeenCalled();
    expect(result.current.activities).toEqual([]);
    expect(result.current.matchedCount).toBe(0);
  });

  it('pages on from where the last page ended and keeps the whole count', async () => {
    engine.searchActivityBodies
      .mockReturnValueOnce({
        bodies: Array.from({ length: 30 }, (_, i) => body(`p1-${i}`)),
        intervalsIds: Array.from({ length: 30 }, () => null),
        keys: Array.from({ length: 30 }, (_, i) => `p1-${i}`),
        matchedCount: 31,
        hasMore: true,
      })
      .mockReturnValueOnce({
        bodies: [body('p2-0')],
        intervalsIds: [null],
        keys: ['p2-0'],
        matchedCount: 31,
        hasMore: false,
      });

    const { result } = await render('', 'Water');

    await waitFor(() => expect(result.current.activities).toHaveLength(30));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(engine.searchActivityBodies).toHaveBeenLastCalledWith({
      needle: '',
      sportFamilies: [EngineSportFamily.Water],
      offset: 30,
      limit: 30,
    });
    await waitFor(() => expect(result.current.activities).toHaveLength(31));
    expect(result.current.activities[30].id).toBe('p2-0');
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.matchedCount).toBe(31);
  });

  it('drops a body that will not parse rather than failing the page', async () => {
    engine.searchActivityBodies.mockReturnValue({
      bodies: ['{broken', body('kept')],
      intervalsIds: [null, 'i7'],
      keys: ['broken', 'kept'],
      matchedCount: 2,
      hasMore: false,
    });

    const { result } = await render('ferry', null);

    await waitFor(() => expect(result.current.activities.map((a) => a.id)).toEqual(['kept']));
    expect(result.current.activities[0].intervalsWebId).toBe('i7');
  });

  it('is an error rather than an empty match when the engine is not open', async () => {
    engine.searchActivityBodies.mockReturnValue(undefined);

    const { result } = await render('ferry', null);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.activities).toEqual([]);
  });
});
