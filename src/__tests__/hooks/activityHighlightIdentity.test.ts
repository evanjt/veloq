/**
 * Scenario: the engine announces sections, groups or activities, and the feed
 * rebuilds every card's highlight props from a fresh bundle. Launch alone
 * fires five of those announcements.
 * Expected behaviour: an announcement that carries the same highlights hands
 * back the same objects, because `ActivityCard`'s comparator compares them by
 * identity and a new object re-renders every highlighted card for nothing.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useActivitySectionHighlights } from '@/features/activity/hooks/useActivitySectionHighlights';

// The real reader runs over this engine, so an announcement reaches the hook
// the way the app's does: through the handle's own subscribe.
const mockListeners = new Set<() => void>();
const bump = () => mockListeners.forEach((listener) => listener());

let mockRouteMatchingOn = true;
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => mockRouteMatchingOn,
}));

const mockBundle = jest.fn();
const mockEngine = {
  getActivityHighlightsBundle: (...args: unknown[]) => ({
    strengthCards: [],
    ...mockBundle(...args),
  }),
  subscribe: (_event: string, listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
};
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => ({ log: jest.fn() }) },
}));

function indicator(activityId: string, lapTime: number) {
  return {
    activityId,
    indicatorType: 'section_pr',
    targetId: 'sec-1',
    targetName: 'The Wall',
    direction: 'forward',
    lapTime,
    trend: 1,
  };
}

function routeHighlight(activityId: string, trend: number) {
  return {
    activityId,
    routeId: 'route-1',
    routeName: 'River loop',
    isPr: false,
    trend,
    timeDeltaSeconds: 12,
  };
}

function bundle(lapTime: number, trend: number) {
  return {
    indicators: [indicator('a1', lapTime), indicator('a2', lapTime)],
    routeHighlights: [routeHighlight('a1', trend), routeHighlight('a2', trend)],
    newGround: [],
    strengthCards: [],
  };
}

const IDS = ['a1', 'a2'];

describe('highlight identity across an engine announcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteMatchingOn = true;
    mockBundle.mockImplementation(() => bundle(120, 1));
  });

  it('hands back the same entries when nothing changed', async () => {
    const { result } = await renderHook(() => useActivitySectionHighlights(IDS));
    const first = result.current;

    await act(() => bump());

    expect(mockBundle).toHaveBeenCalledTimes(2);
    expect(result.current.sections.get('a1')).toBe(first.sections.get('a1'));
    expect(result.current.routes.get('a1')).toBe(first.routes.get('a1'));
  });

  it('holds no section or route highlights with route matching off', async () => {
    mockRouteMatchingOn = false;

    const { result } = await renderHook(() => useActivitySectionHighlights(IDS));

    expect(result.current.sections.size).toBe(0);
    expect(result.current.routes.size).toBe(0);
  });

  it('still carries the strength cards with route matching off', async () => {
    mockRouteMatchingOn = false;
    const card = { activityId: 'a1', settled: true, activeSetCount: 3 };
    mockBundle.mockImplementation(() => ({ ...bundle(120, 1), strengthCards: [card] }));

    const { result } = await renderHook(() => useActivitySectionHighlights(IDS));

    expect(result.current.strengthCards).toEqual([card]);
  });

  it('replaces only the entry whose content moved', async () => {
    const { result } = await renderHook(() => useActivitySectionHighlights(IDS));
    const first = result.current;

    mockBundle.mockImplementation(() => ({
      indicators: [indicator('a1', 999), indicator('a2', 120)],
      routeHighlights: [routeHighlight('a1', 1), routeHighlight('a2', 1)],
      newGround: [],
    }));
    await act(() => bump());

    expect(result.current.sections.get('a1')).not.toBe(first.sections.get('a1'));
    expect(result.current.sections.get('a2')).toBe(first.sections.get('a2'));
    expect(result.current.sections.get('a1')?.[0].lapTime).toBe(999);
  });

  it('drops an activity whose highlights are gone', async () => {
    const { result } = await renderHook(() => useActivitySectionHighlights(IDS));

    mockBundle.mockImplementation(() => ({
      indicators: [indicator('a1', 120)],
      routeHighlights: [routeHighlight('a1', 1)],
      newGround: [],
    }));
    await act(() => bump());

    expect(result.current.sections.has('a2')).toBe(false);
    expect(result.current.routes.has('a2')).toBe(false);
  });

  it('holds nothing for an activity that left the batch', async () => {
    const { result, rerender } = await renderHook(
      ({ ids }: { ids: string[] }) => useActivitySectionHighlights(ids),
      { initialProps: { ids: IDS } }
    );
    expect(result.current.sections.get('a1')).toBeDefined();

    await rerender({ ids: ['a2'] });
    await rerender({ ids: IDS });

    // Re-entering the batch rebuilds it rather than serving a stale object.
    expect(result.current.sections.get('a1')?.[0].lapTime).toBe(120);
  });

  it('keeps feed entries when a detail hook reads one activity', async () => {
    mockBundle.mockImplementation((ids: string[]) => ({
      indicators: ids.map((id) => indicator(id, 120)),
      routeHighlights: ids.map((id) => routeHighlight(id, 1)),
      newGround: [],
    }));
    const feed = await renderHook(() => useActivitySectionHighlights(IDS));
    const sections = feed.result.current.sections.get('a2');
    const route = feed.result.current.routes.get('a2');

    const detail = await renderHook(() => useActivitySectionHighlights(['a1']));
    await act(() => bump());

    expect(detail.result.current.sections.has('a2')).toBe(false);
    expect(feed.result.current.sections.get('a2')).toBe(sections);
    expect(feed.result.current.routes.get('a2')).toBe(route);
  });

  it("carries the engine's PR improvement and a null when it has none", async () => {
    mockBundle.mockImplementation(() => ({
      indicators: [],
      routeHighlights: [
        { ...routeHighlight('a1', 1), isPr: true, prImprovementSeconds: 14 },
        { ...routeHighlight('a2', 1), isPr: true, prImprovementSeconds: undefined },
      ],
      newGround: [],
    }));

    const { result } = await renderHook(() => useActivitySectionHighlights(IDS));

    expect(result.current.routes.get('a1')?.prImprovementSeconds).toBe(14);
    expect(result.current.routes.get('a2')?.prImprovementSeconds).toBeNull();
  });

  it('replaces the entry when only the improvement moved', async () => {
    const withImprovement = (seconds: number) => ({
      indicators: [],
      routeHighlights: [{ ...routeHighlight('a1', 1), isPr: true, prImprovementSeconds: seconds }],
      newGround: [],
    });
    mockBundle.mockImplementation(() => withImprovement(14));
    const { result } = await renderHook(() => useActivitySectionHighlights(['a1']));
    const first = result.current.routes.get('a1');

    mockBundle.mockImplementation(() => withImprovement(20));
    await act(() => bump());

    expect(result.current.routes.get('a1')).not.toBe(first);
    expect(result.current.routes.get('a1')?.prImprovementSeconds).toBe(20);
  });

  it('maps the engine coverage and keeps the entry while its tiles hold', async () => {
    const ground = (newTiles: number) => ({
      indicators: [],
      routeHighlights: [],
      newGround: [{ activityId: 'a1', fraction: newTiles / 10, tiles: 10, newTiles }],
    });
    mockBundle.mockImplementation(() => ground(10));
    const { result } = await renderHook(() => useActivitySectionHighlights(['a1']));
    const first = result.current.newGround.get('a1');
    expect(first).toEqual({ fraction: 1, tiles: 10, newTiles: 10 });

    await act(() => bump());
    expect(result.current.newGround.get('a1')).toBe(first);

    mockBundle.mockImplementation(() => ground(6));
    await act(() => bump());
    expect(result.current.newGround.get('a1')).not.toBe(first);
    expect(result.current.newGround.get('a1')).toEqual({ fraction: 0.6, tiles: 10, newTiles: 6 });
  });
});
