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

let bump: () => void = () => {};
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => {
    const { useState } = jest.requireActual<typeof import('react')>('react');
    const [n, setN] = useState(0);
    bump = () => setN((v: number) => v + 1);
    return n;
  },
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => true,
}));

const mockBundle = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getActivityHighlightsBundle: mockBundle }),
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
  };
}

const IDS = ['a1', 'a2'];

describe('highlight identity across an engine announcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBundle.mockImplementation(() => bundle(120, 1));
  });

  it('hands back the same entries when nothing changed', () => {
    const { result } = renderHook(() => useActivitySectionHighlights(IDS));
    const first = result.current;

    act(() => bump());

    expect(mockBundle).toHaveBeenCalledTimes(2);
    expect(result.current.sections.get('a1')).toBe(first.sections.get('a1'));
    expect(result.current.routes.get('a1')).toBe(first.routes.get('a1'));
  });

  it('replaces only the entry whose content moved', () => {
    const { result } = renderHook(() => useActivitySectionHighlights(IDS));
    const first = result.current;

    mockBundle.mockImplementation(() => ({
      indicators: [indicator('a1', 999), indicator('a2', 120)],
      routeHighlights: [routeHighlight('a1', 1), routeHighlight('a2', 1)],
    }));
    act(() => bump());

    expect(result.current.sections.get('a1')).not.toBe(first.sections.get('a1'));
    expect(result.current.sections.get('a2')).toBe(first.sections.get('a2'));
    expect(result.current.sections.get('a1')?.[0].lapTime).toBe(999);
  });

  it('drops an activity whose highlights are gone', () => {
    const { result } = renderHook(() => useActivitySectionHighlights(IDS));

    mockBundle.mockImplementation(() => ({
      indicators: [indicator('a1', 120)],
      routeHighlights: [routeHighlight('a1', 1)],
    }));
    act(() => bump());

    expect(result.current.sections.has('a2')).toBe(false);
    expect(result.current.routes.has('a2')).toBe(false);
  });

  it('holds nothing for an activity that left the batch', () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useActivitySectionHighlights(ids),
      { initialProps: { ids: IDS } }
    );
    expect(result.current.sections.get('a1')).toBeDefined();

    rerender({ ids: ['a2'] });
    rerender({ ids: IDS });

    // Re-entering the batch rebuilds it rather than serving a stale object.
    expect(result.current.sections.get('a1')?.[0].lapTime).toBe(120);
  });
});
