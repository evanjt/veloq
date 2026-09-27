/**
 * Scenario: a first launch lands on the feed while the engine is still syncing.
 * Expected behaviour: the feed says so, naming the endpoint the engine is on,
 * and says nothing once the sync settles.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SyncState, SyncStep } from 'veloqrs';

import { FeedSyncLine } from '@/features/home/components';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let status: { state: SyncState; completed?: number; total?: number; step?: SyncStep } = {
  state: SyncState.Idle,
};
const listeners: (() => void)[] = [];

function announce(next: typeof status) {
  status = next;
  act(() => listeners.forEach((listener) => listener()));
}

const engine = {
  getSyncStatus: jest.fn(() => status),
  subscribe: jest.fn((_channel: string, listener: () => void) => {
    listeners.push(listener);
    return () => {};
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  listeners.length = 0;
  status = { state: SyncState.Idle };
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

test('an idle sync draws no line', () => {
  const { queryByTestId } = render(<FeedSyncLine />);

  expect(queryByTestId('feed-sync-line')).toBeNull();
});

test('a running sync names the step it is on', () => {
  status = { state: SyncState.Syncing, completed: 2, total: 8, step: SyncStep.Wellness };
  const { getByTestId } = render(<FeedSyncLine />);

  expect(getByTestId('feed-sync-line')).toBeTruthy();
  expect(getByTestId('feed-sync-message').props.children).toBe(
    'settings.syncStepProgress:{"label":"settings.syncStep.wellness","completed":2,"total":8}'
  );
});

test('a sync with no step yet still says it is running', () => {
  status = { state: SyncState.Syncing, completed: 0, total: 0 };
  const { getByTestId } = render(<FeedSyncLine />);

  expect(getByTestId('feed-sync-message').props.children).toBe('settings.syncActivities');
});

test('the line goes when the sync settles', () => {
  status = { state: SyncState.Syncing, completed: 1, total: 8, step: SyncStep.SportSettings };
  const { queryByTestId } = render(<FeedSyncLine />);
  expect(queryByTestId('feed-sync-line')).toBeTruthy();

  announce({ state: SyncState.Idle });

  expect(queryByTestId('feed-sync-line')).toBeNull();
});
