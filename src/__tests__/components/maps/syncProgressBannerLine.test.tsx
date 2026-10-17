/**
 * Scenario: the map's sync banner shows the older-activities fetch, then the
 * track work the engine reports on its sync status, in real en-GB copy. The
 * engine runs that work on its own clock: a GPS pass it kept owed starts after
 * the sync itself has settled, with nothing on the TypeScript side following
 * it.
 *
 * Expected behaviour: the banner shows whatever track stage the sync status
 * carries, whatever the sync's own state, and prints the line the formatter
 * gives it and adds nothing. It used to append its own ellipsis and figure, so
 * a string that already ended in one read "Loading older activities......" and
 * a stage with a figure of its own carried two.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SyncProgressBanner } from '@/features/maps/components/timeline/SyncProgressBanner';
import { getEngine } from '@/shared/native/engine';
import { initialiseI18n } from '@/i18n';
import { SyncState, TrackStep, type SyncStatus, type TrackStage } from 'veloqrs';

const mockState: { current: Record<string, unknown> } = { current: {} };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('react-native-reanimated'),
    __esModule: true,
    default: { View },
    useSharedValue: (initial: number) => {
      const ref = jest.requireActual('react').useRef({ value: initial });
      return ref.current;
    },
    useAnimatedStyle: (build: () => unknown) => build(),
    withTiming: (toValue: number) => toValue,
    withRepeat: (animation: unknown) => animation,
    cancelAnimation: jest.fn(),
  };
});

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (state: unknown) => unknown) => selector(mockState.current),
}));

jest.mock('@/shared/app/extendedFetch', () => ({
  isExtendedFetchRunning: (fetch: { running: boolean }) => fetch.running,
}));

jest.mock('@/shared/native/useLibraryCoverage', () => ({
  useLibraryCoverage: () => null,
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

/** The engine as the status hook reads it: one snapshot, a sync that has settled. */
function engineReporting(tracks: TrackStage | undefined) {
  const snapshot = {
    state: SyncState.Idle,
    inFlight: 0,
    completed: 3,
    total: 3,
    stepItemsDone: 0,
    stepItemsTotal: 0,
    tracks,
  } as unknown as SyncStatus;
  (getEngine as jest.Mock).mockReturnValue({
    getSyncStatus: () => snapshot,
    subscribe: () => () => undefined,
  });
}

function renderBanner() {
  return render(<SyncProgressBanner />);
}

function bannerLine(): string {
  const children = renderBanner().getByTestId('sync-progress-message').props.children;
  return ([] as unknown[]).concat(children).join('');
}

beforeEach(() => {
  mockState.current = { extendedFetch: { running: false } };
  engineReporting(undefined);
});

it('prints one ellipsis while older activities load', () => {
  mockState.current = { extendedFetch: { running: true } };

  const line = bannerLine();

  expect(line).not.toContain('......');
  expect(line).not.toContain('...');
  expect(line.split('…').length - 1).toBe(1);
});

it('shows a GPS pass the engine is running after the sync itself has settled', () => {
  engineReporting({ step: TrackStep.Downloading, completed: 3, total: 12, percent: 25 });

  const screen = renderBanner();

  expect(screen.getByTestId('sync-progress-message').props.children).toBe(
    'Downloading tracks… 25%'
  );
  expect(screen.getByText('3/12')).toBeTruthy();
});

it('names detection with its own percent and no count', () => {
  engineReporting({ step: TrackStep.Analysing, completed: 40, total: 90, percent: 62 });

  const screen = renderBanner();

  expect(screen.getByTestId('sync-progress-message').props.children).toBe('Analysing routes… 62%');
  expect(screen.queryByText('40/90')).toBeNull();
});

it('prints one figure during the heatmap pass', () => {
  engineReporting({ step: TrackStep.DrawingHeatmap, completed: 40, total: 100, percent: 40 });

  const line = bannerLine();

  expect(line.split('%').length - 1).toBe(1);
  expect(line).toBe('Finalising heatmap… 40%');
});

it('shows nothing when the engine reports no track work and no window is loading', () => {
  expect(renderBanner().queryByTestId('sync-progress-banner')).toBeNull();
});
