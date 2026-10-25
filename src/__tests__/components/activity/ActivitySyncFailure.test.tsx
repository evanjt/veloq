/**
 * Scenario: the sync could not ready one activity, and the engine reports the
 * fault on that activity's feed card and on its detail read.
 *
 * Expected behaviour: the card of the failed activity carries a mark with a
 * Retry, a card without a fault carries none, and Retry asks the engine to
 * ready that one activity and re-reads the feed once the engine answers,
 * whether it succeeded or not. A second press while the first is running asks
 * nothing more.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { ActivitySyncFailureNotice } from '@/features/activity/components/ActivitySyncFailure';
import { queryClient } from '@/shared/query/QueryProvider';
import { queryKeys } from '@/shared/query/queryKeys';
import type { FeedCard } from '@/types';

configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

const mockReadyActivityBodies = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ readyActivityBodies: mockReadyActivityBodies }),
}));

jest.mock('@/features/activity/components/ActivityCardContextMenu', () => {
  const { View } = require('react-native');
  return {
    ActivityCardContextMenu: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/strength', () => ({ StrengthActivityCard: () => null }));

jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return { ActivityMapPreview: () => <View /> };
});

const failure = { message: 'streams: local read failed: did not decode', failedAt: 1_000 };

const activity = (overrides: Partial<FeedCard> = {}): FeedCard =>
  ({
    id: 'a1',
    name: 'Lausanne half marathon',
    sportType: 'Run',
    startDateLocal: '2026-08-12T07:30:00',
    distance: 21097,
    movingTime: 17209,
    hasGps: true,
    ...overrides,
  }) as FeedCard;

let invalidate: jest.SpyInstance;

beforeEach(() => {
  mockReadyActivityBodies.mockReset().mockResolvedValue(true);
  invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
});

afterEach(() => invalidate.mockRestore());

describe.each([
  ['a map card', {}],
  ['a compact card', { hasGps: false }],
])('the mark on %s', (_name, shape) => {
  it('is drawn for an activity the sync could not ready, and not for one it could', async () => {
    await render(<ActivityCard activity={activity({ ...shape, syncFailure: failure })} />);
    expect(screen.getByTestId('activity-card-a1-sync-failed')).toBeTruthy();
    expect(screen.getByText('activity.syncFailed.chip')).toBeTruthy();
  });

  it('is absent when the engine reports no fault', async () => {
    await render(<ActivityCard activity={activity(shape)} />);
    expect(screen.queryByTestId('activity-card-a1-sync-failed')).toBeNull();
  });

  it('asks the engine to retry that one activity and re-reads the feed after', async () => {
    await render(<ActivityCard activity={activity({ ...shape, syncFailure: failure })} />);

    await fireEvent.press(screen.getByTestId('activity-card-a1-sync-failed'));

    expect(mockReadyActivityBodies).toHaveBeenCalledTimes(1);
    expect(mockReadyActivityBodies).toHaveBeenCalledWith('a1');
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.activities.infinite.all })
    );
  });

  it('re-reads the feed when the retry throws, so a kept mark is drawn again', async () => {
    mockReadyActivityBodies.mockRejectedValue(new Error('engine closed'));
    await render(<ActivityCard activity={activity({ ...shape, syncFailure: failure })} />);

    await fireEvent.press(screen.getByTestId('activity-card-a1-sync-failed'));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.activities.infinite.all })
    );
  });

  it('asks nothing more while the first retry is running', async () => {
    let finish: (ready: boolean) => void = () => {};
    mockReadyActivityBodies.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    await render(<ActivityCard activity={activity({ ...shape, syncFailure: failure })} />);

    await fireEvent.press(screen.getByTestId('activity-card-a1-sync-failed'));
    await fireEvent.press(screen.getByTestId('activity-card-a1-sync-failed'));
    expect(mockReadyActivityBodies).toHaveBeenCalledTimes(1);
    expect(screen.getByText('activity.syncFailed.retrying')).toBeTruthy();

    await act(async () => finish(true));
    expect(screen.getByText('activity.syncFailed.chip')).toBeTruthy();
  });
});

describe('the notice on the activity screen', () => {
  it('names the fault the engine reported and retries through the same press', async () => {
    const onRetry = jest.fn();
    await render(<ActivitySyncFailureNotice activityId="a1" failure={failure} onRetry={onRetry} />);

    expect(screen.getByText('activity.syncFailed.title')).toBeTruthy();
    expect(screen.getByText(failure.message)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('activity-a1-sync-failed-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
