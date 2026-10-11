/**
 * Scenario: the routes screen mounts with its first page read while rendering,
 * then pages each list as it scrolls.
 *
 * Expected behaviour: the mount reads the page once, a load-more reads rows of
 * the list being paged and none of the other, and the other list keeps its rows
 * and its own answer to whether it has more.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useRoutesScreenData } from '@/features/routes/hooks/useRoutesScreenData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

let mockTrigger = 0;
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => mockTrigger,
}));

let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: (callback: () => void) => {
    mockFocus = callback;
  },
}));

const mockIdle: (() => void)[] = [];
jest.mock('@/shared/async/runWhenIdle', () => ({
  runWhenIdle: (task: () => void) => {
    let cancelled = false;
    mockIdle.push(() => {
      if (!cancelled) task();
    });
    return () => {
      cancelled = true;
    };
  },
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface Query {
  groupOffset: number;
  groupLimit: number;
  sectionOffset: number;
  sectionLimit: number;
}

/** A library of `groups` groups and `sections` sections, paged as the engine pages it. */
function library(groups: number, sections: number) {
  return jest.fn((q: Query) => {
    const groupPage = Array.from(
      { length: Math.max(0, Math.min(q.groupLimit, groups - q.groupOffset)) },
      (_, i) => ({ groupId: `g${q.groupOffset + i}` })
    );
    const sectionPage = Array.from(
      { length: Math.max(0, Math.min(q.sectionLimit, sections - q.sectionOffset)) },
      (_, i) => ({ id: `s${q.sectionOffset + i}` })
    );
    return {
      groups: groupPage,
      sections: sectionPage,
      hasMoreGroups: groups > q.groupOffset + groupPage.length,
      hasMoreSections: sections > q.sectionOffset + sectionPage.length,
      groupCount: groups,
      sectionCount: sections,
    };
  });
}

function flushIdle() {
  act(() => {
    while (mockIdle.length > 0) mockIdle.shift()!();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIdle.length = 0;
  mockTrigger = 0;
  mockFocus = null;
});

describe('the routes screen mount', () => {
  it('reads the first page once', () => {
    const read = library(3, 3);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData: read } as never);

    renderHook(() => useRoutesScreenData());
    flushIdle();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads again once idle when the engine was not ready at render', () => {
    const read = library(3, 3);
    mockedGetEngine
      .mockReturnValueOnce(null)
      .mockReturnValue({ getRoutesScreenData: read } as never);

    const { result } = renderHook(() => useRoutesScreenData());
    expect(result.current.data).toBeNull();
    flushIdle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.data?.groups).toHaveLength(3);
  });

  it('reads again on focus after an engine event it missed', () => {
    const read = library(3, 3);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData: read } as never);

    const { rerender } = renderHook(() => useRoutesScreenData());
    flushIdle();
    mockTrigger = 1;
    rerender({});
    flushIdle();
    const afterEvent = read.mock.calls.length;
    expect(afterEvent).toBe(2);

    act(() => mockFocus?.());
    flushIdle();

    expect(read.mock.calls.length).toBe(afterEvent + 1);
  });
});

describe('a load-more', () => {
  it('reads no sections while paging groups and keeps the sections it has', () => {
    const read = library(5, 3);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData: read } as never);

    const { result } = renderHook(() => useRoutesScreenData({ groupLimit: 2, sectionLimit: 5 }));
    flushIdle();
    act(() => result.current.loadMoreGroups());
    flushIdle();

    const query = read.mock.calls.at(-1)![0];
    expect(query).toMatchObject({ groupOffset: 2, groupLimit: 2, sectionLimit: 0 });
    expect(result.current.data?.groups.map((g) => g.groupId)).toEqual(['g0', 'g1', 'g2', 'g3']);
    expect(result.current.data?.sections.map((s) => s.id)).toEqual(['s0', 's1', 's2']);
    expect(result.current.hasMoreSections).toBe(false);
    expect(result.current.hasMoreGroups).toBe(true);
  });

  it('reads no groups while paging sections and keeps the groups it has', () => {
    const read = library(3, 5);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData: read } as never);

    const { result } = renderHook(() => useRoutesScreenData({ groupLimit: 5, sectionLimit: 2 }));
    flushIdle();
    act(() => result.current.loadMoreSections());
    flushIdle();

    const query = read.mock.calls.at(-1)![0];
    expect(query).toMatchObject({ sectionOffset: 2, sectionLimit: 2, groupLimit: 0 });
    expect(result.current.data?.sections.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(result.current.data?.groups.map((g) => g.groupId)).toEqual(['g0', 'g1', 'g2']);
    expect(result.current.hasMoreGroups).toBe(false);
  });

  it('stops asking for groups once a finished group list stays finished across section pages', () => {
    const read = library(1, 7);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData: read } as never);

    const { result } = renderHook(() => useRoutesScreenData({ groupLimit: 5, sectionLimit: 2 }));
    flushIdle();
    act(() => result.current.loadMoreSections());
    flushIdle();
    const calls = read.mock.calls.length;
    act(() => result.current.loadMoreGroups());
    flushIdle();

    expect(read.mock.calls.length).toBe(calls);
  });
});

describe('a load-more of each list before the read lands', () => {
  it('reads both pages in one read and loses neither', () => {
    const read = library(5, 5);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData: read } as never);

    const { result } = renderHook(() => useRoutesScreenData({ groupLimit: 2, sectionLimit: 2 }));
    flushIdle();
    act(() => {
      result.current.loadMoreGroups();
      result.current.loadMoreSections();
    });
    flushIdle();

    expect(read.mock.calls.at(-1)![0]).toMatchObject({
      groupOffset: 2,
      groupLimit: 2,
      sectionOffset: 2,
      sectionLimit: 2,
    });
    expect(result.current.data?.groups.map((g) => g.groupId)).toEqual(['g0', 'g1', 'g2', 'g3']);
    expect(result.current.data?.sections.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3']);
  });
});
