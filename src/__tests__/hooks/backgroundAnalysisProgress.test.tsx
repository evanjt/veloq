/**
 * Scenario: a sync settles while detection is still running in Rust, and
 * nothing on the TypeScript side is following the run any more.
 *
 * Expected behaviour: the range panel on sync settings keeps showing that the
 * analysis is running for as long as the engine's sync status carries it, and
 * drops it when the status no longer does.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';

import { SyncRangePanel } from '@/features/settings/components/SyncRangePanel';
import { getEngine } from '@/shared/native/engine';
import { TRACK_STAGE_REREAD_MS } from '@/shared/native/useSyncStatus';
import { SyncState, TrackStep, type SyncStatus, type TrackStage } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));
jest.mock('@/features/maps', () => ({
  ...jest.requireActual('@/features/maps/lib/syncProgressFormat'),
  TimelineSlider: () => null,
}));
jest.mock('@/features/activity', () => ({
  useActivityBoundsCache: () => ({
    cacheStats: { oldestDate: null, totalActivities: 0 },
    syncDateRange: jest.fn(),
  }),
}));
jest.mock('@/shared/app/useOldestActivityDate', () => ({
  useOldestActivityDate: () => ({ data: null }),
}));
jest.mock('@/features/settings/hooks/useActivityYearCounts', () => ({
  useActivityYearCounts: () => ({ data: [] }),
}));

const analysing: TrackStage = {
  step: TrackStep.Analysing,
  completed: 3,
  total: 8,
  percent: 40,
};

let tracks: TrackStage | undefined;
const listeners = new Map<string, Set<() => void>>();

function settledSync(): SyncStatus {
  return { state: SyncState.Idle, completed: 4, total: 4, inFlight: 0, tracks } as SyncStatus;
}

beforeEach(() => {
  jest.useFakeTimers();
  tracks = undefined;
  listeners.clear();
  (getEngine as jest.Mock).mockReturnValue({
    getSyncStatus: () => settledSync(),
    subscribe: (channel: string, listener: () => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
      return () => listeners.get(channel)?.delete(listener);
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function progressFill(screen: Awaited<ReturnType<typeof render>>) {
  return screen.queryByTestId('settings-sync-range-progress-fill');
}

it('shows detection the engine is running after the sync settled, until it ends', async () => {
  const screen = await render(<SyncRangePanel />);
  expect(progressFill(screen)).toBeNull();

  tracks = analysing;
  await act(() => listeners.get('syncProgress')?.forEach((listener) => listener()));
  expect(progressFill(screen)).not.toBeNull();
  expect(progressFill(screen)?.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ width: '40%' })])
  );

  tracks = undefined;
  await act(() => {
    jest.advanceTimersByTime(TRACK_STAGE_REREAD_MS);
  });
  expect(progressFill(screen)).toBeNull();
});
