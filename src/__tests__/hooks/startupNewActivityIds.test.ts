/**
 * Scenario: the engine's startup bundle names the activities that arrived
 * since the athlete last looked. The feed draws its rings from that set.
 *
 * Expected behaviour: the hook carries the engine's ids, and two reads of the
 * same set hand back the same object, so cards do not re-render on every read.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

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

  it('stamps an unstamped ring before publishing its deadline', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 100;
    const recordFeedSeen = jest.fn();
    const getStartupData = jest
      .fn()
      .mockReturnValueOnce({
        summaryCard: {},
        previewTracks: [],
        newActivityIds: ['a1'],
        ringStampRequired: true,
      })
      .mockReturnValueOnce({
        summaryCard: {},
        previewTracks: [],
        newActivityIds: ['a1'],
        nextRingExpiryAt: expiresAt,
        ringStampRequired: false,
      });
    (getEngine as jest.Mock).mockReturnValue({
      getSyncStatus: () => ({ state: SyncState.Idle }),
      getStartupData,
      recordFeedSeen,
      subscribe: () => () => {},
    });
    const { result, unmount } = renderHook(() => useStartupData(['a1']));
    act(() => jest.advanceTimersByTime(0));
    expect(recordFeedSeen).toHaveBeenCalledTimes(1);
    expect(getStartupData).toHaveBeenCalledTimes(2);
    expect(result.current.data?.nextRingExpiryAt).toBe(expiresAt);
    act(() => unmount());
  });

  it('keeps the feed empty when the first ring stamp fails', () => {
    const getStartupData = jest.fn(() => ({
      summaryCard: {},
      previewTracks: [],
      newActivityIds: ['a1'],
      ringStampRequired: true,
    }));
    (getEngine as jest.Mock).mockReturnValue({
      getSyncStatus: () => ({ state: SyncState.Idle }),
      getStartupData,
      recordFeedSeen: () => {
        throw new Error('write failed');
      },
      subscribe: () => () => {},
    });
    const { result, unmount } = renderHook(() => useStartupData(['a1']));
    act(() => jest.advanceTimersByTime(0));
    expect(result.current.data).toBeNull();
    expect(getStartupData).toHaveBeenCalledTimes(1);
    act(() => unmount());
  });

  it('refreshes at the engine deadline and after foreground resume', () => {
    let onState: ((state: string) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      onState = callback as (state: string) => void;
      return { remove } as ReturnType<typeof AppState.addEventListener>;
    });
    const expiresAt = 1_000_010;
    jest.setSystemTime(1_000_000 * 1000);
    const getStartupData = jest.fn(() => ({
      summaryCard: {},
      previewTracks: [],
      newActivityIds: Date.now() < expiresAt * 1000 ? ['a1'] : [],
      nextRingExpiryAt: Date.now() < expiresAt * 1000 ? expiresAt : null,
    }));
    (getEngine as jest.Mock).mockReturnValue({
      getSyncStatus: () => ({ state: SyncState.Idle }),
      getStartupData,
      subscribe: () => () => {},
    });
    const { result, unmount } = renderHook(() => useStartupData(['a1']));
    act(() => jest.advanceTimersByTime(0));
    expect([...result.current.data!.newActivityIds]).toEqual(['a1']);

    act(() => jest.advanceTimersByTime(10_000));
    act(() => jest.runOnlyPendingTimers());
    expect([...result.current.data!.newActivityIds]).toEqual([]);
    expect(getStartupData).toHaveBeenCalledTimes(2);

    act(() => onState?.('background'));
    act(() => onState?.('active'));
    act(() => jest.advanceTimersByTime(0));
    expect(getStartupData).toHaveBeenCalledTimes(3);
    expect([...result.current.data!.newActivityIds]).toEqual([]);
    act(() => unmount());
    jest.restoreAllMocks();
  });

  it('refreshes after resume when the deadline passed in the background', () => {
    let onState: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      onState = callback as (state: string) => void;
      return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
    });
    const expiresAt = 1_000_010;
    jest.setSystemTime(1_000_000 * 1000);
    const getStartupData = jest.fn(() => ({
      summaryCard: {},
      previewTracks: [],
      newActivityIds: Date.now() < expiresAt * 1000 ? ['a1'] : [],
      nextRingExpiryAt: Date.now() < expiresAt * 1000 ? expiresAt : null,
    }));
    (getEngine as jest.Mock).mockReturnValue({
      getSyncStatus: () => ({ state: SyncState.Idle }),
      getStartupData,
      subscribe: () => () => {},
    });
    const { result, unmount } = renderHook(() => useStartupData(['a1']));
    act(() => jest.advanceTimersByTime(0));
    expect([...result.current.data!.newActivityIds]).toEqual(['a1']);

    act(() => onState?.('background'));
    jest.setSystemTime((expiresAt + 1) * 1000);
    act(() => onState?.('active'));
    act(() => jest.runOnlyPendingTimers());
    expect([...result.current.data!.newActivityIds]).toEqual([]);
    expect(getStartupData).toHaveBeenCalledTimes(2);
    act(() => unmount());
    jest.restoreAllMocks();
  });
});
