/**
 * Scenario: the engine's startup bundle names the activities that arrived
 * since the athlete last looked. The feed draws its rings from that set.
 *
 * Expected behaviour: the hook carries the engine's ids, and two reads of the
 * same set hand back the same object, so cards do not re-render on every read.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useStartupData } from '@/features/home/hooks/useStartupData';
import { SyncState } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/features/insights/lib/insightsParams', () => ({
  buildInsightsParams: () => ({}),
}));

const listeners = new Map<string, Set<() => void>>();
let newIds: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  listeners.clear();
  newIds = ['a1', 'a2'];
  (getEngine as jest.Mock).mockReturnValue({
    getSyncStatus: () => ({ state: SyncState.Idle }),
    getStartupData: () => ({ summaryCard: {}, previewTracks: [], newActivityIds: [...newIds] }),
    subscribe: (event: string, cb: () => void) => {
      const forEvent = listeners.get(event) ?? new Set<() => void>();
      forEvent.add(cb);
      listeners.set(event, forEvent);
      return () => forEvent.delete(cb);
    },
  });
});

afterEach(() => jest.useRealTimers());

function announce(event: string) {
  act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe('useStartupData newActivityIds', () => {
  it('carries the engine ids', () => {
    const { result, unmount } = renderHook(() => useStartupData(['a1']));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect([...(result.current.data?.newActivityIds ?? [])].sort()).toEqual(['a1', 'a2']);
    act(() => unmount());
  });

  it('keeps its identity across two reads of the same set', () => {
    const { result, unmount } = renderHook(() => useStartupData(['a1']));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    const first = result.current.data?.newActivityIds;
    announce('activities');
    expect(result.current.data?.newActivityIds).toBe(first);
    act(() => unmount());
  });

  it('changes when the set changes', () => {
    const { result, unmount } = renderHook(() => useStartupData(['a1']));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    const first = result.current.data?.newActivityIds;
    newIds = ['a2'];
    announce('activities');
    expect(result.current.data?.newActivityIds).not.toBe(first);
    expect([...(result.current.data?.newActivityIds ?? [])]).toEqual(['a2']);
    act(() => unmount());
  });
});
